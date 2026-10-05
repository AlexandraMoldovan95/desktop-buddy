'use strict';
// The buddy window (the button on the desktop) and the panel window.

const path = require('path');
const { app, BrowserWindow, screen, nativeTheme } = require('electron');
const { windowTitle } = require('./buddy-menu');
const { createReadyGate } = require('./ready-gate');

const PAD = 14;           // transparent space around the button (shadow + animations: the hand, Zzz, the jump)
const PANEL_W = 400;      // includes the transparent margin for the panel's shadow
const PANEL_H = 560;
const GAP = 4;
const DRAG_THRESHOLD = 4; // under 4 px of movement = a click, above = a move
const TIMER_W = 336;      // 320 + the transparent margin
const TIMER_H = 80;       // 64 + the transparent margin
const BLUR_GRACE_MS = 300;
const HIDDEN_DESTROY_MS = 20000;   // quick note / screenshot card: destroyed this long after being hidden
const STATS_W = 980;      // the Statistics window: normal, with a title bar, resizable
const STATS_H = 680;

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload');
const ICON = path.join(__dirname, '..', 'assets', 'icon.png');

function securePrefs(preload) {
  return {
    preload: path.join(PRELOAD, preload),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    devTools: !app.isPackaged,
  };
}

/** No page navigates elsewhere or opens new windows. */
function lockDown(win) {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // F19: one title pattern everywhere ("<What> – Desktop Buddy"), whatever the page's <title> says
  win.on('page-title-updated', (e, title) => { e.preventDefault(); if (!win.isDestroyed()) win.setTitle(windowTitle(title)); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

/** A saved position is valid if the window's center falls on an existing screen. */
function isOnScreen(pos, width, height) {
  if (!pos) return false;
  const cx = pos.x + width / 2;
  const cy = pos.y + height / 2;
  return screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
  });
}

function createWindows({ getSettings, saveBuddyPos, saveTimerPos, hasSession, onPanelShown = () => {}, onPanelContextMenu = () => {} }) {
  let buddy = null;
  let panel = null;
  let timer = null;
  let drag = null;
  let timerDrag = null;
  let stats = null;
  let recorder = null;
  let editor = null;
  let editorItemId = null;
  let viewer = null;          // (Portfolio) the window that plays a clip in a loop
  let viewerItemId = null;
  let quick = null;           // the quick note, next to the buddy (1.8.0)
  let shotOverlay = null;     // the area selection for a screenshot (1.8.0)
  let shotPicker = null;      // the list of windows for a screenshot (1.8.0)
  let shotGrabber = null;     // the hidden window that grabs a frame from a window (1.8.0)
  let shotCard = null;        // the card with the screenshot, next to the buddy, after each screenshot (1.10.0)
  let shotCardName = null;
  let shotView = null;        // the window that shows a large screenshot (1.10.0)
  let shotViewName = null;
  let shotViewOpts = {};      // { annotate } for the next load (1.11.0)
  let gallery = null;         // the "Screenshots" window: all screenshots (1.12.0)
  let lastBlurHideAt = 0;
  let tourActive = false;   // the first-run tour is open in the panel (hideOnBlur is suspended)
  let panelIdleTimer = null;
  const PM = require('./power-mode');
  const lowPowerTuning = () => { const i = getSettings().powerInfo; return PM.tuning(!!(i && i.low)); };

  const outer = (size) => size + PAD * 2;

  /** The saved position, if it is still on an existing screen; otherwise the bottom-right corner. */
  function initialBounds() {
    const s = getSettings();
    const size = outer(s.buddySize);
    const pos = s.buddyPos;
    if (pos) {
      const onScreen = screen.getAllDisplays().some((d) => {
        const a = d.workArea;
        return pos.x >= a.x - size / 2 && pos.y >= a.y - size / 2 &&
          pos.x + size / 2 <= a.x + a.width && pos.y + size / 2 <= a.y + a.height;
      });
      if (onScreen) return { x: pos.x, y: pos.y, width: size, height: size };
    }
    const a = screen.getPrimaryDisplay().workArea;
    return { x: a.x + a.width - size - 24, y: a.y + a.height - size - 24, width: size, height: size };
  }

  function clampToWorkArea(b) {
    const a = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea;
    return {
      ...b,
      x: Math.min(Math.max(b.x, a.x - PAD), a.x + a.width - b.width + PAD),
      y: Math.min(Math.max(b.y, a.y - PAD), a.y + a.height - b.height + PAD),
    };
  }

  function createBuddy() {
    const s = getSettings();
    buddy = new BrowserWindow({
      ...initialBounds(),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: s.alwaysOnTop,
      show: false,
      title: 'Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('buddy.js'),
    });
    lockDown(buddy);
    if (s.alwaysOnTop) buddy.setAlwaysOnTop(true, 'floating');
    buddy.setOpacity(s.buddyOpacity / 100);
    buddy.loadFile(path.join(RENDERER, 'buddy', 'index.html'));
    buddy.once('ready-to-show', () => { if (getSettings().buddyVisible) buddy.showInactive(); });
    buddy.on('closed', () => { buddy = null; });
    return buddy;
  }

  const panelGate = createReadyGate();
  function createPanel() {
    const s = getSettings();
    panel = new BrowserWindow({
      width: PANEL_W,
      height: PANEL_H,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: s.alwaysOnTop,
      show: false,
      title: 'Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('panel.js'),   // no spellchecker (removed in 1.6.0)
    });
    lockDown(panel);
    // the page loaded (DOM + scripts): earlier than a hidden window's first paint, which can lag ~1 s
    panelGate.reset(panel.webContents, 'did-finish-load');
    panel.webContents.on('context-menu', (e, params) => onPanelContextMenu(panel, params));
    // the mouse Back button (Windows sends it as an app command): one step back inside the panel
    panel.on('app-command', (_e, cmd) => {
      if (!app.isPackaged) console.log(`[panel] app-command: ${cmd}`);   // dev diagnostics: which way the mouse Back arrives
      if (cmd === 'browser-backward' && panel && !panel.isDestroyed()) panel.webContents.send('panel:back');
    });
    panel.loadFile(path.join(RENDERER, 'panel', 'index.html'));
    panel.on('blur', () => {
      if (getSettings().hideOnBlur && panel.isVisible() && !tourActive) {   // the first-run tour keeps it open
        lastBlurHideAt = Date.now();
        panel.hide();
      }
    });
    // low-power mode: a panel hidden for a few minutes is closed (a whole renderer), reopened on demand
    panel.on('hide', schedulePanelIdle);
    panel.on('show', () => { clearTimeout(panelIdleTimer); panelIdleTimer = null; });
    panel.on('hide', () => { tourActive = false; });
    panel.on('closed', () => { panel = null; clearTimeout(panelIdleTimer); panelIdleTimer = null; });
    schedulePanelIdle();   // created hidden counts as hidden
    return panel;
  }
  function schedulePanelIdle() {
    const testMs = !app.isPackaged ? Number(process.env.BUDDY_TEST_PANEL_IDLE_MS) : 0;   // e2e only
    const ms = lowPowerTuning().panelIdleDestroyMs && (testMs > 0 ? testMs : lowPowerTuning().panelIdleDestroyMs);
    clearTimeout(panelIdleTimer);
    panelIdleTimer = null;
    if (ms) panelIdleTimer = setTimeout(() => { if (panel && !panel.isDestroyed() && !panel.isVisible() && lowPowerTuning().panelIdleDestroyMs) panel.destroy(); }, ms);
  }

  /** The panel opens next to the buddy, on the side where there is room. */
  function positionPanel() {
    if (!buddy || !panel) return;
    const b = buddy.getBounds();
    // the visible button, without the transparent margin
    const btn = { x: b.x + PAD, y: b.y + PAD, width: b.width - PAD * 2, height: b.height - PAD * 2 };
    const a = screen.getDisplayMatching(b).workArea;
    const spaceRight = a.x + a.width - (btn.x + btn.width);
    const spaceLeft = btn.x - a.x;
    const spaceBelow = a.y + a.height - (btn.y + btn.height);
    let x;
    let y;
    let side;   // where the buddy is, seen from the panel (the tour's bubble points there)
    if (spaceRight >= PANEL_W + GAP || spaceLeft >= PANEL_W + GAP) {
      x = spaceRight >= spaceLeft ? btn.x + btn.width + GAP : btn.x - PANEL_W - GAP;
      y = btn.y + btn.height / 2 - PANEL_H / 2;
      side = spaceRight >= spaceLeft ? 'left' : 'right';
    } else {
      x = btn.x + btn.width / 2 - PANEL_W / 2;
      y = spaceBelow >= PANEL_H + GAP ? btn.y + btn.height + GAP : btn.y - PANEL_H - GAP;
      side = spaceBelow >= PANEL_H + GAP ? 'top' : 'bottom';
    }
    x = Math.min(Math.max(x, a.x), a.x + a.width - PANEL_W);
    y = Math.min(Math.max(y, a.y), a.y + a.height - PANEL_H);
    panel.setBounds({ x: Math.round(x), y: Math.round(y), width: PANEL_W, height: PANEL_H });
    return side;
  }

  /**
   * @param {string} [tab]  @param {{ note?: string, cat?: string, tour?: boolean }} [extra]
   * e.g. showPanel('notes', { note: id }) opens the note; showPanel(null, { tour: true }) starts the tour
   */
  function showPanel(tab, extra = {}) {
    if (!panel) createPanel();
    panelGate.show(() => showPanelNow(tab, extra));   // r2 perf M4: a new panel shows once its page has painted
  }
  function showPanelNow(tab, extra) {
    if (!panel || panel.isDestroyed()) return;
    const side = positionPanel() || null;
    panel.show();
    panel.focus();
    const opened = { tab: tab || null, note: extra.note || null, cat: extra.cat || null, tour: !!extra.tour, buddySide: side };
    // a panel created just now (low-power mode closes the hidden one) gets the message once its page is loaded
    if (panel.webContents.isLoading()) { const p = panel; p.webContents.once('did-finish-load', () => { if (!p.isDestroyed()) p.webContents.send('panel:opened', opened); }); }
    else panel.webContents.send('panel:opened', opened);
    onPanelShown();
  }

  function hidePanel() {
    panelGate.cancel();
    if (panel && panel.isVisible()) panel.hide();
  }

  /** While the first-run tour runs, clicking elsewhere (or on the buddy) doesn't close the panel. */
  function setTourActive(on) { tourActive = !!on; }

  function togglePanel(tab) {
    if (panel && panel.isVisible()) { if (tourActive) { panel.focus(); return undefined; } return hidePanel(); }
    // a click on the buddy right when the panel hid because of it: we leave it closed
    if (Date.now() - lastBlurHideAt < BLUR_GRACE_MS) return;
    showPanel(tab);
  }

  // ------------------------------------------------ moving the button
  function dragStart() {
    if (!buddy) return;
    drag = { cursor: screen.getCursorScreenPoint(), bounds: buddy.getBounds(), moved: false };
  }

  function dragMove() {
    if (!buddy || !drag) return;
    const c = screen.getCursorScreenPoint();
    const dx = c.x - drag.cursor.x;
    const dy = c.y - drag.cursor.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) { drag.moved = true; hidePanel(); }
    // setBounds with a fixed size: on Windows with 125 %/150 % scaling, setPosition can grow the window
    const size = drag.bounds.width;
    buddy.setBounds(clampToWorkArea({ x: drag.bounds.x + dx, y: drag.bounds.y + dy, width: size, height: size }));
  }

  function dragEnd() {
    if (!buddy || !drag) return;
    const wasDrag = drag.moved;
    drag = null;
    if (wasDrag) {
      const b = buddy.getBounds();
      saveBuddyPos({ x: b.x, y: b.y });
    } else {
      togglePanel();
    }
  }

  // ------------------------------------------------ settings applied right away
  function applySettings(s, changed) {
    if (buddy) {
      if ('alwaysOnTop' in changed) buddy.setAlwaysOnTop(s.alwaysOnTop, 'floating');
      if ('buddyOpacity' in changed) buddy.setOpacity(s.buddyOpacity / 100);
      if ('buddySize' in changed) {
        const b = buddy.getBounds();
        const size = outer(s.buddySize);
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        buddy.setBounds(clampToWorkArea({ x: Math.round(cx - size / 2), y: Math.round(cy - size / 2), width: size, height: size }));
        const nb = buddy.getBounds();
        saveBuddyPos({ x: nb.x, y: nb.y });
      }
      if ('buddyVisible' in changed) {
        if (s.buddyVisible) buddy.showInactive(); else { buddy.hide(); }
      }
    }
    if (panel && 'alwaysOnTop' in changed) panel.setAlwaysOnTop(s.alwaysOnTop);
    if (timer && 'timerOpacity' in changed) timer.setOpacity(s.timerOpacity / 100);
    if ('timerVisible' in changed) updateTimerVisibility();
  }

  function resetBuddyPosition() {
    if (!buddy) { createBuddy(); return; } // closed after repeated crashes (window-guard.js): bring it back
    const a = screen.getPrimaryDisplay().workArea;
    const size = buddy.getBounds().width;
    const b = { x: a.x + a.width - size - 24, y: a.y + a.height - size - 24, width: size, height: size };
    buddy.setBounds(b);
    saveBuddyPos({ x: b.x, y: b.y });
    if (!buddy.isVisible()) buddy.showInactive();
  }

  // ------------------------------------------------ the timer window
  function timerInitialBounds() {
    const pos = getSettings().timerPos;
    if (isOnScreen(pos, TIMER_W, TIMER_H)) return { x: pos.x, y: pos.y, width: TIMER_W, height: TIMER_H };
    // the saved position is no longer on any screen (monitor removed): top, centered, on the primary screen
    const a = screen.getPrimaryDisplay().workArea;
    return { x: Math.round(a.x + a.width / 2 - TIMER_W / 2), y: a.y + 12, width: TIMER_W, height: TIMER_H };
  }

  function createTimer() {
    const s = getSettings();
    timer = new BrowserWindow({
      ...timerInitialBounds(),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      title: 'Timer – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('timer.js'),
    });
    lockDown(timer);
    timer.setAlwaysOnTop(true, 'floating');
    timer.setOpacity(s.timerOpacity / 100);
    timer.loadFile(path.join(RENDERER, 'timer', 'index.html'));
    timer.once('ready-to-show', () => updateTimerVisibility());
    timer.on('closed', () => { timer = null; });
    return timer;
  }

  /** The timer shows only with a running session and if you didn't hide it. Otherwise it doesn't exist (no hidden renderer, H4). */
  function updateTimerVisibility() {
    const want = hasSession() && getSettings().timerVisible;
    if (!want) {
      if (timer && !timer.isDestroyed()) timer.destroy();
      timer = null;
      return;
    }
    if (!timer) { createTimer(); return; }   // shown on ready-to-show
    if (timer.webContents.isLoading()) return;
    if (!timer.isVisible()) timer.showInactive();
  }

  function timerDragStart() {
    if (!timer) return;
    timerDrag = { cursor: screen.getCursorScreenPoint(), bounds: timer.getBounds(), moved: false };
  }

  function timerDragMove() {
    if (!timer || !timerDrag) return;
    const c = screen.getCursorScreenPoint();
    const dx = c.x - timerDrag.cursor.x;
    const dy = c.y - timerDrag.cursor.y;
    if (!timerDrag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    timerDrag.moved = true;
    const { width, height } = timerDrag.bounds;
    timer.setBounds(clampToWorkArea({ x: timerDrag.bounds.x + dx, y: timerDrag.bounds.y + dy, width, height }));
  }

  /** @returns {boolean} true if it was a move (not a click) */
  function timerDragEnd() {
    if (!timer || !timerDrag) return false;
    timerDragMove();
    const moved = timerDrag.moved;
    timerDrag = null;
    if (moved) {
      const b = timer.getBounds();
      saveTimerPos({ x: b.x, y: b.y });
    }
    return moved;
  }

  function resetTimerPosition() {
    const a = screen.getPrimaryDisplay().workArea;
    const b = { x: Math.round(a.x + a.width / 2 - TIMER_W / 2), y: a.y + 12, width: TIMER_W, height: TIMER_H };
    if (timer) timer.setBounds(b);   // no session = no timer window: the saved position is enough (H4)
    saveTimerPos({ x: b.x, y: b.y });
  }

  // ------------------------------------------------ the Statistics window
  /** Opens on the screen where the mouse is; if it is already open, it just comes to the front. */
  /** The "Screenshots" gallery (1.12.0): a normal window, like Statistics; a single instance. */
  function showGallery() {
    hidePanel();
    if (gallery && !gallery.isDestroyed()) {
      if (gallery.isMinimized()) gallery.restore();
      gallery.show();
      gallery.focus();
      return gallery;
    }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(STATS_W, a.width - 40);
    const height = Math.min(STATS_H + 40, a.height - 40);
    gallery = new BrowserWindow({
      x: Math.round(a.x + (a.width - width) / 2),
      y: Math.round(a.y + (a.height - height) / 2),
      width,
      height,
      minWidth: 560,
      minHeight: 420,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#17171D' : '#F6F6F9',
      title: 'Pictures – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('gallery.js'),
    });
    gallery.removeMenu();
    lockDown(gallery);
    gallery.loadFile(path.join(RENDERER, 'shot', 'gallery.html'));
    gallery.once('ready-to-show', () => { gallery.show(); gallery.focus(); });
    gallery.on('closed', () => { gallery = null; });
    return gallery;
  }

  function showStats() {
    if (stats) {
      if (stats.isMinimized()) stats.restore();
      stats.show();
      stats.focus();
      return stats;
    }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(STATS_W, a.width - 40);
    const height = Math.min(STATS_H, a.height - 40);
    stats = new BrowserWindow({
      x: Math.round(a.x + (a.width - width) / 2),
      y: Math.round(a.y + (a.height - height) / 2),
      width,
      height,
      minWidth: 720,
      minHeight: 480,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#17171D' : '#F6F6F9',
      title: 'Statistics – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('stats.js'),
    });
    stats.removeMenu();
    lockDown(stats);
    stats.loadFile(path.join(RENDERER, 'stats', 'index.html'));
    stats.once('ready-to-show', () => { stats.show(); stats.focus(); });
    stats.on('closed', () => { stats = null; });
    return stats;
  }

  // ------------------------------------------------ the hidden capture window (recording)
  /** Created for each recording and destroyed afterwards, so it doesn't hold memory. */
  function createRecorder() {
    if (recorder) { recorder.destroy(); recorder = null; }
    const win = new BrowserWindow({
      width: 320,
      height: 200,
      show: false,
      skipTaskbar: true,
      title: 'Recording – Desktop Buddy',
      webPreferences: { ...securePrefs('recorder.js'), partition: 'recorder', backgroundThrottling: false, devTools: !app.isPackaged },
    });
    win.removeMenu();
    lockDown(win);
    win.on('closed', () => { if (recorder === win) recorder = null; });
    recorder = win;
    return win.loadFile(path.join(RENDERER, 'recorder', 'index.html')).then(() => win);
  }

  function destroyRecorder() {
    if (recorder && !recorder.isDestroyed()) recorder.destroy();
    recorder = null;
  }

  // ------------------------------------------------ the clip editor (Portfolio)
  /** A single window; opened for another recording, it just changes its content. */
  function showEditor(id) {
    editorItemId = id;
    if (editor) {
      editor.webContents.send('editor:load', { id });
      if (editor.isMinimized()) editor.restore();
      editor.show();
      editor.focus();
      return editor;
    }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.min(1080, a.width - 40);
    const height = Math.min(760, a.height - 40);
    editor = new BrowserWindow({
      x: Math.round(a.x + (a.width - width) / 2),
      y: Math.round(a.y + (a.height - height) / 2),
      width,
      height,
      minWidth: 760,
      minHeight: 560,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#17171D' : '#F6F6F9',
      title: 'Cut a clip – Desktop Buddy',
      icon: ICON,
      // the export plays and re-records the video: it must not be slowed down when the window is not in front
      webPreferences: { ...securePrefs('editor.js'), backgroundThrottling: false },
    });
    editor.removeMenu();
    lockDown(editor);
    editor.loadFile(path.join(RENDERER, 'editor', 'index.html'));
    editor.once('ready-to-show', () => { editor.show(); editor.focus(); });
    editor.on('closed', () => { editor = null; editorItemId = null; });
    return editor;
  }

  /**
   * Plays a clip / montage in a loop, scaled to the window (for presentations and the portfolio).
   * A single window: a second open loads another clip into it. `size` = the video's { width, height }, if known.
   */
  function showViewer(id, size) {
    viewerItemId = id;
    if (viewer) {
      viewer.webContents.send('viewer:load', { id });
      if (viewer.isMinimized()) viewer.restore();
      viewer.show();
      viewer.focus();
      return viewer;
    }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    // the video's size (as much as fits in 90 % of the screen), otherwise a large 16:9
    const vw = size && size.width > 0 ? size.width : 1280;
    const vh = size && size.height > 0 ? size.height : 720;
    const k = Math.min(1, (a.width * 0.9) / vw, (a.height * 0.9 - 40) / vh);
    const width = Math.max(480, Math.round(vw * k));
    const height = Math.max(320, Math.round(vh * k) + 40);
    viewer = new BrowserWindow({
      x: Math.round(a.x + (a.width - width) / 2),
      y: Math.round(a.y + (a.height - height) / 2),
      width,
      height,
      minWidth: 360,
      minHeight: 240,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#000000',
      title: 'Video – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('viewer.js'),
    });
    viewer.removeMenu();
    lockDown(viewer);
    viewer.loadFile(path.join(RENDERER, 'viewer', 'index.html'));
    viewer.once('ready-to-show', () => { viewer.show(); viewer.focus(); });
    viewer.on('closed', () => { viewer = null; viewerItemId = null; });
    return viewer;
  }


  // ------------------------------------------------ quick capture (1.8.0): the quick note and screenshots
  const QUICK_W = 380;   // includes the transparent margin for the shadow
  const QUICK_H = 196;

  /** A small window sits next to the buddy, like the panel (right / left / below / above, where there is room). */
  function nearBuddy(w, h) {
    const ref = buddy && buddy.isVisible() ? buddy.getBounds() : null;
    const a = (ref ? screen.getDisplayMatching(ref) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
    if (!ref) return { x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 3), width: w, height: h };
    const btn = { x: ref.x + PAD, y: ref.y + PAD, width: ref.width - PAD * 2, height: ref.height - PAD * 2 };
    const right = a.x + a.width - (btn.x + btn.width);
    const left = btn.x - a.x;
    let x;
    let y;
    if (right >= w + GAP || left >= w + GAP) {
      x = right >= left ? btn.x + btn.width + GAP : btn.x - w - GAP;
      y = btn.y + btn.height / 2 - h / 2;
    } else {
      x = btn.x + btn.width / 2 - w / 2;
      y = a.y + a.height - (btn.y + btn.height) >= h + GAP ? btn.y + btn.height + GAP : btn.y - h - GAP;
    }
    x = Math.min(Math.max(x, a.x), a.x + a.width - w);
    y = Math.min(Math.max(y, a.y), a.y + a.height - h);
    return { x: Math.round(x), y: Math.round(y), width: w, height: h };
  }

  function showQuickNote() {
    hidePanel();
    if (!quick) {
      quick = new BrowserWindow({
        ...nearBuddy(QUICK_W, QUICK_H),
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        resizable: false,
        maximizable: false,
        minimizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        hasShadow: false,
        alwaysOnTop: true,
        show: false,
        title: 'Quick note – Desktop Buddy',
        icon: ICON,
        webPreferences: securePrefs('quick.js'),
      });
      lockDown(quick);
      quick.loadFile(path.join(RENDERER, 'quick', 'index.html'));
      quick.once('ready-to-show', () => { quick.show(); quick.focus(); });
      quick.on('closed', () => { quick = null; });
      return quick;
    }
    keepAlive('quick');
    quick.setBounds(nearBuddy(QUICK_W, QUICK_H));
    quick.webContents.send('quick:shown');
    quick.show();
    quick.focus();
    return quick;
  }
  function hideQuickNote() {
    if (!quick || quick.isDestroyed()) return;
    quick.hide();
    destroyWhenHidden(quick, 'quick');
  }

  /** The area selection window: covers exactly the screen the capture was taken on. */
  function showShotOverlay(display) {
    closeShotOverlay();
    const b = display.bounds;
    shotOverlay = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height: b.height,
      frame: false,
      resizable: false,
      movable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      backgroundColor: '#000000',
      title: 'Picture – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('shot.js'),
    });
    shotOverlay.setAlwaysOnTop(true, 'screen-saver');
    lockDown(shotOverlay);
    shotOverlay.loadFile(path.join(RENDERER, 'shot', 'overlay.html'));
    shotOverlay.once('ready-to-show', () => { shotOverlay.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height }); shotOverlay.show(); shotOverlay.focus(); });
    shotOverlay.on('closed', () => { shotOverlay = null; });
    return shotOverlay;
  }
  function closeShotOverlay() { if (shotOverlay && !shotOverlay.isDestroyed()) shotOverlay.destroy(); shotOverlay = null; }

  /** The list of open windows, with thumbnails: click = a screenshot of that window. */
  function showShotPicker() {
    hidePanel();
    if (shotPicker && !shotPicker.isDestroyed()) { shotPicker.webContents.send('shot:refresh'); shotPicker.show(); shotPicker.focus(); return shotPicker; }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const w = Math.min(760, a.width - 40);
    const h = Math.min(560, a.height - 40);
    shotPicker = new BrowserWindow({
      x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h,
      minWidth: 420, minHeight: 320,
      show: false,
      autoHideMenuBar: true,
      alwaysOnTop: true,
      title: 'Pick a window – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('shot.js'),
    });
    shotPicker.removeMenu();
    lockDown(shotPicker);
    shotPicker.loadFile(path.join(RENDERER, 'shot', 'picker.html'));
    shotPicker.once('ready-to-show', () => { shotPicker.show(); shotPicker.focus(); });
    shotPicker.on('closed', () => { shotPicker = null; });
    return shotPicker;
  }
  function closeShotPicker() { if (shotPicker && !shotPicker.isDestroyed()) shotPicker.destroy(); shotPicker = null; }

  /** A frame from the chosen window, at its real size (getDisplayMedia, the "shot" session). @returns {Promise<string>} PNG as a data URL */
  async function grabFrame(fake) {
    if (shotGrabber && !shotGrabber.isDestroyed()) shotGrabber.destroy();
    shotGrabber = new BrowserWindow({
      width: 320, height: 200, show: false, skipTaskbar: true, title: 'Picture – Desktop Buddy',
      webPreferences: { ...securePrefs('shot.js'), partition: 'shot', backgroundThrottling: false },
    });
    lockDown(shotGrabber);
    try {
      await shotGrabber.loadFile(path.join(RENDERER, 'shot', 'grab.html'));
      // "true" = like a user click: getDisplayMedia requires it
      const grab = shotGrabber.webContents.executeJavaScript(`window.shotGrab.grab(${JSON.stringify({ fake: !!fake })})`, true);
      const timeout = new Promise((_r, reject) => setTimeout(() => reject(new Error('The window didn\'t respond in time (is it minimized?).')), 10000));
      return await Promise.race([grab, timeout]);
    } finally {
      if (shotGrabber && !shotGrabber.isDestroyed()) shotGrabber.destroy();
      shotGrabber = null;
    }
  }

  // ------------------------------------------------ after a capture (1.10.0): the card next to the buddy and the large view
  const CARD_W = 344;   // includes the transparent margin for the shadow
  const CARD_H = 304;

  /** The card with the screenshot just taken. It appears without taking focus (doesn't pull you out of what you were typing); it closes by itself after a few seconds. */
  function showShotCard(name) {
    shotCardName = name;
    if (shotCard && !shotCard.isDestroyed()) {
      keepAlive('card');
      shotCard.setBounds(nearBuddy(CARD_W, CARD_H));
      shotCard.webContents.send('shotview:load');
      shotCard.showInactive();
      return shotCard;
    }
    shotCard = new BrowserWindow({
      ...nearBuddy(CARD_W, CARD_H),
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      show: false,
      title: 'Picture ready – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('shotview.js'),
    });
    lockDown(shotCard);
    shotCard.loadFile(path.join(RENDERER, 'shot', 'card.html'));
    shotCard.once('ready-to-show', () => { if (shotCard && !shotCard.isDestroyed()) shotCard.showInactive(); });
    shotCard.on('closed', () => { shotCard = null; shotCardName = null; });
    return shotCard;
  }
  function closeShotCard() {
    if (!shotCard || shotCard.isDestroyed()) return;
    shotCard.hide();
    destroyWhenHidden(shotCard, 'card');
  }

  // Hidden small windows are destroyed after a short grace (a quick reopen reuses them), so they don't keep
  // a whole renderer process alive until the app quits (H4).
  const hiddenTimers = {};
  function destroyWhenHidden(win, key) {
    clearTimeout(hiddenTimers[key]);
    hiddenTimers[key] = setTimeout(() => { delete hiddenTimers[key]; if (!win.isDestroyed() && !win.isVisible()) win.destroy(); }, HIDDEN_DESTROY_MS);
  }
  function keepAlive(key) { clearTimeout(hiddenTimers[key]); delete hiddenTimers[key]; }

  const ANNOT_W = 1200;   // the toolbar fits on one row (1.13.0: + Undo / Delete selection with text)
  const ANNOT_H = 720;
  /** The window grows (if it is small) when you enter annotate mode; it stays on screen. */
  function growForAnnotate(win) {
    const b = win.getBounds();
    const a = screen.getDisplayMatching(b).workArea;
    const w = Math.max(b.width, Math.min(ANNOT_W, a.width - 40));
    const h = Math.max(b.height, Math.min(ANNOT_H, a.height - 40));
    if (w === b.width && h === b.height) return;
    const x = Math.min(Math.max(a.x, b.x - Math.round((w - b.width) / 2)), a.x + a.width - w);
    const y = Math.min(Math.max(a.y, b.y - Math.round((h - b.height) / 2)), a.y + a.height - h);
    win.setBounds({ x, y, width: w, height: h });
  }

  /** The large screenshot: fit to the window or at 100 %. A single window; a second open loads another screenshot into it. */
  function showShotView(name, size, opts = {}) {
    shotViewName = name;
    shotViewOpts = { annotate: !!opts.annotate };
    if (shotView && !shotView.isDestroyed()) {
      if (opts.annotate) growForAnnotate(shotView);
      shotView.webContents.send('shotview:load');
      if (shotView.isMinimized()) shotView.restore();
      shotView.show();
      shotView.focus();
      return shotView;
    }
    const a = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const sf = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).scaleFactor || 1;
    // the screenshot is in real pixels: at 150 % it takes size / 1.5 on screen; the window as big as the screenshot, at most 85 % of the screen
    const iw = size && size.width > 0 ? size.width / sf : 1280;
    const ih = size && size.height > 0 ? size.height / sf : 720;
    const BAR = 48;       // the top bar
    const PADV = 32;      // the margin around the screenshot (16 px per side), so "Fit" is 100 % when it fits
    const k = Math.min(1, (a.width * 0.85 - PADV) / iw, (a.height * 0.85 - BAR - PADV) / ih);
    let width = Math.max(520, Math.round(iw * k) + PADV);
    let height = Math.max(360, Math.round(ih * k) + BAR + PADV);
    if (opts.annotate) {   // the toolbar needs room
      width = Math.max(width, Math.min(ANNOT_W, a.width - 40));
      height = Math.max(height, Math.min(ANNOT_H, a.height - 40));
    }
    shotView = new BrowserWindow({
      x: Math.round(a.x + (a.width - width) / 2),
      y: Math.round(a.y + (a.height - height) / 2),
      width,
      height,
      minWidth: 420,
      minHeight: 300,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#1B1A22',
      title: 'Picture – Desktop Buddy',
      icon: ICON,
      webPreferences: securePrefs('shotview.js'),
    });
    shotView.removeMenu();
    lockDown(shotView);
    shotView.loadFile(path.join(RENDERER, 'shot', 'view.html'));
    shotView.once('ready-to-show', () => { shotView.show(); shotView.focus(); });
    shotView.on('closed', () => { shotView = null; shotViewName = null; });
    return shotView;
  }

  /** A screenshot was moved to the Recycle Bin: the card / view showing it close. */
  function shotRemoved(name) {
    if (shotCardName === name) closeShotCard();
    if (shotViewName === name && shotView && !shotView.isDestroyed()) shotView.close();
  }

  /** The panel and the buddy don't appear in the screenshot: hidden for a moment. @returns the function that brings them back */
  function hideOwnForShot() {
    closeShotCard();   // nor the card of the previous screenshot
    const panelWasVisible = !!panel && panel.isVisible();
    if (panelWasVisible) panel.hide();
    const op = buddy && !buddy.isDestroyed() ? buddy.getOpacity() : null;
    if (op !== null) buddy.setOpacity(0);
    return () => { if (op !== null && buddy && !buddy.isDestroyed()) buddy.setOpacity(op); };
  }

  // M7: a monitor unplugged / scaling changed while running: bring buddy and timer back on screen
  let displayTimer = null;
  function reclamp() {
    clearTimeout(displayTimer);
    displayTimer = setTimeout(() => {
      for (const [win, save] of [[buddy, saveBuddyPos], [timer, saveTimerPos]]) {
        if (!win || win.isDestroyed()) continue;
        const b = win.getBounds();
        if (isOnScreen(b, b.width, b.height)) continue;
        const nb = clampToWorkArea(b);
        win.setBounds(nb);
        save({ x: nb.x, y: nb.y });
      }
      if (panel && !panel.isDestroyed() && panel.isVisible()) positionPanel();
    }, 500);
  }
  screen.on('display-removed', reclamp);
  screen.on('display-metrics-changed', reclamp);

  return {
    showQuickNote,
    hideQuickNote,
    get quick() { return quick; },
    showShotOverlay,
    closeShotOverlay,
    get shotOverlay() { return shotOverlay; },
    showShotPicker,
    closeShotPicker,
    get shotPicker() { return shotPicker; },
    grabFrame,
    hideOwnForShot,
    showShotCard,
    closeShotCard,
    get shotCard() { return shotCard; },
    get shotCardName() { return shotCardName; },
    showShotView,
    get shotView() { return shotView; },
    get shotViewName() { return shotViewName; },
    growShotView() { if (shotView && !shotView.isDestroyed()) growForAnnotate(shotView); },
    /** The options of the last open, read only once by the page. */
    takeShotViewOpts() { const o = shotViewOpts; shotViewOpts = {}; return o; },
    shotRemoved,
    showViewer,
    get viewer() { return viewer; },
    get viewerItemId() { return viewerItemId; },
    showEditor,
    get editor() { return editor; },
    get editorItemId() { return editorItemId; },
    createRecorder,
    destroyRecorder,
    get recorder() { return recorder; },
    showStats,
    get stats() { return stats; },
    showGallery,
    get gallery() { return gallery; },
    createTimer,
    updateTimerVisibility,
    timerDragStart,
    timerDragMove,
    timerDragEnd,
    resetTimerPosition,
    get timer() { return timer; },
    createBuddy,
    createPanel,
    showPanel,
    hidePanel,
    togglePanel,
    setTourActive,
    dragStart,
    dragMove,
    dragEnd,
    applySettings,
    resetBuddyPosition,
    get buddy() { return buddy; },
    get panel() { return panel; },
  };
}

module.exports = { createWindows, DRAG_THRESHOLD };
