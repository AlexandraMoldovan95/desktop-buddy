'use strict';
// Fills in the version and the GitHub links (from package.json, see scripts/build-site.js).
(function () {
  const info = window.SITE_INFO || {};
  for (const el of document.querySelectorAll('.version')) el.textContent = info.version ? `v${info.version}` : '';
  if (info.repo && /^https:\/\/github\.com\//.test(info.repo)) {
    for (const a of document.querySelectorAll('.repo-link')) { a.href = info.repo; a.hidden = false; }
    for (const el of document.querySelectorAll('.repo-link-wrap')) el.hidden = false;
    for (const a of document.querySelectorAll('.download-link')) { a.href = `${info.repo}/releases/latest`; a.hidden = false; }
  }
})();

// The dark/light theme button: switches the theme and saves the choice in this browser
// (theme-init.js applies it on the next visit). With nothing saved, the system setting decides.
(function () {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const isDark = () => (root.getAttribute('data-theme') || (systemDark.matches ? 'dark' : 'light')) === 'dark';
  const sync = () => btn.setAttribute('aria-pressed', String(isDark()));
  sync();
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try {
      localStorage.setItem('db-theme', next);
    } catch {
      // Not saved (storage blocked): the choice lasts for this visit.
    }
    sync();
  });
  // Nothing saved and the system switches while the page is open: keep the button's state right.
  systemDark.addEventListener('change', sync);
})();

// "Back to top": shown only on a page at least two screens tall, after half a screen of scrolling
// (at the top, or on a short page, it would only be in the way). Checked again on scroll, resize and
// any change in the page's height (the pictures load lazily). A click scrolls up (instantly with
// reduced motion) and puts keyboard focus on the brand link, at the top.
(function () {
  const btn = document.getElementById('toTop');
  if (!btn) return;
  const shouldShow = (y, vh, ph) => ph >= vh * 2 && y >= vh / 2;
  let queued = false;
  const update = () => {
    queued = false;
    btn.classList.toggle('is-shown', shouldShow(window.scrollY, window.innerHeight, document.documentElement.scrollHeight));
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  if ('ResizeObserver' in window) new ResizeObserver(queue).observe(document.body);
  btn.addEventListener('click', () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    const first = document.querySelector('.brand');
    if (first) first.focus({ preventScroll: true });
  });
  update();
})();
