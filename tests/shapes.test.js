'use strict';
// Buddy shapes (1.9.0): each shape has everything the face and accessories need to sit in place.
const test = require('node:test');
const assert = require('node:assert');
const SH = require('../src/shared/buddy-shapes');
const BL = require('../src/shared/buddy-look');
const PR = require('../src/shared/progression');

test('27 shapes, unique ids, the circle first', () => {
  assert.strictEqual(SH.SHAPES.length, 27);
  assert.strictEqual(new Set(SH.SHAPES.map((s) => s.id)).size, 27);
  assert.strictEqual(SH.SHAPES[0].id, 'circle');
  assert.strictEqual(SH.byId('does-not-exist').id, 'circle');
});

test('each shape has positions for the face, head, side and neck', () => {
  for (const s of SH.SHAPES) {
    assert.ok(Array.isArray(s.face) && s.face.length === 3 && s.face.every(Number.isFinite), s.id);
    assert.ok(Array.isArray(s.top) && s.top.length === 3 && s.top.every(Number.isFinite), s.id);
    assert.ok(Array.isArray(s.side) && s.side.length === 2 && s.side.every(Number.isFinite), s.id);
    assert.ok(Number.isFinite(s.neck), s.id);
    assert.strictEqual(typeof s.hair, 'boolean', s.id);
    assert.ok(s.face[2] > 0.5 && s.face[2] <= 1.3, `${s.id}: the face is neither tiny nor huge`);
    if (s.id !== 'circle') assert.strictEqual(typeof s.body, 'function', s.id);
    assert.match(SH.faceTransform(s.id).svg, /^translate\(/);
  }
});

test('the circle does not move the face (the look from before 1.9.0 stays the same)', () => {
  const t = SH.faceTransform('circle');
  assert.strictEqual(t.s, 1);
  assert.ok(Math.abs(t.fx) < 1e-9 && Math.abs(t.fy) < 1e-9);
});

test('the shapes in BuddyLook are the same, and each can be unlocked', () => {
  assert.deepStrictEqual(BL.SHAPES.map((s) => s.id), SH.SHAPES.map((s) => s.id));
  for (const s of SH.SHAPES) {
    const r = PR.rewardOf('shape', s.id);
    if (['circle', 'squircle', 'drop'].includes(s.id)) assert.ok(!r || r.level <= 1, `${s.id} is free`);
    else assert.ok(r && r.level > 1 && r.level <= 60, `${s.id} has a level`);
  }
});
