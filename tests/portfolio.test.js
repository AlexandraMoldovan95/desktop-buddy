'use strict';
// Portfolio edition guards: its own identity, the purple default buddy, and the AI kept as an offline placeholder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? jsFiles(p) : /\.(js|html)$/.test(e.name) ? [p] : [];
  });
}

test('identity: Portfolio has an appId and data folder separate from the course version', () => {
  const pkg = require('../package.json');
  assert.equal(pkg.build.appId, 'ro.stepit.desktopbuddy.portfolio');
  assert.equal(pkg.build.nsis.allowToChangeInstallationDirectory, false, 'never installed into the project folder');
  assert.equal(pkg.author, 'Desktop Buddy');
});

test('the Portfolio buddy is purple by default', () => {
  const BL = require('../src/shared/buddy-look');
  assert.equal(BL.DEFAULT_LOOK.palette, 'lavender');
});

test('the AI assistant is removed: no tab, no IPC, no API key, no files', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/main/ai')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/shared/ai-models.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/renderer/panel/tabs/assistant.js')), false);
  const offenders = jsFiles(path.join(ROOT, 'src')).filter((f) => {
    const src = fs.readFileSync(f, 'utf8');
    return /notes:ai|note-agent|'ai:send'|secrets:set-api-key|secrets:clear-api-key|tab-assistant|ai-models/.test(src);
  });
  assert.deepEqual(offenders.map((f) => path.relative(ROOT, f)), []);
});
