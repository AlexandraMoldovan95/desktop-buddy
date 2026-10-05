'use strict';
// Quick capture (1.8.0): dragged area → real pixels, file names, the quick note, ScreenshotService with fakes.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const C = require('../src/main/capture');
const { ScreenshotService } = require('../src/main/screenshots');

test('dragged area: in any direction, clipped at the screen edge, a click is not an area', () => {
  assert.deepEqual(C.normalizeRect({ x1: 300, y1: 200, x2: 100, y2: 50 }, 1280, 720), { x: 100, y: 50, width: 200, height: 150 });
  assert.deepEqual(C.normalizeRect({ x1: -20, y1: 700, x2: 50, y2: 900 }, 1280, 720), { x: 0, y: 700, width: 50, height: 20 });
  assert.equal(C.normalizeRect({ x1: 10, y1: 10, x2: 12, y2: 300 }, 1280, 720), null, 'narrower than 4 px');
  assert.equal(C.normalizeRect({ x1: 'a', y1: 0, x2: 1, y2: 1 }, 100, 100), null);
  assert.equal(C.normalizeRect(null, 100, 100), null);
});

test('area → the capture\'s real pixels (125 %, 150 %, 200 %), never outside the image', () => {
  const r = { x: 100, y: 50, width: 200, height: 150 };
  assert.deepEqual(C.toImageRect(r, 1280, 720, 2560, 1440), { x: 200, y: 100, width: 400, height: 300 });
  assert.deepEqual(C.toImageRect(r, 1536, 864, 1920, 1080), { x: 125, y: 63, width: 250, height: 188 }, '125 %');
  assert.deepEqual(C.toImageRect({ x: 1200, y: 700, width: 80, height: 20 }, 1280, 720, 1920, 1080), { x: 1800, y: 1050, width: 120, height: 30 });
  assert.deepEqual(C.toImageRect({ x: 1270, y: 0, width: 10, height: 720 }, 1280, 720, 1281, 720).x + C.toImageRect({ x: 1270, y: 0, width: 10, height: 720 }, 1280, 720, 1281, 720).width <= 1281, true);
});

test('file names: safe for Windows, unique; from a page only a PNG in the folder is accepted', () => {
  const d = new Date(2026, 9, 1, 21, 40, 12);
  assert.equal(C.shotFileName('', d), 'Screenshot 2026-10-01 21-40-12.png');
  assert.equal(C.shotFileName('Note Organizer: test?', d), 'Note Organizer test 2026-10-01 21-40-12.png');
  const taken = new Set([path.join('D', 'a.png'), path.join('D', 'a (2).png')]);
  assert.equal(C.uniqueFile('D', 'a.png', (f) => taken.has(f)), path.join('D', 'a (3).png'));
  assert.equal(C.isSafeShotName('Screenshot 2026-10-01 21-40-12.png'), true);
  for (const bad of ['../x.png', 'C:\\x.png', 'x.exe', 'a/b.png', '', 7]) assert.equal(C.isSafeShotName(bad), false, String(bad));
});

test('quick note: no trailing spaces, empty = not saved', () => {
  assert.equal(C.quickNoteText('  new idea  \n\n'), '  new idea');
  assert.equal(C.quickNoteText('   \n '), null);
  assert.equal(C.quickNoteText(5), null);
  assert.equal(C.quickNoteText('x'.repeat(30000)).length, C.MAX_QUICK_NOTE);
});

/** A fake "image": remembers the crop and gives a fake PNG. */
function fakeImage(w, h, tag = 'img') {
  return {
    w, h, tag,
    isEmpty: () => w === 0,
    getSize: () => ({ width: w, height: h }),
    crop(r) { return fakeImage(r.width, r.height, `${tag}[${r.x},${r.y},${r.width},${r.height}]`); },
    toPNG() { return Buffer.from(`PNG:${this.tag}`); },
    toJPEG: () => Buffer.from('jpg'),
    toDataURL: () => 'data:image/png;base64,AA==',
  };
}

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
  const log = [];
  const display = { id: 7, bounds: { x: 0, y: 0, width: 1280, height: 720 }, size: { width: 1280, height: 720 }, scaleFactor: 1.5 };
  const svc = new ScreenshotService({
    capturer: {
      getSources: async (o) => (o.types[0] === 'screen'
        ? [{ id: 'screen:1', display_id: '3', thumbnail: fakeImage(10, 10) }, { id: 'screen:7', display_id: '7', thumbnail: fakeImage(o.thumbnailSize.width, o.thumbnailSize.height, 'screen') }]
        : [{ id: 'window:1:0', name: 'Note Organizer', thumbnail: fakeImage(320, 200) }, { id: 'window:2:0', name: 'Desktop Buddy Portfolio', thumbnail: fakeImage(320, 200) }]),
    },
    screen: { getCursorScreenPoint: () => ({ x: 10, y: 10 }), getDisplayNearestPoint: () => display },
    fs,
    folder: () => dir,
    imageFromDataURL: (url) => (url === 'bad' ? fakeImage(0, 0) : fakeImage(800, 600, 'window')),
    ui: {
      hideOwn: () => { log.push('hide'); return () => log.push('restore'); },
      showOverlay: (d) => log.push(`overlay:${d.id}`),
      closeOverlay: () => log.push('close-overlay'),
      showPicker: () => log.push('picker'),
      closePicker: () => log.push('close-picker'),
      grabFrame: async () => (log.includes('grab-bad') ? 'bad' : 'data:image/png;base64,AA=='),
    },
    onSaved: (file, kind) => log.push(`saved:${kind}:${path.basename(file)}`),
    onError: (m) => log.push(`error:${m}`),
    trashItem: async (file) => { log.push(`trash:${path.basename(file)}`); fs.unlinkSync(file); },
    onRemoved: (name) => log.push(`removed:${name}`),
    annotDir: () => path.join(dir, '_data', 'annotations'),
    imageSize: () => ({ width: 1280, height: 720 }),
    onExported: (name) => log.push(`exported:${name}`),
    thumbnail: (file) => { log.push(`thumb:${path.basename(file)}`); return Buffer.from(`JPG:${path.basename(file)}`); },
    thumbDir: () => path.join(dir, '_data', 'thumbs'),
    imageFromBuffer: (buf) => (buf.includes('NOTIMG') ? fakeImage(0, 0) : fakeImage(640, 480)),
  });
  return { svc, dir, log };
}

test('ScreenshotService: area at 150 % → crop in real pixels, PNG in Screenshots; Esc saves nothing', async () => {
  const { svc, dir, log } = world();
  assert.equal(await svc.startZone(), true);
  assert.deepEqual(log.slice(0, 3), ['hide', 'restore', 'overlay:7'], 'the panel and the buddy are hidden only during the capture');
  assert.equal(await svc.startZone(), false, 'one capture at a time');
  assert.match(svc.overlayInfo().image, /^data:image\/jpeg;base64,/);
  const file = await svc.finishZone({ x1: 100, y1: 50, x2: 300, y2: 200 });
  assert.equal(path.dirname(file), path.join(dir, 'Screenshots'));
  assert.equal(fs.readFileSync(file, 'utf8'), 'PNG:screen[150,75,300,225]', 'the right screen (display_id), scale 1.5');
  assert.ok(log.some((l) => l.startsWith('saved:zone:Screenshot ')));
  await svc.startZone();
  assert.equal(await svc.finishZone(null), null);
  assert.equal(fs.readdirSync(path.join(dir, 'Screenshots')).length, 1);
  const recent = await svc.recent();
  assert.equal(recent.length, 1);
  assert.equal(svc.fileOf(recent[0].name), file);
  assert.throws(() => svc.fileOf('../secret.png'), /invalid/i);
});

test('ScreenshotService: a window from the list (not the app\'s own windows), the window name in the file; a clear error', async () => {
  const { svc, log } = world();
  const list = await svc.listWindows();
  assert.deepEqual(list.map((w) => w.name), ['Note Organizer']);
  assert.equal(await svc.captureWindow('window:2:0'), null, 'an app window can\'t be requested');
  const file = await svc.captureWindow('window:1:0');
  assert.match(path.basename(file), /^Note Organizer \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.png$/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'PNG:window');
  assert.equal(svc.pending, null, 'the source for getDisplayMedia is forgotten after the capture');
  log.push('grab-bad');
  await svc.listWindows();
  assert.equal(await svc.captureWindow('window:1:0'), null);
  assert.ok(log.some((l) => l.startsWith('error:Couldn\'t capture the window')));
});

// ------------------------------------------------ 1.10.0: the card after a capture, the large view, copy, delete to the Recycle Bin
const media = require('../src/main/recorder/media');

test('screenshot address: buddy-media://shot/<name>, round trip with spaces and accents; another protocol / host = nothing', () => {
  const name = 'Café notes – résumé 2026-10-01 21-40-12.png';
  const url = media.shotUrl(name);
  assert.match(url, /^buddy-media:\/\/shot\//);
  assert.equal(media.shotNameFromUrl(url), name);
  assert.equal(media.shotNameFromUrl('buddy-media://rec/abc-123'), null);
  assert.equal(media.shotNameFromUrl('https://shot/x.png'), null);
  assert.equal(media.shotNameFromUrl('buddy-media://shot/'), null);
  assert.equal(media.shotNameFromUrl('not an address'), null);
  // an encoded "../" reaches fileOf as a name with "/" → refused (it doesn't leave the Screenshots folder)
  assert.equal(media.shotNameFromUrl(media.shotUrl('../secret.png')), '../secret.png');
  assert.equal(C.isSafeShotName('../secret.png'), false);
});

test('ScreenshotService: info (size, date) and delete only to the Recycle Bin, only from the Screenshots folder', async () => {
  const { svc, log } = world();
  await svc.startZone();
  const file = await svc.finishZone({ x1: 0, y1: 0, x2: 100, y2: 100 });
  const name = path.basename(file);
  const inf = svc.info(name);
  assert.equal(inf.name, name);
  assert.equal(inf.bytes, fs.statSync(file).size);
  assert.ok(inf.at > 0);
  assert.throws(() => svc.info('..\\..\\x.png'), /invalid/i);
  await assert.rejects(svc.trash('other.png'), /no longer exists/);
  assert.equal(await svc.trash(name), true);
  assert.deepEqual(log.filter((l) => /^(trash|removed):/.test(l)), [`trash:${name}`, `removed:${name}`]);
  assert.equal(fs.existsSync(file), false);
  assert.deepEqual(await svc.recent(), []);
});

// ------------------------------------------------ 1.11.0: annotations (the editable document + the "- annotated.png" copy)
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A PNG header (IHDR with width × height) followed by filler: enough for the size check, no decode. */
const pngOf = (w, h) => { const ihdr = Buffer.alloc(17); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(w, 8); ihdr.writeUInt32BE(h, 12); return Buffer.concat([PNG_SIG, ihdr, Buffer.alloc(60, 1)]); };
const PNG = pngOf(640, 480);

test('annotations: saved separately, the original never changes, the copy always has the same name', async () => {
  const { svc, log } = world();
  await svc.startZone();
  const file = await svc.finishZone({ x1: 0, y1: 0, x2: 100, y2: 100 });
  const name = path.basename(file);
  const original = fs.readFileSync(file);
  assert.equal(svc.loadAnnot(name).doc, null, 'no annotations at first');
  await svc.saveAnnot(name, { items: [{ type: 'arrow', x1: 1, y1: 1, x2: 50, y2: 50 }, { type: 'evil' }] });
  const l = svc.loadAnnot(name);
  assert.equal(l.source, name);
  assert.deepEqual(l.image, { width: 1280, height: 720 });
  assert.deepEqual(l.doc.items.map((i) => i.type), ['arrow']);
  const r1 = await svc.exportAnnot(name, PNG, l.doc);
  assert.match(r1.name, / - annotated\.png$/);
  assert.deepEqual(fs.readFileSync(path.join(svc.dir(), r1.name)), PNG);
  assert.deepEqual(fs.readFileSync(file), original, 'the original is untouched');
  const r2 = await svc.exportAnnot(name, PNG, { ...r1.doc, items: [] });
  assert.equal(r2.name, r1.name, 'the second save rewrites the same copy');
  assert.ok(log.includes(`exported:${r1.name}`));
  // the copy points back to the original (annotations are edited on the original)
  assert.equal(svc.resolveSource(r1.name), name);
  assert.equal(svc.loadAnnot(r1.name).source, name);
  // a file named "… - annotated.png" that is NOT the saved copy stays itself
  fs.writeFileSync(path.join(svc.dir(), 'Other - annotated.png'), PNG);
  assert.equal(svc.resolveSource('Other - annotated.png'), 'Other - annotated.png');
});

test('annotations: an old copy "X - adnotat.png" stays paired with its original (gallery, pair, resolve, re-save)', async () => {
  const { svc } = world();
  await svc.startZone();
  const name = path.basename(await svc.finishZone({ x1: 0, y1: 0, x2: 100, y2: 100 }));
  const old = name.replace(/\.png$/, ' - adnotat.png');
  // a document saved before the English pass stores doc.output with the old suffix
  const r1 = await svc.exportAnnot(name, PNG, { output: old, items: [{ type: 'step', x: 5, y: 5 }] });
  assert.equal(r1.name, old, 'the stored copy name is reused');
  assert.deepEqual((await svc.all()).map((g) => [g.name, g.copy && g.copy.name]), [[name, old]]);
  assert.equal(svc.resolveSource(old), name);
  assert.deepEqual(svc.pairOf(old), { original: name, copy: old });
  const r2 = await svc.exportAnnot(name, PNG, { ...r1.doc, items: [] });
  assert.equal(r2.name, old, 'saving again keeps the old copy instead of making a second one');
  assert.equal(fs.readdirSync(svc.dir()).filter((n) => /annotated/.test(n)).length, 0);
});

test('annotations: a fake PNG, names outside the folder and huge documents are refused', async () => {
  const { svc } = world();
  await svc.startZone();
  const name = path.basename(await svc.finishZone({ x1: 0, y1: 0, x2: 100, y2: 100 }));
  await assert.rejects(svc.exportAnnot(name, Buffer.from('not a png'), { items: [] }), /PNG/);
  await assert.rejects(svc.saveAnnot('..\\..\\x.png', { items: [] }), /invalid/i);
  assert.throws(() => svc.loadAnnot('missing.png'), /no longer exists/);
  const pts = Array.from({ length: 1500 }, (_, i) => [i + 0.5, (i % 700) + 0.5]);
  await assert.rejects(svc.saveAnnot(name, { items: Array.from({ length: 300 }, () => ({ type: 'pen', points: pts })) }), /Too many/);
});

// ------------------------------------------------ 1.12.0: the gallery
test('gallery: one entry per screenshot, the annotated copy attached only if the original names it', () => {
  const f = [
    { name: 'A.png', at: 1, bytes: 1 }, { name: 'A - annotated.png', at: 5, bytes: 2 },
    { name: 'B.png', at: 3, bytes: 1 }, { name: 'Z - annotated.png', at: 2, bytes: 1 },
    { name: 'C.png', at: 4, bytes: 1 }, { name: 'C - annotated.png', at: 3.5, bytes: 1 },
  ];
  const g = C.groupShots(f, (n) => (n === 'A.png' ? 'A - annotated.png' : null));
  assert.deepEqual(g.map((x) => [x.name, x.copy && x.copy.name]), [
    ['A.png', 'A - annotated.png'],                    // ordered by the last change (the copy, at 5)
    ['C.png', null], ['C - annotated.png', null],      // C doesn't name it: the copy stays separate
    ['B.png', null], ['Z - annotated.png', null],      // no original: shows as a normal screenshot
  ]);
});

test('gallery: an old "X - adnotat.png" copy is grouped like a new one; an orphan old copy shows on its own', () => {
  const f = [
    { name: 'A.png', at: 1, bytes: 1 }, { name: 'A - adnotat.png', at: 5, bytes: 2 },
    { name: 'B.png', at: 3, bytes: 1 }, { name: 'B - annotated.png', at: 4, bytes: 2 },
    { name: 'Z - adnotat (2).png', at: 2, bytes: 1 },
  ];
  const out = { 'A.png': 'A - adnotat.png', 'B.png': 'B - annotated.png' };
  const g = C.groupShots(f, (n) => out[n] || null);
  assert.deepEqual(g.map((x) => [x.name, x.copy && x.copy.name]), [
    ['A.png', 'A - adnotat.png'], ['B.png', 'B - annotated.png'], ['Z - adnotat (2).png', null],
  ]);
});

test('images added from the PC: names cleaned for Windows, always .png, without the annotated-copy suffix', () => {
  assert.equal(C.importName('Screen capture: 2026/10.jpg'), 'Screen capture 2026 10.png');
  assert.equal(C.importName('pic - annotated (2).webp'), 'pic.png');
  assert.equal(C.importName('pic - adnotat (2).webp'), 'pic.png', 'the old suffix is removed too');
  assert.equal(C.importName('CON.png'), 'Imported image CON.png');
  assert.equal(C.importName(''), 'Imported image.png');
  assert.ok(C.isSafeShotName(C.importName('a<b>c|d?.gif')));
});

test('ScreenshotService: gallery, thumbnails (in memory and on disk), import, drag, delete together with the copy', async () => {
  const { svc, log } = world();
  await svc.startZone();
  const name = path.basename(await svc.finishZone({ x1: 0, y1: 0, x2: 100, y2: 100 }));
  const { name: copy } = await svc.exportAnnot(name, PNG, { items: [{ type: 'step', x: 5, y: 5 }] });
  const imported = await svc.importImage('Café.jpg', PNG);
  assert.equal(imported, 'Café.png');
  assert.equal(await svc.importImage('Café.jpg', PNG), 'Café (2).png', 'does not overwrite');
  await assert.rejects(svc.importImage('x.png', Buffer.from('no')), /valid image/);
  await assert.rejects(svc.importImage('x.png', Buffer.concat([PNG_SIG, Buffer.alloc(80, 1)])), /valid image/);
  await assert.rejects(svc.importImage('x.png', pngOf(16384, 16384)), /too big/);
  await assert.rejects(svc.importImage('x.png', pngOf(8000, 8000)), /too big/, '64 MP > 50 MP');
  const all = await svc.all();
  assert.deepEqual(all.map((g) => [g.name, g.copy && g.copy.name]).sort(), [['Café (2).png', null], ['Café.png', null], [name, copy]].sort());
  // the thumbnail: made once, then from memory; after a restart (a new service) from the file on disk
  assert.equal((await svc.thumb(name)).toString(), `JPG:${name}`);
  await svc.thumb(name);
  assert.equal(log.filter((l) => l === `thumb:${name}`).length, 1);
  svc.thumbs.clear();
  await svc.thumb(name);
  assert.equal(log.filter((l) => l === `thumb:${name}`).length, 1, 'the second time it comes from disk');
  await assert.rejects(svc.thumb('..\\x.png'), /invalid/i);
  // dragging into another app gives the annotated copy, if any
  assert.equal(path.basename(svc.dragFile(name)), copy);
  assert.equal(path.basename(svc.dragFile(imported)), imported);
  // deleting from the gallery moves the copy to the Recycle Bin too
  assert.deepEqual(await svc.trashMany([name, name]), { moved: 2, failed: [], error: null });
  assert.deepEqual((await svc.all()).map((g) => g.name).sort(), ['Café (2).png', 'Café.png']);
  await assert.rejects(svc.trashMany(['..\\x.png']), /invalid/i);
});

// ------------------------------------------------ 1.14.0: the original of an annotated screenshot is not lost by mistake
test('original / copy pair and deleting: only the copy, only the original or both', async () => {
  const { svc } = world();
  await svc.startZone();
  const a = path.basename(await svc.finishZone({ x1: 0, y1: 0, x2: 100, y2: 100 }));
  const { name: aCopy } = await svc.exportAnnot(a, PNG, { items: [{ type: 'step', x: 5, y: 5 }] });
  // the pair shows from both ends; a screenshot without a copy has no pair
  assert.deepEqual(svc.pairOf(a), { original: a, copy: aCopy });
  assert.deepEqual(svc.pairOf(aCopy), { original: a, copy: aCopy });
  const plain = await svc.importImage('plain.png', PNG);
  assert.equal(svc.pairOf(plain), null);
  // gallery, "Keep originals": only the copy goes; a screenshot without a copy goes (it is its only version)
  assert.equal((await svc.trashMany([a, plain], 'copies')).moved, 2);
  assert.ok(fs.existsSync(path.join(svc.dir(), a)), 'the original stayed');
  assert.ok(!fs.existsSync(path.join(svc.dir(), aCopy)));
  assert.ok(!fs.existsSync(path.join(svc.dir(), plain)));
  assert.deepEqual((await svc.all()).map((g) => [g.name, g.copy]), [[a, null]], 'the original shows alone in the list again');
  await assert.rejects(svc.trashMany([a], 'something else'), /Invalid mode/);
  // the large window: a new copy, then I delete the original and keep the copy
  const { name: aCopy2 } = await svc.exportAnnot(a, PNG, { items: [{ type: 'step', x: 5, y: 5 }] });
  assert.equal(aCopy2, aCopy, 'the same copy, remade');
  await svc.trashWithPair(a, false);
  assert.ok(!fs.existsSync(path.join(svc.dir(), a)));
  assert.ok(fs.existsSync(path.join(svc.dir(), aCopy)), 'the copy stayed');
  assert.equal(svc.pairOf(aCopy), null, 'without the original, the copy is a normal screenshot');
  // both from the large window
  await svc.startZone();
  const b = path.basename(await svc.finishZone({ x1: 0, y1: 0, x2: 50, y2: 50 }));
  const { name: bCopy } = await svc.exportAnnot(b, PNG, { items: [{ type: 'step', x: 5, y: 5 }] });
  await svc.trashWithPair(bCopy, true);
  assert.ok(!fs.existsSync(path.join(svc.dir(), b)) && !fs.existsSync(path.join(svc.dir(), bCopy)));
});
