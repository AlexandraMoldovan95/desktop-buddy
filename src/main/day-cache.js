'use strict';
// Small caches over the per-day session files, so startup and the stats window don't re-read years of history.
//  - totals: { day: activeMs } for every day file, kept in progress-totals.json (~20 KB for years of use).
//    Startup reads that file plus only the days it doesn't know yet, asynchronously.
//  - rows: one "Workdays" row per past day, in memory, built on the first stats open (async reads).
// Past days don't change, except when a session is stopped (update(days) refreshes those days).

const path = require('path');
const fs = require('fs');
const S = require('./sessions');
const ST = require('./stats');

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECENT_DAYS = 2;   // the newest days are always re-read (a crash between a day write and the cache write)
const num = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const sumMs = (records) => records.reduce((t, r) => t + (r && num(r.activeMs) ? r.activeMs : 0), 0);

class DayCache {
  /**
   * @param {{ daysDir: string, file: string, fsp?: typeof fs.promises, now?: () => number, log?: (msg:string) => void }} o
   */
  constructor({ daysDir, file, fsp = fs.promises, now = () => Date.now(), log = (m) => console.warn(m) }) {
    this.daysDir = daysDir;
    this.file = file;
    this.fsp = fsp;
    this.now = now;
    this.log = log;
    this.totals = null;        // { day: ms }, null until load() finished
    this.rows = new Map();     // day -> workdays row | null (no valid sessions)
    this.saving = null;
    this.saveAgain = false;
  }

  get ready() { return this.totals !== null; }

  /** Day keys that have a file, ascending. */
  async dayKeys() {
    let files;
    try { files = await this.fsp.readdir(this.daysDir); } catch (err) {
      if (err.code !== 'ENOENT') this.log(`[days] can't list ${this.daysDir}: ${err.message}`);
      return [];
    }
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter((d) => DAY_RE.test(d)).sort();
  }

  /** A day's records, read asynchronously; a missing or broken file counts as empty (JsonStore deals with repairs). */
  async readDay(day) {
    let raw;
    try { raw = await this.fsp.readFile(path.join(this.daysDir, `${day}.json`), 'utf8'); } catch (err) {
      if (err.code !== 'ENOENT') this.log(`[days] can't read ${day}: ${err.message}`);
      return [];
    }
    try {
      const d = JSON.parse(raw);
      return Array.isArray(d && d.sessions) ? d.sessions : [];
    } catch {
      this.log(`[days] the file for day ${day} is broken, skipping it`);
      return [];
    }
  }

  /** Startup: cached totals + only the days the cache doesn't know (and the newest ones). */
  async load() {
    let cached = {};
    try {
      const d = JSON.parse(await this.fsp.readFile(this.file, 'utf8'));
      if (d && d.version === 1 && d.totals && typeof d.totals === 'object') {
        for (const [k, v] of Object.entries(d.totals)) if (DAY_RE.test(k) && num(v)) cached[k] = v;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') this.log(`[days] rebuilding ${path.basename(this.file)}: ${err instanceof SyntaxError ? 'broken file' : err.message}`);   // r2 sec L5: no file text
      cached = {};
    }
    const keys = await this.dayKeys();
    const recentFrom = ST.addDays(S.dayKey(this.now()), -RECENT_DAYS);
    const totals = {};
    let changed = Object.keys(cached).length !== keys.length;
    for (const day of keys) {
      if (day in cached && day < recentFrom) { totals[day] = cached[day]; continue; }
      totals[day] = sumMs(await this.readDay(day));
      if (totals[day] !== cached[day]) changed = true;
    }
    this.totals = totals;
    if (changed) await this.save();
    return totals;
  }

  /** Totals of the days before `today` (today comes live from SessionManager). */
  totalsBefore(today) {
    const out = {};
    for (const [day, ms] of Object.entries(this.totals || {})) if (day < today && ms > 0) out[day] = ms;
    return out;
  }

  /**
   * After a session stop wrote these days: refresh them from the records in memory.
   * @param {string[]} days  @param {(day:string) => object[]} getRecords  (SessionManager.dayRecords)
   */
  update(days, getRecords) {
    for (const day of days || []) {
      if (!DAY_RE.test(day)) continue;
      this.rows.delete(day);
      if (this.totals) this.totals[day] = sumMs(getRecords(day) || []);
    }
    if (this.totals) this.save();
  }

  /** "Workdays" list: cached rows for past days + live summaries for today and the running session. */
  async workdays(sessions) {
    const keys = await this.dayKeys();
    const now = this.now();
    const live = new Set([S.dayKey(now)]);
    const cur = sessions.session;
    if (cur) {
      const segs = cur.segments.map((x) => ({ start: x.start, end: x.end ?? now }));
      Object.keys(S.splitByDay(segs)).forEach((d) => live.add(d));
    }
    const present = new Set(keys);
    for (const day of [...this.rows.keys()]) if (!present.has(day)) this.rows.delete(day);
    const out = [];
    for (const day of keys) {
      if (live.has(day)) continue;
      if (!this.rows.has(day)) this.rows.set(day, ST.workdayRow(day, await this.readDay(day)));
      const row = this.rows.get(day);
      if (row) out.push(row);
    }
    // live days are cheap (one or two days) and go through SessionManager (same data as the day details)
    const liveRows = ST.workdaysList([...live].map((d) => sessions.daySummary(d)));
    return out.concat(liveRows).sort((a, b) => (a.day < b.day ? 1 : -1));
  }

  /** Atomic async write (tmp + rename); calls during a write are coalesced into one more write. */
  async save() {
    if (this.saving) { this.saveAgain = true; return this.saving; }
    this.saving = (async () => {
      do {
        this.saveAgain = false;
        const tmp = `${this.file}.tmp`;
        try {
          await this.fsp.writeFile(tmp, JSON.stringify({ version: 1, totals: this.totals || {} }), 'utf8');
          await this.fsp.rename(tmp, this.file);
        } catch (err) {
          // only a cache: the next start rebuilds it from the day files
          this.log(`[days] can't save ${path.basename(this.file)}: ${err.message}`);
        }
      } while (this.saveAgain);
      this.saving = null;
    })();
    return this.saving;
  }
}

module.exports = { DayCache, RECENT_DAYS };
