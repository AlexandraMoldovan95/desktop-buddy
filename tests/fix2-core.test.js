'use strict';
// Round 2 fixes (main side): recordings index saved at once, no paths to pages, shutdown save on every window,
// window guard limits, store hygiene (corrupt copies, .bak scrub), log scrubbing, perf (async autosave, caches).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');
const { JsonStore } = require('../src/main/store');
const { RecorderManager } = require('../src/main/recorder/manager');
const C = require('../src/main/recorder/clips');
const { createShutdownSaver } = require('../src/main/shutdown-save');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const quietLog = () => { const lines = []; const l = (lvl) => (...a) => lines.push([lvl, ...a]); return { lines, info: l('info'), warn: l('warn'), error: l('error') }; };
const recIndexStore = (dir) => new JsonStore(path.join(dir, 'recordings.json'), () => ({ version: 1, items: [] }), { debounceMs: 60000 });
const until = async (fn, ms = 2000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 10)); } return true; };

// ------------------------------------------------------------ H1: the recordings index is saved right away
function recSetup(dir, index) {
  const s = { recAuto: false, recRules: [], recQuality: '720', recFps: 30, recSkipIdle: false, recIdleSec: 1.5, recMaxMinutes: 30 };
  const m = new RecorderManager({
    getSettings: () => s,
    getSources: async () => [{ id: 'w1', name: 'Note Organizer' }],
    resolveFolder: () => path.join(dir, 'rec'),
    index, fs, now: () => new Date(2026, 8, 29, 10).getTime(), onEvent: () => {},
    openCapture: async () => ({
      start: async () => { m.onStarted({ ext: 'mp4', width: 1280, height: 720 }); },
      stop: async () => { m.onChunk(Buffer.from('tail')); setImmediate(() => m.onDone({ activeMs: 4000 })); },
      attach: async () => {}, detach: async () => {}, destroy: () => {},
    }),
  });
  return m;
}

test('H1: a finished recording is in recordings.json at once (not after the debounce)', async () => {
  const dir = tmp('fix2-rec-');
  const index = recIndexStore(dir);
  const m = recSetup(dir, index);
  await m.startManual('w1');
  m.onChunk(Buffer.from('abc'));
  await m.stop('manual');
  await m.waitIdle(2000);
  const onDisk = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'recordings.json'), 'utf8')).items; } catch { return []; } };
  assert.ok(await until(() => onDisk().length === 1), 'written without waiting for the 60 s debounce');
  assert.equal(path.extname(onDisk()[0].file), '.mp4');
  if (index.timer) clearTimeout(index.timer);
});

test('H1: a finished clip export is in recordings.json at once', async () => {
  const dir = tmp('fix2-clip-');
  const index = recIndexStore(dir);
  const parentFile = path.join(dir, 'Note Organizer 2026-09-29 16-08-55.mp4');
  fs.writeFileSync(parentFile, 'video');
  const ex = new C.ClipExporter({ index, fs, now: () => 1000 });
  const job = ex.begin({ id: 'p1', file: parentFile, label: 'Note Organizer', activeMs: 60000 }, 34000, 49000);
  ex.chunk(job.id, Buffer.from('aa'));
  await ex.end(job.id, true);
  const onDisk = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'recordings.json'), 'utf8')).items; } catch { return []; } };
  assert.ok(await until(() => onDisk().length === 1));
  if (index.timer) clearTimeout(index.timer);
});

test('H1: saveIndexNow works with a plain in-memory index too', () => {
  let flushed = 0;
  C.saveIndexNow({ flush: () => { flushed++; } });
  C.saveIndexNow({});   // a test double without any save: nothing to do
  assert.equal(flushed, 1);
});

// ------------------------------------------------------------ L1: shutdown save on every window, once
test('L1: the shutdown save hooks every window (also a recreated one) and runs once', () => {
  const app = new EventEmitter();
  const log = quietLog();
  const done = [];
  const saver = createShutdownSaver({ log, steps: [
    ['a', () => done.push('a')],
    ['bad', () => { throw new Error('disk gone'); }],
    ['c', () => done.push('c')],
  ] });
  saver.install(app);
  const buddy = new EventEmitter();
  app.emit('browser-window-created', {}, buddy);
  buddy.removeAllListeners('session-end');   // the first buddy is destroyed…
  const buddy2 = new EventEmitter();          // …and recreated from the tray
  const panel = new EventEmitter();
  app.emit('browser-window-created', {}, buddy2);
  app.emit('browser-window-created', {}, panel);
  buddy2.emit('session-end');
  panel.emit('session-end');
  assert.deepEqual(done, ['a', 'c'], 'one failing step does not stop the others; runs once');
  assert.ok(log.lines.some((l) => l[0] === 'error' && /bad/.test(l[2])));
});

// ------------------------------------------------------------ M1: no file paths in IPC results
function loadIpc(ctx) {
  const handlers = {};
  const ourWin = { id: 1 };
  const fake = {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: () => {} },
    BrowserWindow: { fromWebContents: (wc) => (wc === 'ours' ? ourWin : null), getAllWindows: () => [] },
    Menu: { buildFromTemplate: (t) => ({ template: t, popup() {} }) },
    shell: {}, app: { quit() {}, getVersion: () => '0', getPath: () => os.homedir() }, clipboard: {}, ClipboardItem: function () {}, nativeImage: {},
  };
  const realLoad = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fake : realLoad.call(this, req, ...rest); };
  try {
    const p = require.resolve('../src/main/ipc');
    delete require.cache[p];
    require('../src/main/ipc').registerIpc({ ...ctx, windows: { buddy: ourWin, panel: ourWin, editor: ourWin, ...(ctx.windows || {}) } });
  } finally { Module._load = realLoad; }
  const page = pathToFileURL(path.join(__dirname, '../src/renderer/panel/index.html')).href;
  return { handlers, ev: { sender: 'ours', senderFrame: { parent: null, url: page } } };
}

test('M1: recorder:list and the editor / viewer channels never send a file path', async () => {
  const dir = tmp('fix2-ipc-');
  const recDir = path.join(dir, 'rec');
  fs.mkdirSync(path.join(recDir, 'clips'), { recursive: true });
  const index = { data: { items: [] }, update(fn) { fn(this.data); } };
  const file = path.join(recDir, 'Note Organizer 2026-09-29 10-00-00.mp4');
  fs.writeFileSync(file, 'v');
  fs.writeFileSync(path.join(recDir, 'm.txt'), 'm');
  index.data.items.push({ id: 'r1', file, marksFile: path.join(recDir, 'm.txt'), label: 'Note Organizer', window: 'Note Organizer', rule: null, startedAt: 1, endedAt: 2, activeMs: 9000, bytes: 1, size: '1280×720', reason: 'manual', parts: 1, marks: [3000], montage: { parts: [] } });
  const rec = new RecorderManager({ getSettings: () => ({}), getSources: async () => [], openCapture: async () => ({}), resolveFolder: () => recDir, index, fs });
  const ex = new C.ClipExporter({ index, fs, now: () => 5 });
  const windows = { editorItemId: 'r1', viewerItemId: 'r1' };
  const { handlers, ev } = loadIpc({
    settingsStore: { data: { recFps: 30 } }, getRecorder: () => rec, getClipExporter: () => ex,
    mediaUrl: (id) => `buddy-media://rec/${id}`, recordingsFolder: () => recDir, windows,
  });
  const job = ex.begin(index.data.items[0], 1000, 3000);
  ex.chunk(job.id, Buffer.from('c'));
  const results = [];
  results.push(await handlers['editor:export-end'](ev, job.id, true));
  results.push(await handlers['recorder:list'](ev));
  results.push(await handlers['recorder:state'](ev));
  results.push(await handlers['editor:clips'](ev), await handlers['editor:info'](ev), await handlers['viewer:info'](ev));
  assert.equal(results[3].length, 1, 'the editor still lists the clip (by id + name)');
  const list = results[1];
  assert.equal(list.length, 1);
  assert.equal(list[0].name, path.basename(file));
  assert.equal(list[0].clips, 1);
  assert.deepEqual(list[0].marks, [3000]);
  for (const k of ['file', 'marksFile', 'montage']) assert.equal(k in list[0], false, k);
  const json = JSON.stringify(results);
  assert.equal(json.includes(dir), false, 'no absolute path in any result');
  assert.equal(json.includes(recDir.replace(/\\/g, '\\\\')), false);
});

// ------------------------------------------------------------ L2 (regressions): existing users are not treated as new
test('L2: a broken settings.json with no .bak keeps full mode and no tour when other data exists', () => {
  const { existingUserPatch, hasUserData } = require('../src/main/existing-user');
  const { withDefaults } = require('../src/shared/settings-schema');
  const load = (dir) => {
    // the same construction as main.js: the default object is a marker for "started from defaults"
    const fresh = {};
    let startedFresh = false;
    const store = new JsonStore(path.join(dir, 'settings.json'), () => fresh, { normalize: (d) => { if (d === fresh) startedFresh = true; return withDefaults(d); } });
    const p = existingUserPatch({ startedFresh, fs, dir });
    if (p) Object.assign(store.data, p);
    return store.data;
  };
  // a new install: nothing on disk → simple mode + tour
  const empty = tmp('fix2-new-');
  assert.equal(hasUserData(fs, empty), false);
  assert.equal(load(empty).uiMode, 'simple');
  assert.equal(load(empty).tourDone, false);
  // a long-time user whose settings.json got truncated
  for (const marker of ['notes.json', 'clipboard.json', 'sessions', 'notes.json.bak', 'recordings.json']) {
    const dir = tmp('fix2-old-');
    fs.writeFileSync(path.join(dir, 'settings.json'), '{"theme":"da');
    if (marker === 'sessions') fs.mkdirSync(path.join(dir, marker)); else fs.writeFileSync(path.join(dir, marker), '{}');
    const s = load(dir);
    assert.equal(s.uiMode, 'full', marker);
    assert.equal(s.tourDone, true, marker);
  }
  // a valid settings file is never touched by this
  const ok = tmp('fix2-ok-');
  fs.writeFileSync(path.join(ok, 'settings.json'), JSON.stringify({ uiMode: 'simple', tourDone: false }));
  fs.writeFileSync(path.join(ok, 'notes.json'), '{}');
  assert.equal(load(ok).uiMode, 'simple');
  assert.equal(load(ok).tourDone, false);
});

// ------------------------------------------------------------ security M1 + perf L3: window guard
const WG = require('../src/main/window-guard');
function guardWin() {
  const w = { destroyed: false, reloads: 0, crashed: 0,
    isDestroyed() { return this.destroyed; }, destroy() { this.destroyed = true; },
    webContents: { reload() { w.reloads++; }, forcefullyCrashRenderer() { w.crashed++; } } };
  return w;
}

test('security M1: a page that hangs after every load is closed with one notice (no endless reload loop)', () => {
  let t = 0;
  const notes = [];
  const timers = [];
  const win = guardWin();
  const g = WG.createWindowGuard({
    nameOf: () => 'stats', log: quietLog(), notify: (n) => notes.push(n.title), now: () => t,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clearTimeout: () => {},
  });
  const results = [];
  for (let i = 0; i < 6 && !win.destroyed; i++) {
    t += 5000;                       // hangs 5 s after each load
    g.unresponsive(win);
    t += WG.HANG_MS;
    timers[timers.length - 1].fn();  // the hang timer fires → forced crash
    results.push(g.gone(win, { reason: 'killed' }));
  }
  assert.deepEqual(results, ['reloaded', 'reloaded', 'gave-up']);
  assert.equal(win.destroyed, true);
  assert.equal(notes.length, 1);
});

test('security M1: slow crash loops (every 15 s) also end; crashes far apart keep reloading', () => {
  let t = 0;
  const g = WG.createWindowGuard({ nameOf: (w) => w.name, log: quietLog(), notify() {}, now: () => t });
  const a = Object.assign(guardWin(), { name: 'gallery' });
  assert.equal(g.gone(a, { reason: 'oom' }), 'reloaded');
  t += 15000;
  assert.equal(g.gone(a, { reason: 'oom' }), 'reloaded');
  t += 15000;
  assert.equal(g.gone(a, { reason: 'oom' }), 'gave-up');
  const b = Object.assign(guardWin(), { name: 'timer' });
  for (let i = 0; i < 5; i++) { t += WG.LOOP_WINDOW_MS / 2 + 1000; assert.equal(g.gone(b, { reason: 'crashed' }), 'reloaded'); }
});

test('perf L3: a hung panel is never force-restarted: logged, one notice, the page keeps its text', () => {
  let t = 0;
  const notes = [];
  const timers = [];
  const log = quietLog();
  const g = WG.createWindowGuard({
    nameOf: () => 'panel', log, notify: (n) => notes.push(n.title), now: () => t, neverKill: ['panel'],
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1; }, clearTimeout: () => {},
  });
  assert.equal(WG.HANG_MS, 60000);
  const p = guardWin();
  g.unresponsive(p);
  timers[0].fn();
  g.responsive(p);
  g.unresponsive(p);
  timers[1].fn();
  assert.equal(p.crashed, 0);
  assert.equal(notes.length, 1, 'one notice per 10 minutes');
  assert.ok(log.lines.some((l) => /left running/.test(l[2])));
});

// ------------------------------------------------------------ store: broken copies, .bak scrub, log text, fsync policy
test('security L1: at most 2 broken copies per file are kept; pruneCorrupt(0) deletes them all', () => {
  const dir = tmp('fix2-corrupt-');
  const file = path.join(dir, 'clipboard.json');
  for (let i = 0; i < 4; i++) {
    fs.writeFileSync(path.join(dir, `clipboard.corrupt-${1000 + i}.json`), 'old');
  }
  fs.writeFileSync(path.join(dir, 'notes.corrupt-5.json'), 'other file: untouched');
  fs.writeFileSync(file, '{"items":[{"text":"my-bank-pin 4321"');
  const s = new JsonStore(file, () => ({ items: [] }));
  assert.equal(s.recovered, 'reset');
  const left = fs.readdirSync(dir).filter((n) => n.startsWith('clipboard.corrupt-')).sort();
  assert.equal(left.length, 2);
  assert.ok(!left.includes('clipboard.corrupt-1000.json'), 'the oldest go first');
  assert.equal(s.pruneCorrupt(0), 2);
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.includes('.corrupt-')), ['notes.corrupt-5.json']);
});

test('security L2: flushScrubbed leaves no removed secret in .bak (sync and async)', async () => {
  const dir = tmp('fix2-scrub-');
  const file = path.join(dir, 'settings.json');
  const s = new JsonStore(file, () => ({}));
  s.data.emailPassEnc = 'CIPHER';
  s.flush();
  s.flush();
  assert.match(fs.readFileSync(file + '.bak', 'utf8'), /CIPHER/);
  s.data.emailPassEnc = null;
  assert.equal(s.flushScrubbed(), true);
  assert.doesNotMatch(fs.readFileSync(file + '.bak', 'utf8'), /CIPHER/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /CIPHER/);
  // the startup migration path (async)
  s.data.apiKeyEnc = 'OLDKEY';
  s.flush(); s.flush();
  delete s.data.apiKeyEnc;
  assert.equal(await s.flushScrubbedAsync(), true);
  assert.doesNotMatch(fs.readFileSync(file + '.bak', 'utf8'), /OLDKEY/);
});

test('security L5: a broken file\'s text never reaches the log, only the position', () => {
  const { safeParseError } = require('../src/main/store');
  let err;
  try { JSON.parse('{"items":[{"text":"password"},\u0000\u0000]}'); } catch (e) { err = e; }
  const safe = safeParseError(err);
  assert.doesNotMatch(safe.message, /password|assword/);
  assert.match(safe.message, /^invalid JSON/);
  // the store itself logs the safe form
  const L = require('../src/main/log').log;
  const seen = [];
  const orig = L.warn;
  L.warn = (...a) => { seen.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(' ')); };
  try {
    const dir = tmp('fix2-l5-');
    fs.writeFileSync(path.join(dir, 'notes.json'), '{"notes":[{"body":"secret diary"},\u0000]}');
    new JsonStore(path.join(dir, 'notes.json'), () => ({ notes: [] }));
  } finally { L.warn = orig; }
  assert.ok(seen.length >= 1);
  assert.ok(seen.every((l) => !/diary|secret/.test(l)), seen.join('\n'));
});

/** fs with promises.open → a handle that counts sync() calls. */
function countingFs() {
  const counts = { sync: 0, renames: [] };
  const real = fs.promises;
  const promises = { ...real, open: async (...a) => { const fh = await real.open(...a); return { writeFile: (...b) => fh.writeFile(...b), sync: () => { counts.sync++; return fh.sync(); }, close: () => fh.close() }; } };
  return { counts, fs: { ...fs, promises, renameSync: (a, b) => { counts.renames.push([path.basename(a), path.basename(b)]); return fs.renameSync(a, b); } } };
}

test('perf M2: debounced saves fsync at most every 30 s; the .bak is always a fsync\'d version', async () => {
  const dir = tmp('fix2-fsync-');
  const file = path.join(dir, 'notes.json');
  let t = 0;
  const c = countingFs();
  const s = new JsonStore(file, () => ({ n: 0 }), { fs: c.fs, now: () => t });
  for (let i = 1; i <= 5; i++) { s.data.n = i; await s.flushAsync(); t += 5000; }
  assert.equal(c.counts.sync, 1, 'only the first of 5 saves within 30 s');
  // the .bak is the fsync'd save (n = 1), not a later unsynced one
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).n, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 5);
  t += 30000;
  s.data.n = 6; await s.flushAsync();
  assert.equal(c.counts.sync, 2, 'after 30 s it fsyncs again');
  s.data.n = 7; await s.flushAsync({ fsync: true });
  assert.equal(c.counts.sync, 3, 'asked for: always');
  assert.equal(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')).n, 6);
});

test('perf M2: maxWaitMs saves a steady stream of changes (no endless debounce)', async () => {
  const dir = tmp('fix2-maxwait-');
  const file = path.join(dir, 'notes.json');
  const s = new JsonStore(file, () => ({ n: 0 }), { debounceMs: 80, maxWaitMs: 150 });
  // keep changing every 25 ms (a plain 80 ms debounce would never save) until the file appears;
  // no fixed deadline for the save itself, so a slow machine doesn't fail the test
  const start = Date.now();
  let i = 0;
  while (!fs.existsSync(file) && Date.now() - start < 5000) { s.update((d) => { d.n = ++i; }); await new Promise((r) => setTimeout(r, 25)); }
  assert.ok(fs.existsSync(file), 'saved while the changes kept coming');
  assert.ok(i >= 3, 'the save came during a stream of changes, not after it stopped');
  s.flush();
});

// ------------------------------------------------------------ security L4: user names with spaces
test('security L4: the log scrubber hides user names with spaces (home / data / app folders)', () => {
  const L = require('../src/main/log');
  const home = 'C:\\Users\\John Smith';
  try {
    L.setPrivatePrefixes([[home, '~'], [home + '\\AppData\\Roaming\\Desktop Buddy Portfolio', '<data>'], [home + '\\AppData\\Local\\Programs\\desktop-buddy', '<app>']]);
    const lines = [
      `at f (${home}\\AppData\\Local\\Programs\\desktop-buddy\\resources\\app.asar\\src\\main\\ipc.js:41:5)`,
      'cannot read c:\\users\\john smith\\OneDrive\\clip.mp4',
      `open '${home.replace(/\\/g, '/')}/AppData/Roaming/Desktop Buddy Portfolio/notes.json'`,
      `spawn ${home}\\x.exe ENOENT`,
    ];
    for (const l of lines) {
      const out = L.scrub(l);
      assert.doesNotMatch(out, /John|Smith/i, out);
    }
    assert.match(L.scrub(lines[0]), /ipc\.js:41:5/, 'the file name and line stay');
    const err = new Error(`EPERM: operation not permitted, open '${home}\\Videos\\a.mp4'`);
    err.stack = `Error: x\n    at g (${home}\\AppData\\Local\\Programs\\desktop-buddy\\resources\\app.asar\\src\\main\\store.js:9:1)`;
    assert.doesNotMatch(L.describe(err), /John|Smith/i);
  } finally {
    L.setPrivatePrefixes([[os.homedir(), '~']]);
  }
});

// ------------------------------------------------------------ perf M1: session autosave off the main thread
test('perf M1: the 15 s session autosave is async (no sync write); sleep still saves synchronously', async () => {
  const { SessionManager } = require('../src/main/session-manager');
  const dir = tmp('fix2-sess-');
  let now = new Date(2026, 9, 1, 9).getTime();
  const m = new SessionManager({ dir, now: () => now });
  m.begin('Work');
  let syncWrites = 0;
  const realFlush = m.active.flush.bind(m.active);
  m.active.flush = () => { syncWrites++; return realFlush(); };
  now += 15000;
  const p = m.autosave();
  assert.equal(syncWrites, 0, 'no sync write for the periodic save');
  assert.equal(await p, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'active-session.json'), 'utf8')).session.lastSavedAt, now);
  now += 5000;
  m.suspend();
  assert.equal(syncWrites, 1, 'going to sleep writes at once');
  m.shutdown();
});

// ------------------------------------------------------------ security L3: a bad day record is repaired once
test('security L3: a day file with a bad record gets one .invalid copy and is repaired (not a new copy per load)', () => {
  const { SessionManager } = require('../src/main/session-manager');
  const dir = tmp('fix2-days-');
  const days = path.join(dir, 'sessions');
  fs.mkdirSync(days);
  const file = path.join(days, '2026-09-01.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, date: '2026-09-01', sessions: [{ start: 1, activeMs: 5000, title: 'ok' }, { start: 'x', activeMs: null }] }));
  for (let run = 0; run < 4; run++) {
    const m = new SessionManager({ dir, now: () => new Date(2026, 9, 1).getTime() });
    assert.equal(m.dayRecords('2026-09-01').length, 1);
    m.shutdown();
  }
  const copies = fs.readdirSync(days).filter((n) => n.includes('.invalid-'));
  assert.equal(copies.length, 1);
  assert.match(fs.readFileSync(path.join(days, copies[0]), 'utf8'), /"x"/, 'the copy keeps the original');
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).sessions.length, 1, 'the day file is repaired');
  // older copies beyond 2 are removed when a new problem appears
  for (const t of [1, 2, 3]) fs.writeFileSync(path.join(days, `2026-09-02.invalid-${t}.json`), '{}');
  fs.writeFileSync(path.join(days, '2026-09-02.json'), JSON.stringify({ version: 1, date: '2026-09-02', sessions: [null] }));
  const m = new SessionManager({ dir, now: () => new Date(2026, 9, 1).getTime() });
  m.dayRecords('2026-09-02');
  m.shutdown();
  assert.deepEqual(fs.readdirSync(days).filter((n) => n.startsWith('2026-09-02.invalid-')).sort(), ['2026-09-02.invalid-2.json', '2026-09-02.invalid-3.json']);
});

// ------------------------------------------------------------ perf M3: the pictures list is cached
test('perf M3: the pictures list is reused while the folder is unchanged (2 stats instead of one per file)', async () => {
  const { ScreenshotService } = require('../src/main/screenshots');
  const root = tmp('fix2-shots-');
  const dir = path.join(root, require('../src/main/capture').SHOT_FOLDER);
  fs.mkdirSync(dir);
  const annot = tmp('fix2-annot-');
  for (let i = 0; i < 20; i++) fs.writeFileSync(path.join(dir, `Shot ${i}.png`), 'x');
  let stats = 0;
  const cfs = { ...fs, promises: { ...fs.promises, stat: (...a) => { stats++; return fs.promises.stat(...a); } } };
  const svc = new ScreenshotService({ fs: cfs, folder: () => root, annotDir: () => annot });
  assert.equal((await svc.all()).length, 20);
  stats = 0;
  const again = await svc.all();
  assert.equal(again.length, 20);
  assert.ok(stats <= 2, `cached: ${stats} stats`);
  again[0].name = 'changed by a caller';
  assert.notEqual((await svc.all())[0].name, 'changed by a caller', 'callers get copies');
  // a file added from outside (Explorer) changes the folder mtime → rescanned
  await new Promise((r) => setTimeout(r, 20));
  fs.writeFileSync(path.join(dir, 'Shot new.png'), 'x');
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(dir, t, t);
  assert.equal((await svc.all()).length, 21);
  // a change made by the app drops the cache at once
  stats = 0;
  svc.invalidateList();
  await svc.all();
  assert.ok(stats > 20, 'rescanned after invalidateList');
  assert.equal((await svc.recent(6)).length, 6);
});

// ------------------------------------------------------------ perf L2: fallback thumbnail decodes, one at a time
test('perf L2: fallback decodes run one at a time and let other work run in between', async () => {
  const { makeSerialQueue } = require('../src/main/shot-image');
  const q = makeSerialQueue();
  const order = [];
  const jobs = [1, 2, 3].map((n) => q.run(() => { order.push(`decode ${n}`); setImmediate(() => order.push(`other ${n}`)); if (n === 2) throw new Error('bad'); return n; }));
  const res = await Promise.allSettled(jobs);
  assert.deepEqual(res.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.deepEqual(order.slice(0, 4), ['decode 1', 'other 1', 'decode 2', 'other 2'], 'other events run between two decodes');
});

// ------------------------------------------------------------ perf M4: a new panel shows only after its page painted
test('perf M4: a just-created panel is shown on ready-to-show (last request wins; a hide cancels; a timeout shows it anyway)', () => {
  const { createReadyGate } = require('../src/main/ready-gate');
  const timers = [];
  const gate = createReadyGate({ maxWaitMs: 3000, setTimeout: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length - 1; }, clearTimeout: (i) => { if (timers[i]) timers[i].on = false; } });
  const shown = [];
  assert.equal(gate.show(() => shown.push('old window')), true, 'no window yet created through the gate: shows at once');
  const w = new EventEmitter();
  gate.reset(w);
  assert.equal(gate.show(() => shown.push('first click')), false);
  assert.equal(gate.show(() => shown.push('second click')), false, 'a second click while loading does not toggle it closed');
  w.emit('ready-to-show');
  assert.deepEqual(shown, ['old window', 'second click']);
  assert.equal(gate.show(() => shown.push('later')), true);
  // a hide before paint: never shown
  const w2 = new EventEmitter();
  gate.reset(w2);
  gate.show(() => shown.push('cancelled'));
  gate.cancel();
  w2.emit('ready-to-show');
  assert.equal(shown.includes('cancelled'), false);
  // a page that never paints is shown after maxWaitMs
  const w3 = new EventEmitter();
  gate.reset(w3);
  gate.show(() => shown.push('timeout'));
  const t = timers.filter((x) => x.on).pop();
  assert.equal(t.ms, 3000);
  t.fn();
  assert.equal(shown[shown.length - 1], 'timeout');
  // a stale window's ready-to-show does nothing
  w.emit('ready-to-show');
});

// ------------------------------------------------------------ main-owned strings
test('strings: level-up points to the real look page and opens it; "picture" in user messages; clips hint names the button', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.doesNotMatch(main, /Settings → Buddy → Customize/);
  assert.match(main, /Change how the buddy looks/);
  assert.match(main, /showPanel\('settings', \{ cat: 'look' \}\)/);
  assert.match(C.marksText('a.mp4', [1000]), /"Cut a clip"/);
  assert.doesNotMatch(C.marksText('a.mp4', [1000]), /scissors/);
  const shots = fs.readFileSync(path.join(__dirname, '../src/main/screenshots.js'), 'utf8');
  const userTexts = [...shots.matchAll(/(?:new Error\(|return )'([^']*(?:\\'[^']*)*)'/g)].map((m) => m[1]);
  assert.ok(userTexts.includes('This picture no longer exists.'));
  assert.deepEqual(userTexts.filter((t) => /screenshot/i.test(t)), []);
});

// ------------------------------------------------------------ session 1 (owner decisions, 04.10.2026)
test('lock screen: "pause" pauses, "pause-resume" goes on at unlock, "ignore" keeps counting', () => {
  const { SessionManager } = require('../src/main/session-manager');
  const mk = () => { let t = 1_000_000; const m = new SessionManager({ dir: tmp('lock-'), now: () => t }); m.begin('Work'); t += 60_000; return m; };
  const a = mk(); assert.equal(a.onScreenLock('pause'), true); assert.equal(a.session.state, 'paused'); assert.equal(a.onScreenUnlock('pause'), false); assert.equal(a.session.state, 'paused');
  const b = mk(); b.onScreenLock('pause-resume'); assert.equal(b.session.state, 'paused'); assert.equal(b.onScreenUnlock('pause-resume'), true); assert.equal(b.session.state, 'running');
  const c = mk(); assert.equal(c.onScreenLock('ignore'), false); assert.equal(c.session.state, 'running');
  // paused by hand before the lock: unlock never resumes it
  const d = mk(); d.pause(); d.onScreenLock('pause-resume'); assert.equal(d.onScreenUnlock('pause-resume'), false); assert.equal(d.session.state, 'paused');
  for (const m of [a, b, c, d]) m.shutdown();
});

test('OneDrive: folders synced by OneDrive are detected from env roots or the path', () => {
  const { isInOneDrive } = require('../src/main/onedrive');
  const env = { OneDrive: 'C:\\Users\\Ana\\OneDrive' };
  assert.equal(isInOneDrive('C:\\Users\\Ana\\OneDrive\\Videos\\Desktop Buddy Portfolio', env), true);
  assert.equal(isInOneDrive('C:\\Users\\Ana\\Videos\\Desktop Buddy Portfolio', env), false);
  assert.equal(isInOneDrive('C:\\Users\\Ana\\OneDriveBackupOld\\x', env), false, 'only the exact root or a sub-folder');
  assert.equal(isInOneDrive('D:\\Data\\OneDrive - Contoso\\Videos', {}), true, 'company OneDrive without env vars');
  assert.equal(isInOneDrive('', env), false);
});

test('settings: sessionOnLock is validated; the OneDrive notice flag is kept but never set by pages', () => {
  const S = require('../src/shared/settings-schema');
  assert.equal(S.withDefaults({}).sessionOnLock, 'pause');
  assert.equal(S.sanitizePatch({ sessionOnLock: 'pause-resume' }).sessionOnLock, 'pause-resume');
  assert.equal(S.sanitizePatch({ sessionOnLock: 'explode' }).sessionOnLock, undefined);
  assert.equal(S.withDefaults({ recOneDriveWarned: true, uiMode: 'full' }).recOneDriveWarned, true);
  assert.equal(S.sanitizePatch({ recOneDriveWarned: true }).recOneDriveWarned, undefined);
});

test('email: a password saved before the address was typed survives filling it in (same server)', () => {
  const P = require('../src/main/email/pass-binding');
  const before = { emailPassEnc: 'x', emailSmtpHost: 'smtp.gmail.com', emailSmtpPort: 465, emailSmtpSecurity: 'ssl', emailAddress: '', emailUsername: '' };
  before.emailPassFor = P.bindingOf(before);
  const typed = { ...before, emailAddress: 'me@gmail.com' };
  const r = P.enforce(typed);
  assert.equal(r.emailPassEnc, undefined, 'not cleared');
  assert.equal(r.emailPassFor, P.bindingOf(typed), 're-bound to the address');
  // another server is still a different place: cleared
  assert.equal(P.enforce({ ...typed, emailPassFor: r.emailPassFor, emailSmtpHost: 'evil.example' }).emailPassEnc, null);
  // a typed address changed to another account: cleared
  assert.equal(P.enforce({ ...typed, emailPassFor: r.emailPassFor, emailAddress: 'other@gmail.com' }).emailPassEnc, null);
});
