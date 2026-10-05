'use strict';
// L3: the app is offline except for sending email (SMTP via nodemailer, from main).
// General guard over all of src/ (does not depend on any AI file existing).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const files = walk(path.join(ROOT, 'src'));
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
// code without comments (URLs in comments are documentation, not requests)
const code = (f) => fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const jsFiles = files.filter((f) => f.endsWith('.js'));

// Node built-ins without network access, plus electron and the SMTP library
const ALLOWED_MODULES = new Set(['electron', 'nodemailer', 'path', 'fs', 'os', 'crypto', 'stream', 'child_process', 'readline',
  'events', 'util', 'zlib', 'buffer', 'string_decoder', 'timers', 'url', 'assert', 'worker_threads']);
const SMTP_FILES = new Set(['src/main/main.js', 'src/main/email/provider.js']);

const NETWORK_APIS = [
  ['fetch()', /\bfetch\s*\(/],
  ['WebSocket', /\bWebSocket\b/],
  ['XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['EventSource', /\bEventSource\b/],
  ['sendBeacon', /\bsendBeacon\b/],
  ['RTCPeerConnection', /\bRTCPeerConnection\b/],
  ['electron net', /\bnet\s*\.\s*(?:request|fetch|resolveHost)\b|require\(\s*['"]electron['"]\s*\)\s*\.\s*net\b|\{[^}]*\bnet\b[^}]*\}\s*=\s*require\(\s*['"]electron['"]\s*\)/],
  ['download', /\bdownloadURL\s*\(/],
  ['remote page', /\bloadURL\s*\(\s*['"`]https?:/],
  ['dynamic import', /(?<![.\w])import\s*\(/],
  ['non-literal require', /\brequire\s*\(\s*(?!['"])/],
];

test('offline: no network API anywhere in src/', () => {
  const offenders = [];
  for (const f of jsFiles) {
    const src = code(f);
    for (const [name, re] of NETWORK_APIS) if (re.test(src)) offenders.push(`${rel(f)}: ${name}`);
  }
  assert.deepEqual(offenders, []);
});

test('offline: only network-free modules are required; nodemailer only in the SMTP path', () => {
  const offenders = [];
  for (const f of jsFiles) {
    for (const m of code(f).matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const name = m[1].replace(/^node:/, '');
      if (name.startsWith('.')) continue;
      if (!ALLOWED_MODULES.has(name)) offenders.push(`${rel(f)}: ${m[1]}`);
      else if (name === 'nodemailer' && !SMTP_FILES.has(rel(f))) offenders.push(`${rel(f)}: nodemailer outside the SMTP path`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('offline: no remote URLs in code (only the SVG namespace and the blocked dictionary address)', () => {
  const ok = /^(?:http:\/\/www\.w3\.org\/2000\/svg|http:\/\/127\.0\.0\.1:9\/)/;
  const offenders = [];
  for (const f of jsFiles) {
    for (const m of code(f).matchAll(/['"`]((?:https?|wss?|ftp):\/\/[^'"`]*)/gi)) if (!ok.test(m[1])) offenders.push(`${rel(f)}: ${m[1]}`);
  }
  assert.deepEqual(offenders, []);
});

test('offline: the only runtime dependency is nodemailer', () => {
  const pkg = require('../package.json');
  assert.deepEqual(Object.keys(pkg.dependencies || {}), ['nodemailer']);
});

test('offline: every page has a strict CSP with connect-src none', () => {
  const pages = files.filter((x) => x.endsWith('.html'));
  assert.ok(pages.length > 0);
  for (const f of pages) {
    const html = fs.readFileSync(f, 'utf8');
    const m = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
    assert.ok(m, `${rel(f)}: no CSP`);
    assert.match(m[1], /default-src 'none'/, rel(f));
    assert.match(m[1], /connect-src 'none'/, rel(f));
    assert.doesNotMatch(m[1], /unsafe-inline|unsafe-eval|https?:|\*/, rel(f));
  }
});

test('offline guard catches the bypasses from the audit', () => {
  const samples = [
    "const Anthropic = require('@anthropic-ai/sdk');",
    "const host = 'api.' + 'anthropic' + '.com'; fetch('https://' + host);",
    "const { net } = require('electron'); net.request({ url });",
    "require('electron').net.fetch(u)",
    "await fetch(`${settings.baseUrl}/v1/messages`)",
    "const g = 'https://generativelanguage.googleapis.com/v1';",
    "const https = require('node:https');",
    "const m = require(name);",
  ];
  for (const s of samples) {
    const net = NETWORK_APIS.some(([, re]) => re.test(s));
    const mod = [...s.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g)].some((m) => !ALLOWED_MODULES.has(m[1].replace(/^node:/, '')));
    const url = /['"`]https?:\/\//.test(s);
    assert.ok(net || mod || url, s);
  }
});
