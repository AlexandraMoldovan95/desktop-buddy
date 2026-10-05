'use strict';
// Serves video files to the editor window through the "buddy-media://rec/<id>" protocol,
// with partial requests (Range), so the player can jump anywhere in the file.
// ONLY files from the recordings list are served (by id), never an arbitrary path.
// Since 1.10.0 also screenshots ("buddy-media://shot/<name>"), only from the Screenshots folder, by name.

const fs = require('fs');
const { Readable } = require('stream');

const SCHEME = 'buddy-media';

/** "bytes=100-199" → { start, end }; null = the whole file; false = impossible range (416). */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!m || (m[1] === '' && m[2] === '')) return false;
  let start;
  let end;
  if (m[1] === '') {                          // the last N bytes
    const n = Number(m[2]);
    if (!n) return false;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return false;
  return { start, end };
}

const TYPES = { mp4: 'video/mp4', webm: 'video/webm', png: 'image/png' };

/** The response for a file (or a 404 / 416 error). */
function fileResponse(file, rangeHeader) {
  let size;
  try {
    const st = fs.lstatSync(file); // lstat: a symlink / junction is not served (could point outside the folder)
    if (!st.isFile()) return new Response('Not found.', { status: 404 });
    size = st.size;
  } catch { return new Response('Not found.', { status: 404 }); }
  const ext = (file.split('.').pop() || '').toLowerCase();
  const base = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',         // without this the export canvas would be "tainted" and record nothing
    'Cache-Control': 'no-store',
  };
  const r = parseRange(rangeHeader, size);
  if (r === false) return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } });
  if (r === null) {
    return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...base, 'Content-Length': String(size) } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file, { start: r.start, end: r.end })), {
    status: 206,
    headers: { ...base, 'Content-Length': String(r.end - r.start + 1), 'Content-Range': `bytes ${r.start}-${r.end}/${size}` },
  });
}

const mediaUrl = (id) => `${SCHEME}://rec/${encodeURIComponent(id)}`;

/** The id from "buddy-media://rec/<id>" or null. */
function idFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== `${SCHEME}:` || u.hostname !== 'rec') return null;
    const id = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return /^[a-z0-9-]{3,64}$/i.test(id) ? id : null;
  } catch { return null; }
}

// screenshots (1.10.0): "buddy-media://shot/<name>". The name is then checked with isSafeShotName (only from the Screenshots folder).
// Thumbnails (1.12.0): "buddy-media://thumb/<name>?v=<date>" (small JPEG; `v` only so an old one doesn't stay in memory).
const shotUrl = (name) => `${SCHEME}://shot/${encodeURIComponent(name)}`;
const thumbUrl = (name, v = 0) => `${SCHEME}://thumb/${encodeURIComponent(name)}?v=${Math.round(v) || 0}`;

/** The name from "buddy-media://shot/<name>" (or the given host, e.g. "thumb") or null (another protocol / host / broken address). */
function shotNameFromUrl(url, host = 'shot') {
  try {
    const u = new URL(url);
    if (u.protocol !== `${SCHEME}:` || u.hostname !== host) return null;
    const name = decodeURIComponent(u.pathname.replace(/^\//, ''));
    return name || null;
  } catch { return null; }
}

module.exports = { SCHEME, parseRange, fileResponse, mediaUrl, idFromUrl, shotUrl, thumbUrl, shotNameFromUrl };
