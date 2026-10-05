'use strict';
// Performance fixes (audit r1-performance): low-power mode, day caches, polling rates, window-free logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const PM = require('../src/main/power-mode');
const { trackerPlan, PAUSE_KEEP_MS } = require('../src/main/activity/keep-alive');
const { DayCache } = require('../src/main/day-cache');
const { SessionManager, DAY_CACHE_MAX } = require('../src/main/session-manager');
const { RecorderManager, POLL_MS, IDLE_POLL_MS } = require('../src/main/recorder/manager');
const R = require('../src/main/recorder/rules');
const S = require('../src/main/sessions');
const { sanitizePatch, withDefaults } = require('../src/shared/settings-schema');

const GB = 2 ** 30;
const MIN = 60000;
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const rec = (id, title, start, end, apps = {}) => ({ id, title, start, end, activeMs: end - start, segments: [{ start, end }], apps, titles: {} });
const writeDay = (dir, day, sessions) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${day}.json`), JSON.stringify({ version: 1, date: day, sessions }));
};

// ------------------------------------------------ low-power mode
test('power saver: auto turns on with 4 GB RAM or 2 cores, the setting can force on/off', () => {
  const weakRam = PM.detect({ totalmem: 4 * GB, cpus: 8 });
  const weakCpu = PM.detect({ totalmem: 16 * GB, cpus: 2 });
  const strong = PM.detect({ totalmem: 16 * GB, cpus: 8 });
  assert.equal(PM.resolve('auto', weakRam).low, true);
  assert.match(PM.resolve('auto', weakRam).reason, /4 GB RAM/);
  assert.equal(PM.resolve('auto', weakCpu).low, true);
  assert.match(PM.resolve('auto', weakCpu).reason, /2 cores/);
  assert.equal(PM.resolve('auto', strong).low, false);
  assert.equal(PM.resolve('on', strong).low, true);
  assert.equal(PM.resolve('off', weakRam).low, false);
  assert.equal(PM.resolve('ciudat', weakRam).mode, 'auto');
  // 4.5 GB is the edge (Windows reports a bit less than the installed RAM)
  assert.equal(PM.detect({ totalmem: 4.5 * GB, cpus: 4 }).weak, true);
  assert.equal(PM.detect({ totalmem: 6 * GB, cpus: 4 }).weak, false);
});

test('power saver: the default recording quality drops, but the choice of the user stays', () => {
  // old settings with the defaults: the app may manage them → 720p / 15 fps on a weak PC
  const legacy = withDefaults({});
  assert.deepEqual(PM.recPatch(legacy, true), { recQualityAuto: true, recQuality: '720', recFps: 15 });
  // back on a strong PC (or mode off): the normal defaults come back
  const managed = { ...legacy, recQualityAuto: true, recQuality: '720', recFps: 15 };
  assert.deepEqual(PM.recPatch(managed, false), { recQuality: '1080', recFps: 30 });
  assert.equal(PM.recPatch({ ...legacy, recQualityAuto: true }, false), null);
  // the user chose 1440p in an older version → never touched
  assert.deepEqual(PM.recPatch({ ...legacy, recQuality: '1440' }, true), { recQualityAuto: false });
  assert.equal(PM.recPatch({ ...legacy, recQualityAuto: false, recQuality: '1080' }, true), null);
  // recQualityAuto survives a restart; pages can't set it
  assert.equal(withDefaults({ recQualityAuto: false }).recQualityAuto, false);
  assert.equal('recQualityAuto' in sanitizePatch({ recQualityAuto: true }), false);
  assert.equal(sanitizePatch({ powerMode: 'on' }).powerMode, 'on');
  assert.equal('powerMode' in sanitizePatch({ powerMode: 'turbo' }), false);
  assert.equal(sanitizePatch({ recFps: 15 }).recFps, 15);
});

test('power saver: the capture profile (15 fps, lower bitrate) and the check rates', () => {
  const normal = R.captureProfile('720', 30);
  const low = R.captureProfile('720', 15, { lowPower: true });
  assert.equal(low.fps, 15);
  assert.equal(low.maxHeight, 720);
  assert.ok(low.bitsPerSecond < normal.bitsPerSecond * 0.6, `${low.bitsPerSecond} vs ${normal.bitsPerSecond}`);
  assert.equal(R.captureProfile('1080', 45).fps, 30);
  assert.ok(PM.tuning(true).lookMs > PM.tuning(false).lookMs);
  assert.ok(PM.tuning(true).rulePollMs > PM.tuning(false).rulePollMs);
  assert.equal(PM.tuning(false).panelIdleDestroyMs, 0);
  assert.equal(PM.tuning(true).panelIdleDestroyMs, 5 * MIN);
});

// ------------------------------------------------ M2: the activity helper survives a pause
test('M2: the app helper stays running during a pause (at most 15 min), stops on stop', () => {
  const now = 1e9;
  const running = { state: 'running' };
  const paused = { state: 'paused' };
  assert.equal(trackerPlan({ session: running, trackApps: true, pausedSince: null, now }), 'run');
  assert.equal(trackerPlan({ session: paused, trackApps: true, pausedSince: now - MIN, now }), 'keep');
  assert.equal(trackerPlan({ session: paused, trackApps: true, pausedSince: now - PAUSE_KEEP_MS, now }), 'stop');
  assert.equal(trackerPlan({ session: null, trackApps: true, pausedSince: null, now }), 'stop');
  assert.equal(trackerPlan({ session: running, trackApps: false, pausedSince: null, now }), 'stop');
});

// ------------------------------------------------ H2: progress totals without reading every day
test('H2: per-day totals come from progress-totals.json + only the new days; the file is rebuilt if missing', async () => {
  const dir = tmp('buddy-daycache-');
  const days = path.join(dir, 'sessions');
  const file = path.join(dir, 'progress-totals.json');
  const now = at(2026, 9, 30, 12);
  writeDay(days, '2026-01-05', [rec('a', 'A', at(2026, 1, 5, 9), at(2026, 1, 5, 10))]);
  writeDay(days, '2026-09-29', [rec('b', 'B', at(2026, 9, 29, 9), at(2026, 9, 29, 9, 30))]);
  fs.writeFileSync(path.join(days, 'not-a-day.json'), '{}');
  const reads = [];
  const spy = { ...fs.promises, readFile: (p, enc) => { reads.push(path.basename(p)); return fs.promises.readFile(p, enc); } };
  const c1 = new DayCache({ daysDir: days, file, fsp: spy, now: () => now, log: () => {} });
  await c1.load();
  assert.deepEqual(c1.totalsBefore('2026-09-30'), { '2026-01-05': 60 * MIN, '2026-09-29': 30 * MIN });
  assert.ok(fs.existsSync(file), 'cache-ul e scris');
  // second start: the old day is not read again (only the cache + the newest days)
  reads.length = 0;
  writeDay(days, '2026-02-01', [rec('c', 'C', at(2026, 2, 1, 9), at(2026, 2, 1, 9, 20))]);
  const c2 = new DayCache({ daysDir: days, file, fsp: spy, now: () => now, log: () => {} });
  await c2.load();
  assert.equal(reads.includes('2026-01-05.json'), false, reads.join());
  assert.ok(reads.includes('2026-02-01.json'), 'a new day is read');
  assert.equal(c2.totals['2026-02-01'], 20 * MIN);
  // a broken cache file is rebuilt from the day files
  fs.writeFileSync(file, '{stricat');
  const logs = [];
  const c3 = new DayCache({ daysDir: days, file, now: () => now, log: (m) => logs.push(m) });
  await c3.load();
  assert.equal(c3.totals['2026-01-05'], 60 * MIN);
  assert.equal(logs.length, 1);
  // after a stop, the written days are refreshed from memory
  c3.update(['2026-09-29'], () => [rec('b', 'B', 0, 45 * MIN)]);
  await c3.saving;
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).totals['2026-09-29'], 45 * MIN);
});

test('H2: progress from the cached totals equals the one computed from the files', async () => {
  const { ProgressTracker } = require('../src/main/progress');
  const dir = tmp('buddy-prog-');
  const now = at(2026, 9, 30, 12);
  for (let i = 1; i <= 20; i++) {
    const d = new Date(2026, 8, i);
    writeDay(path.join(dir, 'sessions'), S.dayKey(d.getTime()), [rec(`r${i}`, 'X', d.getTime() + 9 * 3600000, d.getTime() + 9 * 3600000 + i * 10 * MIN)]);
  }
  const sessions = new SessionManager({ dir, now: () => now });
  const plain = new ProgressTracker({ sessions, now: () => now, getSeen: () => 1, setSeen: () => {} });
  const cache = new DayCache({ daysDir: path.join(dir, 'sessions'), file: path.join(dir, 't.json'), now: () => now, log: () => {} });
  await cache.load();
  const cached = new ProgressTracker({ sessions, now: () => now, getSeen: () => 1, setSeen: () => {}, pastTotals: (t) => cache.totalsBefore(t) });
  assert.deepEqual(cached.compute(), plain.compute());
});

test('H2: days read stay in memory at most DAY_CACHE_MAX (LRU), pending writes are not lost', () => {
  const dir = tmp('buddy-lru-');
  const m = new SessionManager({ dir, now: () => at(2026, 9, 30, 12) });
  const first = m.dayStore('2026-01-01');
  first.update((d) => { d.sessions.push(rec('x', 'X', 0, MIN)); });   // pending debounced write
  for (let i = 0; i < DAY_CACHE_MAX + 10; i++) m.dayStore(S.dayKey(at(2025, 1, 1, 12) + i * 86400000));
  assert.equal(m.days.size, DAY_CACHE_MAX);
  assert.equal(m.days.has('2026-01-01'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'sessions', '2026-01-01.json'), 'utf8')).sessions.length, 1, 'written on eviction');
  assert.equal(m.dayRecords('2026-01-01').length, 1);
});

// ------------------------------------------------ H3: stats rows from the cache
test('H3: the cached row = the fully computed row; past days are read only once', async () => {
  const dir = tmp('buddy-wd-');
  const days = path.join(dir, 'sessions');
  const now = at(2026, 9, 30, 12);
  writeDay(days, '2026-09-28', [
    rec('b', 'Afternoon', at(2026, 9, 28, 14), at(2026, 9, 28, 15), { Code: 40 * MIN, Chrome: 20 * MIN }),
    rec('a', 'Morning', at(2026, 9, 28, 9), at(2026, 9, 28, 10), { Chrome: 60 * MIN, Slack: 1000 }),
  ]);
  writeDay(days, '2026-09-29', [{ broken: true }]);
  writeDay(days, '2026-09-30', [rec('t', 'Azi', at(2026, 9, 30, 9), at(2026, 9, 30, 10))]);
  const sessions = new SessionManager({ dir, now: () => now });
  const reads = [];
  const spy = { ...fs.promises, readFile: (p, enc) => { reads.push(path.basename(p)); return fs.promises.readFile(p, enc); } };
  const cache = new DayCache({ daysDir: days, file: path.join(dir, 't.json'), fsp: spy, now: () => now, log: () => {} });
  const list = await cache.workdays(sessions);
  assert.deepEqual(list, sessions.workdays(), 'the same rows as before');
  assert.deepEqual(list.map((d) => d.day), ['2026-09-30', '2026-09-28']);
  reads.length = 0;
  await cache.workdays(sessions);
  assert.deepEqual(reads, [], 'the second time: no file reads');
  // a stop that rewrote a past day invalidates only that row
  cache.update(['2026-09-28'], (d) => sessions.dayRecords(d));
  await cache.workdays(sessions);
  assert.deepEqual(reads.filter((r) => r !== 't.json.tmp'), ['2026-09-28.json']);
});

// ------------------------------------------------ M3: rule polling
function manager(settings) {
  const s = { recAuto: true, recRules: [{ id: 'r1', title: 'app', enabled: true }], ...settings };
  const m = new RecorderManager({
    getSettings: () => s, getSources: async () => [], resolveFolder: () => os.tmpdir(),
    index: { data: { items: [] }, update(fn) { fn(this.data); } }, fs, onEvent: () => {},
    openCapture: async () => ({}), idlePollMs: () => s.idle || IDLE_POLL_MS,
  });
  return { m, s };
}

test('M3: rules are checked rarely while not recording, never without rules, often while recording', async () => {
  const { m, s } = manager();
  m.state = () => ({});   // the real one needs a full recording object
  m.syncAuto();
  assert.equal(m.timerMs, IDLE_POLL_MS);
  s.idle = 3000; m.syncAuto();
  assert.equal(m.timerMs, 3000, 'mod economic: 3 s');
  m.cur = { id: 'x' }; m.changed();
  assert.equal(m.timerMs, POLL_MS, 'while recording: 500 ms');
  m.cur = null; m.changed();
  assert.equal(m.timerMs, 3000);
  s.recRules = [{ id: 'r1', title: 'app', enabled: false }]; m.syncAuto();
  assert.equal(m.timer, null, 'no active rule: no check');
  s.recRules = [{ id: 'r1', title: 'app', enabled: true }]; s.recAuto = false; m.syncAuto();
  assert.equal(m.timer, null);
  await m.shutdown();
});

// ------------------------------------------------ L1: mouse polling for the eyes
test('L1: the gaze stops reading the mouse with animations off, while asleep or with nobody at the computer', () => {
  const { BuddyMood, LOOK_IDLE_SEC } = require('../src/main/buddy-mood');
  const st = { enabled: true, idle: 0, visible: true, lookMs: 120 };
  const m = new BuddyMood({
    send: () => {}, isEnabled: () => st.enabled, isSessionRunning: () => false, getIdleSec: () => st.idle,
    isVisible: () => st.visible, getCursor: () => ({ x: 0, y: 0 }), getBounds: () => ({ x: 0, y: 0, width: 92, height: 92 }),
    lookMs: () => st.lookMs,
  });
  m.start();
  try {
    assert.equal(m.lookTimerMs, 120);
    st.lookMs = 250; m.syncLook();
    assert.equal(m.lookTimerMs, 250, 'mod economic: 250 ms');
    st.idle = LOOK_IDLE_SEC + 1; m.tick();
    assert.equal(m.lookTimer, null, 'nobody at the computer');
    st.idle = 0; m.tick();
    assert.ok(m.lookTimer);
    st.enabled = false; m.sendConfig();
    assert.equal(m.lookTimer, null, 'animations off');
    st.enabled = true; m.sendConfig();
    m.sleeping = true; m.syncLook();
    assert.equal(m.lookTimer, null, 'doarme');
    m.wake();
    assert.ok(m.lookTimer);
    st.visible = false; m.tick();
    assert.equal(m.lookTimer, null, 'ascuns');
  } finally { m.stop(); }
  assert.equal(m.lookTimer, null);
});

// ------------------------------------------------ clipboard: a huge text is not re-read every second
test('clipboard: after a huge text, the clipboard is read only every 5 s; a new small text is caught afterwards', async () => {
  const clip = require('../src/main/clipboard');
  let text = 'start';
  let reads = 0;
  let now = 0;
  const fake = { readText: async () => { reads++; return text; }, writeText: async (t) => { text = t; }, has: async () => false };
  const added = [];
  const w = new clip.ClipboardWatcher(fake, (t) => added.push(t), { now: () => now });
  await w.tick();
  text = 'x'.repeat(clip.MAX_TEXT_LENGTH + 1);
  now += 1000; await w.tick();
  const after = reads;
  for (let i = 0; i < 4; i++) { now += 1000; await w.tick(); }
  assert.equal(reads, after, 'no reads during the 5 s pause');
  text = 'mic';
  now += 1000; await w.tick();
  assert.equal(reads, after + 1);
  now += 1000; await w.tick();
  assert.equal(reads, after + 2, 'back to every second');
  assert.deepEqual(added.slice(-1), ['mic']);
});
