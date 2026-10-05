'use strict';
// M1: deny-by-default permissions on every session, spellchecker off everywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/main/permissions');
const { BLOCKED_DICTIONARY_URL } = require('../src/main/context-menu');

function fakeSession() {
  const s = { calls: {} };
  for (const m of ['setPermissionRequestHandler', 'setPermissionCheckHandler', 'setDevicePermissionHandler', 'setSpellCheckerEnabled', 'setSpellCheckerDictionaryDownloadURL']) {
    s[m] = (v) => { s.calls[m] = v; };
  }
  return s;
}
const page = 'file:///app/src/renderer/panel/index.html';
const wc = { isDestroyed: () => false, getURL: () => page };
const ask = (ses, perm, url = page) => new Promise((r) => ses.calls.setPermissionRequestHandler(wc, perm, r, { requestingUrl: url }));

test('default session: only fullscreen; geolocation, camera, mic, clipboard-read, notifications, midi refused', async () => {
  const ses = fakeSession();
  P.harden(ses, 'default');
  assert.equal(await ask(ses, 'fullscreen'), true);
  for (const perm of ['geolocation', 'media', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write', 'notifications', 'midi', 'midiSysex', 'openExternal', 'pointerLock', 'idle-detection', 'unknown']) {
    assert.equal(await ask(ses, perm), false, perm);
    assert.equal(ses.calls.setPermissionCheckHandler(wc, perm, 'file:///', { requestingUrl: page }), false, `check ${perm}`);
  }
  assert.equal(ses.calls.setDevicePermissionHandler({ deviceType: 'usb' }), false);
  assert.equal(ses.calls.setSpellCheckerEnabled, false);
  assert.equal(ses.calls.setSpellCheckerDictionaryDownloadURL, BLOCKED_DICTIONARY_URL);
});

test('recorder / shot sessions: only screen capture, and only for our file:// pages', async () => {
  for (const kind of ['recorder', 'shot']) {
    const ses = fakeSession();
    P.harden(ses, kind);
    assert.equal(await ask(ses, 'media'), true);
    assert.equal(await ask(ses, 'display-capture'), true);
    assert.equal(await ask(ses, 'media', 'https://example.com/'), false, 'not from a remote page');
    assert.equal(await ask(ses, 'geolocation'), false);
    assert.equal(await ask(ses, 'fullscreen'), false);
    assert.equal(ses.calls.setSpellCheckerEnabled, false);
  }
});

test('any other session gets nothing', async () => {
  const ses = fakeSession();
  P.harden(ses, 'other');
  for (const perm of ['fullscreen', 'media', 'geolocation']) assert.equal(await ask(ses, perm), false);
});

test('hardenAll covers default, recorder, shot and sessions created later', () => {
  const made = {};
  const session = { defaultSession: fakeSession(), fromPartition: (p) => (made[p] = made[p] || fakeSession()) };
  let created;
  const app = { on: (ev, fn) => { assert.equal(ev, 'session-created'); created = fn; } };
  P.hardenAll({ app, session });
  for (const s of [session.defaultSession, made.recorder, made.shot]) assert.ok(s.calls.setPermissionRequestHandler);
  const later = fakeSession();
  created(later);
  assert.equal(later.calls.setSpellCheckerEnabled, false);
  created(made.recorder); // already hardened: kept as 'recorder', not downgraded
  assert.equal(P.allowed('recorder', 'media', page), true);
});
