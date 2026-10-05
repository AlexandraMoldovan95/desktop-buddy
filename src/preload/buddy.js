'use strict';
// The minimal API for the buddy page. The page has no access to Node or Electron.
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('buddy', {
  dragStart: () => ipcRenderer.send('buddy:drag-start'),
  dragMove: () => ipcRenderer.send('buddy:drag-move'),
  dragEnd: () => ipcRenderer.send('buddy:drag-end'),
  contextMenu: () => ipcRenderer.send('buddy:context-menu'),
  mark: () => ipcRenderer.send('buddy:mark'),   // the flag shown while recording
  ready: () => ipcRenderer.send('buddy:ready'),
  woke: () => ipcRenderer.send('buddy:woke'),
  onReact: listen('buddy:react'),
  onLook: listen('buddy:look'),
  onConfig: listen('buddy:config'),
  // Portfolio: the buddy shows a red dot while a window is being recorded
  onRecorder: listen('recorder:changed'),
});
