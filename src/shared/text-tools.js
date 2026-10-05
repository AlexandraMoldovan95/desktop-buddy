'use strict';
// Text tools without AI (pure functions; they run in the page and in the Node tests):
// word count, transforms (UPPERCASE, lowercase, Title Case, sentence case)
// and "Clean up text" (fixed rules, each one counted, so the user sees what changed).
(function (root) {
  // a word: letters / digits, with a hyphen or apostrophe in the middle ("e-mail", "don't", "well-known")
  const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
  const WORDS_PER_MIN = 200;
  const LOCALE = 'en-GB';

  /** "0 words", "1 word", "2 words" (English rule). `many` defaults to `one` + "s". */
  function plural(n, one, many = `${one}s`) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function countWords(text) {
    const m = String(text || '').match(WORD_RE);
    return m ? m.length : 0;
  }

  /** Words, characters (without and with spaces), minutes to read (200 words / minute, at least 1). */
  function textStats(text) {
    const t = String(text || '');
    const words = countWords(t);
    const chars = Array.from(t.replace(/\r?\n/g, '')).length;
    const charsNoSpaces = Array.from(t.replace(/\s/g, '')).length;
    return { words, chars, charsNoSpaces, minutes: words ? Math.max(1, Math.round(words / WORDS_PER_MIN)) : 0 };
  }

  function formatStats(st) {
    if (!st.words && !st.chars) return 'Empty';
    return `${plural(st.words, 'word')} · ${plural(st.chars, 'character')} · ~${st.minutes || 1} min read`;
  }

  // ------------------------------------------------ transforms
  const cap = (w) => w.charAt(0).toLocaleUpperCase(LOCALE) + w.slice(1);

  function titleCase(text) {
    return String(text).toLocaleLowerCase(LOCALE).replace(WORD_RE, (w) => cap(w));
  }

  /** Everything lowercase, then a capital letter at the start of the text, of each line and after . ! ? */
  function sentenceCase(text) {
    return String(text).toLocaleLowerCase(LOCALE)
      .replace(/(^|[.!?…]\s+|\n\s*)(\p{Ll})/gu, (m, before, letter) => before + letter.toLocaleUpperCase(LOCALE));
  }

  const TRANSFORMS = Object.freeze({
    upper: { label: 'UPPERCASE', short: 'ABC', fn: (t) => String(t).toLocaleUpperCase(LOCALE) },
    lower: { label: 'lowercase', short: 'abc', fn: (t) => String(t).toLocaleLowerCase(LOCALE) },
    title: { label: 'Title Case', short: 'Abc Def', fn: titleCase },
    sentence: { label: 'Sentence case', short: 'Abc def.', fn: sentenceCase },
  });

  function transform(kind, text) {
    const t = TRANSFORMS[kind];
    if (!t) throw new Error('Unknown transform.');
    return t.fn(text);
  }

  // ------------------------------------------------ "Clean up text"
  // Abbreviations that do NOT get a capital letter after them ("etc. then", "no. 5", "dr. smith"; Romanian ones too).
  const ABBREVIATIONS = new Set(('etc ex nr dl dna dra dnul pag pg vs cca aprox str tel min max sec jud sect ap bl sc et ' +
    'mr mrs ms dr prof ing st no art alin cap fig vol ed resp cf eg ie lit pct ian feb mar apr iun iul aug sept oct noiem dec').split(' '));
  const CEDILLA = { 'ş': 'ș', 'ţ': 'ț', 'Ş': 'Ș', 'Ţ': 'Ț' };
  // pieces we never touch: web addresses, emails, paths
  const PROTECTED_RE = /(?:https?:\/\/|www\.)\S+|\S+@\S+\.\S+|[A-Za-z]:\\\S*/g;

  const RULES = [
    { id: 'cedilla', label: 'old-style ş / ţ → ș / ț',
      run: (t, n) => t.replace(/[şţŞŢ]/g, (c) => { n(); return CEDILLA[c]; }) },
    { id: 'trailing', label: 'spaces at the end of a line',
      run: (t, n) => t.replace(/[ \t]+$/gm, () => { n(); return ''; }) },
    { id: 'spaceBefore', label: 'space before , . ; : ! ?',
      // "word , then" / "word ,then" (a period only before a space: " .net" stays as it is)
      run: (t, n) => t.replace(/(\S)[ \t]+(?:([,.;:!?]+)(?=\s|$)|([,;])(?=\p{L}))/gu, (m, a, p1, p2) => { n(); return a + (p1 || p2); }) },
    { id: 'spaceAfter', label: 'space after a comma / semicolon',
      run: (t, n) => t.replace(/(\p{L})([,;])(?=\p{L})/gu, (m, a, p) => { n(); return `${a}${p} `; }) },
    { id: 'doubleSpace', label: 'double spaces between words',
      run: (t, n) => t.replace(/(?<=\S) {2,}(?=\S)/g, () => { n(); return ' '; }) },
    { id: 'blankLines', label: 'extra blank lines',
      run: (t, n) => t.replace(/\n(?:[ \t]*\n){2,}/g, () => { n(); return '\n\n'; }) },
    { id: 'capital', label: 'capital letter at the start of a sentence',
      run: (t, n) => t.replace(/([.!?])(\s+)(\p{Ll})/gu, (m, p, sp, letter, offset, whole) => {
        if (p === '.' && whole[offset - 1] === '.') return m;               // "..." (the sentence goes on)
        const prev = /([\p{L}\p{N}]+)$/u.exec(whole.slice(Math.max(0, offset - 30), offset));
        const word = prev ? prev[1] : '';
        if (p === '.' && (word.length <= 1 || /^\p{N}+$/u.test(word) || ABBREVIATIONS.has(word.toLocaleLowerCase(LOCALE)))) return m;
        n();
        return p + sp + letter.toLocaleUpperCase(LOCALE);
      }) },
  ];

  /**
   * Applies the rules to the text, leaving web addresses / emails / paths untouched.
   * @returns {{ text: string, changes: { id: string, label: string, count: number }[], total: number }}
   */
  function cleanText(input) {
    const original = String(input || '').replace(/\r\n/g, '\n');
    // hide the protected pieces behind a marker with no letters, so the rules don't see them
    const kept = [];
    let text = original.replace(PROTECTED_RE, (m) => { kept.push(m); return `\u0000${kept.length - 1}\u0000`; });
    const changes = [];
    for (const rule of RULES) {
      let count = 0;
      text = rule.run(text, () => { count++; });
      if (count) changes.push({ id: rule.id, label: rule.label, count });
    }
    // eslint-disable-next-line no-control-regex -- control characters are matched on purpose (to strip or refuse them)
    text = text.replace(/\u0000(\d+)\u0000/g, (m, i) => kept[Number(i)]);
    return { text, changes, total: changes.reduce((s, c) => s + c.count, 0) };
  }

  /** "double spaces between words (2) · old-style ş / ţ … (1)" for the summary. */
  function describeChanges(changes) {
    return changes.map((c) => `${c.label} (${c.count})`).join(' · ');
  }

  const api = { WORD_RE, plural, countWords, textStats, formatStats, TRANSFORMS, transform, titleCase, sentenceCase, cleanText, describeChanges, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
