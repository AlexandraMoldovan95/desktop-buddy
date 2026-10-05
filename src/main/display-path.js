'use strict';
// Pages never receive full paths: they get a short label for display only (no Windows user name).

const nodePath = require('path');

/**
 * "C:\Users\ana\Videos\Desktop Buddy Portfolio" → "…\Videos\Desktop Buddy Portfolio".
 * @param {string} p full path
 * @param {string} home the user's home folder (hidden from the label)
 * @param {object} [pathLib] path module (path.win32 in tests)
 */
function shortPath(p, home, pathLib = nodePath) {
  if (typeof p !== 'string' || !p) return '';
  const sep = pathLib.sep;
  const norm = pathLib.normalize(p).replace(/[\\/]+$/, '');
  const h = home ? pathLib.normalize(home).replace(/[\\/]+$/, '') : '';
  const same = (a, b) => (pathLib === nodePath.win32 || process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  let parts;
  if (h && same(norm, h)) return 'Your home folder';
  if (h && same(norm.slice(0, h.length + 1), h + sep)) {
    parts = norm.slice(h.length + 1).split(/[\\/]+/).filter(Boolean);
    return '…' + sep + parts.slice(-2).join(sep);
  }
  parts = norm.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) return norm;
  return '…' + sep + parts.slice(-2).join(sep);
}

module.exports = { shortPath };
