'use strict';
// M2: the packaged build flips the Electron fuses (no run-as-node, no NODE_OPTIONS / --inspect, asar only + integrity).
const test = require('node:test');
const assert = require('node:assert/strict');
const pkg = require('../package.json');

test('electron-builder config hardens the Electron fuses', () => {
  assert.deepEqual(pkg.build.electronFuses, {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    enableCookieEncryption: true,
  });
  assert.notEqual(pkg.build.asar, false, 'asar must stay on (OnlyLoadAppFromAsar needs it)');
});
