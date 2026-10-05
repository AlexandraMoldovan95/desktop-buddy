'use strict';
// Plays one clip in a loop (by default), filling the window. Space = pause, L = loop, F / double-click = full screen, Esc = exit.
(function () {
  const { icon, hydrateIcons } = window.UI;
  const $ = (id) => document.getElementById(id);
  const video = $('video');
  let idleTimer = 0;

  function setPlayIcon() {
    $('playBtn').replaceChildren(icon(video.paused ? 'play' : 'pause', 18));
    $('playBtn').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
  }
  function setLoop(on) {
    video.loop = on;
    $('loopBtn').classList.toggle('on', on);
    $('loopBtn').setAttribute('aria-pressed', String(on));
    if (on && video.ended) video.play().catch(() => {});
  }
  const togglePlay = () => { if (video.paused) video.play().catch(() => {}); else video.pause(); };
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  // the bar hides after 2 s without movement (so it doesn't cover the clip while you show it to someone)
  function wake() {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!video.paused) document.body.classList.add('idle'); }, 2000);
  }

  async function load() {
    $('err').hidden = true;
    try {
      const info = await window.viewer.info();
      $('name').textContent = info.label || info.name;
      $('name').title = info.name;
      document.title = `${info.name} – Desktop Buddy`;
      video.src = info.url;
      await video.play().catch(() => {});
    } catch {
      $('err').textContent = 'The clip can\'t be opened (maybe it was moved or deleted).';
      $('err').hidden = false;
    }
    wake();
  }

  video.addEventListener('play', () => { setPlayIcon(); wake(); });
  video.addEventListener('pause', () => { setPlayIcon(); wake(); });
  video.addEventListener('error', () => { $('err').textContent = 'The clip can\'t be played.'; $('err').hidden = false; });
  video.addEventListener('dblclick', toggleFull);
  video.addEventListener('click', togglePlay);
  $('playBtn').addEventListener('click', togglePlay);
  $('loopBtn').addEventListener('click', () => setLoop(!video.loop));
  $('fullBtn').addEventListener('click', toggleFull);
  $('folderBtn').addEventListener('click', () => window.viewer.showFile());
  document.addEventListener('mousemove', wake);
  document.addEventListener('keydown', (e) => {
    wake();
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'f' || e.key === 'F') toggleFull();
    else if (e.key === 'l' || e.key === 'L') setLoop(!video.loop);
    else if (e.key === 'Escape') { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else window.close(); }
  });
  window.viewer.onLoad(() => load());
  // simple / full mode (UX pass): this window has nothing advanced to hide yet; the class keeps it consistent
  const applyMode = (m) => document.body.classList.toggle('simple', m === 'simple');
  window.viewer.uiMode().then(applyMode, (e) => console.warn('[viewer] ui mode unavailable:', e && e.message));
  window.viewer.onUiMode(applyMode);
  hydrateIcons();
  setPlayIcon();
  load();
})();
