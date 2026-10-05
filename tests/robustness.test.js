'use strict';
// Robustness (fix round 1, core): store read/save failures, backup recovery, logger, user messages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonStore } = require('../src/main/store');
const { createLogger, scrub } = require('../src/main/log');
const { userMessage } = require('../src/main/user-error');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-rb-'));

/** fs whose readFileSync throws `code` for `file` the first `times` calls. */
function lockedFs(file, code, times) {
  let n = 0;
  return {
    ...fs,
    promises: fs.promises,
    readFileSync(p, ...a) {
      if (p === file && n < times) { n++; const e = new Error(`${code}: locked`); e.code = code; throw e; }
      return fs.readFileSync(p, ...a);
    },
    get reads() { return n; },
  };
}

const real = { version: 1, notes: [{ id: 'a', body: 'my note' }] };

test('store (C2): a short lock on read is retried and the data loads', () => {
  const file = path.join(tmpDir(), 'notes.json');
  fs.writeFileSync(file, JSON.stringify(real));
  const s = new JsonStore(file, () => ({ version: 1, notes: [] }), { fs: lockedFs(file, 'EBUSY', 2), readRetryMs: 5 });
  assert.equal(s.data.notes.length, 1);
  assert.equal(s.readOnly, false);
});

test('store (C2): a file that stays locked → read-only, flush does not overwrite', () => {
  const file = path.join(tmpDir(), 'notes.json');
  fs.writeFileSync(file, JSON.stringify(real));
  const problems = [];
  const s = new JsonStore(file, () => ({ version: 1, notes: [] }), {
    fs: lockedFs(file, 'EBUSY', 99), readRetryMs: 1, onProblem: (p) => problems.push(p.kind),
  });
  assert.equal(s.data.notes.length, 0);
  assert.equal(s.readOnly, true);
  assert.equal(s.lastError.code, 'EBUSY');
  assert.deepEqual(problems, ['unreadable']);
  s.update((d) => { d.notes = []; });
  assert.equal(s.flush(), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), real, 'the real file is untouched');
});

test('store (H2): keeps a .bak; an empty or NUL-filled file → restored from .bak', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'notes.json');
  const s = new JsonStore(file, () => ({ version: 1, notes: [] }));
  s.data = real; assert.equal(s.flush(), true);
  s.data = { ...real, notes: [...real.notes, { id: 'b', body: 'a doua' }] }; assert.equal(s.flush(), true);
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).notes.length, 1, '.bak = previous good version');
  for (const broken of ['', Buffer.alloc(4096), '{"version":1,"no']) {
    fs.writeFileSync(file, broken);
    fs.writeFileSync(file + '.bak', JSON.stringify(real));
    const kinds = [];
    const r = new JsonStore(file, () => ({ version: 1, notes: [] }), { onProblem: (p) => kinds.push(p.kind) });
    assert.equal(r.data.notes.length, 1);
    assert.equal(r.recovered, 'bak');
    assert.deepEqual(kinds, ['recovered']);
  }
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('notes.corrupt-')), 'broken file kept aside');
});

test('store (H2): the main file is missing but a .bak exists (crash between renames) → restored', () => {
  const file = path.join(tmpDir(), 'notes.json');
  fs.writeFileSync(file + '.bak', JSON.stringify(real));
  const s = new JsonStore(file, () => ({ version: 1, notes: [] }));
  assert.equal(s.data.notes.length, 1);
  assert.equal(s.recovered, 'bak');
});

test('store: corrupt and no .bak → starts empty, the original kept, `recovered = reset`', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'x.json');
  fs.writeFileSync(file, '{ not json');
  const s = new JsonStore(file, () => ({ items: [] }));
  assert.deepEqual(s.data, { items: [] });
  assert.equal(s.recovered, 'reset');
  assert.equal(s.readOnly, false);
});

test('store (review M5): if the corrupt file can not be moved or copied → read-only, never overwritten', () => {
  const file = path.join(tmpDir(), 'x.json');
  fs.writeFileSync(file, '{ not json');
  const deny = () => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; };
  const s = new JsonStore(file, () => ({ items: [] }), { fs: { ...fs, renameSync: deny, copyFileSync: deny } });
  assert.equal(s.readOnly, true);
  assert.equal(s.flush(), false);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('store (H1): flush returns false on failure and keeps the error; a success clears it', () => {
  const file = path.join(tmpDir(), 'x.json');
  fs.mkdirSync(file + '.tmp'); // open(tmp) fails with EISDIR
  const kinds = [];
  const s = new JsonStore(file, () => ({ v: 1 }), { onProblem: (p) => kinds.push(p.kind) });
  assert.equal(s.flush(), false);
  assert.equal(s.lastError.code, 'EISDIR');
  assert.deepEqual(kinds, ['save-failed']);
  fs.rmdirSync(file + '.tmp');
  assert.equal(s.flush(), true);
  assert.equal(s.lastError, null);
});

test('store: the grouped save is async, and a newer sync flush is not overwritten', async () => {
  const file = path.join(tmpDir(), 'c.json');
  const s = new JsonStore(file, () => ({ n: 0 }), { debounceMs: 1 });
  s.update((d) => { d.n = 1; });
  const p = s.flushAsync();
  s.data.n = 2;
  s.flush();
  await p;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 2);
  assert.equal(fs.existsSync(file + '.atmp'), false);
});

test('log (M4): writes to a file, rotates at the limit, shortens paths', async () => {
  const dir = tmpDir();
  const c = { log() {}, warn() {}, error() {} };
  const L = createLogger({ maxBytes: 400, console: c });
  L.init(dir);
  const err = Object.assign(new Error("EPERM: operation not permitted, open 'C:\\Users\\Zoë Müller\\AppData\\Roaming\\x\\notes.json'"), { code: 'EPERM' });
  for (let i = 0; i < 6; i++) L.error('store', 'cannot save notes.json', err);
  await L.flushed();
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, ['main.1.log', 'main.log']);
  const all = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  assert.ok(all.includes('EPERM'));
  assert.ok(!all.includes('Zoë'), 'no user name from paths');
  assert.ok(fs.statSync(path.join(dir, 'main.log')).size <= 400);
  assert.equal(scrub('/home/ana/x/y.json ok'), '…/y.json ok');
});

test('user-error: short plain-English messages, no paths', () => {
  const e = Object.assign(new Error("ENOSPC: no space left on device, write 'C:\\Users\\Ana\\x.json'"), { code: 'ENOSPC' });
  assert.equal(userMessage(e), 'The disk is full.');
  assert.equal(userMessage(new Error('No session is running.')), 'No session is running.');
  assert.equal(userMessage(new TypeError("Cannot read properties of null (reading 'x')"), 'That did not work.'), 'That did not work.');
  const m = userMessage(new Error('Can not open /home/ana/Videos/x.mp4 now.'));
  assert.ok(!m.includes('/home/ana'), m);
  assert.equal(userMessage(new Error("Error invoking remote method 'a:b': Error: Invalid day.")), 'Invalid day.');
  assert.equal(userMessage(new Error('Invalid data.')), 'Invalid data.');
  assert.equal(userMessage(Object.assign(new Error('Invalid login: 535'), { code: 'EAUTH' }), 'x'), 'x');
});

// ------------------------------------------------------------ sesiuni (C1, H1, H3)
const { SessionManager } = require('../src/main/session-manager');
const S = require('../src/main/sessions');
const MIN = 60000;
const HOUR = 3600000;

test('session (C1/L2): broken records in a day file are skipped, they do not stop startup', () => {
  const dir = tmpDir();
  let now = new Date(2026, 9, 2, 12).getTime();
  const day = S.dayKey(now);
  fs.mkdirSync(path.join(dir, 'sessions'));
  const good = { id: 'a', title: 'x', start: now - HOUR, end: now - 30 * MIN, activeMs: 30 * MIN };
  fs.writeFileSync(path.join(dir, 'sessions', `${day}.json`), JSON.stringify({ sessions: [null, 5, { activeMs: '5', start: 1 }, good] }));
  const m = new SessionManager({ dir, now: () => now });
  const t = m.today();
  assert.equal(t.totalMs, 30 * MIN);
  assert.equal(typeof t.totalMs, 'number');
  assert.ok(fs.readdirSync(path.join(dir, 'sessions')).some((f) => f.startsWith(`${day}.invalid-`)), 'original kept aside');
  assert.deepEqual(m.dayKeys(), [day]);
});

test('session (H1): if the day file is not written, Stop fails clearly and the session stays (paused)', () => {
  const dir = tmpDir();
  let now = new Date(2026, 9, 2, 10).getTime();
  const m = new SessionManager({ dir, now: () => now });
  m.begin('Work');
  now += 2 * HOUR;
  const day = S.dayKey(now);
  fs.mkdirSync(path.join(dir, 'sessions', `${day}.json.tmp`), { recursive: true }); // the write fails
  assert.throws(() => m.stop(), /couldn't be saved to disk.*stays paused/);
  assert.equal(m.session.state, 'paused');
  assert.equal(S.activeMs(m.session, now), 2 * HOUR);
  assert.equal(m.today().records.length, 0, 'no half-saved record counted twice');
  // after restart the session is still there
  assert.ok(new SessionManager({ dir, now: () => now }).session);
  fs.rmdirSync(path.join(dir, 'sessions', `${day}.json.tmp`));
  const sum = m.stop();
  assert.equal(sum.saved, true);
  assert.equal(m.session, null);
  assert.equal(new SessionManager({ dir, now: () => now }).today().totalMs, 2 * HOUR);
});

test('session (H3): the PC sleeping is not counted (suspend / resume)', () => {
  const dir = tmpDir();
  let now = new Date(2026, 9, 2, 22).getTime();
  let mono = 1000;
  const m = new SessionManager({ dir, now: () => now, mono: () => mono });
  m.begin('Seara');
  now += 30 * MIN; mono += 30 * MIN;
  m.suspend();
  now += 9 * HOUR;               // lid closed for the night
  m.resumeFromSleep();
  now += 10 * MIN; mono += 10 * MIN;
  assert.equal(m.state().activeMs, 40 * MIN);
});

test('session (H3): a missed sleep (no event) is caught by the 5 s check', () => {
  const dir = tmpDir();
  let now = new Date(2026, 9, 2, 22).getTime();
  let mono = 0;
  const m = new SessionManager({ dir, now: () => now, mono: () => mono });
  m.begin('x');
  for (let i = 0; i < 12; i++) { now += 5000; mono += 5000; m.checkClock({ tick: true }); }
  now += 8 * HOUR; mono += 8 * HOUR; // Windows QPC may count the sleep too
  m.checkClock({ tick: true });
  now += 5000; mono += 5000;
  assert.ok(m.state().activeMs <= 70000, `activeMs ${m.state().activeMs}`);
});

test('session (H3): the clock jumps 640 days ahead → no hundreds of files, no max level', () => {
  const dir = tmpDir();
  let now = new Date(2025, 0, 1, 9).getTime();
  let mono = 0;
  const m = new SessionManager({ dir, now: () => now, mono: () => mono });
  m.begin('Morning');
  now += 30000; mono += 30000; m.checkClock({ tick: true });
  now = new Date(2026, 9, 2, 9).getTime(); mono += 5000; // NTP sync
  m.checkClock({ tick: true });
  now += 30000; mono += 30000;
  const sum = m.stop();
  assert.ok(sum.activeMs <= 70000, `activeMs ${sum.activeMs}`);
  assert.ok(fs.readdirSync(path.join(dir, 'sessions')).filter((f) => f.endsWith('.json')).length <= 2);
});

test('session (H3): the clock set back 2 h → the real minutes stay', () => {
  const dir = tmpDir();
  let now = new Date(2026, 9, 2, 10).getTime();
  let mono = 0;
  const m = new SessionManager({ dir, now: () => now, mono: () => mono });
  m.begin('x');
  now += 30 * MIN; mono += 30 * MIN; m.checkClock({ tick: true });
  now -= 2 * HOUR; mono += 5000; m.checkClock({ tick: true });
  now += 10 * MIN; mono += 10 * MIN;
  const live = m.state().activeMs;
  assert.ok(live >= 40 * MIN - 10000 && live <= 40 * MIN + 10000, `live ${live}`);
  const sum = m.stop();
  assert.equal(sum.saved, true);
  assert.ok(Math.abs(sum.activeMs - 40 * MIN) <= 10000, `stop ${sum.activeMs}`);
});

// ------------------------------------------------------------ email (M2)
const emailProvider = require('../src/main/email/provider');

test('email (M2): certificate errors have their own message (not "check the port")', () => {
  const cfg = { smtp: { host: 'smtp.example.com', port: 465 } };
  for (const err of [
    Object.assign(new Error('self-signed certificate in certificate chain'), { code: 'ESOCKET' }),
    Object.assign(new Error('x'), { code: 'ESOCKET', cause: { code: 'CERT_HAS_EXPIRED' } }),
    Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }),
  ]) {
    assert.match(emailProvider.friendlyError(err, cfg), /certificate isn't trusted/);
  }
  assert.match(emailProvider.friendlyError(Object.assign(new Error('wrong version number'), { code: 'ESOCKET' }), cfg), /the port/);
  assert.equal(emailProvider.certReason(new Error('ok')), null);
});

// ------------------------------------------------------------ windows (H4)
const { createWindowGuard, HANG_MS } = require('../src/main/window-guard');

function fakeWin() {
  const w = { destroyed: false, reloads: 0, crashed: 0,
    isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; },
    webContents: { reload() { w.reloads++; }, forcefullyCrashRenderer() { w.crashed++; } } };
  return w;
}

test('windows (H4): a crashed page reloads; a second crash within 10 s → closed + one notice, no loop', () => {
  let t = 0;
  const notes = [];
  const wins = { buddy: fakeWin(), panel: fakeWin(), overlay: fakeWin() };
  const g = createWindowGuard({
    nameOf: (w) => Object.keys(wins).find((k) => wins[k] === w) || null,
    log: { warn() {}, error() {} },
    notify: (n) => notes.push(n.title),
    closeOnly: ['overlay'],
    now: () => t,
  });
  assert.equal(g.gone(wins.buddy, { reason: 'clean-exit' }), 'ignored');
  assert.equal(g.gone(wins.buddy, { reason: 'oom' }), 'reloaded');
  t += 60000;
  assert.equal(g.gone(wins.buddy, { reason: 'crashed' }), 'reloaded', 'a crash long after the first is reloaded again');
  t += 3000;
  assert.equal(g.gone(wins.buddy, { reason: 'crashed' }), 'gave-up');
  assert.equal(wins.buddy.destroyed, true);
  assert.equal(wins.buddy.reloads, 2);
  assert.equal(notes.length, 1);
  assert.equal(g.gone(wins.panel, { reason: 'killed' }), 'reloaded', 'other windows are independent');
  assert.equal(g.gone(wins.overlay, { reason: 'crashed' }), 'closed');
  assert.equal(g.gone(fakeWin(), { reason: 'crashed' }), 'closed', 'unknown windows are closed');
});

test('windows (H4): a page hung for HANG_MS is restarted; if it recovers, it is not', () => {
  const timers = [];
  const g = createWindowGuard({
    nameOf: () => 'stats', log: { warn() {}, error() {} }, notify() {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length - 1; },
    clearTimeout: (i) => { timers[i].on = false; },
  });
  const a = fakeWin();
  g.unresponsive(a); g.unresponsive(a);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, HANG_MS);
  g.responsive(a);
  assert.equal(timers[0].on, false);
  const b = fakeWin();
  g.unresponsive(b);
  timers[1].fn();
  assert.equal(b.crashed, 1);
});

// ------------------------------------------------------------ recording (H5)
const { RecorderManager } = require('../src/main/recorder/manager');

test('recording (H5): an unreachable folder → one error, then rare retries (not every 500 ms)', async () => {
  let t = 1000000;
  const events = [];
  const enoent = () => { const e = new Error("ENOENT: no such file or directory, mkdir 'E:\\\\Videos'"); e.code = 'ENOENT'; throw e; };
  let folder = 'E:\\Videos';
  const r = new RecorderManager({
    getSettings: () => ({ recAuto: true, recRules: [{ id: 'r1', title: 'Game', match: 'Game', enabled: true }], recQuality: 'medium', recFps: 30, recIdleSec: 60 }),
    getSources: async () => [{ id: 'window:1:0', name: 'Game' }],
    openCapture: async () => { throw new Error('never gets here'); },
    resolveFolder: () => folder,
    index: { data: { items: [] }, update() {} },
    fs: { ...fs, mkdirSync: enoent },
    now: () => t,
    onEvent: (k, info) => events.push(`${k}: ${info.message}`),
    onChange() {},
  });
  for (let i = 0; i < 10; i++) { await r.poll(); t += 500; }
  assert.equal(events.length, 1, events.join('\n'));
  assert.match(events[0], /recordings folder isn't available/);
  assert.ok(!events[0].includes('Videos'), 'no path in the message');
  t += 10000; await r.poll();
  assert.equal(events.length, 2, 'retried after 10 s');
  t += 10000; await r.poll();
  assert.equal(events.length, 2, 'then waits 20 s');
  folder = 'D:\\Other'; await r.poll();
  assert.equal(events.length, 3, 'a new folder is tried at once');
});

// ------------------------------------------------------------ app tracking (M1)
const { ActiveWindowTracker } = require('../src/main/activity/tracker');

/** Waits until cond() is true (polls every 10 ms, up to 5 s): no fixed sleeps, so a slow machine doesn't fail the test. */
const waitFor = async (cond, ms = 5000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('waitFor: timed out'); await new Promise((r) => setTimeout(r, 10)); } };

test('apps (M1): PowerShell that does not start → state "error", and start() tries again', async () => {
  const statuses = [];
  let spawns = 0;
  const t = new ActiveWindowTracker({
    getCommand: () => ({ command: 'does-not-exist-at-all-xyz', args: [] }),
    onSample() {},
    onStatus: (s) => statuses.push(s.state),
    spawnFn: (...a) => { spawns++; return require('child_process').spawn(...a); },
  });
  t.start();
  await waitFor(() => statuses.includes('error'));
  assert.deepEqual(statuses, ['starting', 'error']);
  assert.equal(t.running, false);
  t.start();
  assert.equal(spawns, 2, 'not a no-op');
  t.stop();
});

test('settings (L1): a value that can not be converted does not throw and does not lose the other settings', () => {
  const { withDefaults } = require('../src/shared/settings-schema');
  const s = withDefaults({ recIdleSec: { toString: 1 }, recMaxMinutes: { valueOf: 2 }, buddyOpacity: 80 });
  assert.equal(s.buddyOpacity, 80);
});
