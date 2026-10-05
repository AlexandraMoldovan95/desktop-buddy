'use strict';
// When the activity helper should run. Starting it is expensive on Windows (PowerShell cold start +
// Add-Type compiling C#), so a short pause keeps it alive; samples taken while paused are ignored
// by SessionManager.recordActivity.

const PAUSE_KEEP_MS = 15 * 60000;

/**
 * @param {{ session: object|null, trackApps: boolean, pausedSince: number|null, now: number }} o
 * @returns {'run'|'keep'|'stop'}  keep = leave it as it is (running if it was), for at most PAUSE_KEEP_MS
 */
function trackerPlan({ session, trackApps, pausedSince, now, keepMs = PAUSE_KEEP_MS }) {
  if (!session || !trackApps) return 'stop';
  if (session.state === 'running') return 'run';
  if (pausedSince !== null && now - pausedSince >= keepMs) return 'stop';
  return 'keep';
}

module.exports = { trackerPlan, PAUSE_KEEP_MS };
