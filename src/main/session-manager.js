'use strict';
// The active session + the per-day files. Saves the active session on every change
// and periodically (AUTOSAVE_MS), so a crash loses at most that much time.

const path = require('path');
const fs = require('fs');
const { JsonStore } = require('./store');
const S = require('./sessions');
const U = require('./activity/usage');
const ST = require('./stats');
const { log } = require('./log');
const { userMessage } = require('./user-error');

const AUTOSAVE_MS = 15000;
const HOUR_CHECK_MS = 5000;  // the "has another hour passed?" check
const MIN_SESSION_MS = 1000; // a session stopped right after start is not saved
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GAP_MS = 60000;    // H3: a longer pause between 5 s ticks = sleep or clock jump, not work

const INVALID_KEEP = 2;   // r2 sec L3: copies of a day file with bad records

/** `<day>.invalid-<time>.json` copies, newest first. */
function invalidCopies(dir, day) {
  let names;
  try { names = fs.readdirSync(dir); } catch (err) { if (err.code !== 'ENOENT') log.warn('session', 'cannot list the days folder', err); return []; }
  const re = new RegExp(`^${day}\\.invalid-(\\d+)\\.json$`);
  return names.map((n) => re.exec(n)).filter(Boolean).sort((a, b) => Number(b[1]) - Number(a[1])).map((m) => path.join(dir, m[0]));
}

/** C1 / L2: a malformed day record (null, string activeMs…) is skipped and logged, never fatal. */
function validRecords(list, day, onDropped) {
  if (!Array.isArray(list)) return [];
  const ok = list.filter((r) => r && typeof r === 'object' && Number.isFinite(r.activeMs) && Number.isFinite(r.start));
  if (ok.length !== list.length) {
    log.warn('session', `${day}.json: skipped ${list.length - ok.length} invalid record(s)`);
    onDropped();
  }
  return ok;
}
const DAY_CACHE_MAX = 40;    // parsed day files kept in memory (LRU): the last 30 days view + a few

class SessionManager {
  /**
   * @param {{ dir: string, onChange: (state:object) => void, onHour?: (hours:number, session:object) => void, now?: () => number }} opts
   */
  constructor({ dir, onChange, onHour, now, mono, hourMs = 3600000, onStoreProblem }) {
    // H3: wall clock for the data, monotonic clock to spot wall-clock jumps.
    // An injected `now` (tests) without `mono` uses `now` for both (no jump detection).
    if (!mono) mono = now || (() => performance.now());
    if (!now) now = () => Date.now();
    this.mono = mono;
    this.beat = null;           // { wall, mono } at the last check
    this.suspendedAt = null;
    this.pausedByLock = false;   // the last pause came from Win+L (for "pause, then go on")
    this.onStoreProblem = onStoreProblem;
    this.onHour = onHour || (() => {});
    this.lastTickAt = 0; // the last active-app sample (0 = the next one doesn't count)
    this.hourMs = hourMs; // can be shortened only for manual tests (see main.js)
    this.hourTimer = null;
    this.dir = dir;
    this.daysDir = path.join(dir, 'sessions');
    this.onChange = onChange || (() => {});
    this.now = now;
    this.days = new Map();
    this.timer = null;
    this.active = new JsonStore(path.join(dir, 'active-session.json'), () => ({ version: 1, session: null }), {
      onProblem: onStoreProblem,
      normalize: (d) => ({ version: 1, session: d && d.session && Array.isArray(d.session.segments) ? d.session : null }),
    });
    // recovery: if the app stopped suddenly, the session stays paused, closed at the last save
    if (this.active.data.session && this.active.data.session.state === 'running') {
      this.active.data.session = S.recoverSession(this.active.data.session);
      this.active.flush();
    }
  }

  get session() { return this.active.data.session; }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.autosave(), AUTOSAVE_MS);
    if (!this.hourTimer) this.hourTimer = setInterval(() => { this.checkClock({ tick: true }); this.checkHours(); }, HOUR_CHECK_MS);
  }

  /**
   * H3: sleep / hibernate and wall-clock jumps must not count as work. On a jump (wall vs
   * monotonic clock differ) or, on the 5 s tick, a gap longer than MAX_GAP_MS, the open
   * segment ends at the previous check and a new one starts now.
   * @returns {boolean} true if the session was split
   */
  checkClock({ tick = false } = {}) {
    const wall = this.now();
    const mono = this.mono();
    const prev = this.beat;
    this.beat = { wall, mono };
    if (!prev) return false;
    const dWall = wall - prev.wall;
    const dMono = mono - prev.mono;
    const jumped = Math.abs(dWall - dMono) > MAX_GAP_MS || dWall < -2000;
    const gap = tick && (dWall > MAX_GAP_MS || dMono > MAX_GAP_MS);
    if (!jumped && !gap) return false;
    return this.splitOpenSegment(prev.wall, wall, jumped ? 'clock jump' : 'gap');
  }

  /** powerMonitor 'suspend': remember when the PC went to sleep. */
  suspend() {
    this.suspendedAt = this.now();
    this.autosave({ sync: true });   // the PC may not wake up: write now
  }

  /** powerMonitor 'resume': the time asleep is not work. */
  resumeFromSleep() {
    const at = this.suspendedAt;
    this.suspendedAt = null;
    if (at !== null && this.splitOpenSegment(at, this.now(), 'sleep')) this.beat = null;
    this.checkClock({ tick: true });
  }

  splitOpenSegment(endAt, startAt, why) {
    const s = this.session;
    if (!s || s.state !== 'running') return false;
    const last = s.segments[s.segments.length - 1];
    if (!last || last.end !== null) return false;
    const end = Math.max(last.start, endAt);
    log.warn('session', `${why}: ${Math.round((startAt - end) / 1000)} s not counted as work`);
    this.set({ ...s, segments: [...s.segments.slice(0, -1), { ...last, end }, { start: startAt, end: null }] });
    return true;
  }

  /** On every full hour of active work (pauses don't count): a single notification. */
  checkHours() {
    const s = this.session;
    const hours = S.hoursToNotify(s, this.now(), this.hourMs);
    if (!hours) return 0;
    this.active.data.session = { ...s, hoursNotified: hours, lastSavedAt: this.now() };
    this.active.flush();
    this.onHour(hours, this.active.data.session);
    return hours;
  }

  /** On a normal app exit: the session is paused, nothing is lost. */
  shutdown() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.hourTimer) { clearInterval(this.hourTimer); this.hourTimer = null; }
    if (this.session && this.session.state === 'running') {
      this.set(S.pauseSession(this.session, this.now()), { silent: true });
    }
    this.active.flush();
    for (const store of this.days.values()) store.flush();
  }

  /** r2 perf M1: the 15 s autosave writes off the main thread; sync only on sleep (stop / quit use flush() directly). */
  autosave({ sync = false } = {}) {
    if (!this.session || this.session.state !== 'running') return Promise.resolve(false);
    this.active.data.session = { ...this.session, lastSavedAt: this.now() };
    if (sync) return Promise.resolve(this.active.flush());
    return this.active.flushAsync();   // never rejects: a failure is reported through onStoreProblem
  }

  /**
   * A sample from the helper: the time since the previous sample is added to the active app.
   * Nothing while paused or without a session. Doesn't save right away: it goes into the periodic save (15 s).
   */
  recordActivity(raw, { titles = true } = {}) {
    const s = this.session;
    const now = this.now();
    if (!s || s.state !== 'running') { this.lastTickAt = 0; return false; }
    const ms = U.tickMs(this.lastTickAt, now);
    this.lastTickAt = now;
    const sample = U.normalizeSample(raw);
    if (!sample || !ms) return false;
    s.usage = s.usage || {};
    U.addUsage(s.usage, S.dayKey(now), sample, ms, { titles });
    return true;
  }

  set(session, { silent = false } = {}) {
    this.lastTickAt = 0; // after start / pause / resume, the first sample only starts the count
    this.active.data.session = session ? { ...session, lastSavedAt: this.now() } : null;
    this.active.flush();
    if (!silent) this.onChange(this.state());
  }

  state() {
    const s = this.session;
    return { session: s, activeMs: S.activeMs(s, this.now()), serverNow: this.now() };
  }

  // ------------------------------------------------ commands
  begin(title) {
    if (this.session) throw new Error('A session is already running. Stop it before starting another one.');
    this.set(S.startSession(title, this.now()));
    return this.state();
  }

  pause() {
    if (!this.session) throw new Error('No session is running.');
    this.checkClock();
    this.set(S.pauseSession(this.session, this.now()));
    return this.state();
  }

  resume() {
    if (!this.session) throw new Error('No session is running.');
    this.set(S.resumeSession(this.session, this.now()));
    return this.state();
  }

  /**
   * Windows was locked (Win+L) during a session. mode = settings.sessionOnLock:
   * 'pause' and 'pause-resume' pause a running session; 'ignore' keeps counting.
   * Returns true if the session was paused.
   */
  onScreenLock(mode) {
    if (mode === 'ignore' || !this.session || this.session.state !== 'running') return false;
    this.pause();
    this.pausedByLock = true;
    log.info('session', 'screen locked: session paused');
    return true;
  }

  /** Windows was unlocked: with 'pause-resume', a session paused by the lock goes on by itself. */
  onScreenUnlock(mode) {
    const byLock = this.pausedByLock;
    this.pausedByLock = false;
    if (mode !== 'pause-resume' || !byLock || !this.session || this.session.state !== 'paused') return false;
    this.resume();
    log.info('session', 'screen unlocked: session resumed');
    return true;
  }

  rename(title) {
    if (!this.session) throw new Error('No session is running.');
    this.set(S.renameSession(this.session, title));
    return this.state();
  }

  /** Stops the session, writes it to its days' files and returns a summary. */
  stop() {
    if (!this.session) throw new Error('No session is running.');
    this.checkClock();
    const now = this.now();
    const s = S.pauseSession(this.session, now);
    const total = S.activeMs(s, now);
    const summary = { ...S.buildReport(s, now), saved: false, days: [] };
    if (total >= MIN_SESSION_MS) {
      // the days first (with flush), only then we delete the active session: on a crash between the two,
      // on restart the session is recovered, and saving again replaces by id (no duplicates)
      let failed = null;
      for (const { day, record } of S.toDayRecords(s, now)) {
        const store = this.dayStore(day);
        store.update((d) => { d.sessions = S.upsertDayRecord(d.sessions, record); });
        if (!store.flush()) { failed = store; break; }
        summary.days.push(day);
      }
      if (failed) {
        // H1: a day file was not written: take the parts back out and keep the session (paused)
        for (const day of summary.days) this.dayStore(day).update((d) => { d.sessions = d.sessions.filter((r) => r.id !== s.id); });
        failed.update((d) => { d.sessions = d.sessions.filter((r) => r.id !== s.id); });
        this.set(s);
        log.error('session', 'stop: day file not saved, session kept (paused)', failed.lastError);
        throw new Error(`The session couldn't be saved to disk (${userMessage(failed.lastError, 'write error')}). It stays paused: try "Stop" again later.`);
      }
      summary.saved = true;
    }
    this.set(null);
    return summary;
  }

  // ------------------------------------------------ days
  dayStore(day) {
    if (!DAY_RE.test(day)) throw new Error('Invalid day.');
    const hit = this.days.get(day);
    if (hit) { this.days.delete(day); this.days.set(day, hit); return hit; }   // most recently used last
    const file = path.join(this.daysDir, `${day}.json`);
    let dropped = false;
    const store = new JsonStore(file, () => ({ version: 1, date: day, sessions: [] }), {
      onProblem: this.onStoreProblem,
      normalize: (d) => ({ version: 1, date: day, sessions: validRecords(d && d.sessions, day, () => { dropped = true; }) }),
    });
    if (dropped) {
      // keep the original next to it (not a day file name, so it is ignored by dayKeys);
      // r2 sec L3: one copy per day (at most INVALID_KEEP), then the day file is repaired once
      const copies = invalidCopies(this.daysDir, day);
      let kept = copies.length > 0;
      if (!kept) {
        try { fs.copyFileSync(file, file.replace(/\.json$/, `.invalid-${Date.now()}.json`)); kept = true; } catch (err) { log.warn('session', `cannot keep a copy of ${day}.json`, err); }
      }
      for (const old of copies.slice(INVALID_KEEP)) {
        try { fs.unlinkSync(old); } catch (err) { log.warn('session', `cannot delete an old copy of ${day}.json`, err); }
      }
      if (kept && !store.readOnly) store.flush();   // the bad record leaves the day file (a copy holds it)
    }
    this.days.set(day, store);
    // bounded: only the most recent DAY_CACHE_MAX days stay parsed in memory
    for (const [old, st] of this.days) {
      if (this.days.size <= DAY_CACHE_MAX) break;
      if (st.timer) st.flush();   // a pending write is never dropped
      this.days.delete(old);
    }
    return store;
  }

  /** A day's sessions (today by default), without the active session. */
  dayRecords(day = S.dayKey(this.now())) {
    const file = path.join(this.daysDir, `${day}.json`);
    if (!this.days.has(day) && !fs.existsSync(file)) return [];
    return this.dayStore(day).data.sessions;
  }

  /** The days that have a file (YYYY-MM-DD), sorted ascending. */
  dayKeys() {
    let files;
    try { files = fs.readdirSync(this.daysDir); } catch { return []; }
    return files.map((f) => f.replace(/\.json$/, '')).filter((d) => DAY_RE.test(d)).sort();
  }

  /** A day's summary, with the running session's part if there is one. */
  daySummary(day) {
    if (!DAY_RE.test(day)) throw new Error('Invalid day.');
    const now = this.now();
    return ST.summarizeDay(day, this.dayRecords(day), ST.activePart(this.session, day, now));
  }

  /** All days with sessions, for "Workdays" (including today, if a session is running). */
  workdays() {
    const days = new Set(this.dayKeys());
    const now = this.now();
    if (this.session) {
      const segs = this.session.segments.map((x) => ({ start: x.start, end: x.end ?? now }));
      Object.keys(S.splitByDay(segs)).forEach((d) => days.add(d));
    }
    return ST.workdaysList([...days].map((d) => this.daySummary(d)));
  }

  /** The last `n` days (including today), for the "Last 30 days" view. */
  lastDays(n = 30) {
    const today = S.dayKey(this.now());
    return ST.rangeSummary(today, (day) => {
      const d = this.daySummary(day);
      return d.sessions.length ? d : null;
    }, n);
  }

  /** Today: finished sessions + the active time of the running session, only today's part. */
  today() {
    const now = this.now();
    const day = S.dayKey(now);
    const records = this.dayRecords(day);
    let activeTodayMs = 0;
    if (this.session) {
      const segs = this.session.segments.map((x) => ({ start: x.start, end: x.end ?? now }));
      activeTodayMs = (S.splitByDay(segs)[day] || []).reduce((t, x) => t + (x.end - x.start), 0);
    }
    const doneMs = records.reduce((t, r) => t + r.activeMs, 0);
    return { day, records, totalMs: doneMs + activeTodayMs, activeTodayMs };
  }
}

module.exports = { DAY_CACHE_MAX, SessionManager, AUTOSAVE_MS, MIN_SESSION_MS, HOUR_CHECK_MS };
