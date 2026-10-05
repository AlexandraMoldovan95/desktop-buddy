'use strict';
// The API of the card after a capture and of the window that shows a large screenshot (1.10.0) + annotations (1.11.0).
// The page gets only the file name and the buddy-media://shot/<name> address; real paths stay in the main process.
// Annotations: main checks the name (only PNGs from the Screenshots folder) and normalizes the document.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shotView', {
  // simple / full mode (UX pass): the page hides advanced controls in simple mode
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  cardInfo: () => ipcRenderer.invoke('shotcard:info'),
  viewInfo: () => ipcRenderer.invoke('shotview:info'),
  copy: (name) => ipcRenderer.invoke('shot:copy', name),
  open: (name, opts) => ipcRenderer.invoke('shot:view', name, opts || {}),
  show: (name) => ipcRenderer.invoke('shot:show', name),
  trash: (name, opts) => ipcRenderer.invoke('shot:trash', name, opts || {}),
  closeCard: () => ipcRenderer.send('shotcard:close'),
  closeView: () => ipcRenderer.send('shotview:close'),
  onLoad: (fn) => ipcRenderer.on('shotview:load', () => fn()),
  annot: {
    open: () => ipcRenderer.invoke('annot:open'),
    save: (source, doc) => ipcRenderer.invoke('annot:save', source, doc),
    exportPng: (source, png, doc) => ipcRenderer.invoke('annot:export', source, png, doc),
    copyPng: (png) => ipcRenderer.invoke('annot:copy', png),
  },
});
