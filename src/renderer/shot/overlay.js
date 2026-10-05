'use strict';
// Area selection (1.8.0): drag with the mouse, it saves on release. Coordinates are in screen pixels (DIP);
// the main process turns them into the capture's real pixels (capture.js → toImageRect).
(function () {
  const frame = document.getElementById('frame');
  const dim = document.getElementById('dim');
  const sel = document.getElementById('sel');
  const size = document.getElementById('size');
  const bar = document.getElementById('bar');
  let start = null;
  let sent = false;

  function done(corners) {
    if (sent) return;
    sent = true;
    window.shot.overlayDone(corners);
  }

  function draw(a, b) {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    sel.hidden = false;
    sel.style.left = `${x}px`;
    sel.style.top = `${y}px`;
    sel.style.width = `${w}px`;
    sel.style.height = `${h}px`;
    size.textContent = `${Math.round(w * devicePixelRatio)} × ${Math.round(h * devicePixelRatio)}`;
    dim.classList.add('cut');
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.bar')) return;
    start = { x: e.clientX, y: e.clientY };
    bar.classList.add('hide');
    document.body.setPointerCapture?.(e.pointerId);
  });
  document.addEventListener('pointermove', (e) => { if (start) draw(start, { x: e.clientX, y: e.clientY }); });
  document.addEventListener('pointerup', (e) => {
    if (!start || e.button !== 0) return;
    const a = start;
    start = null;
    if (Math.abs(a.x - e.clientX) < 4 || Math.abs(a.y - e.clientY) < 4) {   // a click, not an area: start over
      sel.hidden = true; dim.classList.remove('cut'); bar.classList.remove('hide');
      return;
    }
    done({ x1: a.x, y1: a.y, x2: e.clientX, y2: e.clientY });
  });
  document.addEventListener('contextmenu', (e) => { e.preventDefault(); done(null); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); });
  document.getElementById('toWindow').addEventListener('click', () => { sent = true; window.shot.toWindow(); });

  window.shot.overlayInfo().then((info) => {
    if (!info) { done(null); return; }
    frame.src = info.image;
  });
})();
