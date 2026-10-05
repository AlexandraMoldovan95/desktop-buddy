'use strict';
// Stands in for Electron inside the web demo. The page's real preload script runs right after this one
// (generated as preload-<page>.js by scripts/build-site.js) and calls require('electron'): it gets these
// objects, which forward to the demo host in the parent page instead of the main process.
(function () {
  const page = document.currentScript.dataset.page;
  let host = null;
  try { host = window.parent !== window && window.parent.DemoHost; } catch { host = null; }
  if (!host) {
    document.addEventListener('DOMContentLoaded', () => {
      document.body.textContent = 'This page is part of the Desktop Buddy web demo. Open the demo page instead.';
    });
    host = { invoke: () => new Promise(() => {}), send() {}, subscribe: () => () => {}, pointer() {}, registerPage() {}, unregisterPage() {} };
  }
  // results come back as plain data made in THIS page (like Electron's IPC copies them)
  const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const offs = new Map();
  const ipcRenderer = {
    invoke: (channel, ...args) => host.invoke(page, channel, clone(args)).then(clone, (e) => { throw new Error(e && e.message ? e.message : String(e)); }),
    send: (channel, ...args) => host.send(page, channel, clone(args)),
    on(channel, handler) {
      offs.set(handler, host.subscribe(page, channel, (payload) => handler({}, clone(payload))));
      return ipcRenderer;
    },
    removeListener(channel, handler) {
      const off = offs.get(handler);
      if (off) { off(); offs.delete(handler); }
      return ipcRenderer;
    },
  };
  const contextBridge = { exposeInMainWorld: (name, api) => { window[name] = api; } };
  window.__demoElectron = { require: (name) => (name === 'electron' ? { contextBridge, ipcRenderer } : null) };

  window.addEventListener('pagehide', () => { for (const off of offs.values()) off(); offs.clear(); host.unregisterPage(page, document); });
  // the pointer (the buddy's eyes and dragging), from inside this page
  for (const type of ['pointermove', 'pointerdown']) {
    window.addEventListener(type, (e) => host.pointer(page, type, e.screenX, e.screenY, e.clientX, e.clientY), true);
  }
  host.registerPage(page, document);
})();
