'use strict';
// The Copied tab (clipboard history): search, pin, click = copy again, pause, delete.
(function () {
  const { h, icon, relTime, toast, confirmInline, moreButton } = window.UI;
  const list = document.getElementById('clipList');
  const empty = document.getElementById('clipEmpty');
  const search = document.getElementById('clipSearch');
  const toggle = document.getElementById('clipToggle');
  const count = document.getElementById('clipCount');
  const footActions = document.getElementById('clipFootActions');
  const hint = h('p', { class: 'list-hint', text: 'Click a row to copy it again.', hidden: true });
  list.before(hint);

  let items = [];
  let enabled = true;
  let max = 50;

  /** Highlights the search term by building nodes (no innerHTML). */
  function highlighted(text, q) {
    if (!q) return [text];
    const out = [];
    const low = text.toLowerCase();
    let i = 0;
    let j;
    while ((j = low.indexOf(q, i)) !== -1 && out.length < 40) {
      if (j > i) out.push(text.slice(i, j));
      out.push(h('mark', { text: text.slice(j, j + q.length) }));
      i = j + q.length;
    }
    out.push(text.slice(i));
    return out;
  }

  function preview(text) {
    // the first ~300 characters are enough for 2 lines; repeated spaces are collapsed
    return text.replace(/\s+/g, ' ').trim().slice(0, 300);
  }

  // F11: the chip says what a click does (not a status that reads like a label)
  function renderToggle() {
    toggle.replaceChildren(icon(enabled ? 'pause' : 'play', 14), enabled ? 'Pause' : 'Turn on');
    toggle.removeAttribute('aria-pressed');
    toggle.classList.toggle('paused', !enabled);
    toggle.title = enabled ? 'I save what you copy. Click to pause.' : "Paused: I'm not saving what you copy. Click to turn it on.";
  }

  function render() {
    renderToggle();
    const q = search.value.trim().toLowerCase();
    const shown = q ? items.filter((it) => it.text.toLowerCase().includes(q)) : items;
    list.replaceChildren(...shown.map((it) => {
      const text = preview(it.text);
      return h('li', {},
        h('div', { class: 'item' + (it.pinned ? ' pinned' : '') },
          h('button', {
            class: 'item-main', type: 'button', title: 'Click to copy again',
            'aria-label': `Copy: ${text.slice(0, 80)}`,
            onclick: async () => {
              try { await window.api.clipboard.copy(it.id); toast('Copied to clipboard'); }
              catch { toast("Couldn't copy", 'error'); }
            },
          },
            h('div', { class: 'item-text' }, ...highlighted(text, q)),
            h('div', { class: 'item-meta', text: `${relTime(it.createdAt)} · ${it.text.length.toLocaleString('en-GB')} ${it.text.length === 1 ? 'character' : 'characters'}${it.pinned ? ' · kept forever' : ''}` })),
          h('div', { class: 'item-actions' },
            h('button', {
              class: 'icon-btn', type: 'button', 'aria-pressed': String(it.pinned),
              'aria-label': it.pinned ? 'Stop keeping it forever' : 'Keep forever (never deleted by itself)', title: it.pinned ? 'Kept forever. Click to stop.' : 'Keep forever',
              onclick: () => window.api.clipboard.pin(it.id, !it.pinned).catch(() => toast("Couldn't keep the text", 'error')),
            }, icon('star', 16)),   // r2 F-L4: a star reads as "keep"; a pin did not
            h('button', {
              class: 'icon-btn', type: 'button', 'aria-label': 'Delete from the list', title: 'Delete',
              onclick: () => window.api.clipboard.remove(it.id).catch(() => toast("Couldn't delete the text", 'error')),
            }, icon('trash', 16)))));
    }));

    const none = shown.length === 0;
    list.hidden = none;
    empty.hidden = !none;
    if (none) {
      empty.replaceChildren(
        icon('clipboard', 28),
        h('strong', { text: q ? 'Nothing found' : 'Nothing copied yet' }),
        h('span', { text: q ? `No text contains "${search.value.trim()}".` : (enabled ? 'Copy some text anywhere (Ctrl+C) and it shows up here.' : 'Paused. Turn it on to save what you copy.') }),
      );
    }
    hint.hidden = none || items.length >= 5;
    const pinned = items.filter((i) => i.pinned).length;
    count.textContent = items.length
      ? `${items.length} ${items.length === 1 ? 'text' : 'texts'} kept (max ${max})${pinned ? ` · ${pinned} kept forever` : ''}`
      : '';
    footActions.hidden = !items.length;
  }

  // simple mode: "Clear list" sits behind "More" at the footer's right (the ones kept forever stay)
  const clearHost = h('span', { class: 'foot-actions adv' });
  footActions.replaceChildren(clearHost, moreButton(footActions));
  const clearCtl = confirmInline(clearHost, {
    label: 'Clear list',
    question: 'Clear the list? The ones kept forever stay.',
    onConfirm: async () => { await window.api.clipboard.clear(true); toast('List cleared'); },
  });

  toggle.addEventListener('click', async () => {
    const res = await window.api.settings.set({ clipboardEnabled: !enabled });
    enabled = res.settings.clipboardEnabled;
    toast(enabled ? "I'm saving what you copy again" : "Paused: I won't save what you copy");
    render();
  });
  search.addEventListener('input', render);
  window.api.clipboard.onChanged((next) => { items = next; render(); });

  window.ClipboardTab = {
    async init(settings) {
      enabled = settings.clipboardEnabled;
      max = settings.clipboardMax;
      items = await window.api.clipboard.list();
      render();
    },
    onSettings(settings) {
      enabled = settings.clipboardEnabled;
      max = settings.clipboardMax;
      render();
    },
    async onShow(opts = {}) {
      clearCtl.reset();
      if (footActions.classList.contains('show-adv')) footActions.querySelector('.more-toggle').click();   // "More" closes again
      // re-read the list on every open, so we don't depend only on change events
      try { items = await window.api.clipboard.list(); } catch { /* keep the current list */ }
      render(); // also refreshes "x min ago"
      if (!opts.keepFocus) search.focus();
    },
  };
})();
