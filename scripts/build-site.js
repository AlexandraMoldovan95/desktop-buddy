'use strict';
// `npm run site`: builds the web presentation + the playable demo into `site/` (for Netlify).
//
// The demo runs the app's REAL pages (buddy, panel, statistics) and its real logic modules in the browser:
//  - the pages are copied unchanged, with one extra <script> (web/demo/shim.js) that stands in for the
//    Electron preload: it defines the same window.api / window.buddy / window.stats objects;
//  - the main-process logic (sessions, progress, notes, clipboard filter, settings validation, buddy mood…)
//    is bundled as-is into modules.js, with tiny in-memory stand-ins for fs / path / crypto / the JSON store;
//  - web/demo/host.js plays the main process: it answers the shims and drives the buddy.
// So the demo can't drift from the app: change a tab in src/renderer and the demo shows it after the next build.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let OUT = path.join(ROOT, 'site');
let APP = path.join(OUT, 'app');

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
function copyDir(from, to, filter = () => true) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b, filter);
    else if (filter(a)) fs.copyFileSync(a, b);
  }
}

// ------------------------------------------------ 1. the pages, unchanged + the shim
const PAGES = ['buddy', 'panel', 'stats'];

/**
 * Dark rules also apply on [data-theme="dark"] and stop on [data-theme="light"], so the Theme setting works in a browser.
 * Each "@media (prefers-color-scheme: dark) {" block is found by counting its braces (comments skipped), not with a
 * regular expression: a comment after a rule's closing brace (stats.css: `:root { ... } /* 5.1:1 *\/`) made the old
 * pattern run on to a later "}" and pull the layout rules after it (.range, .cal...) into the dark block, so the
 * Statistics window of the web demo lost its layout in the light theme.
 */
function themeCss(css) {
  const OPEN = '@media (prefers-color-scheme: dark) {';
  const pre = (sel, root) => sel.split(',').map((x) => x.trim()).map((x) => (x.startsWith(':root') ? root + x.slice(5) : `${root} ${x}`)).join(', ');
  let out = '';
  let i = 0;
  for (;;) {
    const start = css.indexOf(OPEN, i);
    if (start < 0) return out + css.slice(i);
    out += css.slice(i, start);
    let depth = 1;
    let j = start + OPEN.length;
    while (j < css.length && depth > 0) {
      if (css.startsWith('/*', j)) { const end = css.indexOf('*/', j + 2); j = end < 0 ? css.length : end + 2; continue; }
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const body = css.slice(start + OPEN.length, j - 1).replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...body.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    if (!rules.length) { out += css.slice(start, j); i = j; continue; }
    const inMedia = rules.map(([, sel, decl]) => `${pre(sel, ':root:not([data-theme="light"])')} {${decl}}`).join('\n');
    const forced = rules.map(([, sel, decl]) => `${pre(sel, ':root[data-theme="dark"]')} {${decl}}`).join('\n');
    out += `@media (prefers-color-scheme: dark) {\n${inMedia}\n}\n${forced}`;
    i = j;
  }
}

function copyPages() {
  for (const page of PAGES) copyDir(path.join(ROOT, 'src', 'renderer', page), path.join(APP, 'renderer', page));
  copyDir(path.join(ROOT, 'src', 'renderer', 'shared'), path.join(APP, 'renderer', 'shared'));
  copyDir(path.join(ROOT, 'src', 'shared'), path.join(APP, 'shared'), (f) => f.endsWith('.js'));
  for (const page of PAGES) {
    const file = path.join(APP, 'renderer', page, 'index.html');
    let html = fs.readFileSync(file, 'utf8');
    const i = html.indexOf('<script');
    if (i < 0) throw new Error(`${page}: no <script> to put the shim before`);
    html = `${html.slice(0, i)}<script src="../../demo/shim.js" data-page="${page}"></script>\n<script src="../../demo/preload-${page}.js"></script>\n${html.slice(i)}`;
    fs.writeFileSync(file, html);
    // the page's real preload, run with the shim's stand-in for require('electron')
    const preload = fs.readFileSync(path.join(ROOT, 'src', 'preload', `${page}.js`), 'utf8');
    fs.writeFileSync(path.join(APP, 'demo', `preload-${page}.js`),
      `// Generated from src/preload/${page}.js by scripts/build-site.js. Don't edit.\n(function (require) {\n${preload}\n})(window.__demoElectron.require);\n`);
  }
  // the Theme setting: dark rules on [data-theme] as well
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(APP, 'renderer')).filter((x) => x.endsWith('.css'))) fs.writeFileSync(f, themeCss(fs.readFileSync(f, 'utf8')));
}

// ------------------------------------------------ 2. the main-process logic, bundled for the browser
const ENTRIES = [
  'src/main/email/compose.js', 'src/main/session-manager.js', 'src/main/progress.js', 'src/main/buddy-mood.js', 'src/main/notes.js',
  'src/main/reminders.js', 'src/main/clipboard.js', 'src/main/email/provider.js',
  'src/shared/settings-schema.js', 'src/shared/progression.js', 'src/shared/email-presets.js', 'scripts/demo-data.js',
];
// stand-ins for Node / the disk (the demo keeps everything in memory)
const STUBS = {
  fs: `
const files = new Map();
const err = (code, p) => Object.assign(new Error(code + ': ' + p), { code });
const norm = (p) => String(p).replace(/\\/+/g, '/');
module.exports = {
  __files: files,
  existsSync: (p) => { p = norm(p); if (files.has(p)) return true; const d = p.replace(/\\/$/, '') + '/'; for (const k of files.keys()) if (k.startsWith(d)) return true; return false; },
  readFileSync: (p) => { p = norm(p); if (!files.has(p)) throw err('ENOENT', p); return files.get(p); },
  writeFileSync: (p, data) => { files.set(norm(p), String(data)); },
  copyFileSync: (a, b) => { files.set(norm(b), module.exports.readFileSync(a)); },
  unlinkSync: (p) => { files.delete(norm(p)); },
  mkdirSync: () => {},
  readdirSync: (dir) => { const d = norm(dir).replace(/\\/$/, '') + '/'; const out = new Set(); for (const k of files.keys()) if (k.startsWith(d)) out.add(k.slice(d.length).split('/')[0]); if (!out.size) throw err('ENOENT', dir); return [...out]; },
};`,
  path: `
const norm = (p) => p.replace(/\\/+/g, '/');
module.exports = {
  sep: '/',
  join: (...a) => norm(a.filter((x) => x !== '').join('/')),
  dirname: (p) => { const i = norm(p).lastIndexOf('/'); return i <= 0 ? '/' : norm(p).slice(0, i); },
  basename: (p, ext) => { let b = norm(p).split('/').pop(); if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length); return b; },
  extname: (p) => { const m = /\\.[^./]*$/.exec(p); return m ? m[0] : ''; },
};`,
  crypto: `
module.exports = {
  randomUUID: () => (globalThis.crypto && globalThis.crypto.randomUUID ? globalThis.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16))),
};`,
  'src/main/store.js': `
const fs = require('fs');
class JsonStore {
  constructor(file, makeDefault, opts = {}) {
    this.file = file; this.readOnly = false; this.timer = null; this.lastError = null;
    let d = null;
    if (fs.existsSync(file)) { try { d = JSON.parse(fs.readFileSync(file)); } catch (e) { d = null; } }
    this.data = d && opts.normalize ? opts.normalize(d) : (d || makeDefault());
  }
  update(fn) { fn(this.data); this.flush(); }
  flush() { fs.writeFileSync(this.file, JSON.stringify(this.data)); return true; }
  flushAsync() { this.flush(); return Promise.resolve(true); }
  flushScrubbed() { return this.flush(); }
  pruneCorrupt() {}
}
module.exports = { JsonStore };`,
  'src/main/log.js': `const quiet = () => {}; module.exports = { log: { info: quiet, warn: (...a) => console.warn('[demo]', ...a), error: (...a) => console.warn('[demo]', ...a) } };`,
  'src/main/user-error.js': `module.exports = { userMessage: (e, fallback) => (e && e.message) || fallback || 'Something went wrong.' };`,
};

function bundle() {
  const mods = new Map();   // id → source
  const resolve = (fromId, req) => {
    if (STUBS[req] !== undefined && !req.startsWith('.')) return req;
    const base = path.posix.dirname(fromId);
    let id = path.posix.normalize(path.posix.join(base, req));
    if (!id.endsWith('.js')) id += '.js';
    return id;
  };
  const visit = (id) => {
    if (mods.has(id)) return;
    if (STUBS[id] !== undefined) { mods.set(id, { src: STUBS[id], deps: {} }); visit.stubDeps(id); return; }
    const file = path.join(ROOT, id);
    if (!fs.existsSync(file)) throw new Error(`bundle: ${id} not found`);
    const src = fs.readFileSync(file, 'utf8');
    const deps = {};
    mods.set(id, { src, deps });
    for (const m of src.matchAll(/require\('([^']+)'\)/g)) {
      const target = resolve(id, m[1]);
      if (!target.startsWith('src/') && !target.startsWith('scripts/') && STUBS[target] === undefined) throw new Error(`bundle: ${id} needs "${m[1]}", which has no browser stand-in`);
      deps[m[1]] = target;
      visit(target);
    }
  };
  visit.stubDeps = (id) => { if (/require\('fs'\)/.test(STUBS[id])) { mods.get(id).deps.fs = 'fs'; visit('fs'); } };
  ENTRIES.forEach((e) => visit(e));
  const parts = [...mods].map(([id, { src, deps }]) => `${JSON.stringify(id)}: [function (module, exports, require) {\n${src}\n}, ${JSON.stringify(deps)}]`);
  return `'use strict';
// Generated by scripts/build-site.js: the app's main-process logic, unchanged, for the web demo. Don't edit.
(function () {
  const defs = {\n${parts.join(',\n')}\n};
  const cache = {};
  function load(id) {
    if (cache[id]) return cache[id].exports;
    const def = defs[id];
    if (!def) throw new Error('demo: unknown module ' + id);
    const module = { exports: {} };
    cache[id] = module;
    def[0](module, module.exports, (name) => load(def[1][name] || name));
    return module.exports;
  }
  window.DemoModules = { require: load, ids: Object.keys(defs) };
})();
`;
}

// ------------------------------------------------ 3. the presentation page and the demo host
function copyWeb() {
  copyDir(path.join(ROOT, 'web'), OUT);
  // the pictures shown on the presentation page
  const media = ['hero.png', 'hero-light.png', 'editor-montage.png', 'editor-montage-light.png', 'screenshot-annotate.png', 'screenshot-annotate-light.png', 'buddy-shapes.png', 'stats-30-days.png', 'notes-checklist-reminders.png', 'panels-progress.png', 'screenshot-gallery.png'];
  fs.mkdirSync(path.join(OUT, 'media'), { recursive: true });
  for (const m of media) fs.copyFileSync(path.join(ROOT, 'docs', 'media', m), path.join(OUT, 'media', m));
  fs.copyFileSync(path.join(ROOT, 'src', 'assets', 'icon.png'), path.join(OUT, 'media', 'icon.png'));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const repo = pkg.repository && (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository.url);
  // `npx serve site`: its "clean URLs" turn /app/demo/index.html into /app/demo/index, which breaks every relative link in the pages
  fs.writeFileSync(path.join(OUT, 'serve.json'), `${JSON.stringify({ cleanUrls: false, directoryListing: false, rewrites: [{ source: '/', destination: '/index.html' }] }, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'site-info.js'), `window.SITE_INFO = ${JSON.stringify({ version: pkg.version, repo: repo ? repo.replace(/^git\+/, '').replace(/\.git$/, '') : null })};\n`);
}

function build({ out } = {}) {
  if (out) { OUT = out; APP = path.join(OUT, 'app'); }
  fs.rmSync(OUT, { recursive: true, force: true });
  copyWeb();   // first: copyPages writes into app/demo/
  copyPages();
  fs.writeFileSync(path.join(APP, 'demo', 'modules.js'), bundle());
  let n = 0;
  const count = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? count(path.join(d, e.name)) : n++));
  count(OUT);
  return { files: n, out: rel(OUT) };
}

if (require.main === module) {
  const r = build();
  console.log(`[site] ${r.files} files in ${r.out}/. Publish the folder on Netlify (drag & drop), or try it locally with: npx serve site`);
  console.log('[site] (opening index.html straight from the disk does not work: browsers block the demo frames on file://)');
}
module.exports = { build, themeCss, bundle, ENTRIES };
