'use strict';
// The montage and MP4 export: shared rules (shared/montage.js), file names, ClipExporter. GIF export was removed in 1.6.0.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const M = require('../src/shared/montage');
const C = require('../src/main/recorder/clips');
const W = require('../src/main/recorder/web-embed');

test('saved montage: any value becomes a valid one (parts, fade, title)', () => {
  assert.deepEqual(M.normalizeMontage(null), { parts: [], fade: false, title: '' });
  const m = M.normalizeMontage({
    parts: [{ start: 1000, end: 5000 }, { start: 9000, end: 9100 }, { start: 'x', end: 2 }, { start: 8000, end: 3000 }, { start: 70000, end: 80000 }],
    fade: 'yes', title: '  Note\nOrganizer   test  '.repeat(10), gifSize: 'original',
  }, 60000);
  assert.deepEqual(m.parts, [{ start: 1000, end: 5000 }, { start: 3000, end: 8000 }], 'too short, broken and outside the video are dropped; reversed ends are swapped');
  assert.equal(m.fade, false);
  assert.equal(m.title.length, M.MAX_TITLE);
  assert.ok(!/\n/.test(m.title));
  assert.ok(!('gifSize' in m), 'montages saved in 1.4–1.5 lose their GIF field without errors');
  const many = M.normalizeMontage({ parts: Array.from({ length: 50 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 800 })) });
  assert.equal(many.parts.length, M.MAX_PARTS);
});

test('"all marks": overlapping ranges are merged, in order', () => {
  assert.deepEqual(M.mergeRanges([{ start: 20000, end: 35000 }, { start: 0, end: 12000 }, { start: 10000, end: 25000 }, { start: 50000, end: 60000 }]),
    [{ start: 0, end: 35000 }, { start: 50000, end: 60000 }]);
  assert.deepEqual(M.mergeRanges([{ start: 0, end: 5000 }, { start: 5000, end: 9000 }]), [{ start: 0, end: 9000 }], 'touching ones too');
  assert.deepEqual(M.mergeRanges([]), []);
});

test('fade: only between parts (and after the title), 0.3 s, never at the start or end of the montage', () => {
  const at = (i, u, extra = {}) => M.fadeAlpha({ i, u, partMs: 5000, count: 3, fade: true, hasTitle: false, ...extra });
  assert.equal(at(0, 0), 0, 'the first part starts clear');
  assert.equal(at(2, 5000), 0, 'the last one ends clear');
  assert.equal(at(0, 5000), 1, 'the end of the first part is black');
  assert.equal(at(1, 0), 1, 'the start of the second one is black');
  assert.equal(at(1, 150), 0.5);
  assert.equal(at(1, 2500), 0);
  assert.equal(at(0, 0, { hasTitle: true }), 1, 'after the title, the first part fades in from black');
  assert.equal(M.fadeAlpha({ i: 1, u: 0, partMs: 5000, count: 3, fade: false }), 0, 'no fade = a cut');
  assert.ok(M.fadeAlpha({ i: 1, u: 100, partMs: 400, count: 3, fade: true }) <= 1, 'short parts: the fade never goes past the half');
});

test('export check: MP4 only, 10 min max, title and fade only for a montage', () => {
  const one = M.checkExport({ parts: [{ start: 1000, end: 16000 }], format: 'mp4', title: 'no', fade: true }, 60000);
  assert.deepEqual(one, { format: 'mp4', kind: 'clip', parts: [{ start: 1000, end: 16000 }], title: '', fade: false, totalMs: 15000 });
  assert.equal(M.checkExport({ parts: [{ start: 0, end: 5000 }] }, 60000).format, 'mp4', 'no format = MP4');
  assert.throws(() => M.checkExport({ parts: [{ start: 0, end: 5000 }], format: 'gif' }, 60000), /MP4 only/, 'GIF was removed in 1.6.0');
  const mont = M.checkExport({ parts: [{ start: 0, end: 12000 }, { start: 30000, end: 38000 }], format: 'mp4', montage: true, title: 'Demo', fade: true }, 60000);
  assert.equal(mont.kind, 'montage');
  assert.equal(mont.fade, true);
  assert.equal(mont.totalMs, 20000 + M.TITLE_MS, 'the title counts in the length');
  assert.throws(() => M.checkExport({ parts: [], format: 'mp4' }), /Nothing to export/);
  assert.throws(() => M.checkExport({ parts: [{ start: 0, end: 100 }], format: 'mp4' }, 60000), /too short/);
  assert.throws(() => M.checkExport({ parts: Array.from({ length: 31 }, () => ({ start: 0, end: 1000 })), format: 'mp4' }), /At most 30/);
  assert.throws(() => M.checkExport({ parts: Array.from({ length: 3 }, () => ({ start: 0, end: 4 * 60000 })), format: 'mp4', montage: true }, 3600000), /too long/);
  assert.throws(() => M.checkExport('clip'), /Invalid/);
});

test('file names: the montage with the number of parts and the length', () => {
  const parent = path.join('C:', 'rec', 'Note Organizer 2026-09-29 16-08-55.mp4');
  assert.equal(path.basename(C.clipPath(parent, 34000, 49000, () => false)), 'Note Organizer 2026-09-29 16-08-55 - clip 0m34s-0m49s.mp4');
  assert.equal(path.basename(C.montagePath(parent, 3, 42500)), 'Note Organizer 2026-09-29 16-08-55 - montage 3 parts 0m42s.mp4');
  assert.equal(path.basename(C.montagePath(parent, 1, 9000)), 'Note Organizer 2026-09-29 16-08-55 - montage 1 part 0m09s.mp4');
  const taken = new Set([C.montagePath(parent, 3, 42500)]);
  assert.match(C.montagePath(parent, 3, 42500, (f) => taken.has(f)), / \(2\)\.mp4$/);
});

test('ClipExporter: an MP4 montage written to disk, with its kind and number of parts in the list; GIF refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mont-'));
  const parentFile = path.join(dir, 'Demo 2026-09-30 10-00-00.mp4');
  fs.writeFileSync(parentFile, 'x');
  const index = { data: { items: [] }, update(fn) { fn(this.data); } };
  const saved = [];
  const ex = new C.ClipExporter({ index, fs, onSaved: (it) => saved.push(it) });
  const parent = { id: 'p1', file: parentFile, label: 'Demo', activeMs: 60000 };
  const job = ex.begin(parent, { parts: [{ start: 1000, end: 6000 }, { start: 20000, end: 24000 }], format: 'mp4', montage: true, title: 'Demo' });
  assert.match(job.name, /montage 2 parts 0m10s\.mp4$/);
  assert.equal(job.totalMs, 9000 + M.TITLE_MS);
  assert.ok(!('gif' in job));
  ex.chunk(job.id, Buffer.from('fake-mp4'));
  const item = await ex.end(job.id, true);
  assert.equal(item.format, 'mp4');
  assert.equal(item.kind, 'montage');
  assert.equal(item.parts, 2);
  assert.equal(item.clipOf, 'p1');
  assert.match(item.label, /montage 2 parts/);
  assert.ok(!/GIF/.test(item.label));
  assert.ok(fs.existsSync(item.file));
  assert.equal(saved.length, 1);
  // the old form (start, end) = an MP4 clip
  const old = ex.begin(parent, 34000, 49000);
  assert.match(old.name, /clip 0m34s-0m49s\.mp4$/);
  assert.equal(await ex.end(old.id, false), null, 'cancelled = no file');
  assert.throws(() => ex.begin(parent, { parts: [{ start: 0, end: 5000 }], format: 'gif' }), /MP4 only/);
});

test('GIF is fully removed: no bundled encoder, no buttons in the editor', () => {
  const root = path.join(__dirname, '..', 'src');
  assert.ok(!fs.existsSync(path.join(root, 'renderer', 'vendor', 'gifenc.js')));
  const html = fs.readFileSync(path.join(root, 'renderer', 'editor', 'index.html'), 'utf8');
  assert.ok(!/gif/i.test(html), 'no GIF mention in the editor page');
  assert.match(html, /id="loopBtn"/, 'the loop button exists');
});

test('code for a website: a web-safe name and a <video> that loops by itself, no injected HTML', () => {
  assert.equal(W.slugify('Note Organizer — test 2026-10-01 15-03-03 - montage 3 parts 0m42s'), 'note-organizer-test-2026-10-01-15-03-03-montage-3-parts-0m42s');
  assert.equal(W.slugify('Café, Ölçek & ÉLAN'), 'cafe-olcek-elan');
  assert.equal(W.slugify('***'), 'clip');
  assert.ok(W.slugify('a'.repeat(200)).length <= 80);
  assert.equal(W.webFileName(path.join('C:', 'rec', 'clips', 'Demo · clip 0m02s-0m05s.mp4')), 'demo-clip-0m02s-0m05s.mp4');
  const code = W.embedSnippet({ fileName: 'demo-clip.mp4', width: 1281, height: 721, label: 'Demo "x" <script>' });
  const tag = code.split('\n')[1];
  assert.match(tag, /^<video src="videos\/demo-clip\.mp4" width="1280" height="720" autoplay loop muted playsinline/);
  assert.match(tag, /aria-label="Demo &quot;x&quot; &lt;script&gt;"/);
  assert.ok(!/<script>/.test(code));
  assert.match(code.split('\n')[0], /^<!-- .*videos\/ folder/);
  const noSize = W.embedSnippet({ fileName: 'a.mp4', width: 0, height: 99999 });
  assert.ok(!/width=/.test(noSize), 'no valid size: no width / height');
});
