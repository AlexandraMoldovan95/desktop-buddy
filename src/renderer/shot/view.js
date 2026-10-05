'use strict';
// Large screenshot (1.10.0) + annotations (1.11.0).
//
// Zoom: 1 = one picture pixel per screen pixel (100 %), from 5 % to 800 %; above 200 % pixels show crisply.
// Annotations (drawing, shapes, text, bubbles with a tail, notes, numbered steps, blur, crop) are drawn on a canvas
// the size of the picture, with the same function as the saved picture (annot-render.js). The document saves itself (editable);
// "Save copy" writes "<name> - annotated.png" next to the original (main names it: shared/annotations.js).
(function () {
  const { hydrateIcons, icon } = window.UI;
  const A = window.Annot;
  const R = window.AnnotRender;
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const layer = $('layer');
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  const dpr = () => window.devicePixelRatio || 1;
  const emptyDoc = () => ({ version: 1, crop: null, output: null, items: [] });
  const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

  // basic: shown in simple mode (with its short name under the icon); the rest sit behind "More"
  const TOOLS = [
    { id: 'select', icon: 'pointer', key: 'v', name: 'Select', label: 'Select and move (V)' },
    { id: 'pen', icon: 'pen', key: 'p', name: 'Pen', label: 'Pen: free drawing (P)', basic: true },
    { id: 'marker', icon: 'marker', key: 'h', name: 'Marker', label: 'Highlighter (H)' },
    { id: 'arrow', icon: 'arrow', key: 'a', name: 'Arrow', label: 'Arrow (A)', basic: true },
    { id: 'line', icon: 'line', key: 'l', name: 'Line', label: 'Line (L)' },
    { id: 'rect', icon: 'square', key: 'r', name: 'Box', label: 'Rectangle (R)', basic: true },
    { id: 'ellipse', icon: 'circle', key: 'e', name: 'Circle', label: 'Ellipse (E)' },
    { id: 'text', icon: 'type', key: 't', name: 'Text', label: 'Text (T)', basic: true },
    { id: 'bubble', icon: 'bubble', key: 'b', name: 'Bubble', label: 'Speech bubble: click what you comment on (B)' },
    { id: 'note', icon: 'sticky', key: 'n', name: 'Note', label: 'Sticky note (N)' },
    { id: 'step', icon: 'step', key: 's', name: 'Steps', label: 'Numbered step 1, 2, 3… (S)' },
    { id: 'blur', icon: 'pixels', key: 'x', name: 'Blur', label: 'Blur: hide private data (X)', basic: true },
    { id: 'crop', icon: 'crop', key: 'c', name: 'Crop', label: 'Crop (C)' },
  ];
  const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Black', 'White'];
  const BASIC_COLORS = ['Red', 'Yellow', 'Green', 'Blue', 'Black'];
  const SIZES = [['s', 'Thin'], ['m', 'Medium'], ['l', 'Thick']];
  const TEXTY = ['text', 'bubble', 'note'];

  const S = {
    info: null, img: null, W: 0, H: 0, zoom: 1, fit: true,
    annot: false, source: null, doc: emptyDoc(),
    tool: 'select', color: A.COLORS[0], size: 'm',
    sel: null, draft: null, drag: null, edit: null,
    undo: [], redo: [], dirty: false, saveTimer: 0, allowClose: false, space: false,
  };

  hydrateIcons();

  // ------------------------------------------------ simple / full mode (UX pass)
  let simple = false;
  function applyMode(m) {
    simple = m === 'simple';
    document.body.classList.toggle('simple', simple);
    showPair();
    if (S.annot) setStatus(S.dirty ? dirtyText() : idleStatus(), S.dirty);
  }
  // an older main without 'ui:mode' rejects: the view stays in full mode (nothing hidden)
  const modeReady = window.shotView.uiMode().then(applyMode, (e) => console.warn('[view] ui mode unavailable:', e && e.message));
  window.shotView.onUiMode(applyMode);
  // "More": each bar reveals its own advanced controls; not remembered
  function setMore(btn, box, open) {
    box.classList.toggle('show-adv', open);
    btn.setAttribute('aria-expanded', String(open));
    btn.textContent = open ? 'Less' : 'More';
  }
  $('barMore').addEventListener('click', () => setMore($('barMore'), document.querySelector('.v-bar'), !document.querySelector('.v-bar').classList.contains('show-adv')));
  $('toolsMore').addEventListener('click', () => setMore($('toolsMore'), $('abar'), !$('abar').classList.contains('show-adv')));
  const dirtyText = () => (simple ? 'Press Done to save' : 'You have unsaved drawings');
  const idleStatus = () => (S.doc.output ? `Saved as: ${S.doc.output}` : 'The clean picture stays untouched');

  // ------------------------------------------------ drawing
  let raf = 0;
  function render() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!S.img) return;
      R.drawDoc(ctx, S.annot ? S.doc : emptyDoc(), S.img, {
        selectedId: S.annot ? S.sel : null,
        editingId: S.edit && S.edit.id,
        zoom: cssScale(),   // handles always have the same size on screen
        showCrop: S.annot,
        cropHandles: S.tool === 'crop',
        draft: S.draft,
      });
    });
  }
  const cssScale = () => (S.W ? layer.getBoundingClientRect().width / S.W : 1);   // CSS pixels per picture pixel

  // ------------------------------------------------ zoom
  function fitValue() {
    return A.fitZoom(S.W, S.H, Math.max(50, stage.clientWidth - 32) * dpr(), Math.max(50, stage.clientHeight - 32) * dpr());
  }
  function setZoom(z, ax, ay, fit = false) {
    if (!S.W) return;
    commitEdit();
    const sr = stage.getBoundingClientRect();
    const cx = ax == null ? sr.left + stage.clientWidth / 2 : ax;
    const cy = ay == null ? sr.top + stage.clientHeight / 2 : ay;
    const b = layer.getBoundingClientRect();
    const fx = b.width ? (cx - b.left) / b.width : 0.5;
    const fy = b.height ? (cy - b.top) / b.height : 0.5;
    S.zoom = A.clampZoom(z);
    S.fit = fit;
    // size through CSSOM (the CSP doesn't allow the style attribute)
    layer.style.width = `${(S.W * S.zoom) / dpr()}px`;
    layer.style.height = `${(S.H * S.zoom) / dpr()}px`;
    cv.classList.toggle('pixelated', S.zoom >= 2);
    const a = layer.getBoundingClientRect();
    stage.scrollLeft += a.left + fx * a.width - cx;
    stage.scrollTop += a.top + fy * a.height - cy;
    $('zoomLabel').textContent = `${Math.round(S.zoom * 100)} %`;
    $('zoomOut').disabled = S.zoom <= A.ZOOM_MIN + 1e-6;
    $('zoomIn').disabled = S.zoom >= A.ZOOM_MAX - 1e-6;
    render();
  }
  const zoomFit = () => setZoom(fitValue(), null, null, true);
  $('zoomIn').addEventListener('click', () => setZoom(A.stepZoom(S.zoom, 1)));
  $('zoomOut').addEventListener('click', () => setZoom(A.stepZoom(S.zoom, -1)));
  $('zoomLabel').addEventListener('click', () => (Math.abs(S.zoom - 1) < 1e-6 ? zoomFit() : setZoom(1)));
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;   // without Ctrl: normal scrolling (Shift = horizontal)
    e.preventDefault();
    setZoom(S.zoom * Math.exp(-e.deltaY * 0.0018), e.clientX, e.clientY);
  }, { passive: false });
  window.addEventListener('resize', () => { if (S.fit) zoomFit(); else render(); });

  // ------------------------------------------------ loading
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';   // buddy-media sends CORS: the canvas stays "clean" and can be saved
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('The picture couldn\'t be opened.'));
      img.src = url;
    });
  }
  function useImage(img) {
    S.img = img;
    S.W = img.naturalWidth;
    S.H = img.naturalHeight;
    cv.width = S.W;
    cv.height = S.H;
  }
  function showMeta(name, bytes) {
    $('name').textContent = name;
    $('name').title = name;
    $('meta').textContent = `${S.W} × ${S.H} px${bytes ? ` · ${kb(bytes)}` : ''}`;
    document.title = `${name} – Desktop Buddy`;
  }

  async function load() {
    $('err').hidden = true;
    commitEdit();
    await flushSave();
    leaveAnnotUi();
    resetTrash();
    resetCopy();
    setMore($('barMore'), document.querySelector('.v-bar'), false);
    await modeReady;
    try { S.info = await window.shotView.viewInfo(); } catch { S.info = null; }
    if (!S.info) { fail('This picture is not in its folder anymore.'); return; }
    // over the size limit: show the small preview instead of decoding a huge picture
    try { useImage(await loadImage(S.info.preview || S.info.url)); } catch (e) { fail(S.info.preview ? 'The picture is too big to open here. Open it from the folder.' : e.message); return; }
    showMeta(S.info.name, S.info.bytes);
    if (S.info.preview) hint('The picture is very big: this is a preview. For details, open it from the folder.', 6000);
    showPair();
    zoomFit();
    if (S.info.annotate) await enterAnnot();
  }
  function fail(msg) { $('err').textContent = msg; $('err').hidden = false; }

  // ------------------------------------------------ annotation mode
  async function enterAnnot() {
    let r;
    try { r = await window.shotView.annot.open(); } catch (e) { hint(msgOf(e, 'Drawing couldn\'t start.'), 5000); return; }
    if (r.source !== S.info.name) {
      // it's an annotated copy (main decides, either suffix): the annotations belong to the original (you can change them any time; the copy is rewritten on Save)
      try { useImage(await loadImage(r.url)); } catch (e) { fail(e.message); return; }
      showMeta(r.source, 0);
      hint(simple ? 'You can change your drawing. Press Done when you finish.' : `You are drawing on the clean picture ("${r.source}"); the picture with your drawing updates when you save.`, 6000);
    }
    S.source = r.source;
    S.doc = r.doc ? r.doc : emptyDoc();
    S.annot = true;
    S.undo = [];
    S.redo = [];
    S.sel = null;
    S.dirty = false;
    leaveAsked = false;
    $('abar').hidden = false;
    setMore($('toolsMore'), $('abar'), false);
    document.body.classList.add('annotating');
    setAnnotBtn(true);
    // simple mode has no visible Select tool: start with the arrow
    setTool(S.doc.items.length && !simple ? 'select' : 'arrow');
    updateBar();
    setStatus(idleStatus());
    if (r.source === S.info.name) hint(simple ? 'Pick a tool and draw on the picture. Press Done when you finish.' : 'Right-click a drawing to change its color or size, or delete it. Ctrl+Z undoes.', 5000);
    requestAnimationFrame(() => (S.fit ? zoomFit() : render()));
  }
  function leaveAnnotUi() {
    S.annot = false;
    S.sel = null;
    S.draft = null;
    S.source = null;
    $('abar').hidden = true;
    document.body.classList.remove('annotating');
    setAnnotBtn(false);
    stageCursor();
  }
  // the toggle reads "Draw on it", and "Done" while drawing
  function setAnnotBtn(on) {
    const b = $('annotBtn');
    b.setAttribute('aria-pressed', String(on));
    b.replaceChildren(icon(on ? 'check' : 'pen', 16), Object.assign(document.createElement('span'), { textContent: on ? 'Done' : 'Draw on it' }));
    b.title = on ? 'Finish drawing' : 'Draw arrows, boxes or text on the picture';
  }
  async function exitAnnot() {
    commitEdit();
    await flushSave();
    const viewed = S.info && S.info.name;
    const wasOther = S.source && S.source !== viewed;
    leaveAnnotUi();
    // 1.14.0: after "Save copy" the pair may now exist (the new copy) → the Annotated | Original switch
    try { const i = await window.shotView.viewInfo(); if (i && i.name === viewed) S.info = { ...S.info, pair: i.pair, bytes: i.bytes }; } catch { /* keep what we had */ }
    showPair();
    // simple mode shows the picture with the drawing once it exists (the clean one is a link away)
    if (simple && S.info && S.info.pair && S.info.name !== S.info.pair.copy) { openPair('copy'); return; }
    if (wasOther) {   // back to the opened picture (the copy, maybe rewritten: a new URL, so it doesn't come from the cache)
      try { useImage(await loadImage(`${S.info.url}?t=${Date.now()}`)); showMeta(S.info.name, S.info.bytes); } catch { /* the original stays on screen */ }
    }
    S.fit ? zoomFit() : render();
  }
  $('annotBtn').addEventListener('click', () => (S.annot ? confirmLeave(exitAnnot) : enterAnnot()));

  function buildBar() {
    $('tools').replaceChildren(...TOOLS.map((t) => {
      const b = document.createElement('button');
      b.className = t.basic ? 'a-tool' : 'a-tool adv';
      b.type = 'button';
      b.title = t.label;
      b.setAttribute('aria-label', t.label);
      b.dataset.tool = t.id;
      b.append(icon(t.icon, 18), Object.assign(document.createElement('span'), { className: 'a-lab', textContent: t.name }));
      b.addEventListener('click', () => setTool(t.id));
      return b;
    }));
    $('colors').replaceChildren(...A.COLORS.map((c, i) => {
      const b = document.createElement('button');
      b.className = BASIC_COLORS.includes(COLOR_NAMES[i]) ? 'a-swatch' : 'a-swatch adv';
      b.type = 'button';
      b.title = COLOR_NAMES[i];
      b.setAttribute('aria-label', COLOR_NAMES[i]);
      b.dataset.color = c;
      b.style.background = c;   // CSSOM
      b.addEventListener('click', () => setColor(c));
      return b;
    }));
    $('sizes').replaceChildren(...SIZES.map(([k, t]) => {
      const b = document.createElement('button');
      b.className = 'a-size';
      b.type = 'button';
      b.textContent = t;
      b.dataset.size = k;
      b.addEventListener('click', () => setSize(k));
      return b;
    }));
  }
  buildBar();

  function updateBar() {
    document.querySelectorAll('.a-tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === S.tool)));
    document.querySelectorAll('.a-swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === S.color)));
    document.querySelectorAll('.a-size').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === S.size)));
    $('undoBtn').disabled = !S.undo.length;
    $('redoBtn').disabled = !S.redo.length;
    $('delBtn').disabled = !S.sel;
    $('delBtn').classList.toggle('has-sel', !!S.sel);   // F-M8: simple mode shows "Remove drawing" only with a selection
    $('cropClear').hidden = !S.doc.crop;
  }
  function setTool(t) {
    commitEdit();
    S.tool = t;
    if (t !== 'select') S.sel = null;
    updateBar();
    stageCursor();
    render();
  }
  function stageCursor(over = false) {
    stage.classList.remove('pan', 'draw', 'texting', 'select', 'over');
    if (!S.annot || S.space) stage.classList.add('pan');
    else if (S.tool === 'select') stage.classList.add('select', ...(over ? ['over'] : []));
    else if (TEXTY.includes(S.tool)) stage.classList.add('texting');
    else stage.classList.add('draw');
  }

  const selItem = () => S.doc.items.find((i) => i.id === S.sel) || null;
  function setColor(c) {
    S.color = c;
    const it = selItem();
    if (it && it.type !== 'blur') change(() => { it.color = c; });
    updateBar();
  }
  function setSize(k) {
    S.size = k;
    const it = selItem();
    if (it) {
      const d = A.defaults(it.type, S.W, S.H, k);
      change(() => {
        if (d.width != null && it.width != null) it.width = d.width;
        if (d.size != null) it.size = d.size;
        if (d.r != null) it.r = d.r;
      });
    }
    updateBar();
  }

  // ------------------------------------------------ history (Ctrl+Z / Ctrl+Y) and saving
  const snap = () => JSON.stringify(S.doc);
  function pushUndo(s = snap()) {
    S.undo.push(s);
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
  }
  function changed() {
    S.dirty = true;
    setStatus(dirtyText(), true);
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, 700);
    updateBar();
    render();
  }
  function change(fn) { pushUndo(); fn(); changed(); }
  function undo() {
    commitEdit();
    if (!S.undo.length) return;
    S.redo.push(snap());
    S.doc = JSON.parse(S.undo.pop());
    if (!selItem()) S.sel = null;
    changed();
  }
  function redo() {
    commitEdit();
    if (!S.redo.length) return;
    S.undo.push(snap());
    S.doc = JSON.parse(S.redo.pop());
    if (!selItem()) S.sel = null;
    changed();
  }
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  function deleteSelected() {
    if (!S.sel) return;
    change(() => { S.doc.items = S.doc.items.filter((i) => i.id !== S.sel); });
    S.sel = null;
    updateBar();
  }
  $('delBtn').addEventListener('click', deleteSelected);
  $('cropClear').addEventListener('click', () => change(() => { S.doc.crop = null; }));

  // the message of an IPC error, without Electron's "Error invoking remote method…" prefix
  const msgOf = (e, fallback) => String((e && e.message) || '').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '') || fallback;

  let saving = null;   // the autosave in flight, so "Save copy" waits for it
  async function flushSave() {
    clearTimeout(S.saveTimer);
    S.saveTimer = 0;
    if (!S.annot || !S.source) return;
    const run = (saving || Promise.resolve()).then(() => window.shotView.annot.save(S.source, S.doc))
      .catch((e) => setStatus(msgOf(e, 'Your drawing wasn\'t saved'), true));
    saving = run;
    await run;
    if (saving === run) saving = null;
  }

  let copying = false;
  async function saveCopy() {
    if (!S.annot || copying) return false;   // Ctrl+S pressed again while saving
    commitEdit();
    if (A.isEmptyDoc(S.doc)) { hint('There is no drawing to save yet.', 2500); return false; }
    copying = true;
    $('saveBtn').disabled = true;
    clearTimeout(S.saveTimer);   // the export saves the document too
    S.saveTimer = 0;
    try {
      if (saving) await saving;
      const png = await R.renderPng(S.doc, S.img);
      const r = await window.shotView.annot.exportPng(S.source, png, S.doc);
      S.doc.output = r.name;
      S.dirty = false;
      setStatus(`Saved as: ${r.name}`);
      return true;
    } catch (e) {
      setStatus(msgOf(e, 'The picture with your drawing wasn\'t saved'), true);
      return false;
    } finally {
      copying = false;
      $('saveBtn').disabled = false;
    }
  }
  $('saveBtn').addEventListener('click', saveCopy);

  function setStatus(t, warn = false) { $('status').textContent = t; $('status').classList.toggle('warn', warn); $('status').title = t; }
  let hintTimer = 0;
  function hint(t, ms = 3000) {
    $('hint').textContent = t;
    $('hint').hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { $('hint').hidden = true; }, ms);
  }

  // ------------------------------------------------ coordinates
  function toImg(e) {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * S.W) / r.width, y: ((e.clientY - r.top) * S.H) / r.height };
  }
  const tol = () => 7 / cssScale();   // 7 px on screen, in picture pixels

  // ------------------------------------------------ mouse
  stage.addEventListener('pointerdown', (e) => {
    if (!S.img || e.target.classList.contains('a-edit')) return;
    const pan = e.button === 1 || (e.button === 0 && (!S.annot || S.space));
    if (pan) {
      e.preventDefault();
      S.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
      stage.classList.add('panning');
      stage.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 || !S.annot) return;
    if (S.edit) { commitEdit(); if (S.tool !== 'select') return; }   // the first click only finishes the text
    const p = toImg(e);
    stage.setPointerCapture(e.pointerId);
    e.preventDefault();
    const base = { id: A.newId(), color: S.color, ...A.defaults(S.tool, S.W, S.H, S.size) };
    // with any tool: the selected item's handles (e.g. one just drawn) can be dragged right away
    if (S.tool !== 'select' && S.tool !== 'crop' && selItem()) {
      const hd0 = A.handlesOf(selItem()).find((h) => Math.hypot(h.x - p.x, h.y - p.y) <= tol() * 1.4);
      if (hd0) { S.drag = { kind: 'handle', key: hd0.key, before: snap(), moved: false }; return; }
    }
    switch (S.tool) {
      case 'select': {
        const it = selItem();
        const hd = it && A.handlesOf(it).find((h) => Math.hypot(h.x - p.x, h.y - p.y) <= tol() * 1.4);
        if (hd) { S.drag = { kind: 'handle', key: hd.key, before: snap(), moved: false }; return; }
        const i = A.hitTest(S.doc.items, p.x, p.y, tol());
        S.sel = i >= 0 ? S.doc.items[i].id : null;
        updateBar();
        render();
        if (i >= 0) S.drag = { kind: 'move', last: p, before: snap(), moved: false };
        return;
      }
      case 'pen': case 'marker':
        S.draft = { ...base, type: S.tool, points: [[p.x, p.y]] };
        break;
      case 'line': case 'arrow':
        S.draft = { ...base, type: S.tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        break;
      case 'rect': case 'ellipse': case 'blur': case 'note':
        S.draft = { ...base, type: S.tool, x: p.x, y: p.y, w: 1, h: 1, text: '' };
        break;
      case 'bubble':
        S.draft = { ...base, type: 'bubble', x: p.x, y: p.y, w: 1, h: 1, tx: p.x, ty: p.y, text: '' };
        break;
      case 'crop': {
        const c = S.doc.crop;
        const corners = c ? [['nw', c.x, c.y], ['ne', c.x + c.w, c.y], ['sw', c.x, c.y + c.h], ['se', c.x + c.w, c.y + c.h]] : [];
        const hd = corners.find(([, x, y]) => Math.hypot(x - p.x, y - p.y) <= tol() * 1.6);
        if (hd) { S.drag = { kind: 'crop-handle', key: hd[0], before: snap(), moved: false }; return; }
        if (c && p.x > c.x && p.x < c.x + c.w && p.y > c.y && p.y < c.y + c.h) { S.drag = { kind: 'crop-move', last: p, before: snap(), moved: false }; return; }
        S.draft = { id: 'crop', type: 'crop', x: p.x, y: p.y, w: 0, h: 0 };
        break;
      }
      case 'text': {
        const i = A.hitTest(S.doc.items, p.x, p.y, tol());
        if (i >= 0 && TEXTY.includes(S.doc.items[i].type)) { openEdit(S.doc.items[i], false); return; }
        const it = { ...base, type: 'text', x: p.x, y: p.y - base.size * 0.65, text: '' };
        pushUndo();
        S.doc.items.push(it);
        openEdit(it, true);
        return;
      }
      case 'step': {
        change(() => S.doc.items.push({ ...base, type: 'step', x: p.x, y: p.y }));
        S.sel = base.id;
        return;
      }
      default: return;
    }
    S.drag = { kind: 'create', start: p, moved: false };
    render();
  });

  stage.addEventListener('pointermove', (e) => {
    const d = S.drag;
    if (!d) {
      if (S.annot && S.tool === 'select' && S.img) {
        const p = toImg(e);
        stageCursor(A.hitTest(S.doc.items, p.x, p.y, tol()) >= 0);
      }
      return;
    }
    if (d.kind === 'pan') {
      stage.scrollLeft = d.sl - (e.clientX - d.sx);
      stage.scrollTop = d.st - (e.clientY - d.sy);
      return;
    }
    const p = toImg(e);
    const it = selItem();
    if (d.kind === 'move' && it) {
      const dx = p.x - d.last.x;
      const dy = p.y - d.last.y;
      if (!d.moved && Math.hypot(dx, dy) < tol() / 3) return;
      d.moved = true;
      Object.assign(it, A.moveItem(it, dx, dy));
      d.last = p;
    } else if (d.kind === 'handle' && it) {
      d.moved = true;
      Object.assign(it, A.dragHandle(it, d.key, p.x, p.y, 6));
    } else if (d.kind === 'crop-handle' && S.doc.crop) {
      d.moved = true;
      const c = A.dragHandle({ ...S.doc.crop }, d.key, p.x, p.y, 8);
      S.doc.crop = { x: c.x, y: c.y, w: c.w, h: c.h };
    } else if (d.kind === 'crop-move' && S.doc.crop) {
      d.moved = true;
      const c = S.doc.crop;
      c.x = Math.min(Math.max(0, c.x + p.x - d.last.x), S.W - c.w);
      c.y = Math.min(Math.max(0, c.y + p.y - d.last.y), S.H - c.h);
      d.last = p;
    } else if (d.kind === 'create' && S.draft) {
      const s = d.start;
      if (Math.hypot(p.x - s.x, p.y - s.y) > tol() / 2) d.moved = true;
      const t = S.draft;
      if (t.type === 'pen' || t.type === 'marker') {
        // Shift = a straight line from the last point (like in Paint)
        t.points.push([p.x, p.y]);
      } else if (t.type === 'line' || t.type === 'arrow') {
        let { x, y } = p;
        if (e.shiftKey) {   // at 0°, 45°, 90°…
          const ang = Math.round(Math.atan2(y - s.y, x - s.x) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(x - s.x, y - s.y);
          x = s.x + Math.cos(ang) * len;
          y = s.y + Math.sin(ang) * len;
        }
        t.x2 = x; t.y2 = y;
      } else if (t.type === 'bubble') {
        // drag from the commented item (the tail tip) to where the bubble goes
        if (t.w < 2) { const d0 = A.defaults('bubble', S.W, S.H, S.size); t.w = d0.w; t.h = d0.h; }
        t.x = p.x - t.w / 2; t.y = p.y - t.h / 2;
      } else {
        let w = p.x - s.x;
        let h = p.y - s.y;
        if (e.shiftKey && t.type !== 'crop') { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        t.x = Math.min(s.x, s.x + w); t.y = Math.min(s.y, s.y + h); t.w = Math.abs(w); t.h = Math.abs(h);
      }
    }
    render();
  });

  function endDrag(e) {
    const d = S.drag;
    if (!d) return;
    S.drag = null;
    try { stage.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    stage.classList.remove('panning');
    if (d.kind === 'pan') return;
    if (['move', 'handle', 'crop-handle', 'crop-move'].includes(d.kind)) {
      if (d.moved) { pushUndo(d.before); if (S.doc.crop) S.doc.crop = A.normalizeCrop(S.doc.crop, S.W, S.H); changed(); }
      return;
    }
    if (d.kind !== 'create' || !S.draft) return;
    const t = S.draft;
    S.draft = null;
    const k = A.scaleK(S.W, S.H);
    if (t.type === 'crop') {
      const c = A.normalizeCrop(t, S.W, S.H);
      if (c) change(() => { S.doc.crop = c; });
      else render();
      return;
    }
    if (t.type === 'bubble' && !d.moved) {   // a click: the tail tip here, the bubble above-right (inside the picture)
      const d0 = A.defaults('bubble', S.W, S.H, S.size);
      t.w = d0.w; t.h = d0.h;
      t.x = Math.max(4, Math.min(t.tx + 30 * k, S.W - t.w - 4));
      const above = t.ty - t.h - 50 * k;
      t.y = above >= 4 ? above : Math.max(4, Math.min(S.H - t.h - 4, t.ty + 50 * k));
    }
    if (t.type === 'note' && !d.moved) { const d0 = A.defaults('note', S.W, S.H, S.size); t.w = d0.w; t.h = d0.h; }
    if (!d.moved && !['pen', 'marker', 'bubble', 'note'].includes(t.type)) { render(); return; }   // a click without a drag draws nothing
    if (t.type === 'pen' || t.type === 'marker') t.points = A.simplify(t.points, 0.6 / cssScale());
    if ((t.type === 'rect' || t.type === 'ellipse' || t.type === 'blur') && (t.w < 3 || t.h < 3)) { render(); return; }
    if (S.doc.items.length >= A.LIMITS.items) { hint(`At most ${A.LIMITS.items} drawings on a picture.`); render(); return; }
    pushUndo();
    S.doc.items.push(t);
    // it shows selected: you can resize, recolor or delete it right away (not free drawing, it would get in the way)
    S.sel = t.type === 'pen' || t.type === 'marker' ? null : t.id;
    if (TEXTY.includes(t.type)) openEdit(t, true);
    else changed();
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', (e) => {
    if (!S.annot || S.tool !== 'select') return;
    const p = toImg(e);
    const i = A.hitTest(S.doc.items, p.x, p.y, tol());
    if (i >= 0 && TEXTY.includes(S.doc.items[i].type)) openEdit(S.doc.items[i], false);
  });

  // ------------------------------------------------ text (typed right on the picture)
  function placeEditor() {
    const ed = S.edit;
    if (!ed) return;
    const it = S.doc.items.find((i) => i.id === ed.id);
    if (!it) return;
    const k = cssScale();
    const ta = ed.ta;
    const p = it.type === 'text' ? 0 : A.pad(it);
    ta.style.left = `${(it.x + p) * k}px`;
    ta.style.top = `${(it.y + p + (it.type === 'text' ? 0 : it.size * 0.12)) * k}px`;
    ta.style.fontSize = `${it.size * k}px`;
    ta.style.fontWeight = it.type === 'text' ? '650' : '500';
    ta.style.color = it.type === 'text' ? it.color : A.INK;
    const w = it.type === 'text' ? Math.max(it.w || 0, it.size * 8) + it.size : it.w - 2 * p;
    ta.style.width = `${Math.max(20, w * k)}px`;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }
  function openEdit(it, isNew) {
    commitEdit();
    S.sel = it.id;
    const ta = document.createElement('textarea');
    ta.className = 'a-edit';
    ta.value = it.text || '';
    ta.spellcheck = false;
    ta.maxLength = A.LIMITS.text;
    ta.setAttribute('aria-label', it.type === 'text' ? 'Text' : (it.type === 'bubble' ? 'Bubble text' : 'Note text'));
    S.edit = { id: it.id, ta, isNew, before: snap() };
    layer.append(ta);
    ta.addEventListener('input', () => {
      it.text = A.cleanText(ta.value);
      placeEditor();
      render();
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); commitEdit(); }
    });
    ta.addEventListener('blur', () => setTimeout(commitEdit, 0));
    placeEditor();
    render();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }
  function commitEdit() {
    const ed = S.edit;
    if (!ed) return;
    S.edit = null;
    ed.ta.remove();
    const it = S.doc.items.find((i) => i.id === ed.id);
    if (!it) { render(); return; }
    it.text = A.cleanText(ed.ta.value);
    if (!it.text.trim()) {
      // no text: plain text goes away; an empty bubble / note too (it would be just a white box)
      S.doc.items = S.doc.items.filter((i) => i.id !== it.id);
      S.sel = null;
      if (ed.isNew) { S.undo.pop(); updateBar(); render(); return; }
    } else if (!ed.isNew) {
      if (ed.before === snap()) { render(); return; }   // nothing changed
      S.undo.push(ed.before);
      S.redo = [];
    }
    if (S.tool !== 'select' && TEXTY.includes(S.tool)) { S.tool = 'select'; updateBar(); stageCursor(); }
    changed();
  }

  // ------------------------------------------------ duplicate / order (1.13.0)
  function duplicateSelected() {
    const it = selItem();
    if (!it) return;
    if (S.doc.items.length >= A.LIMITS.items) { hint(`At most ${A.LIMITS.items} drawings on a picture.`); return; }
    const copy = A.duplicateItem(it, 16 / cssScale());
    change(() => S.doc.items.push(copy));
    S.sel = copy.id;
    updateBar();
    render();
  }
  function orderSelected(where) {
    if (!S.sel) return;
    const next = A.reorder(S.doc.items, S.sel, where);
    if (next.every((x, i) => x === S.doc.items[i])) return;
    change(() => { S.doc.items = next; });
  }

  // ------------------------------------------------ the right-click menu (1.13.0)
  const menu = $('menu');
  let menuAsk = 0;
  function closeMenu() {
    if (menu.hidden) return false;
    menu.hidden = true;
    menu.replaceChildren();
    clearTimeout(menuAsk);
    return true;
  }
  function mItem(ic, label, fn, { key = '', danger = false, disabled = false } = {}) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `m-item${danger ? ' danger' : ''}`;
    b.setAttribute('role', 'menuitem');
    b.disabled = disabled;
    b.append(icon(ic, 16), document.createTextNode(label));
    if (key) b.append(Object.assign(document.createElement('span'), { className: 'm-key', textContent: key }));
    b.addEventListener('click', () => fn(b));
    return b;
  }
  const mSep = () => Object.assign(document.createElement('div'), { className: 'm-sep' });
  function mRow(label, ...kids) {
    const r = document.createElement('div');
    r.className = 'm-row';
    r.append(Object.assign(document.createElement('span'), { className: 'm-lab', textContent: label }), ...kids);
    return r;
  }
  function openMenu(x, y, it) {
    closeMenu();
    const kids = [];
    if (it) {
      kids.push(Object.assign(document.createElement('div'), { className: 'm-title', textContent: A.TYPE_LABELS[it.type] || 'Drawing' }));
      if (A.canText(it)) kids.push(mItem('type', 'Edit text', () => { closeMenu(); openEdit(it, false); }, { key: 'Enter' }));
      if (A.canColor(it)) {
        kids.push(mRow('Color', ...A.COLORS.map((c, i) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'a-swatch';
          b.title = COLOR_NAMES[i];
          b.setAttribute('aria-label', COLOR_NAMES[i]);
          b.setAttribute('aria-pressed', String(it.color === c));
          b.style.background = c;   // CSSOM
          b.addEventListener('click', () => { setColor(c); closeMenu(); });
          return b;
        })));
      }
      if (A.canSize(it)) {
        kids.push(mRow('Size', ...SIZES.map(([k, t]) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'a-size';
          b.textContent = t;
          b.addEventListener('click', () => { setSize(k); closeMenu(); });
          return b;
        })));
      }
      kids.push(mSep());
      kids.push(mItem('copy', 'Duplicate', () => { closeMenu(); duplicateSelected(); }, { key: 'Ctrl+D' }));
      kids.push(mItem('up', 'Bring to front', () => { closeMenu(); orderSelected('front'); }, { key: 'Ctrl+Shift+]' }));
      kids.push(mItem('down', 'Send to back', () => { closeMenu(); orderSelected('back'); }, { key: 'Ctrl+Shift+[' }));
      kids.push(mSep());
      kids.push(mItem('close', 'Delete this drawing', () => { closeMenu(); deleteSelected(); }, { key: 'Delete', danger: true }));
    } else {
      kids.push(mItem('undo', 'Undo', () => { closeMenu(); undo(); }, { key: 'Ctrl+Z', disabled: !S.undo.length }));
      kids.push(mItem('redo', 'Redo', () => { closeMenu(); redo(); }, { key: 'Ctrl+Y', disabled: !S.redo.length }));
      kids.push(mSep());
      kids.push(mItem('pointer', 'Select tool', () => { closeMenu(); setTool('select'); }, { key: 'V' }));
      if (S.doc.crop) kids.push(mItem('crop', 'Remove crop', () => { closeMenu(); change(() => { S.doc.crop = null; }); }));
      kids.push(mSep());
      kids.push(mItem('trash', 'Delete all drawings', (b) => {
        if (!b.classList.contains('asking')) {
          b.classList.add('asking');
          b.lastChild.textContent = 'Sure? (Ctrl+Z can undo it)';
          menuAsk = setTimeout(closeMenu, 4000);
          return;
        }
        closeMenu();
        change(() => { S.doc.items = []; });
        S.sel = null;
        updateBar();
      }, { danger: true, disabled: !S.doc.items.length }));
    }
    menu.replaceChildren(...kids);
    menu.hidden = false;
    // inside the window, next to the mouse
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - r.width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - r.height - 6))}px`;
    const first = menu.querySelector('button:not(:disabled)');
    if (first) first.focus();
  }
  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!S.annot || !S.img) return;
    commitEdit();
    const p = toImg(e);
    const i = A.hitTest(S.doc.items, p.x, p.y, tol());
    const it = i >= 0 ? S.doc.items[i] : null;
    S.sel = it ? it.id : S.sel;
    updateBar();
    render();
    openMenu(e.clientX, e.clientY, it);
  });
  window.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);
  stage.addEventListener('scroll', closeMenu);
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('button:not(:disabled)')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  });

  // ------------------------------------------------ keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape' && !$('trashAsk').hidden) { $('trashAsk').hidden = true; return; }
    const btn = e.target instanceof HTMLButtonElement;
    if (e.key === ' ' && !btn) { if (!S.space) { S.space = true; stageCursor(); } e.preventDefault(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); setZoom(A.stepZoom(S.zoom, 1)); return; }
    if (mod && e.key === '-') { e.preventDefault(); setZoom(A.stepZoom(S.zoom, -1)); return; }
    if (mod && e.key === '0') { e.preventDefault(); zoomFit(); return; }
    if (mod && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); copy(); return; }
    if (S.annot && mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (S.annot && mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); return; }
    if (S.annot && mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveCopy(); return; }
    if (S.annot && mod && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); duplicateSelected(); return; }
    if (S.annot && mod && e.key === ']') { e.preventDefault(); orderSelected(e.shiftKey ? 'front' : 'up'); return; }
    if (S.annot && mod && e.key === '[') { e.preventDefault(); orderSelected(e.shiftKey ? 'back' : 'down'); return; }
    if (mod || e.altKey) return;
    if (e.key === '+' || e.key === '=') { setZoom(A.stepZoom(S.zoom, 1)); return; }
    if (e.key === '-') { setZoom(A.stepZoom(S.zoom, -1)); return; }
    if (e.key === '0') { zoomFit(); return; }
    if (e.key === '1') { setZoom(1); return; }
    if (!S.annot) { if (e.key === 'Delete') trash(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); return; }
    if (e.key === 'Escape') {
      if (closeMenu()) return;
      if (S.drag && S.draft) { S.draft = null; S.drag = null; render(); }
      else if (S.sel) { S.sel = null; updateBar(); render(); }
      else if (S.tool !== 'select') setTool('select');   // Esc once more = back to Select
      return;
    }
    if (e.key === 'Enter' && S.sel) { const it = selItem(); if (it && TEXTY.includes(it.type)) { e.preventDefault(); openEdit(it, false); } return; }
    if (e.key.startsWith('Arrow') && S.sel) {
      e.preventDefault();
      const n = (e.shiftKey ? 10 : 1) / cssScale();
      const dx = e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0;
      const dy = e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0;
      const it = selItem();
      change(() => Object.assign(it, A.moveItem(it, dx, dy)));
      return;
    }
    const t = TOOLS.find((x) => x.key === e.key.toLowerCase());
    if (t && !btn) setTool(t.id);
  });
  window.addEventListener('keyup', (e) => { if (e.key === ' ') { S.space = false; stageCursor(); } });
  window.addEventListener('blur', () => { S.space = false; stageCursor(); });

  // ------------------------------------------------ Copy / Folder / Delete
  function resetCopy() {
    $('copyBtn').classList.remove('done');
    $('copyBtn').querySelector('span').textContent = 'Copy to send';
  }
  const copyFailed = (e) => hint(`Not copied: ${msgOf(e, 'something went wrong.')} What you paste now is still the old content.`, 6000);
  async function copy() {
    if (!S.info) return;
    try {
      commitEdit();
      // in annotation mode, what you see is copied (with annotations and crop)
      if (S.annot && !A.isEmptyDoc(S.doc)) await window.shotView.annot.copyPng(await R.renderPng(S.doc, S.img));
      else await window.shotView.copy(S.info.name);
      $('copyBtn').classList.add('done');
      $('copyBtn').querySelector('span').textContent = 'Copied!';
      hint('Copied! Now paste it with Ctrl+V in a chat or email.', 3500);
      setTimeout(resetCopy, 1800);
    } catch (e) { copyFailed(e); }
  }
  $('copyBtn').addEventListener('click', copy);
  $('folderBtn').addEventListener('click', () => { if (S.info) window.shotView.show(S.info.name).catch(() => hint('This picture is not in its folder anymore.', 4000)); });

  let askTimer = 0;
  function resetTrash() {
    clearTimeout(askTimer);
    const b = $('trashBtn');
    b.classList.remove('asking');
    b.replaceChildren(icon('trash', 16), Object.assign(document.createElement('span'), { textContent: 'Delete picture' }));
  }
  // ------------------------------------------------ Annotated | Original (1.14.0)
  function showPair() {
    const p = S.info && S.info.pair;
    $('pairSeg').hidden = !p;
    $('pairLink').hidden = !p;
    if (!p) return;
    const onCopy = S.info.name === p.copy;
    $('pairCopy').setAttribute('aria-pressed', String(onCopy));
    $('pairOrig').setAttribute('aria-pressed', String(!onCopy));
    $('pairLink').textContent = onCopy ? 'Clean picture' : 'With drawing';
    $('pairLink').title = onCopy ? 'See the clean picture, without your drawing' : 'See the picture with your drawing';
  }
  const openPair = (which) => {
    const p = S.info && S.info.pair;
    if (!p) return;
    const target = which === 'copy' ? p.copy : p.original;
    if (target !== S.info.name) window.shotView.open(target).catch(() => hint('This picture is not in its folder anymore.'));
  };
  $('pairLink').addEventListener('click', () => openPair(S.info && S.info.pair && S.info.name === S.info.pair.copy ? 'original' : 'copy'));
  $('pairCopy').addEventListener('click', () => openPair('copy'));
  $('pairOrig').addEventListener('click', () => openPair('original'));

  // deleting a screenshot with a pair: choose what goes (so the original isn't lost by mistake)
  function askPairTrash() {
    const p = S.info.pair;
    const onCopy = S.info.name === p.copy;
    $('trashText').textContent = onCopy ? 'This picture goes to the Recycle Bin. Also delete the clean one?' : 'This picture goes to the Recycle Bin. Also delete the one with your drawing?';
    $('trashOne').textContent = 'No, keep it';
    $('trashBoth').textContent = 'Yes, delete it too';
    $('trashAsk').hidden = false;
    $('trashOne').focus();
  }
  async function doTrash(both) {
    $('trashAsk').hidden = true;
    S.allowClose = true;   // the window closes (the main process closes it)
    try { await window.shotView.trash(S.info.name, { both }); } catch (e) { S.allowClose = false; hint(msgOf(e, 'Couldn\'t move it to the Recycle Bin.'), 6000); }
  }
  $('trashOne').addEventListener('click', () => doTrash(false));
  $('trashBoth').addEventListener('click', () => doTrash(true));
  $('trashCancel').addEventListener('click', () => { $('trashAsk').hidden = true; });

  async function trash() {
    if (!S.info) return;
    if (S.info.pair) { askPairTrash(); return; }
    const b = $('trashBtn');
    if (!b.classList.contains('asking')) {
      b.classList.add('asking');
      b.replaceChildren(document.createTextNode('Sure? Move to Recycle Bin'));
      askTimer = setTimeout(resetTrash, 3000);
      b.focus();
      return;
    }
    resetTrash();
    S.allowClose = true;   // the window closes (the main process closes it)
    try { await window.shotView.trash(S.info.name); } catch (e) { S.allowClose = false; hint(msgOf(e, 'Couldn\'t move it to the Recycle Bin.'), 6000); }
  }
  $('trashBtn').addEventListener('click', trash);

  // ------------------------------------------------ closing with annotations not yet in the copy
  let leaveAction = null;
  async function confirmLeave(action) {
    commitEdit();
    if (!S.annot || !S.dirty || A.isEmptyDoc(S.doc)) { action(); return; }
    // simple mode: no question, the picture with the drawing is saved; if that fails, the question shows after all
    if (simple && !leaveAsked) {
      if (await saveCopy()) { hint('I saved the picture with your drawing. The clean picture is untouched.', 4500); action(); return; }
      leaveAsked = true;
    }
    leaveAction = action;
    $('leave').hidden = false;
    $('leaveSave').focus();
  }
  let leaveAsked = false;   // a failed auto-save in simple mode: from then on, ask (so the window can still close)
  $('leaveSave').addEventListener('click', async () => { $('leave').hidden = true; if (await saveCopy() && leaveAction) leaveAction(); });
  $('leaveGo').addEventListener('click', async () => { $('leave').hidden = true; await flushSave(); S.dirty = false; if (leaveAction) leaveAction(); });
  $('leaveStay').addEventListener('click', () => { $('leave').hidden = true; leaveAction = null; });
  const closeWindow = async () => { await flushSave(); S.allowClose = true; window.shotView.closeView(); };
  window.addEventListener('beforeunload', (e) => {
    if (S.allowClose || !S.annot || !S.dirty || A.isEmptyDoc(S.doc)) { flushSave(); return; }
    // closing is stopped; we ask in the page (the annotations are saved anyway, only the copy is out of date)
    e.preventDefault();
    e.returnValue = false;
    confirmLeave(closeWindow);
  });

  window.shotView.onLoad(() => confirmLeave(load));
  load();
})();
