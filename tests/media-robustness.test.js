'use strict';
// Robustness tests for recordings, clips and screenshots (fix round 1, area "media").
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { RecorderManager } = require('../src/main/recorder/manager');
const { ClipExporter, capIndex } = require('../src/main/recorder/clips');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const memIndex = () => ({ data: { items: [] }, update(fn) { fn(this.data); } });

function recSetup({ getSources } = {}) {
  const dir = tmp('buddy-rc-');
  const index = memIndex();
  const events = [];
  const box = { stopped: 0 };
  const m = new RecorderManager({
    getSettings: () => ({ recAuto: false, recRules: [], recMaxMinutes: 60, recQuality: '1080', recFps: 30, recIdleSec: 1.5 }),
    getSources: getSources || (async () => [{ id: 'w1', name: 'Test App' }]),
    openCapture: async () => ({ start: async () => {}, stop: async () => { box.stopped++; }, destroy: () => {} }),
    resolveFolder: () => dir, index, fs,
    onEvent: (k, i) => events.push([k, i]),
  });
  return { m, dir, index, events, box };
}

test('C1: a late chunk after onDone never wipes the recording; finalize is idempotent', async () => {
  const t = recSetup();
  await t.m.startManual('w1');
  t.m.onStarted({ ext: 'mp4' });
  for (let i = 0; i < 20; i++) t.m.onChunk(Buffer.alloc(512 * 1024, i));
  t.m.onDone({});
  t.m.onChunk(Buffer.alloc(1024, 1));     // renderer still recording
  t.m.onDone({});                          // second finalize: ignored
  t.m.fail(new Error('write after end'));  // error while finalizing: must not delete
  await t.m.waitIdle(3000);
  const files = fs.readdirSync(t.dir);
  assert.equal(files.length, 1);
  assert.equal(fs.statSync(path.join(t.dir, files[0])).size, 20 * 512 * 1024);
  assert.equal(t.index.data.items.length, 1);
  assert.equal(t.index.data.items[0].bytes, 20 * 512 * 1024);
  assert.deepEqual(t.events.map((e) => e[0]), ['started', 'saved']);
});

test('C1: "saved" only when the file on disk is non-empty', async () => {
  const t = recSetup();
  await t.m.startManual('w1');
  t.m.onStarted({ ext: 'mp4' });
  t.m.onChunk(Buffer.from('abc'));
  const c = t.m.cur;
  // simulate a flush that left nothing on disk
  c.stream.end(() => {
    fs.truncateSync(c.part, 0);
    c.stream = { end: (cb) => setImmediate(cb), on() {} };
    t.m.onDone({});
  });
  await t.m.waitIdle(3000);
  assert.equal(t.index.data.items.length, 0, 'not indexed');
  assert.deepEqual(fs.readdirSync(t.dir), [], 'no empty file left');
  assert.equal(t.events.map((e) => e[0]).includes('saved'), false);
  assert.match(t.events.at(-1)[1].message, /empty/);
});

test('C1: one failing getSources() during a recording counts as a miss, not an error', async () => {
  let fail = false;
  const t = recSetup({ getSources: async () => { if (fail) throw new Error('getSources failed'); return [{ id: 'w1', name: 'Test App' }]; } });
  await t.m.startManual('w1');
  t.m.onStarted({ ext: 'mp4' });
  t.m.onChunk(Buffer.from('x'));
  fail = true;
  await t.m.poll();
  assert.equal(t.m.cur.status, 'recording');
  fail = false;
  await t.m.poll();
  assert.equal(t.m.cur.miss, 0, 'recovered');
  assert.equal(t.events.some((e) => e[0] === 'error'), false);
});

test('L4: an error that stops a recording gives one notification and real on-disk size', async () => {
  const t = recSetup();
  await t.m.startManual('w1');
  t.m.onStarted({ ext: 'mp4' });
  t.m.onChunk(Buffer.from('12345'));
  t.m.fail(new Error('ENOSPC: no space left on device'));
  await t.m.waitIdle(3000);
  assert.deepEqual(t.events.map((e) => e[0]), ['started', 'error']);
  assert.match(t.events[1][1].message, /disk is full.*kept/);
  assert.equal(t.index.data.items.length, 1, 'the partial file is still listed');
});

test('H1: clips never hide or evict recordings', async () => {
  const dir = tmp('buddy-lst-');
  const index = memIndex();
  const rec = new RecorderManager({ getSettings: () => ({}), getSources: async () => [], openCapture: async () => ({}), resolveFolder: () => dir, index, fs });
  for (let i = 0; i < 3; i++) {
    const file = path.join(dir, `Rec ${i}.mp4`); fs.writeFileSync(file, 'x');
    index.data.items.unshift({ id: `r${i}`, file, label: `Rec ${i}`, activeMs: 600000, startedAt: i });
  }
  const cx = new ClipExporter({ index, fs });
  const parent = () => index.data.items.find((x) => x.id === 'r2');
  for (let k = 0; k < 320; k++) {
    const b = cx.begin(parent(), { parts: [{ start: (k % 30) * 20000, end: (k % 30) * 20000 + 1000 }], format: 'mp4' });
    cx.chunk(b.id, Buffer.from('d'));
    await cx.end(b.id, true);
  }
  const list = rec.listRecordings(20);
  assert.deepEqual(list.map((x) => x.id), ['r2', 'r1', 'r0']);
  assert.equal(list[0].clips, 300, 'clip count per recording (clips capped at 300)');
  assert.equal(index.data.items.filter((x) => !x.clipOf).length, 3);
});

test('H1: capIndex keeps old recordings whose file exists, drops missing ones', () => {
  const dir = tmp('buddy-cap-');
  const items = [];
  for (let i = 0; i < 5; i++) {
    const file = path.join(dir, `r${i}.mp4`);
    if (i !== 3) fs.writeFileSync(file, 'x');
    items.push({ id: `r${i}`, file });
  }
  items.push({ id: 'c1', clipOf: 'r0', file: 'x' }, { id: 'c2', clipOf: 'r0', file: 'y' });
  const out = capIndex(items, fs, 1);
  assert.deepEqual(out.map((x) => x.id), ['r0', 'r1', 'r2', 'r4', 'c1']);
});

// ------------------------------------------------ screenshots
const { ScreenshotService } = require('../src/main/screenshots');
const IMG = require('../src/main/shot-image');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngOf = (w, h, extra = 60) => {
  const ihdr = Buffer.alloc(17); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12);
  return Buffer.concat([PNG_SIG, ihdr, Buffer.alloc(extra, 1)]);
};
function shotSvc(over = {}) {
  const root = tmp('buddy-shots-');
  const svc = new ScreenshotService({
    fs, folder: () => root, annotDir: () => path.join(root, '_annot'), thumbDir: () => path.join(root, '_thumbs'),
    imageSize: (f) => IMG.sizeOfFileSync(fs, f), onExported: () => {}, ...over,
  });
  fs.mkdirSync(svc.dir(), { recursive: true });
  const add = (name, buf = pngOf(800, 600)) => { fs.writeFileSync(path.join(svc.dir(), name), buf); return name; };
  return { svc, root, add };
}

test('H5: picture size comes from the header (PNG, JPEG), limits at 12000 px / 50 MP', () => {
  assert.deepEqual(IMG.sizeFromBuffer(pngOf(7680, 4320)), { width: 7680, height: 4320 });
  // minimal JPEG: SOI, APP0, SOF0 (height 300, width 500)
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x01, 0xf4, 0x03, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(IMG.sizeFromBuffer(jpg), { width: 500, height: 300 });
  assert.equal(IMG.sizeFromBuffer(Buffer.alloc(30)), null);
  assert.equal(IMG.isTooBig({ width: 16384, height: 16384 }), true);
  assert.equal(IMG.isTooBig({ width: 12001, height: 10 }), true);
  assert.equal(IMG.isTooBig({ width: 8000, height: 7000 }), true, '56 MP');
  assert.equal(IMG.isTooBig({ width: 7680, height: 4320 }), false);
  const fx = '/home/claude/audit/robustness-media-work/fixtures';
  if (fs.existsSync(fx)) {
    assert.deepEqual(IMG.sizeOfFileSync(fs, path.join(fx, 'huge16k.png')), { width: 16384, height: 16384 });
    assert.ok(IMG.sizeOfFileSync(fs, path.join(fx, 'jpeg-as.png')).width > 0);
    assert.equal(IMG.sizeOfFileSync(fs, path.join(fx, 'zero.png')), null);
  }
});

test('H5: thumbnails use the async OS thumbnailer; an oversized picture is never decoded on main', async () => {
  const root = tmp('buddy-th-');
  const big = path.join(root, 'big.png'); fs.writeFileSync(big, pngOf(16384, 16384));
  const small = path.join(root, 'small.png'); fs.writeFileSync(small, pngOf(200, 100));
  const calls = [];
  const fakeImg = (w) => ({ isEmpty: () => false, getSize: () => ({ width: w, height: w }), resize: () => fakeImg(1), toJPEG: () => Buffer.from(`jpg${w}`) });
  const ni = {
    createThumbnailFromPath: async (f, sz) => { calls.push(['os', path.basename(f), sz.width]); throw new Error('not supported'); },
    createFromPath: (f) => { calls.push(['decode', path.basename(f)]); return fakeImg(200); },
  };
  assert.equal(await IMG.makeThumbnail(ni, fs, big, 360), null, 'no thumbnail rather than a 1 GB decode');
  assert.deepEqual(calls, [['os', 'big.png', 360]]);
  calls.length = 0;
  assert.equal(String(await IMG.makeThumbnail(ni, fs, small, 360)), 'jpg200');
  assert.deepEqual(calls, [['decode', 'small.png']], 'small picture: plain decode, no OS call');
  ni.createThumbnailFromPath = async () => fakeImg(360);
  calls.length = 0;
  assert.equal(String(await IMG.makeThumbnail(ni, fs, big, 360)), 'jpg360');
  assert.deepEqual(calls, []);
});

test('H5: import refuses oversized pictures; annotating an oversized picture is refused with a clear message', async () => {
  const t = shotSvc();
  await assert.rejects(t.svc.importImage('x.png', pngOf(16384, 16384)), /too big/);
  t.add('Big.png', pngOf(13000, 2000));
  assert.equal(t.svc.isTooBig('Big.png'), true);
  assert.throws(() => t.svc.loadAnnot('Big.png'), /too big to draw on/);
  t.add('Ok.png');
  assert.equal(t.svc.isTooBig('Ok.png'), false);
  assert.equal(t.svc.loadAnnot('Ok.png').image.width, 800);
});

test('H4: autosave racing "Save copy" never fails or corrupts the document; double export keeps one copy', async () => {
  for (let run = 0; run < 40; run++) {
    const t = shotSvc();
    t.add('Shot.png');
    const big = { items: Array.from({ length: 200 }, (_, i) => ({ type: 'rect', x: i, y: i, w: 20, h: 20 })) };
    const small = { items: big.items.slice(0, 199) };
    const r = await Promise.allSettled([t.svc.exportAnnot('Shot.png', pngOf(800, 600), big), t.svc.saveAnnot('Shot.png', small), t.svc.exportAnnot('Shot.png', pngOf(800, 600), big)]);
    assert.deepEqual(r.map((x) => x.status), ['fulfilled', 'fulfilled', 'fulfilled']);
    const doc = t.svc.readAnnot('Shot.png');
    assert.ok(doc && doc.items.length === 200);
    assert.deepEqual(fs.readdirSync(t.svc.dir()).sort(), ['Shot - annotated.png', 'Shot.png']);
    assert.deepEqual(fs.readdirSync(path.join(t.root, '_annot')).filter((f) => f.endsWith('.tmp')), []);
  }
});

test('M4: a failed copy write keeps the previous good copy and leaves no tmp file', async () => {
  const t = shotSvc();
  t.add('Shot.png');
  const doc = { items: [{ type: 'rect', x: 1, y: 1, w: 5, h: 5 }] };
  const first = pngOf(800, 600, 300);
  const r = await t.svc.exportAnnot('Shot.png', first, doc);
  const failing = { ...fs, promises: { ...fs.promises, writeFile: async (f, d) => { if (/annotated.*\.tmp$/.test(f)) { await fs.promises.writeFile(f, d.subarray(0, 10)); const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC'; throw e; } return fs.promises.writeFile(f, d); } } };
  t.svc.d.fs = failing;
  await assert.rejects(t.svc.exportAnnot('Shot.png', pngOf(800, 600, 900), { ...doc, output: r.name }), /ENOSPC/);
  assert.deepEqual(fs.readFileSync(path.join(t.svc.dir(), r.name)), first);
  assert.deepEqual(fs.readdirSync(t.svc.dir()).sort(), ['Shot - annotated.png', 'Shot.png']);
});

test('H2 + M5: trashing many gives one batch notification; failures give a partial result with a short message', async () => {
  const batches = [];
  const single = [];
  const t = shotSvc({
    trashItem: async (f) => { if (/Busy/.test(f)) throw new Error('Failed to move item to trash'); fs.unlinkSync(f); },
    onRemoved: (n) => single.push(n), onRemovedMany: (names) => batches.push(names),
  });
  const names = [];
  for (let i = 0; i < 30; i++) names.push(t.add(`S${i}.png`));
  names.push(t.add('Busy.png'));
  const r = await t.svc.trashMany(names);
  assert.equal(r.moved, 30);
  assert.deepEqual(r.failed, ['Busy.png']);
  assert.match(r.error, /Recycle Bin/);
  assert.doesNotMatch(r.error, /[\\/]/, 'no paths');
  assert.equal(batches.length, 1);
  assert.equal(batches[0].length, 30);
  assert.equal(single.length, 0);
  await assert.rejects(t.svc.trash('Busy.png'), /Recycle Bin/);
});

test('H2: the gallery scan reads no annotation file synchronously and finds copies via the cache', async () => {
  const t = shotSvc();
  for (let i = 0; i < 50; i++) t.add(`S${i}.png`);
  await t.svc.exportAnnot('S3.png', pngOf(800, 600), { items: [{ type: 'rect', x: 1, y: 1, w: 5, h: 5 }] });
  let syncReads = 0;
  t.svc.d.fs = { ...fs, readFileSync: (...a) => { syncReads++; return fs.readFileSync(...a); }, existsSync: (...a) => fs.existsSync(...a) };
  const fresh = new ScreenshotService({ ...t.svc.d });
  const all = await fresh.all();
  assert.equal(all.length, 50);
  assert.equal(all.find((g) => g.name === 'S3.png').copy.name, 'S3 - annotated.png');
  assert.equal(syncReads, 0);
});

test('L5: an annotation document from a newer version is not opened for editing (so never overwritten)', () => {
  const t = shotSvc();
  t.add('Shot.png');
  const p = t.svc.annotPath('Shot.png');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify({ version: 2, file: 'Shot.png', doc: { items: [{ type: 'hologram' }] } }));
  assert.throws(() => t.svc.loadAnnot('Shot.png'), /newer version/);
});

test('M3: orphan .part recordings become normal recordings at startup; unfinished clips are removed (in "clips" and the old "clipuri")', async () => {
  const t = recSetup();
  fs.writeFileSync(path.join(t.dir, 'Note Organizer 2026-10-01 10-00-00.mp4.part'), Buffer.alloc(2048, 1));
  fs.writeFileSync(path.join(t.dir, 'Empty 2026-10-01 11-00-00.webm.part'), '');
  fs.writeFileSync(path.join(t.dir, 'Note Organizer 2026-10-01 09-00-00.mp4'), 'old');
  fs.mkdirSync(path.join(t.dir, 'clipuri'));
  fs.writeFileSync(path.join(t.dir, 'clipuri', 'x - clip 0m01s-0m05s.mp4.part'), 'p');
  fs.mkdirSync(path.join(t.dir, 'clips'));
  fs.writeFileSync(path.join(t.dir, 'clips', 'x - clip 0m02s-0m06s.mp4.part'), 'p');
  assert.equal(await t.m.recoverParts(), 1);
  assert.deepEqual(fs.readdirSync(t.dir).sort(), ['Note Organizer 2026-10-01 09-00-00.mp4', 'Note Organizer 2026-10-01 10-00-00.mp4', 'clips', 'clipuri']);
  assert.deepEqual(fs.readdirSync(path.join(t.dir, 'clipuri')), []);
  assert.deepEqual(fs.readdirSync(path.join(t.dir, 'clips')), []);
  const it = t.index.data.items[0];
  assert.equal(it.reason, 'recovered');
  assert.equal(it.label, 'Note Organizer');
  assert.equal(it.bytes, 2048);
  assert.equal(t.m.listRecordings(5).length, 1);
  assert.equal(await t.m.recoverParts(), 0, 'nothing twice');
});

test('M7 + L1: reserved device names (also with an extension) and split emoji never reach a file name', () => {
  const R = require('../src/main/recorder/rules');
  const C = require('../src/main/capture');
  const d = new Date(2026, 9, 2, 10, 0, 0);
  assert.equal(R.fileName('aux.js - Visual Studio Code', d, 'png'), '_aux.js - Visual Studio Code 2026-10-02 10-00-00.png');
  assert.equal(R.fileName('NUL.c', d), '_NUL.c 2026-10-02 10-00-00.mp4');
  assert.equal(R.fileName('COM1', d), '_COM1 2026-10-02 10-00-00.mp4');
  assert.equal(R.fileName('Console', d), 'Console 2026-10-02 10-00-00.mp4', 'only exact device names');
  assert.equal(C.importName('CON.txt.png'), 'Imported image CON.txt.png');
  assert.equal(C.importName('lpt3.foo.jpg'), 'Imported image lpt3.foo.png');
  assert.equal(C.importName('pic. .png'), 'pic.png', 'no trailing dots or spaces');
  const title = `${'a'.repeat(59)}😀 Discord`;
  const name = R.fileName(title, d, 'png');
  assert.doesNotThrow(() => encodeURIComponent(name));
  assert.ok(name.startsWith(`${'a'.repeat(59)}😀`));
  const imp = C.importName(`${'b'.repeat(79)}😀x.png`);
  assert.doesNotThrow(() => encodeURIComponent(imp));
  assert.doesNotThrow(() => encodeURIComponent(R.fileName('x\uD800y', d)), 'lone surrogate removed');
});

test('M2 + M4: a clip whose write failed reports the real reason; cancelAll ends open jobs and removes partial files', async () => {
  const dir = tmp('buddy-clip-');
  const index = memIndex();
  const cx = new ClipExporter({ index, fs });
  const parent = { id: 'p1', file: path.join(dir, 'Rec.mp4'), label: 'Rec', activeMs: 60000 };
  const b = cx.begin(parent, { parts: [{ start: 0, end: 5000 }], format: 'mp4' });
  cx.chunk(b.id, Buffer.from('data'));
  const e = new Error('ENOSPC: no space left on device'); e.code = 'ENOSPC';
  cx.jobs.get(b.id).stream.emit('error', e);
  await assert.rejects(cx.end(b.id, true), /disk is full/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'clips')), []);
  const c1 = cx.begin(parent, { parts: [{ start: 0, end: 5000 }], format: 'mp4' });
  const c2 = cx.begin(parent, { parts: [{ start: 6000, end: 9000 }], format: 'mp4' });
  cx.chunk(c1.id, Buffer.from('x')); cx.chunk(c2.id, Buffer.from('y'));
  await cx.cancelAll();
  assert.equal(cx.jobs.size, 0);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'clips')), []);
  assert.equal(index.data.items.length, 0);
});
