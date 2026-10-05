'use strict';
// Limits for IPC calls a broken or compromised page could repeat in a loop (disk / memory).

/** At most `max` calls per `windowMs`. take() → true if allowed. */
function rateLimiter({ max, windowMs, now = Date.now }) {
  let stamps = [];
  return {
    take() {
      const t = now();
      stamps = stamps.filter((x) => t - x < windowMs);
      if (stamps.length >= max) return false;
      stamps.push(t);
      return true;
    },
  };
}

// The editor exports at most 16 Mbit/s × 1.5 (1440p, 60 fps); allow 2× that, plus a margin.
const EXPORT_MAX_BITS_PER_SEC = 24e6;
/** Byte cap for one export job of `totalMs` milliseconds. */
function exportByteCap(totalMs) {
  const sec = (Number.isFinite(totalMs) && totalMs > 0 ? totalMs : 0) / 1000 + 30;
  return Math.ceil(sec * (EXPORT_MAX_BITS_PER_SEC / 8) * 2);
}

const MIN_FREE_BYTES = 1024 * 1024 * 1024; // keep 1 GB free on the disk (HDD of the weak PC)

/** True if the disk holding `dir` has at least `need` bytes free. Unknown (statfs unsupported) = true. */
async function hasFreeSpace(fsp, dir, need = MIN_FREE_BYTES) {
  if (typeof fsp.statfs !== 'function') return true;
  try {
    const st = await fsp.statfs(dir);
    return st.bavail * st.bsize >= need;
  } catch (e) {
    console.warn('[limits] free space unknown:', e.code || e.message);
    return true; // cannot tell: do not block the user
  }
}

module.exports = { rateLimiter, exportByteCap, hasFreeSpace, MIN_FREE_BYTES };
