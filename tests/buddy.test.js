'use strict';
// The buddy's animations: when it falls asleep, where it looks, which reactions the main process sends.
const test = require('node:test');
const assert = require('node:assert/strict');
const { BuddyMood, shouldSleep, lookVector, SLEEP_AFTER_SEC } = require('../src/main/buddy-mood');
const { sanitizePatch, withDefaults } = require('../src/shared/settings-schema');

function make(over = {}) {
  const sent = [];
  const st = { enabled: true, running: false, idle: 0, visible: true, cursor: { x: 0, y: 0 }, bounds: { x: 100, y: 100, width: 92, height: 92 }, ...over };
  const mood = new BuddyMood({
    send: (channel, payload) => sent.push([channel, payload.type || payload.animations !== undefined ? (payload.type || `animations=${payload.animations}`) : payload]),
    isEnabled: () => st.enabled, isSessionRunning: () => st.running, getIdleSec: () => st.idle,
    isVisible: () => st.visible, getCursor: () => st.cursor, getBounds: () => st.bounds,
  });
  return { mood, sent, st };
}

test('the "Animations" setting: on by default, validated as a boolean', () => {
  assert.equal(withDefaults({}).buddyAnimations, true);
  assert.deepEqual(sanitizePatch({ buddyAnimations: false }), { buddyAnimations: false });
  assert.deepEqual(sanitizePatch({ buddyAnimations: 'no' }), {});
});

test('falls asleep only without a session, after 3 minutes without mouse / keyboard, and only with animations on', () => {
  assert.equal(SLEEP_AFTER_SEC, 180);
  assert.equal(shouldSleep({ enabled: true, sessionRunning: false, idleSec: 180 }), true);
  assert.equal(shouldSleep({ enabled: true, sessionRunning: false, idleSec: 179 }), false);
  assert.equal(shouldSleep({ enabled: true, sessionRunning: true, idleSec: 9999 }), false, 'while you work, it does not sleep');
  assert.equal(shouldSleep({ enabled: false, sessionRunning: false, idleSec: 9999 }), false);
});

test('sleep cycle: falls asleep once, does not react while asleep, wakes on session / panel / hover', () => {
  const { mood, sent, st } = make({ idle: 500 });
  mood.tick();
  mood.tick();
  assert.deepEqual(sent.map((x) => x[1]), ['sleep'], 'only once');
  assert.equal(mood.react('wow'), false, 'no "wow" while asleep');
  st.running = true;
  mood.tick();
  assert.equal(sent.at(-1)[1], 'wake', 'a started session wakes it');
  st.running = false;
  mood.tick();
  assert.equal(sent.at(-1)[1], 'sleep');
  mood.woke();                        // hover / click from the page
  assert.equal(mood.sleeping, false);
  mood.wake();                        // panel opened: already awake, sends nothing
  assert.equal(sent.at(-1)[1], 'sleep');
});

test('AI: thinks while working (also with several requests), then is happy only if it suggested something', () => {
  const { mood, sent } = make();
  mood.thinkStart();
  mood.thinkStart();
  mood.thinkEnd({ happy: true });
  assert.deepEqual(sent.map((x) => x[1]), ['think-on', 'think-on'], 'a request is still running');
  mood.thinkEnd({ happy: true });
  assert.deepEqual(sent.map((x) => x[1]).slice(-2), ['think-off', 'happy']);
  mood.thinkStart();
  mood.thinkEnd({ happy: false });
  assert.equal(sent.at(-1)[1], 'think-off');
});

test('with animations off it sends no reactions; unknown types are ignored', () => {
  const { mood, sent, st } = make();
  st.enabled = false;
  assert.equal(mood.react('happy'), false);
  assert.equal(mood.demo('wave'), false);
  st.enabled = true;
  assert.equal(mood.react('explode'), false);
  assert.equal(mood.demo('wave'), true);
  assert.deepEqual(sent.map((x) => x[1]), ['wave']);
});

test('gaze: the direction toward the mouse, limited to [-1, 1], sent only when it changes', () => {
  assert.deepEqual(lookVector({ x: 146, y: 146 }, { x: 100, y: 100, width: 92, height: 92 }), { x: 0, y: 0 });
  assert.deepEqual(lookVector({ x: 1000, y: -500 }, { x: 100, y: 100, width: 92, height: 92 }), { x: 1, y: -1 });
  assert.deepEqual(lookVector({ x: 146 + 160, y: 146 }, { x: 100, y: 100, width: 92, height: 92 }), { x: 0.5, y: 0 });
  const { mood, sent, st } = make({ cursor: { x: 1000, y: 146 } });
  mood.lookTick();
  mood.lookTick();
  assert.equal(sent.filter((x) => x[0] === 'buddy:look').length, 1, 'the same direction is not sent again');
  st.visible = false;
  st.cursor = { x: 0, y: 0 };
  mood.lookTick();
  assert.equal(sent.filter((x) => x[0] === 'buddy:look').length, 1, 'hidden = does not follow the mouse');
});

// ------------------------------------------------------------ personalizarea (buddy-look.js)
const BL = require('../src/shared/buddy-look');

test('look: default = the buddy from before; wrong values go back to the default', () => {
  assert.deepEqual(withDefaults({}).buddyLook, BL.DEFAULT_LOOK);
  const L = BL.normalizeLook({ palette: 'does-not-exist', eyes: 'stars', mouth: 'cat', cheeks: 'yes', hair: 'bangs', hairColor: 'green', accessories: ['glasses', 'hat', 'crown', 'bow', 'rocket', 'bow'], extra: 1 });
  assert.deepEqual(L, { shape: 'circle', palette: 'lavender', custom: '', eyes: 'stars', mouth: 'cat', cheeks: true, hair: 'bangs', hairColor: 'brown', accessories: ['glasses', 'hat', 'bow'] });
  assert.equal(BL.normalizeLook({ shape: 'triunghi' }).shape, 'circle');
  assert.equal(BL.normalizeLook({ shape: 'owl' }).shape, 'owl');
  assert.equal(BL.normalizeLook({ palette: 'custom' }).palette, 'lavender', 'a custom color without a color → default');
  assert.deepEqual(BL.normalizeLook({ palette: 'custom', custom: '#12ab34' }), { ...BL.DEFAULT_LOOK, palette: 'custom', custom: '#12AB34' });
  assert.equal(BL.normalizeLook({ palette: 'custom', custom: 'red' }).palette, 'lavender');
  assert.deepEqual(sanitizePatch({ buddyLook: 'purple' }), {}, 'objects only');
  assert.equal(sanitizePatch({ buddyLook: { palette: 'mint' } }).buddyLook.palette, 'mint');
});

test('look: accessories in the same spot replace each other (one on the head, one on the side, glasses)', () => {
  let L = BL.normalizeLook({});
  L = BL.toggleAccessory(L, 'hat');
  L = BL.toggleAccessory(L, 'glasses');
  L = BL.toggleAccessory(L, 'crown');
  assert.deepEqual(L.accessories, ['glasses', 'crown'], 'the crown takes the place of the top hat');
  L = BL.toggleAccessory(L, 'glasses');
  assert.deepEqual(L.accessories, ['crown'], 'a second click removes it');
  assert.equal(BL.toggleAccessory(L, 'rocket'), L);
});

test('look: random is always valid; the face turns light on a very dark color', () => {
  let seed = 7;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 200; i++) {
    const L = BL.randomLook(rng);
    assert.deepEqual(BL.normalizeLook(L), L);
  }
  assert.equal(BL.colorsOf(BL.normalizeLook({})).ink, '#15153A');
  assert.equal(BL.colorsOf(BL.normalizeLook({ palette: 'custom', custom: '#101020' })).ink, '#F4F3FF');
  assert.equal(BL.colorsOf(BL.normalizeLook({ palette: 'custom', custom: '#FFE088' })).ink, '#15153A');
  assert.equal(BL.colorsOf(BL.normalizeLook({ palette: 'lavender' })).b, '#7A3FE0');
});

test('buddy page styles never restyle the classes buddy-look.js draws with (heart eyes went invisible once)', () => {
  const fs = require('fs');
  const path = require('path');
  const look = fs.readFileSync(path.join(__dirname, '../src/shared/buddy-look.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/buddy/buddy.css'), 'utf8');
  const drawn = new Set([...look.matchAll(/class: '([a-z][a-z0-9-]*)'/g)].map((m) => m[1]));
  assert.ok(drawn.has('heart') && drawn.has('shine'), 'the scan finds the drawing classes');
  // an unscoped rule (".heart {", ".shine," at the start of a selector) in the page CSS would hit the face too
  const HOOKS = new Set(['look']);   // intended: the page moves the gaze group (.look) with --lx / --ly
  const clashes = [...drawn].filter((c) => !HOOKS.has(c)).filter((c) => new RegExp(`(^|[},]\\s*)\\.${c}(?![a-z0-9-])[^{}]*\\{`, 'm').test(css));
  assert.deepEqual(clashes, []);
});
