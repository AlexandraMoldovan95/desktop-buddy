'use strict';
// The first-run tour (F1), drawn over the panel: a dim backdrop, a ring around the thing it talks about
// and a speech bubble. Steps and text: shared/tour-steps.js. Positions are set through CSSOM (the CSP
// blocks style attributes); every text goes in with textContent.
(function () {
  const { h, icon, toast } = window.UI;
  const T = window.TourSteps;
  const host = document.getElementById('tour');

  let st = null;
  let deps = null;      // { show(step) → Promise, mode() → 'simple'|'full', buddySide }
  let lastFocus = null;
  let seq = 0;          // a newer step wins over a slower, older one

  const shade = h('div', { class: 'tour-shade' });
  const ring = h('div', { class: 'tour-ring', hidden: true });
  const arrow = h('span', { class: 'tour-arrow', 'aria-hidden': 'true' });
  const count = h('span', { class: 'tour-count' });
  const title = h('h2', { class: 'tour-title', id: 'tourTitle' });
  const text = h('p', { class: 'tour-text', id: 'tourText', 'aria-live': 'polite' });
  const closeBtn = h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Close the tour', title: 'Close the tour' }, icon('close', 16));
  const backBtn = h('button', { class: 'btn btn-ghost', type: 'button' });
  const nextBtn = h('button', { class: 'btn btn-primary', type: 'button' });
  const bubble = h('div', { class: 'tour-bubble', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tourTitle', 'aria-describedby': 'tourText' },
    arrow,
    h('div', { class: 'tour-top' }, count, closeBtn),
    title, text,
    h('div', { class: 'tour-foot' }, backBtn, nextBtn));
  host.replaceChildren(shade, ring, bubble);

  const px = (n) => `${Math.round(n)}px`;
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  function visibleRect(el) {
    if (!el || !el.isConnected) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
  }

  /** Puts the ring on `target` and the bubble below or above it, with the arrow pointing at it. */
  function placeAt(target) {
    const box = host.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    const pad = 4;
    const t = { left: r.left - box.left - pad, top: r.top - box.top - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    ring.hidden = false;
    host.classList.add('has-ring');
    Object.assign(ring.style, { left: px(t.left), top: px(t.top), width: px(t.width), height: px(t.height) });
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    const gap = 12;
    const below = t.top + t.height + gap + bh <= box.height - 8 || t.top < bh + gap + 8;
    const top = below ? Math.min(t.top + t.height + gap, box.height - bh - 8) : t.top - gap - bh;
    const cx = t.left + t.width / 2;
    const left = Math.min(Math.max(cx - bw / 2, 12), box.width - bw - 12);
    Object.assign(bubble.style, { left: px(left), top: px(Math.max(8, top)), right: '', bottom: '' });
    arrow.hidden = false;
    arrow.dataset.dir = below ? 'up' : 'down';
    Object.assign(arrow.style, { left: px(Math.min(Math.max(cx - left - 7, 14), bw - 28)), top: '', right: '', bottom: '' });
  }

  /** No target: the bubble sits at the panel's edge next to the buddy (step 1), or in the middle. */
  function placeFree(side) {
    const box = host.getBoundingClientRect();
    ring.hidden = true;
    host.classList.remove('has-ring');
    const bw = bubble.offsetWidth;
    const bh = bubble.offsetHeight;
    let left = (box.width - bw) / 2;
    let top = (box.height - bh) / 2;
    arrow.hidden = !side;
    if (side === 'left') left = 14;
    if (side === 'right') left = box.width - bw - 14;
    if (side === 'top') top = 14;
    if (side === 'bottom') top = box.height - bh - 14;
    Object.assign(bubble.style, { left: px(left), top: px(top), right: '', bottom: '' });
    if (!side) return;
    arrow.dataset.dir = side === 'top' ? 'up' : side === 'bottom' ? 'down' : side;
    Object.assign(arrow.style, side === 'left' || side === 'right'
      ? { top: px(bh / 2 - 7), left: '', right: '', bottom: '' }
      : { left: px(bw / 2 - 7), top: '', right: '', bottom: '' });
  }

  async function paint() {
    const my = ++seq;
    const step = T.step(st);
    const mode = deps.mode();
    count.textContent = T.counter(st);
    title.textContent = step.title;
    text.replaceChildren(...T.textOf(step, mode).map((p) => (typeof p === 'string' ? document.createTextNode(p) : h('strong', { text: p.b }))));
    backBtn.textContent = T.isFirst(st) ? 'Skip the tour' : '← Back';
    nextBtn.textContent = T.isFirst(st) ? "Let's look →" : T.isLast(st) ? 'Got it' : 'Next →';
    // r2 F-L2: screen readers say "Back" / "Next", not "left arrow" / "right arrow"
    backBtn.setAttribute('aria-label', T.isFirst(st) ? 'Skip the tour' : 'Back');
    nextBtn.setAttribute('aria-label', T.isFirst(st) ? "Let's look" : T.isLast(st) ? 'Got it' : 'Next');
    await deps.show(step);
    await frame();
    if (my !== seq || !st || !st.open) return;
    let target = null;
    if (step.target && step.target !== 'buddy') {
      target = document.querySelector(step.target);
      if (target && visibleRect(target)) target.scrollIntoView({ block: 'nearest' });
      if (!visibleRect(target)) target = step.tab ? document.getElementById(`tab-${step.tab}`) : null;   // e.g. no "Record" button while recording
    }
    if (target && visibleRect(target)) placeAt(target);
    else placeFree(step.target === 'buddy' ? deps.buddySide : null);
    nextBtn.focus();
    if (T.isLast(st)) window.api.settings.buddyDemo('wave').catch(() => { /* animations off or buddy hidden: nothing to show */ });
  }

  function end(finished) {
    if (!st) return;
    st = finished ? T.next(st) : T.close(st);
    seq++;
    host.hidden = true;
    document.removeEventListener('keydown', onKey, true);
    window.api.tour.active(false);
    window.api.settings.set({ tourDone: true }).catch(() => toast("Couldn't save that the tour is done", 'error'));
    const quiet = deps && deps.quiet;
    if (!finished && !quiet) toast('You can see the tour again in Settings → Help.');
    if (deps && deps.onEnd) deps.onEnd();
    st = null;
    if (lastFocus && lastFocus.isConnected && !quiet) lastFocus.focus();
  }

  function go(dir) {
    if (!st) return;
    if (dir > 0) {
      if (T.isLast(st)) { end(true); return; }
      st = T.next(st);
    } else {
      if (T.isFirst(st)) { end(false); return; }   // "Skip the tour"
      st = T.back(st);
    }
    paint();
  }

  function onKey(e) {
    if (!st) return;
    const onButton = e.target && e.target.tagName === 'BUTTON';
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); return; }
    if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) { e.preventDefault(); e.stopPropagation(); go(1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); if (!T.isFirst(st)) go(-1); return; }   // r2 F-L1: ← never skips the tour
    if (e.key === 'Tab') {
      // focus stays inside the bubble
      const items = [closeBtn, backBtn, nextBtn];
      const i = items.indexOf(document.activeElement);
      e.preventDefault();
      e.stopPropagation();
      items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      return;
    }
    if (!bubble.contains(e.target)) e.stopPropagation();   // the panel's own keys wait until the tour ends
  }

  nextBtn.addEventListener('click', () => go(1));
  backBtn.addEventListener('click', () => go(-1));
  closeBtn.addEventListener('click', () => end(false));

  window.Tour = {
    /** @param {{ show: (step) => Promise<void>, mode: () => string, buddySide?: string, onEnd?: () => void }} d */
    start(d) {
      deps = { ...d, quiet: false };
      if (!st) lastFocus = document.activeElement;
      st = T.start();
      host.hidden = false;
      document.addEventListener('keydown', onKey, true);
      window.api.tour.active(true);
      paint();
    },
    /** The panel was hidden mid-tour: it counts as closed, without a message. */
    stopQuietly() { if (st) { deps.quiet = true; end(false); } },
    isOpen() { return !!st; },
  };
})();
