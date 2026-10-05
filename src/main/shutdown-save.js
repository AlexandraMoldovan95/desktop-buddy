'use strict';
// L4 / r2 L1: Windows shutdown / log off skips 'before-quit'. Every window (present and future,
// so a recreated buddy or panel too) gets the 'session-end' hook; the save runs once.

/**
 * @param {{ log: { info: Function, error: Function }, steps: Array<[string, () => void]> }} deps
 *   steps: [name, sync save] pairs; one failing step doesn't stop the others
 */
function createShutdownSaver({ log, steps }) {
  let done = false;
  function run() {
    if (done) return false;
    done = true;
    log.info('main', 'Windows session ending: saving data');
    for (const [name, step] of steps) {
      try { step(); } catch (err) { log.error('main', `shutdown save failed: ${name}`, err); }
    }
    return true;
  }
  /** Hooks every BrowserWindow created from now on. */
  function install(app) {
    app.on('browser-window-created', (_e, win) => win.once('session-end', run));
  }
  return { run, install };
}

module.exports = { createShutdownSaver };
