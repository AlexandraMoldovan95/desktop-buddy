'use strict';
// Marks come from a flag next to the buddy (and the panel / tray), not from a global shortcut (1.16.0).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../src/shared/settings-schema');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

test('no marks shortcut setting any more; an old saved value is dropped on load', () => {
  assert.equal('recMarkKey' in S.DEFAULTS, false);
  assert.equal('recMarkKey' in S.withDefaults({ uiMode: 'full', recMarkKey: 'F9' }), false);
  assert.equal('recMarkKey' in S.sanitizePatch({ recMarkKey: 'F9' }, S.DEFAULTS), false);
});

test('the main process registers only the panel shortcut', () => {
  const calls = read('src', 'main', 'main.js').match(/globalShortcut\.register\(/g) || [];
  assert.equal(calls.length, 1);
});

test('the buddy has a "Remember this moment" flag wired to buddy:mark', () => {
  assert.match(read('src', 'renderer', 'buddy', 'index.html'), /id="markFlag"[^>]*aria-label="Remember this moment"/);
  assert.match(read('src', 'renderer', 'buddy', 'buddy.js'), /markFlag'\)\.addEventListener\('click', \(\) => window\.buddy\.mark\(\)\)/);
  assert.match(read('src', 'preload', 'buddy.js'), /mark: \(\) => ipcRenderer\.send\('buddy:mark'\)/);
  assert.match(read('src', 'main', 'ipc.js'), /on\('buddy:mark'/);
});
