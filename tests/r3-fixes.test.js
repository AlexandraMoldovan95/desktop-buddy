'use strict';
// Round 3 audit fixes: catch-up fsync, .bak scrub when only the backup has the old key,
// power saver stops the recording dot, checklist backdrop sized by CSS (no ResizeObserver loop).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonStore } = require('../src/main/store');
const { needsMigration } = require('../src/shared/settings-schema');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (!fn()) { if (Date.now() > end) return false; await new Promise((r) => setTimeout(r, 10)); } return true; };
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('r3: an unsynced last write is fsync\'d once the gap is over (no later write needed)', async () => {
  const dir = tmp('r3-sync-');
  const file = path.join(dir, 'notes.json');
  let syncs = 0;
  const real = fs.promises;
  const promises = { ...real, open: async (...a) => { const fh = await real.open(...a); return { writeFile: (...b) => fh.writeFile(...b), sync: () => { syncs++; return fh.sync(); }, close: () => fh.close() }; } };
  const s = new JsonStore(file, () => ({ n: 0 }), { fs: { ...fs, promises }, fsyncGapMs: 60 });
  s.data.n = 1; await s.flushAsync();
  s.data.n = 2; await s.flushAsync();
  assert.equal(syncs, 1, 'the second write is inside the gap');
  assert.equal(s.mainSynced, false);
  assert.ok(await until(() => s.mainSynced), 'the catch-up fsync ran');
  assert.equal(syncs, 2);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).n, 2);
  assert.equal(s.syncTimer, null);
});

test('r3: a sync flush() cancels the catch-up timer', async () => {
  const dir = tmp('r3-sync2-');
  const s = new JsonStore(path.join(dir, 'a.json'), () => ({ n: 0 }), { fsyncGapMs: 60000 });
  await s.flushAsync(); s.data.n = 1; await s.flushAsync();
  assert.ok(s.syncTimer, 'armed');
  assert.equal(s.flush(), true);
  assert.equal(s.syncTimer, null);
  assert.equal(s.mainSynced, true);
});

test('r3 security: the old AI key is scrubbed when only settings.json.bak still has it', async () => {
  const dir = tmp('r3-bak-');
  const file = path.join(dir, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ uiMode: 'full', theme: 'light' }));
  fs.writeFileSync(file + '.bak', JSON.stringify({ uiMode: 'full', apiKeyEnc: 'OLDKEY' }));
  let migrated = false;
  const s = new JsonStore(file, () => ({}), { normalize: (d) => { if (needsMigration(d)) migrated = true; return d; } });
  assert.equal(migrated, false, 'the main file is already clean');
  assert.equal(s.bakMatches(needsMigration), true);
  assert.equal(await s.flushScrubbedAsync(), true);
  assert.doesNotMatch(fs.readFileSync(file + '.bak', 'utf8'), /OLDKEY/);
  assert.equal(s.bakMatches(needsMigration), false, 'nothing left: no rewrite at the next start');
  // missing or broken .bak: false, no throw
  fs.writeFileSync(file + '.bak', '{broken');
  assert.equal(s.bakMatches(needsMigration), false);
  fs.unlinkSync(file + '.bak');
  assert.equal(s.bakMatches(needsMigration), false);
  // main.js uses it at startup
  assert.match(read('src/main/main.js'), /settingsMigrated \|\| settingsStore\.bakMatches\(needsMigration\)\) settingsStore\.flushScrubbedAsync\(\)/);
});

test('r3 power: power saver stops the pulsing recording dot', () => {
  assert.match(read('src/renderer/buddy/buddy.css'), /\.stage\.lowfx \.buddy\.recording::after\s*\{\s*animation:\s*none;\s*\}/);
});

test('r3: the checklist backdrop gets its height from CSS, not from the ResizeObserver callback', () => {
  assert.match(read('src/renderer/panel/panel.css'), /\.note-backdrop \{[^}]*top: 0; bottom: 0;/);
  assert.doesNotMatch(read('src/renderer/panel/tabs/notes.js'), /back\.style\.height/);
});
