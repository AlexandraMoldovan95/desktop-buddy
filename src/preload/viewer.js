'use strict';
// The API of the window that plays a clip in a loop (Portfolio).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('viewer', {
  // simple / full mode (UX pass): the page hides advanced controls in simple mode
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  info: () => ipcRenderer.invoke('viewer:info'),
  showFile: () => ipcRenderer.invoke('viewer:show-file'),
  onLoad: (fn) => ipcRenderer.on('viewer:load', (_e, p) => fn(p)),
});
