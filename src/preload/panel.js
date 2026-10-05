'use strict';
// The API for the panel. Each function maps to an IPC channel validated in main/ipc.js.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('api', {
  hide: () => ipcRenderer.send('panel:hide'),
  onOpened: listen('panel:opened'),
  onBack: listen('panel:back'),
  // simple / full mode (contract with main: 'ui:mode' + 'ui:mode-changed')
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  // the first-run tour: while it is open, a click outside doesn't hide the panel
  tour: {
    active: (on) => ipcRenderer.send('panel:tour', on === true),
  },

  clipboard: {
    list: () => ipcRenderer.invoke('clipboard:list'),
    copy: (id) => ipcRenderer.invoke('clipboard:copy', id),
    pin: (id, pinned) => ipcRenderer.invoke('clipboard:pin', id, pinned),
    remove: (id) => ipcRenderer.invoke('clipboard:delete', id),
    clear: (keepPinned) => ipcRenderer.invoke('clipboard:clear', keepPinned),
    addCurrent: () => ipcRenderer.invoke('clipboard:add-current'),
    onChanged: listen('clipboard:changed'),
  },

  notes: {
    list: () => ipcRenderer.invoke('notes:list'),
    create: () => ipcRenderer.invoke('notes:create'),
    save: (id, body) => ipcRenderer.invoke('notes:save', id, body),
    remove: (id) => ipcRenderer.invoke('notes:delete', id),
    setReminder: (id, at) => ipcRenderer.invoke('notes:set-reminder', id, at),
    onChanged: listen('notes:changed'),   // a reminder rang / was missed
  },

  // a buddy that grows: level, XP, streak (computed from sessions, read only)
  progress: {
    get: () => ipcRenderer.invoke('progress:get'),
    onChanged: listen('progress:changed'),
    onLevelUp: listen('progress:level-up'),
  },

  // text tools (no AI, no network)
  // quick capture (1.8.0): the quick note and screenshots start only from buttons
  capture: {
    quickNote: () => ipcRenderer.invoke('quick:open'),
    zone: () => ipcRenderer.invoke('shot:zone'),
    window: () => ipcRenderer.invoke('shot:window'),
    recent: () => ipcRenderer.invoke('shot:recent'),
    show: (name) => ipcRenderer.invoke('shot:show', name),
    view: (name) => ipcRenderer.invoke('shot:view', name),       // 1.10.0: the window with the large screenshot
    copy: (name) => ipcRenderer.invoke('shot:copy', name),
    trash: (name) => ipcRenderer.invoke('shot:trash', name),
    openFolder: () => ipcRenderer.invoke('shot:open-folder'),
    gallery: () => ipcRenderer.invoke('shot:gallery'),            // 1.12.0: the window with all screenshots
    onChanged: listen('shots:changed'),
  },
  text: {
    onCommand: listen('text:command'),   // from the right-click menu: { type: 'transform', kind } / { type: 'clean' }
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    openDataFolder: () => ipcRenderer.invoke('settings:open-data-folder'),
    openLogFolder: () => ipcRenderer.invoke('settings:open-log-folder'),
    resetBuddy: () => ipcRenderer.invoke('settings:reset-buddy'),
    buddyDemo: (type) => ipcRenderer.invoke('buddy:demo', type),
    onChanged: listen('settings:changed'),
  },

  session: {
    get: () => ipcRenderer.invoke('session:get'),
    today: () => ipcRenderer.invoke('session:today'),
    start: (title) => ipcRenderer.invoke('session:start', title),
    pause: () => ipcRenderer.invoke('session:pause'),
    resume: () => ipcRenderer.invoke('session:resume'),
    stop: () => ipcRenderer.invoke('session:stop'),
    rename: (title) => ipcRenderer.invoke('session:rename', title),
    showTimer: () => ipcRenderer.invoke('settings:set', { timerVisible: true }),
    resetTimer: () => ipcRenderer.invoke('timer:reset-position'),
    testNotification: () => ipcRenderer.invoke('notify:test'),
    activityStatus: () => ipcRenderer.invoke('activity:status'),
    openPermissions: () => ipcRenderer.invoke('activity:open-permissions'),
    openStats: () => ipcRenderer.invoke('stats:open'),
    onActivityStatus: listen('activity:status'),
    onChanged: listen('session:changed'),
    onStopped: listen('session:stopped'),
  },

  recorder: {
    state: () => ipcRenderer.invoke('recorder:state'),
    windows: () => ipcRenderer.invoke('recorder:windows'),
    start: (sourceId) => ipcRenderer.invoke('recorder:start', sourceId),
    stop: () => ipcRenderer.invoke('recorder:stop'),
    mark: () => ipcRenderer.invoke('recorder:mark'),
    edit: (id) => ipcRenderer.invoke('editor:open', id),
    list: () => ipcRenderer.invoke('recorder:list'),
    open: (id) => ipcRenderer.invoke('recorder:open', id),
    show: (id) => ipcRenderer.invoke('recorder:show', id),
    trash: (id) => ipcRenderer.invoke('recorder:trash', id),
    folder: () => ipcRenderer.invoke('recorder:folder'),
    openFolder: () => ipcRenderer.invoke('recorder:open-folder'),
    chooseFolder: () => ipcRenderer.invoke('recorder:choose-folder'),
    resetFolder: () => ipcRenderer.invoke('recorder:reset-folder'),
    onChanged: listen('recorder:changed'),
  },

  email: {
    status: () => ipcRenderer.invoke('email:status'),
    setPassword: (password) => ipcRenderer.invoke('email:set-password', password),
    clearPassword: () => ipcRenderer.invoke('email:clear-password'),
    test: () => ipcRenderer.invoke('email:test'),
    preview: (kind) => ipcRenderer.invoke('email:preview', kind),
    sendRange: () => ipcRenderer.invoke('email:send-range'),
    sendNote: (id, opts) => ipcRenderer.invoke('email:send-note', id, opts),
    onReportResult: listen('email:report-result'),
  },
});
