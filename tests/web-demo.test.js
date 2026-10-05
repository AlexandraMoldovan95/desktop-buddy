'use strict';
// The web demo (scripts/build-site.js + web/): it must keep up with the app.
// If a preload gets a new channel and the demo host doesn't answer it, this fails.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const site = require('../scripts/build-site');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const host = read('web', 'app', 'demo', 'host.js');
const block = (name) => {
  const start = host.indexOf(`const ${name} = {`);
  return host.slice(start, host.indexOf('\n  };', start));
};
const keysOf = (src) => new Set([...src.matchAll(/^\s{4}'([a-z-]+:[a-z-]+)':/gm)].map((m) => m[1]));
const handled = keysOf(block('HANDLERS'));
const sent = keysOf(block('SENDS'));

for (const page of ['buddy', 'panel', 'stats']) {
  test(`the demo host answers every channel of the ${page} preload`, () => {
    const src = read('src', 'preload', `${page}.js`);
    for (const [, ch] of src.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)) assert.ok(handled.has(ch), `${page}: no demo handler for invoke('${ch}')`);
    for (const [, ch] of src.matchAll(/ipcRenderer\.send\('([^']+)'/g)) assert.ok(sent.has(ch), `${page}: no demo handler for send('${ch}')`);
  });
}

test('the site builds: real pages with the shim, generated preloads, bundled logic', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  try {
    site.build({ out });
    for (const page of ['buddy', 'panel', 'stats']) {
      const html = fs.readFileSync(path.join(out, 'app', 'renderer', page, 'index.html'), 'utf8');
      assert.match(html, /<script src="\.\.\/\.\.\/demo\/shim\.js" data-page="[a-z]+"><\/script>\s*<script src="\.\.\/\.\.\/demo\/preload-[a-z]+\.js"><\/script>\s*<script/);
      assert.match(html, /Content-Security-Policy/, `${page} keeps its CSP`);
      assert.ok(fs.existsSync(path.join(out, 'app', 'demo', `preload-${page}.js`)));
    }
    const mods = fs.readFileSync(path.join(out, 'app', 'demo', 'modules.js'), 'utf8');
    for (const id of site.ENTRIES) assert.ok(mods.includes(JSON.stringify(id)), `${id} is bundled`);
    assert.doesNotMatch(mods, /require\('electron'\)/, 'no Electron in the browser bundle');
    assert.ok(fs.existsSync(path.join(out, 'index.html')));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('the Theme setting reaches the pages: dark rules also apply on [data-theme="dark"]', () => {
  const css = site.themeCss('@media (prefers-color-scheme: dark) {\n  :root { --bg: #000; }\n  .x { color: red; }\n}');
  assert.match(css, /:root:not\(\[data-theme="light"\]\) \{ --bg: #000; \}/);
  assert.match(css, /:root\[data-theme="dark"\] \.x \{ color: red; \}/);
});

test('demo data: 30 days, nothing in the future', () => {
  const DD = require('../scripts/demo-data');
  const now = Date.now();
  const days = DD.days(now);
  assert.ok(Object.keys(days).length >= 20);
  for (const f of Object.values(days)) for (const r of f.sessions) assert.ok(r.end <= now && r.activeMs > 0);
});
