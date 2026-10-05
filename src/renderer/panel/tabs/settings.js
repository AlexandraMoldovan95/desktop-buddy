'use strict';
// The Settings tab: everything applies right away (except the email password, which has a save button).
// Simple mode (UX): the menu shows the everyday categories; the others and the advanced rows sit under "More".
(function () {
  const { h, icon, toast, confirmInline, moreButton } = window.UI;
  const root = document.getElementById('settings');

  let s = null;              // current settings (public view, no key)
  let meta = null;           // { emailPresets, emailSecurity, emailVerifiedAt, encryptionAvailable, version }
  const ctl = {};            // references to controls, for syncing
  let recording = false;
  let replacingPass = false;
  let refreshEmailStatus = () => {};

  async function set(patch) {
    try {
      const res = await window.api.settings.set(patch);
      s = res.settings;
      if (res.error) toast(res.error, 'error');
      sync();
      return res;
    } catch (err) {
      toast(err.message || "Couldn't save the setting", 'error');
      return null;
    }
  }

  // ------------------------------------------------ controls
  function row(label, hint, control, extraClass = '') {
    return h('div', { class: 'row ' + extraClass },
      h('div', { class: 'row-label' }, h('span', { text: label }), hint ? h('span', { class: 'hint', text: hint }) : null),
      control);
  }

  function switchCtl(key, label) {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label, onchange: () => set({ [key]: input.checked }) });
    ctl[key] = () => { input.checked = !!s[key]; };
    return h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }));
  }

  function segCtl(key, options, label) {
    const wrap = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const btns = options.map(([value, text]) => h('button', { type: 'button', onclick: () => set({ [key]: value }) }, text));
    wrap.append(...btns);
    ctl[key] = () => btns.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i][0] === s[key])));
    return wrap;
  }

  function rangeCtl(key, min, max, step, unit, label) {
    const out = h('span', {});
    const input = h('input', { type: 'range', min, max, step, 'aria-label': label });
    input.addEventListener('input', () => { out.textContent = input.value + unit; });
    input.addEventListener('change', () => set({ [key]: Number(input.value) }));
    ctl[key] = () => { input.value = s[key]; out.textContent = s[key] + unit; };
    return h('span', { class: 'range-wrap' }, input, out);
  }

  function selectCtl(key, options, label) {
    const sel = h('select', { 'aria-label': label, onchange: () => set({ [key]: sel.value }) },
      ...options.map(([v, t]) => h('option', { value: v }, t)));
    ctl[key] = () => { sel.value = s[key]; };
    return sel;
  }

  // ------------------------------------------------ global shortcut
  const pretty = (accel) => accel ? accel.replace('CommandOrControl', 'Ctrl') : 'Off';

  function keyName(e) {
    const c = e.code;
    if (/^Key[A-Z]$/.test(c)) return c.slice(3);
    if (/^Digit[0-9]$/.test(c)) return c.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
    const map = { Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
      Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
      Backspace: 'Backspace', Minus: 'Minus', Equal: 'Plus', Backquote: '`' };
    return map[c] || null;
  }

  function shortcutCtl() {
    const kbd = h('span', { class: 'kbd' });
    const change = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Change');
    const off = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => set({ shortcut: '' }) }, 'Turn off');
    const stop = () => {
      recording = false;
      kbd.classList.remove('recording');
      change.textContent = 'Change';
      window.removeEventListener('keydown', onKey, true);
      sync();
    };
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') return stop();
      const key = keyName(e);
      const mods = [e.ctrlKey && 'CommandOrControl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
      if (!key || !mods.length) {
        kbd.textContent = mods.length ? mods.map((m) => pretty(m)).join(' + ') + ' + …' : 'Hold Ctrl / Alt / Shift + a key';
        return;
      }
      stop();
      set({ shortcut: [...mods, key].join('+') }).then((res) => { if (res && !res.error) toast('Shortcut saved'); });
    };
    change.addEventListener('click', () => {
      if (recording) return stop();
      recording = true;
      kbd.classList.add('recording');
      kbd.textContent = 'Press the keys… (Esc cancels)';
      change.textContent = 'Cancel';
      window.addEventListener('keydown', onKey, true);
    });
    ctl.shortcut = () => { if (!recording) kbd.textContent = pretty(s.shortcut); off.hidden = !s.shortcut; };
    return h('div', { class: 'row stack adv' },
      h('div', { class: 'row-label' }, h('span', { text: 'Keys that open Buddy' }), h('span', { class: 'hint', text: 'Press them anywhere to open or close Buddy.' })),
      h('div', { class: 'key-row' }, kbd, change, off));
  }

  // ------------------------------------------------ email (send only)
  const errText = (e) => ((e && e.message) || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

  /** A text field saved on "change"; an invalid value is rejected with a clear message. */
  function textCtl(key, { label, placeholder, type = 'text', validate, error, width = 'input-wide' }) {
    const input = h('input', { class: `input ${width}`, type, placeholder, 'aria-label': label, spellcheck: 'false', autocomplete: 'off', maxlength: 254 });
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (v && validate && !validate(v)) { toast(error, 'error'); input.value = s[key] ?? ''; return; }
      const value = type === 'number' ? Number(v) : v;
      const r = await set({ [key]: value });
      if (r && String(r.settings[key]).toLowerCase() !== String(value).toLowerCase()) toast(error, 'error');
      else if (r) refreshEmailStatus();
    });
    ctl[key] = () => { if (document.activeElement !== input) input.value = s[key] ?? ''; };
    return input;
  }
  const looksEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  const looksHost = (v) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v);
  const looksPort = (v) => /^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535;

  function serverRow(label, hint, prefix) {
    return h('div', { class: 'row stack' },
      h('div', { class: 'row-label' }, h('span', { text: label }), h('span', { class: 'hint', text: hint })),
      h('div', { class: 'server-row' },
        textCtl(`email${prefix}Host`, { label: `${label}: server`, placeholder: 'e.g. mail.example.com', validate: looksHost, error: "The server doesn't look valid (e.g. smtp.example.com).", width: 'input-host' }),
        textCtl(`email${prefix}Port`, { label: `${label}: port`, type: 'number', validate: looksPort, error: 'The port is a number from 1 to 65535.', width: 'input-port' }),
        selectCtl(`email${prefix}Security`, meta.emailSecurity, `${label}: security`)));
  }

  function emailGroup() {
    const presetSel = selectCtl('emailPreset', meta.emailPresets.map((p) => [p.id, p.label]), 'Email provider');
    const presetHint = h('span', { class: 'hint' });
    const passHost = h('div', {});
    const statusBox = h('p', { class: 'email-status', role: 'status' });
    const preview = h('div', { class: 'email-preview', hidden: true });

    const renderPass = () => {
      const p = meta.emailPresets.find((x) => x.id === s.emailPreset);
      presetHint.textContent = p ? p.passwordHint : '';
      if (!meta.encryptionAvailable) {
        passHost.replaceChildren(h('p', { class: 'error-text', text: "Encryption isn't available on this system, so the app doesn't save passwords." }));
        return;
      }
      if (s.emailPassword && s.emailPassword.saved && !replacingPass) {
        const actions = h('span', { class: 'foot-actions' });
        passHost.replaceChildren(h('div', { class: 'key-row' },
          h('span', { class: 'key-status' }, icon('key', 16), 'Saved, encrypted'),
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => { replacingPass = true; renderPass(); } }, 'Replace'),
          actions));
        confirmInline(actions, {
          label: 'Delete', question: 'Delete the password?',
          onConfirm: async () => { s.emailPassword = await window.api.email.clearPassword(); toast('Password deleted'); renderPass(); refreshStatus(); },
        });
        return;
      }
      const input = h('input', { class: 'input input-wide', type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: 'password', 'aria-label': 'Email password' });
      const err = h('p', { class: 'error-text', hidden: true });
      const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Save');
      const cancel = replacingPass ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { replacingPass = false; renderPass(); } }, 'Cancel') : null;
      const doSave = async () => {
        err.hidden = true;
        try {
          s.emailPassword = await window.api.email.setPassword(input.value);
          input.value = '';
          replacingPass = false;
          toast('Password saved, encrypted');
          renderPass();
          refreshStatus();
        } catch (e) { err.textContent = errText(e) || "Couldn't save the password."; err.hidden = false; }
      };
      save.addEventListener('click', doSave);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(); });
      const reenter = s.emailPassword && s.emailPassword.reenter && !replacingPass
        ? h('p', { class: 'error-text', text: 'You changed the server or the username, so the saved password was deleted. Type the password again.' }) : null;
      passHost.replaceChildren(...[reenter, h('div', { class: 'key-row' }, input, save, cancel), err].filter(Boolean));
    };

    async function refreshStatus() {
      try {
        const st = await window.api.email.status();
        statusBox.textContent = st.complete
          ? `Ready to send, from ${s.emailAddress}. Press "Check" to test the password. The app only sends, it never reads your emails.`
          : `To send emails, this is still missing: ${st.missing.join(', ')}.`;
      } catch { /* keep the last status text */ }
    }

    async function showPreview(kind) {
      try {
        const m = await window.api.email.preview(kind);
        preview.replaceChildren(
          h('div', { class: 'preview-head' },
            h('span', { class: 'muted', text: `To: ${m.to || '(your address, once you fill it in)'}` }),
            h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close the preview', onclick: () => { preview.hidden = true; } }, icon('close', 16))),
          h('div', { class: 'preview-subject', text: m.subject }),
          h('pre', { class: 'preview-body', text: m.text }));
        preview.hidden = false;
      } catch (e) { toast(errText(e) || "Couldn't make the preview", 'error'); }
    }

    const testBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, 'Check');
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true; testBtn.textContent = 'Connecting…';
      try {
        const r = await window.api.email.test();
        toast(r.ok ? 'Connected' : r.message, r.ok ? 'ok' : 'error');
        statusBox.textContent = r.message;
      } catch (e) { toast(errText(e) || "The test didn't work", 'error'); }
      testBtn.disabled = false; testBtn.textContent = 'Check';
    });
    const sendRangeBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, icon('mail', 16), 'Send the 30-day summary');
    sendRangeBtn.addEventListener('click', async () => {
      sendRangeBtn.disabled = true;
      try {
        const r = await window.api.email.sendRange();
        toast(r.sent ? r.message : (r.message || "It wasn't sent"), r.sent ? 'ok' : 'error');
      } catch (e) { toast(errText(e) || "The email wasn't sent", 'error'); }
      sendRangeBtn.disabled = false;
    });

    refreshEmailStatus = refreshStatus;
    ctl.email = () => { renderPass(); refreshStatus(); };

    return h('section', { class: 'group', 'aria-labelledby': 'g-email' },
      h('h2', { id: 'g-email', text: 'Email (sending)' }),
      statusBox,
      row('Which email you use', null, presetSel),
      h('div', { class: 'row stack' },
        h('div', { class: 'row-label' }, h('span', { text: 'Your email address' })),
        textCtl('emailAddress', { label: 'Your email address', placeholder: 'name@example.com', validate: looksEmail, error: "The email address doesn't look valid." })),
      h('div', { class: 'row stack' },
        h('div', { class: 'row-label' }, h('span', { text: 'Password' }), presetHint),
        passHost),
      h('details', { class: 'email-adv' },
        h('summary', {}, 'More options'),
        serverRow('Sending (SMTP)', 'Usually 465 with SSL / TLS or 587 with STARTTLS.', 'Smtp'),
        h('div', { class: 'row stack' },
          h('div', { class: 'row-label' }, h('span', { text: 'Username' }), h('span', { class: 'hint', text: 'Empty = same as the address.' })),
          textCtl('emailUsername', { label: 'Username', placeholder: 'same as the address' }))),
      row('Send the report when the timer stops', 'Automatically, on every Stop.', switchCtl('emailSendSessionReport', 'Send the report when the timer stops')),
      h('div', { class: 'row stack' },
        h('div', { class: 'row-label' }, h('span', { text: 'Reports go to' }), h('span', { class: 'hint', text: 'Empty = your address.' })),
        textCtl('emailReportTo', { label: 'Address for reports', placeholder: 'your address', validate: looksEmail, error: "The email address doesn't look valid." })),
      h('div', { class: 'row stack' },
        h('div', { class: 'row-label' }, h('span', { text: 'Preview' }), h('span', { class: 'hint', text: 'Exactly what would be sent. The preview sends nothing.' })),
        h('div', { class: 'key-row' },
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => showPreview('session') }, 'Last session report'),
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => showPreview('range') }, 'Last 30 days'))),
      preview,
      h('div', { class: 'row stack' },
        h('div', { class: 'row-label' }, h('span', { text: 'Send now' }), h('span', { class: 'hint', text: 'The summary of the last 30 days, to the address for reports.' })),
        h('div', { class: 'key-row' }, sendRangeBtn)),
      row('Check that it works', 'Connects and checks the password, without sending anything.', testBtn),
      h('p', { class: 'note-box', text: `Gmail settings checked on ${new Date(meta.emailVerifiedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}. Gmail needs 2-Step Verification and an app password. Personal Outlook.com accounts don't accept a password (they need OAuth), so they don't work here.` }));
  }

  // ------------------------------------------------ building: a menu of categories (like on a phone)
  // All controls are created once; the menu shows only the chosen category.
  const THEME_LABEL = { system: 'like the system', light: 'light', dark: 'dark' };
  const SIZE_LABEL = { 48: 'Small', 64: 'Medium', 80: 'Large' };
  let categories = [];
  let current = null;        // the open category (null = the menu)
  let menuSummary = {};      // id → element with the menu summary

  // ------------------------------------------------ customizing the buddy
  const BL = window.BuddyLook;
  let lookTimer = 0;
  const lookNow = () => BL.normalizeLook(s.buddyLook);

  // the buddy's level: special items unlock by working in sessions (see shared/progression.js)
  const PR = window.Progression;
  let level = 1;
  const lockOf = (kind, id) => { const r = PR.rewardOf(kind, id); return r && r.level > level ? r : null; };
  const lockedToast = (r) => toast(`${r.label}: unlocks at Level ${r.level} (you're at ${level}). Use the timer while you work to get there.`);
  window.api.progress.get().then((p) => { if (p) { level = p.level; sync(); } }).catch(() => {});
  window.api.progress.onChanged((p) => { const changed = p.level !== level; level = p.level; if (changed) sync(); });

  /** Changes the look: the preview updates right away, the save goes right away (or after 200 ms for the free color). */
  function setLook(next, { debounce = false } = {}) {
    const look = BL.normalizeLook(next);
    s.buddyLook = look;
    sync();
    clearTimeout(lookTimer);
    const save = () => set({ buddyLook: look });
    if (debounce) lookTimer = setTimeout(save, 200); else save();
  }

  /** A small buddy (drawn with the same code as the one on the desktop). */
  function miniBuddy(look, cls) {
    const body = h('div', { class: `bl-body ${cls}` });
    BL.build(body);
    BL.apply(body, look);
    return body;
  }

  function lookGroups() {
    const preview = h('div', { class: 'look-stage' });
    const tiles = {};   // section → container, rebuilt on every change
    const expanded = {};   // F12: sections where all locked items are shown
    /** Unlocked items first, then only the next 3 locked ones (by level) and a "+ N more" button. */
    const arrange = (id, entries) => {
      const open = entries.filter((e) => !e.lock).map((e) => e.el);
      const locked = entries.filter((e) => e.lock).sort((a, b) => a.lock.level - b.lock.level);
      if (expanded[id] || locked.length <= 3) return [...open, ...locked.map((e) => e.el)];
      const rest = locked.length - 3;
      return [...open, ...locked.slice(0, 3).map((e) => e.el),
        h('span', { class: 'look-more-row' }, h('button', { class: 'more-link look-more', type: 'button', onclick: () => { expanded[id] = true; render(); } }, `+ ${rest} more unlock with levels`))];
    };
    const section = (id, title, hint) => {
      tiles[id] = h('div', { class: id === 'palette' || id === 'hairColor' ? 'swatches' : 'look-grid', role: 'group', 'aria-label': title });
      return h('section', { class: 'group', 'aria-labelledby': `g-look-${id}` },
        h('h2', { id: `g-look-${id}`, text: title }),
        hint ? h('p', { class: 'look-hint', text: hint }) : null,
        tiles[id]);
    };
    const cheeks = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Cheeks', onchange: () => setLook({ ...lookNow(), cheeks: cheeks.checked }) });
    const colorInput = h('input', { type: 'color', 'aria-label': 'Your color', tabindex: '-1' });
    colorInput.addEventListener('input', () => setLook({ ...lookNow(), palette: 'custom', custom: colorInput.value }, { debounce: true }));

    const lockMark = () => h('span', { class: 'lock-mark', 'aria-hidden': 'true' }, icon('lock', 10));
    const tile = (label, pressed, variant, onclick, lock = null) => (lock
      ? h('button', { class: 'look-tile locked', type: 'button', 'aria-disabled': 'true', 'aria-pressed': 'false', title: `${label} · unlocks at Level ${lock.level}`, onclick: () => lockedToast(lock) },
        miniBuddy(variant, 'look-mini'), h('span', { text: `Level ${lock.level}` }), lockMark())
      : h('button', { class: 'look-tile', type: 'button', 'aria-pressed': String(pressed), title: label, onclick },
        miniBuddy(variant, 'look-mini'), h('span', { text: label })));
    // the color is set via CSSOM (style.background), not the style attribute, which the CSP blocks
    const dot = (bg) => { const d = h('span', { class: 'swatch-dot' }); if (bg) d.style.background = bg; return d; };
    const swatch = (label, pressed, bg, onclick, lock = null) => (lock
      ? h('button', { class: 'swatch locked', type: 'button', 'aria-disabled': 'true', 'aria-pressed': 'false', 'aria-label': `${label}, locked until Level ${lock.level}`, title: `${label} · Level ${lock.level}`, onclick: () => lockedToast(lock) }, dot(bg), lockMark())
      : h('button', { class: 'swatch', type: 'button', 'aria-pressed': String(pressed), 'aria-label': label, title: label, onclick }, dot(bg)));
    const levelBox = h('div', { class: 'look-level' });
    const mouthNote = h('p', { class: 'look-hint', text: 'This shape has a beak instead of a mouth: the mouth you pick shows on the other shapes.', hidden: true });
    const hairNote = h('p', { class: 'look-hint', text: "Hair doesn't show on this shape (the ears, corners or rays take its place). Hats still go on.", hidden: true });

    function render() {
      const L = lookNow();
      const SH = window.BuddyShapes.byId(L.shape);
      // on shapes without hair / with a beak, the hair and mouth tiles show on the circle, so you can see what you pick
      const onCircle = (v, need) => (need ? v : { ...v, shape: 'circle' });
      preview.replaceChildren(miniBuddy(L, 'look-big'));
      const all = [['palette', BL.PALETTES], ['eyes', BL.EYES], ['shape', BL.SHAPES], ['mouth', BL.MOUTHS], ['hair', BL.HAIRS], ['accessory', BL.ACCESSORIES]];
      const choices = all.reduce((n, [kind, list]) => n + list.filter((x) => !lockOf(kind, x.id)).length, 0);
      const nextR = PR.REWARDS.find((r) => r.level > level);
      levelBox.replaceChildren(h('span', { class: 'lvl-badge', 'aria-hidden': 'true', text: String(level) }),
        h('span', { text: `You have ${choices} things to choose from. Use the timer while you work to unlock more.${nextR ? ` Next, at Level ${nextR.level}: ${nextR.label}.` : ''}` }));
      tiles.palette.replaceChildren(
        ...arrange('palette', BL.PALETTES.map((p) => { const lock = lockOf('palette', p.id); return { lock, el: swatch(p.label, L.palette === p.id, `linear-gradient(150deg, ${p.a}, ${p.c ? `${p.c}, ` : ''}${p.b})`, () => setLook({ ...L, palette: p.id }), lock) }; })),
        h('label', { class: 'swatch swatch-custom', title: 'Your color', 'aria-pressed': String(L.palette === 'custom') },
          dot(L.palette === 'custom' ? L.custom : ''), colorInput));
      if (document.activeElement !== colorInput) colorInput.value = L.custom || BL.colorsOf(L).b;
      const entry = (kind, id, make) => { const lock = lockOf(kind, id); return { lock, el: make(lock) }; };
      tiles.eyes.replaceChildren(...arrange('eyes', BL.EYES.map((e) => entry('eyes', e.id, (lock) => tile(e.label, L.eyes === e.id, { ...L, eyes: e.id, accessories: L.accessories.filter((a) => a !== 'glasses') }, () => setLook({ ...L, eyes: e.id }), lock)))));
      tiles.shape.replaceChildren(...arrange('shape', BL.SHAPES.map((x) => entry('shape', x.id, (lock) => tile(x.label, L.shape === x.id, { ...L, shape: x.id }, () => setLook({ ...L, shape: x.id }), lock)))));
      tiles.mouth.replaceChildren(...arrange('mouth', BL.MOUTHS.map((m) => entry('mouth', m.id, (lock) => tile(m.label, L.mouth === m.id, onCircle({ ...L, mouth: m.id }, !SH.beak), () => setLook({ ...L, mouth: m.id }), lock)))));
      mouthNote.hidden = !SH.beak;
      hairNote.hidden = SH.hair;
      cheeks.checked = L.cheeks;
      tiles.hair.replaceChildren(...arrange('hair', BL.HAIRS.map((x) => entry('hair', x.id, (lock) => tile(x.label, L.hair === x.id, onCircle({ ...L, hair: x.id, accessories: L.accessories.filter((a) => a === 'glasses') }, SH.hair), () => setLook({ ...L, hair: x.id }), lock)))));
      tiles.hairColor.replaceChildren(...BL.HAIR_COLORS.map((c) => swatch(c.label, L.hairColor === c.id, c.c, () => setLook({ ...L, hairColor: c.id, hair: L.hair === 'none' ? 'tuft' : L.hair }))));
      tiles.acc.replaceChildren(...arrange('acc', BL.ACCESSORIES.map((a) => entry('accessory', a.id, (lock) => tile(a.label, L.accessories.includes(a.id), { ...L, accessories: [a.id] }, () => setLook(BL.toggleAccessory(L, a.id)), lock)))));
    }
    ctl.look = render;

    return [
      h('section', { class: 'group look-top' },
        preview,
        h('div', { class: 'key-row look-actions' },
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => setLook(BL.randomLook(Math.random, (kind, id) => !lockOf(kind, id))) }, icon('dice', 16), 'Random'),
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { setLook(BL.DEFAULT_LOOK); toast('The buddy looks like it did at the start'); } }, icon('undo', 16), 'Reset')),
        levelBox),
      section('shape', 'Shape', 'Free ones first. The ones with a lock come with levels.'),
      section('palette', 'Color', 'A ready-made palette or your own color (the last circle).'),
      section('eyes', 'Eyes'),
      h('section', { class: 'group', 'aria-labelledby': 'g-look-mouth' },
        h('h2', { id: 'g-look-mouth', text: 'Mouth and cheeks' }),
        mouthNote,
        (tiles.mouth = h('div', { class: 'look-grid', role: 'group', 'aria-label': 'Mouth' })),
        row('Cheeks', null, h('label', { class: 'switch' }, cheeks, h('span', { class: 'track', 'aria-hidden': 'true' })))),
      h('section', { class: 'group', 'aria-labelledby': 'g-look-hair' },
        h('h2', { id: 'g-look-hair', text: 'Hair' }),
        hairNote,
        (tiles.hair = h('div', { class: 'look-grid', role: 'group', 'aria-label': 'Hair' }))),
      section('hairColor', 'Hair color'),
      section('acc', 'Accessories and effects', 'One on the head, one on the side, one at the neck, glasses and one effect.'),
    ];
  }

  function buddyGroups() {
    const demo = (type, label) => h('button', { class: 'chip-btn', type: 'button', onclick: async () => {
      try { await window.api.settings.buddyDemo(type); } catch (e) { toast(errText(e) || "Couldn't do that", 'error'); }
    } }, label);
    const entryPreview = h('span', { class: 'look-entry-pic' });
    ctl.lookEntry = () => entryPreview.replaceChildren(miniBuddy(lookNow(), 'look-mini'));
    return [
      h('button', { class: 'look-entry', type: 'button', onclick: () => openCategory('look', { from: 'buddy' }) },
        entryPreview,
        h('span', { class: 'set-text' }, h('span', { class: 'set-label', text: 'Change how the buddy looks' }), h('span', { class: 'set-sum', text: 'Shape, color, eyes, mouth, hair, accessories' })),
        icon('chevron', 16)),
      h('section', { class: 'group', 'aria-labelledby': 'g-buddy-look' },
        h('h2', { id: 'g-buddy-look', text: 'On your screen' }),
        row('Show the buddy', 'You can also bring it back from the tray icon.', switchCtl('buddyVisible', 'Show the buddy')),
        row('Always above other windows', null, switchCtl('alwaysOnTop', 'Buddy always above other windows')),
        row('Size', null, segCtl('buddySize', [[48, 'Small'], [64, 'Medium'], [80, 'Large']], 'Buddy size')),
        row('How see-through', null, rangeCtl('buddyOpacity', 60, 100, 5, ' %', 'How see-through the buddy is'), 'adv')),
      h('section', { class: 'group adv', 'aria-labelledby': 'g-buddy-anim' },
        h('h2', { id: 'g-buddy-anim', text: 'Animations' }),
        row('Animations', "Waves, blinks, follows the mouse, falls asleep when you're away and cheers when you start or stop the timer.", switchCtl('buddyAnimations', 'Buddy animations')),
        h('div', { class: 'row stack' },
          h('div', { class: 'row-label' }, h('span', { text: 'See the animations' }), h('span', { class: 'hint', text: 'Look at the buddy and press one.' })),
          h('div', { class: 'chip-row' }, demo('wave', '👋 Wave'), demo('happy', '🎉 Happy'), demo('wow', '😮 Wow'), demo('think', '💭 Think'), demo('sleep', '💤 Sleep'), demo('levelup', '⭐ Level up')))),
      h('section', { class: 'group', 'aria-labelledby': 'g-buddy-pos' },
        h('h2', { id: 'g-buddy-pos', text: 'Position' }),
        row('Bring it back', 'If you lost it on another screen: moves it to the bottom-right corner.', h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { await window.api.settings.resetBuddy(); toast('The buddy is in the bottom-right corner'); } }, icon('target', 16), 'Reset'))),
    ];
  }

  function panelGroups() {
    return [h('section', { class: 'group solo', 'aria-labelledby': 'g-panel' },
      h('h2', { id: 'g-panel', text: 'Window and colors' }),
      row('Colors', null, selectCtl('theme', [['system', 'Like Windows'], ['light', 'Light'], ['dark', 'Dark']], 'Colors (theme)')),
      row('Close Buddy when you click somewhere else', null, switchCtl('hideOnBlur', 'Close Buddy when you click somewhere else'), 'adv'),
      shortcutCtl(),
      row('Start with Windows', 'The buddy shows up by itself after the computer starts.', switchCtl('launchAtLogin', 'Start with Windows')),
      powerRow())];
  }

  /** Low-power mode: 'auto' turns it on for a weak PC (4 GB RAM or 2 cores). */
  function powerRow() {
    const hint = h('span', { class: 'hint' });
    ctl.powerInfo = () => {
      const i = s.powerInfo || {};
      hint.textContent = i.low
        ? `On now${i.auto && i.reason ? ` (${i.reason})` : ''}: no animations, fewer checks, recording defaults to 720p, 15 frames.`
        : 'Off now. On "Auto" it turns on by itself on a PC with 4 GB RAM or 2 cores.';
    };
    return h('div', { class: 'row adv' },
      h('div', { class: 'row-label' }, h('span', { text: 'Power saver' }), hint),
      selectCtl('powerMode', [['auto', 'Auto'], ['on', 'On'], ['off', 'Off']], 'Power saver'));
  }

  function clipboardGroups() {
    const clearHost = h('span', { class: 'foot-actions' });
    confirmInline(clearHost, {
      label: 'Delete', question: "Sure? This can't be undone.",
      onConfirm: async () => { await window.api.clipboard.clear(false); toast('Copied history deleted'); },
    });
    return [h('section', { class: 'group solo', 'aria-labelledby': 'g-clip' },
      h('h2', { id: 'g-clip', text: 'Copied' }),
      row('Save what I copy', 'Text only, kept only on this computer. Passwords that your password manager marks as private are skipped.', switchCtl('clipboardEnabled', 'Save what I copy')),
      row("Don't keep passwords and secret codes", 'Skips text that looks like a secret key or an app password. Also removes the ones already kept.', switchCtl('clipboardSkipSecrets', "Don't keep passwords and secret codes")),
      row('How many to keep', "The ones you keep forever don't count.", rangeCtl('clipboardMax', 10, 200, 10, '', 'How many to keep')),
      row('Delete the whole history', "Removes every copied text, also the ones you keep forever. It can't be undone.", clearHost))];
  }

  function sessionGroups() {
    return [
      h('section', { class: 'group', 'aria-labelledby': 'g-timer' },
        h('h2', { id: 'g-timer', text: 'Timer' }),
        row('Show the small timer window', 'Shows up only while the timer runs.', switchCtl('timerVisible', 'Show the small timer window')),
        row('How see-through', null, rangeCtl('timerOpacity', 40, 100, 5, ' %', 'How see-through the timer is')),
        row('When you lock the screen', 'What the timer does when you press Win+L.', selectCtl('sessionOnLock', [['pause', 'Pause'], ['pause-resume', 'Pause, then go on'], ['ignore', 'Keep counting']], 'When you lock the screen')),
        row('Timer position', "If you can't find it on the screen.", h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { await window.api.session.resetTimer(); toast('The timer is at the top, in the middle'); } }, icon('target', 16), 'Reset'))),
      h('section', { class: 'group', 'aria-labelledby': 'g-notif' },
        h('h2', { id: 'g-notif', text: 'Notifications' }),
        row('Notifications', '"1 hour passed" for every hour of work, and how long you worked at the end.', switchCtl('notificationsEnabled', 'Notifications')),
        row('Check notifications', 'If nothing shows up, see if "Do not disturb" is on in Windows.', h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => {
          const ok = await window.api.session.testNotification();
          toast(ok ? 'Notification sent' : "This system doesn't support notifications", ok ? 'ok' : 'error');
        } }, 'Send a test'))),
      h('section', { class: 'group', 'aria-labelledby': 'g-track' },
        h('h2', { id: 'g-track', text: 'Apps you use' }),
        row('Note which apps I use', 'While the timer runs: which app is in front and for how long. Everything stays on your computer.', switchCtl('trackApps', 'Note which apps I use')),
        row('Also note window names', 'They may contain email subjects or file names. Off = app names only.', switchCtl('trackWindowTitles', 'Also note window names'))),
    ];
  }

  /** Help (was "About"): the tour, where the data lives, the version. */
  function helpGroups() {
    return [h('section', { class: 'group solo', 'aria-labelledby': 'g-help' },
      h('h2', { id: 'g-help', text: 'Help' }),
      row('The tour', 'A short walk through the app, step by step.', h('button', { class: 'btn btn-primary', id: 'setTour', type: 'button', onclick: () => { if (window.Panel) window.Panel.startTour(); } }, 'Show the tour again')),
      row('Where I keep your things', 'Settings, copied texts, notes, timer history.', h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => window.api.settings.openDataFolder() }, icon('folder', 16), 'Open')),
      row('Log file', 'If something went wrong, this file says what. It never contains your notes or copied texts.', h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => window.api.settings.openLogFolder() }, icon('folder', 16), 'Open')),
      row('Version', null, h('span', { class: 'muted', text: meta.version })))];
  }

  /** The first row of the menu: simple mode on / off (the whole app follows, every window). */
  function modeRow() {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': 'Simple mode', onchange: () => set({ uiMode: input.checked ? 'simple' : 'full' }) });
    ctl.uiMode = () => { input.checked = s.uiMode !== 'full'; };
    return h('div', { class: 'set-mode' },
      h('span', { class: 'set-tile tone-violet' }, icon('eyeOff', 18)),
      h('span', { class: 'set-text' }, h('span', { class: 'set-label', text: 'Simple mode' }), h('span', { class: 'set-sum', text: 'Shows only what you use often. The rest is under "More".' })),
      h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' })));
  }

  function build() {
    categories = [
      { id: 'buddy', label: 'Size and moves', icon: 'smile', tone: 'violet', groups: buddyGroups(),
        summary: () => `Level ${level} · ${SIZE_LABEL[s.buddySize] || 'Medium'} size · Animations ${s.buddyAnimations ? 'on' : 'off'}` },
      { id: 'look', label: 'How the buddy looks', icon: 'smile', tone: 'violet', hidden: true, groups: lookGroups(),
        summary: () => '' },
      { id: 'panel', label: 'Window and colors', icon: 'contrast', tone: 'slate', groups: panelGroups(),
        summary: () => `Colors: ${THEME_LABEL[s.theme] || ''} · Starts with Windows: ${s.launchAtLogin ? 'on' : 'off'}` },
      { id: 'help', label: 'Help', icon: 'info', tone: 'gray', groups: helpGroups(),
        summary: () => `The tour · version ${meta.version}` },
      { id: 'clipboard', label: 'Copied', icon: 'clipboard', tone: 'teal', more: true, groups: clipboardGroups(),
        summary: () => (s.clipboardEnabled ? `On · keeps ${s.clipboardMax}` : 'Paused') },
      { id: 'session', label: 'Time and timer', icon: 'clock', tone: 'amber', more: true, groups: sessionGroups(),
        summary: () => `Notifications ${s.notificationsEnabled ? 'on' : 'off'} · App list ${s.trackApps ? 'on' : 'off'}` },
      { id: 'email', label: 'Email', icon: 'mail', tone: 'rose', more: true, groups: [emailGroup()],
        summary: () => (s.emailAddress && s.emailPassword && s.emailPassword.saved ? `Ready · ${s.emailAddress}` : 'Not set up') },
    ];
    // single groups don't show their title (it's already in the page header)
    for (const c of categories) if (c.groups.length === 1) c.groups[0].classList.add('solo');
    menuSummary = {};
    showMenu();
  }

  function showMenu() {
    current = null;
    cameFrom = null;
    const catBtn = (c) => {
      const sum = h('span', { class: 'set-sum' });
      menuSummary[c.id] = sum;
      return h('button', { class: 'set-cat', type: 'button', dataset: { cat: c.id }, onclick: () => openCategory(c.id) },
        h('span', { class: `set-tile tone-${c.tone}` }, icon(c.icon, 18)),
        h('span', { class: 'set-text' }, h('span', { class: 'set-label', text: c.label }), sum),
        icon('chevron', 16));
    };
    const lookPic = h('span', { class: 'look-entry-pic' });
    lookPic.append(miniBuddy(lookNow(), 'look-mini'));
    const nav = h('nav', { class: 'set-menu', 'aria-label': 'Settings categories' },
      modeRow(),
      h('button', { class: 'set-cat', id: 'setLookEntry', type: 'button', dataset: { cat: 'look' }, onclick: () => openCategory('look') },
        lookPic,
        h('span', { class: 'set-text' }, h('span', { class: 'set-label', text: 'Change how the buddy looks' }), h('span', { class: 'set-sum', text: 'Shape, color, eyes, accessories' })),
        icon('chevron', 16)),
      ...categories.filter((c) => !c.hidden && !c.more).map(catBtn),
      h('div', { class: 'set-menu adv' }, h('h3', { class: 'set-more-head', text: 'More' }), ...categories.filter((c) => !c.hidden && c.more).map(catBtn)));
    nav.append(moreButton(nav, { label: 'More settings' }));
    root.replaceChildren(nav);
    root.scrollTop = 0;
    sync();
  }

  let cameFrom = null;   // the category that opened this one (Buddy → look), for the back button
  function openCategory(id, { from = null } = {}) {
    const c = categories.find((x) => x.id === id);
    if (!c) return;
    current = id;
    cameFrom = from;
    const parent = from && categories.find((x) => x.id === from);
    const back = parent
      ? h('button', { class: 'btn btn-ghost set-back', type: 'button', onclick: () => openCategory(parent.id) }, icon('back', 16), parent.label)
      : h('button', { class: 'btn btn-ghost set-back', type: 'button', onclick: () => { showMenu(); focusCat(id); } }, icon('back', 16), 'Settings');
    const page = h('div', { class: 'set-page' },
      h('div', { class: 'set-head' }, back,
        h('span', { class: `set-tile tile-sm tone-${c.tone}` }, icon(c.icon, 14)),
        h('h2', { class: 'set-title', text: c.label })),
      ...c.groups);
    if (page.querySelector('.adv')) page.append(moreButton(page, { label: 'More options' }));
    root.replaceChildren(page);
    root.scrollTop = 0;
    if (id === 'email') refreshEmailStatus();
    sync();
    back.focus();
  }

  function focusCat(id) {
    const b = root.querySelector(`.set-cat[data-cat="${id}"]`);
    if (b) b.focus();
  }

  function sync() {
    if (!s) return;
    Object.values(ctl).forEach((fn) => fn());
    for (const c of categories) if (menuSummary[c.id]) menuSummary[c.id].textContent = c.summary();
  }

  window.SettingsTab = {
    init(settings, info) {
      s = settings;
      meta = info;
      build();
    },
    onSettings(settings) {
      const keepPass = s && s.emailPassword;
      s = settings;
      if (!s.emailPassword && keepPass) s.emailPassword = keepPass;
      sync();
    },
    onShow() { /* stays on the open category */ },
    /** Back to the category menu (the tour points at a row in it). */
    showMenu() { if (current) showMenu(); },
    isRecording() { return recording; },
    /** Esc in a category: first back to the menu (doesn't close the panel). */
    onEscape() {
      if (!current) return false;
      const id = current;
      if (cameFrom) { openCategory(cameFrom); return true; }
      showMenu();
      focusCat(id);
      return true;
    },
    openCategory,
  };
})();
