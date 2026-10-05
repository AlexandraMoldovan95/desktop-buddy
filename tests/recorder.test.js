'use strict';
// Tests for window recording (Portfolio): rules, file names, pause detection, the manager.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../src/main/recorder/rules');
const I = require('../src/renderer/recorder/idle');
const { RecorderManager } = require('../src/main/recorder/manager');
const { sanitizePatch } = require('../src/shared/settings-schema');

const win = (id, name) => ({ id, name });

test('rules: "title contains", not case-sensitive, in rule order, never our own windows', () => {
  const sources = [win('a', 'Desktop Buddy Portfolio'), win('b', 'notes.py - Visual Studio Code'), win('c', 'NOTE ORGANIZER — My project')];
  const rules = [{ id: '1', title: 'unreal editor', enabled: true }, { id: '2', title: 'Note Organizer', enabled: true }];
  assert.deepEqual(R.findMatch(sources, rules).source.id, 'c');
  assert.equal(R.findMatch(sources, [{ id: '3', title: 'Desktop Buddy', enabled: true }]), null, 'we never film ourselves');
  assert.equal(R.findMatch(sources, [{ ...rules[1], enabled: false }]), null, 'a disabled rule does not count');
  assert.equal(R.findMatch(sources, rules, new Set(['c'])), null, 'a window stopped by hand is skipped');
  assert.equal(R.findMatch(sources, [{ id: '4', title: '   ', enabled: true }]), null);
  assert.deepEqual(R.pickable([...sources, win('d', ''), win('e', '  ')]).map((s) => s.id), ['b', 'c']);
});

test('file names safe for Windows', () => {
  const d = new Date(2026, 8, 29, 14, 5, 9);
  assert.equal(R.fileName('Note Organizer', d), 'Note Organizer 2026-09-29 14-05-09.mp4');
  assert.equal(R.fileName('a<b>:c"d/e\\f|g?h*i', d, 'webm'), 'a b c d e f g h i 2026-09-29 14-05-09.webm');
  assert.equal(R.fileName('CON', d), '_CON 2026-09-29 14-05-09.mp4');
  assert.equal(R.fileName('title. ', d), 'title 2026-09-29 14-05-09.mp4');
  assert.ok(R.fileName('x'.repeat(300), d).length < 90);
});

test('capture profile: quality and frames', () => {
  assert.deepEqual(R.captureProfile('720', 30), { maxWidth: 1280, maxHeight: 720, fps: 30, bitsPerSecond: 5e6 });
  assert.equal(R.captureProfile('1080', 60).bitsPerSecond, 12e6);
  assert.equal(R.captureProfile('altceva', 25).maxWidth, 1920);
});

test('settings: rules are validated, the folder can\'t be changed from pages', () => {
  const out = sanitizePatch({ recRules: [{ title: ' Note Organizer ' }, { title: '' }, null, { title: 'x'.repeat(500), enabled: false }], recFolder: 'C:\\Windows', recIdleSec: 99, recFps: 45 });
  assert.equal(out.recRules.length, 2);
  assert.equal(out.recRules[0].title, 'Note Organizer');
  assert.equal(out.recRules[1].title.length, 120);
  assert.equal(out.recRules[1].enabled, false);
  assert.equal(out.recIdleSec, 10);
  assert.equal('recFolder' in out, false);
  assert.equal('recFps' in out, false);
});

test('pauses: a small change (a blinking cursor) does not count, a big one does', () => {
  const a = new Uint8Array(96 * 54).fill(40);
  const cursor = a.slice(); for (let i = 0; i < 4; i++) cursor[1000 + i] = 250;       // 4 pixels out of 5184
  const big = a.slice(); for (let i = 0; i < 800; i++) big[i] = 220;                   // a new window
  assert.ok(I.changedFraction(a, cursor) < 0.002);
  assert.ok(I.changedFraction(a, big) > 0.1);
  const d = I.createIdleDetector({ idleMs: 1500 });
  assert.equal(d.update(a, 0), 'record');
  assert.equal(d.update(cursor, 1000), 'record');
  assert.equal(d.update(a, 1600), 'pause', 'after 1.5 s without real changes');
  assert.equal(d.update(big, 1700), 'record', 'resumes right away on a change');
  assert.deepEqual([...I.toGray(new Uint8Array([255, 255, 255, 255, 0, 0, 0, 255]))], [255, 0]);
});

/** A manager with a fake "capture window" that behaves like the real page. */
function setup({ settings = {}, sources = [win('w1', 'Note Organizer')] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-rec-'));
  const s = { recAuto: true, recRules: [{ id: 'r1', title: 'note organizer', enabled: true }], recQuality: '1080', recFps: 30, recSkipIdle: false, recIdleSec: 1.5, recMaxMinutes: 30, ...settings };
  const index = { data: { items: [] }, update(fn) { fn(this.data); } };
  const events = [];
  let now = new Date(2026, 8, 29, 10).getTime();
  const box = { sources, started: null };
  const m = new RecorderManager({
    getSettings: () => s,
    getSources: async () => box.sources,
    resolveFolder: () => path.join(dir, 'rec'),
    index,
    fs,
    now: () => now,
    onEvent: (k, info) => events.push([k, info]),
    openCapture: async () => ({
      start: async (cfg) => { box.started = cfg; m.onStarted({ ext: 'mp4', width: 1280, height: 720 }); },
      stop: async () => { m.onChunk(Buffer.from('coada')); setImmediate(() => m.onDone({ activeMs: 4200 })); },
      attach: async () => { box.attached = (box.attached || 0) + 1; setImmediate(() => m.onAttached()); },
      detach: async () => { box.detached = (box.detached || 0) + 1; },
      destroy: () => { box.destroyed = true; },
    }),
  });
  return { m, s, dir, index, events, box, tick: (ms) => { now += ms; } };
}

test('manager: the window appears → starts; it closes → saves the whole file', async () => {
  const t = setup();
  await t.m.poll();
  assert.equal(t.m.state().recording.status, 'recording');
  assert.equal(t.m.state().recording.label, 'note organizer');
  assert.equal(t.box.started.profile.maxWidth, 1920);
  t.m.onChunk(Buffer.from('abc'));
  t.m.onStatus({ activeMs: 3000, paused: false });
  t.box.sources = [];
  await t.m.poll();                                      // missing once: still recording
  assert.equal(t.m.state().recording.status, 'recording');
  await t.m.poll();                                      // the second time: stops
  await t.m.waitIdle(2000);
  const saved = t.index.data.items[0];
  assert.equal(path.basename(saved.file), 'note organizer 2026-09-29 10-00-00.mp4');
  assert.equal(fs.readFileSync(saved.file, 'utf8'), 'abccoada');
  assert.equal(saved.activeMs, 4200);
  assert.equal(saved.reason, 'closed');
  assert.equal(fs.existsSync(saved.file + '.part'), false);
  assert.deepEqual(t.events.map((e) => e[0]), ['started', 'saved']);
  assert.equal(t.box.destroyed, true, 'the capture window is destroyed afterwards');
  assert.equal(t.m.list().length, 1);
});

test('manager: stopped by hand does not restart on the same window until it closes', async () => {
  const t = setup();
  await t.m.poll();
  t.m.onChunk(Buffer.from('x'));
  await t.m.stop('manual');
  await t.m.waitIdle(2000);
  await t.m.poll();
  assert.equal(t.m.state().recording, null, 'does not restart');
  t.box.sources = [];
  await t.m.poll();                                      // the window closed → we forget it
  t.box.sources = [win('w2', 'Note Organizer')];
  await t.m.poll();
  assert.equal(t.m.state().recording.status, 'recording', 'a new window starts again');
});

test('manager: without auto start it never starts by itself; manual works; a second start is refused', async () => {
  const t = setup({ settings: { recAuto: false } });
  await t.m.poll();
  assert.equal(t.m.state().recording, null);
  await t.m.startManual('w1');
  assert.equal(t.m.state().recording.manual, true);
  await assert.rejects(t.m.startManual('w1'), /Already/);
  await assert.rejects(setup().m.startManual('does-not-exist'), /no longer open/);
});

test('manager: a capture error → a clear message, no empty file; a recording without data leaves no file', async () => {
  const t = setup();
  t.m.openCapture = async () => ({ start: async () => { throw new Error('NotAllowedError: Permission denied'); }, stop: async () => {}, destroy() {} });
  await t.m.poll();
  assert.equal(t.m.state().recording, null);
  assert.match(t.m.state().lastError, /Windows didn't allow/);
  const u = setup();
  await u.m.poll();
  u.m.openCapture = null;
  u.m.capture.stop = async () => { setImmediate(() => u.m.onDone({ activeMs: 0 })); };
  await u.m.stop('manual');
  await u.m.waitIdle(2000);
  assert.equal(u.index.data.items.length, 0);
  assert.deepEqual(fs.readdirSync(path.join(u.dir, 'rec')), [], 'no .part, no empty file');
});

test('manager: no match, reports which windows it sees (for the terminal, in development mode)', async () => {
  const t = setup({ sources: [win('a', 'Desktop Buddy Portfolio'), win('b', 'Untitled - Notepad')] });
  const seen = [];
  t.m.onDiag = (d) => seen.push(d);
  await t.m.poll();
  assert.equal(t.m.state().recording, null);
  assert.deepEqual(seen, [{ windows: ['Untitled - Notepad'], skipped: 0 }]);
});

test('repeated tests: the app closes and reopens → the same file; if it doesn\'t come back in time → it is saved', async () => {
  const t = setup({ settings: { recMergeSec: 15 } });
  await t.m.poll();
  t.m.onChunk(Buffer.from('test1-'));
  t.box.sources = [];
  await t.m.poll(); await t.m.poll();                    // closed (2 checks in a row)
  assert.equal(t.m.state().recording.status, 'waiting');
  assert.equal(t.box.detached, 1);
  t.tick(5000);
  t.box.sources = [win('w9', 'Note Organizer')];          // a new test run: another window, the same title
  await t.m.poll();
  await new Promise((r) => setImmediate(r));
  assert.equal(t.m.state().recording.status, 'recording');
  assert.equal(t.m.state().recording.parts, 2);
  t.m.onChunk(Buffer.from('test2'));
  // the window closes, this time reported directly by the capture
  await t.m.onSourceEnded();
  assert.equal(t.m.state().recording.status, 'waiting');
  t.box.sources = [];
  t.tick(16000);                                           // doesn't come back within 15 s
  await t.m.poll();
  await t.m.waitIdle(2000);
  assert.equal(t.index.data.items.length, 1, 'a single file');
  assert.equal(fs.readFileSync(t.index.data.items[0].file, 'utf8'), 'test1-test2coada');
  assert.equal(t.index.data.items[0].parts, 2);
  assert.deepEqual(t.events.map((e) => e[0]), ['started', 'resumed', 'saved']);
});

test('repeated tests: a manual stop while waiting saves right away', async () => {
  const t = setup({ settings: { recMergeSec: 30 } });
  await t.m.poll();
  t.m.onChunk(Buffer.from('x'));
  await t.m.onSourceEnded();
  assert.equal(t.m.state().recording.status, 'waiting');
  await t.m.stop('manual');
  await t.m.waitIdle(2000);
  assert.equal(t.index.data.items.length, 1);
  assert.equal(t.m.state().recording, null);
});

// ------------------------------------------------ marks and clips
const C = require('../src/main/recorder/clips');
const M = require('../src/main/recorder/media');

test('marks: the time in the video, no double presses, saved next to the file and in the list', async () => {
  const t = setup();
  assert.equal(t.m.mark(), null, 'no recording: nothing');
  await t.m.poll();
  t.m.onChunk(Buffer.from('abc'));
  t.m.onStatus({ activeMs: 10000, paused: false });
  t.tick(2500);
  assert.equal(t.m.mark(), 12500, 'time flows between updates');
  t.tick(400);
  assert.equal(t.m.mark(), null, 'a second press within 1 s is ignored');
  t.m.onStatus({ activeMs: 40000, paused: true });
  t.tick(5000);
  assert.equal(t.m.mark(), 40000, 'while paused, time does not flow');
  assert.equal(t.m.state().recording.marks, 2);
  t.m.capture.stop = async () => { setImmediate(() => t.m.onDone({ activeMs: 30000 })); };   // the final video is 30 s long
  await t.m.stop('manual');
  await t.m.waitIdle(2000);
  const item = t.index.data.items[0];
  assert.deepEqual(item.marks, [12500], 'a mark after the end of the video (40 s > 30 s) is not kept');
  const txt = fs.readFileSync(item.marksFile, 'utf8');
  assert.match(txt, /1\. 0:12 {3}→ {3}suggested clip 0:04 – 0:19/);
  assert.ok(item.marksFile.endsWith(' - marks.txt'));
});

test('clips: suggested range, validation, file name', () => {
  assert.deepEqual(C.markRange(42000, 60000), { start: 34000, end: 49000 });
  assert.deepEqual(C.markRange(3000, 60000), { start: 0, end: 10000 }, 'never before the start');
  assert.deepEqual(C.markRange(59000, 60000), { start: 51000, end: 60000 }, 'nor after the end');
  assert.throws(() => C.checkRange(1000, 1200, 60000), /too short/);
  assert.throws(() => C.checkRange(0, 11 * 60000, 20 * 60000), /too long/);
  assert.throws(() => C.checkRange(90000, 95000, 60000), /after the end/);
  assert.throws(() => C.checkRange('a', 5, 10), /Invalid/);
  const p = C.clipPath(path.join('C:', 'rec', 'Note Organizer 2026-09-29 16-08-55.mp4'), 34000, 49000);
  assert.equal(path.basename(p), 'Note Organizer 2026-09-29 16-08-55 - clip 0m34s-0m49s.mp4');
  assert.equal(path.basename(path.dirname(p)), 'clips');
  const taken = new Set([p]);
  assert.match(C.clipPath(path.join('C:', 'rec', 'Note Organizer 2026-09-29 16-08-55.mp4'), 34000, 49000, (f) => taken.has(f)), / \(2\)\.mp4$/);
  assert.equal(C.clock(3723000), '1:02:03');
});

test('clips: the export writes in chunks, saves in "clips" and in the list; cancelled = no file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-clip-'));
  const parentFile = path.join(dir, 'Note Organizer 2026-09-29 16-08-55.mp4');
  fs.writeFileSync(parentFile, 'video');
  const index = { data: { items: [] }, update(fn) { fn(this.data); } };
  const saved = [];
  const ex = new C.ClipExporter({ index, fs, now: () => 1000, onSaved: (i) => saved.push(i) });
  const parent = { id: 'p1', file: parentFile, label: 'Note Organizer', activeMs: 60000, size: '1280×720' };
  const job = ex.begin(parent, 34000, 49000);
  ex.chunk(job.id, Buffer.from('aa'));
  ex.chunk(job.id, Buffer.from('bb'));
  const item = await ex.end(job.id, true);
  assert.equal(fs.readFileSync(item.file, 'utf8'), 'aabb');
  assert.equal(item.clipOf, 'p1');
  assert.equal(item.activeMs, 15000);
  assert.equal(index.data.items.length, 1);
  assert.equal(saved.length, 1);
  const bad = ex.begin(parent, 1000, 5000);
  ex.chunk(bad.id, Buffer.from('x'));
  assert.equal(await ex.end(bad.id, false), null);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'clips')), [path.basename(item.file)], 'a cancelled export leaves no files');
  assert.equal(await ex.end('does-not-exist', true), null);
});

test('video for the editor: partial requests (Range) and ids from the address', () => {
  assert.equal(M.parseRange(null, 100), null);
  assert.deepEqual(M.parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(M.parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(M.parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(M.parseRange('bytes=50-500', 100), { start: 50, end: 99 });
  assert.equal(M.parseRange('bytes=100-', 100), false);
  assert.equal(M.parseRange('bytes=abc', 100), false);
  assert.equal(M.idFromUrl(M.mediaUrl('mnx1-ab12cd')), 'mnx1-ab12cd');
  assert.equal(M.idFromUrl('buddy-media://rec/..%2F..%2Fsecret'), null, 'a path can\'t be requested');
  assert.equal(M.idFromUrl('https://rec/abc'), null);
});
