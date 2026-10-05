'use strict';
// H4: a page process that crashed, was killed (low memory, GPU reset) or hangs is recovered:
// the window reloads; if it fails again within a short time, the window is closed and the
// user is told once (no reload loop).

const RETRY_WINDOW_MS = 10000; // a second crash within this time = give up on that window
const LOOP_WINDOW_MS = 10 * 60000; // r2 M1: crashes + hang restarts counted per window over this time…
const LOOP_MAX = 3;                // …the 3rd one closes the window (slow crash / hang loops end too)
const HANG_MS = 60000;         // a page still hung after this is restarted (r2 perf L3: 60 s, a swapping 4 GB PC can be slow)
const HANG_NOTICE_GAP_MS = 10 * 60000;

/**
 * @param {{
 *   nameOf: (win: any) => string|null,        // which of our windows ('buddy', 'panel', …), null if unknown
 *   log: { warn: Function, error: Function },
 *   notify: (n: { title: string, body: string }) => void,
 *   onGiveUp?: (name: string, win: any) => void,
 *   onGone?: (name: string, win: any) => void,  // per-window cleanup (e.g. a capture in progress)
 *   closeOnly?: string[],                       // short-lived windows: closed, never reloaded
 *   neverKill?: string[],                       // hung windows only logged + one notice, never force-restarted
 *   now?: () => number, setTimeout?: Function, clearTimeout?: Function,
 * }} deps
 */
function createWindowGuard(deps) {
  const now = deps.now || Date.now;
  const later = deps.setTimeout || setTimeout;
  const cancel = deps.clearTimeout || clearTimeout;
  const closeOnly = new Set(deps.closeOnly || []);
  const lastCrash = new Map(); // name → time
  const recent = new Map();    // name → times of recent crashes / forced restarts (r2 M1)
  const neverKill = new Set(deps.neverKill || []);   // only logged + one notice when hung (the panel holds unsaved note text)
  let hangNoticeAt = -Infinity;
  const hangTimers = new Map(); // win → timer

  function gone(win, details = {}) {
    const name = deps.nameOf(win) || 'unknown';
    const reason = details.reason || 'unknown';
    if (reason === 'clean-exit') return 'ignored';
    deps.log.error('window', `${name}: page process gone (${reason}, exit ${details.exitCode})`);
    stopHangTimer(win);
    if (deps.onGone) deps.onGone(name, win);
    if (!win || win.isDestroyed()) return 'destroyed';
    if (closeOnly.has(name) || name === 'unknown') { win.destroy(); return 'closed'; }
    const t = now();
    const prev = lastCrash.get(name);
    lastCrash.set(name, t);
    const times = (recent.get(name) || []).filter((x) => t - x < LOOP_WINDOW_MS);
    times.push(t);
    recent.set(name, times);
    const fast = prev !== undefined && t - prev < RETRY_WINDOW_MS;
    if (fast || times.length >= LOOP_MAX) {
      deps.log.error('window', fast ? `${name}: crashed again within ${RETRY_WINDOW_MS / 1000} s, closing it`
        : `${name}: ${times.length} crashes or restarts within ${LOOP_WINDOW_MS / 60000} min, closing it`);
      recent.delete(name);
      lastCrash.delete(name);
      win.destroy();
      if (deps.onGiveUp) deps.onGiveUp(name, win);
      deps.notify(name === 'buddy'
        ? { title: 'The buddy closed because of an error', body: 'Bring it back from the tray icon → "Reset buddy position".' }
        : { title: 'A window closed because of an error', body: 'The rest of the app still works. If something is missing, restart the app.' });
      return 'gave-up';
    }
    win.webContents.reload();
    return 'reloaded';
  }

  function stopHangTimer(win) {
    if (!hangTimers.has(win)) return;
    cancel(hangTimers.get(win));
    hangTimers.delete(win);
  }

  function unresponsive(win) {
    const name = deps.nameOf(win) || 'unknown';
    deps.log.warn('window', `${name}: page not responding`);
    if (hangTimers.has(win)) return;
    hangTimers.set(win, later(() => {
      hangTimers.delete(win);
      if (!win || win.isDestroyed()) return;
      if (neverKill.has(name)) {
        // r2 perf L3: killing it would lose typed text, and a restart costs memory at the worst moment
        deps.log.error('window', `${name}: still not responding after ${HANG_MS / 1000} s (left running)`);
        const t = now();
        if (t - hangNoticeAt >= HANG_NOTICE_GAP_MS) {
          hangNoticeAt = t;
          deps.notify({ title: 'The panel is not responding', body: 'Give it a moment. If it stays stuck, quit the app from the tray icon and start it again.' });
        }
        return;
      }
      deps.log.error('window', `${name}: still not responding after ${HANG_MS / 1000} s, restarting the page`);
      // ends in 'render-process-gone' → gone() above reloads it
      win.webContents.forcefullyCrashRenderer();
    }, HANG_MS));
  }

  function responsive(win) {
    if (!hangTimers.has(win)) return;
    stopHangTimer(win);
    deps.log.warn('window', `${deps.nameOf(win) || 'unknown'}: responding again`);
  }

  return { gone, unresponsive, responsive };
}

/** Wires the guard to every window, present and future (one place, no per-window code). */
function installWindowGuard(app, BrowserWindow, guard, log) {
  app.on('render-process-gone', (_e, wc, details) => {
    const win = BrowserWindow.fromWebContents(wc);
    // a window we no longer track (or not a window): just log it
    if (!win) { log.error('window', `page process gone (${details && details.reason})`); return; }
    guard.gone(win, details);
  });
  app.on('browser-window-created', (_e, win) => {
    win.on('unresponsive', () => guard.unresponsive(win));
    win.on('responsive', () => guard.responsive(win));
    win.webContents.on('did-fail-load', (_ev, code, desc, _url, isMainFrame) => {
      if (isMainFrame) log.error('window', `page failed to load (${code} ${desc})`);
    });
  });
}

module.exports = { createWindowGuard, installWindowGuard, RETRY_WINDOW_MS, HANG_MS, LOOP_WINDOW_MS, LOOP_MAX };
