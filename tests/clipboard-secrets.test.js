'use strict';
// M3: the clipboard secret filter catches common secret shapes (fake values) without catching normal text.
const test = require('node:test');
const assert = require('node:assert/strict');
const clip = require('../src/main/clipboard');

// FAKE values built to look like secrets (none of them is real)
const r = (n, chars = 'aB3dE5gH7jK9mN1pQ2sT4vW6yZ8') => Array.from({ length: n }, (_, i) => chars[(i * 7 + 3) % chars.length]).join('');
const NBSP = '\u00a0';
const ZWSP = '\u200b';

test('secrets that slipped through before are now caught', () => {
  const positives = [
    ['app password without spaces', 'xkqwzbtrplmvncsd'],
    ['app password with NBSP', `abcd${NBSP}efgh${NBSP}ijkl${NBSP}mnop`],
    ['app password upper case', 'ABCD EFGH IJKL MNOP'],
    ['app password labelled', 'App password: abcd efgh ijkl mnop'],
    ['app password labelled (RO, no spaces)', 'Parola de aplicație: xkqwzbtrplmvncsd'],
    ['PGP private key', '-----BEGIN PGP PRIVATE KEY BLOCK-----\nabc\n-----END PGP PRIVATE KEY BLOCK-----'],
    ['AWS secret alone', 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
    ['AWS secret labelled', `aws_secret_access_key = ${r(40)}`],
    ['Google OAuth client secret', `GOCSPX-${r(28)}`],
    ['Google OAuth access token', `ya29.${r(60)}`],
    ['npm token', `npm_${r(36)}`],
    ['SendGrid key', `SG.${r(22)}.${r(43)}`],
    ['URL with credentials', 'postgres://admin:pw@db.example.com:5432/app'],
    ['https URL with credentials', 'https://user:s3cret@example.com/repo.git'],
    ['Azure storage key', `DefaultEndpointsProtocol=https;AccountName=x;AccountKey=${r(86)}==;`],
    ['Azure SAS', `https://x.blob.core.windows.net/c?sv=2022&sig=${r(44)}`],
    ['Azure client secret', `abc8Q~${r(34)}`],
    ['Discord token', `M${r(25)}.${r(6)}.${r(38)}`],
    ['Discord webhook', `https://discord.com/api/webhooks/123456789012345678/${r(68)}`],
    ['Anthropic key with zero-width space', `sk-ant-${ZWSP}api03-${r(40)}`],
    ['key after underscore', `KEY_sk-ant-api03-${r(40)}`],
    ['labelled password in config', 'DB_PASSWORD=s3cretPass2024'],
    ['full-width key', 'ｓｋ-ant-' + r(30)],
  ];
  for (const [name, text] of positives) {
    assert.ok(clip.looksLikeSecret(text), name);
    assert.equal(clip.addEntry([], text).skipped, 'secret', name);
  }
});

test('normal text is still saved', () => {
  const negatives = [
    'responsibilities', 'misunderstanding', 'responsabilitate', 'characterization', 'incomprehensible',
    'Abcd Efgh Ijkl Mnop', 'abcd efgh ijkl mnop qrst',
    'I will take this from that shelf and then we go home.',
    '4b825dc642cb6eb9a060e54bf8d69288fbee4904', // git hash (40 hex)
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', // sha256
    'https://example.com/path?q=1', 'https://user@example.com/', 'mailto:ana@example.com', 'ana@example.com',
    'Password: required', // Romanian lines below on purpose: a label must not catch ordinary sentences
    'Resetează parola din Setări.', 'Parola: o primești pe email.',
    'const pwd = getPwd(user1);', 'passwordInput.value = text;', 'password: process.env.SMTP_PASS',
    'C:\\Users\\Alex\\Documents\\Project 2024\\notes.txt', 'Anna has 4 apples and 12:30 is lunch time.',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'npm install nodemailer',
    'SG.1 is the first chapter', 'ya29 is a product code', 'AccountName=demo;',
    'Math.floor(value).toFixed(2)', 'task-manager-application-settings',
  ];
  for (const text of negatives) assert.equal(clip.looksLikeSecret(text), null, text);
});

test('"save what is in the clipboard now" respects the password-manager mark', async () => {
  for (const mime of [clip.EXCLUDE_MIME, clip.VIEWER_IGNORE_MIME]) {
    const cb = { readText: async () => 'Hunter-pass', has: async (m) => m === mime };
    const w = new clip.ClipboardWatcher(cb, () => {});
    assert.equal(await w.readUnlessExcluded(), null, mime);
  }
  const plain = { readText: async () => 'ordinary text', has: async () => false };
  assert.equal(await new clip.ClipboardWatcher(plain, () => {}).readUnlessExcluded(), 'ordinary text');
  // has() not supported: not blocked (cannot know)
  const old = { readText: async () => 'x', has: async () => { throw new Error('unsupported'); } };
  assert.equal(await new clip.ClipboardWatcher(old, () => {}).readUnlessExcluded(), 'x');
});

test('the ipc handler for clipboard:add-current uses readUnlessExcluded', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main/ipc.js'), 'utf8');
  const block = src.slice(src.indexOf("handle('clipboard:add-current'"), src.indexOf("handle('clipboard:add-current'") + 400);
  assert.match(block, /readUnlessExcluded\(\)/);
  assert.doesNotMatch(block, /watcher\.read\(\)/);
});
