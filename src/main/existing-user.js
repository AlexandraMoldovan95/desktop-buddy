'use strict';
// r2 L2: a damaged or missing settings.json must not make a long-time user look new
// (simple mode + the first-run tour). Other data files / folders show the app was used before.

const path = require('path');

const USER_DATA = ['notes.json', 'clipboard.json', 'recordings.json', 'progress-totals.json', 'settings.json.bak',
  'notes.json.bak', 'clipboard.json.bak', 'recordings.json.bak', 'sessions', 'annotations'];

/** True when the data folder holds anything an earlier run wrote. */
function hasUserData(fs, dir) {
  return USER_DATA.some((name) => {
    try { return fs.existsSync(path.join(dir, name)); } catch { return false; }   // unreadable entry: try the next one
  });
}

/**
 * The settings to apply when settings.json started from defaults (missing, broken without a usable .bak, unreadable).
 * @returns {{uiMode: 'full', tourDone: true} | null}
 */
function existingUserPatch({ startedFresh, fs, dir }) {
  if (!startedFresh || !hasUserData(fs, dir)) return null;
  return { uiMode: 'full', tourDone: true };
}

module.exports = { hasUserData, existingUserPatch, USER_DATA };
