'use strict';
// The Pictures tab (screenshots, F2): two big buttons, the latest pictures, "See all pictures".
// The pictures are PNG files in <data>\Screenshots; the large window has Copy / Draw / Delete.
(function () {
  const { h, icon, toast } = window.UI;
  const root = document.getElementById('picturesRoot');

  let shots = [];
  let visible = false;
  let loadedAt = 0;      // 0 = never loaded (r2 M3: the folder is scanned on the first show, not at panel start)
  let changed = false;   // pictures changed while the tab was hidden (r2 L1)
  const STALE_MS = 60000;   // files changed outside the app (Explorer) send no event: re-check now and then

  const errText = (e) => ((e && e.message) || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Error';
  const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);
  const when = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function refresh() {
    changed = false;
    try { shots = await window.api.capture.recent(); } catch (e) { console.warn('[pictures] recent', e); shots = []; }
    loadedAt = Date.now();
  }

  function takeCard() {
    return h('section', { class: 'session-card pic-take', 'aria-labelledby': 'pic-take' },
      h('h2', { id: 'pic-take', text: 'Take a picture of your screen' }),
      h('div', { class: 'pic-buttons' },
        h('button', { class: 'btn btn-primary btn-big', id: 'picArea', type: 'button', onclick: () => window.api.capture.zone().catch((e) => toast(errText(e), 'error')) },
          icon('crop', 20), h('span', { class: 'big-label' }, h('span', { text: 'Picture of an area' }), h('span', { class: 'big-sub', text: 'Drag a box over what you want' }))),
        h('button', { class: 'btn btn-secondary btn-big', id: 'picWindow', type: 'button', onclick: () => window.api.capture.window().catch((e) => toast(errText(e), 'error')) },
          icon('image', 20), h('span', { class: 'big-label' }, h('span', { text: 'Picture of a window' }), h('span', { class: 'big-sub', text: 'Pick a window from a list' })))),
      h('p', { class: 'muted rec-hint', text: 'Tip: right-click the buddy to take a picture right away.' }));
  }

  function latestCard() {
    // one entry per picture; if it has a drawn copy, the copy is shown (and opened), with the ✎ sign
    const rows = shots.map((f) => {
      const img = h('img', { alt: '', loading: 'lazy', decoding: 'async' });
      img.src = f.thumb;
      return h('li', {},
        h('button', { class: 'shot-tile', type: 'button', title: `${f.copy ? 'With your drawing · ' : ''}${mb(f.bytes)} · click to open big`, 'aria-label': `Open ${f.name}`,
          onclick: () => window.api.capture.view(f.view).catch((e) => toast(errText(e), 'error')) },
          h('span', { class: 'shot-thumb' }, img, f.copy ? h('span', { class: 'shot-badge', 'aria-label': 'with drawing' }, icon('pen', 11)) : null),
          h('span', { class: 'shot-when', text: when(Math.max(f.at, f.copy ? f.copy.at : 0)) })));
    });
    return h('section', { class: 'session-card', 'aria-labelledby': 'pic-latest' },
      h('div', { class: 'head-row' },
        h('h2', { id: 'pic-latest', text: 'Your latest pictures' }),
        h('button', { class: 'icon-btn adv', type: 'button', title: 'Open the pictures folder', 'aria-label': 'Open the pictures folder', onclick: () => window.api.capture.openFolder().catch((e) => toast(errText(e), 'error')) }, icon('folder', 16))),
      rows.length
        ? h('ul', { class: 'shot-grid', 'aria-label': 'Latest pictures' }, ...rows)
        : h('p', { class: 'muted', text: loadedAt ? 'No pictures yet. Press a button above to take your first one.' : 'Loading…' }),
      h('button', { class: 'btn btn-secondary pic-all', id: 'picAll', type: 'button', onclick: () => window.api.capture.gallery().catch((e) => toast(errText(e), 'error')) }, icon('image', 16), 'See all pictures'));
  }

  function render() {
    const scroll = root.scrollTop;
    root.replaceChildren(takeCard(), latestCard());
    root.scrollTop = scroll;
  }

  // pictures added / deleted elsewhere (gallery, card, folder): refresh only while the tab is open
  window.api.capture.onChanged(async () => { if (!visible) { changed = true; return; } await refresh(); if (visible) render(); });

  window.PicturesTab = {
    async init() { /* r2 M3: nothing until the tab is first shown */ },
    async onShow() {
      visible = true;
      render();   // the buttons at once (the tour points at them); the list follows
      if (loadedAt && !changed && Date.now() - loadedAt < STALE_MS) return;
      await refresh();
      if (visible) render();
    },
    onHide() { visible = false; },
  };
})();
