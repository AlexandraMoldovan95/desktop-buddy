'use strict';
// Recording rules (pure, tested functions): which window matches and how the file is named.
// A rule = "the window title contains …" (not case-sensitive).
// We don't use the app name: for Windows, any Python program (e.g. Note Organizer, Tkinter)
// shows up as "Python", so only the title says which window it is.

/** Our own windows are never recorded (it would be a loop: the app filming itself). */
const OWN_TITLE_RE = /desktop buddy/i;

const norm = (s) => String(s || '').toLocaleLowerCase('en-GB').replace(/\s+/g, ' ').trim();

/**
 * The first window that matches an active rule, in rule order.
 * @param {{ id: string, name: string }[]} sources  the open windows (desktopCapturer)
 * @param {{ id: string, title: string, enabled: boolean }[]} rules
 * @param {Set<string>} [skip]  windows stopped by hand (we don't restart on them until they close)
 */
function findMatch(sources, rules, skip = new Set()) {
  for (const rule of rules || []) {
    if (!rule || rule.enabled === false) continue;
    const needle = norm(rule.title);
    if (!needle) continue;
    const source = (sources || []).find((s) => s && s.name && !OWN_TITLE_RE.test(s.name) && !skip.has(s.id) && norm(s.name).includes(needle));
    if (source) return { rule, source };
  }
  return null;
}

/** The windows that can be picked by hand (without ours and without untitled ones). */
function pickable(sources) {
  return (sources || []).filter((s) => s && s.name && s.name.trim() && !OWN_TITLE_RE.test(s.name))
    .map((s) => ({ id: s.id, name: s.name }));
}

const pad = (n) => String(n).padStart(2, '0');
/** Windows device names; on Windows 10 also with an extension ("aux.js - Visual Studio Code" → AUX). */
const RESERVED_RE = /^(con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])(\.|\s*$)/i;
const isReservedName = (base) => RESERVED_RE.test(String(base).trim());
const LONE_SURROGATE_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
/** Cut to `max` characters without splitting an emoji (a split one breaks encodeURIComponent). */
const cut = (s, max) => Array.from(String(s).replace(LONE_SURROGATE_RE, '')).slice(0, max).join('');
/** The file name: "Note Organizer 2026-09-29 14-05-09.mp4", safe for Windows. */
function fileName(title, date, ext = 'mp4') {
  const base = String(title || 'Recording')
    // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')      // characters not allowed in Windows file names
    .replace(/\s+/g, ' ').trim();
  const base2 = cut(base, 60).replace(/[. ]+$/, '') || 'Recording';
  const safeBase = isReservedName(base2) ? `_${base2}` : base2;
  const d = date instanceof Date ? date : new Date(date);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `${safeBase} ${stamp}.${ext}`;
}

/** The recording format, in order of preference: MP4 (H.264), then WebM. */
const MIME_CANDIDATES = [
  ['video/mp4;codecs=avc1', 'mp4'],
  ['video/webm;codecs=vp9', 'webm'],
  ['video/webm;codecs=vp8', 'webm'],
  ['video/webm', 'webm'],
];

/** The maximum size and the bitrate by quality. */
function captureProfile(quality, fps, { lowPower = false } = {}) {
  const q = { 720: [1280, 720, 5], 1080: [1920, 1080, 8], 1440: [2560, 1440, 14] }[quality] || [1920, 1080, 8];
  const f = fps === 60 ? 60 : fps === 15 ? 15 : 30;
  // low-power mode: 20 % lower bitrate (smaller files, lighter on an HDD)
  const k = (f === 60 ? 1.5 : f === 15 ? 0.7 : 1) * (lowPower ? 0.8 : 1);
  return { maxWidth: q[0], maxHeight: q[1], fps: f, bitsPerSecond: Math.round(q[2] * 1e6 * k) };
}

module.exports = { findMatch, pickable, fileName, isReservedName, cut, captureProfile, MIME_CANDIDATES, OWN_TITLE_RE };
