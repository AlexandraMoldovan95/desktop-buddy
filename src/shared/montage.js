'use strict';
// The montage in the clip editor (Portfolio): rules shared by the page and the main process.
// Pure, tested functions: validating the saved montage, merging overlapping ranges, the fade between parts,
// checking an export. MP4 only: GIF export (1.4–1.5) was removed in 1.6.0, at the owner's request
// (app text did not stay readable, and MP4 is clearer and smaller).
(function (root) {
  const MIN_PART_MS = 500;
  const MAX_PART_MS = 10 * 60000;
  const MAX_TOTAL_MS = 10 * 60000;      // MP4: the whole montage, like a clip
  const MAX_PARTS = 30;
  const TITLE_MS = 1500;
  const FADE_MS = 300;
  const MAX_TITLE = 60;

  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  const oneLine = (s) => String(s || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  /** A valid range { start, end } (whole ms) or null. */
  function cleanPart(p, durationMs = Infinity) {
    if (!p || !num(p.start) || !num(p.end)) return null;
    const d = num(durationMs) && durationMs > 0 ? durationMs + 1000 : Infinity;   // one second of tolerance at the end
    const start = Math.max(0, Math.round(Math.min(p.start, p.end)));
    const end = Math.round(Math.max(p.start, p.end));
    if (end - start < MIN_PART_MS || end - start > MAX_PART_MS || start >= d) return null;
    return { start, end: Math.min(end, d) };
  }

  /** The montage saved for a recording: any value → a valid one. */
  function normalizeMontage(m, durationMs) {
    const src = m && typeof m === 'object' ? m : {};
    const parts = (Array.isArray(src.parts) ? src.parts : []).map((p) => cleanPart(p, durationMs)).filter(Boolean).slice(0, MAX_PARTS);
    return {
      parts,
      fade: src.fade === true,
      title: oneLine(src.title).slice(0, MAX_TITLE),
    };
  }

  /** Ranges in order, with overlapping (or touching) ones merged: "all marks" without repeated parts. */
  function mergeRanges(ranges) {
    const sorted = ranges.filter((r) => r && num(r.start) && num(r.end) && r.end > r.start).map((r) => ({ start: r.start, end: r.end })).sort((a, b) => a.start - b.start);
    const out = [];
    for (const r of sorted) {
      const last = out[out.length - 1];
      if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
      else out.push(r);
    }
    return out;
  }

  const partsMs = (parts) => parts.reduce((t, p) => t + (p.end - p.start), 0);
  /** Final length: the parts + the title (if any). */
  const totalMs = (parts, title = '') => partsMs(parts) + (oneLine(title) ? TITLE_MS : 0);

  /**
   * How black the frame is (0 = not at all, 1 = fully), with a 0.3 s fade between parts.
   * @param {number} i  the part index   @param {number} u  ms from the start of the part
   */
  function fadeAlpha({ i, u, partMs, count, fade, hasTitle }) {
    if (!fade) return 0;
    const fin = i > 0 || hasTitle ? Math.min(FADE_MS, partMs / 2) : 0;
    const fout = i < count - 1 ? Math.min(FADE_MS, partMs / 2) : 0;
    let a = 0;
    if (fin && u < fin) a = Math.max(a, 1 - u / fin);
    if (fout && u > partMs - fout) a = Math.max(a, (u - (partMs - fout)) / fout);
    return Math.min(1, Math.max(0, a));
  }

  /** Checks what the page asks for on export (main process). Throws a clear error if it is wrong. */
  function checkExport(spec, durationMs) {
    if (!spec || typeof spec !== 'object') throw new Error('Invalid export.');
    if (spec.format && spec.format !== 'mp4') throw new Error('MP4 only (GIF is no longer available).');
    const format = 'mp4';
    const raw = Array.isArray(spec.parts) ? spec.parts : [];
    if (!raw.length) throw new Error('Nothing to export.');
    if (raw.length > MAX_PARTS) throw new Error(`At most ${MAX_PARTS} parts in a montage.`);
    const parts = raw.map((p) => cleanPart(p, durationMs));
    if (parts.some((p) => !p)) throw new Error('A part is too short (at least half a second) or goes past the end of the recording.');
    const montage = spec.montage === true;
    const title = montage ? oneLine(spec.title).slice(0, MAX_TITLE) : '';
    const total = totalMs(parts, title);
    if (total > MAX_TOTAL_MS) throw new Error('The montage is too long (10 minutes max).');
    return {
      format,
      kind: montage ? 'montage' : 'clip',
      parts,
      title,
      fade: montage && spec.fade === true,
      totalMs: total,
    };
  }

  const api = {
    MIN_PART_MS, MAX_PART_MS, MAX_TOTAL_MS, MAX_PARTS, TITLE_MS, FADE_MS, MAX_TITLE,
    cleanPart, normalizeMontage, mergeRanges, partsMs, totalMs, fadeAlpha, checkExport,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Montage = api;
})(typeof window !== 'undefined' ? window : globalThis);
