'use strict';
// Default settings and their validation. Every change coming from the interface
// goes through sanitizePatch: unknown fields or wrong values are ignored.

const { getPreset, SECURITY } = require('./email-presets');
const { DEFAULT_LOOK, normalizeLook } = require('./buddy-look');

const DEFAULTS = Object.freeze({
  version: 1,
  launchAtLogin: false,
  alwaysOnTop: true,
  buddySize: 64,
  buddyOpacity: 100,
  buddyVisible: true,
  buddyAnimations: true,     // waves, blinks, follows the mouse, sleeps, reacts
  buddyLook: DEFAULT_LOOK,   // color, eyes, mouth, cheeks, hair, accessories (see buddy-look.js)
  buddyPos: null, // { x, y } in screen coordinates
  hideOnBlur: true,
  theme: 'system',
  shortcut: 'CommandOrControl+Shift+Space',
  lastTab: 'clipboard',
  timerVisible: true,
  notificationsEnabled: true,
  trackApps: true,
  trackWindowTitles: true,
  timerOpacity: 100,
  timerPos: null, // { x, y } in screen coordinates
  clipboardEnabled: true,
  clipboardMax: 50,
  clipboardSkipSecrets: true,   // don't save texts that look like API keys / tokens in the history
  progressSeenLevel: null,
  recOneDriveWarned: false,    // the one-time "your recordings folder is in OneDrive" notice was shown (main only)     // the last level celebrated (written only by the main process)
  // simple mode hides advanced controls (never removes a feature); new installs start simple + with the tour.
  // Existing settings files without uiMode migrate to 'full' + tourDone (see withDefaults).
  uiMode: 'simple',            // 'simple' | 'full'
  tourDone: false,             // the first-run tour was finished or closed
  // email: send only (SMTP), see src/main/email/. The IMAP servers stay in settings, unused.
  emailPreset: 'gmail',
  emailAddress: '',
  emailUsername: '',          // empty = same as the address
  emailSmtpHost: 'smtp.gmail.com',
  emailSmtpPort: 465,
  emailSmtpSecurity: 'ssl',
  emailImapHost: 'imap.gmail.com',
  emailImapPort: 993,
  emailImapSecurity: 'ssl',
  emailSendSessionReport: false,
  emailReportTo: '',          // empty = your own address
  emailRecent: [],            // the last addresses you sent notes to (max 6)
  // the encrypted password is stored separately, in emailPassEnc (see secrets.js)
  emailPassEnc: null,
  emailPassFor: null,         // hash of the server + username the password belongs to (main only)
  emailPassReenter: false,    // true after a server change cleared the password
  // window recording (Portfolio edition only, see src/main/recorder/)
  recAuto: false,             // starts by itself when a window from a rule appears (off for new installs; old files keep true)
  recRules: [],               // [{ id, title, enabled }]: "the window title contains …"
  recFolder: '',              // empty = default (see recorder/files.js); changed only from the folder picker
  recQuality: '1080',         // '720' | '1080' | '1440'
  recFps: 30,                 // 15 | 30 | 60
  recSkipIdle: false,         // skips the moments when the picture does not change
  recIdleSec: 1.5,            // after how many seconds without change it pauses
  recMaxMinutes: 30,          // safety: a recording never goes over this
  recMergeSec: 15,            // if the app reopens within this many seconds, we continue in the same file (0 = no)
  recNotify: true,            // notification at start and on save
  recQualityAuto: null,       // true = recQuality/recFps follow the power mode; false = chosen by the user (main only)
  sessionOnLock: 'pause',     // Win+L during a session: 'pause' | 'pause-resume' (resumes on unlock) | 'ignore'
  powerMode: 'auto',          // low-power mode: 'auto' (weak PC detected) | 'on' | 'off'
});
const POWER_MODES = ['auto', 'on', 'off'];
const SESSION_LOCK_MODES = ['pause', 'pause-resume', 'ignore'];

const REC_QUALITIES = ['720', '1080', '1440'];
const MAX_REC_RULES = 20;
const RULE_ID_RE = /^[a-z0-9-]{8,40}$/i;

const BUDDY_SIZES = [48, 64, 80];
const EMAIL_RE = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]+$/;
const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const isEmail = (v) => typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v);
const THEMES = ['system', 'light', 'dark'];
const TABS = ['clipboard', 'notes', 'pictures', 'video', 'session', 'settings'];
const UI_MODES = ['simple', 'full'];
const TIMER_OPACITY_STEPS = [100, 85, 70, 55, 40];
const ACCEL_RE = /^(?:(?:CommandOrControl|Control|Ctrl|Alt|Shift|Super)\+){1,3}(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Up|Down|Left|Right|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Tab|Plus|Minus|`)$/;

function clampInt(v, min, max) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

/** Returns only the valid fields of the patch. Does not touch the API key (it has its own channel). */
function sanitizePatch(patch, current = DEFAULTS) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  // L1: a value that can't become a primitive ({"toString":1}) is dropped, not thrown on
  patch = Object.fromEntries(Object.entries(patch).filter(([, v]) => {
    if (!v || typeof v !== 'object') return true;
    try { String(v); Number(v); return true; } catch { return false; }
  }));
  const bool = (k) => { if (typeof patch[k] === 'boolean') out[k] = patch[k]; };
  ['launchAtLogin', 'alwaysOnTop', 'buddyVisible', 'buddyAnimations', 'hideOnBlur', 'clipboardEnabled', 'timerVisible', 'notificationsEnabled', 'trackApps', 'trackWindowTitles', 'emailSendSessionReport', 'clipboardSkipSecrets', 'recAuto', 'recSkipIdle', 'recNotify', 'tourDone'].forEach(bool);
  if (UI_MODES.includes(patch.uiMode)) out.uiMode = patch.uiMode;
  if ('timerOpacity' in patch) { const n = clampInt(patch.timerOpacity, 40, 100); if (n !== null) out.timerOpacity = n; }

  if ('buddySize' in patch && BUDDY_SIZES.includes(Number(patch.buddySize))) out.buddySize = Number(patch.buddySize);
  if ('buddyOpacity' in patch) { const n = clampInt(patch.buddyOpacity, 60, 100); if (n !== null) out.buddyOpacity = n; }
  if ('clipboardMax' in patch) { const n = clampInt(patch.clipboardMax, 10, 200); if (n !== null) out.clipboardMax = n; }
  if ('buddyLook' in patch && patch.buddyLook && typeof patch.buddyLook === 'object') out.buddyLook = normalizeLook(patch.buddyLook);
  if (THEMES.includes(patch.theme)) out.theme = patch.theme;
  if (POWER_MODES.includes(patch.powerMode)) out.powerMode = patch.powerMode;
  if (SESSION_LOCK_MODES.includes(patch.sessionOnLock)) out.sessionOnLock = patch.sessionOnLock;
  if (TABS.includes(patch.lastTab)) out.lastTab = patch.lastTab;
  if (typeof patch.shortcut === 'string' && (patch.shortcut === '' || ACCEL_RE.test(patch.shortcut))) out.shortcut = patch.shortcut;

  for (const key of ['buddyPos', 'timerPos']) {
    if (!(key in patch)) continue;
    const p = patch[key];
    if (p === null) out[key] = null;
    else if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[key] = { x: Math.round(p.x), y: Math.round(p.y) };
  }

  // ------------------------------------------------ recording
  if (REC_QUALITIES.includes(String(patch.recQuality))) out.recQuality = String(patch.recQuality);
  if ([15, 30, 60].includes(Number(patch.recFps))) out.recFps = Number(patch.recFps);
  if ('recIdleSec' in patch) {
    const n = Number(patch.recIdleSec);
    if (Number.isFinite(n)) out.recIdleSec = Math.min(10, Math.max(0.5, Math.round(n * 2) / 2));
  }
  if ([0, 5, 15, 30, 60].includes(Number(patch.recMergeSec)) && patch.recMergeSec !== '' && patch.recMergeSec !== null) out.recMergeSec = Number(patch.recMergeSec);
  if ('recMaxMinutes' in patch) { const n = clampInt(patch.recMaxMinutes, 1, 240); if (n !== null) out.recMaxMinutes = n; }
  if (Array.isArray(patch.recRules)) {
    const rules = [];
    for (const r of patch.recRules.slice(0, MAX_REC_RULES)) {
      if (!r || typeof r !== 'object' || typeof r.title !== 'string') continue;
      // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
      const title = r.title.replace(/[\x00-\x1f]/g, '').trim().slice(0, 120);
      if (!title) continue;
      const id = typeof r.id === 'string' && RULE_ID_RE.test(r.id) ? r.id : `r-${rules.length}-${title.length}-${Date.now().toString(36)}`;
      rules.push({ id, title, enabled: r.enabled !== false });
    }
    out.recRules = rules;
  }

  // ------------------------------------------------ email
  if ('emailPreset' in patch && getPreset(patch.emailPreset)) {
    out.emailPreset = patch.emailPreset;
    // when a known provider is picked we fill in the servers (unless the patch sets them)
    const p = getPreset(patch.emailPreset);
    if (p.smtp && patch.emailPreset !== current.emailPreset) {
      out.emailSmtpHost = p.smtp.host; out.emailSmtpPort = p.smtp.port; out.emailSmtpSecurity = p.smtp.security;
      out.emailImapHost = p.imap.host; out.emailImapPort = p.imap.port; out.emailImapSecurity = p.imap.security;
    }
  }
  for (const key of ['emailAddress', 'emailReportTo']) {
    if (typeof patch[key] !== 'string') continue;
    const v = patch[key].trim();
    if (v === '' || isEmail(v)) out[key] = v;
  }
  if (Array.isArray(patch.emailRecent)) {
    const seen = new Set();
    out.emailRecent = patch.emailRecent.filter((a) => isEmail(a) && !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase())).slice(0, 6);
  }
  if (typeof patch.emailUsername === 'string') {
    const v = patch.emailUsername.trim();
    // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
    if (v.length <= 254 && !/[\s\x00-\x1f]/.test(v)) out.emailUsername = v;
  }
  for (const key of ['emailSmtpHost', 'emailImapHost']) {
    if (typeof patch[key] !== 'string') continue;
    const v = patch[key].trim().toLowerCase();
    if (v === '' || HOST_RE.test(v)) out[key] = v;
  }
  for (const key of ['emailSmtpPort', 'emailImapPort']) {
    if (!(key in patch)) continue;
    const n = Number(patch[key]);
    if (Number.isInteger(n) && n >= 1 && n <= 65535) out[key] = n;
  }
  for (const key of ['emailSmtpSecurity', 'emailImapSecurity']) {
    if (SECURITY.some(([v]) => v === patch[key])) out[key] = patch[key];
  }
  return out;
}

/** A settings file written before simple mode existed (it has content but no uiMode). */
function isLegacy(saved) {
  return !!saved && typeof saved === 'object' && Object.keys(saved).length > 0 && !UI_MODES.includes(saved.uiMode);
}

/** True when loading this saved object changes what is on disk (old file, or old AI keys to drop). */
function needsMigration(saved) {
  if (!saved || typeof saved !== 'object') return false;
  return isLegacy(saved) || LEGACY_KEYS.some((k) => k in saved);
}
// the removed AI assistant: its settings (and the encrypted API key) are dropped on load
const LEGACY_KEYS = ['aiProvider', 'aiModel', 'apiKeyEnc', 'apiKeyHint'];

/** The full settings, starting from the defaults (for old or incomplete files). */
function withDefaults(saved) {
  const base = { ...DEFAULTS };
  if (!saved || typeof saved !== 'object') return base;
  if (isLegacy(saved)) {
    // existing users keep everything visible and don't get the tour; recAuto keeps its old default
    base.uiMode = 'full';
    base.tourDone = true;
    base.recAuto = true;
  }
  Object.assign(base, sanitizePatch(saved, base));
  if (typeof saved.emailPassEnc === 'string') base.emailPassEnc = saved.emailPassEnc;
  if (typeof saved.emailPassFor === 'string') base.emailPassFor = saved.emailPassFor;
  if (saved.emailPassReenter === true) base.emailPassReenter = true;
  // the recordings folder never comes from pages (only from the folder picker), but it is kept on restart
  if (typeof saved.recFolder === 'string' && saved.recFolder.length <= 500) base.recFolder = saved.recFolder;
  // the last level celebrated: written only by the main process (otherwise it would announce the level again on every start)
  if (typeof saved.recQualityAuto === 'boolean') base.recQualityAuto = saved.recQualityAuto;
  if (saved.recOneDriveWarned === true) base.recOneDriveWarned = true;
  if (Number.isInteger(saved.progressSeenLevel) && saved.progressSeenLevel >= 1 && saved.progressSeenLevel <= 999) base.progressSeenLevel = saved.progressSeenLevel;
  return base;
}

/** What the interface sees: without the encrypted password. */
function publicView(s) {
  const { emailPassEnc, emailPassFor, emailPassReenter, recFolder, ...rest } = s; // recFolder: pages never get paths
  for (const k of LEGACY_KEYS) delete rest[k];
  return {
    ...rest,
    emailPassword: { saved: !!emailPassEnc, ...(!emailPassEnc && emailPassReenter ? { reenter: true } : {}) },
  };
}

module.exports = { UI_MODES, isLegacy, needsMigration, POWER_MODES, SESSION_LOCK_MODES, REC_QUALITIES, MAX_REC_RULES, DEFAULTS, BUDDY_SIZES, THEMES, TABS, ACCEL_RE, TIMER_OPACITY_STEPS, isEmail, HOST_RE, sanitizePatch, withDefaults, publicView };
