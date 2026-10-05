'use strict';
// The window list for a screenshot (1.8.0). Titles come from other apps: textContent only.
(function () {
  const grid = document.getElementById('grid');

  function card(w) {
    const b = document.createElement('button');
    b.className = 'p-win';
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    b.title = w.name;
    const t = document.createElement('div');
    t.className = 'p-thumb';
    if (w.thumb && w.thumb.startsWith('data:image/')) { const img = document.createElement('img'); img.alt = ''; img.src = w.thumb; t.appendChild(img); }
    const n = document.createElement('div');
    n.className = 'p-name';
    n.textContent = w.name;
    b.append(t, n);
    b.addEventListener('click', () => window.shot.choose(w.id));
    return b;
  }

  async function load() {
    let list = [];
    let failed = false;
    try { list = await window.shot.listWindows(); } catch (e) { failed = true; console.warn('[picker] listWindows failed:', e && e.message); }
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'p-empty';
      // a failed listing is not the same as "no windows"
      p.textContent = failed ? 'Couldn\'t read the list of windows. Click "Refresh".' : 'No open windows (other than Desktop Buddy).';
      grid.replaceChildren(p);
      return;
    }
    grid.replaceChildren(...list.map(card));
    grid.querySelector('.p-win')?.focus();
  }

  document.getElementById('refresh').addEventListener('click', load);
  document.getElementById('cancel').addEventListener('click', () => window.shot.choose(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.shot.choose(null); });
  window.shot.onRefresh(load);
  load();
})();
