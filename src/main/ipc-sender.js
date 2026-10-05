'use strict';
// Who may call IPC: only the top frame of our windows, showing one of our own pages from src/renderer.

const path = require('path');
const { fileURLToPath } = require('url');

const RENDERER = path.join(__dirname, '..', 'renderer');

/** True if `url` is a file:// page inside the renderer folder (no other local file, no remote page). */
function isOurPage(url, rendererDir = RENDERER, pathLib = path) {
  if (typeof url !== 'string' || !url.startsWith('file://')) return false;
  let file;
  try { file = fileURLToPath(url.split(/[?#]/)[0], { windows: pathLib === path.win32 }); } catch { return false; } // malformed URL = not ours
  const win = pathLib === path.win32;
  const rel = pathLib.relative(win ? rendererDir.toLowerCase() : rendererDir, win ? file.toLowerCase() : file);
  return !!rel && !rel.startsWith('..') && !pathLib.isAbsolute(rel) && /\.html$/i.test(rel);
}

/** The IPC event comes from the top frame (not an iframe) of a page of ours. */
function isTrustedFrame(frame) {
  return !!frame && !frame.parent && isOurPage(frame.url);
}

module.exports = { isOurPage, isTrustedFrame, RENDERER };
