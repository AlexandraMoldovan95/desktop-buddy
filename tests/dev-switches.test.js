'use strict';
// Development-only switches must never work in the installed app.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

test('BUDDY_DATA_DIR (demo data folder) is read only in development mode', () => {
  const reads = main.match(/process\.env\.BUDDY_DATA_DIR/g) || [];
  assert.equal(reads.length, 1, 'read in exactly one place');
  assert.match(main, /!app\.isPackaged && process\.env\.BUDDY_DATA_DIR/);
  assert.match(main, /path\.join\(app\.getPath\('appData'\), ID\.DATA_DIR\)/, 'the installed app keeps %APPDATA%');
});
