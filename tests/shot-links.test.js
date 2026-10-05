'use strict';
// L2: name-based screenshot APIs and buddy-media serve only regular files inside the folder (no links, no devices).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ScreenshotService } = require('../src/main/screenshots');
const media = require('../src/main/recorder/media');
const A = require('../src/shared/annotations');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shotlinks-'));
  const dir = path.join(root, 'Screenshots');
  fs.mkdirSync(dir);
  const secret = path.join(root, 'settings.json');
  fs.writeFileSync(secret, '{"emailPassEnc":"x"}');
  fs.writeFileSync(path.join(dir, 'ok.png'), PNG);
  fs.symlinkSync(secret, path.join(dir, 'link.png'));
  fs.linkSync(secret, path.join(dir, 'hard.png'));
  fs.mkdirSync(path.join(dir, 'folder.png'));
  const svc = new ScreenshotService({ fs, folder: () => root, annotDir: () => path.join(root, 'annotations') });
  return { root, dir, svc, secret };
}

test('fileOf accepts a regular file and refuses symlinks, hard links, folders and device names', () => {
  const { dir, svc } = setup();
  assert.equal(svc.fileOf('ok.png'), path.join(dir, 'ok.png'));
  for (const name of ['link.png', 'hard.png', 'folder.png', 'missing.png']) assert.throws(() => svc.fileOf(name), /no longer exists/, name);
  for (const name of ['NUL.png', 'com1.png', 'LPT9.PNG', 'con.x.png', '../settings.json', 'a/b.png']) assert.throws(() => svc.fileOf(name), /invalid/i, name);
});

test('drag-out: only a file whose real path is inside the folder; a linked annotated copy falls back to the original', () => {
  const { root, dir, svc, secret } = setup();
  assert.equal(svc.dragFile('ok.png'), path.join(dir, 'ok.png'));
  assert.throws(() => svc.dragFile('link.png'));
  // the annotated copy recorded for ok.png is a link to a secret file
  fs.mkdirSync(path.join(root, 'annotations'), { recursive: true });
  const copy = A.annotatedName('ok.png');
  fs.symlinkSync(secret, path.join(dir, copy));
  fs.writeFileSync(svc.annotPath('ok.png'), JSON.stringify({ file: 'ok.png', doc: { output: copy } }));
  assert.equal(svc.annotOutputOf('ok.png'), copy, 'the linked copy is the recorded output');
  assert.equal(svc.dragFile('ok.png'), path.join(dir, 'ok.png'));
  assert.equal(svc.insideFolder(secret), false);
});

test('buddy-media file responses refuse symlinks', async () => {
  const { dir } = setup();
  assert.equal(media.fileResponse(path.join(dir, 'ok.png'), null).status, 200);
  assert.equal(media.fileResponse(path.join(dir, 'link.png'), null).status, 404);
  assert.equal(media.fileResponse(path.join(dir, 'folder.png'), null).status, 404);
});
