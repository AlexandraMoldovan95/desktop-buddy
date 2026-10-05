'use strict';
// Tests for the logic without UI. Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { JsonStore } = require('../src/main/store');
const clip = require('../src/main/clipboard');
const notes = require('../src/main/notes');
const { makeSecrets } = require('../src/main/secrets');
const schema = require('../src/shared/settings-schema');

/** Waits until cond() is true (polls every 10 ms, up to 5 s): no fixed sleeps, so a slow machine doesn't fail the test. */
const waitFor = async (cond, ms = 5000) => { const end = Date.now() + ms; while (!cond()) { if (Date.now() > end) throw new Error('waitFor: timed out'); await new Promise((r) => setTimeout(r, 10)); } };

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-'));

// ------------------------------------------------------------ store
test('store: atomic write and read back', () => {
  const file = path.join(tmpDir(), 'a.json');
  const s = new JsonStore(file, () => ({ items: [] }));
  s.update((d) => { d.items.push(1); });
  s.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { items: [1] });
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.deepEqual(new JsonStore(file, () => ({})).data, { items: [1] });
});

test('store: a corrupt file → kept as a backup, starts empty, no crash', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'b.json');
  fs.writeFileSync(file, '{ this is not json');
  const s = new JsonStore(file, () => ({ items: [] }));
  assert.deepEqual(s.data, { items: [] });
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('b.corrupt-')));
});

test('store: writes are grouped (debounce)', async () => {
  const file = path.join(tmpDir(), 'c.json');
  const s = new JsonStore(file, () => ({ n: 0 }), { debounceMs: 30 });
  for (let i = 0; i < 5; i++) s.update((d) => { d.n++; });
  assert.equal(fs.existsSync(file), false);
  await waitFor(() => fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 5);
});

// ------------------------------------------------------------ clipboard
test('clipboard: skips empty, whitespace and texts that are too long', () => {
  assert.equal(clip.addEntry([], '').changed, false);
  assert.equal(clip.addEntry([], '   \n\t').changed, false);
  assert.equal(clip.addEntry([], 'x'.repeat(clip.MAX_TEXT_LENGTH + 1)).changed, false);
});

test('clipboard: no duplicates, an existing text moves to the top', () => {
  let items = [];
  items = clip.addEntry(items, 'a', { now: 1 }).items;
  items = clip.addEntry(items, 'b', { now: 2 }).items;
  const r = clip.addEntry(items, 'a', { now: 3 });
  assert.equal(r.changed, true);
  assert.deepEqual(r.items.map((i) => i.text), ['a', 'b']);
  assert.equal(r.items[0].createdAt, 3);
  assert.equal(clip.addEntry(r.items, 'a').changed, false, 'already first: nothing to change');
});

test('clipboard: the limit keeps pinned entries', () => {
  let items = [];
  for (let i = 0; i < 5; i++) items = clip.addEntry(items, 't' + i, { max: 100 }).items;
  items = items.map((it) => (it.text === 't0' ? { ...it, pinned: true } : it)); // the oldest one, pinned
  const r = clip.enforceMax(items, 3);
  assert.equal(r.length, 3);
  assert.ok(r.some((i) => i.text === 't0'), 'the pinned one stays');
  assert.deepEqual(r.map((i) => i.text), ['t4', 't3', 't0']);
});

test('clipboard: async API (Electron 44) and text marked by a password manager', async () => {
  // a mock of the Electron 44 API: readText/writeText/has return a Promise
  let text = 'start';
  let sensitive = false;
  const fake = {
    readText: async () => text,
    writeText: async (t) => { text = t; },
    has: async (mime) => sensitive && mime === clip.EXCLUDE_MIME,
  };
  const added = [];
  const w = new clip.ClipboardWatcher(fake, (t) => added.push(t));
  await w.tick();
  assert.deepEqual(added, [], 'what was there at startup is not added');
  text = 'normal'; await w.tick();
  text = 'secret-password'; sensitive = true; await w.tick();
  sensitive = false;
  await w.setPaused(true); text = 'while paused'; await w.tick();
  await w.setPaused(false); await w.tick();
  await w.write('from history'); await w.tick();
  text = 'new'; await w.tick();
  assert.deepEqual(added, ['normal', 'new']);
  assert.ok(added.every((t) => typeof t === 'string'), 'onText always gets text, not a Promise');
});

test('clipboard: works with the old (sync) API too and when has() throws', async () => {
  let text = 'a';
  const fake = { readText: () => text, writeText: (t) => { text = t; }, has: () => { throw new Error('tip nesuportat'); } };
  const added = [];
  const w = new clip.ClipboardWatcher(fake, (t) => added.push(t));
  text = 'b'; await w.tick();
  assert.deepEqual(added, ['b']);
});

// ------------------------------------------------------------ notes
test('notes: create, save, delete, title, pruning empty ones', () => {
  const n = notes.createNote(1);
  let list = [n];
  list = notes.saveNote(list, n.id, '\n  Shopping\nmilk, bread', 5);
  assert.equal(list[0].updatedAt, 5);
  assert.equal(notes.titleOf(list[0].body), 'Shopping');
  const empty = notes.createNote(2);
  list = notes.pruneEmpty([...list, empty]);
  assert.equal(list.length, 1);
  assert.equal(notes.deleteNote(list, n.id).length, 0);
  assert.throws(() => notes.saveNote(list, n.id, 42));
});

// ------------------------------------------------------------ settings
test('settings: wrong or unknown values are ignored', () => {
  const out = schema.sanitizePatch({
    buddySize: 999, buddyOpacity: 10, clipboardMax: 5000, theme: 'roz', hacked: true,
    alwaysOnTop: 'da', shortcut: 'rm -rf', aiModel: '<script>', apiKeyEnc: 'x',
  });
  assert.deepEqual(out, { buddyOpacity: 60, clipboardMax: 200 });
});

test('settings: valid and invalid shortcuts', () => {
  assert.equal(schema.sanitizePatch({ shortcut: 'CommandOrControl+Shift+Space' }).shortcut, 'CommandOrControl+Shift+Space');
  assert.equal(schema.sanitizePatch({ shortcut: 'Alt+F2' }).shortcut, 'Alt+F2');
  assert.equal(schema.sanitizePatch({ shortcut: '' }).shortcut, '');
  assert.equal(schema.sanitizePatch({ shortcut: 'Space' }).shortcut, undefined, 'not accepted without a modifier');
});

test('settings: the public view has no encrypted password and no old AI keys', () => {
  const view = schema.publicView({ ...schema.DEFAULTS, emailPassEnc: 'ENC', apiKeyEnc: 'OLDKEY', apiKeyHint: '…abcd', aiModel: 'm' });
  assert.equal('emailPassEnc' in view, false);
  for (const k of ['apiKeyEnc', 'apiKeyHint', 'apiKey', 'aiModel', 'aiProvider']) assert.equal(k in view, false, k);
  assert.equal(JSON.stringify(view).includes('ENC'), false);
  assert.equal(JSON.stringify(view).includes('OLDKEY'), false);
});

// ------------------------------------------------------------ the email password
test('email password: encrypted, never plain; refused without encryption', () => {
  const fakeSafe = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + [...s].reverse().join('')),
    decryptString: (b) => [...b.toString().slice(4)].reverse().join(''),
  };
  const sec = makeSecrets(fakeSafe);
  const pass = 'abcd efgh ijkl mnop';
  const enc = sec.encryptPassword('  ' + pass + '  ');
  assert.equal(Buffer.from(enc, 'base64').toString().includes(pass), false, 'not in plain text');
  assert.equal(sec.decryptPassword(enc), pass);
  assert.equal(sec.decryptPassword(null), null);
  assert.throws(() => sec.encryptPassword('   '));
  assert.throws(() => makeSecrets({ isEncryptionAvailable: () => false }).encryptPassword(pass), /not saved/);
  assert.equal('encryptKey' in sec, false, 'the AI API key is gone');
});

// ------------------------------------------------------------ API keys in the clipboard
test('clipboard: API keys and tokens do not go into the history', () => {
  // FAKE values, built to look like keys (they are not real keys)
  const fake = (prefix, n, ch = 'a') => prefix + ch.repeat(n);
  const secrets = {
    'Anthropic key': fake('sk-ant-api03-', 40, 'X'),
    'OpenAI key': fake('sk-proj-', 40, 'Q'),
    'GitHub token': fake('ghp_', 36, 'Z'),
    'Google key': fake('AIza', 35, 'B'),
    'AWS key': 'AKIA' + 'ABCDEFGHIJKLMNOP',
    'Supabase key': fake('sb_secret_', 30, 'k'),
    'Stripe key': fake('sk_live_', 24, '9'),
    'Slack token': fake('xoxb-', 20, '1'),
    'Hugging Face token': fake('hf_', 34, 'h'),
    'JWT token': 'eyJ' + 'a'.repeat(20) + '.eyJ' + 'b'.repeat(20) + '.' + 'c'.repeat(20),
    'private key': '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----',
    'Google app password': 'abcd efgh ijkl mnop',
  };
  for (const [kind, text] of Object.entries(secrets)) {
    assert.equal(clip.looksLikeSecret(text), kind, kind);
    const r = clip.addEntry([], text);
    assert.deepEqual([r.changed, r.skipped, r.items.length], [false, 'secret', 0], kind);
  }
  // also when the key is in the middle of a text (e.g. a piece of code)
  assert.equal(clip.addEntry([], `const key = "${secrets['Anthropic key']}";`).changed, false);
  // with the setting off, it is saved
  assert.equal(clip.addEntry([], secrets['OpenAI key'], { skipSecrets: false }).changed, true);
});

test('clipboard: ordinary text is not mistaken for a key', () => {
  const normal = [
    'task-manager-application-settings', 'Masks for the carnival', 'sk-learn', 'desk-lamp',
    'https://github.com/ghp/project', 'AIza', 'Anna has apples, pears and plums.', 'eyJ is not a token',
    'abcd efgh ijkl mnop qrst', 'Abcd Efgh Ijkl Mnop', 'npm install nodemailer imapflow',
  ];
  for (const t of normal) assert.equal(clip.looksLikeSecret(t), null, t);
});

test('clipboard: keys already saved are removed from the history, pinned ones too', () => {
  const items = [
    { id: '1', text: 'ordinary text', pinned: false },
    { id: '2', text: 'sk-ant-api03-' + 'x'.repeat(40), pinned: true },
    { id: '3', text: 'another', pinned: true },
  ];
  const r = clip.removeSecrets(items);
  assert.equal(r.removed, 1);
  assert.deepEqual(r.items.map((i) => i.id), ['1', '3']);
  assert.equal(clip.removeSecrets(r.items).removed, 0);
});
