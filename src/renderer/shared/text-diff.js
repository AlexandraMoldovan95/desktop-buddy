'use strict';
// Word-level differences between two texts (pure functions; they run in the page and in the Node tests).
// Used by "Clean up text" in notes: removed = red strikethrough, added = green.
(function (root) {
  const MAX_CELLS = 4e6;   // above this (very long, very different texts) we compare by lines

  /** Words, spaces and symbols as separate pieces, so the differences stay small and easy to read. */
  function tokenize(text) {
    return String(text || '').match(/\r?\n|[^\S\r\n]+|[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]/gu) || [];
  }
  const lines = (text) => String(text || '').split(/(?<=\n)/);

  /** Longest common subsequence → list of { type: 'same' | 'del' | 'add', text }. */
  function lcsDiff(a, b) {
    // the common prefix and suffix are removed first (usually most of the text)
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length; let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    const A = a.slice(start, endA); const B = b.slice(start, endB);
    const n = A.length; const m = B.length;
    if (n * m > MAX_CELLS) return null;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const out = [];
    const push = (type, text) => {
      const last = out[out.length - 1];
      if (last && last.type === type) last.text += text; else out.push({ type, text });
    };
    if (start) push('same', a.slice(0, start).join(''));
    let i = 0; let j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { push('del', A[i]); i++; }
      else { push('add', B[j]); j++; }
    }
    while (i < n) push('del', A[i++]);
    while (j < m) push('add', B[j++]);
    if (endA < a.length) push('same', a.slice(endA).join(''));
    return out;
  }

  /** Differences by words; for huge texts, by lines. */
  function diffWords(oldText, newText) {
    return lcsDiff(tokenize(oldText), tokenize(newText))
      || lcsDiff(lines(oldText), lines(newText))
      || [{ type: 'del', text: String(oldText || '') }, { type: 'add', text: String(newText || '') }];
  }

  /** How many pieces changed (for the "x changes" summary). */
  function countChanges(parts) {
    let n = 0;
    for (let k = 0; k < parts.length; k++) {
      if (parts[k].type === 'same') continue;
      if (parts[k].type === 'del' && parts[k + 1] && parts[k + 1].type === 'add') k++;   // replacement = one change
      n++;
    }
    return n;
  }

  /**
   * "two spaces → one" shows up as removed "··" + added "·". For display we turn it into "·" same + "·" removed,
   * so you can see exactly what goes away. Only for pieces made only of spaces.
   */
  function tidyWhitespace(parts) {
    const out = [];
    for (let k = 0; k < parts.length; k++) {
      const a = parts[k];
      const b = parts[k + 1];
      if (a.type === 'del' && b && b.type === 'add' && !a.text.trim() && !b.text.trim()) {
        let n = 0;
        while (n < a.text.length && n < b.text.length && a.text[n] === b.text[n]) n++;
        if (n) out.push({ type: 'same', text: a.text.slice(0, n) });
        if (a.text.length > n) out.push({ type: 'del', text: a.text.slice(n) });
        if (b.text.length > n) out.push({ type: 'add', text: b.text.slice(n) });
        k++;
      } else out.push(a);
    }
    return out;
  }

  const api = { tokenize, diffWords, countChanges, tidyWhitespace };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TextDiff = api;
})(typeof window !== 'undefined' ? window : globalThis);
