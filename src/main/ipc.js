'use strict';
// All IPC channels. Everything that comes from pages is validated here.

const { ipcMain, BrowserWindow, Menu, shell, app, clipboard, ClipboardItem, nativeImage } = require('electron');
const { sanitizePatch, publicView } = require('../shared/settings-schema');
const { PRESETS: EMAIL_PRESETS, SECURITY: EMAIL_SECURITY, VERIFIED_AT: EMAIL_VERIFIED_AT } = require('../shared/email-presets');
const notesLib = require('./notes');
const passBinding = require('./email/pass-binding');
const { shortPath } = require('./display-path');
const { rateLimiter } = require('./limits');
const { isTrustedFrame } = require('./ipc-sender');
const { buddyMenuTemplate } = require('./buddy-menu');
const MontageLib = require('../shared/montage');
const WebEmbed = require('./recorder/web-embed');
const { log } = require('./log');
const { userMessage, storeIssue } = require('./user-error');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v) => typeof v === 'string' && UUID_RE.test(v);

/** Accepts messages only from our own windows, loaded from the app's local files. */
function fromOurWindow(event, wins) {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!sender || !wins().includes(sender)) return false;
  return isTrustedFrame(event.senderFrame); // top frame only, our src/renderer pages only (L7)
}

function registerIpc(ctx) {
  const { windows, settingsStore, clipboardStore, notesStore, watcher, secrets, sessions,
          updateSettings, addClipboardText, broadcast, onSessionStopped, testNotification, getActivityStatus, email, mood, progress,
          getRecorder, reminders, capture, shots, recordingsFolder, chooseRecordingsFolder, resetRecordingsFolder, getClipExporter, mediaUrl, shotUrl, thumbUrl } = ctx;
  const ours = () => [windows.buddy, windows.panel, windows.timer, windows.stats, windows.editor, windows.viewer, windows.quick, windows.shotOverlay, windows.shotPicker, windows.shotCard, windows.shotView, windows.gallery].filter(Boolean);
  const recorderWin = () => [windows.recorder].filter(Boolean);

  const handle = (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!fromOurWindow(event, ours)) throw new Error('Request refused.');
    try {
      return await fn(...args);
    } catch (err) {
      // pages only get a short plain-English message: no file paths, no raw system text
      log.warn('ipc', `${channel} failed`, err);
      throw new Error(userMessage(err), { cause: err });   // the cause stays in main: IPC sends only the message
    }
  });
  const on = (channel, fn) => ipcMain.on(channel, (event, ...args) => {
    if (!fromOurWindow(event, ours)) return;
    fn(...args);
  });

  // ------------------------------------------------ buddy
  on('buddy:drag-start', () => windows.dragStart());
  on('buddy:drag-move', () => windows.dragMove());
  on('buddy:drag-end', () => windows.dragEnd());
  // the flag next to the buddy while recording: remember this moment (no global shortcut)
  on('buddy:mark', () => { const r = getRecorder(); if (r) r.mark(); });
  on('buddy:context-menu', () => {
    Menu.buildFromTemplate(buddyMenuTemplate({
      mode: settingsStore.data.uiMode,
      captureItems: capture.menuItems(),
      a: {
        openPanel: () => windows.showPanel(),
        openLook: () => windows.showPanel('settings', { cat: 'look' }),
        showTour: () => windows.showPanel(null, { tour: true }),
        openStats: () => windows.showStats(),
        openSettings: () => windows.showPanel('settings'),
        hideBuddy: () => updateSettings({ buddyVisible: false }),
        quit: () => app.quit(),
      },
    })).popup({ window: windows.buddy || undefined });
  });

  // the buddy's animations
  on('buddy:ready', () => mood.ready());
  on('buddy:woke', () => mood.woke());
  handle('buddy:demo', (type) => {
    if (!['wave', 'happy', 'wow', 'think', 'sleep', 'levelup'].includes(type)) throw new Error('Unknown animation.');
    if (!settingsStore.data.buddyAnimations) throw new Error('Animations are off. Turn them on above.');
    if (!settingsStore.data.buddyVisible) throw new Error('The buddy is hidden. Turn on "Show the buddy".');
    return mood.demo(type);
  });

  // ------------------------------------------------ panel
  on('panel:hide', () => windows.hidePanel());
  // the first-run tour: while it runs, a click outside doesn't hide the panel
  on('panel:tour', (active) => windows.setTourActive(active === true));

  // ------------------------------------------------ simple / full mode (every window asks; changes are broadcast as 'ui:mode-changed')
  handle('ui:mode', () => (settingsStore.data.uiMode === 'full' ? 'full' : 'simple'));

  // ------------------------------------------------ clipboard
  handle('clipboard:list', () => clipboardStore.data.items);
  handle('clipboard:copy', async (id) => {
    const item = isId(id) && clipboardStore.data.items.find((i) => i.id === id);
    if (!item) throw new Error('This item no longer exists.');
    await watcher.write(item.text);
    return true;
  });
  handle('clipboard:pin', (id, pinned) => {
    if (!isId(id) || typeof pinned !== 'boolean') throw new Error('Invalid data.');
    clipboardStore.update((d) => { d.items = d.items.map((i) => (i.id === id ? { ...i, pinned } : i)); });
    broadcast('clipboard:changed', clipboardStore.data.items);
    return true;
  });
  handle('clipboard:delete', (id) => {
    if (!isId(id)) throw new Error('Invalid data.');
    clipboardStore.update((d) => { d.items = d.items.filter((i) => i.id !== id); });
    broadcast('clipboard:changed', clipboardStore.data.items);
    return true;
  });
  handle('clipboard:clear', (keepPinned) => {
    clipboardStore.update((d) => { d.items = keepPinned === false ? [] : d.items.filter((i) => i.pinned); });
    // r2 sec L1 / L2: cleared text must not survive in the backup or in broken copies
    clipboardStore.flushScrubbed();
    clipboardStore.pruneCorrupt(0);
    broadcast('clipboard:changed', clipboardStore.data.items);
    return true;
  });
  handle('clipboard:add-current', async () => {
    // "Save what's in the clipboard now" (useful after a pause)
    const text = await watcher.readUnlessExcluded(); // respects the password-manager "do not save" mark
    if (text === null) return false;
    addClipboardText(text, { force: true });
    return true;
  });

  // ------------------------------------------------ notes
  // ------------------------------------------------ the buddy's progress (read only: computed from sessions)
  handle('progress:get', () => { const p = progress.get(); return p ? (p.last || p.refresh()) : null; });


  handle('notes:list', () => notesLib.sortNotes(notesStore.data.notes));
  const notesLimit = () => {
    if (notesStore.data.notes.length >= notesLib.MAX_NOTES) throw new Error(`You've reached the limit of ${notesLib.MAX_NOTES} notes. Delete a few to make room.`);
  };
  handle('notes:create', () => {
    notesLimit();
    let note;
    notesStore.update((d) => { const r = notesLib.addNewNote(d.notes); note = r.note; d.notes = r.notes; }); // bounded (L5)
    return note;
  });
  handle('notes:save', (id, body) => {
    if (!isId(id)) throw new Error('Invalid data.');
    notesStore.update((d) => { d.notes = notesLib.saveNote(d.notes, id, body); });
    // H1: say so when nothing reaches the disk (the tab then shows "Not saved")
    const issue = storeIssue(notesStore, 'Notes');
    if (issue) throw new Error(issue);
    return notesStore.data.notes.find((n) => n.id === id);
  });
  // a note's reminder: at = ms (in the future, at most 2 years ahead) or null = no reminder ("Done" / Delete)
  handle('notes:set-reminder', (id, at) => {
    if (!isId(id) || (at !== null && typeof at !== 'number')) throw new Error('Invalid data.');
    notesStore.update((d) => { d.notes = notesLib.setReminder(d.notes, id, at); });
    if (reminders) reminders.poke();
    return notesStore.data.notes.find((n) => n.id === id);
  });
  handle('notes:delete', (id) => {
    if (!isId(id)) throw new Error('Invalid data.');
    notesStore.update((d) => { d.notes = notesLib.deleteNote(d.notes, id); });
    return true;
  });

  // ------------------------------------------------ quick capture (1.8.0): the quick note and screenshots, only from buttons
  handle('quick:save', (text) => {
    const t = require('./capture').quickNoteText(text);
    if (!t) throw new Error('The note is empty.');
    notesLimit();
    let id = null;
    notesStore.update((d) => { const n = notesLib.createNote(); id = n.id; d.notes = notesLib.saveNote([n, ...d.notes], n.id, t); });
    broadcast('notes:changed', { reason: 'quick', ids: [id] });
    if (mood) mood.react('happy');
    return true;
  });
  on('quick:close', () => windows.hideQuickNote());
  handle('quick:open', () => { capture.quickNote(); return true; });
  handle('shot:zone', () => capture.zone());
  handle('shot:window', () => { capture.window(); return true; });
  handle('shot:overlay-info', () => shots.overlayInfo());
  on('shot:overlay-done', (corners) => { shots.finishZone(corners && typeof corners === 'object' ? corners : null).catch((e) => { log.warn('screenshot', 'zone save failed', e); shots.d.onError(userMessage(e, 'Couldn\'t save the picture.')); }); });
  on('shot:to-window', () => { shots.zoneToWindow(); });
  handle('shot:windows', () => shots.listWindows());
  on('shot:choose', (id) => {
    if (typeof id !== 'string' || id.length > 200) { windows.closeShotPicker(); return; }
    shots.captureWindow(id);
  });
  // one entry per screenshot (the annotated copy attached), with its thumbnail; `view` = what opens on click (the copy, if any)
  const shotEntry = (g) => ({
    ...g,
    view: g.copy ? g.copy.name : g.name,
    thumb: thumbUrl(g.copy ? g.copy.name : g.name, g.copy ? g.copy.at : g.at),
  });
  handle('shot:recent', async () => (await shots.recent(6)).map(shotEntry));
  handle('shot:gallery', () => { windows.showGallery(); return true; });
  // ------------------------------------------------ the gallery (1.12.0)
  handle('gallery:list', async () => (await shots.all()).map(shotEntry));
  handle('gallery:trash', async (names, mode) => shots.trashMany(Array.isArray(names) ? names.slice(0, 500) : [], mode === 'copies' ? 'copies' : 'all'));
  const importLimit = rateLimiter({ max: 200, windowMs: 60000 }); // L5: a page loop cannot fill the disk
  handle('gallery:import', async (name, png) => {
    if (!importLimit.take()) throw new Error('Too many images at once. Try again in a minute.');
    return shots.importImage(typeof name === 'string' ? name.slice(0, 200) : '', toBuf(png));
  });
  // dragging a screenshot into another app: startDrag must be called on the very page that started the drag
  ipcMain.on('gallery:start-drag', (event, name) => {
    if (!fromOurWindow(event, () => [windows.gallery].filter(Boolean))) return;
    try {
      const file = shots.dragFile(name);
      // only a thumbnail already in memory (the gallery showed it): never decode the full picture here
      const cached = shots.cachedThumb(require('path').basename(file));
      let icon = cached ? nativeImage.createFromBuffer(cached) : nativeImage.createEmpty();
      if (!icon.isEmpty()) icon = icon.resize({ width: 96, quality: 'good' });
      event.sender.startDrag({ file, icon });
    } catch (e) { console.warn('[gallery] drag:', e.message); }
  });
  // 1.10.0: the card after a capture, the view window, copy, delete (to the Recycle Bin)
  const shotInfo = (name) => (name ? { ...shots.info(name), url: shotUrl(name) } : null);
  handle('shotcard:info', () => shotInfo(windows.shotCardName));
  handle('shotview:info', () => {
    const i = shotInfo(windows.shotViewName);
    if (!i) return i;
    let pair;
    try { pair = shots.pairOf(i.name); } catch { pair = null; }
    // over the size limit: the page shows the thumbnail instead of decoding the full picture
    const preview = shots.isTooBig(i.name) ? thumbUrl(i.name, i.at) : null;
    return { ...i, pair, preview, ...windows.takeShotViewOpts() };   // pair (1.14.0): the "Annotated | Original" switch
  });
  on('shotcard:close', () => windows.closeShotCard());
  handle('shot:view', (name, opts) => {
    let size;
    try { size = shots.sizeOf(name); } catch { size = { width: 0, height: 0 }; }   // unreadable picture: the page shows the error
    if (shots.isTooBig(name)) size = { width: 1600, height: 1000 };
    windows.closeShotCard();
    windows.showShotView(name, size, { annotate: !!(opts && opts.annotate) });
    return true;
  });
  on('shotview:close', () => { if (windows.shotView && !windows.shotView.isDestroyed()) windows.shotView.destroy(); });
  // annotations (1.11.0): the screenshot in the large window (or its original, if it is an annotated copy)
  const isPng = (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a;
  const toBuf = (v) => Buffer.from(v instanceof ArrayBuffer ? new Uint8Array(v) : (ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : []));
  handle('annot:open', () => {
    windows.growShotView();
    const r = shots.loadAnnot(windows.shotViewName);
    return { ...r, url: shotUrl(r.source) };
  });
  // the source comes from the page (the screenshot being annotated), but goes through the same checks: only a PNG from the Screenshots folder
  handle('annot:save', async (source, doc) => { await shots.saveAnnot(shots.resolveSource(source), doc); return true; });
  handle('annot:export', async (source, png, doc) => shots.exportAnnot(shots.resolveSource(source), toBuf(png), doc));
  handle('annot:copy', async (png) => {
    const buf = toBuf(png);
    if (!isPng(buf) || buf.length > 200 * 1024 * 1024) throw new Error('The image is not a valid PNG.');
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([buf], { type: 'image/png' }) })]);
    return true;
  });
  // since Electron 44 the clipboard is async and has no writeImage: a ClipboardItem with the PNG is written, straight from the file
  handle('shot:copy', async (name) => {
    const png = await require('fs').promises.readFile(shots.fileOf(name));
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
    return true;
  });
  handle('shot:trash', (name, opts) => (opts && opts.both ? shots.trashWithPair(name, true) : shots.trash(name)));
  handle('shot:show', (name) => { shell.showItemInFolder(shots.fileOf(name)); return true; });
  handle('shot:open-folder', async () => { await require('fs').promises.mkdir(shots.dir(), { recursive: true }); return shell.openPath(shots.dir()); });

  // ------------------------------------------------ settings
  handle('settings:get', () => ({
    settings: publicView(settingsStore.data),
    emailPresets: EMAIL_PRESETS,
    emailSecurity: EMAIL_SECURITY,
    emailVerifiedAt: EMAIL_VERIFIED_AT,
    encryptionAvailable: secrets.available(),
    version: app.getVersion(),
  }));
  handle('settings:set', (patch) => {
    const clean = sanitizePatch(patch, settingsStore.data);
    return updateSettings(clean);
  });
  handle('settings:open-data-folder', () => shell.openPath(app.getPath('userData')));
  handle('settings:open-log-folder', async () => {
    const dir = require('path').join(app.getPath('userData'), 'logs');
    await require('fs').promises.mkdir(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('settings:reset-buddy', () => { windows.resetBuddyPosition(); return true; });

  // ------------------------------------------------ sessions + timer
  const title = (t) => (typeof t === 'string' ? t.slice(0, 500) : '');
  handle('session:get', () => sessions.state());
  handle('session:today', () => sessions.today());
  handle('session:start', (t) => sessions.begin(title(t)));
  handle('session:pause', () => sessions.pause());
  handle('session:resume', () => sessions.resume());
  handle('session:rename', (t) => sessions.rename(title(t)));
  handle('session:stop', () => {
    const summary = sessions.stop();
    onSessionStopped(summary);
    return summary;
  });
  handle('timer:settings', () => {
    const s = settingsStore.data;
    return { timerOpacity: s.timerOpacity, timerVisible: s.timerVisible, buddyAnimations: s.buddyAnimations, powerInfo: s.powerInfo || null };
  });
  handle('timer:reset-position', () => { windows.resetTimerPosition(); return true; });
  handle('notify:test', () => testNotification());
  handle('activity:status', () => getActivityStatus());
  handle('activity:open-permissions', () => {
    // macOS: System Settings → Privacy & Security → Accessibility
    if (process.platform !== 'darwin') return false;
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
    return true;
  });
  on('timer:drag-start', () => windows.timerDragStart());
  on('timer:drag-move', () => windows.timerDragMove());
  handle('timer:drag-end', () => ({ moved: windows.timerDragEnd() }));

  // ------------------------------------------------ statistics (the separate window)
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  handle('stats:open', () => { windows.showStats(); return true; });
  // past days come from a cache (day-cache.js): only today / the live session is recomputed (H3)
  handle('stats:workdays', () => (ctx.dayCache ? ctx.dayCache.workdays(sessions) : sessions.workdays()));
  handle('stats:last-days', () => sessions.lastDays(30));
  handle('stats:day', (day) => {
    if (typeof day !== 'string' || !DAY_RE.test(day)) throw new Error('Invalid day.');
    return sessions.daySummary(day);
  });

  // ------------------------------------------------ email: send only (SMTP), see src/main/email/
  handle('email:set-password', (password) => {
    const enc = secrets.encryptPassword(password);
    settingsStore.update((d) => { d.emailPassEnc = enc; d.emailPassFor = passBinding.bindingOf(d); d.emailPassReenter = false; });
    settingsStore.flushScrubbed();   // r2 sec L2: the old password leaves settings.json.bak too
    broadcast('settings:changed', publicView(settingsStore.data));
    return { saved: true };
  });
  handle('email:clear-password', () => {
    settingsStore.update((d) => { d.emailPassEnc = null; d.emailPassFor = null; d.emailPassReenter = false; });
    settingsStore.flushScrubbed();   // r2 sec L2 / L1: not in .bak, not in broken copies
    settingsStore.pruneCorrupt(0);
    broadcast('settings:changed', publicView(settingsStore.data));
    return { saved: false };
  });
  handle('email:status', () => {
    const { cfg, missing, complete } = email.provider.configFrom(settingsStore.data);
    return { connected: true, complete, missing, to: cfg.reportTo || null, presetsVerifiedAt: EMAIL_VERIFIED_AT };
  });
  handle('email:test', () => {
    const { cfg } = email.provider.configFrom(settingsStore.data);
    return email.smtp.testConnection(cfg);
  });
  // sends on request; only one at a time per kind, so a double click doesn't send twice
  const sending = new Set();
  const sendOnce = async (kind, build, to) => {
    if (sending.has(kind)) throw new Error('Already sending.');
    sending.add(kind);
    try {
      const { cfg } = email.provider.configFrom(settingsStore.data);
      const r = await email.smtp.sendMail(cfg, { to: to || cfg.reportTo, ...build() });
      if (r.sent) mood.react('happy');
      return r;
    } finally { sending.delete(kind); }
  };
  handle('email:send-range', () => sendOnce('range', () => email.compose.rangeReportEmail(sessions.lastDays(30))));
  // a note, to the addresses chosen in the send window (default: your address); the subject can be changed
  handle('email:send-note', async (id, opts) => {
    if (!isId(id)) throw new Error('Invalid data.');
    const note = notesStore.data.notes.find((n) => n.id === id);
    if (!note || !note.body.trim()) throw new Error('The note is empty.');
    const o = opts && typeof opts === 'object' ? opts : {};
    const to = email.provider.parseRecipients(typeof o.to === 'string' && o.to.trim() ? o.to.slice(0, 1000) : settingsStore.data.emailAddress);
    const subject = typeof o.subject === 'string' ? o.subject.slice(0, 200).trim() : '';
    const r = await sendOnce(`note:${id}`, () => {
      const m = email.compose.noteEmail(note.body);
      return subject ? { ...m, subject } : m;
    }, to);
    if (r.sent) {
      const recent = email.provider.updateRecent(settingsStore.data.emailRecent, to, settingsStore.data.emailAddress);
      if (JSON.stringify(recent) !== JSON.stringify(settingsStore.data.emailRecent)) updateSettings({ emailRecent: recent });
    }
    return { ...r, to };
  });
  handle('email:preview', async (kind) => {
    const { cfg } = email.provider.configFrom(settingsStore.data);
    let msg;
    if (kind === 'range') {
      msg = email.compose.rangeReportEmail(sessions.lastDays(30));
    } else if (kind === 'session') {
      let report = email.getLastReport();
      if (!report) {
        // after a restart: the last session saved on disk
        const last = (ctx.dayCache ? await ctx.dayCache.workdays(sessions) : sessions.workdays())[0];
        const rec = last && sessions.dayRecords(last.day).slice().sort((a, b) => b.end - a.end)[0];
        if (rec) report = email.compose.reportFromRecord(rec);
      }
      if (!report) throw new Error('You don\'t have any saved session yet.');
      msg = email.compose.sessionReportEmail(report);
    } else {
      throw new Error('Unknown email type.');
    }
    return { from: cfg.address || null, to: cfg.reportTo || null, ...msg };
  });

  // ------------------------------------------------ window recording (Portfolio)
  const rec = () => { const r = getRecorder(); if (!r) throw new Error('Recording isn\'t ready yet.'); return r; };
  const recItem = (id) => {
    const it = typeof id === 'string' && id.length <= 64 ? rec().find(id) : null;
    if (!it) throw new Error('This recording no longer exists.');
    return it;
  };
  handle('recorder:state', () => rec().state());
  handle('recorder:windows', async () => require('./recorder/rules').pickable(await rec().getSources()));
  handle('recorder:start', (sourceId) => {
    if (typeof sourceId !== 'string' || sourceId.length > 200) throw new Error('Invalid window.');
    return rec().startManual(sourceId).then(() => rec().state());
  });
  handle('recorder:stop', async () => { await rec().stop('manual'); return rec().state(); });
  handle('recorder:list', () => rec().listRecordings(20));
  handle('recorder:open', (id) => shell.openPath(recItem(id).file));
  handle('recorder:show', (id) => { shell.showItemInFolder(recItem(id).file); return true; });
  handle('recorder:trash', async (id) => {
    const it = recItem(id);
    await shell.trashItem(it.file);
    if (it.marksFile && require('fs').existsSync(it.marksFile)) await shell.trashItem(it.marksFile).catch(() => {});
    return true;
  });
  handle('recorder:mark', () => ({ t: rec().mark() }));
  handle('editor:open', (id) => { recItem(id); windows.showEditor(id); return true; });
  handle('recorder:folder', () => ({ label: shortPath(recordingsFolder(), app.getPath('home')), custom: !!settingsStore.data.recFolder }));
  handle('recorder:open-folder', async () => {
    const dir = recordingsFolder();
    require('fs').mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  handle('recorder:choose-folder', () => chooseRecordingsFolder(windows.panel));
  handle('recorder:reset-folder', () => resetRecordingsFolder());

  // the hidden capture window: only it may send these messages
  const onRec = (channel, fn) => ipcMain.on(channel, (event, ...args) => {
    if (!fromOurWindow(event, recorderWin)) return;
    const r = getRecorder();
    if (r) fn(r, ...args);
  });
  const toBuffer = (x) => {
    if (Buffer.isBuffer(x)) return x;
    if (ArrayBuffer.isView(x)) return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
    if (x instanceof ArrayBuffer) return Buffer.from(x);
    return null;
  };
  onRec('rec:started', (r, info) => r.onStarted(info && typeof info === 'object' ? info : {}));
  onRec('rec:chunk', (r, bytes) => { const b = toBuffer(bytes); if (b) r.onChunk(b); });
  onRec('rec:status', (r, info) => r.onStatus(info && typeof info === 'object' ? info : {}));
  onRec('rec:done', (r, info) => r.onDone(info && typeof info === 'object' ? info : {}));
  onRec('rec:source-ended', (r) => r.onSourceEnded());

  // ------------------------------------------------ the clip editor
  const editorItem = () => recItem(windows.editorItemId);
  const clips = () => { const c = getClipExporter(); if (!c) throw new Error('The editor isn\'t ready yet.'); return c; };
  handle('editor:info', () => {
    const it = editorItem();
    return {
      id: it.id, name: require('path').basename(it.file), label: it.label, url: mediaUrl(it.id),
      marks: Array.isArray(it.marks) ? it.marks : [], activeMs: it.activeMs, size: it.size || null,
      clipOf: it.clipOf || null, fps: settingsStore.data.recFps === 60 ? 60 : 30,
    };
  });
  handle('editor:clips', () => {
    const id = windows.editorItemId;
    return rec().list(300).filter((x) => x.clipOf === id).map((x) => ({
      id: x.id, name: x.name, startMs: x.startMs, endMs: x.endMs, bytes: x.bytes,
      format: x.format === 'gif' ? 'gif' : 'mp4', kind: x.kind === 'montage' ? 'montage' : 'clip', parts: x.parts || 1, activeMs: x.activeMs,
    }));
  });
  // spec = { parts, format: 'mp4', montage, title, fade }: validated in ClipExporter (shared/montage.js → checkExport)
  // queued jobs and the debounced montage save carry their recording id: the editor may show another recording by now
  const jobItem = (id) => (id === undefined || id === null ? editorItem() : recItem(id));
  const hookedEditors = new WeakSet();
  handle('editor:export-begin', (spec, id) => {
    const w = windows.editor;
    if (w && !hookedEditors.has(w)) { hookedEditors.add(w); w.once('closed', () => clips().cancelAll()); }   // closing the editor ends its open jobs
    return clips().begin(jobItem(id), spec && typeof spec === 'object' ? spec : null);
  });
  // the unfinished montage is kept on the recording (in recordings.json), so it isn't lost on close
  handle('editor:montage-get', () => { const it = editorItem(); return MontageLib.normalizeMontage(it.montage, it.activeMs); });
  handle('editor:montage-set', (m, id) => {
    const it = jobItem(id);
    const clean = MontageLib.normalizeMontage(m, it.activeMs);
    clips().index.update((d) => { const x = d.items.find((y) => y.id === it.id); if (x) x.montage = clean; });
    return clean;
  });
  on('editor:export-chunk', (jobId, bytes) => {
    if (typeof jobId !== 'string' || jobId.length > 64) return;
    const b = toBuffer(bytes);
    if (b) clips().chunk(jobId, b);
  });
  handle('editor:export-end', async (jobId, ok) => {
    if (typeof jobId !== 'string' || jobId.length > 64) throw new Error('Invalid export.');
    const item = await clips().end(jobId, ok === true);
    return item ? { id: item.id, name: require('path').basename(item.file) } : null;
  });
  handle('editor:open-file', (id) => shell.openPath(recItem(id).file));
  // plays a clip in a loop, in an app window (not in the Windows player)
  handle('editor:play-loop', (id, size) => {
    recItem(id);
    const sz = size && typeof size === 'object' ? { width: Number(size.width) || 0, height: Number(size.height) || 0 } : null;
    windows.showViewer(id, sz && sz.width <= 8000 && sz.height <= 8000 ? sz : null);
    return true;
  });
  // "Code for a website": a copy with a web-friendly name in "clips\for web\" + the <video> code (autoplay, loop) in the clipboard
  handle('editor:web-embed', async (id, size) => {
    const it = recItem(id);
    if (it.format === 'gif' || !/\.mp4$/i.test(it.file)) throw new Error('Only for MP4 clips.');
    const fsp = require('fs').promises;
    const p = require('path');
    const dir = p.join(p.dirname(it.file), WebEmbed.WEB_FOLDER);
    await fsp.mkdir(dir, { recursive: true });
    const src = await fsp.stat(it.file);
    const base = WebEmbed.webFileName(it.file);
    let name = base;
    // same name, another clip → "-2", "-3"…; the same copy (same size) is reused
    for (let n = 2; n < 100; n++) {
      const st = await fsp.stat(p.join(dir, name)).catch(() => null);
      if (!st || st.size === src.size) break;
      name = base.replace(/\.mp4$/, `-${n}.mp4`);
    }
    const target = p.join(dir, name);
    if (!(await fsp.stat(target).catch(() => null))) await fsp.copyFile(it.file, target);
    const sz = size && typeof size === 'object' ? size : {};
    const snippet = WebEmbed.embedSnippet({ fileName: name, width: sz.width, height: sz.height, label: it.label });
    await clipboard.writeText(snippet);
    shell.showItemInFolder(target);
    return { fileName: name, folder: WebEmbed.WEB_FOLDER, snippet };
  });
  handle('viewer:info', () => {
    const it = recItem(windows.viewerItemId);
    return { id: it.id, url: mediaUrl(it.id), name: require('path').basename(it.file), label: it.label };
  });
  handle('viewer:show-file', () => { shell.showItemInFolder(recItem(windows.viewerItemId).file); return true; });
  handle('editor:show-file', (id) => { shell.showItemInFolder(recItem(id).file); return true; });
  onRec('rec:attached', (r) => r.onAttached());
  onRec('rec:error', (r, message) => r.fail(new Error(typeof message === 'string' ? message : 'Recording error.')));
}

module.exports = { registerIpc };
