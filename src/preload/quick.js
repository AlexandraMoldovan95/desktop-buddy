'use strict';
// The quick note API (1.8.0): saves the text as a new note or closes the window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('quick', {
  save: (text) => ipcRenderer.invoke('quick:save', text),
  close: () => ipcRenderer.send('quick:close'),
  onShown: (fn) => ipcRenderer.on('quick:shown', () => fn()),
});
