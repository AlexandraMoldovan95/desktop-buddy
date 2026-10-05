'use strict';
// Buddy shapes (1.9.0): apart from the circle (body drawn in CSS, as before), each shape is an original SVG
// drawing in body coordinates (100 × 100; it may go a little outside, into the transparent window margin).
// Each shape also says where the face sits, what is on the head (hats), what is on one side and what is at the neck, so
// accessories fit; on animals the ears take the place of the hair, and hats sit between the ears.
// The same file runs in Node (require, for validation and tests) and in pages (window.BuddyShapes).
(function (root) {
  // face: [cx, cy, s] = where the point between the eyes goes and how big the face is (1 = as on the circle)
  // top:  [x, y, s] = where the top of the head is (hats and hair move / shrink there)
  // side: [dx, dy] = how far the side accessories move (bow, flower, star)
  // neck: y = where the "neck" is (bow tie, scarf); 100 on the circle
  // hair: false = the hair is not drawn (ears, corners, rays…)
  // temples: false = glasses without arms (on the frog the eyes are on top of the head, the arms would float in the air)
  const SHAPES = [
    { id: 'circle', label: 'Circle', face: [50, 45.4, 1], top: [50, 0, 1], side: [0, 0], neck: 100, hair: true },
    { id: 'squircle', label: 'Rounded square', face: [50, 44, 0.96], top: [50, 8, 0.95], side: [2, 4], neck: 92, hair: true,
      body: (E) => [E('rect', { x: 8, y: 8, width: 84, height: 84, rx: 28 })] },
    { id: 'drop', label: 'Drop', face: [50, 58, 0.88], top: [50, 18, 0.62], side: [-6, 20], neck: 99, hair: false,
      body: (E) => [E('path', { d: 'M50 2C60 20 90 42 90 62A40 37 0 0 1 10 62C10 42 40 20 50 2Z' })] },
    { id: 'egg', label: 'Egg', face: [50, 54, 0.95], top: [50, 6, 0.85], side: [-2, 6], neck: 98, hair: true,
      body: (E) => [E('path', { d: 'M50 4C76 4 90 38 90 58C90 82 72 98 50 98C28 98 10 82 10 58C10 38 24 4 50 4Z' })] },
    { id: 'cloud', label: 'Cloud', face: [50, 58, 0.85], top: [48, 26, 0.75], side: [2, 22], neck: 88, hair: false,
      body: (E) => [E('path', { d: 'M24 88A18 18 0 0 1 16 54A23 23 0 0 1 46 28A23 23 0 0 1 82 38A21 21 0 0 1 82 88Z' })] },
    { id: 'jelly', label: 'Jelly', face: [50, 46, 0.95], top: [50, 8, 0.92], side: [0, 6], neck: 86, hair: true,
      body: (E) => [E('path', { d: 'M8 70C8 32 26 8 50 8C74 8 92 32 92 70C92 81 85 84 80 78C76 89 66 90 63 82C58 93 42 93 37 82C34 90 24 89 20 78C15 84 8 81 8 70Z' })] },
    { id: 'pixel', label: 'Pixel', face: [50, 47, 0.95], top: [50, 6, 0.9], side: [0, 4], neck: 94, hair: true,
      body: (E) => [E('path', { d: 'M28 6H72V14H84V26H94V74H84V86H72V94H28V86H16V74H6V26H16V14H28Z', 'shape-rendering': 'crispEdges' })] },
    { id: 'heart', label: 'Heart', face: [50, 50, 0.85], top: [50, 20, 0.72], side: [6, 10], neck: 92, hair: false,
      body: (E) => [E('path', { d: 'M50 96C14 72 2 50 14 30C26 12 44 16 50 32C56 16 74 12 86 30C98 50 86 72 50 96Z' })] },
    { id: 'star', label: 'Star', face: [50, 54, 0.76], top: [50, 8, 0.55], side: [-10, 14], neck: 92, hair: false,
      body: (E) => [E('path', { d: starPath(50, 56, 47, 24), 'stroke-linejoin': 'round', 'stroke-width': 9, class: 'bl-stroke' })] },
    { id: 'diamond', label: 'Diamond', face: [50, 46, 0.78], top: [50, 12, 0.8], side: [0, 10], neck: 80, hair: false,
      body: (E) => [E('path', { d: 'M26 12H74L96 38L50 96L4 38Z', 'stroke-linejoin': 'round', 'stroke-width': 3, class: 'bl-stroke' })],
      over: (E) => [E('path', { d: 'M4 38H96M26 12L38 38L50 12L62 38L74 12M38 38L50 96L62 38', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.32, 'stroke-width': 1.4 })] },
    { id: 'moon', label: 'Moon', face: [36, 50, 0.66], top: [40, 14, 0.55], side: [-54, 6], neck: 96, hair: false,
      body: (E) => [E('path', { d: 'M66 6A46 46 0 1 0 96 76A37 37 0 1 1 66 6Z' })] },
    { id: 'sun', label: 'Sun', face: [50, 48, 0.8], top: [50, 14, 0.72], side: [-6, 12], neck: 86, hair: false,
      under: (E) => {
        const out = [];
        for (let i = 0; i < 12; i++) {
          const a = (i * 30) * Math.PI / 180;
          out.push(E('line', { x1: 50 + 38 * Math.cos(a), y1: 50 + 38 * Math.sin(a), x2: 50 + 52 * Math.cos(a), y2: 50 + 52 * Math.sin(a), stroke: '#FFB43A', 'stroke-width': 6, 'stroke-linecap': 'round' }));
        }
        return out;
      },
      body: (E) => [E('circle', { cx: 50, cy: 50, r: 36 })] },
    { id: 'flower', label: 'Flower', face: [50, 48, 0.76], top: [50, 18, 0.66], side: [-6, 14], neck: 84, hair: false,
      under: (E) => Array.from({ length: 6 }, (_, i) => { const a = (i * 60 - 90) * Math.PI / 180; return E('circle', { cx: 50 + 32 * Math.cos(a), cy: 50 + 32 * Math.sin(a), r: 18, class: 'bl-light' }); }),
      body: (E) => [E('circle', { cx: 50, cy: 50, r: 32 })] },
    { id: 'clover', label: 'Clover', face: [50, 49, 0.78], top: [50, 12, 0.62], side: [-4, 8], neck: 88, hair: false,
      under: (E) => [E('path', { d: 'M62 82Q70 96 82 98', fill: 'none', class: 'bl-dark-stroke', 'stroke-width': 5, 'stroke-linecap': 'round' })],
      body: (E) => [[30, 30], [70, 30], [30, 70], [70, 70]].map(([cx, cy]) => E('circle', { cx, cy, r: 22 })).concat([E('circle', { cx: 50, cy: 50, r: 24 })]) },
    // ---------------- animals: the ears take the place of the hair; hats sit between the ears (smaller)
    { id: 'cat', label: 'Kitty', face: [50, 52, 0.95], top: [50, 20, 0.6], side: [-4, 16], neck: 96, hair: false,
      body: (E) => [
        E('path', { d: 'M16 44L18 4L46 24Z', 'stroke-linejoin': 'round', 'stroke-width': 6, class: 'bl-stroke' }),
        E('path', { d: 'M84 44L82 4L54 24Z', 'stroke-linejoin': 'round', 'stroke-width': 6, class: 'bl-stroke' }),
        E('circle', { cx: 50, cy: 56, r: 40 })],
      over: (E) => [
        E('path', { d: 'M22 34L23 14L38 25Z M78 34L77 14L62 25Z', fill: '#FF9FC6' }),
        E('path', { d: 'M8 60H24M9 68L24 64M92 60H76M91 68L76 64', fill: 'none', stroke: 'rgba(20,10,40,.45)', 'stroke-width': 1.6, 'stroke-linecap': 'round' })] },
    { id: 'bunny', label: 'Bunny', face: [50, 58, 0.9], top: [50, 24, 0.55], side: [-2, 24], neck: 97, hair: false,
      body: (E) => [
        E('ellipse', { cx: 34, cy: 18, rx: 10, ry: 24, transform: 'rotate(-10 34 18)' }),
        E('ellipse', { cx: 66, cy: 18, rx: 10, ry: 24, transform: 'rotate(10 66 18)' }),
        E('circle', { cx: 50, cy: 61, r: 36 })],
      over: (E) => [
        E('ellipse', { cx: 34, cy: 19, rx: 4.5, ry: 16, fill: '#FF9FC6', transform: 'rotate(-10 34 19)' }),
        E('ellipse', { cx: 66, cy: 19, rx: 4.5, ry: 16, fill: '#FF9FC6', transform: 'rotate(10 66 19)' })] },
    { id: 'bear', label: 'Teddy bear', face: [50, 50, 0.95], top: [50, 18, 0.62], side: [-2, 14], neck: 96, hair: false,
      body: (E) => [E('circle', { cx: 20, cy: 22, r: 15 }), E('circle', { cx: 80, cy: 22, r: 15 }), E('circle', { cx: 50, cy: 56, r: 40 })],
      over: (E) => [E('circle', { cx: 20, cy: 22, r: 7.5, class: 'bl-light' }), E('circle', { cx: 80, cy: 22, r: 7.5, class: 'bl-light' }),
        E('ellipse', { cx: 50, cy: 70, rx: 17, ry: 12.5, class: 'bl-light' })] },
    { id: 'fox', label: 'Fox', face: [50, 50, 0.95], top: [50, 22, 0.58], side: [-4, 18], neck: 96, hair: false,
      body: (E) => [
        E('path', { d: 'M14 48L16 4L44 28Z', 'stroke-linejoin': 'round', 'stroke-width': 5, class: 'bl-stroke' }),
        E('path', { d: 'M86 48L84 4L56 28Z', 'stroke-linejoin': 'round', 'stroke-width': 5, class: 'bl-stroke' }),
        E('path', { d: 'M10 52C10 30 28 20 50 20C72 20 90 30 90 52C90 76 70 96 50 96C30 96 10 76 10 52Z' })],
      over: (E) => [
        E('path', { d: 'M20 36L21 16L36 28Z M80 36L79 16L64 28Z', fill: '#2A1D3E', opacity: 0.55 }),
        E('path', { d: 'M10 58C24 58 40 68 50 88C60 68 76 58 90 58C88 80 70 96 50 96C30 96 12 80 10 58Z', fill: '#FBF8FF' })] },
    { id: 'frog', label: 'Frog', face: [50, 31, 1.25], top: [50, 18, 0.5], side: [8, 18], neck: 94, hair: false, temples: false,
      body: (E) => [E('circle', { cx: 37, cy: 31, r: 15 }), E('circle', { cx: 63, cy: 31, r: 15 }), E('ellipse', { cx: 50, cy: 62, rx: 46, ry: 32 })],
      over: (E) => [E('circle', { cx: 37, cy: 31, r: 9.5, fill: '#FFFFFF' }), E('circle', { cx: 63, cy: 31, r: 9.5, fill: '#FFFFFF' })] },
    { id: 'owl', label: 'Owl', face: [50, 46, 1], top: [50, 22, 0.56], side: [-2, 18], neck: 98, hair: false, beak: true,
      body: (E) => [
        E('path', { d: 'M14 36L20 6L40 26Z', 'stroke-linejoin': 'round', 'stroke-width': 5, class: 'bl-stroke' }),
        E('path', { d: 'M86 36L80 6L60 26Z', 'stroke-linejoin': 'round', 'stroke-width': 5, class: 'bl-stroke' }),
        E('path', { d: 'M10 54C10 30 28 20 50 20C72 20 90 30 90 54C90 80 72 98 50 98C28 98 10 80 10 54Z' })],
      over: (E) => [
        E('circle', { cx: 39.6, cy: 45.4, r: 11.5, fill: '#FBF8FF' }), E('circle', { cx: 60.4, cy: 45.4, r: 11.5, fill: '#FBF8FF' }),
        E('path', { d: 'M30 80Q34 76 38 80Q42 76 46 80Q50 76 54 80Q58 76 62 80Q66 76 70 80', fill: 'none', stroke: '#fff', 'stroke-opacity': 0.4, 'stroke-width': 1.6 })] },
    { id: 'chick', label: 'Chick', face: [50, 50, 0.95], top: [50, 14, 0.75], side: [0, 10], neck: 96, hair: false, beak: true,
      under: (E) => [E('path', { d: 'M12 66Q0 56 4 46Q12 56 18 56Z M88 66Q100 56 96 46Q88 56 82 56Z' })],
      body: (E) => [E('path', { d: 'M44 16Q40 4 48 0Q46 8 54 6Q50 10 56 16Z' }), E('circle', { cx: 50, cy: 56, r: 40 })] },
    // ---------------- fantasy and objects
    { id: 'ghost', label: 'Ghost', face: [50, 46, 0.95], top: [50, 6, 0.9], side: [0, 4], neck: 86, hair: true,
      body: (E) => [E('path', { d: 'M10 96L10 46A40 40 0 0 1 90 46L90 96L77 86L64 96L50 86L36 96L23 86Z' })] },
    { id: 'robot', label: 'Robot', face: [50, 49, 0.86], top: [50, 12, 0.85], side: [2, 8], neck: 90, hair: false, ink: '#7DF9E0', cheeks: false,
      under: (E) => [
        E('line', { x1: 50, y1: 12, x2: 50, y2: -2, class: 'bl-dark-stroke', 'stroke-width': 3.5, 'stroke-linecap': 'round' }),
        E('circle', { cx: 50, cy: -4, r: 5, fill: '#FF5C8A' }),
        E('rect', { x: 2, y: 40, width: 10, height: 24, rx: 4, class: 'bl-dark' }),
        E('rect', { x: 88, y: 40, width: 10, height: 24, rx: 4, class: 'bl-dark' })],
      body: (E) => [E('rect', { x: 8, y: 12, width: 84, height: 80, rx: 18 })],
      over: (E) => [E('rect', { x: 19, y: 26, width: 62, height: 52, rx: 12, fill: '#241446' })] },
    { id: 'monster', label: 'Monster', face: [50, 54, 0.95], top: [50, 20, 0.8], side: [0, 18], neck: 98, hair: false,
      under: (E) => [E('path', { d: 'M26 30L32 8L40 26Z M42 24L50 2L58 24Z M60 26L68 8L74 30Z', fill: '#FF8FB8', 'stroke-linejoin': 'round', stroke: '#FF8FB8', 'stroke-width': 3 })],
      body: (E) => [E('path', { d: 'M6 62C6 32 26 18 50 18C74 18 94 32 94 62C94 86 74 98 50 98C26 98 6 86 6 62Z' })] },
    { id: 'mushroom', label: 'Mushroom', face: [50, 66, 0.7], top: [50, 4, 0.9], side: [4, 2], neck: 98, hair: false,
      under: (E) => [E('rect', { x: 24, y: 44, width: 52, height: 54, rx: 20, class: 'bl-light' })],
      body: (E) => [E('path', { d: 'M2 56C2 22 26 4 50 4C74 4 98 22 98 56C80 50 20 50 2 56Z' })],
      over: (E) => [[24, 30, 7], [50, 18, 6], [74, 32, 7.5], [40, 42, 4.5], [86, 46, 4]].map(([cx, cy, r]) => E('circle', { cx, cy, r, fill: '#FFFFFF', opacity: 0.9 })) },
    { id: 'planet', label: 'Planet', face: [50, 48, 0.82], top: [50, 14, 0.75], side: [-6, 12], neck: 88, hair: false,
      under: (E) => [E('path', { d: 'M8 66A46 13 -18 0 1 92 38', fill: 'none', stroke: '#FFB43A', 'stroke-width': 5, 'stroke-linecap': 'round' })],
      body: (E) => [E('circle', { cx: 50, cy: 52, r: 37 })],
      over: (E) => [E('path', { d: 'M92 38A46 13 -18 0 1 8 66', fill: 'none', stroke: '#FFB43A', 'stroke-width': 5, 'stroke-linecap': 'round' })] },
    { id: 'mug', label: 'Coffee mug', face: [46, 54, 0.85], top: [46, 8, 0.8], side: [-6, 8], neck: 96, hair: false,
      under: (E) => [
        E('path', { d: 'M80 34C100 34 100 70 80 70', fill: 'none', class: 'bl-dark-stroke', 'stroke-width': 9 }),
        E('path', { d: 'M32 6Q27 0 32 -6M46 6Q41 0 46 -6M60 6Q55 0 60 -6', fill: 'none', stroke: '#B9A7DC', 'stroke-width': 3, 'stroke-linecap': 'round' })],
      body: (E) => [E('path', { d: 'M8 16H84V72C84 88 72 96 60 96H32C20 96 8 88 8 72Z' })],
      over: (E) => [E('ellipse', { cx: 46, cy: 17, rx: 37, ry: 5, fill: '#5A2A1E', opacity: 0.85 })] },
  ];

  function starPath(cx, cy, R, r, n = 5) {
    const p = [];
    for (let i = 0; i < n * 2; i++) {
      const a = (-90 + (i * 180) / n) * Math.PI / 180;
      const rr = i % 2 ? r : R;
      p.push(`${(cx + rr * Math.cos(a)).toFixed(1)} ${(cy + rr * Math.sin(a)).toFixed(1)}`);
    }
    return `M${p.join('L')}Z`;
  }

  const byId = (id) => SHAPES.find((s) => s.id === id) || SHAPES[0];

  /** The SVG transform (in body coordinates) that moves the face from the circle to where the shape wants it. */
  function faceTransform(shape) {
    const [cx, cy, s] = byId(shape.id || shape).face;
    // on the circle, the point between the eyes is (50, 45.4); we scale around the center (50, 50), then move
    const fx = cx - 50;
    const fy = cy - 50 + 4.6 * s;
    return { fx, fy, s, svg: `translate(${(50 + fx).toFixed(2)} ${(50 + fy).toFixed(2)}) scale(${s}) translate(-50 -50)` };
  }
  const topTransform = (shape) => { const [x, y, s] = byId(shape).top; return `translate(${x} ${y}) scale(${s}) translate(-50 0)`; };
  const sideTransform = (shape) => { const [dx, dy] = byId(shape).side; return `translate(${dx} ${dy})`; };
  const neckTransform = (shape) => `translate(0 ${byId(shape).neck - 100})`;

  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;

  /**
   * Draws the shape in the `.bl-shape` layer (SVG 100 × 100): what sits underneath, the body with a gradient in the
   * buddy's colors (shine top-left, shadow at the bottom), then the details. The circle is not drawn here (it stays in CSS).
   */
  function draw(svg, shapeId) {
    const doc = svg.ownerDocument;
    const sh = byId(shapeId);
    if (!sh.body) { svg.replaceChildren(); return; }
    const id = `bl${++uid}`;
    const E = (tag, attrs = {}, kids = []) => {
      const n = doc.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, typeof v === 'number' ? String(+v.toFixed(2)) : String(v));
      for (const k of kids) n.appendChild(k);
      return n;
    };
    const grad = `url(#${id}g)`;
    const fill = (nodes) => nodes.map((n) => { n.setAttribute('fill', grad); if (n.getAttribute('class') === 'bl-stroke') n.setAttribute('stroke', grad); return n; });
    const defs = E('defs', {}, [
      E('linearGradient', { id: `${id}g`, x1: 0, y1: 0, x2: 0.85, y2: 1 }, [
        E('stop', { offset: 0, class: 'bl-stop-a' }), E('stop', { offset: 0.5, class: 'bl-stop-c' }), E('stop', { offset: 1, class: 'bl-stop-b' })]),
      E('radialGradient', { id: `${id}h`, cx: 0.3, cy: 0.24, r: 0.42 }, [
        E('stop', { offset: 0, 'stop-color': '#fff', 'stop-opacity': 0.75 }), E('stop', { offset: 0.35, 'stop-color': '#fff', 'stop-opacity': 0.28 }), E('stop', { offset: 1, 'stop-color': '#fff', 'stop-opacity': 0 })]),
      E('radialGradient', { id: `${id}s`, cx: 0.7, cy: 0.9, r: 0.5 }, [
        E('stop', { offset: 0, 'stop-color': '#000', 'stop-opacity': 0.16 }), E('stop', { offset: 1, 'stop-color': '#000', 'stop-opacity': 0 })]),
      E('clipPath', { id: `${id}c` }, sh.body(E)),
    ]);
    svg.replaceChildren(
      defs,
      // what sits underneath (rays, petals, wings…): no color of its own = the body color
      ...(sh.under ? sh.under(E).map((n) => { if (!n.hasAttribute('fill') && !n.hasAttribute('class') && !n.hasAttribute('stroke')) n.setAttribute('fill', grad); return n; }) : []),
      E('g', { class: 'bl-shape-body' }, fill(sh.body(E))),
      E('g', { 'clip-path': `url(#${id}c)`, 'pointer-events': 'none' }, [
        E('rect', { x: -10, y: -10, width: 120, height: 120, fill: `url(#${id}s)` }),
        E('rect', { x: -10, y: -10, width: 120, height: 120, fill: `url(#${id}h)` })]),
      ...(sh.over ? sh.over(E) : []));
  }

  const api = { SHAPES, byId, faceTransform, topTransform, sideTransform, neckTransform, draw, starPath };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BuddyShapes = api;
})(typeof window !== 'undefined' ? window : globalThis);
