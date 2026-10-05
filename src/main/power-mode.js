'use strict';
// Low-power mode for weak PCs (4 GB RAM, dual-core): fewer animations, slower polling,
// hidden windows closed sooner, lighter recording defaults. Pure functions, tested.

const GB = 2 ** 30;
const WEAK_RAM_BYTES = 4.5 * GB;
const WEAK_CPUS = 2;
const MODES = ['auto', 'on', 'off'];

/** Hardware facts used by 'auto'. */
function detect({ totalmem, cpus }) {
  const ramGB = Math.round((totalmem / GB) * 10) / 10;
  const weakRam = totalmem > 0 && totalmem <= WEAK_RAM_BYTES;
  const weakCpu = cpus > 0 && cpus <= WEAK_CPUS;
  return { ramGB, cpus, weak: weakRam || weakCpu, weakRam, weakCpu };
}

/** Effective state for a setting value ('auto' | 'on' | 'off') and the detected hardware. */
function resolve(mode, hw) {
  const m = MODES.includes(mode) ? mode : 'auto';
  const low = m === 'on' ? true : m === 'off' ? false : !!hw.weak;
  let reason = '';
  if (m === 'auto') {
    if (hw.weakRam) reason = `${hw.ramGB} GB RAM`;
    else if (hw.weakCpu) reason = `${hw.cpus} ${hw.cpus === 1 ? 'core' : 'cores'}`;
  }
  return { mode: m, low, auto: m === 'auto', reason, ramGB: hw.ramGB, cpus: hw.cpus };
}

/** Recording defaults: only applied while the user has not picked quality / fps themselves. */
function recDefaults(low) {
  return low ? { recQuality: '720', recFps: 15 } : { recQuality: '1080', recFps: 30 };
}

/**
 * Settings saved before recQualityAuto existed: a non-default quality or fps was an explicit choice.
 * @returns {boolean} true = the app may manage recQuality / recFps
 */
function recAutoFromLegacy(s) {
  return String(s.recQuality) === '1080' && Number(s.recFps) === 30;
}

/** Patch to apply so recQuality / recFps follow the mode, or null when nothing changes. */
function recPatch(s, low) {
  if (s.recQualityAuto === false) return null;
  const d = recDefaults(low);
  const patch = {};
  if (s.recQualityAuto !== true) patch.recQualityAuto = recAutoFromLegacy(s);
  if (patch.recQualityAuto === false) return patch;
  if (s.recQuality !== d.recQuality) patch.recQuality = d.recQuality;
  if (s.recFps !== d.recFps) patch.recFps = d.recFps;
  return Object.keys(patch).length ? patch : null;
}

/** Polling and window lifetimes for the current mode. */
function tuning(low) {
  return {
    lookMs: low ? 250 : 120,          // buddy eyes follow the mouse
    rulePollMs: low ? 3000 : 2000,    // auto-record rules, while nothing is recording
    panelIdleDestroyMs: low ? 5 * 60000 : 0,   // 0 = keep the hidden panel
  };
}

module.exports = { detect, resolve, recDefaults, recPatch, recAutoFromLegacy, tuning, MODES, WEAK_RAM_BYTES };
