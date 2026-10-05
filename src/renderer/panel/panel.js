'use strict';
// The panel: tabs, Esc, opening on a given tab, syncing settings between tabs.
(function () {
  const { hydrateIcons } = window.UI;
  const TABS = {
    clipboard: window.ClipboardTab,
    notes: window.NotesTab,
    pictures: window.PicturesTab,
    video: window.VideoTab,
    session: window.SessionTab,
    settings: window.SettingsTab,
  };
  const tabButtons = [...document.querySelectorAll('[role="tab"]')];
  let active = null;

  const tabHistory = [];   // tabs visited in this panel session, for the mouse Back button
  function select(name, { focusTab = false, remember = true, fromBack = false } = {}) {
    if (!TABS[name]) name = 'clipboard';
    if (!fromBack && active && active !== name) { tabHistory.push(active); if (tabHistory.length > 10) tabHistory.shift(); }
    if (active && active !== name && TABS[active].onHide) TABS[active].onHide();
    active = name;
    for (const btn of tabButtons) {
      const on = btn.dataset.tab === name;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      document.getElementById(btn.getAttribute('aria-controls')).hidden = !on;
      if (on && focusTab) btn.focus();
    }
    TABS[name].onShow({ keepFocus: focusTab });   // F-M1: arrow keys keep the focus on the tab
    if (remember) window.api.settings.set({ lastTab: name });
  }

  tabButtons.forEach((btn, i) => {
    btn.addEventListener('click', () => select(btn.dataset.tab));
    btn.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      select(tabButtons[(i + d + tabButtons.length) % tabButtons.length].dataset.tab, { focusTab: true });
    });
  });

  document.getElementById('closeBtn').addEventListener('click', () => window.api.hide());

  // ------------------------------------------------ simple / full mode: CSS hides .adv when body has .simple
  let uiMode = 'simple';
  function applyMode(mode) {
    uiMode = mode === 'full' ? 'full' : 'simple';
    document.body.classList.toggle('simple', uiMode === 'simple');
  }
  window.api.onUiMode(applyMode);

  // ------------------------------------------------ the first-run tour (tour.js draws it; here: switching tabs for it)
  let buddySide = null;
  function startTour() {
    window.Tour.start({
      mode: () => uiMode,
      buddySide,
      show: async (step) => {
        if (!step.tab) return;
        if (step.tab === 'notes' && TABS.notes.isEditing()) TABS.notes.closeEditor();
        if (step.tab === 'settings') TABS.settings.showMenu();
        if (active !== step.tab) select(step.tab, { remember: false });
      },
      onEnd: () => { if (active !== 'clipboard') select('clipboard'); },
    });
  }
  window.Panel = { startTour };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || TABS.settings.isRecording() || window.Tour.isOpen()) return;
    if (TABS[active] && TABS[active].onEscape && TABS[active].onEscape()) return;
    window.api.hide();
  });
  // Mouse Back button: one step back (note → list, settings page → menu, then the previous tab). Unlike Esc it
  // never closes the panel. Mice send Back in different ways: a mouse button 3 (DOM), a "BrowserBack" key (many
  // mouse drivers), or a Windows app command (main → 'panel:back'). Repeats within 300 ms count once.
  let lastBackAt = 0;
  function goBack() {
    const t = Date.now();
    if (t - lastBackAt < 300) return;
    lastBackAt = t;
    if (window.Tour.isOpen() || TABS.settings.isRecording()) return;
    if (active === 'notes' && TABS.notes.isEditing && TABS.notes.isEditing()) { TABS.notes.closeEditor(); return; }
    if (TABS[active] && TABS[active].onEscape && TABS[active].onEscape()) return;
    while (tabHistory.length) {
      const prev = tabHistory.pop();
      if (prev !== active && TABS[prev]) { select(prev, { fromBack: true }); return; }
    }
  }
  const isBackButton = (e) => e.button === 3;
  window.addEventListener('mouseup', (e) => { if (isBackButton(e)) { e.preventDefault(); goBack(); } }, true);
  window.addEventListener('auxclick', (e) => { if (isBackButton(e)) { e.preventDefault(); goBack(); } }, true);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'BrowserBack' || (e.altKey && e.key === 'ArrowLeft')) { e.preventDefault(); goBack(); }
  }, true);
  window.api.onBack(goBack);
  // when the window hides, the open note is saved right away
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    TABS.notes.onHide();
    if (active && active !== 'notes' && TABS[active].onHide) TABS[active].onHide();   // r2 L1: a hidden tab stops refreshing; onOpened shows it again
    window.Tour.stopQuietly();   // hidden mid-tour (shortcut, tray): it counts as seen
  });

  window.api.onOpened(async ({ tab, note, cat, tour, buddySide: side }) => {
    if (side) buddySide = side;
    await ready;   // a panel created just now may still be loading its tabs
    if (tab) select(tab); else if (active) TABS[active].onShow();
    if (note && tab === 'notes') TABS.notes.openId(note);   // from a reminder notification
    if (cat && tab === 'settings') TABS.settings.openCategory(cat);   // e.g. "Change how the buddy looks"
    if (tour) startTour();
  });
  /** The panel header takes the buddy's colors (and the ones you picked in Customize). */
  function applyBuddyColors(s) {
    const { a, b } = window.BuddyLook.colorsOf(window.BuddyLook.normalizeLook(s.buddyLook));
    document.documentElement.style.setProperty('--buddy-a', a);
    document.documentElement.style.setProperty('--buddy-b', b);
  }

  window.api.settings.onChanged((settings) => {
    applyBuddyColors(settings);
    Object.values(TABS).forEach((t) => t.onSettings && t.onSettings(settings));
  });

  async function init() {
    hydrateIcons();
    try { applyMode(await window.api.uiMode()); } catch (e) { console.warn('[panel] ui mode', e); }
    const info = await window.api.settings.get();
    const s = info.settings;
    applyBuddyColors(s);
    // r2 M3: the tabs load side by side; Pictures loads on its first show (it scans the pictures folder)
    const inits = { clipboard: TABS.clipboard.init(s), notes: TABS.notes.init(), session: TABS.session.init(s), video: TABS.video.init(s) };
    const res = await Promise.allSettled(Object.values(inits));
    Object.keys(inits).forEach((k, i) => { if (res[i].status === 'rejected') console.error(`[panel] ${k} init failed`, res[i].reason); });
    TABS.settings.init(s, info);
    select(s.lastTab, { remember: false });
  }
  const ready = init().catch((err) => console.error('[panel] init failed', err));
})();
