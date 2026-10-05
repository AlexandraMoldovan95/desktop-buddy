'use strict';
// Text tools (no AI): word count, transforms, "Clean up text", diffs and the right-click menu.
// The spellchecker was removed in 1.6.0 (Electron on Windows would have downloaded dictionaries from Google).
// Some fixtures are Romanian on purpose: the tools must handle non-English text and accented letters.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../src/shared/text-tools');
const D = require('../src/renderer/shared/text-diff');
const CM = require('../src/main/context-menu');
const { sanitizePatch, withDefaults } = require('../src/shared/settings-schema');

test('word count: accents, hyphens, apostrophes, digits (also on Romanian text); English plural', () => {
  assert.equal(T.countWords("It's a well-known e-mail, isn't it? 2 apples."), 8);
  assert.equal(T.countWords('Într-o zi, n-am mers la școală. Am 2 mere și un e-mail.'), 12);
  assert.equal(T.countWords('   \n  '), 0);
  assert.deepEqual(T.textStats('Ana are mere.\nȘi pere.'), { words: 5, chars: 21, charsNoSpaces: 18, minutes: 1 });
  assert.equal(T.textStats('').minutes, 0);
  assert.equal(T.textStats('a '.repeat(700)).minutes, 4);
  assert.equal(T.plural(1, 'word'), '1 word');
  assert.equal(T.plural(0, 'word'), '0 words');
  assert.equal(T.plural(2, 'word'), '2 words');
  assert.equal(T.plural(20, 'word'), '20 words');
  assert.equal(T.plural(101, 'word'), '101 words');
  assert.equal(T.plural(3, 'match', 'matches'), '3 matches', 'an explicit plural form');
  assert.equal(T.formatStats(T.textStats('Hello')), '1 word · 5 characters · ~1 min read');
  assert.equal(T.formatStats(T.textStats('')), 'Empty');
});

test('transforms: Romanian letters with accents, a hyphenated word stays one word, sentences and lines', () => {
  assert.equal(T.transform('upper', 'și țară, îmbunătățiri'), 'ȘI ȚARĂ, ÎMBUNĂTĂȚIRI');
  assert.equal(T.transform('title', 'a WELL-known day'), 'A Well-known Day');
  assert.equal(T.transform('lower', 'ȘI ȚARĂ'), 'și țară');
  assert.equal(T.transform('title', 'într-o zi ANA a MERS'), 'Într-o Zi Ana A Mers');
  assert.equal(T.transform('sentence', 'SALUT. CE FACI?\nbine! ȘI TU'), 'Salut. Ce faci?\nBine! Și tu');
  assert.throws(() => T.transform('rocket', 'x'));
});

test('"Clean up text": every rule, counted', () => {
  const r = T.cleanText('Paşte şi ţară  mare  \nSalut ,ce faci ? bine.  apoi a,b\n\n\n\nfinal');
  assert.equal(r.text, 'Paște și țară mare\nSalut, ce faci? Bine. Apoi a, b\n\nfinal');
  const by = Object.fromEntries(r.changes.map((c) => [c.id, c.count]));
  assert.deepEqual(by, { cedilla: 3, trailing: 1, spaceBefore: 2, spaceAfter: 2, doubleSpace: 2, blankLines: 1, capital: 2 });
  assert.equal(r.total, 13);
  assert.match(T.describeChanges(r.changes), /double spaces between words \(2\)/);
  const en = T.cleanText('Hello ,how are you ? fine.  then a,b\n\n\n\nend  ');
  assert.equal(en.text, 'Hello, how are you? Fine. Then a, b\n\nend', 'the same rules on English text');
});

test('"Clean up text": does not break addresses, numbers, abbreviations, "...", lists and indentation', () => {
  const keep = [
    'vezi https://site.ro/a,b?x=1 și www.exemplu.ro,test',
    'scrie la ana.pop@firma.ro,azi',
    'pi e 3,14 și ora 10:30, gata',
    'fișierele .net și .env',
    'am vorbit cu dl. popescu, nr. 5 și etc. restul',
    'deci... poate mâine',
    '1. lapte\n2. ouă',
    '    cod indentat\n\tcu tab',
    'C:\\Users\\ana\\a,b.txt',
    'see https://example.com/a,b?x=1 and www.example.com,test',
    'talk to mr. smith about no. 5 and etc. the rest',
    'wait... maybe tomorrow',
  ];
  for (const t of keep) assert.equal(T.cleanText(t).text, t, t);
});

test('"Clean up text" is idempotent: the second time it finds nothing', () => {
  const samples = ['Salut ,ce  faci ? bine.  da. nu  ,  poate', 'Şi   ţie.  ok ! gata', 'a\n\n\n\n\nb   ', 'x ; y ;z'];
  for (const s of samples) {
    const once = T.cleanText(s).text;
    assert.equal(T.cleanText(once).total, 0, JSON.stringify(s));
  }
  assert.equal(T.cleanText('Salut\r\nce faci').text, 'Salut\nce faci', 'Windows line breaks become \\n, as in a textarea');
});

test('word diffs: deleted / added / same, the number of changes', () => {
  const parts = D.diffWords('Ana  are mere', 'Ana are pere');
  assert.deepEqual(parts.map((p) => p.type), ['same', 'del', 'add', 'same', 'del', 'add']);
  assert.equal(parts.filter((p) => p.type !== 'del').map((p) => p.text).join(''), 'Ana are pere');
  assert.equal(parts.filter((p) => p.type !== 'add').map((p) => p.text).join(''), 'Ana  are mere');
  assert.equal(D.countChanges(parts), 2);
  // for display: of the two spaces, one stays, one is deleted
  assert.deepEqual(D.tidyWhitespace(parts).slice(0, 3), [{ type: 'same', text: 'Ana' }, { type: 'same', text: ' ' }, { type: 'del', text: ' ' }]);
  assert.deepEqual(D.tidyWhitespace([{ type: 'del', text: 'a' }, { type: 'add', text: 'b' }]), [{ type: 'del', text: 'a' }, { type: 'add', text: 'b' }]);
});

test('the spellchecker is removed: no setting, no underlines, the dictionary download stays blocked', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  assert.equal('spellMode' in withDefaults({}), false);
  assert.deepEqual(sanitizePatch({ spellMode: 'ro+en' }), {}, 'the old setting is ignored');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.ok(!/spellcheck:\s*true/.test(src('main/windows.js')), 'no window with a spellchecker');
  assert.match(src('main/main.js'), /setSpellCheckerEnabled\(false\)/);
  assert.match(CM.BLOCKED_DICTIONARY_URL, /^http:\/\/127\.0\.0\.1:9\//, 'a local address, no outside traffic');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'src', 'main', 'spellcheck.js')));
});

test('right-click menu: editing, transforms and "Clean up text" only in a textarea, no suggestions', () => {
  const flags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
  const base = { isEditable: true, editFlags: flags, formControlType: 'text-area', selectionText: '' };
  const m = CM.contextMenuModel({ ...base, misspelledWord: 'notee', dictionarySuggestions: ['note'] });
  assert.ok(!m.some((i) => i.kind === 'suggestion' || i.kind === 'add-word'), 'no spelling suggestions');
  assert.equal(m[0].role, 'undo');
  assert.equal(m.find((i) => i.role === 'redo').enabled, false);
  assert.equal(m.find((i) => i.kind === 'submenu').label, 'Change case of all text');
  assert.deepEqual(m.find((i) => i.kind === 'submenu').items.map((i) => i.value), ['upper', 'lower', 'title', 'sentence']);
  assert.ok(m.some((i) => i.kind === 'clean'));
  assert.equal(CM.contextMenuModel({ ...base, selectionText: 'abc' }).find((i) => i.kind === 'submenu').label, 'Change case of the selection');
  const input = CM.contextMenuModel({ ...base, formControlType: 'input-text' });
  assert.ok(!input.some((i) => i.kind === 'submenu' || i.kind === 'clean'), 'short fields get editing only');
  assert.deepEqual(CM.contextMenuModel({ isEditable: false, selectionText: 'text' }).map((i) => i.role), ['copy']);
  assert.deepEqual(CM.contextMenuModel({ isEditable: false, selectionText: '' }), [], 'no menu on empty space');
  assert.notEqual(m[m.length - 1].kind, 'separator');
});
