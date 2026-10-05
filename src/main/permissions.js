'use strict';
// Deny-by-default web permissions on every session the app uses, and the spellchecker off everywhere.
// Notifications are shown from main (Electron Notification), so pages need no 'notifications' permission.

const { BLOCKED_DICTIONARY_URL } = require('./context-menu');

// What each session truly needs. Anything else (geolocation, camera, mic, clipboard-read, midi, ...) is refused.
const ALLOWED = {
  default: ['fullscreen'],                 // the large screenshot viewer (F11 / button)
  recorder: ['media', 'display-capture'],  // getDisplayMedia of the window chosen in main
  shot: ['media', 'display-capture'],      // one frame of the window chosen in main
};

const isOurPage = (url) => typeof url === 'string' && url.startsWith('file://');

/** Pure decision, testable without Electron. */
function allowed(kind, permission, url) {
  const list = ALLOWED[kind];
  return !!list && list.includes(permission) && isOurPage(url);
}

/** Applies the handlers to one session. `kind` = 'default' | 'recorder' | 'shot' | anything else (deny all). */
function harden(ses, kind, log = () => {}) {
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (wc && !wc.isDestroyed() ? wc.getURL() : '');
    const ok = allowed(kind, permission, url);
    if (!ok) log(`[permissions] refused "${permission}" (${kind})`);
    callback(ok);
  });
  ses.setPermissionCheckHandler((wc, permission, _origin, details) => {
    const url = (details && (details.requestingUrl || details.embeddingOrigin)) || (wc && !wc.isDestroyed() ? wc.getURL() : '');
    return allowed(kind, permission, url);
  });
  ses.setDevicePermissionHandler(() => false);
  ses.setSpellCheckerEnabled(false);
  ses.setSpellCheckerDictionaryDownloadURL(BLOCKED_DICTIONARY_URL);
}

/** Call once, right after app 'ready' and before any window is created. */
function hardenAll({ app, session }, log) {
  const done = new Set();
  const apply = (ses, kind) => { if (!done.has(ses)) { done.add(ses); harden(ses, kind, log); } };
  apply(session.defaultSession, 'default');
  apply(session.fromPartition('recorder'), 'recorder');
  apply(session.fromPartition('shot'), 'shot');
  // any other session created later (none today) gets no permissions at all
  app.on('session-created', (ses) => apply(ses, 'other'));
}

module.exports = { ALLOWED, allowed, harden, hardenAll };
