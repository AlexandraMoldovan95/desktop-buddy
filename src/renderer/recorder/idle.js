'use strict';
// "Nothing is moving" detection (pure functions; they run in the page and in the Node tests).
// We compare downscaled frames (e.g. 96×54, grayscale): a small change, like a blinking cursor,
// doesn't count; a new window, a click with a visual effect or typed text does.
(function (root) {
  /** Brightness of every pixel in an RGBA buffer (ImageData.data). */
  function toGray(rgba) {
    const out = new Uint8Array(rgba.length / 4);
    for (let i = 0, j = 0; i < rgba.length; i += 4, j++) out[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    return out;
  }

  /** How different two frames are: the fraction of pixels that changed visibly (0…1). */
  function changedFraction(a, b, pixelThreshold = 12) {
    if (!a || !b || a.length !== b.length || !a.length) return 1;
    let changed = 0;
    for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > pixelThreshold) changed++;
    return changed / a.length;
  }

  /**
   * The "moving / paused" state. `update(frame, now)` returns 'record' or 'pause'.
   * It pauses only after `idleMs` with no change; it resumes on the first change.
   */
  function createIdleDetector({ idleMs = 1500, minChange = 0.002 } = {}) {
    let last = null;
    let lastChangeAt = null;
    return {
      update(frame, now) {
        const moved = last === null || changedFraction(last, frame) > minChange;
        last = frame;
        if (moved || lastChangeAt === null) lastChangeAt = now;
        return now - lastChangeAt >= idleMs ? 'pause' : 'record';
      },
      reset() { last = null; lastChangeAt = null; },
    };
  }

  const api = { toGray, changedFraction, createIdleDetector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Idle = api;
})(typeof window !== 'undefined' ? window : globalThis);
