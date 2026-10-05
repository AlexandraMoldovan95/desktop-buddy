'use strict';
// Reminders in notes (1.7.0), in the main process: when they ring, what was missed while the app was closed.
// The state lives in the note (notes.json → remind.status), so a reminder never rings twice, not even after a restart.
//
//  pending ──(the time came, app running)──▶ fired   → notification + the buddy waves
//  pending ──(the time passed with the app closed)──▶ missed → at startup: "You missed N reminders"
//  fired / missed ──(Snooze)──▶ pending ; ──(Done)──▶ no reminder

const CHECK_EVERY_MS = 15000;      // safety net (sleep, clock change); otherwise, one timer for the next reminder
const STARTUP_GRACE_MS = 60000;    // at startup: what passed at most 1 minute ago still rings normally, it isn't "missed"

/** The reminders that are due, in time order. */
function due(notes, now) {
  return notes.filter((n) => n.remind && n.remind.status === 'pending' && n.remind.at <= now).sort((a, b) => a.remind.at - b.remind.at);
}

/** The next pending reminder time (ms) or null. */
function nextAt(notes) {
  let best = null;
  for (const n of notes) if (n.remind && n.remind.status === 'pending' && (best === null || n.remind.at < best)) best = n.remind.at;
  return best;
}

class ReminderScheduler {
  /**
   * @param {{
   *   getNotes: () => object[],
   *   setStatus: (ids: string[], status: 'fired'|'missed', now: number) => void,
   *   onFire: (note: object, lateMs: number) => void,
   *   onMissed: (notes: object[]) => void,
   *   now?: () => number, setTimer?: Function, clearTimer?: Function,
   * }} deps
   */
  constructor(deps) {
    this.d = { now: Date.now, setTimer: setTimeout, clearTimer: clearTimeout, ...deps };
    this.timer = null;
    this.running = false;
  }

  /** At app startup: first what was missed, then what rings now. */
  start() {
    this.running = true;
    const now = this.d.now();
    const missed = due(this.d.getNotes(), now - STARTUP_GRACE_MS);
    if (missed.length) {
      this.d.setStatus(missed.map((n) => n.id), 'missed', now);
      this.d.onMissed(missed);
    }
    this.check();
  }

  stop() {
    this.running = false;
    if (this.timer) this.d.clearTimer(this.timer);
    this.timer = null;
  }

  /** Rings what is due and schedules the next check. Safe to call at any time (after set / delete / sleep). */
  check() {
    if (!this.running) return [];
    const now = this.d.now();
    const list = due(this.d.getNotes(), now);
    if (list.length) {
      this.d.setStatus(list.map((n) => n.id), 'fired', now);
      for (const n of list) this.d.onFire(n, now - n.remind.at);
    }
    this.schedule();
    return list;
  }

  schedule() {
    if (this.timer) this.d.clearTimer(this.timer);
    this.timer = null;
    if (!this.running) return;
    const next = nextAt(this.d.getNotes());
    const wait = next === null ? CHECK_EVERY_MS : Math.max(250, Math.min(CHECK_EVERY_MS, next - this.d.now()));
    this.timer = this.d.setTimer(() => { this.timer = null; this.check(); }, wait);
    if (this.timer && this.timer.unref) this.timer.unref();
  }
}

module.exports = { ReminderScheduler, due, nextAt, CHECK_EVERY_MS, STARTUP_GRACE_MS };
