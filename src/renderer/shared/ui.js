'use strict';
// DOM helpers. User text goes in ONLY through textContent (never innerHTML).
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  // Original icons, drawn as lines (stroke), 24×24.
  const ICONS = {
    close: ['M6 6l12 12', 'M18 6L6 18'],
    clipboard: ['M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1z', 'M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2', 'M8 12h8', 'M8 16h5'],
    note: ['M6 3h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M14 3v6h6', 'M8 13h8', 'M8 17h6'],
    spark: ['M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z', 'M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z'],
    gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-4-4'],
    pin: ['M9 4h6l-1 5 3 3v2H7v-2l3-3z', 'M12 14v6'],
    star: ['M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 16.95 6.75 19.7l1-5.85L3.5 9.7l5.9-.9z'],
    trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'],
    plus: ['M12 5v14', 'M5 12h14'],
    back: ['M15 6l-6 6 6 6'],
    send: ['M4 12l16-8-6 16-2-7z', 'M12 13l8-9'],
    pause: ['M9 6v12', 'M15 6v12'],
    play: ['M8 5l11 7-11 7z'],
    copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
    key: ['M14 10a4 4 0 1 0-3.5 4L12 16h2v2h2v2h3v-3l-5.5-5.5A4 4 0 0 0 14 10z'],
    folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    target: ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
    stop: ['M7 7h10v10H7z'],
    eyeOff: ['M3 3l18 18', 'M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 9 7a11 11 0 0 1-2.4 3.3', 'M6.1 6.1C3.9 7.6 3 9.9 3 12c0 2 4 7 9 7a9.6 9.6 0 0 0 4.3-1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
    contrast: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 3v18'],
    clock: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 7v5l3 2'],
    chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
    cut: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M20 4L8.1 15.9', 'M14.5 14.5L20 20', 'M8.1 8.1L12 12'],
    flag: ['M5 21V4', 'M5 4h12l-2.5 4 2.5 4H5'],
    video: ['M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z', 'M16 10l5-3v10l-5-3z'],
    rec: ['M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10z'],
    open: ['M14 4h6v6', 'M20 4l-9 9', 'M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5'],
    eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
    mail: ['M4 6h16v12H4z', 'M4 7l8 6 8-6'],
    smile: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M8.5 14.5c1.9 2 5.1 2 7 0', 'M9 9.5v1', 'M15 9.5v1'],
    info: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5', 'M12 7.6v.2'],
    chevron: ['M9 6l6 6-6 6'],
    dice: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z', 'M8.5 8.5h.01', 'M15.5 15.5h.01', 'M15.5 8.5h.01', 'M8.5 15.5h.01', 'M12 12h.01'],
    check: ['M5 12l5 5 9-10'],
    undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
    up: ['M6 15l6-6 6 6'],
    loop: ['M17 2l4 4-4 4', 'M3 11V9a3 3 0 0 1 3-3h15', 'M7 22l-4-4 4-4', 'M21 13v2a3 3 0 0 1-3 3H3'],
    crop: ['M6 2v14a2 2 0 0 0 2 2h14', 'M18 22V8a2 2 0 0 0-2-2H2'],
    bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'],
    checklist: ['M4 6l1.5 1.5L8 5', 'M4 12l1.5 1.5L8 11', 'M4 18l1.5 1.5L8 17', 'M11 6h9', 'M11 12h9', 'M11 18h9'],
    code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M13.5 5l-3 14'],
    expand: ['M15 3h6v6', 'M9 21H3v-6', 'M21 3l-7 7', 'M3 21l7-7'],
    down: ['M6 9l6 6 6-6'],
    film: ['M4 5h16v14H4z', 'M8 5v14', 'M16 5v14', 'M4 9h4', 'M4 15h4', 'M16 9h4', 'M16 15h4'],
    image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 9.5h.01'],
    type: ['M3 7V5h10v2', 'M8 5v14', 'M6 19h4', 'M14 12v-1h7v1', 'M17.5 11v8', 'M16 19h3'],
    flame: ['M12 3c1 3.6 5 5.6 5 10.2a5 5 0 0 1-10 0c0-2.3 1.2-3.8 2.5-4.8.2 1.7 1 2.7 2.1 3C11.1 8.8 11.2 5.7 12 3z'],
    lock: ['M7.5 11V8a4.5 4.5 0 0 1 9 0v3', 'M5.5 11h13v9.5h-13z'],
    // annotations (1.11.0)
    pointer: ['M5 3l13 6.5-5.8 1.9L10.3 17z'],
    pen: ['M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16z', 'M14 7l3 3'],
    marker: ['M15 4l5 5-8 8-5-5z', 'M7 12l-3 3v3h3l3-3', 'M4 21h8'],
    arrow: ['M5 19L19 5', 'M10 5h9v9'],
    line: ['M5 19L19 5'],
    square: ['M5 5h14v14H5z'],
    circle: ['M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z'],
    bubble: ['M4 5h16v11h-9l-5 4v-4H4z'],
    sticky: ['M5 4h14v10l-5 6H5z', 'M14 20v-6h5'],
    step: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M10.5 9l2-1.5V16'],
    pixels: ['M4 4h6v6H4z', 'M14 4h6v6h-6z', 'M4 14h6v6H4z', 'M14 14h6v6h-6z'],
    redo: ['M15 14l5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
    minus: ['M5 12h14'],
    save: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
    trophy: ['M8 4h8v5a4 4 0 0 1-8 0z', 'M8 6H5a3 3 0 0 0 3 4', 'M16 6h3a3 3 0 0 1-3 4', 'M12 13v4', 'M8.5 20h7', 'M10 17h4v3h-4z'],
  };

  function icon(name, size = 18) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', size);
    svg.setAttribute('height', size);
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    svg.classList.add('icon');
    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  /** h('button', { class: 'x', onclick: fn, 'aria-label': '…' }, 'text', child) */
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    // no red squiggles anywhere (the spellchecker was removed in 1.6.0; Chromium would turn it on by default in fields)
    if (tag === 'input') el.spellcheck = false;
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return el;
  }

  /** Adds the icons declared with data-icon in the static HTML. */
  function hydrateIcons(root = document) {
    root.querySelectorAll('[data-icon]').forEach((el) => {
      if (el.querySelector(':scope > svg.icon')) return;
      el.prepend(icon(el.dataset.icon));
    });
  }

  /** English plural: plural(1, 'note', 'notes') → "1 note", plural(2, …) → "2 notes". */
  function plural(n, one, many = one + 's') {
    return `${n} ${n === 1 ? one : many}`;
  }

  function relTime(ts) {
    const diff = Math.max(0, Date.now() - ts);
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const hours = Math.floor(min / 60);
    if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
    const d = new Date(ts);
    const days = Math.floor(hours / 24);
    if (days === 1) return 'yesterday, ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  let toastTimer = 0;
  function toast(message, kind = 'ok') {
    const t = document.getElementById('toast');
    t.textContent = message;
    t.dataset.kind = kind;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  /**
   * In-app confirmation (no native dialog): the button turns into "Sure? Yes / No".
   * @param {HTMLElement} host  where the buttons go
   */
  function confirmInline(host, { label, question = 'Sure?', danger = true, onConfirm }) {
    const render = (asking) => {
      host.replaceChildren();
      if (!asking) {
        host.append(h('button', { class: 'btn btn-ghost' + (danger ? ' btn-danger-text' : ''), type: 'button', onclick: () => render(true) }, label));
        return;
      }
      const yes = h('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary'), type: 'button', onclick: async () => { await onConfirm(); render(false); } }, 'Yes');
      const no = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => render(false) }, 'No');
      host.append(h('span', { class: 'confirm-q', text: question }), yes, no);
      no.focus();
    };
    render(false);
    return { reset: () => render(false) };
  }

  /**
   * Simple mode: a "More" button that shows the advanced (.adv) controls inside `scope` (not persisted).
   * Only visible in simple mode (.simple-only); in full mode everything is already shown.
   */
  function moreButton(scope, { label = 'More', extraClass = '' } = {}) {
    const btn = h('button', { class: `btn btn-ghost more-toggle simple-only ${extraClass}`, type: 'button', 'aria-expanded': 'false' });
    const paint = () => {
      const open = scope.classList.contains('show-adv');
      btn.replaceChildren(open ? 'Less' : label, h('span', { class: 'more-caret', 'aria-hidden': 'true', text: open ? '▴' : '▾' }));
      btn.setAttribute('aria-expanded', String(open));
    };
    btn.addEventListener('click', () => { scope.classList.toggle('show-adv'); paint(); });
    paint();
    return btn;
  }

  window.UI = { h, icon, hydrateIcons, plural, relTime, toast, confirmInline, moreButton };
})();
