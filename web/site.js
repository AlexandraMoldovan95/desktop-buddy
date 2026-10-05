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
