'use strict';
// The buddy's right-click menu (F15). Simple mode keeps it short; full mode adds Statistics and Settings.
// Pure: gets the actions, returns an Electron menu template (unit-tested).

/**
 * @param {{ mode: 'simple'|'full', a: Record<string, () => void>, captureItems: object[] }} opts
 *   a = { openPanel, openLook, showTour, openStats, openSettings, hideBuddy, quit }
 */
function buddyMenuTemplate({ mode, a, captureItems = [] }) {
  const full = mode === 'full';
  return [
    { label: 'Open the window', click: a.openPanel },
    ...(full ? [
      { label: 'Statistics', click: a.openStats },
      { label: 'Settings', click: a.openSettings },
    ] : []),
    { type: 'separator' },
    ...captureItems,
    { type: 'separator' },
    { label: 'Change how the buddy looks', click: a.openLook },
    { label: 'Help: show the tour', click: a.showTour },
    { type: 'separator' },
    { label: 'Hide the buddy', click: a.hideBuddy },
    { label: 'Quit', click: a.quit },
  ];
}

/** "<What> – Desktop Buddy" for every window (F19). Page titles pass through here too. */
const WORDS = [
  [/^Screenshots\b/, 'Pictures'],
  [/^Screenshot of a window\b/, 'Pick a window'],
  [/^Screenshot saved\b/, 'Picture ready'],
  [/^Screenshot\b/, 'Picture'],
  [/^Clips\b/, 'Cut a clip'],
  [/^Clip\b/, 'Video'],
];
function windowTitle(pageTitle) {
  // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
  let t = String(pageTitle || '').replace(/[\x00-\x1f]/g, '').trim();
  // old patterns: "Desktop Buddy – timer", "X – Desktop Buddy Portfolio", "Desktop Buddy Portfolio"
  t = t.replace(/^Desktop Buddy(?: Portfolio)?\s*–\s*(.+)$/, (_m, what) => what.charAt(0).toUpperCase() + what.slice(1));
  t = t.replace(/\s*–\s*Desktop Buddy(?: Portfolio)?$/, '').replace(/^Desktop Buddy(?: Portfolio)?$/, '').trim();
  for (const [re, to] of WORDS) if (re.test(t)) { t = t.replace(re, to); break; }
  if (t.length > 80) t = t.slice(0, 79) + '…';
  return t ? `${t} – Desktop Buddy` : 'Desktop Buddy';
}

module.exports = { buddyMenuTemplate, windowTitle };
