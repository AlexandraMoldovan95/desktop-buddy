'use strict';
// The "Screenshots" gallery (1.12.0).
// One entry per picture: if it has an annotated copy ("… - annotated.png", or the old "… - adnotat.png"), the copy shows,
// with the ✎ sign, and the original isn't listed separately (main pairs them: capture.js → groupShots).
// Click = the large view (from there: Annotate, Copy…). Ctrl / Shift + click or the checkbox = select → Move to Recycle Bin (copy included).
// Drag a picture into Slack / Confluence / an email = the file goes (the annotated copy, if there is one).
// Drag pictures from the PC into the window or "Add pictures…" = converted to PNG here and copied into the Screenshots folder.
(function () {
  const { h, icon, hydrateIcons, toast } = window.UI;
  const $ = (id) => document.getElementById(id);
  const MAX_FILES = 30;
  const MAX_BYTES = 50 * 1024 * 1024;
  const MAX_SIDE = 12000;          // same limits as main (shot-image.js)
  const MAX_PIXELS = 50e6;
  const PAGE = 240;                // tiles drawn at once; "Show more" adds the next page (keeps the DOM small)
  let limit = PAGE;

  let all = [];
  let filter = 'all';
  let query = '';
  const selected = new Set();
  let lastClicked = null;
  let dragOut = { at: 0, name: '' };

  hydrateIcons();

  // ------------------------------------------------ simple / full mode (UX pass)
  const applyMode = (m) => document.body.classList.toggle('simple', m === 'simple');
  // an older main without 'ui:mode' rejects: the gallery stays in full mode (nothing hidden)
  window.gallery.uiMode().then(applyMode, (e) => console.warn('[gallery] ui mode unavailable:', e && e.message));
  window.gallery.onUiMode(applyMode);
  $('moreBtn').addEventListener('click', () => {
    const open = !document.body.classList.contains('show-adv');
    document.body.classList.toggle('show-adv', open);
    $('moreBtn').setAttribute('aria-expanded', String(open));
    $('moreBtn').textContent = open ? 'Less' : 'More';
  });
  const msgOf = (e, fallback) => String((e && e.message) || '').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '') || fallback;
  const COPIED = 'Copied! Now paste it with Ctrl+V in a chat or email.';

  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const last = (g) => Math.max(g.at, g.copy ? g.copy.at : 0);
  const two = (n) => String(n).padStart(2, '0');
  const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
  function dayLabel(key) {
    const today = dayKey(Date.now());
    const y = new Date(); y.setDate(y.getDate() - 1);
    if (key === today) return 'Today';
    if (key === dayKey(y.getTime())) return 'Yesterday';
    const [Y, M, D] = key.split('-').map(Number);
    const d = new Date(Y, M - 1, D);
    const s = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', ...(Y !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const timeOf = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const mb = (b) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

  function visible() {
    const q = norm(query.trim());
    return all.filter((g) => (filter === 'all' || g.copy) && (!q || norm(g.name).includes(q) || (g.copy && norm(g.copy.name).includes(q))));
  }

  // ------------------------------------------------ drawing
  function render() {
    const list = visible();
    $('count').textContent = all.length ? `· ${list.length === all.length ? all.length : `${list.length} of ${all.length}`}` : '';
    for (const n of [...selected]) if (!all.some((g) => g.name === n)) selected.delete(n);
    document.body.classList.toggle('selecting', selected.size > 0);
    $('selbar').hidden = selected.size === 0;
    $('selText').textContent = selected.size === 1 ? '1 picture selected' : `${selected.size} pictures selected`;
    resetTrash();
    if (!list.length) {
      $('main').replaceChildren(h('div', { class: 'g-empty' },
        h('strong', { text: all.length ? 'Nothing matches' : 'No pictures yet' }),
        all.length ? 'Change the search or the filter.' : 'Take a picture from the Pictures tab or with a right-click on the buddy. You can also drag pictures from your PC here.'));
      return;
    }
    const days = new Map();
    for (const g of list.slice(0, limit)) {
      const k = dayKey(last(g));
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(g);
    }
    const sections = [];
    for (const [k, items] of days) {
      sections.push(h('h2', { class: 'g-day' }, dayLabel(k), h('span', { text: ` · ${items.length}` })));
      sections.push(h('ul', { class: 'g-grid', role: 'list' }, ...items.map(tile)));
    }
    if (list.length > limit) {
      const more = h('button', { class: 'g-btn g-more', type: 'button' }, `Show more (${list.length - limit} left)`);
      more.addEventListener('click', () => { limit += PAGE; render(); });
      sections.push(more);
    }
    $('main').replaceChildren(...sections);
  }

  function tile(g) {
    const sel = selected.has(g.name);
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
    img.src = g.thumb;
    const title = `${g.name}${g.copy ? `\nWith drawing: ${g.copy.name}` : ''}\n${mb(g.copy ? g.copy.bytes : g.bytes)} · click = open · Ctrl+click = select · drag = into another app`;
    const li = h('li', { class: `g-tile${sel ? ' sel' : ''}`, draggable: 'true', dataset: { name: g.name } },
      h('button', { class: 'g-open', type: 'button', title, 'aria-label': `Open ${g.name}${g.copy ? ', with drawing' : ''}`, onclick: (e) => onTileClick(e, g) },
        h('span', { class: 'g-thumb' }, img, g.copy ? h('span', { class: 'g-badge', title: 'Showing the picture with your drawing; the clean picture is kept next to it' }, icon('pen', 12), 'with drawing', h('span', { class: 'g-plus', text: '+ clean picture' })) : null),
        h('span', { class: 'g-cap' }, h('span', { class: 'g-time', text: timeOf(last(g)) }), h('span', { class: 'g-name', text: g.name.replace(/\.png$/i, '') }))),
      h('button', { class: 'g-check adv', type: 'button', role: 'checkbox', 'aria-checked': String(sel), 'aria-label': `Select ${g.name}`, title: 'Select', onclick: () => toggle(g.name) }, sel ? icon('check', 14) : null),
      h('div', { class: 'g-acts' },
        act('pen', 'Draw on it', () => window.gallery.open(g.view, { annotate: true })),
        g.copy ? act('image', 'Open the clean picture (untouched)', () => window.gallery.open(g.name), true) : null,
        act('copy', 'Copy to send', async () => { await window.gallery.copy(g.view); toast(COPIED); }),
        act('folder', 'Show in folder', () => window.gallery.show(g.view), true)));
    li.addEventListener('dragstart', (e) => {
      // the main process provides the real file (startDrag); the page's own drag is cancelled
      e.preventDefault();
      dragOut = { at: Date.now(), name: g.copy ? g.copy.name : g.name };
      window.gallery.startDrag(g.name);
    });
    return li;
  }
  function act(ic, label, fn, adv = false) {
    // a failure says why (e.g. the file is gone) instead of a click that seems to do nothing
    return h('button', { class: adv ? 'g-act adv' : 'g-act', type: 'button', title: label, 'aria-label': label, onclick: (e) => { e.stopPropagation(); Promise.resolve(fn()).catch((err) => toast(`${label}: ${msgOf(err, 'that didn\'t work.')}`, 'error')); } }, icon(ic, 15));
  }

  // ------------------------------------------------ click and selection
  function onTileClick(e, g) {
    if (e.ctrlKey || e.metaKey || (e.shiftKey && lastClicked) || selected.size) {
      if (e.shiftKey && lastClicked) {
        const list = visible().map((x) => x.name);
        const a = list.indexOf(lastClicked);
        const b = list.indexOf(g.name);
        if (a >= 0 && b >= 0) for (const n of list.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(n);
      } else toggle(g.name, false);
      lastClicked = g.name;
      render();
      return;
    }
    lastClicked = g.name;
    window.gallery.open(g.view).catch(() => toast('This picture is not in its folder anymore', 'error'));
  }
  function toggle(name, draw = true) {
    if (selected.has(name)) selected.delete(name); else selected.add(name);
    lastClicked = name;
    if (draw) render();
  }
  $('selAll').addEventListener('click', () => { for (const g of visible()) selected.add(g.name); render(); });
  $('selClear').addEventListener('click', () => { selected.clear(); render(); });

  let askTimer = 0;
  function resetTrash() {
    clearTimeout(askTimer);
    const b = $('selTrash');
    b.hidden = false;
    b.classList.remove('asking');
    b.replaceChildren(icon('trash', 16), 'Move to Recycle Bin');
    $('selTrashCopies').hidden = true;
    $('selTrashAll').hidden = true;
  }
  async function trashSelected() {
    if (!selected.size) return;
    const b = $('selTrash');
    const withCopies = all.filter((g) => selected.has(g.name) && g.copy).length;
    if (b.hidden) { $('selTrashCopies').focus(); return; }   // the choice is already on screen: nothing is deleted without a click on it
    if (!b.classList.contains('asking')) {
      if (withCopies) {
        // 1.14.0: some of them are annotated → you choose whether the originals stay
        b.hidden = true;
        $('selTrashCopies').hidden = false;
        $('selTrashAll').hidden = false;
        $('selTrashAll').textContent = withCopies === 1 ? 'Delete both' : 'Delete all, clean ones too';
        $('selTrashCopies').textContent = withCopies === 1 ? 'Delete, keep the clean picture' : 'Delete, keep the clean pictures';
        $('selTrashCopies').title = `${withCopies === 1 ? 'Only the picture with the drawing goes' : `Only the ${withCopies} pictures with drawings go`}; the clean pictures stay. Pictures without a drawing go to the Recycle Bin.`;
        askTimer = setTimeout(resetTrash, 8000);
        $('selTrashCopies').focus();
        return;
      }
      b.classList.add('asking');
      b.replaceChildren(`Sure? Move ${selected.size === 1 ? 'it' : selected.size} to Recycle Bin`);
      askTimer = setTimeout(resetTrash, 4000);
      b.focus();
      return;
    }
    await doTrash('all');
  }
  async function doTrash(mode) {
    const names = [...selected];
    resetTrash();
    try {
      const r = await window.gallery.trash(names, mode);
      const n = r.moved;
      selected.clear();
      for (const f of r.failed) selected.add(f);   // what is left stays selected
      if (r.failed.length) toast(`${n ? `${n} moved to the Recycle Bin. ` : ''}${r.failed.length === 1 ? 'One picture couldn\'t be moved' : `${r.failed.length} pictures couldn't be moved`}. ${r.error}`, 'error');
      else toast(n === 1 ? '1 picture moved to the Recycle Bin' : `${n} pictures moved to the Recycle Bin`);
    } catch { toast('Couldn\'t move them to the Recycle Bin', 'error'); }
    await refresh();
  }
  $('selTrash').addEventListener('click', trashSelected);
  $('selTrashCopies').addEventListener('click', () => doTrash('copies'));
  $('selTrashAll').addEventListener('click', () => doTrash('all'));

  // ------------------------------------------------ filters and search
  function setFilter(f) {
    filter = f;
    $('fAll').setAttribute('aria-pressed', String(f === 'all'));
    $('fAnnot').setAttribute('aria-pressed', String(f === 'annot'));
    render();
  }
  $('fAll').addEventListener('click', () => setFilter('all'));
  $('fAnnot').addEventListener('click', () => setFilter('annot'));
  let qTimer = 0;
  $('search').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { query = $('search').value; render(); }, 120); });
  $('folderBtn').addEventListener('click', () => window.gallery.openFolder());

  // ------------------------------------------------ pictures from the PC (only ones you pick: drag into the window or "Add pictures…")
  async function toPng(file) {
    if (file.type === 'image/png') return file.arrayBuffer();   // a PNG goes unchanged
    const bmp = await createImageBitmap(file);
    try {
      if (bmp.width > MAX_SIDE || bmp.height > MAX_SIDE || bmp.width * bmp.height > MAX_PIXELS) throw new Error('too big');
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d').drawImage(bmp, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      if (!blob) throw new Error('conversion');
      return blob.arrayBuffer();
    } finally { bmp.close(); }
  }
  async function importFiles(files) {
    const list = [...files];
    const imgs = list.filter((f) => /^image\/(png|jpeg|webp|gif|bmp)$/.test(f.type));
    if (!imgs.length) { toast('Pictures only: PNG, JPG, WebP, GIF or BMP', 'error'); return; }
    if (imgs.length > MAX_FILES) { toast(`At most ${MAX_FILES} pictures at once`, 'error'); return; }
    let ok = 0;
    const bad = [];
    let big = 0;
    toast(imgs.length === 1 ? 'Adding the picture…' : `Adding ${imgs.length} pictures…`);
    for (const f of imgs) {
      try {
        if (f.size > MAX_BYTES) throw new Error('too big');
        await window.gallery.importPng(f.name, await toPng(f));
        ok += 1;
      } catch (e) {
        // "too big" can also come from main (shot-image.js TOO_BIG_MSG); the Romanian form is accepted until main is translated
        if (/too (big|large)|prea mare/i.test(String(e && e.message))) big += 1; else bad.push(f.name);
      }
    }
    const skipped = list.length - imgs.length;
    if (bad.length || skipped || big) toast(`${ok} added${big ? `, ${big} too big (at most ${MAX_SIDE} px per side, 50 megapixels)` : ''}${bad.length ? `, ${bad.length} couldn't be read` : ''}${skipped ? `, ${skipped} ${skipped === 1 ? 'wasn\'t a picture' : 'weren\'t pictures'}` : ''}`, bad.length || big ? 'error' : 'ok');
    else toast(ok === 1 ? 'The picture is in the gallery' : `${ok} pictures added to the gallery`);
    await refresh();
  }
  $('addBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', () => { const f = $('fileInput').files; if (f && f.length) importFiles(f); $('fileInput').value = ''; });

  const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth += 1; $('drop').hidden = false; });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('drop').hidden = true; });
  window.addEventListener('drop', (e) => {
    e.preventDefault();   // otherwise Chromium would open the file in the window
    dragDepth = 0;
    $('drop').hidden = true;
    const files = e.dataTransfer ? [...e.dataTransfer.files] : [];
    // a picture dragged out of the gallery and dropped back here isn't duplicated
    if (files.length && Date.now() - dragOut.at < 60000 && files.every((f) => f.name === dragOut.name)) return;
    if (files.length) importFiles(files);
  });

  // ------------------------------------------------ keyboard
  window.addEventListener('keydown', (e) => {
    const inSearch = e.target === $('search');
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); $('search').focus(); $('search').select(); return; }
    if (inSearch) { if (e.key === 'Escape') { $('search').value = ''; query = ''; render(); $('main').focus(); } return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); for (const g of visible()) selected.add(g.name); render(); return; }
    if (e.key === 'Delete' && selected.size) { e.preventDefault(); trashSelected(); return; }
    if (e.key === 'Escape' && selected.size) { selected.clear(); render(); }
  });

  // ------------------------------------------------ data
  async function refresh() {
    try { all = await window.gallery.list(); } catch { all = []; }
    render();
  }
  // changes come in bursts (trash, imports): one refresh after they settle
  let refreshTimer = 0;
  window.gallery.onChanged(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 200); });
  refresh();
})();
