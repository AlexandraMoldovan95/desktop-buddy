'use strict';
// The API for the Statistics window: read only.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (fn) => {
  const h = (_e, p) => fn(p);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

contextBridge.exposeInMainWorld('stats', {
  // simple / full mode (UX pass): the page hides advanced controls in simple mode
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  workdays: () => ipcRenderer.invoke('stats:workdays'),
  day: (day) => ipcRenderer.invoke('stats:day', day),
  lastDays: () => ipcRenderer.invoke('stats:last-days'),
  onSessionChanged: listen('session:changed'),
  onSessionStopped: listen('session:stopped'),
});
