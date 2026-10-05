'use strict';
// Quick capture (1.8.0): the pure rules for screenshots and the quick note (tested, no Electron).
// Decisions: no global shortcuts; only buttons (right-click on the buddy, tray, Video tab), so nothing starts
// from the keyboard by accident. Screenshot = an area dragged with the mouse or a window picked from a list; PNG in "Screenshots".
const path = require('path');
const { fileName, isReservedName, cut } = require('./recorder/rules');

const SHOT_FOLDER = 'Screenshots';
const MIN_SIDE = 4;               // an area smaller than 4 × 4 px = a click, not a selection
const MAX_QUICK_NOTE = 20000;

/** The dragged area (two corners, in pixels of the selection window) → { x, y, width, height } on screen, or null if too small. */
function normalizeRect(r, maxW, maxH) {
  if (!r || ![r.x1, r.y1, r.x2, r.y2].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  const x1 = Math.max(0, Math.min(maxW, Math.min(r.x1, r.x2)));
  const y1 = Math.max(0, Math.min(maxH, Math.min(r.y1, r.y2)));
  const x2 = Math.max(0, Math.min(maxW, Math.max(r.x1, r.x2)));
  const y2 = Math.max(0, Math.min(maxH, Math.max(r.y1, r.y2)));
  if (x2 - x1 < MIN_SIDE || y2 - y1 < MIN_SIDE) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Area in screen pixels (DIP, what the page sees) → real pixels of the captured image.
 * The scale comes from the image (e.g. 2560 px on a 1280 DIP screen = 2), so it works at 125 %, 150 %, 200 %.
 */
function toImageRect(rect, screenW, screenH, imgW, imgH) {
  const sx = imgW / screenW;
  const sy = imgH / screenH;
  const x = Math.max(0, Math.round(rect.x * sx));
  const y = Math.max(0, Math.round(rect.y * sy));
  const width = Math.max(1, Math.min(imgW - x, Math.round(rect.width * sx)));
  const height = Math.max(1, Math.min(imgH - y, Math.round(rect.height * sy)));
  return { x, y, width, height };
}

/** "Screenshot 2026-10-01 21-40-12.png" or "Note Organizer 2026-10-01 21-40-12.png" (window title, cleaned like recordings). */
function shotFileName(title, date = new Date()) {
  return fileName(title || 'Screenshot', date, 'png');
}

/** A file name that does not exist yet: "… (2).png", "… (3).png". */
function uniqueFile(dir, name, exists) {
  let file = path.join(dir, name);
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  for (let n = 2; exists(file) && n < 1000; n++) file = path.join(dir, `${base} (${n})${ext}`);
  return file;
}

/** A file asked for by a page (e.g. "open screenshot X") is accepted only if it is a PNG directly in the Screenshots folder. */
function isSafeShotName(name) {
  // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
  return typeof name === 'string' && name.length <= 200 && name === path.basename(name) && /\.png$/i.test(name) && !/[<>:"/\\|?*\x00-\x1f]/.test(name);
}

/** The quick note text: no trailing spaces; empty → null (nothing is saved). */
function quickNoteText(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/\s+$/, '').slice(0, MAX_QUICK_NOTE);
  return t.trim() ? t : null;
}

// ------------------------------------------------ gallery (1.12.0)
// Annotated copy: " - annotated.png" (old copies: " - adnotat.png"; both are recognized so existing pairs keep working).
const ANNOT_RE = / - (?:annotated|adnotat)(?: \((\d+)\))?\.png$/i;

/**
 * One entry per screenshot: the original with its annotated copy attached (the copy is not listed separately).
 * A copy "X - annotated.png" is attached only if the original exists and its document names it (`outputOf(original)`);
 * otherwise (a copy left without its original, a file renamed by hand) it shows as a normal screenshot.
 * @param {{name:string, at:number, bytes:number}[]} files
 * @param {(source:string) => string|null} outputOf
 * @returns {{name, at, bytes, copy: {name, at, bytes}|null}[]} newest first (by the last change of the original or the copy)
 */
function groupShots(files, outputOf) {
  const byName = new Map(files.map((f) => [f.name, f]));
  const attached = new Set();
  const groups = [];
  for (const f of files) {
    if (ANNOT_RE.test(f.name)) continue;
    const out = outputOf(f.name);
    const copy = out && out !== f.name && byName.get(out);
    if (copy) attached.add(copy.name);
    groups.push({ name: f.name, at: f.at, bytes: f.bytes, copy: copy ? { name: copy.name, at: copy.at, bytes: copy.bytes } : null });
  }
  for (const f of files) {
    if (ANNOT_RE.test(f.name) && !attached.has(f.name)) groups.push({ name: f.name, at: f.at, bytes: f.bytes, copy: null });
  }
  const last = (g) => Math.max(g.at, g.copy ? g.copy.at : 0);
  return groups.sort((a, b) => last(b) - last(a) || a.name.localeCompare(b.name));
}

/** The name of an image added from the PC: its name, cleaned for Windows, always .png (the page converts it). */
function importName(original) {
  const base = String(original || '').replace(/\.[a-z0-9]{1,5}$/i, '').replace(/ - (?:annotated|adnotat)(?: \(\d+\))?$/i, '')
    // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  const base2 = cut(base, 80).replace(/[. ]+$/, '');
  const safe = !base2 || isReservedName(base2) ? `Imported image${base2 ? ` ${base2}` : ''}` : base2;
  return `${safe}.png`;
}

module.exports = { SHOT_FOLDER, MIN_SIDE, MAX_QUICK_NOTE, normalizeRect, toImageRect, shotFileName, uniqueFile, isSafeShotName, quickNoteText, groupShots, importName };
