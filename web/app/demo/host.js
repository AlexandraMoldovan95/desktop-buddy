'use strict';
// The web demo's "main process". The app's real pages run in iframes; their preload (run by the shim) calls
// DemoHost.invoke / send / subscribe instead of Electron IPC. The logic below reuses the app's own modules
// (window.DemoModules, built from src/main and src/shared), with everything kept in memory.
(function () {
  const R = window.DemoModules.require;
  const schema = R('src/shared/settings-schema.js');
  const P = R('src/shared/progression.js');
  const BL = R('src/shared/buddy-look.js');
  const presets = R('src/shared/email-presets.js');
  const S = R('src/main/sessions.js');
  const notesLib = R('src/main/notes.js');
  const clip = R('src/main/clipboard.js');
  const { SessionManager } = R('src/main/session-manager.js');
  const { ProgressTracker } = R('src/main/progress.js');
  const { BuddyMood } = R('src/main/buddy-mood.js');
  const { ReminderScheduler } = R('src/main/reminders.js');
  const provider = R('src/main/email/provider.js');
  const compose = R('src/main/email/compose.js');
  const DD = R('scripts/demo-data.js');
  const memfs = R('fs');

  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const buddyFrame = $('buddyFrame');
  const panelFrame = $('panelFrame');
  const VERSION = (window.parent && window.parent.SITE_INFO && window.parent.SITE_INFO.version) || '';
  const SAVE_KEY = 'desktop-buddy-demo-v1';
  const PAD = 14;
  const PANEL_W = 400;
  const PANEL_H = 560;
  const GAP = 8;

  // ------------------------------------------------ saved state (per visitor, this browser only)
  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || null; } catch { return null; }
  }
  let saveTimer = 0;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify({ settings, notes, clips, pictures, recordings, extraDays: extraDays() })); } catch { /* private mode: the demo still works, it just forgets */ }
    }, 300);
  }
  const saved = loadSaved();
  const t0 = Date.now();

  // ------------------------------------------------ settings (the real schema: validation, defaults)
  let settings = schema.withDefaults(saved ? saved.settings : { uiMode: 'simple', tourDone: false, trackApps: false, launchAtLogin: false, notificationsEnabled: true });
  settings.trackApps = false;   // the browser can't see other apps

  // ------------------------------------------------ the per-day session files, in memory
  const DAYS = '/data/sessions';
  for (const [date, file] of Object.entries(DD.days(t0))) memfs.writeFileSync(`${DAYS}/${date}.json`, JSON.stringify(file));
  const demoIds = new Set(Object.values(DD.days(t0)).flatMap((f) => f.sessions.map((r) => r.id)));
  if (saved && saved.extraDays) {
    for (const [date, recs] of Object.entries(saved.extraDays)) {
      const f = `${DAYS}/${date}.json`;
      const cur = memfs.existsSync(f) ? JSON.parse(memfs.readFileSync(f)) : { version: 1, date, sessions: [] };
      cur.sessions = cur.sessions.concat(recs);
      memfs.writeFileSync(f, JSON.stringify(cur));
    }
  }
  /** Sessions the visitor added (timer, "+1 h"), to remember them. */
  function extraDays() {
    const out = {};
    for (const [file, text] of memfs.__files) {
      const m = /\/sessions\/(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
      if (!m) continue;
      const mine = JSON.parse(text).sessions.filter((r) => !demoIds.has(r.id));
      if (mine.length) out[m[1]] = mine;
    }
    return out;
  }

  let notes = saved ? saved.notes : DD.notes(t0);
  let clips = saved ? saved.clips : DD.clipboard(t0);
  const DEMO_PICS = [
    ['Job Tracker', 'job-tracker.png', 3], ['Interval', 'interval.png', 26], ['Coffee shop sales', 'csv-dashboard.png', 50],
  ];
  // pictures saved by an older demo may point to a file that is gone: keep only the current demo files
  const PIC_FILES = new Set(DEMO_PICS.map((x) => x[1]));
  let pictures = saved ? saved.pictures.filter((x) => PIC_FILES.has(x.file)) : DEMO_PICS.map(([label, file, hAgo], i) => ({ name: `${label} ${i + 1}.png`, file, at: t0 - hAgo * 3600000, copy: null }));
  let recordings = saved ? saved.recordings : [{
    id: 'rec-demo-1', label: 'Note Organizer', window: 'Note Organizer — v2.3', rule: 'Note Organizer', startedAt: t0 - 3 * 3600000,
    endedAt: t0 - 3 * 3600000 + 252000, activeMs: 252000, bytes: 18400000, reason: 'window closed', parts: 3, marks: [41000, 118000, 203000], name: 'Note Organizer (demo).mp4', clips: 2,
  }];

  // ------------------------------------------------ messages to the pages
  const subs = new Map();   // channel → Set of { page, fn }
  function subscribe(page, channel, fn) {
    if (!subs.has(channel)) subs.set(channel, new Set());
    const entry = { page, fn };
    subs.get(channel).add(entry);
    return () => subs.get(channel).delete(entry);
  }
  function broadcast(channel, payload) {
    const set = subs.get(channel);
    if (!set) return;
    for (const { fn } of [...set]) { try { fn(payload); } catch (e) { console.warn('[demo]', channel, e); } }
  }

  // ------------------------------------------------ sessions, progress, mood, reminders: the app's own classes
  const sessions = new SessionManager({
    dir: '/data',
    onChange: (st) => { broadcast('session:changed', st); if (mood) mood.tick(); },
    onHour: () => {},
  });
  sessions.start();

  const progress = new ProgressTracker({
    sessions,
    getSeen: () => (settings.progressSeenLevel || null),
    setSeen: (level) => { settings.progressSeenLevel = level; save(); },
    onChange: (p) => broadcast('progress:changed', p),
    onLevelUp: (p, rewards, first) => {
      broadcast('progress:level-up', { level: p.level, title: p.title, rewards, first });
      if (first) return;
      mood.wake(); mood.react('levelup');
      notify(`Level ${p.level}! ${p.title}`, rewards.length ? `You unlocked: ${rewards.map((r) => r.label).join(', ')}.` : 'Keep it up!', () => showPanel('settings', { cat: 'look' }));
    },
  });

  let lastInput = Date.now();
  const cursor = { x: 0, y: 0 };
  const mood = new BuddyMood({
    send: (ch, p) => broadcast(ch, p),
    isEnabled: () => !!settings.buddyAnimations,
    isLowPower: () => false,
    getLook: () => BL.normalizeLook(settings.buddyLook),
    isSessionRunning: () => !!(sessions.session && sessions.session.state === 'running'),
    getIdleSec: () => (Date.now() - lastInput) / 1000,
    isVisible: () => !document.hidden,
    getCursor: () => cursor,
    getBounds: () => { const r = buddyFrame.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; },
    sleepAfterSec: 45,   // the app waits 3 minutes; a visitor has less time
  });
  mood.start();
  progress.start(10000);

  const reminders = new ReminderScheduler({
    // browsers need setTimeout called on window (the scheduler calls it as a method of its deps)
    now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (t) => clearTimeout(t),
    getNotes: () => notes,
    setStatus: (ids, status, now) => {
      notes = notes.map((n) => (ids.includes(n.id) && n.remind ? { ...n, remind: { ...n.remind, status, firedAt: now } } : n));
      save();
      broadcast('notes:changed', { reason: status, ids });
    },
    onFire: (note) => {
      mood.wake(); mood.react('wave');
      notify(`Reminder: ${notesLib.titleOf(note.body)}`, 'Your note. Click to open it.', () => showPanel('notes', { note: note.id }));
    },
    onMissed: () => {},
  });
  reminders.start();

  // ------------------------------------------------ the recorder (simulated: a browser can't capture other windows)
  const WINDOWS = [{ id: 'w1', name: 'Note Organizer — v2.3' }, { id: 'w2', name: 'Job Tracker' }, { id: 'w3', name: 'Interval — spaced repetition' }];
  let rec = null;
  let recTimer = 0;
  let lastSaved = null;
  function recState() {
    return {
      auto: !!settings.recAuto,
      recording: rec ? { status: 'recording', label: rec.label, window: rec.window, rule: null, startedAt: rec.startedAt, activeMs: rec.activeMs, paused: false, bytes: rec.bytes, manual: true, parts: 1, marks: rec.marks.length, waitLeftMs: null } : null,
      lastError: null,
      lastSaved,
    };
  }
  function recChanged() { broadcast('recorder:changed', recState()); }
  function recMark() {
    if (!rec) return null;
    const t = rec.activeMs;
    const last = rec.marks[rec.marks.length - 1];
    if (last !== undefined && t - last < 1000) return null;
    rec.marks.push(t);
    recChanged();
    return t;
  }
  function recStart(id) {
    if (rec) throw new Error('Already recording. Stop it first.');
    const w = WINDOWS.find((x) => x.id === id);
    if (!w) throw new Error('That window is gone. Pick another one.');
    rec = { id: `rec-${Date.now()}`, label: w.name.split(' — ')[0], window: w.name, startedAt: Date.now(), activeMs: 0, bytes: 0, marks: [] };
    recTimer = setInterval(() => { rec.activeMs += 1000; rec.bytes += 72000 + Math.round(Math.random() * 20000); recChanged(); }, 1000);
    $('fakeWindow').classList.add('recorded');
    recChanged();
    return recState();
  }
  function recStop() {
    if (!rec) return recState();
    clearInterval(recTimer);
    const item = { id: rec.id, label: rec.label, window: rec.window, rule: null, startedAt: rec.startedAt, endedAt: Date.now(), activeMs: rec.activeMs, bytes: rec.bytes, reason: 'manual', parts: 1, marks: rec.marks, name: `${rec.label} (demo).mp4`, clips: 0 };
    if (item.activeMs >= 1000) { recordings = [item, ...recordings].slice(0, 20); lastSaved = { id: item.id, label: item.label }; }
    rec = null;
    $('fakeWindow').classList.remove('recorded');
    save();
    recChanged();
    return recState();
  }

  // ------------------------------------------------ settings changes (like updateSettings in main.js)
  function updateSettings(patch) {
    if (patch.buddyLook) patch = { ...patch, buddyLook: BL.normalizeLook(P.lockLook(patch.buddyLook, progress.last ? progress.last.level : 1)) };
    const changed = {};
    for (const [k, v] of Object.entries(patch)) if (JSON.stringify(settings[k]) !== JSON.stringify(v)) changed[k] = v;
    Object.assign(settings, changed);
    save();
    if ('buddyAnimations' in changed) { mood.sleeping = false; mood.sendConfig(); }
    if ('buddyLook' in changed) mood.sendConfig();
    if ('uiMode' in changed) broadcast('ui:mode-changed', settings.uiMode === 'full' ? 'full' : 'simple');
    if ('theme' in changed) applyTheme();
    if ('buddySize' in changed) placeBuddy();
    if ('clipboardMax' in changed) { clips = clip.enforceMax(clips, settings.clipboardMax); broadcast('clipboard:changed', clips); }
    if (changed.clipboardSkipSecrets === true) { clips = clip.removeSecrets(clips).items; broadcast('clipboard:changed', clips); }
    if ('recAuto' in changed) recChanged();
    const view = schema.publicView(settings);
    if (Object.keys(changed).length && !(Object.keys(changed).length === 1 && 'lastTab' in changed)) broadcast('settings:changed', view);
    return { settings: view, error: null };
  }

  const NO_EMAIL = 'The web demo doesn\'t send email. In the desktop app this goes out through your own mail account (SMTP).';
  const inApp = (what) => { toast(`${what} opens in its own window in the desktop app.`); return true; };
  const isId = (id) => typeof id === 'string' && id.length <= 64;

  // ------------------------------------------------ the IPC handlers (same channels as src/main/ipc.js)
  const HANDLERS = {
    'ui:mode': () => (settings.uiMode === 'full' ? 'full' : 'simple'),
    'buddy:demo': (type) => {
      if (!settings.buddyAnimations) throw new Error('Animations are off. Turn them on above.');
      return mood.demo(type);
    },

    'clipboard:list': () => clips,
    'clipboard:copy': async (id) => {
      const it = clips.find((i) => i.id === id);
      if (!it) throw new Error('This item no longer exists.');
      try { await navigator.clipboard.writeText(it.text); } catch { /* not allowed in this browser: the demo still says it worked */ }
      return true;
    },
    'clipboard:pin': (id, pinned) => { clips = clips.map((i) => (i.id === id ? { ...i, pinned: !!pinned } : i)); save(); broadcast('clipboard:changed', clips); return true; },
    'clipboard:delete': (id) => { clips = clips.filter((i) => i.id !== id); save(); broadcast('clipboard:changed', clips); return true; },
    'clipboard:clear': (keepPinned) => { clips = keepPinned === false ? [] : clips.filter((i) => i.pinned); save(); broadcast('clipboard:changed', clips); return true; },
    'clipboard:add-current': async () => {
      let text;
      try { text = await navigator.clipboard.readText(); } catch { throw new Error('Your browser didn\'t share the clipboard. Copy some text inside the demo window instead.'); }
      return addClip(text, true);
    },

    'progress:get': () => progress.last || progress.refresh() || progress.last,

    'notes:list': () => notesLib.sortNotes(notes),
    'notes:create': () => {
      if (notes.length >= notesLib.MAX_NOTES) throw new Error(`You've reached the limit of ${notesLib.MAX_NOTES} notes.`);
      const r = notesLib.addNewNote(notes);
      notes = r.notes; save();
      return r.note;
    },
    'notes:save': (id, body) => { if (!isId(id)) throw new Error('Invalid data.'); notes = notesLib.saveNote(notes, id, body); save(); return notes.find((n) => n.id === id); },
    'notes:set-reminder': (id, at) => { notes = notesLib.setReminder(notes, id, at); save(); reminders.check(); return notes.find((n) => n.id === id); },
    'notes:delete': (id) => { notes = notesLib.deleteNote(notes, id); save(); return true; },

    'quick:open': () => inApp('The quick note'),
    'shot:zone': () => takePicture('Screenshot'),
    'shot:window': () => takePicture('Note Organizer'),
    'shot:recent': () => pictures.slice(0, 6).map(shotEntry),
    'shot:gallery': () => { lightbox('../../media/screenshot-gallery.png', 'The Pictures gallery (a window of its own in the desktop app): every picture by day, search, multi-select, drag out to other apps.'); return true; },
    'shot:view': (name) => {
      const p = pictures.find((x) => x.name === name);
      if (p) lightbox(`pictures/${p.file}`, 'In the desktop app this is the picture window, with drawing tools (arrows, boxes, blur, steps, sticky notes, crop).');
      return true;
    },
    'shot:copy': () => { toast('Picture copied (the desktop app puts it on the clipboard).'); return true; },
    'shot:trash': (name) => { pictures = pictures.filter((p) => p.name !== name); save(); broadcast('shots:changed', {}); return true; },
    'shot:show': () => inApp('The folder'),
    'shot:open-folder': () => inApp('The Screenshots folder'),

    'settings:get': () => ({
      settings: schema.publicView(settings), emailPresets: presets.PRESETS, emailSecurity: presets.SECURITY, emailVerifiedAt: presets.VERIFIED_AT,
      encryptionAvailable: true, version: VERSION ? `${VERSION} (web demo)` : 'web demo',
    }),
    'settings:set': (patch) => updateSettings(schema.sanitizePatch(patch, settings)),
    'settings:open-data-folder': () => { toast('In the desktop app this opens the folder with your notes, settings and timer history.'); return true; },
    'settings:open-log-folder': () => { toast('In the desktop app this opens the log folder.'); return true; },
    'settings:reset-buddy': () => { userMoved = false; placeBuddy(); return true; },

    'session:get': () => sessions.state(),
    'session:today': () => sessions.today(),
    'session:start': (t) => { const r = sessions.begin(S.cleanTitle ? S.cleanTitle(t) : String(t || '')); mood.wake(); mood.react('happy'); return r; },
    'session:pause': () => sessions.pause(),
    'session:resume': () => sessions.resume(),
    'session:rename': (t) => sessions.rename(S.cleanTitle ? S.cleanTitle(t) : String(t || '')),
    'session:stop': () => {
      const summary = sessions.stop();
      progress.invalidate(); progress.refresh();
      if (summary.saved) mood.react('happy');
      broadcast('session:stopped', summary);
      save();
      return summary;
    },
    'timer:reset-position': () => true,
    'notify:test': () => { notify('Desktop Buddy', 'Notifications work. (In the desktop app this is a Windows notification.)'); return true; },
    'activity:status': () => ({ state: 'stopped' }),
    'activity:open-permissions': () => false,
    'stats:open': () => { openStats(); return true; },
    'stats:workdays': () => sessions.workdays(),
    'stats:last-days': () => sessions.lastDays(30),
    'stats:day': (day) => sessions.daySummary(day),

    'email:status': () => { const { cfg, missing, complete } = provider.configFrom(settings); return { connected: true, complete, missing, to: cfg.reportTo || null, presetsVerifiedAt: presets.VERIFIED_AT }; },
    'email:set-password': () => { throw new Error(NO_EMAIL); },
    'email:clear-password': () => true,
    'email:test': () => { throw new Error(NO_EMAIL); },
    'email:send-range': () => { throw new Error(NO_EMAIL); },
    'email:send-note': () => { throw new Error(NO_EMAIL); },
    'email:preview': (kind) => {
      const { cfg } = provider.configFrom(settings);
      let msg;
      if (kind === 'range') msg = compose.rangeReportEmail(sessions.lastDays(30));
      else if (kind === 'session') {
        const last = sessions.workdays()[0];
        const r = last && sessions.dayRecords(last.day).slice().sort((a, b) => b.end - a.end)[0];
        if (!r) throw new Error('You don\'t have any saved session yet.');
        msg = compose.sessionReportEmail(compose.reportFromRecord(r));
      } else throw new Error('Unknown email type.');
      return { from: cfg.address || null, to: cfg.reportTo || null, ...msg };
    },

    'recorder:state': () => recState(),
    'recorder:windows': () => WINDOWS,
    'recorder:start': (id) => recStart(id),
    'recorder:stop': () => recStop(),
    'recorder:list': () => recordings,
    'recorder:open': () => { toast('The video opens in your video player in the desktop app.'); return true; },
    'recorder:show': () => inApp('The folder'),
    'recorder:trash': (id) => { recordings = recordings.filter((r) => r.id !== id); save(); recChanged(); return true; },
    'recorder:mark': () => ({ t: recMark() }),
    'editor:open': () => { lightbox('../../media/editor-montage.png', 'The clip editor (its own window in the desktop app): play the recording, jump to your marked moments, cut clips and join several into one movie, all re-encoded to MP4 without ffmpeg.'); return true; },
    'recorder:folder': () => ({ label: 'Videos\\Desktop Buddy Portfolio', custom: false }),
    'recorder:open-folder': () => inApp('The recordings folder'),
    'recorder:choose-folder': () => { toast('The desktop app lets you pick any folder here.'); return null; },
    'recorder:reset-folder': () => true,
  };
  const SENDS = {
    'buddy:drag-start': () => dragStart(),
    'buddy:drag-move': () => dragMove(),
    'buddy:drag-end': () => dragEnd(),
    'buddy:mark': () => recMark(),
    'buddy:context-menu': () => buddyMenu(),
    'buddy:ready': () => mood.ready(),
    'buddy:woke': () => mood.woke(),
    'panel:hide': () => hidePanel(),
    'panel:tour': (on) => { tourActive = on === true; },
  };

  // ------------------------------------------------ pictures
  const shotEntry = (p) => ({ name: p.name, at: p.at, copy: null, view: p.name, thumb: `../../demo/pictures/${p.file}` });
  let shotCount = 0;
  function takePicture(kind) {
    const pick = DEMO_PICS[shotCount++ % DEMO_PICS.length];
    const now = Date.now();
    const d = new Date(now);
    const stamp = `${DD.dayKey(d)} ${String(d.getHours()).padStart(2, '0')}-${String(d.getMinutes()).padStart(2, '0')}-${String(d.getSeconds()).padStart(2, '0')}`;
    pictures = [{ name: `${kind} ${stamp}.png`, file: pick[1], at: now, copy: null }, ...pictures].slice(0, 40);
    save();
    broadcast('shots:changed', {});
    toast('Picture saved. (In the desktop app you drag over the screen or pick a window.)');
    return true;
  }

  // ------------------------------------------------ clipboard: copying text inside the demo
  function addClip(text, force) {
    if (!settings.clipboardEnabled && !force) return false;
    const r = clip.addEntry(clips, text, { max: settings.clipboardMax, skipSecrets: settings.clipboardSkipSecrets });
    if (r.skipped === 'secret') { toast('That looks like a password or an API key: it was NOT saved. Secrets never go into the history.'); mood.react('wow'); return false; }
    if (!r.changed) return false;
    clips = r.items; save();
    broadcast('clipboard:changed', clips);
    mood.react('wow');
    return true;
  }
  document.addEventListener('copy', () => {
    const text = String(window.getSelection() || '');
    if (text.trim()) setTimeout(() => addClip(text, false), 0);
  });

  // ------------------------------------------------ the windows on the fake desktop
  let buddyPos = null;
  let userMoved = false;   // until you drag it, the buddy keeps its corner when the page size changes
  let panelOpen = false;
  let tourActive = false;
  const outer = () => (settings.buddySize || 64) + PAD * 2;
  function placeBuddy() {
    const s = outer();
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    if (!buddyPos || !userMoved) buddyPos = { x: Math.max(8, sw - s - 40), y: Math.max(8, sh - s - 70) };
    buddyPos.x = Math.min(Math.max(0, buddyPos.x), sw - s);
    buddyPos.y = Math.min(Math.max(0, buddyPos.y), sh - s);
    buddyFrame.style.width = `${s}px`;
    buddyFrame.style.height = `${s}px`;
    buddyFrame.style.transform = `translate(${buddyPos.x}px, ${buddyPos.y}px)`;
    if (panelOpen) placePanel();
    placeHint();
  }
  function placeHint() {
    const h = $('hint');
    const s = outer();
    const left = buddyPos.x > h.offsetWidth + 24;
    h.classList.toggle('to-right', !left);
    const x = left ? buddyPos.x - h.offsetWidth - 6 : buddyPos.x + s + 6;
    const y = Math.max(8, buddyPos.y + s / 2 - h.offsetHeight / 2);
    h.style.transform = `translate(${Math.max(4, x)}px, ${y}px)`;
  }
  function panelSide() {
    const s = outer();
    return stage.clientWidth - (buddyPos.x + s) >= PANEL_W + GAP || buddyPos.x < PANEL_W + GAP ? 'right' : 'left';
  }
  function placePanel() {
    const s = outer();
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const right = sw - (buddyPos.x + s);
    let x = right >= PANEL_W + GAP || right >= buddyPos.x ? buddyPos.x + s + GAP : buddyPos.x - PANEL_W - GAP;
    let y = buddyPos.y + s / 2 - PANEL_H / 2;
    x = Math.min(Math.max(0, x), Math.max(0, sw - PANEL_W));
    y = Math.min(Math.max(0, y), Math.max(0, sh - PANEL_H));
    panelFrame.style.transform = `translate(${x}px, ${y}px)`;
  }
  let firstOpen = true;
  function showPanel(tab, extra = {}) {
    placePanel();
    panelFrame.hidden = false;
    panelOpen = true;
    mood.wake();
    $('hint').hidden = true;
    const tour = firstOpen && !settings.tourDone && !tab ? { tour: true } : {};
    firstOpen = false;
    broadcast('panel:opened', { tab: tab || null, ...extra, ...tour, buddySide: panelSide() === 'right' ? 'left' : 'right' });
  }
  function hidePanel() {
    if (tourActive) return;
    panelFrame.hidden = true;
    panelOpen = false;
  }
  stage.addEventListener('pointerdown', (e) => {
    if (e.target === stage || e.target.closest('.fake-window, .wallpaper')) { hidePanel(); closeMenu(); }
  });

  // dragging the buddy (the same rule as windows.js: under 4 px of movement it is a click)
  let drag = null;
  const pointerOf = { buddy: { sx: 0, sy: 0 } };
  function dragStart() { closeMenu(); drag = { sx: pointerOf.buddy.sx, sy: pointerOf.buddy.sy, x: buddyPos.x, y: buddyPos.y, moved: false }; }
  function dragMove() {
    if (!drag) return;
    const dx = pointerOf.buddy.sx - drag.sx;
    const dy = pointerOf.buddy.sy - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    if (!drag.moved) { drag.moved = true; userMoved = true; hidePanel(); $('hint').hidden = true; }
    buddyPos = { x: drag.x + dx, y: drag.y + dy };
    placeBuddy();
  }
  function dragEnd() {
    const d = drag;
    drag = null;
    if (d && !d.moved) { if (panelOpen) hidePanel(); else showPanel(); }
  }

  // the pointer, from the stage and from the pages (for the eyes, the idle timer and dragging)
  function pointer(page, type, sx, sy, cx, cy) {
    lastInput = Date.now();
    const frame = page === 'buddy' ? buddyFrame : page === 'panel' ? panelFrame : null;
    if (page === 'buddy') { pointerOf.buddy.sx = sx; pointerOf.buddy.sy = sy; }
    if (frame) { const r = frame.getBoundingClientRect(); cursor.x = r.left + cx; cursor.y = r.top + cy; }
  }
  window.addEventListener('pointermove', (e) => { lastInput = Date.now(); cursor.x = e.clientX; cursor.y = e.clientY; });
  window.addEventListener('keydown', () => { lastInput = Date.now(); });

  // ------------------------------------------------ the buddy's right-click menu
  function buddyMenu() {
    const m = $('menu');
    const items = [
      ['Open', () => showPanel()],
      ['Change how the buddy looks', () => showPanel('settings', { cat: 'look' })],
      ['Start the timer', () => showPanel('session')],
      rec ? ['Remember this moment', () => recMark()] : ['Record a window…', () => showPanel('video')],
      ['Statistics', () => openStats()],
      ['Show the tour', () => showPanel(null, { tour: true })],
    ];
    m.replaceChildren(...items.map(([label, fn]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => { closeMenu(); fn(); });
      return b;
    }));
    m.hidden = false;
    const s = outer();
    const x = Math.min(buddyPos.x + s / 2, stage.clientWidth - 230);
    const y = Math.max(8, Math.min(buddyPos.y - m.offsetHeight + 10, stage.clientHeight - m.offsetHeight - 8));
    m.style.transform = `translate(${x}px, ${y}px)`;
  }
  function closeMenu() { $('menu').hidden = true; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closeLightbox(); } });

  // ------------------------------------------------ statistics window (the real page, in a window frame)
  function openStats() {
    hidePanel();
    const w = $('statsWin');
    const f = $('statsFrame');
    if (w.hidden) f.src = '../renderer/stats/index.html';
    w.hidden = false;
  }
  $('statsClose').addEventListener('click', () => { $('statsWin').hidden = true; $('statsFrame').src = 'about:blank'; });

  // ------------------------------------------------ notifications, toasts, picture box
  function notify(title, body, onClick) {
    const n = document.createElement('button');
    n.type = 'button';
    n.className = 'notif';
    const t = document.createElement('strong'); t.textContent = title;
    const b = document.createElement('span'); b.textContent = body;
    n.append(t, b);
    n.addEventListener('click', () => { n.remove(); if (onClick) onClick(); });
    $('notifs').append(n);
    setTimeout(() => n.remove(), 7000);
  }
  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
  }
  function lightbox(src, caption) {
    $('lbImg').src = src;
    $('lbCap').textContent = caption;
    $('lightbox').hidden = false;
  }
  function closeLightbox() { $('lightbox').hidden = true; }
  $('lightbox').addEventListener('click', closeLightbox);

  // ------------------------------------------------ the theme (Settings → Window and colors)
  const pageDocs = new Set();
  function applyTheme() {
    const t = settings.theme === 'dark' || settings.theme === 'light' ? settings.theme : null;
    for (const d of [document, ...pageDocs]) {
      try { if (t) d.documentElement.dataset.theme = t; else delete d.documentElement.dataset.theme; } catch { /* a closed page */ }
    }
  }

  // ------------------------------------------------ demo controls (outside the "desktop")
  $('btnHour').addEventListener('click', () => {
    // an hour of finished timer work, ending now (split at midnight like a real session)
    const now = Date.now();
    const fake = { id: `demo-${now}`, title: 'Focused work (demo)', startedAt: now - 3600000, state: 'paused', segments: [{ start: now - 3600000, end: now }], usage: {} };
    const days = [];
    for (const { day, record } of S.toDayRecords(fake, now)) {
      sessions.dayStore(day).update((d) => { d.sessions = S.upsertDayRecord(d.sessions, record); });
      days.push(day);
    }
    progress.invalidate(); progress.refresh();
    broadcast('session:changed', sessions.state());
    save();
    toast('+1 hour of timer work added. XP comes only from timer minutes.');
  });
  $('btnRemind').addEventListener('click', () => {
    const target = notesLib.sortNotes(notes)[0];
    if (!target) return;
    notes = notesLib.setReminder(notes, target.id, Date.now() + 3000);
    save();
    reminders.check();
    toast('A reminder will ring in 3 seconds.');
  });
  $('btnReset').addEventListener('click', () => {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* nothing saved */ }
    location.reload();
  });

  // ------------------------------------------------ the API the shims call
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  window.DemoHost = {
    async invoke(page, channel, args) {
      const fn = HANDLERS[channel];
      if (!fn) { console.warn('[demo] no handler for', channel); throw new Error('Not available in the web demo.'); }
      return clone(await fn(...args));
    },
    send(page, channel, args) {
      const fn = SENDS[channel];
      if (fn) fn(...args); else console.warn('[demo] no handler for', channel);
    },
    subscribe,
    pointer,
    registerPage(page, doc) { pageDocs.add(doc); applyTheme(); },
    unregisterPage(page, doc) { pageDocs.delete(doc); },
    channels: () => ({ invoke: Object.keys(HANDLERS), send: Object.keys(SENDS) }),
  };

  applyTheme();
  placeBuddy();
  window.addEventListener('resize', placeBuddy);
  buddyFrame.src = '../renderer/buddy/index.html';
  panelFrame.src = '../renderer/panel/index.html';
  setTimeout(() => { if (!panelOpen && !userMoved) { $('hint').hidden = false; placeHint(); } }, 1800);
})();
