'use strict';
// "A buddy that grows": XP from active session time + the daily streak bonus, the levels and what they unlock.
// Pure functions (they run in the main process, in pages and in tests). Everything is computed from the
// per-day files (sessions/YYYY-MM-DD.json), so there is no separate counter that could break or get "inflated".
//
// Rules (decided with the owner, 30.09.2026):
//  - 1 XP per minute of active work (breaks don't count);
//  - a day counts toward the streak if it has ≥ 25 active min; Saturday and Sunday without work do NOT break the streak,
//    and today does not break the streak until it is over;
//  - streak bonus: 10 XP × the streak length on that day, at most 70 XP per day (from day 7);
//  - levels unlock only NEW things (what was already in Customize stays free).
(function (root) {
  const XP_PER_MIN = 1;
  const STREAK_MIN_MS = 25 * 60 * 1000;
  const STREAK_BONUS = 10;
  const STREAK_BONUS_CAP_DAYS = 7;
  // Total XP for level L = 20 × (L - 1)^1.7 (since 1.5.0; before: 30 × (L - 1)², too slow at the start)
  // → Lv. 2 = 20 min, Lv. 5 ≈ 3.5 h, Lv. 10 ≈ 14 h, Lv. 20 ≈ 50 h, Lv. 25 ≈ 74 h
  const LEVEL_STEP = 20;
  const LEVEL_POW = 1.7;
  const MAX_LEVEL = 99;

  /** The rewards, in level order. `kind` says where it shows in Customize. */
  const REWARDS = Object.freeze([
    { level: 2, kind: 'accessory', id: 'star', label: 'Star' },
    { level: 3, kind: 'palette', id: 'midnight', label: 'Midnight color' },
    { level: 4, kind: 'eyes', id: 'hearts', label: 'Heart eyes' },
    { level: 5, kind: 'accessory', id: 'beanie', label: 'Bobble hat' },
    { level: 6, kind: 'palette', id: 'aurora', label: 'Aurora color' },
    { level: 8, kind: 'accessory', id: 'sparkles', label: 'Effect: sparkles' },
    { level: 10, kind: 'accessory', id: 'wizard', label: 'Wizard hat' },
    { level: 12, kind: 'palette', id: 'gold', label: 'Gold color' },
    { level: 15, kind: 'accessory', id: 'halo', label: 'Halo' },
    { level: 18, kind: 'palette', id: 'galaxy', label: 'Galaxy color' },
    { level: 20, kind: 'accessory', id: 'glow', label: 'Effect: glow' },
    { level: 25, kind: 'accessory', id: 'royal', label: 'Royal crown' },
  ].concat(SKINS_19()).sort((a, b) => a.level - b.level));

  /**
   * 1.9.0: 60 more items, "everything" (the owner's decision): 24 shapes (circle, rounded square and drop
   * are free), 7 colors, 4 eyes, 5 mouths, 5 hairstyles, 9 accessories, 6 effects. Between levels 7 and 37 each level brings
   * a shape plus one more thing; after 37, one item every 1–3 levels, up to 60.
   */
  function SKINS_19() {
    const L = (level, kind, id, label) => ({ level, kind, id, label });
    return [
      L(7, 'palette', 'sunset', 'Sunset color'), L(7, 'shape', 'egg', 'Egg shape'),
      L(9, 'eyes', 'catseye', 'Cat eyes'), L(9, 'shape', 'cloud', 'Cloud shape'),
      L(11, 'mouth', 'o', 'Surprised mouth'), L(11, 'shape', 'heart', 'Heart shape'),
      L(13, 'hair', 'bun', 'Bun hairstyle'), L(13, 'shape', 'jelly', 'Jelly shape'),
      L(14, 'accessory', 'bowtie', 'Bow tie'), L(14, 'shape', 'ghost', 'Ghost shape'),
      L(16, 'palette', 'ocean', 'Ocean color'), L(16, 'shape', 'star', 'Star shape'),
      L(17, 'eyes', 'happy', 'Happy eyes'), L(17, 'shape', 'pixel', 'Pixel shape'),
      L(19, 'accessory', 'sunglasses', 'Sunglasses'), L(19, 'shape', 'cat', 'Kitty shape'),
      L(21, 'mouth', 'smirk', 'Smirk'), L(21, 'shape', 'flower', 'Flower shape'),
      L(22, 'hair', 'mohawk', 'Mohawk'), L(22, 'shape', 'bunny', 'Bunny shape'),
      L(23, 'accessory', 'fx-bubbles', 'Effect: bubbles'), L(23, 'shape', 'bear', 'Teddy bear shape'),
      L(24, 'palette', 'cherry', 'Cherry color'), L(24, 'shape', 'sun', 'Sun shape'),
      L(26, 'accessory', 'scarf', 'Scarf'), L(26, 'shape', 'fox', 'Fox shape'),
      L(27, 'eyes', 'wink', 'Winking eyes'), L(27, 'shape', 'diamond', 'Diamond shape'),
      L(28, 'mouth', 'teeth', 'Toothy smile'), L(28, 'shape', 'frog', 'Frog shape'),
      L(29, 'hair', 'afro', 'Afro hairstyle'), L(29, 'shape', 'owl', 'Owl shape'),
      L(30, 'accessory', 'fx-hearts', 'Effect: hearts'), L(30, 'shape', 'chick', 'Chick shape'),
      L(31, 'palette', 'latte', 'Latte color'), L(31, 'shape', 'moon', 'Moon shape'),
      L(32, 'accessory', 'cowboy', 'Cowboy hat'), L(32, 'shape', 'mushroom', 'Mushroom shape'),
      L(33, 'mouth', 'fang', 'Fang'), L(33, 'shape', 'clover', 'Clover shape'),
      L(34, 'hair', 'wave', 'Wavy tuft'), L(34, 'shape', 'robot', 'Robot shape'),
      L(35, 'accessory', 'fx-notes', 'Effect: music notes'), L(35, 'shape', 'monster', 'Monster shape'),
      L(36, 'palette', 'neon', 'Neon color'), L(36, 'shape', 'planet', 'Planet shape'),
      L(37, 'accessory', 'wreath', 'Flower wreath'), L(37, 'shape', 'mug', 'Coffee mug shape'),
      L(38, 'eyes', 'big', 'Big eyes'),
      L(39, 'accessory', 'leaf', 'Leaf'),
      L(40, 'accessory', 'fx-snow', 'Effect: snowflakes'),
      L(42, 'palette', 'mono', 'Monochrome color'),
      L(44, 'mouth', 'mustache', 'Mustache'),
      L(46, 'hair', 'side', 'Side-swept hair'),
      L(48, 'accessory', 'gaming', 'Gaming headset'),
      L(50, 'accessory', 'fx-fireflies', 'Effect: fireflies'),
      L(52, 'accessory', 'sleepmask', 'Sleep mask'),
      L(55, 'palette', 'rainbow', 'Rainbow color'),
      L(58, 'accessory', 'astronaut', 'Astronaut helmet'),
      L(60, 'accessory', 'rainbow-arc', 'Effect: rainbow'),
    ];
  }

  const TITLES = [[25, 'Legend'], [20, 'Master'], [15, 'Expert'], [10, 'Focused'], [5, 'Hard-working'], [1, 'Beginner']];

  const xpForLevel = (level) => Math.round(LEVEL_STEP * (Math.max(1, level) - 1) ** LEVEL_POW);

  function levelForXp(xp) {
    const x = Math.max(0, xp);
    let l = Math.floor((x / LEVEL_STEP) ** (1 / LEVEL_POW)) + 1;
    // rounding fix: level L is reached exactly at xpForLevel(L)
    while (l < MAX_LEVEL && xpForLevel(l + 1) <= x) l++;
    while (l > 1 && xpForLevel(l) > x) l--;
    return Math.min(MAX_LEVEL, l);
  }

  const titleFor = (level) => (TITLES.find(([min]) => level >= min) || TITLES[TITLES.length - 1])[1];

  /** What is locked at a level: { shape, palette, eyes, mouth, hair, accessory } (one Set each). */
  function lockedAt(level) {
    const out = { shape: new Set(), palette: new Set(), eyes: new Set(), mouth: new Set(), hair: new Set(), accessory: new Set() };
    for (const r of REWARDS) if (r.level > level) out[r.kind].add(r.id);
    return out;
  }

  /** The reward for an item (or null if it is free from the start). */
  const rewardOf = (kind, id) => REWARDS.find((r) => r.kind === kind && r.id === id) || null;

  /** Removes from the look what is not unlocked yet (goes back to the base values). */
  function lockLook(look, level, defaults = { shape: 'circle', palette: 'lavender', eyes: 'round', mouth: 'smile', hair: 'none' }) {
    const L = lockedAt(level);
    const out = { ...look, accessories: (look.accessories || []).filter((id) => !L.accessory.has(id)) };
    for (const k of ['shape', 'palette', 'eyes', 'mouth', 'hair']) if (L[k].has(out[k])) out[k] = defaults[k];
    return out;
  }

  // ------------------------------------------------ days (local calendar, as in stats.js)
  const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const keyOf = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const addDays = (key, n) => { const d = parseKey(key); d.setDate(d.getDate() + n); return keyOf(d); };
  const isWeekend = (key) => { const w = parseKey(key).getDay(); return w === 0 || w === 6; };

  /**
   * Progress from the per-day totals.
   * @param {Record<string, number>} dayTotals  'YYYY-MM-DD' → active milliseconds (including today, with the running session)
   * @param {string} today  'YYYY-MM-DD'
   */
  function computeProgress(dayTotals, today) {
    const days = Object.keys(dayTotals || {}).filter((d) => d <= today && dayTotals[d] > 0).sort();
    let xp = 0;
    let streak = 0;
    let best = 0;
    let xpToday = 0;
    let totalMs = 0;
    if (days.length) {
      for (let day = days[0]; day <= today; day = addDays(day, 1)) {
        const ms = Math.max(0, dayTotals[day] || 0);
        totalMs += ms;
        let dayXp = Math.floor(ms / 60000) * XP_PER_MIN;
        if (ms >= STREAK_MIN_MS) {
          streak += 1;
          best = Math.max(best, streak);
          dayXp += STREAK_BONUS * Math.min(streak, STREAK_BONUS_CAP_DAYS);
        } else if (day !== today && !isWeekend(day)) {
          streak = 0;                              // a workday without 25 minutes breaks the streak
        }
        xp += dayXp;
        if (day === today) xpToday = dayXp;
      }
    }
    const level = levelForXp(xp);
    const base = xpForLevel(level);
    const next = level >= MAX_LEVEL ? base : xpForLevel(level + 1);
    const todayMs = Math.max(0, (dayTotals || {})[today] || 0);
    const nextReward = REWARDS.find((r) => r.level > level) || null;
    return {
      xp,
      level,
      title: titleFor(level),
      levelXp: xp - base,                 // XP gathered in the current level
      levelSpan: next - base,             // the current level's total size
      toNext: Math.max(0, next - xp),
      streak,
      bestStreak: best,
      todayMs,
      todayCounts: todayMs >= STREAK_MIN_MS,
      todayLeftMs: Math.max(0, STREAK_MIN_MS - todayMs),
      xpToday,
      totalMs,
      unlocked: REWARDS.filter((r) => r.level <= level).map((r) => r.id),
      nextReward,
    };
  }

  /** Rewards earned between two levels (for the new-level notification). */
  const rewardsBetween = (fromLevel, toLevel) => REWARDS.filter((r) => r.level > fromLevel && r.level <= toLevel);

  const api = {
    XP_PER_MIN, STREAK_MIN_MS, STREAK_BONUS, STREAK_BONUS_CAP_DAYS, LEVEL_STEP, LEVEL_POW, MAX_LEVEL, REWARDS, TITLES,
    xpForLevel, levelForXp, titleFor, lockedAt, rewardOf, lockLook, computeProgress, rewardsBetween, addDays, isWeekend,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Progression = api;
})(typeof window !== 'undefined' ? window : globalThis);
