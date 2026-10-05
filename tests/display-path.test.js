'use strict';
// L1: pages get a short folder label, never a full path (no Windows user name in screenshots).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { shortPath } = require('../src/main/display-path');
const { withDefaults, publicView } = require('../src/shared/settings-schema');

const W = path.win32;
const HOME = 'C:\\Users\\ana';

test('short labels hide the user folder', () => {
  assert.equal(shortPath('C:\\Users\\ana\\Videos\\Desktop Buddy Portfolio', HOME, W), '…\\Videos\\Desktop Buddy Portfolio');
  assert.equal(shortPath('c:\\users\\ANA\\Documents\\Tests\\Video', HOME, W), '…\\Tests\\Video');
  assert.equal(shortPath('C:\\Users\\ana\\Videos', HOME, W), '…\\Videos');
  assert.equal(shortPath('C:\\Users\\ana\\', HOME, W), 'Your home folder');
  assert.equal(shortPath('D:\\Récordings', HOME, W), 'D:\\Récordings');
  assert.equal(shortPath('D:\\Work\\Projects\\Game', HOME, W), '…\\Projects\\Game');
  assert.equal(shortPath('\\\\server\\share\\Users\\ana\\rec', HOME, W), '…\\ana\\rec');
  assert.equal(shortPath('/home/ana/Videos/Desktop Buddy Portfolio', '/home/ana', path.posix), '…/Videos/Desktop Buddy Portfolio');
  assert.equal(shortPath('', HOME, W), '');
  for (const p of ['C:\\Users\\ana\\Videos\\X', 'C:\\Users\\ana\\a\\b\\c']) assert.equal(shortPath(p, HOME, W).includes('ana'), false, p);
});

test('settings sent to pages carry no folder paths', () => {
  const view = publicView(withDefaults({ recFolder: 'C:\\Users\\ana\\Videos\\Rec' }));
  assert.equal('recFolder' in view, false);
  assert.equal(JSON.stringify(view).includes('Users'), false);
});

test('ipc.js sends labels, not paths', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/main/ipc.js'), 'utf8');
  assert.doesNotMatch(src, /dataFolder/);
  const folder = src.slice(src.indexOf("handle('recorder:folder'"), src.indexOf('\n', src.indexOf("handle('recorder:folder'")));
  assert.match(folder, /label: shortPath\(/);
  assert.doesNotMatch(folder, /path:/);
  const main = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.doesNotMatch(main, /return r\.filePaths\[0\]/, 'choose-folder must not return the path to the page');
});
