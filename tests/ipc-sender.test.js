'use strict';
// L7: IPC is accepted only from the top frame of our own pages (src/renderer/*.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { isOurPage, isTrustedFrame, RENDERER } = require('../src/main/ipc-sender');

const W = path.win32;
const WIN_DIR = 'C:\\Users\\ana\\AppData\\Local\\Programs\\Desktop Buddy Portfolio\\resources\\app.asar\\src\\renderer';

test('our pages are accepted (Windows install path with spaces, any drive-letter case)', () => {
  const base = 'file:///C:/Users/ana/AppData/Local/Programs/Desktop%20Buddy%20Portfolio/resources/app.asar/src/renderer';
  assert.equal(isOurPage(`${base}/panel/index.html`, WIN_DIR, W), true);
  assert.equal(isOurPage(`${base.toLowerCase()}/shot/gallery.html?x=1#y`, WIN_DIR, W), true);
  assert.equal(isOurPage(pathToFileURL(path.join(RENDERER, 'panel', 'index.html')).href), true);
});

test('other local files, remote pages and odd URLs are refused', () => {
  const base = 'file:///C:/Users/ana/AppData/Local/Programs/Desktop%20Buddy%20Portfolio/resources/app.asar/src';
  for (const url of [
    `${base}/renderer/../main/x.html`, `${base}/main/main.js`, `${base}/renderer/panel/panel.js`,
    'file:///C:/Users/ana/Downloads/evil.html', 'file:///C:/Users/ana/AppData/Roaming/Desktop%20Buddy%20Portfolio/x.html',
    'https://example.com/panel/index.html', 'about:blank', 'data:text/html,x', '', null,
    `${base}/renderer-evil/panel/index.html`,
  ]) assert.equal(isOurPage(url, WIN_DIR, W), false, String(url));
  assert.equal(isOurPage('file:///tmp/evil.html'), false);
});

test('only the top frame is trusted', () => {
  const url = pathToFileURL(path.join(RENDERER, 'panel', 'index.html')).href;
  assert.equal(isTrustedFrame({ url, parent: null }), true);
  assert.equal(isTrustedFrame({ url, parent: { url } }), false, 'an iframe of our page');
  assert.equal(isTrustedFrame(null), false, 'destroyed frame');
  assert.equal(isTrustedFrame({ url: 'file:///etc/x.html', parent: null }), false);
});
