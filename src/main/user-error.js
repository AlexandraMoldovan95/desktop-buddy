'use strict';
// Turns any error into a short plain-English message for a page or a notification:
// no file paths, no user names, no raw English system text.

const BY_CODE = {
  ENOENT: 'The file or folder no longer exists.',
  EACCES: 'No permission to read or write there.',
  EPERM: 'No permission to read or write there (maybe an antivirus or a read-only file).',
  EBUSY: 'The file is used by another program. Try again in a moment.',
  ENOSPC: 'The disk is full.',
  EROFS: 'The chosen place is read-only.',
  EIO: 'Disk read / write error.',
  EMFILE: 'Too many open files. Try again.',
  ENOTDIR: 'The chosen path is not a folder.',
  EISDIR: 'The chosen path is a folder, not a file.',
  EEXIST: 'A file with this name already exists.',
  ETIMEDOUT: 'It took too long. Try again.',
};

const ELECTRON_PREFIX = /^Error invoking remote method '[^']+': (?:Error: )?/;
const PATH_RE = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s'"`]+)+[\\/]?/g;
// A plain Error with no system code is one our code threw on purpose, in plain English, for the user.
// System errors (code / errno / syscall) and TypeError & co. are internal: mapped or replaced.
const isOurs = (err) => typeof err === 'object' && err.name === 'Error' && !err.code && err.errno === undefined && !err.syscall;

/**
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
function userMessage(err, fallback = 'Something went wrong. Try again.') {
  if (!err) return fallback;
  const code = typeof err === 'object' && err.code;
  if (code && BY_CODE[code]) return BY_CODE[code];
  let msg = (typeof err === 'object' ? err.message : String(err)) || '';
  msg = String(msg).replace(ELECTRON_PREFIX, '').trim();
  if (!msg || (typeof err === 'object' && !isOurs(err))) return fallback;
  msg = msg.replace(/(['"])[^'"]*[\\/][^'"]*\1/g, '').replace(PATH_RE, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,:;])/g, '$1').trim();
  if (msg.length > 200) msg = msg.slice(0, 197).trimEnd() + '…';
  return msg || fallback;
}

// what each data file holds, for the notices below
const FILE_LABEL = {
  'notes.json': 'Notes',
  'settings.json': 'Settings',
  'clipboard.json': 'Copied history',
  'active-session.json': 'Current session',
  'recordings.json': 'Recordings list',
};
const fileLabel = (name) => FILE_LABEL[name] || (/^\d{4}-\d{2}-\d{2}\.json$/.test(name) ? 'Session history' : 'App data');

/**
 * A notification for a data-file problem reported by JsonStore (see store.js).
 * @param {'unreadable'|'recovered'|'reset'|'save-failed'} kind
 * @param {string} fileName  base name only
 * @returns {{ title: string, body: string } | null}
 */
function storeNotice(kind, fileName) {
  const what = fileLabel(fileName);
  switch (kind) {
    case 'unreadable': return { title: `${what}: can't read the file`, body: 'Another program is locking it (antivirus, sync). I won\'t write over it until you restart the app, so nothing is lost.' };
    case 'recovered': return { title: `${what}: restored from the backup copy`, body: 'The file was damaged (usually after a sudden shutdown). I also kept the damaged file, set aside.' };
    case 'reset': return { title: `${what}: the file was damaged`, body: 'I set it aside and started fresh.' };
    case 'save-failed': return { title: `${what}: can't save to disk`, body: 'I\'ll keep trying by myself. Check that the disk has free space.' };
    default: return null;
  }
}

/** A short reason for a store that cannot save right now, or null when it is fine. */
function storeIssue(store, what) {
  if (!store) return null;
  if (store.readOnly) return `${what} can't be saved: the file couldn't be read at startup. Restart the app.`;
  if (store.lastError) return `${what} can't be saved to disk: ${userMessage(store.lastError, 'write error.')}`;
  return null;
}

module.exports = { userMessage, storeNotice, storeIssue, BY_CODE };
