'use strict';
// The buddy's "mood", from the main process: when it sleeps, where it looks, what it reacts to.
// The buddy page only draws (CSS classes). There is no UI here, so the logic can be tested.

const SLEEP_AFTER_SEC = 180;    // no running session and no mouse / keyboard for 3 minutes → falls asleep
const LOOK_MS = 120;            // how often we check where the mouse is (only while the buddy is visible)
const LOOK_RANGE = 320;         // how many pixels from the buddy the gaze reaches its limit
const LOOK_IDLE_SEC = 30;       // no mouse / keyboard for this long: the eyes stop following (no polling)
const REACTIONS = ['wave', 'happy', 'wow', 'yawn', 'think-on', 'think-off', 'sleep', 'wake', 'levelup'];

/** Falls asleep only if animations are on, no session is running and you are away from the computer. */
function shouldSleep({ enabled, sessionRunning, idleSec, sleepAfterSec = SLEEP_AFTER_SEC }) {
  return !!enabled && !sessionRunning && idleSec >= sleepAfterSec;
}

/** The gaze direction: from the buddy's center toward the mouse, in [-1, 1], rounded (so we don't send needless messages). */
function lookVector(cursor, bounds, range = LOOK_RANGE) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  const round = (v) => Math.round(v * 10) / 10 || 0;
  return { x: round(clamp((cursor.x - cx) / range)), y: round(clamp((cursor.y - cy) / range)) };
}

class BuddyMood {
  /**
   * @param {{ send: (channel: string, payload: object) => void, isEnabled: () => boolean,
   *           isSessionRunning: () => boolean, getIdleSec: () => number, isVisible: () => boolean,
   *           getCursor: () => {x,y}, getBounds: () => {x,y,width,height}|null, sleepAfterSec?: number }} deps
   */
  constructor(deps) {
    this.d = deps;
    this.sleepAfterSec = deps.sleepAfterSec || SLEEP_AFTER_SEC;
    this.sleeping = false;
    this.thinking = 0;       // how many AI requests are in progress
    this.lastLook = null;
    this.timers = [];
    this.lookTimer = null;
    this.lookTimerMs = 0;
  }

  start() {
    this.timers.push(setInterval(() => this.tick(), 5000));
    this.syncLook();
  }

  stop() { this.timers.forEach(clearInterval); this.timers = []; this.setLookMs(0); }

  /**
   * The mouse is polled only while the eyes can move: animations on, awake, buddy visible,
   * someone at the computer (L1). Re-checked by tick() every 5 s and on every state change.
   */
  syncLook() {
    if (!this.timers.length) return;   // not started (or stopped)
    const want = !this.sleeping && this.d.isEnabled() && this.d.isVisible() && this.d.getIdleSec() < LOOK_IDLE_SEC;
    this.setLookMs(want ? (this.d.lookMs ? this.d.lookMs() : LOOK_MS) : 0);
  }

  setLookMs(ms) {
    if (ms === this.lookTimerMs) return;
    if (this.lookTimer) clearInterval(this.lookTimer);
    this.lookTimer = ms ? setInterval(() => this.lookTick(), ms) : null;
    this.lookTimerMs = ms;
  }

  /** The buddy page loaded: the configuration + the startup wave. */
  ready() {
    this.sendConfig();
    const t = setTimeout(() => this.react('wave'), 700);   // after the window appears
    if (t.unref) t.unref();
  }

  /** From Settings → Buddy: plays an animation on request (for a presentation). */
  demo(type) {
    if (!this.d.isEnabled()) return false;
    if (type === 'sleep') {
      if (this.thinking) return false;
      this.sleeping = true;
      this.d.send('buddy:react', { type: 'sleep' });
      return true;
    }
    this.wake();
    if (type === 'think') {
      this.thinkStart();
      const t = setTimeout(() => this.thinkEnd({ happy: true }), 3000);
      if (t.unref) t.unref();
      return true;
    }
    return this.react(type);
  }

  sendConfig() {
    this.d.send('buddy:config', { animations: this.d.isEnabled(), lowPower: !!(this.d.isLowPower && this.d.isLowPower()), look: this.d.getLook ? this.d.getLook() : null });
    this.syncLook();
  }

  react(type) {
    if (!REACTIONS.includes(type) || !this.d.isEnabled()) return false;
    if (this.sleeping && type !== 'wake' && type !== 'think-on') return false;
    this.d.send('buddy:react', { type });
    return true;
  }

  /** The periodic check: falls asleep / wakes up. */
  tick() {
    const enabled = this.d.isEnabled();
    const sessionRunning = this.d.isSessionRunning();
    if (!this.sleeping && shouldSleep({ enabled, sessionRunning, idleSec: this.d.getIdleSec(), sleepAfterSec: this.sleepAfterSec }) && !this.thinking) {
      this.sleeping = true;
      this.d.send('buddy:react', { type: 'sleep' });
    } else if (this.sleeping && (!enabled || sessionRunning)) {
      this.wake();
    }
    this.syncLook();
  }

  /** Woken by the app (panel open, session started, AI). */
  wake() {
    if (!this.sleeping) return;
    this.sleeping = false;
    this.d.send('buddy:react', { type: 'wake' });
    this.syncLook();
  }

  /** You woke it, from the page (hover / click). */
  woke() { this.sleeping = false; this.syncLook(); }

  thinkStart() {
    this.thinking++;
    this.wake();
    this.react('think-on');
  }

  thinkEnd({ happy = false } = {}) {
    this.thinking = Math.max(0, this.thinking - 1);
    if (this.thinking) return;
    this.react('think-off');
    if (happy) this.react('happy');
  }

  lookTick() {
    if (this.sleeping || !this.d.isEnabled() || !this.d.isVisible()) return;
    const b = this.d.getBounds();
    if (!b) return;
    const v = lookVector(this.d.getCursor(), b);
    if (this.lastLook && v.x === this.lastLook.x && v.y === this.lastLook.y) return;
    this.lastLook = v;
    this.d.send('buddy:look', v);
  }
}

module.exports = { BuddyMood, shouldSleep, lookVector, REACTIONS, SLEEP_AFTER_SEC, LOOK_IDLE_SEC };
