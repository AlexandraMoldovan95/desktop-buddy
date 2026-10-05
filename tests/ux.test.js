'use strict';
// UX pass: simple mode settings + migration, the ui:mode IPC contract, the buddy menu, window titles, the tour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const { pathToFileURL } = require('url');

const schema = require('../src/shared/settings-schema');
const { JsonStore } = require('../src/main/store');
const { buddyMenuTemplate, windowTitle } = require('../src/main/buddy-menu');
const T = require('../src/shared/tour-steps');

// ------------------------------------------------------------ settings: new keys and migration
test('settings: a new install starts in simple mode, with the tour, recording rules off', () => {
  const s = schema.withDefaults({});
  assert.equal(s.uiMode, 'simple');
  assert.equal(s.tourDone, false);
  assert.equal(s.recAuto, false);
  assert.equal(schema.needsMigration({}), false);
});

test('settings: an existing file without uiMode becomes full mode, tour done, recAuto kept', () => {
  const old = { version: 1, theme: 'dark', buddySize: 80 };
  const s = schema.withDefaults(old);
  assert.equal(s.uiMode, 'full');
  assert.equal(s.tourDone, true);
  assert.equal(s.recAuto, true, 'old default for auto start');
  assert.equal(s.theme, 'dark');
  assert.equal(schema.withDefaults({ ...old, recAuto: false }).recAuto, false, 'a saved choice wins');
  assert.equal(schema.needsMigration(old), true);
});

test('settings: a file that already has uiMode keeps it (and is not migrated again)', () => {
  const saved = { version: 1, uiMode: 'simple', tourDone: true, recAuto: false };
  const s = schema.withDefaults(saved);
  assert.deepEqual([s.uiMode, s.tourDone, s.recAuto], ['simple', true, false]);
  assert.equal(schema.needsMigration(saved), false);
  assert.equal(schema.withDefaults({ version: 1, uiMode: 'full', tourDone: false }).tourDone, false);
});

test('settings: the old AI settings and the encrypted API key are dropped; odd old values never throw', () => {
  const saved = { version: 1, uiMode: 'full', aiProvider: 'openai', aiModel: 'gpt-x', apiKeyEnc: 'ENC==', apiKeyHint: '…abcd', lastTab: 'assistant' };
  assert.equal(schema.needsMigration(saved), true);
  const s = schema.withDefaults(saved);
  for (const k of ['aiProvider', 'aiModel', 'apiKeyEnc', 'apiKeyHint']) assert.equal(k in s, false, k);
  assert.equal(s.lastTab, 'clipboard', 'the removed tab falls back to the first one');
  assert.doesNotThrow(() => schema.withDefaults({ aiProvider: { toString: 1 }, apiKeyEnc: 42, weird: [1, 2], uiMode: 7, tourDone: 'yes' }));
  const odd = schema.withDefaults({ uiMode: 7, tourDone: 'yes', theme: 'light' });
  assert.equal(odd.uiMode, 'full', 'invalid uiMode in an old file = existing user');
  assert.equal(odd.tourDone, true);
});

test('settings: uiMode / tourDone / pictures tab pass validation, wrong values do not', () => {
  assert.deepEqual(schema.sanitizePatch({ uiMode: 'full', tourDone: true, lastTab: 'pictures' }), { uiMode: 'full', tourDone: true, lastTab: 'pictures' });
  assert.deepEqual(schema.sanitizePatch({ uiMode: 'expert', tourDone: 1, lastTab: 'assistant', aiModel: 'x', apiKeyEnc: 'x' }), {});
  assert.deepEqual(schema.TABS, ['clipboard', 'notes', 'pictures', 'video', 'session', 'settings']);
});

test('settings: an old settings.json with an API key loses the key on the first save', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-ux-'));
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, theme: 'light', apiKeyEnc: 'SECRET-ENC', apiKeyHint: '…wxyz', aiModel: 'm' }));
  let migrated = false;
  const store = new JsonStore(file, () => ({}), { normalize: (d) => { if (schema.needsMigration(d)) migrated = true; return schema.withDefaults(d); } });
  assert.equal(migrated, true, 'main.js schedules a save when this is true');
  store.flush();
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('SECRET-ENC'), false);
  assert.equal(raw.includes('apiKey'), false);
  const back = JSON.parse(raw);
  assert.equal(back.uiMode, 'full');
  assert.equal(back.tourDone, true);
  assert.equal(back.theme, 'light');
});

test('settings: the public view never carries old AI keys', () => {
  const v = schema.publicView({ ...schema.DEFAULTS, apiKeyEnc: 'X', aiModel: 'y' });
  for (const k of ['apiKeyEnc', 'apiKeyHint', 'apiKey', 'aiModel', 'aiProvider', 'emailPassEnc', 'recFolder']) assert.equal(k in v, false, k);
  assert.equal(v.uiMode, 'simple');
});

// ------------------------------------------------------------ the ui:mode IPC contract (main side)
/** Loads ipc.js with a fake electron and returns the registered handlers. */
function loadIpc(settings) {
  const handlers = {};
  const listeners = {};
  const ourWin = { id: 1 };
  const fake = {
    ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; }, on: (ch, fn) => { listeners[ch] = fn; } },
    BrowserWindow: { fromWebContents: (wc) => (wc === 'ours' ? ourWin : null), getAllWindows: () => [] },
    Menu: { buildFromTemplate: (t) => ({ template: t, popup() {} }) },
    shell: {}, app: { quit() {}, getVersion: () => '0' }, clipboard: {}, ClipboardItem: function () {}, nativeImage: {},
  };
  const realLoad = Module._load;
  Module._load = function (req, ...rest) { return req === 'electron' ? fake : realLoad.call(this, req, ...rest); };
  let registerIpc;
  try {
    const p = require.resolve('../src/main/ipc');
    delete require.cache[p];
    ({ registerIpc } = require('../src/main/ipc'));
  } finally { Module._load = realLoad; }
  const calls = [];
  const windows = { buddy: ourWin, panel: null, setTourActive: (on) => calls.push(['tour', on]), showPanel: (...a) => calls.push(['showPanel', ...a]), showStats: () => calls.push(['stats']) };
  registerIpc({
    windows, settingsStore: { data: settings }, capture: { menuItems: () => [{ label: 'Quick note' }] },
    updateSettings: (p) => calls.push(['update', p]),
  });
  const page = pathToFileURL(path.join(__dirname, '../src/renderer/panel/index.html')).href;
  const ev = (sender = 'ours', url = page) => ({ sender, senderFrame: { parent: null, url } });
  return { handlers, listeners, calls, ev };
}

test('ipc ui:mode: returns simple or full to our windows, refuses strangers', async () => {
  const s = { uiMode: 'full' };
  const { handlers, ev } = loadIpc(s);
  assert.equal(await handlers['ui:mode'](ev()), 'full');
  s.uiMode = 'simple';
  assert.equal(await handlers['ui:mode'](ev()), 'simple');
  s.uiMode = undefined;
  assert.equal(await handlers['ui:mode'](ev()), 'simple', 'anything else reads as simple');
  await assert.rejects(handlers['ui:mode'](ev('other')), /refused/i);
  await assert.rejects(handlers['ui:mode'](ev('ours', 'https://example.com/')), /refused/i);
});

test('ipc: the AI channels are gone; panel:tour only accepts a real true', () => {
  const { handlers, listeners, calls, ev } = loadIpc({ uiMode: 'simple' });
  for (const ch of ['ai:send', 'secrets:set-api-key', 'secrets:clear-api-key']) assert.equal(ch in handlers, false, ch);
  listeners['panel:tour'](ev(), true);
  listeners['panel:tour'](ev(), 'yes');
  listeners['panel:tour'](ev('other'), true);
  assert.deepEqual(calls.filter((c) => c[0] === 'tour'), [['tour', true], ['tour', false]]);
});

test('main broadcasts ui:mode-changed to every window when uiMode changes', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(src, /if \('uiMode' in changed\) broadcast\('ui:mode-changed'/);
  assert.match(src, /BrowserWindow\.getAllWindows\(\)/, 'broadcast reaches every window');
});

// ------------------------------------------------------------ the buddy's menu (F15) and window titles (F19)
test('buddy menu: simple mode is short; full mode adds Statistics and Settings; look + tour always there', () => {
  const a = Object.fromEntries(['openPanel', 'openLook', 'showTour', 'openStats', 'openSettings', 'hideBuddy', 'quit'].map((k) => [k, () => k]));
  const labels = (mode) => buddyMenuTemplate({ mode, a, captureItems: [{ label: 'Quick note' }] }).filter((x) => x.label).map((x) => x.label);
  const simple = labels('simple');
  assert.deepEqual(simple, ['Open the window', 'Quick note', 'Change how the buddy looks', 'Help: show the tour', 'Hide the buddy', 'Quit']);
  const full = labels('full');
  assert.ok(full.includes('Statistics') && full.includes('Settings'));
  assert.equal(simple.includes('Statistics'), false);
  const tpl = buddyMenuTemplate({ mode: 'simple', a, captureItems: [] });
  assert.equal(tpl.find((x) => x.label === 'Help: show the tour').click(), 'showTour');
  assert.equal(tpl.find((x) => x.label === 'Change how the buddy looks').click(), 'openLook');
});

test('window titles: one pattern, "<What> – Desktop Buddy"', () => {
  const cases = {
    'Desktop Buddy Portfolio': 'Desktop Buddy',
    'Desktop Buddy – timer': 'Timer – Desktop Buddy',
    'Statistics – Desktop Buddy': 'Statistics – Desktop Buddy',
    'Clips – Desktop Buddy Portfolio': 'Cut a clip – Desktop Buddy',
    'Clips – Note Organizer test': 'Cut a clip – Note Organizer test – Desktop Buddy',
    'Screenshots – Desktop Buddy Portfolio': 'Pictures – Desktop Buddy',
    'Screenshot – Desktop Buddy Portfolio': 'Picture – Desktop Buddy',
    'Screenshot of a window – Desktop Buddy Portfolio': 'Pick a window – Desktop Buddy',
    'Screenshot saved – Desktop Buddy': 'Picture ready – Desktop Buddy',
    'Clip – Desktop Buddy Portfolio': 'Video – Desktop Buddy',
    'shot 2026-10-02.png – Desktop Buddy Portfolio': 'shot 2026-10-02.png – Desktop Buddy',
    '': 'Desktop Buddy',
  };
  for (const [from, to] of Object.entries(cases)) assert.equal(windowTitle(from), to, from);
  assert.ok(windowTitle('x'.repeat(300)).length < 110);
  const win = fs.readFileSync(path.join(__dirname, '../src/main/windows.js'), 'utf8');
  for (const m of win.matchAll(/title: '([^']+)'/g)) assert.equal(windowTitle(m[1]), m[1], `windows.js title "${m[1]}" follows the pattern`);
  assert.match(win, /page-title-updated/);
});

// ------------------------------------------------------------ the tour's state
test('tour: 7 steps, next / back / close; closing midway also counts as done', () => {
  assert.equal(T.STEPS.length, 7);
  let st = T.start();
  assert.equal(T.counter(st), '1 of 7');
  assert.equal(T.isFirst(st), true);
  assert.deepEqual(T.back(st), { i: 0, open: true }, 'back on the first step stays');
  for (let i = 0; i < 6; i++) st = T.next(st);
  assert.equal(T.isLast(st), true);
  assert.equal(T.counter(st), '7 of 7');
  const fin = T.next(st);
  assert.deepEqual([fin.open, fin.done, fin.finished], [false, true, true]);
  const closed = T.close(T.next(T.start()));
  assert.deepEqual([closed.open, closed.done, closed.finished, closed.i], [false, true, false, 1]);
  assert.equal(T.next(closed), closed, 'a closed tour does not move');
});

test('tour: the steps point at the new tabs, and the last text changes with the mode', () => {
  assert.deepEqual(T.STEPS.map((s) => s.tab), [null, 'clipboard', 'notes', 'pictures', 'video', 'session', 'settings']);
  assert.equal(T.STEPS[0].target, 'buddy');
  const last = T.STEPS[6];
  assert.match(T.plainText(T.textOf(last, 'simple')), /More/);
  assert.match(T.plainText(T.textOf(last, 'full')), /Simple mode/);
  for (const s of T.STEPS) for (const p of s.text) assert.ok(typeof p === 'string' || typeof p.b === 'string', 'text parts are plain strings (textContent)');
  // every target exists in the panel's markup or is created by its tab script
  const panel = ['index.html', 'tabs/pictures.js', 'tabs/video.js', 'tabs/settings.js'].map((f) => fs.readFileSync(path.join(__dirname, '../src/renderer/panel', f), 'utf8')).join('\n');
  for (const s of T.STEPS) if (s.target && s.target.startsWith('#')) assert.ok(panel.includes(s.target.slice(1)), s.target);
});

test('tour: only for a fresh install; an existing user (update) never gets it again', () => {
  const S = require('../src/shared/settings-schema');
  assert.equal(S.withDefaults({}).tourDone, false, 'new install: the tour shows at the first start');
  assert.equal(S.withDefaults({ uiMode: 'full', tourDone: true }).tourDone, true, 'after it was seen: never again');
  assert.equal(S.withDefaults({ theme: 'dark' }).tourDone, true, 'an update from a version without the tour: no tour');
});
