'use strict';
// Annotations on screenshots (1.11.0): document validation, geometry (bubble, handles, click), the copy's name, zoom.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/shared/annotations');

test('document: only known types, #RRGGBB colors, bounded coordinates, cleaned text, a maximum number of items', () => {
  const d = A.normalizeDoc({
    items: [
      { type: 'pen', points: [[1, 2], ['x', 3], [5, 6]], color: '#e5383b' },
      { type: 'script', code: 'alert(1)' },
      { type: 'text', text: '   ' },
      { type: 'text', text: 'Salut\r\nlume\u0007', x: 10, y: 10 },
      { type: 'rect', x: 100, y: 100, w: -50, h: 20, color: 'red' },
      { type: 'bubble', x: 1, y: 1, w: 100, h: 40, text: 'hi' },
      { type: 'line', x1: 1e9, y1: 0, x2: 0, y2: 0 },
      { type: 'step', x: 5, y: 5, id: 'a1' }, { type: 'step', x: 9, y: 9, id: 'a1' },
    ],
  }, 1000, 600);
  assert.deepEqual(d.items.map((i) => i.type), ['pen', 'text', 'rect', 'bubble', 'line', 'step', 'step']);
  assert.deepEqual(d.items[0].points, [[1, 2], [5, 6]]);
  assert.equal(d.items[0].color, '#E5383B');
  assert.equal(d.items[1].text, 'Salut\nlume');
  assert.deepEqual([d.items[2].x, d.items[2].w, d.items[2].color], [50, 50, A.COLORS[0]]);
  assert.equal(d.items[4].x1, 3000, 'coordinates cannot run off to infinity');
  assert.notEqual(d.items[5].id, d.items[6].id, 'ids stay unique');
  const many = A.normalizeDoc({ items: Array.from({ length: 900 }, () => ({ type: 'step', x: 1, y: 1 })) }, 100, 100);
  assert.equal(many.items.length, A.LIMITS.items);
  assert.deepEqual(A.normalizeDoc(null, 10, 10), { version: 1, crop: null, output: null, items: [] });
});

test('crop: inside the image, at least 8 px, the whole image = no crop; the copy name is checked', () => {
  assert.deepEqual(A.normalizeCrop({ x: 900, y: 500, w: -300, h: 200 }, 1000, 600), { x: 600, y: 500, w: 300, h: 100 });
  assert.equal(A.normalizeCrop({ x: 0, y: 0, w: 1000, h: 600 }, 1000, 600), null);
  assert.equal(A.normalizeCrop({ x: 5, y: 5, w: 4, h: 100 }, 1000, 600), null);
  const ok = A.normalizeDoc({ output: 'a - annotated.png' }, 10, 10, (n) => n === 'a - annotated.png');
  const bad = A.normalizeDoc({ output: '..\\x.png' }, 10, 10, () => false);
  assert.equal(ok.output, 'a - annotated.png');
  assert.equal(bad.output, null);
});

test('copy name: "X - annotated.png", no double suffix; back to the original', () => {
  assert.equal(A.annotatedName('Screenshot 2026-10-01 21-40-12.png'), 'Screenshot 2026-10-01 21-40-12 - annotated.png');
  assert.equal(A.annotatedName('X - annotated (2).png'), 'X - annotated.png');
  assert.equal(A.sourceOfAnnotated('X - annotated.png'), 'X.png');
  assert.equal(A.sourceOfAnnotated('X - annotated (3).png'), 'X.png');
  assert.equal(A.sourceOfAnnotated('X.png'), null);
});

test('copy name: old copies "X - adnotat.png" (before the English pass) are still recognized', () => {
  assert.equal(A.sourceOfAnnotated('X - adnotat.png'), 'X.png');
  assert.equal(A.sourceOfAnnotated('X - adnotat (2).png'), 'X.png');
  assert.equal(A.annotatedName('X - adnotat.png'), 'X - annotated.png', 'a copy of an old copy gets no double suffix');
  const old = A.normalizeDoc({ output: 'a - adnotat.png' }, 10, 10, (n) => A.sourceOfAnnotated(n) === 'a.png');
  assert.equal(old.output, 'a - adnotat.png', 'a stored doc.output with the old suffix keeps working');
});

test('bubble: the tail leaves on the edge toward the tip, not from the corner; tip inside the box = no tail', () => {
  const b = { x: 100, y: 100, w: 200, h: 60, size: 18 };
  const below = A.bubbleGeometry({ ...b, tx: 150, ty: 260 });
  assert.equal(below.tail.edge, 'bottom');
  assert.ok(below.tail.a.x > below.tail.b.x, 'on the bottom edge, the outline goes from right to left');
  for (const p of [below.tail.a, below.tail.b]) assert.ok(p.x >= 100 + below.r && p.x <= 300 - below.r);
  assert.equal(A.bubbleGeometry({ ...b, tx: 500, ty: 130 }).tail.edge, 'right');
  assert.equal(A.bubbleGeometry({ ...b, tx: 0, ty: 120 }).tail.edge, 'left');
  assert.equal(A.bubbleGeometry({ ...b, tx: 200, ty: 0 }).tail.edge, 'top');
  assert.equal(A.bubbleGeometry({ ...b, tx: 150, ty: 120 }).tail, null);
});

test('click on annotations: the top one wins; a line only close to it; the bubble tail can be grabbed', () => {
  const items = [
    { id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 100, width: 4 },
    { id: 'l', type: 'line', x1: 0, y1: 0, x2: 100, y2: 100, width: 4 },
    { id: 'b', type: 'bubble', x: 300, y: 0, w: 100, h: 40, tx: 300, ty: 200, size: 18 },
    { id: 'p', type: 'pen', points: [[500, 500], [600, 500]], width: 4 },
    { id: 's', type: 'step', x: 700, y: 700, r: 16 },
  ];
  assert.equal(items[A.hitTest(items, 50, 50, 5)].id, 'l');
  assert.equal(items[A.hitTest(items, 80, 20, 5)].id, 'r');
  assert.equal(items[A.hitTest(items, 318, 160, 5)].id, 'b', 'on the tail');
  assert.equal(items[A.hitTest(items, 550, 503, 5)].id, 'p');
  assert.equal(A.hitTest(items, 550, 530, 5), -1);
  assert.equal(items[A.hitTest(items, 712, 700, 5)].id, 's');
});

test('handles and moving: the opposite corner stays put, the box never flips; the bubble moves its tail too', () => {
  const r = { type: 'rect', x: 10, y: 10, w: 100, h: 50 };
  assert.deepEqual(A.dragHandle(r, 'se', 200, 100), { ...r, w: 190, h: 90 });
  const flipped = A.dragHandle(r, 'nw', 500, 500, 8);
  assert.deepEqual([flipped.x + flipped.w, flipped.y + flipped.h, flipped.w, flipped.h], [110, 60, 8, 8]);
  assert.deepEqual(A.handlesOf({ type: 'bubble', x: 0, y: 0, w: 10, h: 10, tx: 5, ty: 50 }).map((h) => h.key), ['nw', 'ne', 'sw', 'se', 'tail']);
  const m = A.moveItem({ type: 'bubble', x: 0, y: 0, w: 10, h: 10, tx: 5, ty: 50 }, 3, 4);
  assert.deepEqual([m.x, m.y, m.tx, m.ty], [3, 4, 8, 54]);
  const p = A.moveItem({ type: 'pen', points: [[1, 1], [2, 2]] }, 1, 0);
  assert.deepEqual(p.points, [[2, 1], [3, 2]]);
});

test('steps are numbered in order; lines wrap at the width; freehand drawing has fewer points', () => {
  const n = A.stepNumbers([{ id: 'a', type: 'step' }, { id: 'x', type: 'rect' }, { id: 'b', type: 'step' }]);
  assert.deepEqual([...n.entries()], [['a', 1], ['b', 2]]);
  const m = (s) => s.length * 10;
  assert.deepEqual(A.wrapLines('salut lume frumoasa\n\nabcdefghijklmnop x', 100, m), ['salut lume', 'frumoasa', '', 'abcdefghij', 'klmnop x']);
  const pts = Array.from({ length: 100 }, (_, i) => [i * 0.2, 0]);
  const s = A.simplify(pts, 1.5);
  assert.ok(s.length < 20);
  assert.deepEqual(s[0], pts[0]);
  assert.deepEqual(s[s.length - 1], pts[99]);
});

test('zoom: between 5 % and 800 %, the steps go through 100 %, "Fit" never enlarges above 100 %', () => {
  assert.equal(A.clampZoom(20), 8);
  assert.equal(A.clampZoom(0), 0.05);
  assert.equal(A.stepZoom(0.8, 1), 1);
  assert.equal(A.stepZoom(1, 1), 1.25);
  assert.equal(A.stepZoom(1, -1), 0.75);
  assert.equal(A.stepZoom(8, 1), 8);
  assert.equal(A.fitZoom(800, 600, 2000, 1000), 1);
  assert.equal(A.fitZoom(4000, 2000, 1000, 1000), 0.25);
});

test('colors: the note is the light variant; the text / number shows on any color', () => {
  assert.equal(A.noteFill('#F5C518'), '#FBE9A7');
  assert.equal(A.contrastOn('#F5C518'), A.INK);
  assert.equal(A.contrastOn('#2F6FED'), '#FFFFFF');
  assert.equal(A.contrastOn('#FFFFFF'), A.INK);
});

test('right-click menu: duplicate (new id, moved), drawing order, what can be changed', () => {
  const it = { id: 'a1', type: 'bubble', x: 10, y: 10, w: 100, h: 40, tx: 0, ty: 80, text: 'hi', size: 18, color: '#E5383B' };
  const d = A.duplicateItem(it, 16);
  assert.notEqual(d.id, it.id);
  assert.deepEqual([d.x, d.y, d.tx, d.ty, d.text], [26, 26, 16, 96, 'hi']);
  assert.equal(it.x, 10, 'the original does not change');
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const ids = (l) => l.map((x) => x.id).join('');
  assert.equal(ids(A.reorder(items, 'a', 'front')), 'bca');
  assert.equal(ids(A.reorder(items, 'c', 'back')), 'cab');
  assert.equal(ids(A.reorder(items, 'a', 'up')), 'bac');
  assert.equal(ids(A.reorder(items, 'c', 'down')), 'acb');
  assert.equal(ids(A.reorder(items, 'x', 'front')), 'abc');
  assert.equal(ids(items), 'abc', 'the list passed in stays unchanged');
  assert.equal(A.canColor({ type: 'blur' }), false);
  assert.equal(A.canText({ type: 'note' }), true);
  assert.equal(A.canText({ type: 'arrow' }), false);
  for (const t of A.TYPES) assert.ok(A.TYPE_LABELS[t], t);
});
