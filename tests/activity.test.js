'use strict';
// Tests for step 3: tracking the active app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter, PassThrough } = require('stream');
const U = require('../src/main/activity/usage');
const { ActiveWindowTracker } = require('../src/main/activity/tracker');
const { helperCommand } = require('../src/main/activity/helpers');
const { SessionManager } = require('../src/main/session-manager');
const S = require('../src/main/sessions');

/** Waits until cond() is true (polls every 10 ms, up to 5 s): no fixed sleeps, so a slow machine doesn't fail the test. */
const waitFor = async (cond, ms = 5000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('waitFor: timed out'); await new Promise((r) => setTimeout(r, 10)); } };

const at = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const SEC = 1000;
const MIN = 60 * SEC;

test('sample: cleaning, missing window, modern Windows apps', () => {
  assert.equal(U.normalizeSample({ t: 1 }), null, 'no active window');
  assert.deepEqual(U.normalizeSample({ app: ' Google Chrome ', title: 'Gmail   —  Inbox' }), { app: 'Google Chrome', title: 'Gmail — Inbox' });
  assert.deepEqual(U.normalizeSample({ app: 'Application Frame Host', title: 'Settings' }), { app: 'Settings', title: '' });
});

test('tick: big gaps (sleep, freeze) are capped at 5 s', () => {
  assert.equal(U.tickMs(0, 1000), 0);
  assert.equal(U.tickMs(1000, 2500), 1500);
  assert.equal(U.tickMs(1000, 1000 + 10 * MIN), U.MAX_TICK_MS);
});

test('time per app and title, top apps', () => {
  const u = {};
  U.addUsage(u, 'd', { app: 'Code', title: 'main.js' }, 3000);
  U.addUsage(u, 'd', { app: 'Code', title: 'main.js' }, 2000);
  U.addUsage(u, 'd', { app: 'Chrome', title: 'Docs' }, 1000);
  U.addUsage(u, 'd', { app: 'Code', title: 'test.js' }, 1000, { titles: false });
  const top = U.topApps([u.d]);
  assert.deepEqual(top.map((a) => [a.name, a.ms]), [['Code', 6000], ['Chrome', 1000]]);
  assert.deepEqual(top[0].titles, [{ title: 'main.js', ms: 5000 }], 'a title that is turned off is not saved');
});

test('titles: over the limit, the rest goes to "(other windows)"', () => {
  const u = {};
  for (let i = 0; i < U.MAX_TITLES_PER_DAY + 5; i++) U.addUsage(u, 'd', { app: 'X', title: 't' + i }, 1);
  assert.equal(Object.keys(u.d.titles).length, U.MAX_TITLES_PER_DAY + 1);
  assert.equal(u.d.titles['X' + U.SEP + U.OTHER_TITLES], 5);
});

test('titles: the old "(alte ferestre)" key in day files is shown and merged as "(other windows)"', () => {
  const old = { apps: { X: 10 }, titles: { ['X' + U.SEP + '(alte ferestre)']: 7, ['X' + U.SEP + 'a']: 2 } };
  const now = { apps: { X: 3 }, titles: { ['X' + U.SEP + U.OTHER_TITLES]: 3 } };
  const top = U.topApps([old, now], { titlesPerApp: 5 });
  assert.equal(U.OTHER_TITLES, '(other windows)');
  assert.deepEqual(top[0].titles, [{ title: '(other windows)', ms: 10 }, { title: 'a', ms: 2 }]);
});

test('manager: counts only while the session runs, per day, and reaches the report and the day file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-a-'));
  let now = at(2026, 9, 28, 23, 59, 50);
  const m = new SessionManager({ dir, now: () => now });
  const tick = (app, title) => m.recordActivity({ app, title });
  assert.equal(tick('Code', 'x'), false, 'no session: nothing');
  m.begin('Noapte');
  tick('Code', 'main.js');                     // the first sample only starts the count
  now += 1500; tick('Code', 'main.js');        // +1,5 s Code
  now += 1500; tick('Chrome', 'Docs');         // +1,5 s Chrome
  m.pause();
  now += 5 * SEC; assert.equal(tick('Chrome', 'YouTube'), false, 'while paused: nothing');
  m.resume();
  now += 1500; tick('Chrome', 'Docs');         // the first one after a pause: not counted
  now = at(2026, 9, 29, 0, 0, 30);
  tick('Code', 'main.js');                     // a big gap → capped at 5 s, on the new day
  const r = m.stop();
  assert.deepEqual(r.apps.map((a) => [a.name, a.ms]), [['Code', 6500], ['Chrome', 1500]]);
  const d1 = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', '2026-09-28.json'), 'utf8')).sessions[0];
  const d2 = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', '2026-09-29.json'), 'utf8')).sessions[0];
  assert.deepEqual(d1.apps, { Code: 1500, Chrome: 1500 });
  assert.deepEqual(d2.apps, { Code: 5000 });
  assert.equal(d1.titles['Chrome' + U.SEP + 'YouTube'], undefined, 'what happened while paused does not show');
});

test('manager: the time per app survives a crash (the periodic save)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-a-'));
  let now = at(2026, 9, 28, 10);
  const m = new SessionManager({ dir, now: () => now });
  m.begin('X');
  m.recordActivity({ app: 'Code', title: 'a' });
  now += 1500; m.recordActivity({ app: 'Code', title: 'a' });
  now += 1000; await m.autosave();
  const m2 = new SessionManager({ dir, now: () => now });
  assert.equal(m2.session.usage[S.dayKey(now)].apps.Code, 1500);
});

// ---------------------------------------------------------------- tracker with a fake process
function fakeSpawn(lines, { exitCode = null } = {}) {
  const calls = [];
  const fn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.emit('exit', null); };
    calls.push({ command, args, child });
    setImmediate(() => {
      for (const l of lines) child.stdout.write(l + '\n');
      if (exitCode !== null) setTimeout(() => child.emit('exit', exitCode), 5);
    });
    return child;
  };
  fn.calls = calls;
  return fn;
}

test('tracker: reads the JSON lines, ignores junk, reports the state', async () => {
  const samples = [];
  const statuses = [];
  const spawnFn = fakeSpawn(['{"t":1,"app":"Code","title":"a"}', 'not json', '{"t":2,"app":"Chrome","title":"b"}']);
  const t = new ActiveWindowTracker({ getCommand: () => ({ command: 'x', args: [] }), onSample: (s) => samples.push(s.app), onStatus: (s) => statuses.push(s.state), spawnFn });
  t.start();
  await waitFor(() => samples.length === 2);
  assert.deepEqual(samples, ['Code', 'Chrome']);
  t.stop();
  assert.deepEqual(statuses, ['starting', 'ok', 'stopped']);
});

test('tracker: a missing permission on macOS is reported', async () => {
  const statuses = [];
  const t = new ActiveWindowTracker({ getCommand: () => ({ command: 'x', args: [] }), onSample: () => {}, onStatus: (s) => statuses.push(s.state), spawnFn: fakeSpawn(['{"t":1,"app":"Safari","title":"","perm":false}']) });
  t.start();
  await waitFor(() => statuses.includes('permission'));
  t.stop();
  assert.ok(statuses.includes('permission'));
});

test('tracker: an unsupported platform → a clear state, no process', () => {
  const statuses = [];
  const t = new ActiveWindowTracker({ getCommand: () => null, onSample: () => {}, onStatus: (s) => statuses.push(s.state) });
  t.start();
  assert.equal(t.running, false);
  assert.deepEqual(statuses, ['unsupported']);
});

test('helper: on Windows, PowerShell by full path with the script in -EncodedCommand (no file, no Bypass) (L4)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-h-'));
  const cmd = helperCommand(dir, 'win32', { SystemRoot: 'C:\\Windows' });
  assert.equal(cmd.command, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(helperCommand(dir, 'win32', { windir: 'D:\\WIN' }).command, 'D:\\WIN\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(cmd.args.includes('-File'), false);
  assert.equal(cmd.args.includes('-ExecutionPolicy'), false);
  const enc = cmd.args[cmd.args.indexOf('-EncodedCommand') + 1];
  const text = Buffer.from(enc, 'base64').toString('utf16le');
  assert.ok(text.includes('GetForegroundWindow') && text.includes('Start-Sleep -Milliseconds 1500'));
  assert.ok(cmd.args.join(' ').length < 30000, 'fits the Windows command line limit');
  assert.deepEqual(fs.readdirSync(dir), [], 'nothing written to disk');
  assert.equal(helperCommand(dir, 'linux'), null);
  assert.equal(helperCommand(dir, 'darwin').command, '/usr/bin/osascript');
});
