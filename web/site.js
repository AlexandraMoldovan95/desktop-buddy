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
