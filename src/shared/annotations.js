'use strict';
// Annotations on screenshots (1.11.0): the data model and geometry, no DOM (page + main + tests).
//
// A document = { version: 1, crop: {x,y,w,h}|null, output: 'name - annotated.png'|null, items: [...] }.
// All coordinates are in IMAGE PIXELS (not screen pixels), so they do not depend on zoom or Windows scaling.
// The original never changes: "Save copy" writes the annotated image to `output`, and the document
// stays editable (main keeps it in the app's data folder).
//
// Types: pen, marker (transparent), line, arrow, rect, ellipse, text, bubble (speech bubble with a tail),
// note (sticky note), step (numbered step: the number comes from the order), blur (pixelate).
(function (root) {
  const TYPES = ['pen', 'marker', 'line', 'arrow', 'rect', 'ellipse', 'text', 'bubble', 'note', 'step', 'blur'];
  // red, orange, yellow, green, blue, purple, black, white
  const COLORS = ['#E5383B', '#F28C28', '#F5C518', '#2BA84A', '#2F6FED', '#7A3FE0', '#1E1B2A', '#FFFFFF'];
  const SIZES = { s: 0.7, m: 1, l: 1.6 };
  const LIMITS = { items: 500, points: 4000, text: 2000, coordFactor: 2 };
  const ZOOM_MIN = 0.05;
  const ZOOM_MAX = 8;
  const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
  const INK = '#1E1B2A';

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isHex = (c) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  let seq = 0;
  const newId = () => `a${Date.now().toString(36)}${(seq++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`.slice(0, 24);

  /** Default thickness / size: proportional to the image (a 4K capture needs thicker lines). */
  const scaleK = (W, H) => clamp(Math.max(W, H) / 1400, 1, 3);

  function defaults(type, W, H, size = 'm') {
    const k = scaleK(W, H) * (SIZES[size] || 1);
    const r = (v) => Math.round(v * k * 10) / 10;
    switch (type) {
      case 'pen': return { width: r(4) };
      case 'marker': return { width: r(18) };
      case 'line': case 'arrow': case 'rect': case 'ellipse': return { width: r(4) };
      case 'text': return { size: r(24) };
      case 'bubble': return { size: r(18), w: r(240), h: r(64) };
      case 'note': return { size: r(18), w: r(210), h: r(110) };
      case 'step': return { r: r(16) };
      default: return {};
    }
  }

  // ------------------------------------------------ validation (anything coming from a file or a page)
  function cleanText(t) {
    return String(typeof t === 'string' ? t : '')
      .replace(/\r\n?/g, '\n')
      // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .slice(0, LIMITS.text);
  }

  function normalizeItem(raw, W, H, i = 0) {
    if (!raw || typeof raw !== 'object' || !TYPES.includes(raw.type)) return null;
    const lo = -W * LIMITS.coordFactor;
    const hiX = W * (1 + LIMITS.coordFactor);
    const loY = -H * LIMITS.coordFactor;
    const hiY = H * (1 + LIMITS.coordFactor);
    const nx = (v, d = 0) => (Number.isFinite(+v) ? clamp(+v, lo, hiX) : d);
    const ny = (v, d = 0) => (Number.isFinite(+v) ? clamp(+v, loY, hiY) : d);
    const n = (v, a, b, d) => (Number.isFinite(+v) ? clamp(+v, a, b) : d);
    const base = defaults(raw.type, W, H);
    const it = {
      id: typeof raw.id === 'string' && /^[a-z0-9]{1,24}$/i.test(raw.id) ? raw.id : `i${i}`,
      type: raw.type,
      color: isHex(raw.color) ? raw.color.toUpperCase() : COLORS[0],
    };
    const box = () => {
      let x = nx(raw.x); let y = ny(raw.y); let w = n(raw.w, -W * 3, W * 3, 0); let h = n(raw.h, -H * 3, H * 3, 0);
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      Object.assign(it, { x, y, w: Math.max(1, w), h: Math.max(1, h) });
    };
    switch (raw.type) {
      case 'pen': case 'marker': {
        const pts = (Array.isArray(raw.points) ? raw.points : [])
          .filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]))
          .slice(0, LIMITS.points)
          .map((p) => [Math.round(nx(p[0]) * 10) / 10, Math.round(ny(p[1]) * 10) / 10]);
        if (!pts.length) return null;
        it.points = pts;
        it.width = n(raw.width, 1, 300, base.width);
        break;
      }
      case 'line': case 'arrow':
        Object.assign(it, { x1: nx(raw.x1), y1: ny(raw.y1), x2: nx(raw.x2), y2: ny(raw.y2), width: n(raw.width, 1, 200, base.width) });
        break;
      case 'rect': case 'ellipse':
        box();
        it.width = n(raw.width, 1, 200, base.width);
        break;
      case 'blur':
        box();
        break;
      case 'text':
        it.x = nx(raw.x); it.y = ny(raw.y);
        it.text = cleanText(raw.text);
        it.size = n(raw.size, 6, 400, base.size);
        it.w = n(raw.w, 0, W * 4, 0);
        it.h = n(raw.h, 0, H * 4, 0);
        if (!it.text.trim()) return null;
        break;
      case 'bubble': case 'note':
        box();
        it.text = cleanText(raw.text);
        it.size = n(raw.size, 6, 400, base.size);
        if (raw.type === 'bubble') { it.tx = nx(raw.tx, it.x); it.ty = ny(raw.ty, it.y + it.h + 40); }
        break;
      case 'step':
        it.x = nx(raw.x); it.y = ny(raw.y);
        it.r = n(raw.r, 4, 200, base.r);
        break;
      default: return null;
    }
    return it;
  }

  function normalizeCrop(c, W, H) {
    if (!c || typeof c !== 'object') return null;
    const v = ['x', 'y', 'w', 'h'].map((k) => +c[k]);
    if (!v.every(Number.isFinite)) return null;
    let [x, y, w, h] = v;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    const x1 = clamp(Math.round(x), 0, W);
    const y1 = clamp(Math.round(y), 0, H);
    const x2 = clamp(Math.round(x + w), 0, W);
    const y2 = clamp(Math.round(y + h), 0, H);
    if (x2 - x1 < 8 || y2 - y1 < 8) return null;
    if (x1 === 0 && y1 === 0 && x2 === W && y2 === H) return null;   // the whole image = no crop
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  /** A valid document from anything (broken file, page, old version). `isSafeName` checks the copy's name. */
  function normalizeDoc(raw, W, H, isSafeName = () => true) {
    const r = raw && typeof raw === 'object' ? raw : {};
    const items = [];
    const ids = new Set();
    for (const [i, x] of (Array.isArray(r.items) ? r.items : []).entries()) {
      if (items.length >= LIMITS.items) break;
      const it = normalizeItem(x, W, H, i);
      if (!it) continue;
      if (ids.has(it.id)) it.id = `${it.id.slice(0, 18)}d${i}`;
      ids.add(it.id);
      items.push(it);
    }
    const output = typeof r.output === 'string' && isSafeName(r.output) ? r.output : null;
    return { version: 1, crop: normalizeCrop(r.crop, W, H), output, items };
  }

  const isEmptyDoc = (d) => !d || (!d.items.length && !d.crop);

  // ------------------------------------------------ the copy's name
  // New copies end in " - annotated.png"; old ones (before the English pass) end in " - adnotat.png". Both are recognized.
  const ANNOT_RE = / - (?:annotated|adnotat)(?: \((\d+)\))?\.png$/i;
  /** "Screenshot 21-40-12.png" → "Screenshot 21-40-12 - annotated.png" (a copy of a copy does not add another suffix). */
  function annotatedName(name) {
    const base = String(name).replace(ANNOT_RE, '').replace(/\.png$/i, '');
    return `${base} - annotated.png`;
  }
  /** "X - annotated.png" / "X - annotated (2).png" / old "X - adnotat.png" → "X.png"; otherwise null. */
  function sourceOfAnnotated(name) {
    return ANNOT_RE.test(String(name)) ? `${String(name).replace(ANNOT_RE, '')}.png` : null;
  }

  // ------------------------------------------------ geometry
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = dx * dx + dy * dy;
    const t = len ? clamp(((px - x1) * dx + (py - y1) * dy) / len, 0, 1) : 0;
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  const pad = (it) => it.size * 0.6;
  const lineH = (it) => it.size * 1.3;

  /** Bubble: the box, the rounded corner and the tail (base points in outline order, clockwise). */
  function bubbleGeometry(b) {
    const box = { x: b.x, y: b.y, w: b.w, h: b.h };
    const r = Math.min(b.size * 0.8, box.w / 2, box.h / 2);
    const tip = { x: b.tx, y: b.ty };
    const inside = tip.x >= box.x && tip.x <= box.x + box.w && tip.y >= box.y && tip.y <= box.y + box.h;
    if (inside) return { box, r, tail: null };
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const dx = tip.x - cx;
    const dy = tip.y - cy;
    // the edge where the ray from the center to the tip leaves the box
    const sx = dx ? (box.w / 2) / Math.abs(dx) : Infinity;
    const sy = dy ? (box.h / 2) / Math.abs(dy) : Infinity;
    const edge = sx < sy ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'bottom' : 'top');
    const horizontal = edge === 'top' || edge === 'bottom';
    const len = horizontal ? box.w : box.h;
    const bw = Math.min(Math.max(b.size * 1.2, 10), Math.max(4, (len - 2 * r) * 0.8));
    const s = Math.min(sx, sy);
    let m = horizontal ? cx + dx * s : cy + dy * s;       // where the ray leaves, on the edge
    const lo = (horizontal ? box.x : box.y) + r + bw / 2;
    const hi = (horizontal ? box.x + box.w : box.y + box.h) - r - bw / 2;
    m = lo <= hi ? clamp(m, lo, hi) : (lo + hi) / 2;
    let a;
    let c;
    if (edge === 'top') { a = { x: m - bw / 2, y: box.y }; c = { x: m + bw / 2, y: box.y }; }
    else if (edge === 'bottom') { a = { x: m + bw / 2, y: box.y + box.h }; c = { x: m - bw / 2, y: box.y + box.h }; }
    else if (edge === 'right') { a = { x: box.x + box.w, y: m - bw / 2 }; c = { x: box.x + box.w, y: m + bw / 2 }; }
    else { a = { x: box.x, y: m + bw / 2 }; c = { x: box.x, y: m - bw / 2 }; }
    return { box, r, tail: { edge, a, tip, b: c } };
  }

  /** The rectangle around an item (in image pixels). */
  function boundsOf(it) {
    switch (it.type) {
      case 'pen': case 'marker': {
        const xs = it.points.map((p) => p[0]);
        const ys = it.points.map((p) => p[1]);
        const h = it.width / 2;
        return { x: Math.min(...xs) - h, y: Math.min(...ys) - h, w: Math.max(...xs) - Math.min(...xs) + it.width, h: Math.max(...ys) - Math.min(...ys) + it.width };
      }
      case 'line': case 'arrow': {
        const h = it.width * (it.type === 'arrow' ? 2.5 : 0.5);
        return { x: Math.min(it.x1, it.x2) - h, y: Math.min(it.y1, it.y2) - h, w: Math.abs(it.x2 - it.x1) + 2 * h, h: Math.abs(it.y2 - it.y1) + 2 * h };
      }
      case 'text': return { x: it.x, y: it.y, w: Math.max(it.w || 0, it.size), h: Math.max(it.h || 0, lineH(it)) };
      case 'step': return { x: it.x - it.r, y: it.y - it.r, w: 2 * it.r, h: 2 * it.r };
      case 'bubble': {
        const x1 = Math.min(it.x, it.tx); const y1 = Math.min(it.y, it.ty);
        const x2 = Math.max(it.x + it.w, it.tx); const y2 = Math.max(it.y + it.h, it.ty);
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      default: return { x: it.x, y: it.y, w: it.w, h: it.h };
    }
  }

  /** The item under the point (the top one wins) or -1. `tol` = tolerance, in image pixels. */
  function hitTest(items, x, y, tol = 6) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      let hit = false;
      switch (it.type) {
        case 'pen': case 'marker': {
          const lim = tol + it.width / 2;
          const p = it.points;
          if (p.length === 1) hit = Math.hypot(x - p[0][0], y - p[0][1]) <= lim;
          for (let k = 1; k < p.length && !hit; k++) hit = distToSeg(x, y, p[k - 1][0], p[k - 1][1], p[k][0], p[k][1]) <= lim;
          break;
        }
        case 'line': case 'arrow': hit = distToSeg(x, y, it.x1, it.y1, it.x2, it.y2) <= tol + it.width; break;
        case 'step': hit = Math.hypot(x - it.x, y - it.y) <= it.r + tol; break;
        case 'bubble': {
          hit = x >= it.x - tol && x <= it.x + it.w + tol && y >= it.y - tol && y <= it.y + it.h + tol;
          const g = bubbleGeometry(it);
          if (!hit && g.tail) hit = distToSeg(x, y, (g.tail.a.x + g.tail.b.x) / 2, (g.tail.a.y + g.tail.b.y) / 2, it.tx, it.ty) <= tol + it.size * 0.4;
          break;
        }
        default: {
          const b = boundsOf(it);
          hit = x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
        }
      }
      if (hit) return i;
    }
    return -1;
  }

  function moveItem(it, dx, dy) {
    const o = { ...it };
    switch (it.type) {
      case 'pen': case 'marker': o.points = it.points.map((p) => [p[0] + dx, p[1] + dy]); break;
      case 'line': case 'arrow': o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; break;
      case 'bubble': o.x += dx; o.y += dy; o.tx += dx; o.ty += dy; break;
      default: o.x += dx; o.y += dy;
    }
    return o;
  }

  /** An item's handles: line ends, box corners, the tail tip for a bubble. */
  function handlesOf(it) {
    switch (it.type) {
      case 'line': case 'arrow': return [{ key: 'p1', x: it.x1, y: it.y1 }, { key: 'p2', x: it.x2, y: it.y2 }];
      case 'rect': case 'ellipse': case 'blur': case 'note': case 'bubble': {
        const hs = [{ key: 'nw', x: it.x, y: it.y }, { key: 'ne', x: it.x + it.w, y: it.y }, { key: 'sw', x: it.x, y: it.y + it.h }, { key: 'se', x: it.x + it.w, y: it.y + it.h }];
        if (it.type === 'bubble') hs.push({ key: 'tail', x: it.tx, y: it.ty });
        return hs;
      }
      default: return [];
    }
  }

  /** Moves a handle to (x, y). The opposite corner stays put; the box never flips and never gets smaller than `min`. */
  function dragHandle(it, key, x, y, min = 8) {
    const o = { ...it };
    if (key === 'p1') { o.x1 = x; o.y1 = y; return o; }
    if (key === 'p2') { o.x2 = x; o.y2 = y; return o; }
    if (key === 'tail') { o.tx = x; o.ty = y; return o; }
    let x1 = it.x; let y1 = it.y; let x2 = it.x + it.w; let y2 = it.y + it.h;
    if (key.includes('w')) x1 = Math.min(x, x2 - min);
    if (key.includes('e')) x2 = Math.max(x, x1 + min);
    if (key.includes('n')) y1 = Math.min(y, y2 - min);
    if (key.includes('s')) y2 = Math.max(y, y1 + min);
    Object.assign(o, { x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
    return o;
  }

  /** Step numbers, in the order they were added: { id → 1, 2, 3… }. */
  function stepNumbers(items) {
    const m = new Map();
    let k = 0;
    for (const it of items) if (it.type === 'step') m.set(it.id, ++k);
    return m;
  }

  /** Fewer points for a freehand drawing (skips points closer than `minDist`); the first and last stay. */
  function simplify(points, minDist = 1.5) {
    if (points.length <= 2) return points.slice();
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const l = out[out.length - 1];
      if (Math.hypot(points[i][0] - l[0], points[i][1] - l[1]) >= minDist) out.push(points[i]);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  /**
   * Splits the text into lines that fit in `maxW` (by words; a word that is too long breaks by letters).
   * `measure(s)` = the text width (in the page: ctx.measureText). Empty lines stay.
   */
  function wrapLines(text, maxW, measure) {
    const out = [];
    for (const para of String(text).split('\n')) {
      if (!para) { out.push(''); continue; }
      let line = '';
      for (const w of para.split(/(\s+)/).filter(Boolean)) {
        if (measure(line + w) <= maxW) { line += w; continue; }
        if (/^\s+$/.test(w)) { out.push(line); line = ''; continue; }   // the line breaks at a space
        if (line.trim()) out.push(line.replace(/\s+$/, ''));
        line = '';
        if (measure(w) <= maxW) { line = w; continue; }
        for (const ch of w) {                                        // a word longer than the line: by letters
          if (line && measure(line + ch) > maxW) { out.push(line); line = ''; }
          line += ch;
        }
      }
      out.push(line.replace(/\s+$/, ''));
    }
    return out;
  }

  /** Size of the blur "pixels": big enough that the text under them can no longer be read. */
  const pixelBlock = (w, h) => clamp(Math.round(Math.max(w, h) / 14), 8, 40);

  /** Background color of a note: the chosen color, much lighter (yellow → pale yellow). */
  function noteFill(color) {
    const c = isHex(color) ? color : COLORS[2];
    const mix = (i) => Math.round(parseInt(c.slice(i, i + 2), 16) * 0.38 + 255 * 0.62);
    return `#${[1, 3, 5].map((i) => mix(i).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
  }
  /** Text / outline color that shows on a color (white on dark, dark on light). */
  function contrastOn(color) {
    const c = isHex(color) ? color : '#000000';
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return lum > 0.6 ? INK : '#FFFFFF';
  }

  // ------------------------------------------------ zoom
  const clampZoom = (z) => clamp(Number.isFinite(z) ? z : 1, ZOOM_MIN, ZOOM_MAX);
  /** The next zoom step up (+1) or down (-1), from the fixed list (100 % is always a step). */
  function stepZoom(z, dir) {
    const eps = 1e-6;
    if (dir > 0) return ZOOM_STEPS.find((s) => s > z + eps) || ZOOM_MAX;
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) if (ZOOM_STEPS[i] < z - eps) return ZOOM_STEPS[i];
    return ZOOM_MIN;
  }
  /** "Fit": the whole image in the given space, never enlarged above 100 %. Widths are in screen (device) pixels. */
  const fitZoom = (W, H, availW, availH) => clampZoom(Math.min(1, availW / W, availH / H));

  // ------------------------------------------------ right-click menu (1.13.0)
  const TYPE_LABELS = {
    pen: 'Drawing', marker: 'Marker', line: 'Line', arrow: 'Arrow', rect: 'Rectangle', ellipse: 'Ellipse',
    text: 'Text', bubble: 'Bubble', note: 'Note', step: 'Numbered step', blur: 'Blur',
  };
  /** A copy of the item, moved a little (so it shows), with a new id. */
  function duplicateItem(it, offset = 16) {
    return { ...moveItem(JSON.parse(JSON.stringify(it)), offset, offset), id: newId() };
  }
  /** Drawing order: "front" = above all, "back" = below all, "up" / "down" = one step. Returns a new list. */
  function reorder(items, id, where) {
    const i = items.findIndex((x) => x.id === id);
    if (i < 0) return items.slice();
    const out = items.slice();
    const [it] = out.splice(i, 1);
    const j = where === 'front' ? out.length : where === 'back' ? 0 : where === 'up' ? Math.min(out.length, i + 1) : Math.max(0, i - 1);
    out.splice(j, 0, it);
    return out;
  }
  /** What can be changed on an item from the menu (color, size, text). */
  const canColor = (it) => it.type !== 'blur';
  const canSize = (it) => it.type !== 'blur';
  const canText = (it) => ['text', 'bubble', 'note'].includes(it.type);

  const api = {
    TYPE_LABELS, duplicateItem, reorder, canColor, canSize, canText,
    TYPES, COLORS, SIZES, LIMITS, ZOOM_MIN, ZOOM_MAX, ZOOM_STEPS, INK,
    newId, scaleK, defaults, normalizeItem, normalizeCrop, normalizeDoc, isEmptyDoc, cleanText,
    annotatedName, sourceOfAnnotated, distToSeg, bubbleGeometry, boundsOf, hitTest, moveItem, handlesOf, dragHandle,
    stepNumbers, simplify, wrapLines, pixelBlock, noteFill, contrastOn, pad, lineH, clampZoom, stepZoom, fitZoom,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Annot = api;
})(typeof window !== 'undefined' ? window : globalThis);
