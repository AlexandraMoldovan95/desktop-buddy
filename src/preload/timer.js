'use strict';
// The API for the timer window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('timer', {
  // simple / full mode (UX pass): the page hides advanced controls in simple mode
  uiMode: () => ipcRenderer.invoke('ui:mode'),
  onUiMode: (cb) => ipcRenderer.on('ui:mode-changed', (_e, m) => cb(m)),
  getState: () => ipcRenderer.invoke('session:get'),
  pause: () => ipcRenderer.invoke('session:pause'),
  resume: () => ipcRenderer.invoke('session:resume'),
  stop: () => ipcRenderer.invoke('session:stop'),
  rename: (title) => ipcRenderer.invoke('session:rename', title),
  hide: () => ipcRenderer.invoke('settings:set', { timerVisible: false }),
  setOpacity: (value) => ipcRenderer.invoke('settings:set', { timerOpacity: value }),
  getSettings: () => ipcRenderer.invoke('timer:settings'),
  dragStart: () => ipcRenderer.send('timer:drag-start'),
  dragMove: () => ipcRenderer.send('timer:drag-move'),
  dragEnd: () => ipcRenderer.invoke('timer:drag-end'),
  onChanged: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('session:changed', h);
    return () => ipcRenderer.removeListener('session:changed', h);
  },
  onSettings: (fn) => {
    const h = (_e, p) => fn(p);
    ipcRenderer.on('settings:changed', h);
    return () => ipcRenderer.removeListener('settings:changed', h);
  },
});
