'use strict';
// r2 perf M4: a window created just now (power saver closes the hidden panel) is shown only after its
// page has painted, so a click never shows an empty transparent window. The last request wins.

/**
 * @param {{ maxWaitMs?: number, setTimeout?: Function, clearTimeout?: Function }} [opts]
 */
function createReadyGate(opts = {}) {
  const later = opts.setTimeout || setTimeout;
  const cancelTimer = opts.clearTimeout || clearTimeout;
  const maxWaitMs = opts.maxWaitMs ?? 3000;   // shown anyway after this (a page that never paints)
  let win = null;
  let ready = true;
  let pending = null;
  let timer = null;

  function flush() {
    cancelTimer(timer);
    timer = null;
    ready = true;
    const fn = pending;
    pending = null;
    if (fn) fn();
  }

  return {
    /** A new window: not ready until `event` (default 'ready-to-show'; e.g. a webContents' 'did-finish-load'). */
    reset(w, event = 'ready-to-show') {
      win = w;
      ready = false;
      pending = null;
      cancelTimer(timer);
      timer = null;
      w.once(event, () => { if (win === w) flush(); });
    },
    /** Runs fn now if the page has painted, else once it has. @returns {boolean} ran now */
    show(fn) {
      if (ready) { fn(); return true; }
      pending = fn;
      if (!timer) timer = later(() => { timer = null; if (!ready) flush(); }, maxWaitMs);
      return false;
    },
    /** A hide before the page painted: don't show it later. */
    cancel() { pending = null; },
    get waiting() { return !!pending; },
  };
}

module.exports = { createReadyGate };
