'use strict';
// App startup: single instance, storage, windows, tray, clipboard, global shortcut.

const path = require('path');
const ID = require('../shared/app-identity');
const { app, clipboard, globalShortcut, nativeTheme, safeStorage, BrowserWindow, desktopCapturer, session, shell, dialog, protocol, powerMonitor, screen, Menu, nativeImage } = require('electron');
const { JsonStore } = require('./store');
const { withDefaults, publicView, needsMigration } = require('../shared/settings-schema');
const { createWindows } = require('./windows');
const { createTray } = require('./tray');
const { registerIpc } = require('./ipc');
const { makeSecrets } = require('./secrets');
const clip = require('./clipboard');
const notesLib = require('./notes');
const { SessionManager } = require('./session-manager');
const S = require('./sessions');
const { notify } = require('./notify');
const { ActiveWindowTracker } = require('./activity/tracker');
const { helperCommand } = require('./activity/helpers');
const emailProvider = require('./email/provider');
const passBinding = require('./email/pass-binding');
const permissions = require('./permissions');
const { RecorderManager } = require('./recorder/manager');
const { ClipExporter } = require('./recorder/clips');
const media = require('./recorder/media');
const fs = require('fs');
const emailCompose = require('./email/compose');
const { BuddyMood } = require('./buddy-mood');
const { contextMenuModel, BLOCKED_DICTIONARY_URL } = require('./context-menu');
const { ReminderScheduler } = require('./reminders');
const { ScreenshotService } = require('./screenshots');
const ShotImage = require('./shot-image');
const RT = require('../shared/reminder-time');
const { ProgressTracker } = require('./progress');
const P = require('../shared/progression');
const { normalizeLook } = require('../shared/buddy-look');
const { log, setPrivatePrefixes } = require('./log');
const { createWindowGuard, installWindowGuard } = require('./window-guard');
const { userMessage, storeNotice } = require('./user-error');
const os = require('os');
const PM = require('./power-mode');
const { isInOneDrive } = require('./onedrive');
const { DayCache } = require('./day-cache');
const { trackerPlan, PAUSE_KEEP_MS } = require('./activity/keep-alive');
const { createShutdownSaver } = require('./shutdown-save');
const { existingUserPatch } = require('./existing-user');

if (!app.requestSingleInstanceLock()) {
  // Another copy is running (often the installed app while you try `npm start`): this one only shows that
  // copy's buddy and quits. Say so in the terminal, otherwise it looks like the new code does nothing.
  if (!app.isPackaged) {
    console.log('\n[Desktop Buddy] Another copy is already running, so this one closes and the running copy is shown.');
    console.log('[Desktop Buddy] Probably the installed app. Quit it first: right-click the tray icon → Quit, then run "npm start" again.\n');
  }
  app.quit();
} else {
  // English UI everywhere: Chromium's built-in messages follow en-GB, whatever the Windows display language is.
  // The date / time boxes (reminders) follow the Windows region format instead (e.g. 10/05/2026, 03:22 AM):
  // on purpose, people see dates the way they set them in Windows. Must run before 'ready'.
  app.commandLine.appendSwitch('lang', 'en-GB');
  // the data folder name: %APPDATA%\Desktop Buddy Portfolio (separate from the course app)
  app.setName(ID.NAME);
  // ONLY in development mode: BUDDY_DATA_DIR=<folder> runs on a separate data folder (demo data for screenshots);
  // the real data folder is not touched.
  const devDataDir = !app.isPackaged && process.env.BUDDY_DATA_DIR;
  app.setPath('userData', devDataDir ? path.resolve(devDataDir) : path.join(app.getPath('appData'), ID.DATA_DIR));
  log.init(path.join(app.getPath('userData'), 'logs'));
  // r2 sec L4: user names in these folders never reach the log (even with spaces)
  setPrivatePrefixes([[app.getPath('userData'), '<data>'], [path.dirname(process.execPath), '<app>'], [app.getAppPath(), '<app>'], [app.getPath('home'), '~']]);
  installCrashHandlers();
  // Windows shows notifications only for a known AppUserModelId: in the installed app it is ours
  // (the installer puts the shortcut in Start); in development mode (npm start) Electron needs the executable path.
  if (process.platform === 'win32') app.setAppUserModelId(app.isPackaged ? ID.APP_ID : process.execPath);
  // the clip editor reads videos through "buddy-media://rec/<id>" (with Range, for seeking in the file)
  protocol.registerSchemesAsPrivileged([{ scheme: media.SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);
  start();
}

/** C1: an error nobody caught is logged, and the user sees one calm notice per run (no modal). */
function installCrashHandlers() {
  let told = false;
  process.on('uncaughtException', (err) => {
    log.error('main', 'uncaught exception', err);
    if (told || !app.isReady()) return;
    told = true;
    notify({ title: `${ID.NAME}: something went wrong`, body: 'The app keeps running. If something doesn\'t work, restart it.' });
  });
  process.on('unhandledRejection', (err) => { log.error('main', 'unhandled rejection', err); });
}

/** C1: startup failed: tell the user, release the single-instance lock and quit (no invisible zombie). */
function startupFailed(err) {
  log.fatalSync('main', 'startup failed', err);
  try {
    dialog.showErrorBox(`${ID.NAME} couldn't start`,
      'Something went wrong at startup. Try restarting the app.\n\nThe details are in the log: the app\'s data folder, "logs" subfolder.');
  } finally {
    app.releaseSingleInstanceLock();
    app.exit(1);
  }
}

function start() {
  let windows;
  let tray;
  let watcher;
  let settingsStore;
  let clipboardStore;
  let notesStore;
  let sessions;
  let tracker;
  let activityStatus = { state: 'stopped' };
  let lastReport = null;
  let recorder;
  let recIndex;
  let recQuitDone = false;
  let recTrayKey = '';
  let recLastError = { message: '', at: 0 };
  let clipExporter;
  let mood = null;       // the buddy's animations (see buddy-mood.js)
  let progress = null;   // XP, level, streak (see progress.js and shared/progression.js)
  let reminders = null;  // reminders in notes (see reminders.js)
  let shots = null;      // screenshots (see screenshots.js)

  /** Right-click in the panel: editing, text transforms, "Clean up text". */
  function panelContextMenu(win, params) {
    const model = contextMenuModel(params);
    if (!model.length || win.isDestroyed()) return;
    const wc = win.webContents;
    const toItem = (it) => {
      switch (it.kind) {
        case 'separator': return { type: 'separator' };
        case 'role': return { label: it.label, role: it.role, enabled: it.enabled };
        case 'submenu': return { label: it.label, submenu: it.items.map(toItem) };
        case 'transform': return { label: it.label, click: () => wc.send('text:command', { type: 'transform', kind: it.value }) };
        case 'clean': return { label: it.label, click: () => wc.send('text:command', { type: 'clean' }) };
        default: return null;
      }
    };
    Menu.buildFromTemplate(model.map(toItem).filter(Boolean)).popup({ window: win });
  }
  let prevSessionState = 'none';
  let pausedSince = null;       // the helper stays alive for a while during a pause (M2)
  let pauseStopTimer = null;

  /** App tracking runs only while a session is running (not paused) and if it is turned on. */
  function syncTracker() {
    if (!tracker || !sessions) return;
    const cur = sessions.session;
    if (cur && cur.state !== 'running') { if (pausedSince === null) pausedSince = Date.now(); } else pausedSince = null;
    clearTimeout(pauseStopTimer);
    pauseStopTimer = null;
    const plan = trackerPlan({ session: cur, trackApps: settingsStore.data.trackApps, pausedSince, now: Date.now() });
    if (plan === 'run') tracker.start();
    else if (plan === 'stop') { if (tracker.wanted) tracker.stop(); }
    else if (tracker.wanted) pauseStopTimer = setTimeout(syncTracker, Math.max(1000, PAUSE_KEEP_MS - (Date.now() - pausedSince)));
  }

  // ------------------------------------------------ low-power mode (weak PC: 4 GB RAM / dual-core)
  const hardware = PM.detect({ totalmem: os.totalmem(), cpus: (os.cpus() || []).length });
  let power = PM.resolve('auto', hardware);
  /** Recomputes the mode from settings; recording quality follows it unless the user chose one. */
  function applyPower() {
    power = PM.resolve(settingsStore.data.powerMode, hardware);
    const info = { low: power.low, auto: power.auto, reason: power.reason, ramGB: power.ramGB, cpus: power.cpus };
    const patch = PM.recPatch(settingsStore.data, power.low);
    settingsStore.data.powerInfo = info;   // derived at every start, no need to write the file for it
    if (patch) settingsStore.update((d) => { Object.assign(d, patch); });
    if (notesStore) notesStore.debounceMs = power.low ? 1500 : 300;
    return power;
  }

  const broadcast = (channel, payload) => {
    // the clipboard history (up to a few MB) only matters to the panel: not serialized for every window (perf)
    const targets = channel === 'clipboard:changed' ? [windows && windows.panel].filter(Boolean) : BrowserWindow.getAllWindows();
    for (const w of targets) {
      if (!w.isDestroyed()) w.webContents.send(channel, payload);
    }
  };

  function registerShortcut(accel, previous) {
    if (previous) globalShortcut.unregister(previous);
    if (!accel) return true;
    try {
      return globalShortcut.register(accel, () => windows.togglePanel());
    } catch {
      return false;
    }
  }

  function applyLoginItem(s) {
    // in development mode it would register electron.exe, not the app
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: s.launchAtLogin });
  }

  /** Applies and saves a settings change that is already validated. */
  function updateSettings(patch) {
    // items not unlocked yet can't be worn (the page shows them with a lock; this is the real check)
    // before the progress is loaded (first second after start), the last celebrated level is the limit
    if (patch.buddyLook) patch = { ...patch, buddyLook: normalizeLook(P.lockLook(patch.buddyLook, progress ? progress.level : (settingsStore.data.progressSeenLevel || 1))) };
    const before = { ...settingsStore.data };
    const changed = {};
    for (const [k, v] of Object.entries(patch)) {
      if (JSON.stringify(before[k]) !== JSON.stringify(v)) changed[k] = v;
    }
    if ('recQuality' in changed || 'recFps' in changed) changed.recQualityAuto = false;   // the user's choice wins over power-mode defaults
    let shortcutError = null;
    if ('shortcut' in changed && !registerShortcut(changed.shortcut, before.shortcut)) {
      registerShortcut(before.shortcut); // keep the old shortcut
      delete changed.shortcut;
      shortcutError = 'That shortcut is already used by another app. Pick another one.';
    }
    settingsStore.update((d) => { Object.assign(d, changed); });
    const unbound = passBinding.enforce(settingsStore.data);
    if (unbound && unbound.emailPassEnc === null) { settingsStore.update((d) => { Object.assign(d, unbound); }); settingsStore.flushScrubbed(); changed.emailPassEnc = null; console.log('[email] server or username changed: saved password cleared'); }
    else if (unbound) settingsStore.update((d) => { Object.assign(d, unbound); });   // first address typed after the password: re-bound, kept
    if ('powerMode' in changed) applyPower();
    const s = settingsStore.data;
    if ('theme' in changed) nativeTheme.themeSource = s.theme;
    if ('launchAtLogin' in changed) applyLoginItem(s);
    if ('clipboardEnabled' in changed) watcher.setPaused(!s.clipboardEnabled);
    if ('trackApps' in changed) syncTracker();
    if ('recAuto' in changed && recorder) { recorder.syncAuto(); broadcast('recorder:changed', recorder.state()); }
    if (('recRules' in changed || 'powerMode' in changed) && recorder) recorder.syncAuto();
    if ('buddyAnimations' in changed && mood) { mood.sleeping = false; mood.sendConfig(); }
    if (('buddyLook' in changed || 'powerMode' in changed) && mood) mood.sendConfig();
    if (changed.clipboardSkipSecrets === true) purgeClipboardSecrets({ byUser: true });
    if ('clipboardMax' in changed) {
      clipboardStore.update((d) => { d.items = clip.enforceMax(d.items, s.clipboardMax); });
      broadcast('clipboard:changed', clipboardStore.data.items);
    }
    windows.applySettings(s, changed);
    if ('uiMode' in changed) broadcast('ui:mode-changed', s.uiMode === 'full' ? 'full' : 'simple');
    if (('buddyVisible' in changed || 'timerVisible' in changed) && tray) tray.refresh();
    const view = publicView(s);
    if (Object.keys(changed).length && !(Object.keys(changed).length === 1 && 'lastTab' in changed)) {
      broadcast('settings:changed', view);
    }
    return { settings: view, error: shortcutError };
  }

  /** Removes keys / tokens saved earlier from the history (at startup and when you turn the setting on). */
  function purgeClipboardSecrets({ byUser = false } = {}) {
    let removed = 0;
    clipboardStore.update((d) => { const r = clip.removeSecrets(d.items); d.items = r.items; removed = r.removed; });
    if (removed) {
      console.log(`[clipboard] removed ${removed} ${removed === 1 ? 'entry that looked' : 'entries that looked'} like an API key / token from the history`);
      clipboardStore.flushScrubbed();   // r2 sec L2: not in clipboard.json.bak either
      broadcast('clipboard:changed', clipboardStore.data.items);
    }
    // r2 sec L1: turned on by the user → broken copies (full old history) go too; not at startup, they may be needed
    if (byUser) clipboardStore.pruneCorrupt(0);
    return removed;
  }

  function addClipboardText(text, { force = false } = {}) {
    if (!force && !settingsStore.data.clipboardEnabled) return;
    let changed = false;
    clipboardStore.update((d) => {
      const r = clip.addEntry(d.items, text, { max: settingsStore.data.clipboardMax, skipSecrets: settingsStore.data.clipboardSkipSecrets });
      if (r.skipped === 'secret') console.log(`[clipboard] did not save the copied text (looks secret: ${clip.looksLikeSecret(text)})`);
      d.items = r.items;
      changed = r.changed;
    });
    if (changed) {
      broadcast('clipboard:changed', clipboardStore.data.items);
      if (mood && !force) mood.react('wow');
    }
  }

  app.on('second-instance', () => {
    if (!windows) return;
    if (!settingsStore.data.buddyVisible) updateSettings({ buddyVisible: true });
    windows.showPanel();
  });

  // C2 / H1 / H2: data-file problems reach the user once (per file and kind, at most every 10 min)
  const storeNoticeAt = new Map();
  const onStoreProblem = ({ kind, file, failures }) => {
    if (kind === 'save-failed' && failures < 2) return; // one failure is retried quietly (short lock)
    const key = `${kind}|${path.basename(file)}`;
    const t = Date.now();
    if (t - (storeNoticeAt.get(key) || -Infinity) < 600000) return;
    storeNoticeAt.set(key, t);
    const n = storeNotice(kind, path.basename(file));
    if (!n) return;
    // at startup the app is not ready to show notifications for a moment
    const show = () => notify({ ...n, onClick: () => windows && windows.showPanel() });
    if (app.isReady()) show(); else app.whenReady().then(show);
  };

  app.whenReady().then(() => {
    permissions.hardenAll({ app, session }, (m) => console.log(m));
    const dir = app.getPath('userData');
    let settingsMigrated = false;   // old file (no uiMode) or removed AI keys: rewrite it soon, so the old API key leaves the disk
    const freshSettings = {};       // r2 L2: marks "started from defaults" (no usable settings file)
    let settingsFresh = false;
    settingsStore = new JsonStore(path.join(dir, 'settings.json'), () => freshSettings, {
      normalize: (d) => { if (d === freshSettings) settingsFresh = true; if (needsMigration(d)) settingsMigrated = true; return withDefaults(d); },
      onProblem: onStoreProblem,
    });
    // r2 sec L2: the old API key leaves settings.json.bak too (async: startup must stay fast)
    // r3: also when only the .bak still has it (main file migrated by an older version)
    if (settingsMigrated || settingsStore.bakMatches(needsMigration)) settingsStore.flushScrubbedAsync();
    { const p = existingUserPatch({ startedFresh: settingsFresh, fs, dir }); if (p) { log.warn('main', 'settings started fresh but other data exists: keeping full mode, no tour'); settingsStore.update((d) => { Object.assign(d, p); }); } }
    { const m = passBinding.migrate(settingsStore.data); if (m) settingsStore.update((d) => { Object.assign(d, m); }); }
    applyPower();
    if (power.low) console.log(`[power] power saver on${power.reason ? ` (${power.reason})` : ''}`);
    clipboardStore = new JsonStore(path.join(dir, 'clipboard.json'), () => ({ version: 1, items: [] }), {
      onProblem: onStoreProblem,
      normalize: (d) => ({ version: 1, items: Array.isArray(d.items) ? d.items.filter((i) => i && typeof i.text === 'string' && typeof i.id === 'string') : [] }),
    });
    notesStore = new JsonStore(path.join(dir, 'notes.json'), () => ({ version: 1, notes: [] }), {
      onProblem: onStoreProblem,
      debounceMs: power.low ? 1500 : 300,   // whole-file rewrite: less often on a weak PC (HDD)
      maxWaitMs: 5000,                      // r2 perf M2: steady typing still reaches the disk every 5 s
      normalize: (d) => ({ version: 1, notes: Array.isArray(d.notes) ? d.notes.filter((n) => n && typeof n.body === 'string' && typeof n.id === 'string').map(notesLib.normalizeNote) : [] }),
    });

    nativeTheme.themeSource = settingsStore.data.theme;
    const secrets = makeSecrets(safeStorage);

    // For manual testing, ONLY in development mode: BUDDY_TEST_HOUR_MS=60000 → an "hour" lasts 1 minute.
    const testHour = Number(process.env.BUDDY_TEST_HOUR_MS);
    const hourMs = !app.isPackaged && testHour >= 10000 ? testHour : 3600000;
    if (!app.isPackaged) console.log(`[dev] a session "hour" = ${hourMs / 1000} seconds${hourMs !== 3600000 ? ' (test mode)' : ''}`);

    sessions = new SessionManager({
      dir,
      hourMs,
      onStoreProblem,
      onHour: (hours, session) => {
        console.log(`[session] ${S.hoursPassedText(hours)} (notifications ${settingsStore.data.notificationsEnabled ? 'on' : 'off'})`);
        if (mood) mood.react('happy');
        if (!settingsStore.data.notificationsEnabled) return;
        const shown = notify({
          title: S.hoursPassedText(hours),
          body: `${session.title}\nActive time only, breaks not counted.`,
          onClick: () => windows.showPanel('session'),
        });
        if (!shown) console.warn('[session] the system does not support notifications');
      },
      onChange: (state) => {
        syncTracker();
        const now = state.session ? state.session.state : 'none';
        if (mood && now === 'running' && prevSessionState === 'none') { mood.wake(); mood.react('happy'); }
        prevSessionState = now;
        broadcast('session:changed', state);
        if (windows) windows.updateTimerVisibility();
        if (tray) tray.refresh();
      },
    });
    sessions.start();
    prevSessionState = sessions.session ? sessions.session.state : 'none';

    tracker = new ActiveWindowTracker({
      // only for tests in development mode: a fake helper (a Node script) instead of the real one
      getCommand: () => (!app.isPackaged && process.env.BUDDY_FAKE_ACTIVITY
        ? { command: 'node', args: [process.env.BUDDY_FAKE_ACTIVITY] }
        : helperCommand(dir)),
      onSample: (raw) => sessions.recordActivity(raw, { titles: settingsStore.data.trackWindowTitles }),
      onStatus: (st) => {
        activityStatus = st;
        if (st.state === 'error' || st.state === 'permission') console.warn('[apps]', st.state, st.message || '');
        broadcast('activity:status', st);
      },
    });
    syncTracker();

    windows = createWindows({
      getSettings: () => settingsStore.data,
      saveBuddyPos: (pos) => settingsStore.update((d) => { d.buddyPos = pos; }),
      saveTimerPos: (pos) => settingsStore.update((d) => { d.timerPos = pos; }),
      hasSession: () => !!sessions.session,
      onPanelShown: () => { if (mood) mood.wake(); },
      onPanelContextMenu: (win, params) => panelContextMenu(win, params),
    });
    // the buddy first: everything else (history, panel, progress) comes after it is on screen (H2)
    // H4: crashed / hung pages are reloaded once, then closed with a notice (installed before any window exists)
    const WIN_NAMES = ['buddy', 'panel', 'timer', 'stats', 'gallery', 'editor', 'viewer', 'quick', 'shotOverlay', 'shotPicker', 'shotCard', 'shotView', 'recorder'];
    installWindowGuard(app, BrowserWindow, createWindowGuard({
      nameOf: (win) => WIN_NAMES.find((n) => windows[n] === win) || null,
      log,
      notify,
      closeOnly: ['shotOverlay', 'shotPicker', 'recorder'],
      neverKill: ['panel'],
      onGone: (name) => {
        if (name === 'shotOverlay' && shots) shots.finishZone(null).catch((e) => log.warn('screenshot', 'cancel after crash', e));
        if (name === 'recorder' && recorder && recorder.cur) recorder.fail(new Error('Recording stopped: the capture closed unexpectedly.'));
      },
    }), log);

    // L4: Windows shutdown / log off skips 'before-quit': save the data synchronously (hooked on every window, runs once)
    createShutdownSaver({ log, steps: [
      ['session', () => sessions.shutdown()],
      ['notes', () => notesStore.flush()],
      ['clipboard', () => clipboardStore.flush()],
      ['settings', () => settingsStore.flush()],
      ['recordings', () => { if (recIndex) recIndex.flush(); }],
    ] }).install(app);
    const buddyWin = windows.createBuddy();

    // ------------------------------------------------ no spellchecker (removed in 1.6.0)
    // Electron on Windows does NOT use the Windows spellchecker, but Hunspell dictionaries downloaded from Google.
    // The owner chose to drop the spellchecker ("it's a simple app"): fully off, and the download stays blocked.
    session.defaultSession.setSpellCheckerEnabled(false);
    session.defaultSession.setSpellCheckerDictionaryDownloadURL(BLOCKED_DICTIONARY_URL);

    // For manual testing, ONLY in development mode: BUDDY_TEST_SLEEP_S=20 → falls asleep after 20 s without mouse / keyboard.
    const testSleep = Number(process.env.BUDDY_TEST_SLEEP_S);
    mood = new BuddyMood({
      send: (channel, payload) => { const b = windows.buddy; if (b && !b.isDestroyed()) b.webContents.send(channel, payload); },
      isEnabled: () => settingsStore.data.buddyAnimations,   // short reactions (wave, happy, sleep, eyes) stay in power saver
      isLowPower: () => power.low,                            // power saver: no endless effects (breath loop, fx accessories)
      lookMs: () => PM.tuning(power.low).lookMs,
      getLook: () => settingsStore.data.buddyLook,
      isSessionRunning: () => !!sessions.session && sessions.session.state === 'running',
      getIdleSec: () => powerMonitor.getSystemIdleTime(),
      isVisible: () => !!windows.buddy && windows.buddy.isVisible(),
      getCursor: () => screen.getCursorScreenPoint(),
      getBounds: () => (windows.buddy ? windows.buddy.getBounds() : null),
      sleepAfterSec: !app.isPackaged && testSleep >= 5 ? testSleep : undefined,
    });
    mood.start();

    // ------------------------------------------------ a buddy that grows: XP from sessions + the daily streak
    const startedAt = Date.now();
    // per-day totals cached in progress-totals.json, loaded asynchronously after the buddy is shown (H2)
    const dayCache = new DayCache({ daysDir: path.join(dir, 'sessions'), file: path.join(dir, 'progress-totals.json') });
    const makeProgress = (cached) => new ProgressTracker({
      sessions,
      pastTotals: cached ? (today) => dayCache.totalsBefore(today) : undefined,
      getSeen: () => settingsStore.data.progressSeenLevel,
      setSeen: (lvl) => settingsStore.update((d) => { d.progressSeenLevel = lvl; }),
      onChange: (p) => broadcast('progress:changed', p),
      onLevelUp: (p, rewards, first) => {
        broadcast('progress:level-up', { level: p.level, title: p.title, rewards, first });
        // at startup the buddy page is still loading (and waving): the celebration comes a bit later
        const celebrate = () => { if (mood) { mood.wake(); mood.react('levelup'); } };
        if (!first) { if (Date.now() - startedAt < 8000) setTimeout(celebrate, 3500); else celebrate(); }
        if (settingsStore.data.notificationsEnabled) {
          notify({
            title: first ? `Your buddy is already at Level ${p.level} (from your sessions)` : `Level ${p.level}! ${p.title}`,
            body: rewards.length ? `You unlocked: ${rewards.map((r) => r.label).join(', ')}. Find them in Settings → "Change how the buddy looks". Click to open it.` : 'Keep it up!',
            onClick: () => (rewards.length ? windows.showPanel('settings', { cat: 'look' }) : windows.showPanel('session')),
          });
        }
      },
    });
    function startProgress() {
      dayCache.load().then(() => true, (err) => { console.warn('[progress] the day cache did not load:', err.message); return false; }).then((cached) => {
        progress = makeProgress(cached && dayCache.ready);
        progress.start();
        // a look with items that are still locked (e.g. after the history was deleted) goes back to what is unlocked
        const cur = settingsStore.data.buddyLook;
        const fixed = normalizeLook(P.lockLook(cur, progress.level));
        if (JSON.stringify(fixed) !== JSON.stringify(normalizeLook(cur))) { settingsStore.update((d) => { d.buddyLook = fixed; }); if (mood) mood.sendConfig(); }
      });
    }

    if (settingsStore.data.clipboardSkipSecrets) purgeClipboardSecrets();
    watcher = new clip.ClipboardWatcher(clipboard, (text) => addClipboardText(text));
    watcher.setPaused(!settingsStore.data.clipboardEnabled);
    watcher.start();

    // ------------------------------------------------ email: send only (SMTP), from the main process
    const smtp = emailProvider.createSmtpProvider({
      createTransport: (opts) => require('nodemailer').createTransport(opts),
      getPassword: () => (passBinding.isBound(settingsStore.data) ? secrets.decryptPassword(settingsStore.data.emailPassEnc) : null),
      log: (m) => console.log(m),
    });

    /** Sends the session report by email (if it is checked in Settings). */
    async function emailReport(summary) {
      const { cfg } = emailProvider.configFrom(settingsStore.data);
      try {
        const res = await smtp.sendMail(cfg, { to: cfg.reportTo, ...emailCompose.sessionReportEmail(summary) });
        if (res.sent && mood) mood.react('happy');
        return { sent: !!res.sent, message: res.message || null, to: cfg.reportTo };
      } catch (err) {
        return { sent: false, error: true, message: err.message };
      }
    }

    const onSessionStopped = (summary) => {
      dayCache.update(summary.days, (d) => sessions.dayRecords(d));
      if (progress) { progress.invalidate(); progress.refresh(); }
      if (summary.saved) {
        lastReport = summary;
        if (mood) mood.react('happy');
        if (settingsStore.data.emailSendSessionReport) {
          summary.email = { pending: true };
          emailReport(summary).then((res) => broadcast('email:report-result', { id: summary.id, ...res }));
        }
      }
      broadcast('session:stopped', summary);
      if (!summary.saved) return;
      // the final report: in the panel (Session tab) and, in short, as a notification
      windows.showPanel('session');
      if (settingsStore.data.notificationsEnabled) {
        const top = summary.apps.slice(0, 3).map((a) => `${a.name} ${S.formatShort(a.ms)}`).join(' · ');
        notify({
          title: `Timer stopped: ${summary.title}`,
          body: `Work time: ${S.formatShort(summary.activeMs)}${top ? `\n${top}` : ''}`,
          onClick: () => windows.showPanel('session'),
        });
      }
    };

    // ------------------------------------------------ reminders in notes (1.7.0)
    const noteLabel = (n) => notesLib.titleOf(n.body);
    reminders = new ReminderScheduler({
      getNotes: () => notesStore.data.notes,
      setStatus: (ids, status, now) => {
        notesStore.update((d) => { d.notes = d.notes.map((n) => (ids.includes(n.id) && n.remind ? { ...n, remind: { ...n.remind, status, firedAt: now } } : n)); });
        broadcast('notes:changed', { reason: status, ids });
      },
      onFire: (note, lateMs) => {
        const late = lateMs > 2 * 60000 ? ` (was due ${RT.formatAt(note.remind.at)})` : '';
        console.log(`[reminder] ${noteLabel(note)}${late}`);
        if (mood) { mood.wake(); mood.react('wave'); }
        notify({ title: `Reminder: ${noteLabel(note)}`, body: `Your note, ${RT.formatAt(note.remind.at)}${late}. Click to open it.`, onClick: () => windows.showPanel('notes', { note: note.id }) });
      },
      onMissed: (list) => {
        console.log(`[reminder] missed while the app was closed: ${list.length}`);
        // after the buddy appears (as with a new level)
        const t = setTimeout(() => {
          if (mood) { mood.wake(); mood.react('wave'); }
          notify(list.length === 1
            ? { title: `Missed reminder: ${noteLabel(list[0])}`, body: `It was due ${RT.formatAt(list[0].remind.at)}, while the app was closed.`, onClick: () => windows.showPanel('notes', { note: list[0].id }) }
            : { title: `You missed ${list.length} reminders`, body: list.slice(0, 3).map(noteLabel).join(' · '), onClick: () => windows.showPanel('notes') });
        }, 3500);
        if (t.unref) t.unref();
      },
    });

    // ------------------------------------------------ quick capture (1.8.0): screenshots, only from buttons
    // many changes in a row (a multi-file trash, imports) → one gallery refresh
    let shotsTimer = null;
    const shotsChanged = () => { if (shots) shots.invalidateList(); clearTimeout(shotsTimer); shotsTimer = setTimeout(() => broadcast('shots:changed'), 150); };
    shots = new ScreenshotService({
      capturer: desktopCapturer,
      screen,
      fs,
      folder: recordingsFolder,
      imageFromDataURL: (url) => nativeImage.createFromDataURL(url),
      ui: {
        hideOwn: () => windows.hideOwnForShot(),
        showOverlay: (display) => windows.showShotOverlay(display),
        closeOverlay: () => windows.closeShotOverlay(),
        showPicker: () => windows.showShotPicker(),
        closePicker: () => windows.closeShotPicker(),
        grabFrame: () => windows.grabFrame(),
      },
      onSaved: (file, kind) => {
        console.log(`[screenshot] ${kind}: ${file}`);
        if (mood) { mood.wake(); mood.react('happy'); }
        shotsChanged();
        // 1.10.0: instead of a notification, a card with the screenshot next to the buddy (Copy / Open / Folder / Delete)
        windows.showShotCard(path.basename(file));
      },
      trashItem: (file) => shell.trashItem(file),
      onRemoved: (name) => { windows.shotRemoved(name); shotsChanged(); },
      onRemovedMany: (names) => { names.forEach((n) => windows.shotRemoved(n)); shotsChanged(); },
      // the editable annotations (1.11.0): in the data folder, not next to the screenshots
      annotDir: () => path.join(app.getPath('userData'), 'annotations'),
      imageSize: (file) => ShotImage.sizeOfFileSync(fs, file),   // header only, no decode
      onExported: () => shotsChanged(),
      // the gallery (1.12.0): JPEG thumbnails (never enlarged), also kept on disk; images added from the PC
      thumbnail: (file, width) => ShotImage.makeThumbnail(nativeImage, fs, file, width),
      thumbDir: () => path.join(app.getPath('userData'), 'thumbs'),
      imageFromBuffer: (buf) => nativeImage.createFromBuffer(buf),
      onError: (message) => { console.warn('[screenshot]', message); notify({ title: 'Couldn\'t take the picture', body: message }); },
    });
    // getDisplayMedia from the hidden screenshot window gets exactly the chosen window, without a dialog
    session.fromPartition('shot').setDisplayMediaRequestHandler((_request, callback) => {
      if (!shots.pending) { callback({}); return; }
      callback({ video: shots.pending });
    }, { useSystemPicker: false });
    const capture = {
      quickNote: () => windows.showQuickNote(),
      zone: () => shots.startZone(),
      window: () => shots.openPicker(),
      menuItems: () => [
        { label: 'Quick note', click: () => windows.showQuickNote() },
        { label: 'Picture of an area', click: () => shots.startZone() },
        { label: 'Picture of a window…', click: () => shots.openPicker() },
        { label: 'All pictures…', click: () => windows.showGallery() },
      ],
    };

    registerIpc({
      progress: { get: () => progress },
      capture,
      shots,
      reminders: { poke: () => reminders && reminders.check() },
      windows, settingsStore, clipboardStore, notesStore, watcher, secrets, sessions, dayCache,
      updateSettings, addClipboardText, broadcast, onSessionStopped,
      getActivityStatus: () => activityStatus,
      email: { provider: emailProvider, smtp, compose: emailCompose, getLastReport: () => lastReport },
      mood,
      getRecorder: () => recorder,
      getClipExporter: () => clipExporter,
      mediaUrl: media.mediaUrl,
      shotUrl: media.shotUrl,
      thumbUrl: media.thumbUrl,
      recordingsFolder,
      chooseRecordingsFolder: async (parent) => {
        const r = await dialog.showOpenDialog(parent || undefined, {
          title: 'Where should recordings be saved?',
          defaultPath: recordingsFolder(),
          properties: ['openDirectory', 'createDirectory'],
        });
        if (r.canceled || !r.filePaths[0]) return null;
        settingsStore.update((d) => { d.recFolder = r.filePaths[0]; });
        broadcast('settings:changed', publicView(settingsStore.data));
        return true; // pages never receive paths
      },
      resetRecordingsFolder: () => {
        settingsStore.update((d) => { d.recFolder = ''; });
        broadcast('settings:changed', publicView(settingsStore.data));
        return true;
      },
      testNotification: () => notify({
        title: 'Test notification',
        body: `If you see this, ${ID.NAME} notifications work.`,
        onClick: () => windows.showPanel('settings'),
      }),
    });

    // after the buddy is ready: the hidden panel (fast first open), the timer only with a session (H4), the progress
    let afterBuddyDone = false;
    const afterBuddy = () => {
      if (afterBuddyDone) return;
      afterBuddyDone = true;
      if (!windows.panel) windows.createPanel();
      windows.updateTimerVisibility();
      startProgress();
      setTimeout(warnIfRecordingsInOneDrive, 6000);   // after the tour has had its moment
      // 1.15.0 runs PowerShell with -EncodedCommand: the helper script written by 1.14.0 is no longer used
      fs.promises.rm(path.join(app.getPath('userData'), 'active-window.ps1'), { force: true }).catch((e) => log.warn('main', 'old helper script not removed', e));
      // F1: the first start opens the panel with the tour, a moment after the buddy shows up
      // only on the very first start after a fresh install: updates never show it again (Settings → Help reopens it)
      if (!settingsStore.data.tourDone && settingsStore.data.buddyVisible) setTimeout(() => windows.showPanel(null, { tour: true }), 1200);
    };
    buddyWin.once('ready-to-show', () => setTimeout(afterBuddy, 0));
    setTimeout(afterBuddy, 4000);   // safety net if the buddy page never becomes ready
    reminders.start();
    powerMonitor.on('resume', () => reminders.check());   // after sleep: what rang in the meantime
    // H3: the time asleep is not session work
    powerMonitor.on('suspend', () => sessions.suspend());
    powerMonitor.on('resume', () => sessions.resumeFromSleep());
    // Win+L: what happens to a running session is the user's choice (Settings → Time & timer)
    powerMonitor.on('lock-screen', () => { try { sessions.onScreenLock(settingsStore.data.sessionOnLock); } catch (e) { log.warn('session', 'lock-screen', e); } });
    powerMonitor.on('unlock-screen', () => { try { sessions.onScreenUnlock(settingsStore.data.sessionOnLock); } catch (e) { log.warn('session', 'unlock-screen', e); } });

    // ------------------------------------------------ window recording (Portfolio edition)
    // ONLY in development mode, for tests without real windows: BUDDY_FAKE_CAPTURE=1
    const fakeCapture = !app.isPackaged && process.env.BUDDY_FAKE_CAPTURE === '1';
    recIndex = new JsonStore(path.join(dir, 'recordings.json'), () => ({ version: 1, items: [] }), {
      onProblem: onStoreProblem,
      normalize: (d) => ({ version: 1, items: Array.isArray(d.items) ? d.items.filter((i) => i && typeof i.id === 'string' && typeof i.file === 'string') : [] }),
    });
    recorder = new RecorderManager({
      getSettings: () => settingsStore.data,
      getSources: () => (fakeCapture
        ? Promise.resolve([{ id: 'window:1:0', name: 'Note Organizer — test' }, { id: 'window:2:0', name: 'Desktop Buddy Portfolio' }])
        : desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })),
      openCapture: async () => {
        const win = await windows.createRecorder();
        return {
          // "true" = like a user click: getDisplayMedia requires it
          start: (cfg) => win.webContents.executeJavaScript(`window.recorder.start(${JSON.stringify({ ...cfg, fake: fakeCapture })})`, true),
          stop: () => win.webContents.executeJavaScript('window.recorder.stop()', true),
          attach: () => win.webContents.executeJavaScript('window.recorder.attach()', true),
          detach: () => win.webContents.executeJavaScript('window.recorder.detach()', true),
          destroy: () => windows.destroyRecorder(),
        };
      },
      resolveFolder: recordingsFolder,
      index: recIndex,
      // only in development mode (npm start): the terminal lists the windows seen when no rule matches,
      // once per change, so you can see why recording doesn't start
      onDiag: (() => {
        let last = '';
        return ({ windows, skipped }) => {
          if (app.isPackaged) return;
          const key = windows.join(' | ') + `#${skipped}`;
          if (key === last) return;
          last = key;
          console.log(`[recording] no rule matches. Windows seen (${windows.length}): ${windows.join(' | ') || '(none)'}${skipped ? ` · ${skipped} stopped by hand, skipped until they close` : ''}`);
        };
      })(),
      fs,
      idlePollMs: () => PM.tuning(power.low).rulePollMs,
      onChange: (st) => {
        broadcast('recorder:changed', st);
        const key = st.recording ? `${st.recording.status}|${st.recording.label}` : 'idle';
        if (key !== recTrayKey) { recTrayKey = key; if (tray) tray.refresh(); }
      },
      onEvent: (kind, info) => {
        if (kind === 'error') {
          log.warn('recorder', 'error event');
          // H5: the same error again within 10 min: no new notification (the Video tab shows it)
          if (info.message === recLastError.message && Date.now() - recLastError.at < 600000) return;
          recLastError = { message: info.message, at: Date.now() };
          notify({ title: 'Recording stopped', body: info.message, onClick: () => windows.showPanel('video') });
          return;
        }
        console.log(`[recording] ${kind}: ${info.label}${info.file ? ` → ${info.file}` : ''}`);
        if (kind === 'resumed' || kind === 'marked') return;   // the app reopened: we continue in the same file, no notification
        if (!settingsStore.data.recNotify) return;
        if (kind === 'started') notify({ title: `Recording: ${info.label}`, body: 'It stops by itself when you close the window (or from the tray / Video tab).', onClick: () => windows.showPanel('video') });
        if (kind === 'saved') notify({ title: 'Recording saved', body: `${path.basename(info.file)} · ${S.formatShort(info.activeMs)}`, onClick: () => shell.showItemInFolder(info.file) });
      },
    });
    // getDisplayMedia from the capture window gets exactly the chosen window, without a picker dialog
    clipExporter = new ClipExporter({
      index: recIndex,
      fs,
      onSaved: (item) => {
        console.log(`[clips] saved: ${item.file}`);
        broadcast('recorder:changed', recorder.state());   // the list in the Video tab updates
      },
    });
    // videos for the editor: only files from the recordings list, by id
    protocol.handle(media.SCHEME, (req) => {
      // screenshots (1.10.0): only by name, only from the Screenshots folder (fileOf checks)
      // thumbnails in the gallery and the Video tab (1.12.0)
      const thumbName = media.shotNameFromUrl(req.url, 'thumb');
      if (thumbName !== null) {
        return Promise.resolve().then(() => shots.thumb(thumbName)).then(
          (buf) => new Response(buf, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } }),
          () => new Response('Not found.', { status: 404 }));
      }
      const shotName = media.shotNameFromUrl(req.url);
      if (shotName !== null) {
        let file;
        try { file = shots.fileOf(shotName); } catch { return new Response('Not found.', { status: 404 }); }
        return media.fileResponse(file, req.headers.get('range'));
      }
      const id = media.idFromUrl(req.url);
      const item = id && recorder.find(id);
      if (!item) return new Response('Not found.', { status: 404 });
      return media.fileResponse(item.file, req.headers.get('range'));
    });
    session.fromPartition('recorder').setDisplayMediaRequestHandler((_request, callback) => {
      const src = recorder.pending;
      if (!src) { callback({}); return; }
      callback({ video: src });
    }, { useSystemPicker: false });
    recorder.syncAuto();
    // a crash mid-recording left a .part file: keep it as a normal recording and say so once
    recorder.recoverParts().then((n) => {
      if (!n) return;
      broadcast('recorder:changed', recorder.state());
      notify({ title: n === 1 ? 'Recovered a recording' : `Recovered ${n} recordings`, body: 'The app stopped suddenly last time. You\'ll find it in the Video tab.', onClick: () => windows.showPanel('video') });
    }, (e) => console.warn('[recording] recovery failed:', e && e.message));

    tray = createTray({
      onOpenPanel: () => windows.showPanel(),
      onOpenStats: () => windows.showStats(),
      onToggleBuddy: () => updateSettings({ buddyVisible: !settingsStore.data.buddyVisible }),
      onResetBuddy: () => { windows.resetBuddyPosition(); if (!settingsStore.data.buddyVisible) updateSettings({ buddyVisible: true }); },
      onQuit: () => app.quit(),
      isBuddyVisible: () => settingsStore.data.buddyVisible,
      recorderItems: () => {
        const st = recorder ? recorder.state() : null;
        if (!st || !st.recording) return [{ label: 'Record a window…', click: () => windows.showPanel('video') }];
        return [
          { label: `● Recording: ${st.recording.label.slice(0, 40)}`, enabled: false },
          { label: 'Remember this moment', click: () => recorder.mark() },
          { label: 'Stop and save the recording', click: () => recorder.stop('manual') },
        ];
      },
      captureItems: () => capture.menuItems(),
      sessionItems: () => {
        const cur = sessions.session;
        if (!cur) return [{ label: 'Start the timer…', click: () => windows.showPanel('session') }];
        const running = cur.state === 'running';
        return [
          { label: `Timer: ${cur.title.slice(0, 40)}`, enabled: false },
          running
            ? { label: 'Pause', click: () => sessions.pause() }
            : { label: 'Resume', click: () => sessions.resume() },
          { label: 'Stop the timer', click: () => {
            try { onSessionStopped(sessions.stop()); } catch (err) { notify({ title: 'The timer didn\'t stop', body: userMessage(err) }); }
          } },
          { label: settingsStore.data.timerVisible ? 'Hide the timer' : 'Show the timer',
            click: () => updateSettings({ timerVisible: !settingsStore.data.timerVisible }) },
        ];
      },
    });

    if (!registerShortcut(settingsStore.data.shortcut)) {
      console.warn('[main] the global shortcut could not be registered:', settingsStore.data.shortcut);
    }
    applyLoginItem(settingsStore.data);
  }).catch(startupFailed);

  // the app lives in the tray: it does not quit when it has no visible windows
  app.on('window-all-closed', () => { /* stays running in the tray */ });

  /** The recordings folder: the one chosen in settings or, by default, "recordings" next to the code (npm start) / Videos (installed app). */
  function recordingsFolder() {
    const chosen = settingsStore.data.recFolder;
    if (chosen) return chosen;
    return app.isPackaged ? path.join(app.getPath('videos'), ID.NAME) : path.join(app.getAppPath(), 'recordings');
  }

  /**
   * Recordings must stay private: if the recordings folder is synced by OneDrive (Windows folder backup
   * moves Videos there), say so ONCE, with a way to pick another folder. Nothing is changed without the user.
   */
  function warnIfRecordingsInOneDrive() {
    try {
      if (process.platform !== 'win32' || settingsStore.data.recOneDriveWarned) return;
      if (!isInOneDrive(recordingsFolder())) return;
      settingsStore.update((d) => { d.recOneDriveWarned = true; });
      log.info('recorder', 'recordings folder is synced by OneDrive: one-time notice shown');
      notify({
        title: 'Your recordings folder is in OneDrive',
        body: 'Recordings may be uploaded to the cloud. Click to pick another folder.',
        onClick: () => { if (windows) windows.showPanel('video'); },
      });
    } catch (e) { log.warn('recorder', 'OneDrive check failed', e); }
  }

  app.on('before-quit', (e) => {
    // a recording in progress is stopped and saved before quitting
    if (recorder && recorder.cur && !recQuitDone) {
      e.preventDefault();
      recQuitDone = true;
      recorder.shutdown().finally(() => app.quit());
      return;
    }
    if (tracker) tracker.stop();
    if (mood) mood.stop();
    if (sessions) sessions.shutdown(); // the running session is paused and saved
    if (watcher) watcher.stop();
    globalShortcut.unregisterAll();
    if (notesStore) {
      notesStore.update((d) => { d.notes = notesLib.pruneEmpty(d.notes); });
      notesStore.flush();
    }
    if (clipboardStore) clipboardStore.flush();
    if (settingsStore) settingsStore.flush();
    if (recIndex) recIndex.flush();   // H1: a recording finished during quit is in the list next time
  });
}
