'use strict';
// The API of the screenshot windows (1.8.0): the area selection and the list of windows.
// The hidden window that grabs the frame (grab.html) doesn't use IPC: the main process asks it for the result directly.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shot', {
  // simple / full mode (UX pass): the page hides advanced controls in simple mode
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  overlayInfo: () => ipcRenderer.invoke('shot:overlay-info'),
  overlayDone: (corners) => ipcRenderer.send('shot:overlay-done', corners),
  toWindow: () => ipcRenderer.send('shot:to-window'),
  listWindows: () => ipcRenderer.invoke('shot:windows'),
  choose: (id) => ipcRenderer.send('shot:choose', id),
  onRefresh: (fn) => ipcRenderer.on('shot:refresh', () => fn()),
});
