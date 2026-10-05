'use strict';
// The hidden capture window: sends the main process only events and video chunks.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rec', {
  started: (info) => ipcRenderer.send('rec:started', info),
  chunk: (bytes) => ipcRenderer.send('rec:chunk', bytes),
  status: (info) => ipcRenderer.send('rec:status', info),
  done: (info) => ipcRenderer.send('rec:done', info),
  sourceEnded: () => ipcRenderer.send('rec:source-ended'),
  attached: () => ipcRenderer.send('rec:attached'),
  error: (message) => ipcRenderer.send('rec:error', String(message).slice(0, 500)),
});
