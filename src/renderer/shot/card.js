'use strict';
// The card after a capture (1.10.0). Buttons: Copy to send (the image to the clipboard), Draw on it (1.11.0), Open (the large window),
// Show in folder, Delete (to the Recycle Bin, confirmed by a second click). Closes by itself after 8 s (15 s in simple mode),
// but not while the mouse is on the card (after it leaves, it stays at least 1.5 s more).
// Simple mode (UX pass): Open / Folder / Delete sit behind "More".
(function () {
  const { hydrateIcons } = window.UI;
  const $ = (id) => document.getElementById(id);
  const SHOW_MS = 8000;
  const SHOW_MS_SIMPLE = 15000;
  let info = null;
  let simple = false;
  let closeTimer = 0;
  let startedAt = 0;
  let leftMs = SHOW_MS;
  let hovering = false;
  let askTimer = 0;

  hydrateIcons();

  // ------------------------------------------------ simple / full mode
  function applyMode(m) {
    simple = m === 'simple';
    document.body.classList.toggle('simple', simple);
  }
  // an older main without 'ui:mode' rejects: the card stays in full mode (nothing hidden)
  const modeReady = window.shotView.uiMode().then(applyMode, (e) => console.warn('[card] ui mode unavailable:', e && e.message));
  window.shotView.onUiMode(applyMode);
  function setMore(open) {
    $('head').classList.toggle('show-adv', open);
    $('moreBtn').setAttribute('aria-expanded', String(open));
    $('moreBtn').textContent = open ? 'Less' : 'More';
  }
  $('moreBtn').addEventListener('click', () => setMore(!$('head').classList.contains('show-adv')));

  const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const close = () => { clearTimeout(closeTimer); window.shotView.closeCard(); };

  // ------------------------------------------------ the close timer (paused on hover)
  function startTimer(ms) {
    clearTimeout(closeTimer);
    leftMs = ms;
    startedAt = Date.now();
    closeTimer = setTimeout(close, ms);
    $('timeBar').parentElement.classList.remove('paused');
  }
  function restartBar() {
    const t = $('timeBar').parentElement;
    t.classList.remove('run', 'paused');
    void t.offsetWidth;   // restarts the animation
    t.classList.add('run');
  }
  function pause() {
    if (!closeTimer) return;
    clearTimeout(closeTimer);
    closeTimer = 0;
    leftMs = Math.max(1500, leftMs - (Date.now() - startedAt));
    $('timeBar').parentElement.classList.add('paused');
  }
  function resume() {
    if (hovering || closeTimer) return;
    startTimer(leftMs);
  }
  $('card').addEventListener('mouseenter', () => { hovering = true; pause(); });
  $('card').addEventListener('mouseleave', () => { hovering = false; resume(); });

  // ------------------------------------------------ the picture
  async function load() {
    resetTrash();
    setMore(false);
    $('copyBtn').classList.remove('done');
    $('copyBtn').querySelector('span').textContent = 'Copy to send';
    await modeReady;
    try {
      info = await window.shotView.cardInfo();
    } catch { info = null; }
    if (!info) { close(); return; }
    $('name').textContent = info.name;
    $('name').title = info.name;
    $('meta').textContent = kb(info.bytes);
    $('meta').classList.remove('warn', 'ok');
    const img = $('img');
    img.onload = () => { $('meta').textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${kb(info.bytes)}`; };
    img.src = info.url;
    img.alt = info.name;
    hovering = false;
    const ms = simple ? SHOW_MS_SIMPLE : SHOW_MS;
    document.documentElement.style.setProperty('--card-ms', `${ms}ms`);
    restartBar();
    startTimer(ms);
  }

  // errors are shown on the card (short text, no paths) instead of a click that does nothing
  const msgOf = (e, fallback) => String((e && e.message) || '').replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '') || fallback;
  const run = (fn) => async () => {
    if (!info) return;
    try { await fn(info.name); } catch (e) {
      $('meta').textContent = msgOf(e, 'That didn\'t work.');
      $('meta').classList.remove('ok');
      $('meta').classList.add('warn');
    }
  };
  $('pic').addEventListener('click', run((n) => window.shotView.open(n)));
  $('openBtn').addEventListener('click', run((n) => window.shotView.open(n)));
  $('annotBtn').addEventListener('click', run((n) => window.shotView.open(n, { annotate: true })));
  $('folderBtn').addEventListener('click', run((n) => window.shotView.show(n)));
  $('copyBtn').addEventListener('click', run(async (n) => {
    // F18: a failed copy says so (the clipboard still holds the old content)
    try { await window.shotView.copy(n); } catch (e) { throw new Error(`Not copied: ${msgOf(e, 'something went wrong.')}`, { cause: e }); }
    $('copyBtn').classList.add('done');
    $('copyBtn').querySelector('span').textContent = 'Copied!';
    // what to do next, for someone who doesn't know "copy" means "ready to send"
    $('meta').textContent = 'Now paste it with Ctrl+V in a chat or email.';
    $('meta').classList.remove('warn');
    $('meta').classList.add('ok');
  }));
  $('closeBtn').addEventListener('click', close);

  // Delete: the first click asks, the second moves it to the Recycle Bin (it can be restored from there)
  function resetTrash() {
    clearTimeout(askTimer);
    const b = $('trashBtn');
    b.classList.remove('asking');
    b.replaceChildren(window.UI.icon('trash', 15));
    b.setAttribute('aria-label', 'Delete (to the Recycle Bin)');
  }
  $('trashBtn').addEventListener('click', run(async (n) => {
    const b = $('trashBtn');
    if (!b.classList.contains('asking')) {
      b.classList.add('asking');
      b.replaceChildren(document.createTextNode('Delete?'));
      b.setAttribute('aria-label', 'Click again to move the picture to the Recycle Bin');
      askTimer = setTimeout(resetTrash, 3000);
      return;
    }
    resetTrash();
    await window.shotView.trash(n);   // the main process closes the card
  }));

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.shotView.onLoad(load);
  load();
})();
