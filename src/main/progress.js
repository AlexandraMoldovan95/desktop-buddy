'use strict';
// The buddy's progress (XP, level, streak), computed from the per-day session files.
// The rules are in src/shared/progression.js; here we only add up the per-day totals and announce the changes.

const P = require('../shared/progression');
const S = require('./sessions');

const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

class ProgressTracker {
  /**
   * @param {{ sessions: import('./session-manager').SessionManager, now?: () => number,
   *           getSeen: () => number|null, setSeen: (level: number) => void,
   *           pastTotals?: (today: string) => Object<string, number>,
   *           onChange?: (p) => void, onLevelUp?: (p, rewards: object[], first: boolean) => void }} deps
   */
  constructor(deps) {
    this.d = deps;
    this.now = deps.now || (() => Date.now());
    this.cache = null;       // { today, totals } — past days don't change anymore
    this.last = null;
    this.lastKey = '';
    this.timer = null;
  }

  start(everyMs = 20000) {
    this.refresh();
    this.timer = setInterval(() => this.refresh(), everyMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() { clearInterval(this.timer); this.timer = null; }

  /** After Stop (a new day was written to the files) or when the day changes. */
  invalidate() { this.cache = null; }

  history(today) {
    // the app passes the cached totals (day-cache.js): no reading of every day file
    if (this.d.pastTotals) return this.d.pastTotals(today);
    if (this.cache && this.cache.today === today) return this.cache.totals;
    const totals = {};
    for (const day of this.d.sessions.dayKeys()) {
      if (day >= today) continue;
      const ms = this.d.sessions.dayRecords(day).reduce((t, r) => t + (r && num(r.activeMs) ? r.activeMs : 0), 0);
      if (ms > 0) totals[day] = ms;
    }
    this.cache = { today, totals };
    return totals;
  }

  compute() {
    const today = S.dayKey(this.now());
    const totals = { ...this.history(today), [today]: this.d.sessions.today().totalMs };
    return P.computeProgress(totals, today);
  }

  /** Recomputes; announces the changes and new levels. */
  refresh() {
    const p = this.compute();
    this.last = p;
    const seen = this.d.getSeen();
    if (seen === null || seen === undefined) {
      // the first start with progress: the level from the history, no celebration for every level
      this.d.setSeen(p.level);
      if (p.level > 1 && this.d.onLevelUp) this.d.onLevelUp(p, P.rewardsBetween(1, p.level), true);
    } else if (p.level > seen) {
      this.d.setSeen(p.level);
      if (this.d.onLevelUp) this.d.onLevelUp(p, P.rewardsBetween(seen, p.level), false);
    }
    const key = `${p.xp}|${p.level}|${p.streak}|${p.todayCounts}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      if (this.d.onChange) this.d.onChange(p);
    }
    return p;
  }

  get level() { return (this.last || this.compute()).level; }
}

module.exports = { ProgressTracker };
