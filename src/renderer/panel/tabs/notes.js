'use strict';
// The Notes tab: list + editor with autosave (500 ms after the last key),
// sending the note by email (to yourself or anyone) and the text tools without AI:
// word count, transforms, "Clean up text" (showing the differences before Accept).
// Since 1.7.0: checklists ([ ] / [x], see shared/checklist.js) and one reminder per note (shared/reminder-time.js).
(function () {
  const { h, icon, plural, relTime, toast, confirmInline } = window.UI;
  const listView = document.getElementById('notesListView');
  const editor = document.getElementById('noteEditor');
  const list = document.getElementById('notesList');
  const empty = document.getElementById('notesEmpty');
  const search = document.getElementById('notesSearch');
  const body = document.getElementById('noteBody');
  const state = document.getElementById('noteState');
  const actions = document.getElementById('noteActions');

  const CL = window.Checklist;
  const RT = window.ReminderTime;
  const banner = document.getElementById('remindBanner');
  const SAVE_DELAY = 500;
  const SAVE_MAX_WAIT = 5000;   // r2 M2: while you keep typing, it still saves at least every 5 s
  let notes = [];
  let current = null;   // the open note
  let saveTimer = 0;
  let dirtySince = 0;   // when the first unsaved change was typed (0 = nothing waiting)
  let saving = Promise.resolve();

  const errText = (e) => ((e && e.message) || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  // F6: list previews show checkboxes as ☐ / ☑ instead of the raw "[ ]" / "[x]"
  const boxes = (line) => line.replace(CL.BOX_RE, (_m, indent, _bullet, c) => `${indent}${c === ' ' ? '☐' : '☑'} `);
  const titleOf = (text) => boxes(((text || '').split(/\r?\n/).find((l) => l.trim()) || '').trim()).slice(0, 80) || 'New note';
  const snippetOf = (text) => {
    const lines = (text || '').split(/\r?\n/).filter((l) => l.trim());
    return lines.slice(1).map(boxes).join(' ').replace(/\s+/g, ' ').slice(0, 120);
  };

  /** The reminder text: "today at 15:00", "went off today at 15:00", "missed (yesterday at 18:00)". */
  function remindText(r) {
    const when = RT.formatAt(r.at);
    return r.status === 'pending' ? when : r.status === 'fired' ? `went off ${when}` : `missed (${when})`;
  }

  /** The small line under the title: when it was changed, the checkboxes (2/5) and the reminder. */
  function metaOf(n) {
    const c = CL.count(n.body);
    const r = n.remind;
    return h('div', { class: 'item-meta' },
      h('span', { text: relTime(n.updatedAt) }),
      c.total ? h('span', { class: 'meta-chip' + (c.done === c.total ? ' done' : ''), title: `${c.done} of ${c.total} checked` }, icon('checklist', 12), `${c.done}/${c.total}`) : null,
      r ? h('span', { class: 'meta-chip remind' + (r.status === 'pending' ? '' : ' due'), title: `Reminder: ${remindText(r)}` }, icon('bell', 12), remindText(r)) : null);
  }

  /** At the top of the list: reminders that went off or were missed and you haven't pressed "Done" yet. */
  function renderBanner() {
    const due = notes.filter((n) => n.remind && n.remind.status !== 'pending').sort((a, b) => a.remind.at - b.remind.at);
    banner.hidden = !due.length;
    if (!due.length) return;
    banner.replaceChildren(...[
      h('div', { class: 'rb-head' }, icon('bell', 15), due.length === 1 ? 'A reminder is waiting for you' : `${due.length} reminders are waiting for you`),
      ...due.slice(0, 4).map((n) => h('button', { class: 'rb-item', type: 'button', onclick: () => open(n) },
        h('span', { class: 'rb-title', text: titleOf(n.body) }), h('span', { class: 'rb-when', text: remindText(n.remind) }))),
      due.length > 4 ? h('span', { class: 'rb-more', text: `and ${due.length - 4} more` }) : null].filter(Boolean));
  }

  function renderList() {
    renderBanner();
    const q = search.value.trim().toLowerCase();
    const shown = (q ? notes.filter((n) => n.body.toLowerCase().includes(q)) : notes).filter((n) => n.body.trim() || n === current);
    list.replaceChildren(...shown.map((n) => h('li', {},
      h('div', { class: 'item' },
        h('button', { class: 'item-main', type: 'button', onclick: () => open(n) },
          h('div', { class: 'item-title', text: titleOf(n.body) }),
          snippetOf(n.body) ? h('div', { class: 'item-sub', text: snippetOf(n.body) }) : null,
          metaOf(n))))));
    const none = shown.length === 0;
    list.hidden = none;
    empty.hidden = !none;
    if (none) {
      empty.replaceChildren(
        icon('note', 28),
        h('strong', { text: q ? 'Nothing found' : 'No notes yet' }),
        h('span', { text: q ? `No note contains "${search.value.trim()}".` : 'Press "+ New note" and start writing. It saves by itself.' }),
      );
    }
  }

  function showList() {
    flush();
    Extras.reset();
    current = null;
    editor.hidden = true;
    listView.hidden = false;
    refresh();
  }

  async function refresh() {
    notes = await window.api.notes.list();
    renderList();
  }

  function open(note) {
    Extras.reset();
    editor.classList.remove('show-adv');   // simple mode: "⋯" starts closed for every note
    document.getElementById('noteMore').setAttribute('aria-expanded', 'false');
    current = note;
    body.value = note.body;
    Boxes.render();
    showState(note.body ? 'saved' : '');
    state.title = note.body ? `Saved ${relTime(note.updatedAt)}` : '';
    listView.hidden = true;
    editor.hidden = false;
    deleteCtl.reset();
    mailCtl.reset();
    Remind.render();
    body.focus();
    body.setSelectionRange(body.value.length, body.value.length);
    updateStats();
  }

  /** F6: the save state lives in the footer, short enough to never be cut: "✓ Saved". */
  function showState(kind) {
    state.textContent = kind === 'saved' ? '✓ Saved' : kind === 'saving' ? 'Saving…' : kind === 'error' ? 'Not saved' : '';
    state.classList.toggle('bad', kind === 'error');
  }

  function scheduleSave() {
    showState('saving');
    clearTimeout(saveTimer);
    if (!dirtySince) dirtySince = Date.now();
    saveTimer = setTimeout(flush, Math.max(0, Math.min(SAVE_DELAY, dirtySince + SAVE_MAX_WAIT - Date.now())));
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = 0;
    dirtySince = 0;
    if (!current || current.body === body.value) return saving;
    const note = current;
    const text = body.value;
    note.body = text;
    saving = saving.then(() => window.api.notes.save(note.id, text))
      .then((saved) => {
        if (saved) { note.updatedAt = saved.updatedAt; }
        if (current === note) { showState('saved'); state.title = 'Saved just now'; }
      })
      .catch((err) => { showState('error'); toast(errText(err) || "Couldn't save", 'error'); });
    return saving;
  }

  const deleteCtl = confirmInline(actions, {
    label: 'Delete',
    question: 'Delete this note?',
    onConfirm: async () => {
      if (!current) return;
      clearTimeout(saveTimer);
      Extras.reset();
      await window.api.notes.remove(current.id);
      current = null;
      toast('Note deleted');
      showList();
    },
  });

  // ------------------------------------------------ send by email (to yourself or anyone: it goes out from your account)
  const mailCtl = (() => {
    const host = document.getElementById('noteMail');
    const box = document.getElementById('noteMailBox');
    const toggle = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Email this note', title: 'Email this note', 'aria-expanded': 'false', 'aria-controls': 'noteMailBox' }, icon('mail', 18));
    host.replaceChildren(toggle);

    const toInput = h('input', { class: 'input input-wide', type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: 1000, placeholder: 'name@example.com', 'aria-label': 'To' });
    const subjectInput = h('input', { class: 'input input-wide', type: 'text', maxlength: 200, 'aria-label': 'Subject' });
    const chips = h('div', { class: 'nm-chips' });
    const from = h('span', { class: 'nm-from' });
    const err = h('p', { class: 'error-text nm-err', role: 'alert', hidden: true });
    const send = h('button', { class: 'btn btn-primary', type: 'submit' }, icon('send', 16), 'Send');
    let own = '';
    let recent = [];

    const listOf = () => toInput.value.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
    const inList = (a) => listOf().some((x) => x.toLowerCase() === a.toLowerCase());

    function renderChips() {
      const chip = (addr, label, removable) => h('span', { class: 'nm-chip' + (inList(addr) ? ' on' : '') },
        h('button', { class: 'nm-chip-main', type: 'button', title: addr, 'aria-pressed': String(inList(addr)), onclick: () => {
          const list = listOf();
          toInput.value = (inList(addr) ? list.filter((x) => x.toLowerCase() !== addr.toLowerCase()) : [...list, addr]).join(', ');
          renderChips();
          toInput.focus();
        } }, label),
        removable ? h('button', { class: 'nm-chip-x', type: 'button', 'aria-label': `Forget ${addr}`, title: 'Remove from the list', onclick: async () => {
          recent = recent.filter((x) => x !== addr);
          await window.api.settings.set({ emailRecent: recent });
          renderChips();
        } }, icon('close', 12)) : null);
      chips.replaceChildren(...[
        own ? chip(own, 'Me', false) : null,
        ...recent.map((a) => chip(a, a, true))].filter(Boolean));
      chips.hidden = !own && !recent.length;
    }

    const form = h('form', { class: 'nm-form' },
      h('div', { class: 'nm-head' }, h('span', { class: 'nm-title' }, icon('mail', 15), 'Send the note'),
        h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Close', onclick: () => close() }, icon('close', 16))),
      h('label', { class: 'nm-field' }, h('span', { text: 'To' }), toInput),
      chips,
      h('label', { class: 'nm-field' }, h('span', { text: 'Subject' }), subjectInput),
      err,
      h('div', { class: 'nm-foot' }, from,
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Cancel'), send));
    box.replaceChildren(form);
    toInput.addEventListener('input', renderChips);

    async function open() {
      if (!current || !body.value.trim()) { toast('The note is empty', 'error'); return; }
      const [st, info] = await Promise.all([window.api.email.status().catch(() => null), window.api.settings.get().catch(() => null)]);
      if (!st || !st.complete) {
        // not set up yet: say what to do and offer to go there (no raw field names)
        Extras.close();
        box.replaceChildren(h('div', { class: 'nm-form' },
          h('p', { class: 'nm-setup', text: 'To send notes by email, first type your email address and password in Settings → Email.' }),
          h('div', { class: 'nm-foot' }, h('span', { class: 'nm-from' }),
            h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close() }, 'Not now'),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { close(); goToEmailSettings(); } }, 'Take me there'))));
        box.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        box.querySelector('.btn-primary').focus();
        return;
      }
      box.replaceChildren(form);
      Extras.close();
      own = info ? info.settings.emailAddress : '';
      recent = info && Array.isArray(info.settings.emailRecent) ? info.settings.emailRecent : [];
      toInput.value = own;
      subjectInput.value = `Note: ${titleOf(body.value)}`;
      from.textContent = `From ${own}`;
      from.title = `Sent from your account: ${own}`;
      err.hidden = true;
      send.disabled = false;
      renderChips();
      box.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      toInput.focus();
      toInput.select();   // type another address right away or keep "Me"
    }

    function close() {
      box.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!current || send.disabled) return;
      err.hidden = true;
      send.disabled = true;
      send.lastChild.textContent = 'Sending…';
      try {
        await flush();
        const r = await window.api.email.sendNote(current.id, { to: toInput.value, subject: subjectInput.value });
        if (r.sent) {
          toast(`Note sent to ${r.to.join(', ')}`, 'ok');
          close();
          body.focus();
        } else { err.textContent = r.message || "It wasn't sent."; err.hidden = false; }
      } catch (ex) { err.textContent = errText(ex) || "The email wasn't sent."; err.hidden = false; }
      send.disabled = false;
      send.lastChild.textContent = 'Send';
    });
    form.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); body.focus(); } });
    toggle.addEventListener('click', () => (box.hidden ? open() : close()));

    return { reset: close, close };
  })();

  function goToEmailSettings() {
    document.getElementById('tab-settings').click();
    if (window.SettingsTab) window.SettingsTab.openCategory('email');
  }

  // ------------------------------------------------ text tools (no AI, no network): see src/shared/text-tools.js
  const TT = window.TextTools;
  const statsEl = document.getElementById('noteStats');
  const statsText = h('span', { class: 'ns-text' });
  const undoBtn = h('button', { class: 'link-btn ns-undo', type: 'button', hidden: true }, icon('undo', 13), 'Undo clean-up');
  statsText.classList.add('adv');   // word counts: under "More" in simple mode
  statsEl.append(statsText, undoBtn);
  let statsFrame = 0;

  function updateStats() {
    cancelAnimationFrame(statsFrame);
    statsFrame = requestAnimationFrame(() => {
      if (editor.hidden) return;
      const all = TT.textStats(body.value);
      const a = body.selectionStart;
      const b = body.selectionEnd;
      if (b > a && document.activeElement === body) {
        const sel = TT.textStats(body.value.slice(a, b));
        statsText.textContent = `Selected: ${plural(sel.words, 'word')} · ${plural(sel.chars, 'character')} (of ${plural(all.words, 'word')})`;
      } else {
        statsText.textContent = TT.formatStats(all);
      }
    });
  }

  /** Replaces part of the textarea like typing would (so Ctrl+Z and autosave work). */
  function replaceRange(el, start, end, text) {
    el.focus();
    el.setSelectionRange(start, end);
    if (!text && start === end) return;
    if (!document.execCommand(text ? 'insertText' : 'delete', false, text)) {
      el.setRangeText(text, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  /** UPPERCASE / lowercase / Title Case / Sentence case: on the selection or, with no selection, on the whole text. */
  function transformText(kind, el = body) {
    if (!el || el.readOnly || el.disabled || !TT.TRANSFORMS[kind]) return;
    let start = el.selectionStart;
    let end = el.selectionEnd;
    const whole = start === end;
    if (whole) { start = 0; end = el.value.length; }
    const before = el.value.slice(start, end);
    if (!before.trim()) { toast('No text to change', 'error'); return; }
    const after = TT.transform(kind, before);
    if (after === before) { toast('The text already looks like this'); el.focus(); return; }
    replaceRange(el, start, end, after);
    if (!whole) el.setSelectionRange(start, start + after.length);   // stays selected: you can try another option
    toast(`${TT.TRANSFORMS[kind].label}${whole ? ' · whole text' : ''} · Ctrl+Z undoes`);
    updateStats();
  }

  // "Clean up text": the proposal replaces the text, showing the differences, until Accept / Cancel
  const Clean = (() => {
    const box = document.getElementById('noteProposal');
    const title = document.getElementById('proposalTitle');
    const rules = document.getElementById('proposalRules');
    const diffBox = document.getElementById('noteDiff');
    const accept = document.getElementById('proposalAccept');
    let proposal = null;     // { noteId, base, text }
    let lastUndo = null;     // { noteId, before, after }

    function part(p) {
      if (p.type === 'same') return document.createTextNode(p.text);
      const blank = !p.text.trim();
      // nobody would see removed / added spaces: show them as "·" and line breaks as "↵"
      const shown = blank ? p.text.replace(/ /g, '·').replace(/\t/g, '→').replace(/\n/g, '↵\n') : p.text;
      return h(p.type === 'del' ? 'del' : 'ins', { class: blank ? 'ws' : '', text: shown });
    }

    function open() {
      if (!current) return;
      if (!body.value.trim()) { toast('The note is empty', 'error'); return; }
      const r = TT.cleanText(body.value);
      if (!r.total) { toast('Nothing to clean up: the text looks good'); body.focus(); return; }
      mailCtl.close();
      Tools.close();
      proposal = { noteId: current.id, base: body.value, text: r.text };
      title.textContent = plural(r.total, 'fix', 'fixes');
      title.title = 'Red = removed, green = added. Nothing changes until you press Accept.';
      rules.replaceChildren(...r.changes.map((c) => h('span', { class: 'rule-chip', text: `${c.label} · ${c.count}` })));
      diffBox.replaceChildren(...window.TextDiff.tidyWhitespace(window.TextDiff.diffWords(body.value, r.text)).map(part));
      diffBox.scrollTop = 0;
      body.readOnly = true;
      document.getElementById('noteBodyWrap').hidden = true;
      box.hidden = false;
      accept.focus();
    }

    function close() {
      proposal = null;
      box.hidden = true;
      document.getElementById('noteBodyWrap').hidden = false;
      body.readOnly = false;
    }

    function hideUndo() { lastUndo = null; undoBtn.hidden = true; }

    accept.addEventListener('click', () => {
      if (!proposal || !current || proposal.noteId !== current.id) { close(); return; }
      const { base, text } = proposal;
      close();
      if (body.value !== base) { toast('The text changed in the meantime. Please try again.', 'error'); return; }
      replaceRange(body, 0, body.value.length, text);
      body.setSelectionRange(0, 0);
      body.scrollTop = 0;
      lastUndo = { noteId: current.id, before: base, after: text };
      undoBtn.hidden = false;
      toast('Text cleaned up');
      updateStats();
    });
    document.getElementById('proposalReject').addEventListener('click', () => { close(); body.focus(); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); body.focus(); } });
    undoBtn.addEventListener('click', () => {
      if (lastUndo && current && current.id === lastUndo.noteId && body.value === lastUndo.after) {
        replaceRange(body, 0, body.value.length, lastUndo.before);
        body.setSelectionRange(0, 0);
        toast('Clean-up undone');
      }
      hideUndo();
      updateStats();
    });

    return {
      open,
      close,
      reset() { close(); hideUndo(); },
      /** Once you type something, "Undo clean-up" disappears (Ctrl+Z still works). */
      onInput() { if (lastUndo && body.value !== lastUndo.after) hideUndo(); },
    };
  })();

  // the "Text tools" card (the Aa button in the editor bar)
  const Tools = (() => {
    const host = document.getElementById('noteTools');
    const box = document.getElementById('noteToolsBox');
    const toggle = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Text tools', title: 'Text tools: change case and "Clean up text"', 'aria-expanded': 'false', 'aria-controls': 'noteToolsBox' }, icon('type', 18));
    host.replaceChildren(toggle);

    box.replaceChildren(
      h('div', { class: 'nm-head' }, h('span', { class: 'nm-title' }, icon('type', 15), 'Text tools'),
        h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Close', onclick: () => { close(); body.focus(); } }, icon('close', 16))),
      h('div', { class: 'nt-row' }, h('span', { class: 'nt-label', text: 'Change' }),
        h('div', { class: 'chip-row' }, ...Object.entries(TT.TRANSFORMS).map(([kind, t]) =>
          h('button', { class: 'chip-btn', type: 'button', title: `${t.label}: on the selection; with no selection, on the whole note`, onclick: () => transformText(kind) }, t.short)))),
      h('div', { class: 'nt-row' }, h('span', { class: 'nt-label', text: 'Clean' }),
        h('div', { class: 'nt-clean' },
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => Clean.open() }, icon('check', 15), 'Clean up text'),
          h('span', { class: 'hint', text: 'Spaces, commas, capitals, old-style ş / ţ. See the changes first.' }))),
      h('p', { class: 'nt-tip', text: 'Also from right-click in a note: Change case, Clean up text.' }));

    function open() {
      if (!current) return;
      mailCtl.close();
      Clean.close();
      box.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
    function close() {
      box.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', () => (box.hidden ? open() : close()));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); body.focus(); } });
    // clicking the buttons doesn't move the cursor out of the note: the selection stays for the transform
    box.addEventListener('mousedown', (e) => { if (e.target.closest('.chip-btn')) e.preventDefault(); });
    return { open, close };
  })();

  // ------------------------------------------------ checklists: [ ] / [x] (see shared/checklist.js)
  /** Checks / unchecks the lines at the cursor (or selection); on lines without a box, adds one. */
  function toggleChecklist() {
    if (!current || body.readOnly) return;
    const r = CL.toggle(body.value, body.selectionStart, body.selectionEnd);
    replaceRange(body, r.start, r.end, r.text);
    body.setSelectionRange(r.selStart, r.selEnd);
    updateStats();
  }
  const checkBtn = h('button', { class: 'btn btn-ghost btn-sm bar-btn', type: 'button', 'aria-label': 'List with checkboxes (Ctrl+Enter)', title: 'Turns the line into a checkbox, or checks / unchecks it (Ctrl+Enter)' }, icon('checklist', 16), 'List');
  document.getElementById('noteCheck').replaceChildren(checkBtn);
  checkBtn.addEventListener('mousedown', (e) => e.preventDefault());   // the selection in the note stays
  checkBtn.addEventListener('click', toggleChecklist);
  // F-H1: real checkboxes. The backdrop behind the (then transparent) textarea draws the same text with a box
  // over every "[ ]" / "[x]"; a click on a box ticks that line. The note's text format does not change.
  const Boxes = (() => {
    const wrap = document.getElementById('noteBodyWrap');
    const back = document.getElementById('noteBackdrop');
    const ANY_BOX = /^[ \t]*(?:[-*] +)?\[[ xX]\](?= |$)/m;
    const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'tabSize',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth'];
    let styled = false;
    let on = false;

    /** Same box as the textarea's text area (without its scrollbar), same scroll. */
    function syncBox() {
      if (!on) return;
      if (!styled) {
        const cs = getComputedStyle(body);
        for (const k of COPY) back.style[k] = cs[k];
        styled = true;
      }
      const cs = getComputedStyle(body);
      back.style.width = `${body.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)}px`;
      back.scrollTop = body.scrollTop;
    }

    function render() {
      const text = body.value;
      on = !body.readOnly && ANY_BOX.test(text);
      wrap.classList.toggle('boxes', on);
      if (!on) { back.replaceChildren(); body.classList.remove('over-box'); return; }
      const out = [];
      let plain = '';
      let at = 0;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        const p = CL.parseLine(line);
        if (!p) plain += line;
        else {
          plain += line.slice(0, p.boxStart);
          if (plain) out.push(document.createTextNode(plain));
          plain = '';
          out.push(h('span', { class: 'cb' + (p.checked ? ' on' : ''), dataset: { at: String(at) }, text: line.slice(p.boxStart, p.boxEnd) }));
          const rest = line.slice(p.boxEnd);
          if (p.checked && rest.trim()) out.push(h('span', { class: 'cb-done', text: rest })); else plain += rest;
        }
        if (i < lines.length - 1) plain += '\n';
        at += line.length + 1;
      });
      // a trailing space: a last empty line gets its height, as in the textarea
      out.push(document.createTextNode(plain + ' '));
      back.replaceChildren(...out);
      syncBox();
    }

    /** The box under the mouse (a few px of slack around it), or null. */
    function boxAtPoint(x, y) {
      if (!on) return null;
      for (const el of back.querySelectorAll('.cb')) {
        const r = el.getBoundingClientRect();
        const cx = (r.left + r.right) / 2;
        const cy = (r.top + r.bottom) / 2;
        if (Math.abs(x - cx) <= Math.max(10, r.width / 2 + 3) && Math.abs(y - cy) <= 10) return el;
      }
      return null;
    }

    body.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || body.readOnly || e.shiftKey || e.ctrlKey) return;
      const el = boxAtPoint(e.clientX, e.clientY);
      if (!el) return;
      e.preventDefault();   // the caret stays where it was
      const a = body.selectionStart;
      const b = body.selectionEnd;
      const at = Number(el.dataset.at);
      const r = CL.toggle(body.value, at);
      replaceRange(body, r.start, r.end, r.text);   // "[ ]" ↔ "[x]": same length, the caret doesn't move
      body.setSelectionRange(a, b);
    });
    body.addEventListener('mousemove', (e) => { if (on) body.classList.toggle('over-box', !!boxAtPoint(e.clientX, e.clientY)); });
    body.addEventListener('mouseleave', () => body.classList.remove('over-box'));
    body.addEventListener('scroll', () => { if (on) back.scrollTop = body.scrollTop; });
    new ResizeObserver(() => syncBox()).observe(body);
    return { render };
  })();

  // ------------------------------------------------ the note's reminder (see shared/reminder-time.js, main/reminders.js)
  const Remind = (() => {
    const host = document.getElementById('noteRemind');
    const box = document.getElementById('noteRemindBox');
    const line = document.getElementById('remindLine');
    const toggle = h('button', { class: 'btn btn-ghost btn-sm bar-btn', type: 'button', 'aria-label': 'Remind me', title: 'I remind you about this note at a time you pick', 'aria-expanded': 'false', 'aria-controls': 'noteRemindBox' }, icon('bell', 16), 'Remind me');
    host.replaceChildren(toggle);
    const dateIn = h('input', { class: 'input', type: 'date', 'aria-label': 'Date' });
    const timeIn = h('input', { class: 'input', type: 'time', 'aria-label': 'Time' });
    const err = h('p', { class: 'error-text nm-err', role: 'alert', hidden: true });

    async function set(at) {
      if (!current) return;
      err.hidden = true;
      try {
        await flush();
        const saved = await window.api.notes.setReminder(current.id, at);
        current.remind = saved && saved.remind ? saved.remind : undefined;
        if (!current.remind) delete current.remind;
        toast(at === null ? 'Reminder removed' : `Reminder set: ${RT.formatAt(at)}`);
        render();
        close();
        body.focus();
      } catch (e) { err.textContent = errText(e) || "Couldn't set it."; err.hidden = false; }
    }

    // the time is computed on click (the card can stay open for a long time)
    function chip(p, make) { return h('button', { class: 'chip-btn', type: 'button', onclick: () => set(make(Date.now()).find((x) => x.id === p.id).at) }, p.label); }

    function fillBox() {
      const r = current && current.remind;
      const now = Date.now();
      const status = r ? h('div', { class: 'nr-status' + (r.status === 'pending' ? '' : ' due') },
        icon('bell', 14), h('span', { text: r.status === 'pending' ? `Goes off ${remindText(r)}` : remindText(r).replace(/^./, (c) => c.toUpperCase()) }),
        h('button', { class: 'link-btn', type: 'button', onclick: () => set(null) }, r.status === 'pending' ? 'Remove' : 'Done')) : null;
      // F20: simple mode shows the quick chips; the date and time fields come with "Another day…"
      const another = h('button', { class: 'chip-btn simple-only another-day', type: 'button', onclick: () => {
        box.classList.add('show-adv');
        another.hidden = true;
        dateIn.focus();
      } }, 'Another day…');
      const quick = r && r.status !== 'pending'
        ? h('div', { class: 'nt-row' }, h('span', { class: 'nt-label', text: 'Snooze' }), h('div', { class: 'chip-row' }, ...RT.snoozes(now).map((p) => chip(p, RT.snoozes))))
        : h('div', { class: 'nt-row' }, h('span', { class: 'nt-label', text: 'Soon' }), h('div', { class: 'chip-row' }, ...RT.presets(now).map((p) => chip(p, RT.presets)), another));
      const base = r && r.status === 'pending' ? r.at : RT.roundMin(now + 60 * 60000);
      const v = RT.toInputs(base);
      dateIn.value = v.date;
      timeIn.value = v.time;
      dateIn.min = RT.toInputs(now).date;
      const form = h('form', { class: 'nr-custom' }, dateIn, timeIn, h('button', { class: 'btn btn-secondary btn-sm', type: 'submit' }, 'Set reminder'));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const at = RT.fromInputs(dateIn.value, timeIn.value);
        if (at === null) { err.textContent = "The date or time isn't valid."; err.hidden = false; return; }
        if (!RT.isValidAt(at)) { err.textContent = 'Pick a time in the future.'; err.hidden = false; return; }
        set(at);
      });
      err.hidden = true;
      box.replaceChildren(...[
        h('div', { class: 'nm-head' }, h('span', { class: 'nm-title' }, icon('bell', 15), 'When should I remind you?'),
          h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Close', onclick: () => { close(); body.focus(); } }, icon('close', 16))),
        status,
        quick,
        h('div', { class: 'nt-row' + (r && r.status !== 'pending' ? '' : ' adv') }, h('span', { class: 'nt-label', text: 'Other time' }), form),
        err,
        h('p', { class: 'nt-tip', text: "You get a notification and the buddy waves at you. If the app is closed then, you'll see it the next time it starts." })].filter(Boolean));
    }

    /** The line above the note + the bell color, based on the open note's reminder. */
    function render() {
      const r = current && current.remind;
      toggle.classList.toggle('on', !!r);
      toggle.title = r ? `Reminder: ${remindText(r)}` : 'I remind you about this note at a time you pick';
      line.hidden = !r;
      if (!r) { line.replaceChildren(); return; }
      line.classList.toggle('due', r.status !== 'pending');
      line.replaceChildren(...[
        h('button', { class: 'rl-main', type: 'button', onclick: () => open() }, icon('bell', 13), h('span', { title: `Reminder: ${remindText(r)}`, text: r.status === 'pending' ? `I'll remind you ${remindText(r)}` : r.status === 'fired' ? `Went off ${RT.formatAt(r.at)}` : `Missed: ${RT.formatAt(r.at)}` })),
        r.status !== 'pending' ? h('button', { class: 'link-btn', type: 'button', onclick: () => set(RT.snoozes(Date.now())[0].at) }, 'Snooze 10 min') : null,
        r.status !== 'pending' ? h('button', { class: 'link-btn', type: 'button', onclick: () => set(null) }, 'Done') : null].filter(Boolean));
      if (!box.hidden) fillBox();
    }

    function open() {
      if (!current) return;
      mailCtl.close();
      Tools.close();
      Clean.close();
      box.classList.remove('show-adv');
      fillBox();
      box.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
    }
    function close() {
      box.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
    toggle.addEventListener('click', () => (box.hidden ? open() : close()));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); body.focus(); } });
    return { open, close, render };
  })();

  // what closes when you leave the note / open another card
  const Extras = {
    reset() { Tools.close(); Clean.reset(); Remind.close(); },
    close() { Tools.close(); Clean.close(); Remind.close(); },
  };

  // a reminder went off / was missed (main process): the list and the open note update
  window.api.notes.onChanged(async (info) => {
    const fresh = await window.api.notes.list().catch(() => null);
    if (!fresh) return;
    const byId = new Map(fresh.map((n) => [n.id, n]));
    if (current && byId.has(current.id)) {
      const f = byId.get(current.id);
      if (f.remind) current.remind = f.remind; else delete current.remind;
      byId.set(current.id, current);   // the editor text stays local (it may not be saved yet)
    }
    notes = fresh.map((n) => byId.get(n.id));
    if (!editor.hidden) Remind.render(); else renderList();
    if (info && info.reason === 'fired' && Array.isArray(info.ids)) {
      const n = notes.find((x) => x.id === info.ids[0]);
      if (n) toast(`Reminder: ${titleOf(n.body)}`);
    }
  });

  // from the right-click menu (main process): transforms and "Clean up text…"
  window.api.text.onCommand((cmd) => {
    if (!cmd) return;
    const el = document.activeElement;
    if (cmd.type === 'transform') {
      if (el && el.tagName === 'TEXTAREA') transformText(cmd.kind, el);
    } else if (cmd.type === 'clean') {
      if (current && !editor.hidden) Clean.open(); else toast('"Clean up text" works in notes', 'error');
    }
  });

  document.getElementById('noteNew').addEventListener('click', async () => {
    const note = await window.api.notes.create();
    notes.unshift(note);
    open(note);
  });
  document.getElementById('noteBack').addEventListener('click', showList);
  // simple mode: "More" shows the text tools, the email button and the word count (not remembered)
  const noteMore = document.getElementById('noteMore');
  noteMore.addEventListener('click', () => { noteMore.setAttribute('aria-expanded', String(editor.classList.toggle('show-adv'))); });
  body.addEventListener('input', () => { Boxes.render(); scheduleSave(); Clean.onInput(); updateStats(); });
  for (const ev of ['select', 'keyup', 'mouseup', 'focus', 'blur']) body.addEventListener(ev, updateStats);
  body.addEventListener('blur', flush);
  search.addEventListener('input', renderList);
  body.addEventListener('keydown', (e) => {
    // Esc in the editor: first back to the list, don't close the panel
    if (e.key === 'Escape') { e.stopPropagation(); showList(); return; }
    if (e.key !== 'Enter' || e.altKey || e.metaKey || body.readOnly) return;
    if (e.ctrlKey && !e.shiftKey) { e.preventDefault(); toggleChecklist(); return; }
    // Enter in a checklist: the next line starts with "[ ] "; Enter on an empty "[ ] " ends the list
    if (e.ctrlKey || e.shiftKey || body.selectionStart !== body.selectionEnd) return;
    const r = CL.onEnter(body.value, body.selectionStart);
    if (!r) return;
    e.preventDefault();
    replaceRange(body, r.start, r.end, r.text);
    body.setSelectionRange(r.caret, r.caret);
  });

  window.NotesTab = {
    async init() { await refresh(); },
    onShow(opts = {}) {
      if (!current) refresh();
      if (!opts.keepFocus) (current ? body : search).focus();
    },
    onHide() { flush(); },
    isEditing() { return !!current; },
    closeEditor() { if (current) showList(); },
    /** Opens a note by id (from a reminder notification). */
    async openId(id) {
      flush();
      await refresh();
      const n = notes.find((x) => x.id === id);
      if (n) open(n); else showList();
    },
  };
})();
