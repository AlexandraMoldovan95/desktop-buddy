'use strict';
// The Time tab (internally still "session"): start the timer with a title, pause it, stop it; see what you worked on today.
(function () {
  const { h, icon, plural, toast, confirmInline } = window.UI;
  const root = document.getElementById('sessionRoot');

  let session = null;
  let today = { records: [], totalMs: 0 };
  let settings = null;
  let lastSummary = null;
  let timeEl = null;
  let visible = false;
  let focusStart = false;   // the next start card takes the focus (the tab was opened, not reached with arrow keys)
  let activity = { state: 'stopped' };
  let liveApps = [];
  let prog = null;         // the buddy's progress (level, XP, streak), computed in the main process

  const fmt = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const p = (n) => String(n).padStart(2, '0');
    return `${Math.floor(t / 3600)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
  };
  const fmtShort = (ms) => {
    if (ms < 1000) return '0 min';   // "0 s" read like an error
    if (ms < 60000) return `${Math.round(ms / 1000)} s`;
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };
  const hm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const activeMs = (s) => (s ? s.segments.reduce((sum, seg) => sum + Math.max(0, (seg.end ?? Date.now()) - seg.start), 0) : 0);

  /** Top apps in the current session (from `session.usage`). */
  function computeLiveApps(sess) {
    const apps = {};
    for (const d of Object.values((sess && sess.usage) || {})) {
      for (const [name, ms] of Object.entries(d.apps || {})) apps[name] = (apps[name] || 0) + ms;
    }
    return Object.entries(apps).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, ms]) => ({ name, ms }));
  }

  function activityLine() {
    if (!session) return null;
    const line = (text, extra) => h('div', { class: 'activity-line adv' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), h('span', { text }), extra || null);
    if (settings && !settings.trackApps) return line('Noting which apps you use is off (Settings).');
    if (session.state !== 'running') return line('Paused: no apps are being noted.');
    switch (activity.state) {
      case 'ok': return line('Noting which app you use.');
      case 'starting': return line('Starting to note apps…');
      case 'permission':
        return line('Window titles are missing: give the app Accessibility access.',
          h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => window.api.session.openPermissions() }, 'Open settings'));
      case 'unsupported':
      case 'error': return line(activity.message || "App tracking isn't working.");
      default: return line('Noting apps starts in a few seconds.');
    }
  }

  function liveAppsBlock() {
    if (!session || !liveApps.length) return null;
    const total = liveApps.reduce((t, a) => t + a.ms, 0) || 1;
    return h('div', { class: 'report-apps adv' },
      h('div', { class: 'report-sub', text: 'Apps used so far' }),
      h('ul', { class: 'app-bars' }, ...liveApps.map((a) => h('li', {},
        h('div', { class: 'app-row' }, h('span', { class: 't', text: a.name }), h('span', { class: 'dur', text: fmtShort(a.ms) })),
        h('div', { class: 'app-track' }, h('span', { class: 'app-fill', dataset: { w: String(Math.max(2, Math.round((a.ms / total) * 100))) } }))))));
  }

  async function refreshToday() {
    try { today = await window.api.session.today(); } catch { /* keep what we had */ }
  }

  // ------------------------------------------------ UI pieces
  function startCard() {
    const input = h('input', { class: 'input', type: 'text', maxlength: 120, placeholder: 'What are you working on?', 'aria-label': 'What are you working on?' });
    const start = async () => {
      try {
        await window.api.session.start(input.value);
        lastSummary = null;
        toast('Timer started');
      } catch (e) { toast(clean(e), 'error'); }
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
    // F-M1: only when the tab was opened (not by arrow keys), or the focus was already in this tab
    const want = focusStart;
    focusStart = false;
    setTimeout(() => {
      const a = document.activeElement;
      if (visible && (want || !a || a === document.body || root.contains(a))) input.focus();
    }, 0);
    return h('section', { class: 'session-card', 'aria-labelledby': 'ses-start' },
      h('h2', { id: 'ses-start', text: 'Start the timer' }),
      h('div', { class: 'start-row' }, input,
        h('button', { class: 'btn btn-primary', type: 'button', onclick: start }, icon('play', 16), 'Start')));
  }

  function activeCard() {
    const running = session.state === 'running';
    const title = h('input', { id: 'sesTitle', class: 'input input-wide', type: 'text', maxlength: 120, 'aria-label': 'What you are working on', value: session.title });
    const saveTitle = async () => {
      const v = title.value.trim();
      if (v && v !== session.title) { await window.api.session.rename(v); toast('Title saved'); }
    };
    title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); if (e.key === 'Escape') { title.value = session.title; title.blur(); } });
    title.addEventListener('blur', saveTitle);

    timeEl = h('div', { class: 'big-time' + (running ? '' : ' paused'), text: fmt(activeMs(session)) });
    const stopHost = h('span', { class: 'foot-actions' });
    confirmInline(stopHost, {
      label: 'Stop', question: 'Stop the timer?',
      onConfirm: async () => { try { await window.api.session.stop(); } catch (e) { toast(clean(e), 'error'); } },
    });

    return h('section', { class: 'session-card', 'aria-labelledby': 'ses-now' },
      h('div', { class: 'head-row' },
        h('h2', { id: 'ses-now', text: 'Timer' }),
        h('span', { class: 'state-badge ' + (running ? 'state-running' : 'state-paused') },
          h('span', { class: 'dot', 'aria-hidden': 'true' }), running ? 'Running' : (session.recovered ? 'Paused · recovered' : 'Paused'))),
      title,
      timeEl,
      session.recovered ? h('p', { class: 'muted', style: null, text: 'The app closed suddenly. Your time is kept up to the last save (at most 15 seconds lost).' }) : null,
      h('div', { class: 'session-actions' },
        running
          ? h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => window.api.session.pause() }, icon('pause', 16), 'Pause')
          : h('button', { class: 'btn btn-primary', type: 'button', onclick: () => window.api.session.resume() }, icon('play', 16), 'Resume'),
        stopHost,
        settings && !settings.timerVisible
          ? h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => window.api.session.showTimer() }, icon('eye', 16), 'Show timer')
          : null),
      activityLine(),
      liveAppsBlock());
  }

  function emailLine(e) {
    if (e.pending) return 'Email: sending…';
    if (e.sent) return `Email: report sent to ${e.to}.`;
    return `Email: the report wasn't sent (${e.message || 'error'}).`;
  }

  function summaryCard() {
    if (!lastSummary) return null;
    const r = lastSummary;
    if (!r.saved) {
      return h('div', { class: 'summary', role: 'status' },
        h('strong', { text: `Timer stopped: ${r.title}` }), 'It ran for less than a second, so it was not saved.');
    }
    const facts = [
      ['Work time', fmt(r.activeMs)],
      ['From – to', `${hm(r.startedAt)} – ${hm(r.endedAt)}`],
      ['Breaks', r.pauses ? `${r.pauses} · ${fmtShort(r.pausedMs)}` : 'no breaks'],
    ];
    const total = r.apps.reduce((t, a) => t + a.ms, 0) || 1;
    return h('section', { class: 'session-card report', 'aria-labelledby': 'ses-report', role: 'status' },
      h('div', { class: 'head-row' },
        h('h2', { id: 'ses-report', text: 'How long you worked' }),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close the report', title: 'Close the report', onclick: () => { lastSummary = null; render(); } }, icon('close', 16))),
      h('div', { class: 'report-title', text: r.title }),
      r.email ? h('p', { class: 'report-email', id: 'reportEmail', text: emailLine(r.email) }) : null,
      h('dl', { class: 'report-facts' }, ...facts.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])),
      h('div', { class: 'report-apps adv' },
        h('div', { class: 'report-sub', text: 'Apps used' }),
        r.apps.length
          ? h('ul', { class: 'app-bars' }, ...r.apps.slice(0, 8).map((a) => h('li', {},
              h('div', { class: 'app-row' }, h('span', { class: 't', text: a.name }), h('span', { class: 'dur', text: fmtShort(a.ms) })),
              h('div', { class: 'app-track' }, h('span', { class: 'app-fill', dataset: { w: String(Math.max(2, Math.round((a.ms / total) * 100))) } })),
              a.titles && a.titles.length
                ? h('ul', { class: 'app-titles' }, ...a.titles.map((t) => h('li', {}, h('span', { class: 't', text: t.title }), h('span', { class: 'dur', text: fmtShort(t.ms) }))))
                : null)))
          : h('p', { class: 'muted', text: 'No apps noted (it was off, or the timer ran only briefly).' })));
  }

  function todayCard() {
    const records = [...today.records].sort((a, b) => b.start - a.start);
    const items = records.map((r) => h('li', {},
      h('div', { style: null },
        h('div', { class: 't', text: r.title }),
        h('div', { class: 'when', text: `${hm(r.start)} – ${hm(r.end)}${r.parts ? ` · part ${r.part} of ${r.parts}` : ''}` })),
      h('span', { class: 'dur', text: fmtShort(r.activeMs) })));
    return h('section', { class: 'session-card', 'aria-labelledby': 'ses-today' },
      h('div', { class: 'total-row' }, h('span', { id: 'ses-today', text: 'Today' }), h('span', { id: 'todayTotal', text: fmtShort(today.totalMs) })),
      items.length
        ? h('ul', { class: 'day-list' }, ...items)
        : h('p', { class: 'muted', text: session ? 'The running timer shows up here after you stop it.' : 'Nothing finished today yet.' }),
      h('button', { class: 'btn btn-secondary stats-open', type: 'button', onclick: () => window.api.session.openStats() },
        icon('chart', 16), 'Statistics: all days'));
  }

  // ------------------------------------------------ the growing buddy: level, XP, streak
  const PR = window.Progression;
  const BL = window.BuddyLook;
  const pill = document.getElementById('lvlPill');
  pill.addEventListener('click', () => document.getElementById('tab-session').click());

  /** The current look with the reward applied, as a preview. */
  function withReward(look, r) {
    const L = BL.normalizeLook(look);
    if (r.kind === 'palette') return { ...L, palette: r.id };
    if (r.kind === 'eyes') return { ...L, eyes: r.id };
    if (r.kind === 'shape') return { ...L, shape: r.id };
    if (r.kind === 'mouth') return { ...L, shape: 'circle', mouth: r.id };
    if (r.kind === 'hair') return { ...L, shape: 'circle', hair: r.id };
    return BL.toggleAccessory({ ...L, accessories: L.accessories.filter((id) => id !== r.id) }, r.id);
  }

  function progressCard() {
    if (!prog) return null;
    const pct = prog.levelSpan ? Math.min(100, Math.round((prog.levelXp / prog.levelSpan) * 100)) : 100;
    const goal = PR.STREAK_MIN_MS / 60000;
    const todayLine = prog.todayCounts
      ? h('span', { class: 'ok-text', text: 'Today counts!' })
      : h('span', { text: `Today: ${Math.floor(prog.todayMs / 60000)} of ${goal} minutes` });
    let next = null;
    if (prog.nextReward) {
      const pic = h('span', { class: 'prog-next-pic' });
      const body = h('div', { class: 'bl-body look-mini' });
      BL.build(body);
      // since 1.9.0 some levels give two things (a shape + something else): show both, the shape last so it is visible
      const at = PR.REWARDS.filter((r) => r.level === prog.nextReward.level).sort((a, b) => (a.kind === 'shape') - (b.kind === 'shape'));
      BL.apply(body, at.reduce((look, r) => withReward(look, r), settings ? settings.buddyLook : BL.DEFAULT_LOOK));
      pic.append(body, h('span', { class: 'prog-lock' }, icon('lock', 11)));
      next = h('div', { class: 'prog-next' }, pic,
        h('span', { class: 'prog-next-text' }, h('span', { class: 'prog-next-label', text: `Level ${prog.nextReward.level} unlocks: ` }), at.map((r) => r.label).join(' + ')));
    }
    return h('section', { class: 'session-card prog-card', 'aria-labelledby': 'progTitle' },
      h('div', { class: 'prog-head' },
        h('span', { class: 'lvl-badge', 'aria-hidden': 'true', text: String(prog.level) }),
        h('div', { class: 'prog-text' },
          h('div', { class: 'prog-title', id: 'progTitle', text: `Level ${prog.level} · ${prog.title}` }),
          h('div', { class: 'prog-sub', text: prog.toNext ? `${plural(prog.toNext, 'more minute')} of work to reach Level ${prog.level + 1}` : 'Top level!' }))),
      h('div', { class: 'xp-bar', role: 'progressbar', 'aria-label': 'Progress to the next level', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
        h('span', { class: 'xp-fill', dataset: { w: pct } })),
      h('div', { class: 'prog-stats' },
        h('span', { class: 'streak' + (prog.streak ? ' on' : '') }, icon('flame', 15), `Days in a row: ${prog.streak}`),
        prog.bestStreak > prog.streak ? h('span', { class: 'muted adv' }, icon('trophy', 14), `best ${prog.bestStreak}`) : null,
        todayLine),
      next,
      h('details', { class: 'prog-how' },
        h('summary', {}, 'How do I grow?'),
        h('p', { class: 'prog-help', text: `Start the timer (above) when you work: only timer minutes count, 1 XP per minute (pauses don't). Your XP is never lost: stopped sessions stay in your history. ${goal} minutes a day keep your days in a row going; a weekend off doesn't break it, and a full day gives a bonus.` })));
  }

  function renderPill() {
    if (!prog) { pill.hidden = true; return; }
    pill.hidden = false;
    pill.textContent = `Level ${prog.level}`;
    pill.title = `Level ${prog.level} · ${prog.title} · ${prog.streak ? `${plural(prog.streak, 'day')} in a row` : 'no days in a row yet'}. Click: Time`;
    pill.setAttribute('aria-label', `Level ${prog.level}. Open the Time tab`);
  }

  function render() {
    timeEl = null;
    root.replaceChildren(...[summaryCard(), session ? activeCard() : startCard(), progressCard(), todayCard()].filter(Boolean));
    root.querySelectorAll('.xp-fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
    root.querySelectorAll('.app-fill').forEach((el) => { el.style.width = el.dataset.w + '%'; });
  }

  function tick() {
    if (!visible || !session) return;
    if (timeEl) timeEl.textContent = fmt(activeMs(session));
    const total = document.getElementById('todayTotal');
    if (total && session.state === 'running') {
      // today's total grows with the session
      const extra = activeMs(session) - (today._activeAtFetch ?? activeMs(session));
      total.textContent = fmtShort(today.totalMs + Math.max(0, extra));
    }
  }

  // only editing the current session's title blocks re-rendering (so it doesn't mess up what you type)
  const typingInSession = () => !!(document.activeElement && document.activeElement.id === 'sesTitle');
  const clean = (e) => (e && e.message ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Error');

  window.api.session.onChanged(async (state) => {
    const sameSession = session && state.session && session.id === state.session.id;
    session = state.session;
    liveApps = computeLiveApps(session);
    await refreshToday();
    today._activeAtFetch = activeMs(session);
    if (visible && sameSession && typingInSession()) return; // don't mess up the title you are typing
    render();
  });
  window.api.session.onStopped((summary) => { lastSummary = summary; render(); });
  window.api.progress.onChanged((p) => {
    prog = p;
    renderPill();
    if (visible && !typingInSession()) render();
  });
  window.api.progress.onLevelUp((e) => {
    if (e.first) return;
    const got = e.rewards.length ? ` You unlocked: ${e.rewards.map((r) => r.label).join(', ')}` : '';
    toast(`Level ${e.level}!${got}`, 'ok');
  });
  window.api.email.onReportResult((res) => {
    if (!lastSummary || lastSummary.id !== res.id) return;
    lastSummary.email = res;
    const el = document.getElementById('reportEmail');
    if (el) el.textContent = emailLine(res);
  });
  window.api.session.onActivityStatus((st) => { activity = st; if (visible && !typingInSession()) render(); });
  setInterval(tick, 500);
  // the current session's apps refresh every 5 s, only while the tab is open
  setInterval(async () => {
    if (!visible || !session || session.state !== 'running' || typingInSession()) return;
    try { const st = await window.api.session.get(); session = st.session; liveApps = computeLiveApps(session); render(); } catch { /* ignore: the next tick or change event refreshes it */ }
  }, 5000);

  window.SessionTab = {
    async init(s) {
      settings = s;
      const st = await window.api.session.get();
      session = st.session;
      liveApps = computeLiveApps(session);
      try { activity = await window.api.session.activityStatus(); } catch { /* ignore: the status event updates it later */ }
      await refreshToday();
      today._activeAtFetch = activeMs(session);
      try { prog = await window.api.progress.get(); } catch { prog = null; }
      renderPill();
      render();
    },
    onSettings(s) { settings = s; render(); },
    async onShow(opts = {}) {
      visible = true;
      focusStart = !opts.keepFocus;
      await refreshToday();
      today._activeAtFetch = activeMs(session);
      render();
    },
    onHide() { visible = false; },
  };
})();
