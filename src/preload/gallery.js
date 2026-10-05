'use strict';
// The API of the "Screenshots" gallery (1.12.0): the list (one entry per screenshot), opening, deleting to the Recycle Bin,
// images added from the PC (the page converts them to PNG; main checks again) and dragging a screenshot into another app.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gallery', {
  // simple / full mode (UX pass): the page hides advanced controls in simple mode
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  list: () => ipcRenderer.invoke('gallery:list'),
  open: (name, opts) => ipcRenderer.invoke('shot:view', name, opts || {}),
  show: (name) => ipcRenderer.invoke('shot:show', name),
  copy: (name) => ipcRenderer.invoke('shot:copy', name),
  trash: (names, mode) => ipcRenderer.invoke('gallery:trash', names, mode || 'all'),
  importPng: (name, png) => ipcRenderer.invoke('gallery:import', name, png),
  openFolder: () => ipcRenderer.invoke('shot:open-folder'),
  startDrag: (name) => ipcRenderer.send('gallery:start-drag', name),
  onChanged: (fn) => ipcRenderer.on('shots:changed', () => fn()),
});
