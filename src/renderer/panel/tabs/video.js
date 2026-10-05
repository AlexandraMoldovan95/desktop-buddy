'use strict';
// The Video tab (Desktop Buddy Portfolio only): record a window, then cut clips from it.
// Advanced (under "More" in simple mode): automatic recording of windows chosen by rules.
// A rule = "the window title contains …". When such a window appears, recording starts by itself
// and stops when the window closes. The files (MP4) go to the folder from the settings below.
(function () {
  const { h, icon, plural, toast, moreButton } = window.UI;
  const root = document.getElementById('videoRoot');

  let s = null;             // the settings (public view)
  let st = { recording: null, auto: false, lastError: null };
  let items = [];           // saved recordings
  let folder = { path: '', custom: false };
  let picker = null;        // null | 'rule' | 'record': the list of open windows, for a rule or for a manual recording
  let windowsList = [];
  let windowsLoaded = false;
  let pickerTimer = 0;
  let visible = false;
  let timeEl = null;
  let infoEl = null;
  let tickBase = null;      // { activeMs, at } for the clock that runs between updates
  let justSaved = null;     // the recording that was just saved: "Done! Want to cut a piece?" (F13)

  const errText = (e) => ((e && e.message) || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Error';
  const fmt = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const p = (n) => String(n).padStart(2, '0');
    return t >= 3600 ? `${Math.floor(t / 3600)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}` : `${Math.floor(t / 60)}:${p(t % 60)}`;
  };
  const mb = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.max(0.1, b / 1e6).toFixed(1)} MB`);
  const when = (ts) => new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  async function set(patch) {
    try { const r = await window.api.settings.set(patch); s = r.settings; return r; } catch (e) { toast(errText(e), 'error'); return null; }
  }
  async function refreshList() { try { items = await window.api.recorder.list(); } catch { items = []; } }
  async function refreshFolder() { try { folder = await window.api.recorder.folder(); } catch { /* keep the last known folder */ } }

  function switchEl(checked, label, onChange) {
    const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label });
    input.checked = !!checked;
    input.addEventListener('change', () => onChange(input.checked));
    return h('label', { class: 'switch' }, input, h('span', { class: 'track', 'aria-hidden': 'true' }));
  }

  // ------------------------------------------------ status
  function statusCard() {
    const r = st.recording;
    if (r) {
      tickBase = { activeMs: r.activeMs, at: Date.now(), paused: r.paused || r.status !== 'recording' };
      timeEl = h('div', { class: 'big-time', text: fmt(r.activeMs) });
      const label = r.status === 'starting' ? 'Starting…'
        : r.status === 'stopping' ? 'Saving…'
          : r.status === 'waiting' ? 'Waiting for you to reopen the app'
            : r.status === 'attaching' ? 'Continuing the recording…'
              : r.paused ? 'Paused · nothing is moving' : 'Recording';
      const waitingNote = r.status === 'waiting'
        ? h('p', { class: 'muted rec-hint', text: `The window closed. If you open it again within ${Math.ceil((r.waitLeftMs || 0) / 1000)} s, I keep recording in the same file; otherwise I save it.` })
        : null;
      return h('section', { class: 'session-card rec-card', 'aria-labelledby': 'rec-now' },
        h('div', { class: 'head-row' },
          h('h2', { id: 'rec-now', text: 'Recording now' }),
          h('span', { class: 'state-badge ' + (r.paused || r.status === 'waiting' ? 'state-paused' : 'state-rec') }, h('span', { class: 'dot', 'aria-hidden': 'true' }), label)),
        h('div', { class: 'report-title', text: r.label }),
        r.window !== r.label ? h('div', { class: 'muted rec-window', text: r.window, title: r.window }) : null,
        timeEl,
        (infoEl = h('div', { class: 'muted adv', text: recInfo(r) })),
        waitingNote,
        h('div', { class: 'session-actions' },
          h('button', { class: 'btn btn-secondary', type: 'button', disabled: !['recording', 'waiting', 'attaching'].includes(r.status), onclick: markNow }, icon('flag', 16), 'Remember this moment'),
          h('button', { class: 'btn btn-danger', type: 'button', disabled: !['recording', 'waiting', 'attaching'].includes(r.status), onclick: stopNow }, icon('stop', 16), 'Stop and save')),
        markHint(r));
    }
    const ruled = st.auto && (s.recRules || []).some((x) => x.enabled);
    const hint = ruled
      ? 'Press the button and pick a window. Your rules (under More) can also start a recording by themselves.'
      : 'Press the button and pick the window you want to record.';
    return h('section', { class: 'session-card', 'aria-labelledby': 'rec-idle' },
      h('div', { class: 'head-row' },
        h('h2', { id: 'rec-idle', text: 'Record a window' }),
        h('span', { class: 'state-badge state-idle' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), 'Not recording')),
      h('p', { class: 'muted rec-hint', text: hint }),
      st.lastError ? h('p', { class: 'error-text', role: 'alert', text: st.lastError }) : null,
      h('div', { class: 'session-actions' },
        h('button', { class: 'btn btn-primary btn-big', id: 'recStart', type: 'button', 'aria-expanded': String(picker === 'record'), onclick: () => openPicker('record') }, icon('rec', 18), 'Record a window')),
      h('p', { class: 'rec-warn' }, icon('info', 14), h('span', { text: "No sound. Don't minimize the window while I record." })),
      picker === 'record' ? pickerBlock() : null);
  }

  /** After a recording is saved: one step to cutting a clip from it (F13). */
  function savedCard() {
    const it = justSaved && items.find((x) => x.id === justSaved);
    if (!it) return null;
    return h('section', { class: 'session-card saved-card', role: 'status', 'aria-labelledby': 'rec-saved' },
      h('div', { class: 'head-row' },
        h('h2', { id: 'rec-saved', text: 'Done! The video is saved' }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close this message', title: 'Close', onclick: () => { justSaved = null; render(); } }, icon('close', 16))),
      h('p', { class: 'muted rec-hint', text: 'Want to cut a piece out of it?' }),
      h('div', { class: 'session-actions' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { justSaved = null; window.api.recorder.edit(it.id).catch((e) => toast(errText(e), 'error')); render(); } }, icon('cut', 16), 'Cut a clip'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => window.api.recorder.open(it.id).catch((e) => toast(errText(e), 'error')) }, icon('play', 16), 'Watch')));
  }

  async function markNow() {
    try { const res = await window.api.recorder.mark(); if (res && res.t !== null) toast("I'll remember this moment ⚑"); } catch (e) { toast(errText(e), 'error'); }
  }
  function markHint(r) {
    const n = r.marks || 0;
    const text = `Press it (or the flag next to the buddy) when something good happens. When you cut the clip, you can jump straight to it. Moments so far: ${n}.`;
    return h('p', { class: 'muted rec-hint', id: 'markHint', text });
  }
  const recInfo = (r) => `${mb(r.bytes)} · ${r.manual ? 'started by you' : `rule "${r.rule}"`}${r.parts > 1 ? ` · ${r.parts} runs joined` : ''}`;

  async function stopNow() {
    try { st = await window.api.recorder.stop(); render(); } catch (e) { toast(errText(e), 'error'); }
  }

  // ------------------------------------------------ picking an open window
  /** The window list refreshes every 2 s while open: an app started after the list opened shows up by itself. */
  async function loadWindows() {
    try {
      const next = await window.api.recorder.windows();
      const changed = JSON.stringify(next) !== JSON.stringify(windowsList) || !windowsLoaded;
      windowsList = next;
      windowsLoaded = true;
      if (changed && picker && visible && !typing()) render();
    } catch (e) { toast(errText(e), 'error'); }
  }
  function closePicker() {
    picker = null;
    clearInterval(pickerTimer);
    pickerTimer = 0;
  }
  async function openPicker(kind) {
    const same = picker === kind;
    closePicker();
    if (same) { render(); return; }
    picker = kind;
    windowsList = [];
    windowsLoaded = false;
    render();
    await loadWindows();
    pickerTimer = setInterval(() => { if (picker && visible) loadWindows(); }, 2000);
  }

  function pickerBlock() {
    const list = windowsList.length
      ? h('ul', { class: 'pick-list' }, ...windowsList.map((w) => h('li', {},
          h('button', { type: 'button', class: 'pick-btn', title: w.name, onclick: () => pick(w) }, w.name))))
      : h('p', { class: 'muted', text: windowsLoaded ? "Can't find any window. If the app is minimized, open it again; the list updates by itself." : 'Looking for open windows…' });
    return h('div', { class: 'picker' },
      h('div', { class: 'picker-head' },
        h('span', { class: 'report-sub', text: picker === 'rule' ? 'Pick the window for the rule' : 'Which window should I record?' }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close the list', onclick: () => { closePicker(); render(); } }, icon('close', 16))),
      list,
      h('p', { class: 'muted pick-note', text: "The list updates by itself. Minimized windows don't show up." }));
  }

  async function pick(w) {
    const kind = picker;
    closePicker();
    if (kind === 'record') {
      try { st = await window.api.recorder.start(w.id); toast('Starting the recording'); } catch (e) { toast(errText(e), 'error'); }
      render();
      return;
    }
    // rule: the full title; you can shorten it later (e.g. just "Note Organizer")
    await addRule(w.name);
  }

  // ------------------------------------------------ rules
  async function addRule(title) {
    const t = String(title || '').trim();
    if (!t) return;
    const rules = [...(s.recRules || [])];
    if (rules.some((r) => r.title.toLowerCase() === t.toLowerCase())) { toast('This rule already exists'); return; }
    if (rules.length >= 20) { toast('20 rules at most', 'error'); return; }
    rules.push({ id: newId(), title: t.slice(0, 120), enabled: true });
    if (await set({ recRules: rules })) { toast(t.length > 30 ? 'Rule added: you can shorten it' : 'Rule added'); render(); }
  }

  async function updateRule(id, patch) {
    const rules = (s.recRules || []).map((r) => (r.id === id ? { ...r, ...patch } : r)).filter((r) => r.title.trim());
    if (await set({ recRules: rules })) render();
  }

  function rulesCard() {
    const input = h('input', { class: 'input input-wide', type: 'text', maxlength: 120, placeholder: 'App name (e.g. Note Organizer)', 'aria-label': 'App name or text from the window title' });
    const add = () => { addRule(input.value); input.value = ''; };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
    const rules = s.recRules || [];
    return h('section', { class: 'session-card adv', 'aria-labelledby': 'rec-rules' },
      h('div', { class: 'head-row' },
        h('h2', { id: 'rec-rules', text: 'Start by itself (for experts)' }),
        switchEl(s.recAuto, 'Start recording by itself', async (on) => { await set({ recAuto: on }); })),
      h('p', { class: 'muted rec-hint', text: "When this is on, recording starts by itself when a window whose title contains a rule's text appears, and stops when the window closes. Upper or lower case doesn't matter." }),
      rules.length
        ? h('ul', { class: 'rule-list' }, ...rules.map((r) => {
            const t = h('input', { class: 'input rule-input', type: 'text', maxlength: 120, value: r.title, 'aria-label': 'Rule text' });
            t.addEventListener('change', () => { const v = t.value.trim(); if (v && v !== r.title) updateRule(r.id, { title: v }); else t.value = r.title; });
            return h('li', { class: 'rule-row' + (r.enabled ? '' : ' off') },
              switchEl(r.enabled, `Rule ${r.title}`, (on) => updateRule(r.id, { enabled: on })),
              t,
              h('button', { class: 'icon-btn', type: 'button', 'aria-label': `Delete rule ${r.title}`, title: 'Delete rule',
                onclick: () => set({ recRules: rules.filter((x) => x.id !== r.id) }).then(() => render()) }, icon('trash', 16)));
          }))
        : null,
      h('div', { class: 'start-row' }, input, h('button', { class: 'btn btn-secondary', type: 'button', onclick: add }, icon('plus', 16), 'Add')),
      h('button', { class: 'more-link', type: 'button', onclick: () => openPicker('rule') }, 'or pick from the open windows'),
      picker === 'rule' ? pickerBlock() : null);
  }

  // ------------------------------------------------ saved recordings
  function listCard() {
    // cut clips show up in the editor, not here; here only their count, on the recording they come from
    const clipCount = {};
    items.forEach((it) => { if (it.clipOf) clipCount[it.clipOf] = (clipCount[it.clipOf] || 0) + 1; });
    const rows = items.filter((it) => !it.clipOf).slice(0, 10).map((it) => {
      const nMarks = Array.isArray(it.marks) ? it.marks.length : 0;
      const nClips = it.clips || clipCount[it.id] || 0;
      const extra = [nMarks ? plural(nMarks, 'mark') : '', nClips ? plural(nClips, 'clip') : ''].filter(Boolean);
      const actions = h('span', { class: 'rec-actions' },
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': `Watch ${it.name}`, title: 'Watch', onclick: () => window.api.recorder.open(it.id) }, icon('play', 14), 'Watch'),
        h('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': `Cut a clip from ${it.name}`, title: 'Cut a clip', onclick: () => window.api.recorder.edit(it.id) }, icon('cut', 14), 'Cut a clip'),
        h('button', { class: 'icon-btn adv', type: 'button', 'aria-label': `Show ${it.name} in folder`, title: 'Show in folder', onclick: () => window.api.recorder.show(it.id) }, icon('folder', 16)));
      // two-step delete: the first click asks, the second moves it to the Recycle Bin (it can be restored from there)
      const del = h('button', { class: 'icon-btn adv', type: 'button', 'aria-label': `Move ${it.name} to the Recycle Bin`, title: 'Move to Recycle Bin' }, icon('trash', 16));
      let armed = 0;
      del.addEventListener('click', async () => {
        if (!armed) {
          del.replaceChildren('Sure?');
          del.classList.add('armed');
          armed = setTimeout(() => { armed = 0; del.classList.remove('armed'); del.replaceChildren(icon('trash', 16)); }, 3000);
          return;
        }
        clearTimeout(armed);
        try { await window.api.recorder.trash(it.id); toast('Moved to Recycle Bin'); } catch (e) { toast(errText(e), 'error'); }
        await refreshList(); render();
      });
      return h('li', { class: 'rec-item' },
        h('div', { class: 'rec-main' },
          h('div', { class: 't', text: it.label, title: it.name }),
          h('div', { class: 'when', text: [`${when(it.startedAt)}`, it.reason === 'recovered' && !it.activeMs ? 'length unknown' : fmt(it.activeMs), mb(it.bytes), ...extra].join(' · ') }),
          actions),
        del);
    });
    return h('section', { class: 'session-card', 'aria-labelledby': 'rec-list' },
      h('div', { class: 'head-row' },
        h('h2', { id: 'rec-list', text: 'Your videos' }),
        h('button', { class: 'btn btn-ghost adv', type: 'button', onclick: () => window.api.recorder.openFolder() }, icon('folder', 16), 'Folder')),
      rows.length ? h('ul', { class: 'day-list rec-list' }, ...rows) : h('p', { class: 'muted', text: "You haven't recorded anything yet." }));
  }

  // ------------------------------------------------ settings
  function seg(key, options, label) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': label },
      ...options.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(String(s[key]) === String(v)), onclick: async () => { await set({ [key]: v }); render(); } }, t)));
  }
  function select(key, options, label) {
    const el = h('select', { 'aria-label': label }, ...options.map(([v, t]) => h('option', { value: String(v) }, t)));
    el.value = String(s[key]);
    el.addEventListener('change', () => set({ [key]: Number(el.value) }));
    return el;
  }
  const row = (label, hint, control) => h('div', { class: 'row' },
    h('div', { class: 'row-label' }, h('span', { text: label }), hint ? h('span', { class: 'hint', text: hint }) : null), control);

  function settingsCard() {
    const details = h('details', { class: 'rec-settings' },
      h('summary', {}, 'Recording settings'),
      h('div', { class: 'row stack' },
        h('div', { class: 'row-label' }, h('span', { text: 'Folder' }), h('span', { class: 'hint path', text: folder.label })),
        h('div', { class: 'key-row' },
          h('button', { class: 'btn btn-secondary', type: 'button', onclick: async () => { const p = await window.api.recorder.chooseFolder(); if (p) { toast('Folder changed'); await refreshFolder(); render(); } } }, 'Change…'),
          folder.custom ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: async () => { await window.api.recorder.resetFolder(); await refreshFolder(); render(); } }, 'Default') : null)),
      row('Quality', 'Higher = bigger files.', seg('recQuality', [['720', '720p'], ['1080', '1080p'], ['1440', '1440p']], 'Quality')),
      row('Frames per second', '60 is smoother, but doubles the size. 15 is easier on a slow PC.', seg('recFps', [[15, '15'], [30, '30'], [60, '60']], 'Frames per second')),
      row('Skip still moments', 'Recording pauses while the picture doesn\'t change (e.g. while a page is loading) and resumes at the first change. Shorter clips, only with action.', switchEl(s.recSkipIdle, 'Skip still moments', (on) => set({ recSkipIdle: on }).then(() => render()))),
      s.recSkipIdle ? row('Pause after no movement for', null, select('recIdleSec', [[0.5, '0.5 s'], [1, '1 s'], [1.5, '1.5 s'], [2, '2 s'], [3, '3 s'], [5, '5 s']], 'Pause after no movement for')) : null,
      row('Join quick restarts', 'If the app closes and reopens quickly (e.g. repeated tests), recording continues in the same file, without the gap between them.', select('recMergeSec', [[0, 'No'], [5, '5 s'], [15, '15 s'], [30, '30 s'], [60, '1 min']], 'Join quick restarts')),
      row('Maximum length', 'Safety: after this, recording stops by itself.', select('recMaxMinutes', [[5, '5 min'], [10, '10 min'], [30, '30 min'], [60, '1 hour'], [120, '2 hours']], 'Maximum length')),
      row('Notifications', 'When recording starts and when the file is saved.', switchEl(s.recNotify, 'Recording notifications', (on) => set({ recNotify: on }))),
      h('p', { class: 'note-box', text: 'No sound. The window can be covered by others, but not minimized. Windows 11 may draw a border around the window while it is recorded. Everything stays on your computer.' }));
    return h('section', { class: 'session-card rec-settings-card adv' }, details);
  }

  // ------------------------------------------------ drawing
  let settingsOpen = false;
  function render() {
    const open = root.querySelector('details.rec-settings');
    if (open) settingsOpen = open.open;
    const scroll = root.scrollTop;
    timeEl = null;
    infoEl = null;
    if (!s) return;
    root.replaceChildren(savedCard() || document.createComment('saved'), statusCard(), listCard(), rulesCard(), settingsCard(),
      moreButton(root, { label: 'More: start by itself, settings', extraClass: 'more-bottom' }));
    const d = root.querySelector('details.rec-settings');
    if (d) { d.open = settingsOpen; d.addEventListener('toggle', () => { settingsOpen = d.open; }); }
    root.scrollTop = scroll;
  }

  // the recording clock also runs between updates from the app (they come once a second)
  setInterval(() => {
    if (!visible || !timeEl || !tickBase || tickBase.paused) return;
    timeEl.textContent = fmt(tickBase.activeMs + (Date.now() - tickBase.at));
  }, 250);

  const typing = () => {
    const a = document.activeElement;
    return !!(a && root.contains(a) && a.tagName === 'INPUT' && a.type === 'text');
  };

  window.api.recorder.onChanged(async (next) => {
    const was = st.recording;
    st = next;
    if (was && !next.recording) {   // one was just saved
      await refreshList();
      const newest = items.find((it) => !it.clipOf);
      justSaved = newest ? newest.id : null;
    }
    if (!visible) return;
    if (typing()) return;
    // quick update of the clock only, without redrawing everything every second
    if (was && next.recording && was.status === next.recording.status && next.recording.status !== 'waiting' && !!was.paused === !!next.recording.paused && timeEl) {
      tickBase = { activeMs: next.recording.activeMs, at: Date.now(), paused: next.recording.paused };
      if (infoEl) infoEl.textContent = recInfo(next.recording);
      const mh = document.getElementById('markHint');
      if (mh) mh.replaceWith(markHint(next.recording));
      return;
    }
    render();
  });

  window.VideoTab = {
    async init(settings) {
      s = settings;
      try { st = await window.api.recorder.state(); } catch { /* keep the default state; the change event updates it */ }
      await Promise.all([refreshList(), refreshFolder()]);
      render();
    },
    onSettings(settings) {
      s = settings;
      st = { ...st, auto: !!settings.recAuto };
      refreshFolder().then(() => { if (visible && !typing()) render(); });
    },
    async onShow() {
      visible = true;
      try { st = await window.api.recorder.state(); } catch { /* keep the last known state */ }
      await Promise.all([refreshList(), refreshFolder()]);
      render();
    },
    onHide() { visible = false; closePicker(); justSaved = null; root.classList.remove('show-adv'); },   // "More" closes again
  };
})();
