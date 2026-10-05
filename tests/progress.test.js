'use strict';
// "A buddy that grows": XP, levels, the daily streak, rewards and locks.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/shared/progression');
const BL = require('../src/shared/buddy-look');
const { ProgressTracker } = require('../src/main/progress');
const { sanitizePatch, withDefaults } = require('../src/shared/settings-schema');

const MIN = 60000;
// 24 Sep 2026 = Thursday, 25 = Friday, 26-27 = weekend, 28 = Monday, 29 = Tuesday, 30 = Wednesday

test('level curve (1.5.0): level 2 after 20 min, 5 after ~3.5 h, 10 after ~14 h, 25 after ~74 h', () => {
  assert.equal(P.xpForLevel(1), 0);
  assert.equal(P.xpForLevel(2), 20);
  assert.equal(P.xpForLevel(5), 211);
  assert.equal(P.xpForLevel(10), 838);
  assert.equal(P.xpForLevel(25), 4440);
  for (let l = 2; l <= 60; l++) assert.ok(P.xpForLevel(l) - P.xpForLevel(l - 1) >= P.xpForLevel(l - 1) - P.xpForLevel(Math.max(1, l - 2)), 'each level needs at least as much as the one before');
  for (let l = 1; l <= 40; l++) {
    assert.equal(P.levelForXp(P.xpForLevel(l)), l);
    if (l > 1) assert.equal(P.levelForXp(P.xpForLevel(l) - 1), l - 1);
  }
  assert.equal(P.levelForXp(10 ** 9), P.MAX_LEVEL);
  assert.equal(P.titleFor(1), 'Beginner');
  assert.equal(P.titleFor(12), 'Focused');
  assert.equal(P.titleFor(40), 'Legend');
});

test('XP: 1 per active minute + the streak bonus (10 × streak days); days under 25 min get no bonus', () => {
  const p = P.computeProgress({ '2026-09-30': 90 * MIN }, '2026-09-30');
  assert.equal(p.xp, 90 + 10);
  assert.equal(p.streak, 1);
  assert.equal(p.todayCounts, true);
  assert.equal(p.level, 3);
  const short = P.computeProgress({ '2026-09-30': 24 * MIN + 59000 }, '2026-09-30');
  assert.equal(short.xp, 24);
  assert.equal(short.streak, 0);
  assert.equal(short.todayLeftMs, 1000);
  assert.deepEqual(P.computeProgress({}, '2026-09-30').xp, 0);
});

test('streak: a free weekend does not break it, a missed workday does, today does not until it is over', () => {
  const across = P.computeProgress({ '2026-09-24': 30 * MIN, '2026-09-25': 30 * MIN, '2026-09-28': 30 * MIN }, '2026-09-28');
  assert.equal(across.streak, 3, 'joi, vineri, (weekend), luni');
  const gap = P.computeProgress({ '2026-09-28': 30 * MIN, '2026-09-30': 30 * MIN }, '2026-09-30');
  assert.equal(gap.streak, 1, 'Tuesday without work breaks the streak');
  assert.equal(gap.bestStreak, 1);
  const pending = P.computeProgress({ '2026-09-28': 30 * MIN, '2026-09-29': 30 * MIN, '2026-09-30': 10 * MIN }, '2026-09-30');
  assert.equal(pending.streak, 2, 'today still counts');
  assert.equal(pending.todayCounts, false);
  assert.equal(pending.todayLeftMs, 15 * MIN);
  const weekendWork = P.computeProgress({ '2026-09-25': 30 * MIN, '2026-09-26': 40 * MIN, '2026-09-28': 30 * MIN }, '2026-09-28');
  assert.equal(weekendWork.streak, 3, 'working on the weekend extends the streak');
});

test('the streak bonus grows up to 70 XP per day and stays there', () => {
  const totals = {};
  let day = '2026-09-01';
  for (let i = 0; i < 12; i++) { totals[day] = 25 * MIN; day = P.addDays(day, 1); }
  const today = P.addDays('2026-09-01', 11);
  const p = P.computeProgress(totals, today);
  assert.equal(p.streak, 12);
  const bonus = [1, 2, 3, 4, 5, 6, 7, 7, 7, 7, 7, 7].reduce((t, n) => t + n * 10, 0);
  assert.equal(p.xp, 12 * 25 + bonus);
  assert.equal(p.xpToday, 25 + 70);
});

test('rewards (72, with shapes since 1.9.0): only new things, each once, in order; locks remove what is not yours yet', () => {
  assert.equal(P.REWARDS.length, 72);
  assert.equal(P.REWARDS.filter((r) => r.kind === 'shape').length, 24, 'all shapes except circle, rounded square and drop');
  assert.equal(Math.max(...P.REWARDS.map((r) => r.level)), 60);
  // every reward exists in Customize, and nothing that was free before is locked
  for (const r of P.REWARDS) {
    const list = { shape: BL.SHAPES, palette: BL.PALETTES, eyes: BL.EYES, mouth: BL.MOUTHS, hair: BL.HAIRS, accessory: BL.ACCESSORIES }[r.kind];
    assert.ok(list.some((x) => x.id === r.id), r.id);
  }
  const keys = P.REWARDS.map((r) => `${r.kind}:${r.id}`);
  for (const old of ['palette:lagoon', 'palette:lavender', 'accessory:glasses', 'accessory:bow', 'accessory:flower', 'accessory:hat', 'accessory:crown', 'accessory:beret', 'accessory:headphones',
    'eyes:stars', 'eyes:lashes', 'shape:circle', 'shape:squircle', 'shape:drop', 'mouth:smile', 'mouth:cat', 'hair:tuft', 'hair:bangs']) assert.ok(!keys.includes(old), old);
  assert.equal(new Set(P.REWARDS.map((r) => `${r.kind}:${r.id}`)).size, P.REWARDS.length, 'no reward twice');
  assert.deepEqual(P.REWARDS.map((r) => r.level), [...P.REWARDS.map((r) => r.level)].sort((a, b) => a - b));

  const p = P.computeProgress({ '2026-09-30': 230 * MIN }, '2026-09-30');   // 240 XP → level 5
  assert.equal(p.level, 5);
  assert.deepEqual(p.unlocked, ['star', 'midnight', 'hearts', 'beanie']);
  assert.equal(p.nextReward.id, 'aurora');
  assert.deepEqual(P.rewardsBetween(1, 5).map((r) => r.id), p.unlocked);

  const look = BL.normalizeLook({ palette: 'gold', eyes: 'hearts', accessories: ['glasses', 'wizard', 'star', 'glow'] });
  assert.deepEqual(P.lockLook(look, 4), { ...look, palette: 'lavender', eyes: 'hearts', accessories: ['glasses', 'star'] });
  assert.deepEqual(P.lockLook(look, 1).eyes, 'round');
  assert.deepEqual(P.lockLook(look, 99), look);
  // 1.9.0: the new shapes, mouths and hairstyles have locks too
  const fancy = BL.normalizeLook({ shape: 'cat', mouth: 'mustache', hair: 'afro', palette: 'rainbow', accessories: ['astronaut', 'fx-fireflies'] });
  assert.deepEqual(P.lockLook(fancy, 18), { ...fancy, shape: 'circle', mouth: 'smile', hair: 'none', palette: 'lavender', accessories: [] });
  assert.deepEqual(P.lockLook(fancy, 60), fancy);
  assert.equal(P.lockLook(BL.normalizeLook({ shape: 'squircle' }), 1).shape, 'squircle', 'the rounded square is free from the start');
});

test('new items: slots (one effect at a time), random only from what is unlocked', () => {
  let L = BL.normalizeLook({ accessories: ['sparkles', 'glow', 'halo', 'royal', 'star', 'flower'] });
  assert.deepEqual(L.accessories, ['sparkles', 'halo', 'star'], 'one per slot');
  L = BL.toggleAccessory(L, 'glow');
  assert.deepEqual(L.accessories, ['halo', 'star', 'glow']);
  const locked = P.lockedAt(1);
  const allow = (kind, id) => !locked[kind].has(id);
  let seed = 11;
  const rng = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 300; i++) {
    const r = BL.randomLook(rng, allow);
    assert.deepEqual(P.lockLook(r, 1), r, JSON.stringify(r));
    assert.deepEqual(BL.normalizeLook(r), r);
  }
  assert.equal(BL.colorsOf(BL.normalizeLook({ palette: 'midnight' })).ink, '#F4F3FF', 'on Midnight the face is light');
});

test('the celebrated level: not set from a page, but kept saved', () => {
  assert.equal(withDefaults({}).progressSeenLevel, null);
  assert.deepEqual(sanitizePatch({ progressSeenLevel: 50 }), {});
  assert.equal(withDefaults({ progressSeenLevel: 7 }).progressSeenLevel, 7, 'kept on restart (otherwise it would announce the level again)');
  assert.equal(withDefaults({ progressSeenLevel: 'x' }).progressSeenLevel, null);
});

function fakeSessions(days, todayMs) {
  return {
    dayKeys: () => Object.keys(days).sort(),
    dayRecords: (d) => (days[d] || []).map((ms, i) => ({ id: `${d}-${i}`, activeMs: ms })),
    today: () => ({ totalMs: todayMs.v }),
  };
}

test('tracker: the history from files, a new level announced once, the first start without a celebration', () => {
  const days = { '2026-09-28': [40 * MIN, 20 * MIN], '2026-09-29': [30 * MIN], '2026-09-30': [5 * MIN] };
  const todayMs = { v: 5 * MIN };
  let seen = null;
  const ups = [];
  const changes = [];
  const t = new ProgressTracker({
    sessions: fakeSessions(days, todayMs),
    now: () => new Date(2026, 8, 30, 15, 0).getTime(),
    getSeen: () => seen,
    setSeen: (l) => { seen = l; },
    onChange: (p) => changes.push(p.xp),
    onLevelUp: (p, rewards, first) => ups.push({ level: p.level, rewards: rewards.map((r) => r.id), first }),
  });
  const p1 = t.refresh();
  // 60 min + 10 bonus (Monday) + 30 min + 20 bonus (Tuesday) + 5 min today (today's file is not counted twice)
  assert.equal(p1.xp, 60 + 10 + 30 + 20 + 5);
  assert.equal(p1.level, 3);
  assert.deepEqual(ups, [{ level: 3, rewards: ['star', 'midnight'], first: true }]);
  t.refresh();
  assert.equal(changes.length, 1, 'no change, no notice');

  todayMs.v = 200 * MIN;             // today's session grew: 350 XP
  const p2 = t.refresh();
  assert.equal(p2.level, 6);
  assert.deepEqual(ups[1], { level: 6, rewards: ['hearts', 'beanie', 'aurora'], first: false }, 'several levels at once: all the rewards, a single celebration');
  assert.equal(seen, 6);
  assert.equal(changes.length, 2);

  days['2026-09-27'] = [100 * MIN];  // a day that appeared in the files: seen only after invalidate()
  assert.equal(t.refresh().xp, p2.xp);
  t.invalidate();
  assert.ok(t.refresh().xp > p2.xp);
});
