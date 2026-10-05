'use strict';
// L5: IPC calls that a page could loop (import, export chunks, new notes) are bounded.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require('../src/main/limits');
const notesLib = require('../src/main/notes');
const { ClipExporter } = require('../src/main/recorder/clips');
const { ScreenshotService } = require('../src/main/screenshots');

test('rate limiter: max calls per window, then allowed again', () => {
  let t = 0;
  const r = L.rateLimiter({ max: 3, windowMs: 1000, now: () => t });
  assert.deepEqual([r.take(), r.take(), r.take(), r.take()], [true, true, true, false]);
  t = 1001;
  assert.equal(r.take(), true);
});

test('notes:create in a loop keeps at most a few empty notes; real notes are never dropped', () => {
  let notes = [{ id: 'a', body: 'text', createdAt: 1, updatedAt: 1 }, { id: 'b', body: '', remind: { at: 5, status: 'pending' }, createdAt: 1, updatedAt: 1 }];
  let last;
  for (let i = 0; i < 3000; i++) { const r = notesLib.addNewNote(notes, 100 + i); notes = r.notes; last = r.note; }
  assert.equal(notes[0].id, last.id, 'the new note is on top');
  assert.equal(notes.filter((n) => n.body === '' && !n.remind).length, notesLib.MAX_EMPTY_NOTES);
  assert.ok(notes.some((n) => n.id === 'a') && notes.some((n) => n.id === 'b'), 'notes with text or a reminder stay');
  // saving to a dropped empty note re-creates it (an editor that was still open does not lose text)
  const saved = notesLib.saveNote(notes, '11111111-1111-4111-8111-111111111111', 'hello');
  assert.equal(saved[0].body, 'hello');
});

test('export: bytes beyond the cap for the clip length are refused and the file is discarded', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'));
  const parentFile = path.join(dir, 'Demo.mp4');
  fs.writeFileSync(parentFile, 'x');
  const index = { data: { items: [] }, update(fn) { fn(this.data); } };
  const ex = new ClipExporter({ index, fs });
  const parent = { id: 'p1', file: parentFile, label: 'Demo', activeMs: 60000 };
  const job = ex.begin(parent, { parts: [{ start: 0, end: 5000 }], format: 'mp4' });
  const cap = L.exportByteCap(job.totalMs);
  assert.ok(cap > 5 * 3e6 * 2, 'a real 5 s export at the highest bitrate fits');
  assert.equal(ex.jobs.get(job.id).maxBytes, cap);
  ex.jobs.get(job.id).maxBytes = 4096; // small cap so the test writes little to disk
  for (let i = 0; i < 4; i++) ex.chunk(job.id, Buffer.alloc(2048));
  assert.equal(await ex.end(job.id, true), null);
  assert.deepEqual(fs.readdirSync(path.dirname(job.file)).filter((f) => f.endsWith('.part') || f === job.name), []);
  // a normal export still works
  const ok = ex.begin(parent, { parts: [{ start: 0, end: 5000 }], format: 'mp4' });
  ex.chunk(ok.id, Buffer.from('fake-mp4'));
  assert.ok(await ex.end(ok.id, true));
});

test('import refuses when the disk is almost full; unknown free space does not block', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-'));
  const ihdr = Buffer.alloc(17); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(10, 8); ihdr.writeUInt32BE(10, 12);
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), ihdr, Buffer.alloc(80)]);
  const img = { isEmpty: () => false, getSize: () => ({ width: 10, height: 10 }) };
  const mk = (statfs) => new ScreenshotService({ fs: { ...fs, promises: { ...fs.promises, statfs } }, folder: () => root, imageFromBuffer: () => img });
  await assert.rejects(mk(async () => ({ bavail: 10, bsize: 4096 })).importImage('a.png', png), /disk space/);
  assert.match(await mk(async () => ({ bavail: 1e9, bsize: 4096 })).importImage('a.png', png), /\.png$/);
  assert.match(await mk(async () => { throw Object.assign(new Error('x'), { code: 'ENOSYS' }); }).importImage('b.png', png), /\.png$/);
});

test('ipc.js rate-limits gallery:import', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
  const block = src.slice(src.indexOf("handle('gallery:import'"), src.indexOf("handle('gallery:import'") + 300);
  assert.match(block, /importLimit\.take\(\)/);
});
