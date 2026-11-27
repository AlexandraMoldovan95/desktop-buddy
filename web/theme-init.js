'use strict';
// Runs in <head>, before the page is drawn: applies the theme picked with the header button
// (saved in this browser), so the page never flashes in the other one. With nothing saved,
// site.css follows the system's dark/light setting on its own.
(function () {
  try {
    const saved = localStorage.getItem('db-theme');
    if (saved === 'dark' || saved === 'light') document.documentElement.setAttribute('data-theme', saved);
  } catch {
    // Storage blocked (private mode, strict settings): the system setting decides.
  }
})();
