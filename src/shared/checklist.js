'use strict';
// Checklists in notes (1.7.0): the note stays plain text, and a list line looks like this:
//   [ ] milk          [x] bread          - [ ] eggs   (with a dash, as in Markdown)
// Pure functions (page + tests): which line is a checkbox, checking / unchecking the selected lines,
// continuing the list on Enter, the number of checks (for the "2/5" in the list).
(function (root) {
  // indent, optional "- " or "* ", then [ ] / [x] / [X] and a space (or the end of the line)
  const BOX_RE = /^([ \t]*)([-*] +)?\[( |x|X)\](?= |$) ?/;

  /** The line as a list item: { indent, bullet, checked, boxStart, boxEnd, textStart } (positions in the line) or null. */
  function parseLine(line) {
    const m = BOX_RE.exec(line);
    if (!m) return null;
    const boxStart = m[1].length + (m[2] ? m[2].length : 0);
    return { indent: m[1], bullet: m[2] || '', checked: m[3] !== ' ', boxStart, boxEnd: boxStart + 3, textStart: m[0].length };
  }

  const lineStartAt = (text, i) => (i <= 0 ? 0 : text.lastIndexOf('\n', i - 1) + 1);

  /** Start and end of the lines touched by [a, b] (b excluded; a selection that ends at the start of a line does not take that line). */
  function lineRange(text, a, b) {
    const start = lineStartAt(text, a);
    let endFrom = b > a && text[b - 1] === '\n' ? b - 1 : b;
    if (endFrom < start) endFrom = start;
    let end = text.indexOf('\n', endFrom);
    if (end === -1) end = text.length;
    return { start, end };
  }

  /**
   * Checks / unchecks the lines touched by the selection.
   * - No line is a list item → every line with text becomes "[ ] …".
   * - Otherwise: if any is unchecked → all get checked; if all are checked → all get unchecked.
   *   Lines without "[ ]" stay untouched.
   * @returns {{ start: number, end: number, text: string, selStart: number, selEnd: number }}  the piece [start, end) is replaced with text
   */
  function toggle(text, selStart, selEnd = selStart) {
    const r = lineRange(text, Math.min(selStart, selEnd), Math.max(selStart, selEnd));
    const lines = text.slice(r.start, r.end).split('\n');
    const parsed = lines.map(parseLine);
    const anyBox = parsed.some(Boolean);
    let out;
    if (!anyBox) {
      out = lines.map((l) => {
        if (!l.trim()) return l;
        const indent = /^[ \t]*/.exec(l)[0];
        return `${indent}[ ] ${l.slice(indent.length)}`;
      });
    } else {
      const check = parsed.some((p) => p && !p.checked);
      out = lines.map((l, i) => {
        const p = parsed[i];
        if (!p) return l;
        return l.slice(0, p.boxStart) + (check ? '[x]' : '[ ]') + l.slice(p.boxEnd);
      });
    }
    const block = out.join('\n');
    // the caret / selection moves with the added text (the length changes only when boxes are added)
    const shift = block.length - (r.end - r.start);
    const single = lines.length === 1;
    return {
      start: r.start,
      end: r.end,
      text: block,
      selStart: single ? Math.max(r.start, selStart + shift) : r.start,
      selEnd: single ? Math.max(r.start, selEnd + shift) : r.start + block.length,
    };
  }

  /**
   * Enter at the end of a list line: the new line starts with "[ ] " (same indent and dash).
   * Enter on an empty list line ("[ ] "): the box goes away (the list ends).
   * @returns {null | { start, end, text, caret }}  null = a normal Enter
   */
  function onEnter(text, caret) {
    const start = lineStartAt(text, caret);
    let end = text.indexOf('\n', caret);
    if (end === -1) end = text.length;
    const line = text.slice(start, end);
    const p = parseLine(line);
    if (!p || caret - start < p.textStart) return null;
    if (!line.slice(p.textStart).trim()) return { start, end, text: '', caret: start };   // empty list item → ends the list
    const ins = `\n${p.indent}${p.bullet}[ ] `;
    return { start: caret, end: caret, text: ins, caret: caret + ins.length };
  }

  /** If the position is inside a "[ ]" / "[x]" box (between the brackets), returns the line; otherwise null. */
  function boxAt(text, index) {
    const start = lineStartAt(text, index);
    let end = text.indexOf('\n', index);
    if (end === -1) end = text.length;
    const p = parseLine(text.slice(start, end));
    if (!p) return null;
    const off = index - start;
    return off > p.boxStart && off < p.boxEnd ? { start, end } : null;
  }

  /** How many list lines the note has and how many are checked. */
  function count(text) {
    let total = 0;
    let done = 0;
    for (const line of String(text || '').split(/\r?\n/)) {
      const p = parseLine(line);
      if (p) { total += 1; if (p.checked) done += 1; }
    }
    return { total, done };
  }

  const api = { BOX_RE, parseLine, lineRange, toggle, onEnter, boxAt, count };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Checklist = api;
})(typeof window !== 'undefined' ? window : globalThis);
