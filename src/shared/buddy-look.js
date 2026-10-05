'use strict';
// What the buddy looks like: shape (since 1.9.0, see buddy-shapes.js), color, eyes, mouth, cheeks, hair and accessories.
// The same file runs in the main process (validating the setting) and in pages (drawing):
// in Node it is loaded with require, in a page it exposes window.BuddyLook.
// Everything is drawn with createElementNS (no innerHTML). The drawings are original and simple.
(function (root) {
  const SH = typeof module !== 'undefined' && module.exports ? require('./buddy-shapes') : root.BuddyShapes;
  const SHAPES = SH.SHAPES.map(({ id, label }) => ({ id, label }));
  // ------------------------------------------------ the options
  const PALETTES = [
    { id: 'lagoon', label: 'Turquoise', a: '#34D2C0', b: '#5B5BD6' },
    { id: 'lavender', label: 'Purple', a: '#B38CFF', b: '#7A3FE0' },
    { id: 'bubblegum', label: 'Pink', a: '#FFA3C8', b: '#E0457B' },
    { id: 'peach', label: 'Peach', a: '#FFC98A', b: '#F0733A' },
    { id: 'mint', label: 'Mint', a: '#9BEBA5', b: '#2E9E6A' },
    { id: 'sunny', label: 'Sun', a: '#FFE88A', b: '#F2A91E' },
    { id: 'sky', label: 'Sky', a: '#9BDCFF', b: '#3A7BF0' },
    { id: 'berry', label: 'Berry', a: '#F08BD8', b: '#8B3FC8' },
    // unlocked by levels (see src/shared/progression.js)
    { id: 'midnight', label: 'Midnight', a: '#7B86E6', b: '#1E2358' },
    { id: 'aurora', label: 'Aurora', a: '#6CF0CF', b: '#B35CF0' },
    { id: 'gold', label: 'Gold', a: '#FFE58A', b: '#D08A12' },
    { id: 'galaxy', label: 'Galaxy', a: '#F07AD6', b: '#2A2A8F' },
    // 1.9.0 (also by levels); `c` = a third color, in the middle
    { id: 'sunset', label: 'Sunset', a: '#FFC371', b: '#FF5F6D' },
    { id: 'ocean', label: 'Ocean', a: '#6FE7F2', b: '#1B4FD0' },
    { id: 'cherry', label: 'Cherry', a: '#FF9AAE', b: '#C8102E' },
    { id: 'latte', label: 'Latte', a: '#EBD3B5', b: '#8A5A3C' },
    { id: 'neon', label: 'Neon', a: '#C6FF4A', b: '#00BFD6' },
    { id: 'mono', label: 'Monochrome', a: '#E3E5EC', b: '#555869' },
    { id: 'rainbow', label: 'Rainbow', a: '#FF6B8B', c: '#FFD84A', b: '#4DA3FF' },
  ];
  const EYES = [
    { id: 'round', label: 'Round' },
    { id: 'small', label: 'Small' },
    { id: 'lashes', label: 'Lashes' },
    { id: 'sleepy', label: 'Sleepy' },
    { id: 'stars', label: 'Stars' },
    { id: 'hearts', label: 'Hearts' },        // level
    { id: 'catseye', label: 'Cat eyes' },       // 1.9.0, level
    { id: 'happy', label: 'Happy' },
    { id: 'wink', label: 'Wink' },
    { id: 'big', label: 'Big' },
  ];
  const MOUTHS = [
    { id: 'smile', label: 'Smile' },
    { id: 'wide', label: 'Wide' },
    { id: 'small', label: 'Small' },
    { id: 'cat', label: 'Kitty' },
    { id: 'tongue', label: 'Tongue' },
    { id: 'o', label: 'Surprised' },                 // 1.9.0, level
    { id: 'smirk', label: 'Smirk' },
    { id: 'teeth', label: 'Teeth' },
    { id: 'fang', label: 'Fang' },
    { id: 'mustache', label: 'Mustache' },
  ];
  const HAIRS = [
    { id: 'none', label: 'None' },
    { id: 'tuft', label: 'Tuft' },
    { id: 'curly', label: 'Curly' },
    { id: 'spiky', label: 'Spiky' },
    { id: 'bangs', label: 'Bangs' },
    { id: 'pigtails', label: 'Pigtails' },
    { id: 'bun', label: 'Bun' },                 // 1.9.0, level
    { id: 'mohawk', label: 'Mohawk' },
    { id: 'afro', label: 'Afro' },
    { id: 'wave', label: 'Wavy tuft' },
    { id: 'side', label: 'Side-swept' },
  ];
  const HAIR_COLORS = [
    { id: 'brown', label: 'Brown', c: '#7A4A2E' },
    { id: 'black', label: 'Black', c: '#2C2433' },
    { id: 'blonde', label: 'Blonde', c: '#F2C85E' },
    { id: 'ginger', label: 'Ginger', c: '#D9582B' },
    { id: 'pink', label: 'Pink', c: '#FF7EB6' },
    { id: 'blue', label: 'Blue', c: '#4F7DF3' },
    { id: 'silver', label: 'Silver', c: '#D9DBE6' },
  ];
  // slot: accessories in the same slot can't be worn together (picking one removes the other)
  const ACCESSORIES = [
    { id: 'glasses', label: 'Glasses', slot: 'face' },
    { id: 'bow', label: 'Bow', slot: 'side' },
    { id: 'flower', label: 'Flower', slot: 'side' },
    { id: 'hat', label: 'Top hat', slot: 'top' },
    { id: 'crown', label: 'Tiara', slot: 'top' },
    { id: 'beret', label: 'Beret', slot: 'top' },
    { id: 'headphones', label: 'Headphones', slot: 'top' },
    // unlocked by levels; "fx" = effects around the buddy (one at a time)
    { id: 'star', label: 'Star', slot: 'side' },
    { id: 'beanie', label: 'Beanie', slot: 'top' },
    { id: 'wizard', label: 'Wizard hat', slot: 'top' },
    { id: 'halo', label: 'Halo', slot: 'top' },
    { id: 'royal', label: 'Royal crown', slot: 'top' },
    { id: 'sparkles', label: 'Sparkles', slot: 'fx' },
    { id: 'glow', label: 'Glow', slot: 'fx' },
    // 1.9.0, also by levels; "neck" = at the neck
    { id: 'bowtie', label: 'Bow tie', slot: 'neck' },
    { id: 'sunglasses', label: 'Sunglasses', slot: 'face' },
    { id: 'scarf', label: 'Scarf', slot: 'neck' },
    { id: 'cowboy', label: 'Cowboy hat', slot: 'top' },
    { id: 'wreath', label: 'Flower wreath', slot: 'top' },
    { id: 'leaf', label: 'Leaf', slot: 'side' },
    { id: 'gaming', label: 'Gaming headset', slot: 'top' },
    { id: 'sleepmask', label: 'Sleep mask', slot: 'top' },
    { id: 'astronaut', label: 'Astronaut helmet', slot: 'top' },
    { id: 'fx-bubbles', label: 'Bubbles', slot: 'fx' },
    { id: 'fx-hearts', label: 'Hearts', slot: 'fx' },
    { id: 'fx-notes', label: 'Music notes', slot: 'fx' },
    { id: 'fx-snow', label: 'Snowflakes', slot: 'fx' },
    { id: 'fx-fireflies', label: 'Fireflies', slot: 'fx' },
    { id: 'rainbow-arc', label: 'Rainbow', slot: 'fx' },
  ];
  const SLOTS = ['face', 'side', 'top', 'neck', 'fx'];

  // Portfolio: the buddy is purple by default (the course version: 'lagoon', turquoise)
  const DEFAULT_LOOK = Object.freeze({
    shape: 'circle', palette: 'lavender', custom: '', eyes: 'round', mouth: 'smile', cheeks: true,
    hair: 'none', hairColor: 'brown', accessories: [],
  });

  const HEX_RE = /^#[0-9a-f]{6}$/i;
  const has = (list, id) => list.some((x) => x.id === id);

  /** Any value → a valid look (unknown fields are ignored, wrong ones go back to the default). */
  function normalizeLook(v) {
    const src = v && typeof v === 'object' ? v : {};
    const out = { ...DEFAULT_LOOK, accessories: [] };
    if (has(SHAPES, src.shape)) out.shape = src.shape;
    if (has(PALETTES, src.palette) || src.palette === 'custom') out.palette = src.palette;
    if (typeof src.custom === 'string' && HEX_RE.test(src.custom)) out.custom = src.custom.toUpperCase();
    if (out.palette === 'custom' && !out.custom) out.palette = DEFAULT_LOOK.palette;
    if (has(EYES, src.eyes)) out.eyes = src.eyes;
    if (has(MOUTHS, src.mouth)) out.mouth = src.mouth;
    if (typeof src.cheeks === 'boolean') out.cheeks = src.cheeks;
    if (has(HAIRS, src.hair)) out.hair = src.hair;
    if (has(HAIR_COLORS, src.hairColor)) out.hairColor = src.hairColor;
    const slots = new Set();
    for (const id of Array.isArray(src.accessories) ? src.accessories : []) {
      const a = ACCESSORIES.find((x) => x.id === id);
      if (!a || slots.has(a.slot)) continue;
      slots.add(a.slot);
      out.accessories.push(a.id);
    }
    return out;
  }

  /** Adds / removes an accessory; a new one in the same slot replaces the old one. */
  function toggleAccessory(look, id) {
    const a = ACCESSORIES.find((x) => x.id === id);
    if (!a) return look;
    const list = look.accessories.includes(id)
      ? look.accessories.filter((x) => x !== id)
      : [...look.accessories.filter((x) => ACCESSORIES.find((y) => y.id === x).slot !== a.slot), id];
    return { ...look, accessories: list };
  }

  /**
   * A random look (rng = Math.random or a fixed one, in tests).
   * `allow(kind, id)` removes what is not unlocked yet (kind: 'shape' | 'palette' | 'eyes' | 'mouth' | 'hair' | 'accessory').
   */
  function randomLook(rng = Math.random, allow = () => true) {
    const pick = (list) => list[Math.floor(rng() * list.length) % list.length].id;
    const acc = [];
    for (const slot of SLOTS) {
      const opts = ACCESSORIES.filter((x) => x.slot === slot && allow('accessory', x.id));
      if (opts.length && rng() < (slot === 'fx' || slot === 'neck' ? 0.25 : 0.4)) acc.push(pick(opts));
    }
    const of = (list, kind) => list.filter((x) => allow(kind, x.id));
    return normalizeLook({
      shape: rng() < 0.4 ? 'circle' : pick(of(SHAPES, 'shape')),
      palette: pick(of(PALETTES, 'palette')), eyes: pick(of(EYES, 'eyes')), mouth: pick(of(MOUTHS, 'mouth')), cheeks: rng() < 0.8,
      hair: rng() < 0.25 ? 'none' : pick(of(HAIRS, 'hair')), hairColor: pick(HAIR_COLORS), accessories: acc,
    });
  }

  // ------------------------------------------------ colors
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const mix = (h1, h2, t) => { const a = hexToRgb(h1); const b = hexToRgb(h2); return rgbToHex(a.map((v, i) => v + (b[i] - v) * t)); };
  function luminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  /** Body colors: the two ends of the gradient + the face color (dark or, on a dark body, light). */
  function colorsOf(look) {
    let a; let b;
    let c = null;
    if (look.palette === 'custom' && look.custom) { b = look.custom; a = mix(look.custom, '#FFFFFF', 0.42); }
    else { const p = PALETTES.find((x) => x.id === look.palette) || PALETTES[0]; a = p.a; b = p.b; c = p.c || null; }
    const mid = c || mix(a, b, 0.5);
    const ink = luminance(mid) < 0.12 ? '#F4F3FF' : '#15153A';
    return { a, b, c: mid, ink, light: mix(a, '#FFFFFF', 0.62) };
  }

  // ------------------------------------------------ drawing
  const NS = 'http://www.w3.org/2000/svg';
  function el(doc, tag, attrs = {}, kids = []) {
    const n = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    for (const k of kids) n.appendChild(k);
    return n;
  }
  const polar = (deg, r) => { const a = (deg * Math.PI) / 180; return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; };
  const pt = ([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`;
  function star(cx, cy, r) {
    const p = [];
    for (let i = 0; i < 10; i++) { const a = (-90 + i * 36) * Math.PI / 180; const rr = i % 2 ? r * 0.45 : r; p.push(`${(cx + rr * Math.cos(a)).toFixed(2)} ${(cy + rr * Math.sin(a)).toFixed(2)}`); }
    return `M${p.join('L')}Z`;
  }

  /** Open eyes (the normal state), in face coordinates (64 × 64). */
  function eyesOpen(doc, style) {
    const kids = [];
    const pair = (fn) => { kids.push(...fn(23, -1), ...fn(41, 1)); };
    if (style === 'small') {
      pair((x) => [el(doc, 'circle', { cx: x, cy: 29, r: 3.1, class: 'ink' }), el(doc, 'circle', { cx: x + 0.9, cy: 28.1, r: 0.95, class: 'shine' })]);
    } else if (style === 'sleepy') {
      pair((x) => [
        el(doc, 'path', { d: `M${x - 4.4} 27.2A4.4 5 0 0 0 ${x + 4.4} 27.2Z`, class: 'ink' }),
        el(doc, 'path', { d: `M${x - 5.2} 27.2H${x + 5.2}`, class: 'ink-line', 'stroke-width': 1.8 }),
        el(doc, 'circle', { cx: x + 0.8, cy: 29.4, r: 1, class: 'shine' }),
      ]);
    } else if (style === 'hearts') {
      const heart = (cx, cy, r) => `M${cx} ${cy + r * 0.95}C${cx - r * 1.45} ${cy + r * 0.05} ${cx - r * 0.95} ${cy - r * 1.05} ${cx} ${cy - r * 0.35}C${cx + r * 0.95} ${cy - r * 1.05} ${cx + r * 1.45} ${cy + r * 0.05} ${cx} ${cy + r * 0.95}Z`;
      pair((x) => [el(doc, 'path', { d: heart(x, 28.5, 5.4), fill: '#FF4F86', class: 'heart', 'stroke-width': 0.9 }),
        el(doc, 'circle', { cx: x - 1.8, cy: 26.6, r: 1.1, class: 'shine' })]);
    } else if (style === 'happy') {
      pair((x) => [el(doc, 'path', { d: `M${x - 4.6} 30Q${x} 22.8 ${x + 4.6} 30`, class: 'ink-line', 'stroke-width': 3.2 })]);
    } else if (style === 'wink') {
      kids.push(el(doc, 'ellipse', { cx: 23, cy: 28, rx: 4.2, ry: 5.6, class: 'ink' }), el(doc, 'circle', { cx: 23.8, cy: 26.4, r: 1.3, class: 'shine' }),
        el(doc, 'path', { d: 'M36.4 29Q41 24.6 45.6 29', class: 'ink-line', 'stroke-width': 3 }));
    } else if (style === 'big') {
      pair((x) => [
        el(doc, 'ellipse', { cx: x, cy: 28, rx: 5.6, ry: 7, class: 'ink' }),
        el(doc, 'circle', { cx: x + 1.4, cy: 25.6, r: 2, class: 'shine' }),
        el(doc, 'circle', { cx: x - 1.8, cy: 31, r: 0.9, class: 'shine' })]);
    } else if (style === 'catseye') {
      pair((x) => [
        el(doc, 'ellipse', { cx: x, cy: 28, rx: 4.8, ry: 5.8, fill: '#C9E86A', class: 'heart', 'stroke-width': 1 }),
        el(doc, 'ellipse', { cx: x, cy: 28, rx: 1.4, ry: 4.6, class: 'ink' }),
        el(doc, 'circle', { cx: x + 1.6, cy: 26, r: 1.1, class: 'shine' })]);
    } else if (style === 'stars') {
      pair((x) => [el(doc, 'path', { d: star(x, 28, 6), class: 'ink' }), el(doc, 'circle', { cx: x + 0.8, cy: 27.2, r: 1.1, class: 'shine' })]);
    } else {
      pair((x, side) => [
        el(doc, 'ellipse', { cx: x, cy: 28, rx: 4.2, ry: 5.6, class: 'ink' }),
        el(doc, 'circle', { cx: x + 0.8, cy: 26.4, r: 1.3, class: 'shine' }),
        ...(style === 'lashes' ? [
          el(doc, 'path', { d: `M${x + side * 3.4} 24.2L${x + side * 5.8} 22`, class: 'ink-line', 'stroke-width': 1.5 }),
          el(doc, 'path', { d: `M${x + side * 2.2} 23L${x + side * 3.6} 20.4`, class: 'ink-line', 'stroke-width': 1.5 }),
        ] : []),
      ]);
    }
    return kids;
  }

  /** The mouth in the normal state. */
  function mouthRest(doc, style) {
    const line = (d, w = 3.4) => el(doc, 'path', { d, class: 'ink-line', 'stroke-width': w });
    if (style === 'wide') return [line('M19.5 38.5Q32 51 44.5 38.5')];
    if (style === 'small') return [line('M28 41.2Q32 44.4 36 41.2', 3)];
    if (style === 'cat') return [line('M24 40.5Q28 44.8 32 40.5Q36 44.8 40 40.5', 3)];
    if (style === 'o') return [el(doc, 'ellipse', { cx: 32, cy: 42.5, rx: 3.4, ry: 4.2, class: 'ink' })];
    if (style === 'smirk') return [line('M24 41.5Q33 45.5 41 38.6', 3.2)];
    if (style === 'teeth') return [el(doc, 'path', { d: 'M21.5 38.8Q32 50.5 42.5 38.8Z', class: 'ink' }), el(doc, 'path', { d: 'M24.2 39.6H39.8Q38.8 42.2 37.4 42.6H26.6Q25.2 42.2 24.2 39.6Z', fill: '#FFFFFF' })];
    if (style === 'fang') return [line('M23 40Q32 47 41 40'), el(doc, 'path', { d: 'M34.6 43.1L37.6 42.4L36.6 46.2Z', fill: '#FFFFFF', class: 'heart', 'stroke-width': 0.8, 'stroke-linejoin': 'round' })];
    if (style === 'mustache') return [
      el(doc, 'path', { d: 'M32 37.8C29 35.6 23.6 36 21 40C25 38.8 28 39.9 32 39.7C36 39.9 39 38.8 43 40C40.4 36 35 35.6 32 37.8Z', fill: '#5A3A2A' }),
      line('M28.4 43.4Q32 45.8 35.6 43.4', 2.6)];
    if (style === 'tongue') return [el(doc, 'path', { d: 'M22.5 38.8Q32 51 41.5 38.8Z', class: 'ink' }), el(doc, 'ellipse', { cx: 33, cy: 45.2, rx: 4, ry: 2.4, fill: '#FF7E9E' })];
    return [line('M23 40Q32 47 41 40')];
  }

  /** The hair, in body coordinates (100 × 100; it may go above, into the window margin). */
  function hair(doc, style, color) {
    const at = { fill: color, class: 'hair' };
    if (style === 'tuft') {
      return [el(doc, 'path', { ...at, d: 'M46 6C41-5 49-14 59-10C52-8 50-3 53 5Z' }), el(doc, 'path', { ...at, d: 'M53 6C56-2 63-3 68 2C62 1 59 4 57.5 8Z' })];
    }
    if (style === 'curly') {
      const out = [];
      for (let a = -168; a <= -12; a += 13) { const [x, y] = polar(a, 47); out.push(el(doc, 'circle', { ...at, cx: x.toFixed(1), cy: y.toFixed(1), r: 10.5 })); }
      return out;
    }
    if (style === 'spiky') {
      let d = `M${pt(polar(-168, 42))}`;
      for (let a = -158; a <= -22; a += 17) d += `L${pt(polar(a, 64))}L${pt(polar(a + 8.5, 45))}`;
      d += `L${pt(polar(-12, 42))}A42 42 0 0 0 ${pt(polar(-168, 42))}Z`;
      return [el(doc, 'path', { ...at, d })];
    }
    if (style === 'bangs') {
      let d = `M${pt(polar(-170, 51.5))}A51.5 51.5 0 0 1 ${pt(polar(-10, 51.5))}L${pt(polar(-14, 37))}`;
      for (let a = -14; a > -166; a -= 19) d += `Q${pt(polar(a - 9.5, 27))} ${pt(polar(a - 19, 37))}`;
      d += 'Z';
      return [el(doc, 'path', { ...at, d })];
    }
    if (style === 'bun') {
      const band = `M${pt(polar(-162, 50.5))}A50.5 50.5 0 0 1 ${pt(polar(-18, 50.5))}L${pt(polar(-22, 42))}A42 42 0 0 0 ${pt(polar(-158, 42))}Z`;
      return [el(doc, 'circle', { ...at, cx: 50, cy: -6, r: 12 }), el(doc, 'path', { ...at, d: band }),
        el(doc, 'path', { d: 'M41 3Q50 7 59 3', fill: 'none', stroke: '#FF5C8A', 'stroke-width': 3, 'stroke-linecap': 'round' })];
    }
    if (style === 'mohawk') {
      return [el(doc, 'path', { ...at, d: 'M40 10L36-10L45 1L48-19L53 0L61-12L60 10Z', 'stroke-linejoin': 'round' })];
    }
    if (style === 'afro') {
      const out = [];
      for (let a = -205; a <= 25; a += 11.5) { const [x, y] = polar(a, 50); out.push(el(doc, 'circle', { ...at, cx: x.toFixed(1), cy: y.toFixed(1), r: 13 })); }
      return out;
    }
    if (style === 'wave') {
      return [el(doc, 'path', { ...at, d: 'M28 12C26-6 44-16 58-10C72-4 74 8 64 13C66 4 60-3 51-1C44 1 41 7 44 13C38 9 32 9 28 12Z' })];
    }
    if (style === 'side') {
      const d = `M${pt(polar(-200, 51))}A51 51 0 0 1 ${pt(polar(-22, 51))}L${pt(polar(-26, 42))}Q50 6 ${pt(polar(-150, 40))}L16 68Q12 86 20 98Q0 92-1 70Z`;
      return [el(doc, 'path', { ...at, d })];
    }
    if (style === 'pigtails') {
      const band = `M${pt(polar(-152, 51))}A51 51 0 0 1 ${pt(polar(-28, 51))}L${pt(polar(-32, 43))}A43 43 0 0 0 ${pt(polar(-148, 43))}Z`;
      const [lx, ly] = polar(-152, 55); const [rx, ry] = polar(-28, 55);
      return [
        el(doc, 'circle', { ...at, cx: (lx - 6).toFixed(1), cy: (ly + 2).toFixed(1), r: 12 }),
        el(doc, 'circle', { ...at, cx: (rx + 6).toFixed(1), cy: (ry + 2).toFixed(1), r: 12 }),
        el(doc, 'path', { ...at, d: band }),
        el(doc, 'circle', { cx: lx.toFixed(1), cy: ly.toFixed(1), r: 3.4, fill: '#FF5C8A' }),
        el(doc, 'circle', { cx: rx.toFixed(1), cy: ry.toFixed(1), r: 3.4, fill: '#FF5C8A' }),
      ];
    }
    return [];
  }

  function accessory(doc, id) {
    const dark = '#2A2638';
    if (id === 'glasses') {
      const lens = (x) => el(doc, 'circle', { cx: x, cy: 45.4, r: 9.6, fill: 'rgba(255,255,255,.18)', stroke: dark, 'stroke-width': 2.4 });
      return [lens(39.6), lens(60.4),
        el(doc, 'path', { d: 'M49.2 44Q50 42.2 50.8 44', fill: 'none', stroke: dark, 'stroke-width': 2.2 }),
        el(doc, 'path', { class: 'temple', d: 'M30 43.5L9 40.5M70 43.5L91 40.5', fill: 'none', stroke: dark, 'stroke-width': 2.2, 'stroke-linecap': 'round' })];
    }
    if (id === 'bow') {
      return [el(doc, 'g', { transform: 'rotate(22 80 14)' }, [
        el(doc, 'path', { d: 'M80 14L68 6Q64 14 68 22Z', fill: '#FF5C8A', stroke: '#C7365F', 'stroke-width': 1.2 }),
        el(doc, 'path', { d: 'M80 14L92 6Q96 14 92 22Z', fill: '#FF5C8A', stroke: '#C7365F', 'stroke-width': 1.2 }),
        el(doc, 'circle', { cx: 80, cy: 14, r: 3.6, fill: '#FF7EA3', stroke: '#C7365F', 'stroke-width': 1.2 })])];
    }
    if (id === 'flower') {
      const petals = [];
      for (let i = 0; i < 5; i++) { const a = (i * 72 - 90) * Math.PI / 180; petals.push(el(doc, 'circle', { cx: (79 + 6 * Math.cos(a)).toFixed(1), cy: (13 + 6 * Math.sin(a)).toFixed(1), r: 5, fill: '#FFFFFF', stroke: '#F2A1C0', 'stroke-width': 1 })); }
      return [...petals, el(doc, 'circle', { cx: 79, cy: 13, r: 3.8, fill: '#FFC93C' })];
    }
    if (id === 'hat') {
      return [el(doc, 'g', { transform: 'rotate(-10 52 4)' }, [
        el(doc, 'rect', { x: 38, y: -12, width: 28, height: 17, rx: 3, fill: dark }),
        el(doc, 'rect', { x: 38, y: -1, width: 28, height: 4, fill: '#E0457B' }),
        el(doc, 'ellipse', { cx: 52, cy: 5, rx: 27, ry: 5.5, fill: dark })])];
    }
    if (id === 'crown') {
      return [el(doc, 'path', { d: 'M33 8L33-7L41.5 0L50-12L58.5 0L67-7L67 8Z', fill: '#FFCC33', stroke: '#C98A00', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }),
        el(doc, 'circle', { cx: 50, cy: 2, r: 2.6, fill: '#E0457B' }), el(doc, 'circle', { cx: 39.5, cy: 4, r: 1.8, fill: '#3A7BF0' }), el(doc, 'circle', { cx: 60.5, cy: 4, r: 1.8, fill: '#3A7BF0' })];
    }
    if (id === 'beret') {
      return [el(doc, 'g', { transform: 'rotate(-12 46 4)' }, [
        el(doc, 'ellipse', { cx: 46, cy: 3, rx: 31, ry: 10.5, fill: '#D93A4A' }),
        el(doc, 'ellipse', { cx: 46, cy: 6.5, rx: 27, ry: 4, fill: '#B82E3D' }),
        el(doc, 'path', { d: 'M46-7.5L47.5-12', stroke: '#B82E3D', 'stroke-width': 2.6, 'stroke-linecap': 'round' })])];
    }
    if (id === 'headphones') {
      return [el(doc, 'path', { d: 'M5 48C5-10 95-10 95 48', fill: 'none', stroke: dark, 'stroke-width': 5, 'stroke-linecap': 'round' }),
        el(doc, 'rect', { x: -4, y: 36, width: 13, height: 25, rx: 5.5, fill: dark }),
        el(doc, 'rect', { x: 91, y: 36, width: 13, height: 25, rx: 5.5, fill: dark }),
        el(doc, 'rect', { x: 6, y: 40, width: 4, height: 17, rx: 2, fill: '#FF6B9A' }),
        el(doc, 'rect', { x: 90, y: 40, width: 4, height: 17, rx: 2, fill: '#FF6B9A' })];
    }
    if (id === 'star') {
      return [el(doc, 'path', { d: star(80, 13, 9), fill: '#FFD54A', stroke: '#C98A00', 'stroke-width': 1.3, 'stroke-linejoin': 'round' }),
        el(doc, 'circle', { cx: 77.5, cy: 10.5, r: 1.6, fill: 'rgba(255,255,255,.8)' })];
    }
    if (id === 'beanie') {
      return [el(doc, 'path', { d: 'M15 20C15-10 85-10 85 20Z', fill: '#4F7DF3' }),
        el(doc, 'path', { d: 'M30 16C33 4 36-2 38-4M50 13V-7M70 16C67 4 64-2 62-4', fill: 'none', stroke: '#3A63D0', 'stroke-width': 2, 'stroke-linecap': 'round' }),
        el(doc, 'path', { d: 'M11 23Q50 7 89 23L89 15Q50-1 11 15Z', fill: '#FFFFFF', stroke: '#C9D3F5', 'stroke-width': 1 }),
        el(doc, 'circle', { cx: 50, cy: -9, r: 7, fill: '#FFFFFF', stroke: '#C9D3F5', 'stroke-width': 1 })];
    }
    if (id === 'wizard') {
      return [el(doc, 'path', { d: 'M27 7Q41-2 55-15Q66-19 71-11Q67-6 64-2Q69 3 75 7Z', fill: '#5B45C9', stroke: '#3B2A93', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
        el(doc, 'ellipse', { cx: 51, cy: 7, rx: 33, ry: 6, fill: '#3B2A93' }),
        el(doc, 'path', { d: star(49, -1, 4), fill: '#FFD54A' }),
        el(doc, 'path', { d: star(61, -9, 2.6), fill: '#FFD54A' }),
        el(doc, 'circle', { cx: 39, cy: 2, r: 1.3, fill: '#FFD54A' })];
    }
    if (id === 'halo') {
      return [el(doc, 'ellipse', { cx: 50, cy: -5, rx: 23, ry: 6, fill: 'none', stroke: 'rgba(255,213,74,.45)', 'stroke-width': 7 }),
        el(doc, 'ellipse', { cx: 50, cy: -5, rx: 23, ry: 6, fill: 'none', stroke: '#FFD54A', 'stroke-width': 3.2 })];
    }
    if (id === 'royal') {
      return [el(doc, 'path', { d: 'M27 12L25-8L37 1L50-13L63 1L75-8L73 12Z', fill: '#FFC21A', stroke: '#A96F00', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }),
        el(doc, 'rect', { x: 27, y: 6, width: 46, height: 7, rx: 2, fill: '#E0A300', stroke: '#A96F00', 'stroke-width': 1.2 }),
        el(doc, 'circle', { cx: 50, cy: 1, r: 3.2, fill: '#E0245E', stroke: '#fff', 'stroke-width': 0.8 }),
        el(doc, 'circle', { cx: 38, cy: 9.5, r: 2, fill: '#3A7BF0' }), el(doc, 'circle', { cx: 50, cy: 9.5, r: 2, fill: '#2E9E6A' }), el(doc, 'circle', { cx: 62, cy: 9.5, r: 2, fill: '#3A7BF0' }),
        el(doc, 'circle', { cx: 25, cy: -8, r: 2.2, fill: '#FFE58A' }), el(doc, 'circle', { cx: 50, cy: -13, r: 2.4, fill: '#FFE58A' }), el(doc, 'circle', { cx: 75, cy: -8, r: 2.2, fill: '#FFE58A' })];
    }
    // ---------------- 1.9.0
    if (id === 'bowtie') {
      return [el(doc, 'path', { d: 'M50 98L36 90V106ZM50 98L64 90V106Z', fill: '#E0457B', stroke: '#A92D57', 'stroke-width': 1.2, 'stroke-linejoin': 'round' }),
        el(doc, 'circle', { cx: 50, cy: 98, r: 3.6, fill: '#F2678F', stroke: '#A92D57', 'stroke-width': 1.2 })];
    }
    if (id === 'scarf') {
      return [el(doc, 'path', { d: 'M16 86Q50 102 84 86L86 95Q50 112 14 95Z', fill: '#E85D4A' }),
        el(doc, 'path', { d: 'M62 98L68 116L59 117L55 100Z', fill: '#D24B39' }),
        el(doc, 'path', { d: 'M28 92L30 99M40 95L41 103M52 96V104M64 95L63 102', stroke: '#FFE1A8', 'stroke-width': 2.2, 'stroke-linecap': 'round' })];
    }
    if (id === 'sunglasses') {
      const lens = (x) => el(doc, 'rect', { x: x - 10.5, y: 39, width: 21, height: 13.5, rx: 5.5, fill: '#1E1B2A' });
      return [lens(39.6), lens(60.4),
        el(doc, 'path', { d: 'M48.6 43Q50 41.4 51.4 43', fill: 'none', stroke: '#1E1B2A', 'stroke-width': 2.4 }),
        el(doc, 'path', { class: 'temple', d: 'M29 42L9 39M71 42L91 39', fill: 'none', stroke: '#1E1B2A', 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
        el(doc, 'path', { d: 'M32 42.5L36 41M53 42.5L57 41', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1.8, 'stroke-linecap': 'round' })];
    }
    if (id === 'cowboy') {
      return [el(doc, 'path', { d: 'M30 6C29-12 38-16 50-10C62-16 71-12 70 6Z', fill: '#A86B3C' }),
        el(doc, 'path', { d: 'M30 2H70V7H30Z', fill: '#5A3420' }),
        el(doc, 'path', { d: 'M6 2Q14 14 50 12Q86 14 94 2Q86 8 50 6Q14 8 6 2Z', fill: '#8A5530', stroke: '#5A3420', 'stroke-width': 1, 'stroke-linejoin': 'round' })];
    }
    if (id === 'wreath') {
      const out = [];
      const cols = ['#FF7EB6', '#FFD54A', '#FFFFFF', '#9BDCFF'];
      for (let i = 0, a = -165; a <= -15; a += 15, i++) {
        const [x, y] = polar(a, 47);
        out.push(el(doc, 'ellipse', { cx: (x + 3).toFixed(1), cy: (y + 2).toFixed(1), rx: 4.5, ry: 2.2, fill: '#5DBB63', transform: `rotate(${a + 120} ${(x + 3).toFixed(1)} ${(y + 2).toFixed(1)})` }));
        out.push(el(doc, 'circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 4.4, fill: cols[i % cols.length], stroke: 'rgba(0,0,0,.12)', 'stroke-width': 0.8 }));
        out.push(el(doc, 'circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: 1.5, fill: '#F2A91E' }));
      }
      return out;
    }
    if (id === 'leaf') {
      return [el(doc, 'path', { d: 'M70 22Q64 4 86-2Q90 16 70 22Z', fill: '#5DBB63', stroke: '#3E8E45', 'stroke-width': 1.2 }),
        el(doc, 'path', { d: 'M71 21Q77 10 85 1', fill: 'none', stroke: '#3E8E45', 'stroke-width': 1.3, 'stroke-linecap': 'round' })];
    }
    if (id === 'gaming') {
      return [el(doc, 'path', { d: 'M5 48C5-12 95-12 95 48', fill: 'none', stroke: '#22202E', 'stroke-width': 7, 'stroke-linecap': 'round' }),
        el(doc, 'path', { d: 'M24 8C40-2 60-2 76 8', fill: 'none', stroke: '#00E0C6', 'stroke-width': 2.2, 'stroke-linecap': 'round' }),
        el(doc, 'rect', { x: -6, y: 34, width: 16, height: 28, rx: 6.5, fill: '#22202E' }),
        el(doc, 'rect', { x: 90, y: 34, width: 16, height: 28, rx: 6.5, fill: '#22202E' }),
        el(doc, 'rect', { x: -3, y: 40, width: 4, height: 16, rx: 2, fill: '#00E0C6' }),
        el(doc, 'rect', { x: 99, y: 40, width: 4, height: 16, rx: 2, fill: '#00E0C6' }),
        el(doc, 'path', { d: 'M4 60Q8 80 30 76', fill: 'none', stroke: '#22202E', 'stroke-width': 2.6, 'stroke-linecap': 'round' }),
        el(doc, 'circle', { cx: 32, cy: 75.5, r: 3.4, fill: '#22202E' })];
    }
    if (id === 'sleepmask') {
      return [el(doc, 'path', { d: 'M20 24L3 30M80 24L97 30', stroke: '#5B4BD8', 'stroke-width': 2.4, 'stroke-linecap': 'round' }),
        el(doc, 'path', { d: 'M20 22Q50 10 80 22Q81 35 66 33Q50 30 34 33Q19 35 20 22Z', fill: '#7B6CF6', stroke: '#5B4BD8', 'stroke-width': 1.2 }),
        el(doc, 'path', { d: 'M30 25Q35 28 40 25M60 25Q65 28 70 25', fill: 'none', stroke: '#FFFFFF', 'stroke-width': 1.6, 'stroke-linecap': 'round' })];
    }
    if (id === 'astronaut') {
      return [el(doc, 'circle', { cx: 50, cy: 50, r: 60, fill: 'rgba(200,232,255,.16)', stroke: '#DDE7F2', 'stroke-width': 4 }),
        el(doc, 'path', { d: 'M18 22A42 42 0 0 1 40 6', fill: 'none', stroke: 'rgba(255,255,255,.85)', 'stroke-width': 4, 'stroke-linecap': 'round' }),
        el(doc, 'path', { d: 'M8 94Q50 118 92 94L94 104Q50 126 6 104Z', fill: '#DDE7F2', stroke: '#9FB1C6', 'stroke-width': 1.2 })];
    }
    if (id === 'fx-bubbles') {
      return [el(doc, 'g', { class: 'fx-rise' }, [[-4, 70, 5], [104, 60, 6], [96, 92, 4], [2, 98, 3.5]].map(([cx, cy, r]) =>
        el(doc, 'circle', { cx, cy, r, fill: 'rgba(170,222,255,.35)', stroke: '#8FCBEF', 'stroke-width': 1.3 })))];
    }
    if (id === 'fx-hearts') {
      const hp = (cx, cy, r) => `M${cx} ${cy + r * 0.95}C${cx - r * 1.45} ${cy + r * 0.05} ${cx - r * 0.95} ${cy - r * 1.05} ${cx} ${cy - r * 0.35}C${cx + r * 0.95} ${cy - r * 1.05} ${cx + r * 1.45} ${cy + r * 0.05} ${cx} ${cy + r * 0.95}Z`;
      return [el(doc, 'g', { class: 'fx-rise' }, [[-3, 74, 5], [103, 66, 6], [98, 26, 4.5], [0, 30, 4]].map(([cx, cy, r]) => el(doc, 'path', { d: hp(cx, cy, r), fill: '#FF5C8A' })))];
    }
    if (id === 'fx-notes') {
      const note = (x, y) => [el(doc, 'ellipse', { cx: x, cy: y, rx: 3.6, ry: 2.8, fill: '#7B5CF0', transform: `rotate(-20 ${x} ${y})` }),
        el(doc, 'path', { d: `M${x + 3} ${y - 1}V${y - 14}Q${x + 8} ${y - 11} ${x + 9} ${y - 7}`, fill: 'none', stroke: '#7B5CF0', 'stroke-width': 1.8, 'stroke-linecap': 'round' })];
      return [el(doc, 'g', { class: 'fx-rise' }, [[-4, 40], [100, 34], [96, 84]].map(([x, y]) => el(doc, 'g', {}, note(x, y))))];
    }
    if (id === 'fx-snow') {
      const flake = (x, y, r) => el(doc, 'path', { d: `M${x - r} ${y}H${x + r}M${x} ${y - r}V${y + r}M${x - r * 0.7} ${y - r * 0.7}L${x + r * 0.7} ${y + r * 0.7}M${x + r * 0.7} ${y - r * 0.7}L${x - r * 0.7} ${y + r * 0.7}`, stroke: '#9CCFF2', 'stroke-width': 1.7, 'stroke-linecap': 'round' });
      return [el(doc, 'g', { class: 'fx-fall' }, [[-2, 10, 4], [30, -8, 3], [74, -6, 3.5], [104, 20, 4], [-6, 60, 3], [106, 70, 3.2]].map(([x, y, r]) => flake(x, y, r)))];
    }
    if (id === 'fx-fireflies') {
      return [el(doc, 'g', { class: 'fx-float' }, [[-6, 34], [106, 30], [100, 92], [2, 88], [50, -10]].map(([cx, cy]) =>
        el(doc, 'g', {}, [el(doc, 'circle', { cx, cy, r: 5, fill: 'rgba(255,214,60,.32)' }), el(doc, 'circle', { cx, cy, r: 2.3, fill: '#FFE14D', stroke: '#E0A800', 'stroke-width': 0.6 })])))];
    }
    if (id === 'rainbow-arc') {
      // a wide arc around the head: fits in the buddy window (only ~17 % free space at the top)
      const arc = (r, c) => el(doc, 'path', { d: `M${50 - r} 46A${r} ${r} 0 0 1 ${50 + r} 46`, fill: 'none', stroke: c, 'stroke-width': 3.6, 'stroke-linecap': 'round' });
      return [el(doc, 'g', { class: 'fx-glow-soft' }, [arc(58, '#FF6B6B'), arc(54.4, '#FFB43A'), arc(50.8, '#FFE45C'), arc(47.2, '#5DD39E'), arc(43.6, '#4DA3FF')])];
    }
    if (id === 'sparkles') {
      const sp = (cx, cy, r) => `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
      return [el(doc, 'g', { class: 'fx-sparkles' }, [[-5, 28, 6], [104, 22, 5], [101, 84, 6.5], [1, 88, 4.5]].map(([x, y, r]) =>
        el(doc, 'path', { d: sp(x, y, r), fill: '#FFE27A', stroke: '#E0A800', 'stroke-width': 0.6 })))];
    }
    if (id === 'glow') {
      return [el(doc, 'g', { class: 'fx-glow' }, [
        el(doc, 'circle', { cx: 50, cy: 50, r: 58, class: 'glow-ring', 'stroke-width': 3, opacity: 0.35 }),
        el(doc, 'circle', { cx: 50, cy: 50, r: 54, class: 'glow-ring', 'stroke-width': 4, opacity: 0.6 })])];
    }
    return [];
  }

  /**
   * Builds the buddy in the `body` element (a round div): the face (SVG 64 × 64) and the hair / accessories layer.
   * The animation expressions (happy, closed, surprised eyes; big mouths) are the same for all styles.
   */
  function build(body) {
    const doc = body.ownerDocument;
    const face = el(doc, 'svg', { class: 'bl-face', viewBox: '0 0 64 64', 'aria-hidden': 'true' }, [
      el(doc, 'g', { class: 'look' }, [
        el(doc, 'g', { class: 'eyes eyes-open' }),
        el(doc, 'g', { class: 'eyes eyes-wow' }, [
          el(doc, 'circle', { cx: 23, cy: 28, r: 5.6, class: 'ink' }), el(doc, 'circle', { cx: 41, cy: 28, r: 5.6, class: 'ink' }),
          el(doc, 'circle', { cx: 25, cy: 25.6, r: 1.8, class: 'shine' }), el(doc, 'circle', { cx: 43, cy: 25.6, r: 1.8, class: 'shine' })]),
        el(doc, 'g', { class: 'eyes eyes-happy' }, [
          el(doc, 'path', { d: 'M18.4 30Q23 22.8 27.6 30', class: 'ink-line', 'stroke-width': 3.2 }),
          el(doc, 'path', { d: 'M36.4 30Q41 22.8 45.6 30', class: 'ink-line', 'stroke-width': 3.2 })]),
        el(doc, 'g', { class: 'eyes eyes-closed' }, [
          el(doc, 'path', { d: 'M18.4 28Q23 32 27.6 28', class: 'ink-line', 'stroke-width': 3 }),
          el(doc, 'path', { d: 'M36.4 28Q41 32 45.6 28', class: 'ink-line', 'stroke-width': 3 })]),
      ]),
      el(doc, 'g', { class: 'mouth mouth-smile' }),
      el(doc, 'path', { class: 'mouth mouth-big ink', d: 'M21.5 38.5Q32 52 42.5 38.5Z' }),
      el(doc, 'ellipse', { class: 'mouth mouth-o ink', cx: 32, cy: 42.5, rx: 3.6, ry: 4.4 }),
      el(doc, 'path', { class: 'mouth mouth-flat ink-line', d: 'M27 42.5Q32 41 37 43.2', 'stroke-width': 3 }),
      el(doc, 'circle', { class: 'cheek', cx: 15.5, cy: 38, r: 3.6 }),
      el(doc, 'circle', { class: 'cheek', cx: 48.5, cy: 38, r: 3.6 }),
      // the beak (owl, chick): replaces the mouth, shown only on shapes with .beak
      el(doc, 'path', { class: 'beak-mark', d: 'M27 39.6L37 39.6L32 46.6Z', fill: '#FFB43A', stroke: '#E08A00', 'stroke-width': 1, 'stroke-linejoin': 'round' }),
    ]);
    const over = el(doc, 'svg', { class: 'bl-over', viewBox: '0 0 100 100', 'aria-hidden': 'true' }, [
      el(doc, 'g', { class: 'bl-hair' }), el(doc, 'g', { class: 'bl-acc' })]);
    // 1.9.0: the shape (under the face); empty for the circle, the body comes from CSS
    const shape = el(doc, 'svg', { class: 'bl-shape', viewBox: '0 0 100 100', 'aria-hidden': 'true' });
    body.replaceChildren(shape, face, over);
    return body;
  }

  /** Applies a look to a buddy built with build(). `vars` = the element that gets the colors (the body by default). */
  function apply(body, look, vars = body) {
    const L = normalizeLook(look);
    const doc = body.ownerDocument;
    const { a, b, c, ink, light } = colorsOf(L);
    const shape = SH.byId(L.shape);
    vars.style.setProperty('--buddy-a', a);
    vars.style.setProperty('--buddy-b', b);
    vars.style.setProperty('--buddy-c', c);
    vars.style.setProperty('--buddy-light', light);
    vars.style.setProperty('--ink', shape.ink || ink);
    // shape: the body drawn in SVG (the circle stays in CSS); the face moves / shrinks where the shape wants it
    const shaped = L.shape !== 'circle';
    body.classList.toggle('shaped', shaped);
    body.classList.toggle('beak', !!shape.beak);
    const shapeSvg = body.querySelector('.bl-shape');
    if (shapeSvg && shapeSvg.dataset.shape !== L.shape) { SH.draw(shapeSvg, L.shape); shapeSvg.dataset.shape = L.shape; }
    const ft = SH.faceTransform(L.shape);
    // the percentages in translate() are of the face (74 % of the body)
    body.style.setProperty('--face-tx', `${(ft.fx / 0.74).toFixed(2)}%`);
    body.style.setProperty('--face-ty', `${(ft.fy / 0.74).toFixed(2)}%`);
    body.style.setProperty('--face-s', String(ft.s));
    body.querySelector('.eyes-open').replaceChildren(...eyesOpen(doc, L.eyes));
    body.querySelector('.mouth-smile').replaceChildren(...mouthRest(doc, L.mouth));
    body.classList.toggle('no-cheeks', !L.cheeks || shape.cheeks === false);
    body.classList.toggle('no-temples', shape.temples === false);
    const hc = (HAIR_COLORS.find((x) => x.id === L.hairColor) || HAIR_COLORS[0]).c;
    const hairG = body.querySelector('.bl-hair');
    hairG.setAttribute('transform', SH.topTransform(L.shape));
    hairG.replaceChildren(...(shape.hair ? hair(doc, L.hair, hc) : []));
    // each spot has the shape's transform: glasses follow the face, hats the top of the head, the bow tie the neck
    const where = {
      fx: null, face: ft.svg, top: SH.topTransform(L.shape), side: SH.sideTransform(L.shape), neck: SH.neckTransform(L.shape),
    };
    const order = ['fx', 'neck', 'face', 'top', 'side'];
    const acc = [...L.accessories].sort((x, y) => order.indexOf(ACCESSORIES.find((q) => q.id === x).slot) - order.indexOf(ACCESSORIES.find((q) => q.id === y).slot));
    body.querySelector('.bl-acc').replaceChildren(...acc.map((id) => {
      const slot = ACCESSORIES.find((q) => q.id === id).slot;
      // the astronaut helmet wraps the whole body, so it does not follow the top of the head
      const t = id === 'astronaut' ? null : where[slot];
      return el(doc, 'g', t ? { transform: t } : {}, accessory(doc, id));
    }));
    return L;
  }

  const api = { SHAPES, SLOTS, PALETTES, EYES, MOUTHS, HAIRS, HAIR_COLORS, ACCESSORIES, DEFAULT_LOOK, normalizeLook, toggleAccessory, randomLook, colorsOf, luminance, build, apply };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BuddyLook = api;
})(typeof window !== 'undefined' ? window : globalThis);
