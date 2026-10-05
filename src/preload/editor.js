'use strict';
// The API of the clip-cutting window (Portfolio).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('editor', {
  // simple / full mode (UX pass): the page hides advanced controls in simple mode
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  info: () => ipcRenderer.invoke('editor:info'),
  clips: () => ipcRenderer.invoke('editor:clips'),
  exportBegin: (spec, id) => ipcRenderer.invoke('editor:export-begin', spec, id),
  montageGet: () => ipcRenderer.invoke('editor:montage-get'),
  montageSet: (m, id) => ipcRenderer.invoke('editor:montage-set', m, id),
  exportChunk: (jobId, bytes) => ipcRenderer.send('editor:export-chunk', jobId, bytes),
  exportEnd: (jobId, ok) => ipcRenderer.invoke('editor:export-end', jobId, ok),
  open: (id) => ipcRenderer.invoke('editor:open-file', id),
  playLoop: (id, size) => ipcRenderer.invoke('editor:play-loop', id, size),
  show: (id) => ipcRenderer.invoke('editor:show-file', id),
  webEmbed: (id, size) => ipcRenderer.invoke('editor:web-embed', id, size),
  onLoad: (fn) => ipcRenderer.on('editor:load', (_e, p) => fn(p)),
});
