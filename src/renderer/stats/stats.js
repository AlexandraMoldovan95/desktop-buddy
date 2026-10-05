'use strict';
// The Statistics window → "Workdays": the list of days with sessions and the chosen day's details.
// User text (session titles, apps, windows) goes in only through textContent.
(function () {
  const { h } = window.UI;
  const listEl = document.getElementById('dayList');
  const sumEl = document.getElementById('daysSum');
  const detailEl = document.getElementById('detail');
  const tip = document.getElementById('tip');

  let days = [];
  let selected = null;       // 'YYYY-MM-DD'
  let detail = null;         // the selected day's summary
  const expanded = new Set(); // apps with their titles expanded

  // ------------------------------------------------ formatting
  const fmtShort = (ms) => {
    if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))} s`;
    const m = Math.round(ms / 60000);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  };
  const hm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateOf = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function relDay(key) {
    const today = new Date();
    if (key === keyOf(today)) return 'Today';
    const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
    if (key === keyOf(y)) return 'Yesterday';
    return null;
  }
  const longDate = (key) => cap(dateOf(key).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  const shortDate = (key) => {
    const d = dateOf(key);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    return cap(d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }));
  };
  // English plurals: "1 day", "2 days"
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const sessionsWord = (n) => plural(n, 'session');
  const daysWord = (n) => plural(n, 'day');

  // ------------------------------------------------ the list of days
  function dayItem(d) {
    const rel = relDay(d.day);
    const shown = d.sessions.slice(0, 3);
    const btn = h('button', {
      class: 'day-btn', type: 'button', 'aria-current': d.day === selected ? 'true' : 'false',
      dataset: { day: d.day }, onclick: () => select(d.day, { focusDetail: false }),
    },
      h('span', { class: 'day-top' },
        h('span', { class: 'day-name' },
          d.inProgress ? h('span', { class: 'live-dot', title: 'Timer running' }) : null,
          rel || shortDate(d.day),
          rel ? h('span', { class: 'sub', text: shortDate(d.day) }) : null),
        h('span', { class: 'day-total', text: fmtShort(d.totalMs) })),
      h('ul', { class: 'day-sessions' },
        ...shown.map((s) => h('li', {},
          h('span', { class: 'when', text: `${hm(s.start)}–${s.inProgress ? 'now' : hm(s.end)}` }),
          h('span', { class: 't', text: s.title }),
          h('span', { class: 'dur', text: fmtShort(s.activeMs) }))),
        d.sessions.length > shown.length ? h('li', { class: 'muted', text: `+ ${sessionsWord(d.sessions.length - shown.length)} more` }) : null),
      d.topApps.length
        ? h('span', { class: 'day-apps', text: d.topApps.map((a) => `${a.name} ${fmtShort(a.ms)}`).join(' · ') })
        : null);
    return h('li', {}, btn);
  }

  function renderList() {
    if (!days.length) {
      sumEl.textContent = '';
      listEl.replaceChildren(h('li', { class: 'empty-list', text: 'No days yet.' }));
      return;
    }
    const total = days.reduce((t, d) => t + d.totalMs, 0);
    sumEl.textContent = `${daysWord(days.length)} · ${fmtShort(total)} in total`;
    // years of history: only the first rows are built, the rest on request (H3)
    const rows = days.slice(0, shownCount).map(dayItem);
    const left = days.length - rows.length;
    if (left > 0) {
      rows.push(h('li', { class: 'more-row' }, h('button', {
        class: 'more-btn', type: 'button', text: `Show more (${daysWord(left)} left)`,
        onclick: () => { shownCount += PAGE; renderList(); },
      })));
    }
    listEl.replaceChildren(...rows);
  }
  const PAGE = 60;
  let shownCount = PAGE;

  // the up/down arrows move the selection through the list
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const i = days.findIndex((d) => d.day === selected);
    const ni = Math.min(days.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)));
    const next = days[ni];
    if (!next) return;
    e.preventDefault();
    if (ni >= shownCount) { shownCount += PAGE; renderList(); }
    select(next.day, { focusDetail: false }).then(() => {
      const b = listEl.querySelector(`[data-day="${next.day}"]`);
      if (b) { b.focus(); b.scrollIntoView({ block: 'nearest' }); }
    });
  });

  // ------------------------------------------------ the day's details
  /** The range shown on the timeline: the hours worked, with one hour of margin, at least 6 hours. */
  function timeRange(day) {
    const d0 = dateOf(day.day).getTime();
    const H = 3600000;
    const segs = day.sessions.flatMap((s) => s.segments);
    let a = 0;
    let b = 24;
    if (segs.length) {
      a = Math.max(0, Math.floor((Math.min(...segs.map((x) => x.start)) - d0) / H) - 1);
      b = Math.min(24, Math.ceil((Math.max(...segs.map((x) => x.end)) - d0) / H) + 1);
      while (b - a < 6) { if (b < 24) b += 1; else a -= 1; }
    }
    // the 1, 2 or 3 hour ticks must land exactly on both ends
    const step = (b - a) > 12 ? 3 : (b - a) >= 6 ? 2 : 1;
    while ((b - a) % step) { if (b < 24) b += 1; else a -= 1; }
    return { from: d0 + a * H, to: d0 + b * H, a, b, step };
  }

  /** Tooltip next to the mouse (or next to the element, on keyboard focus). */
  function placeTip(e, title, line) {
    tip.replaceChildren(h('strong', { text: title }), line);
    tip.hidden = false;
    let cx = e.clientX;
    let cy = e.clientY;
    if (cx === undefined) { const b = e.target.getBoundingClientRect(); cx = b.left + b.width / 2; cy = b.top; }
    const r = tip.getBoundingClientRect();
    const x = Math.min(window.innerWidth - r.width - 8, Math.max(8, cx - r.width / 2));
    const y = cy - r.height - 12 < 8 ? cy + 16 : cy - r.height - 12;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }
  function showTip(e, s, seg) {
    placeTip(e, s.title,
      `${hm(seg.start)} – ${s.inProgress && seg === s.segments[s.segments.length - 1] ? 'now' : hm(seg.end)} · ${fmtShort(seg.end - seg.start)}`);
  }
  const hideTip = () => { tip.hidden = true; };

  function timelineCard(day) {
    const { from, to, a, b, step } = timeRange(day);
    const span = to - from;
    const pct = (t) => ((t - from) / span) * 100;
    const track = h('div', { class: 'timeline', 'aria-hidden': 'true' });
    for (const s of day.sessions) {
      s.segments.forEach((seg, i) => {
        const live = s.inProgress && i === s.segments.length - 1;
        const block = h('span', { class: 'tl-block' + (live ? ' live' : '') });
        block.style.left = `${pct(seg.start)}%`;
        block.style.width = `${Math.max(0, pct(seg.end) - pct(seg.start))}%`;
        // the hover area is wider than the block, so short intervals are easy to hit
        const hit = h('span', { class: 'tl-hit' });
        hit.style.left = block.style.left;
        hit.style.width = `calc(${block.style.width} + 8px)`;
        hit.addEventListener('pointermove', (e) => showTip(e, s, seg));
        hit.addEventListener('pointerleave', hideTip);
        track.append(block, hit);
      });
    }
    const axis = h('div', { class: 'tl-axis', 'aria-hidden': 'true' });
    for (let hr = a; hr <= b; hr += step) {
      const t = h('span', { text: `${pad(hr)}:00` });
      t.style.left = `${((hr - a) / (b - a)) * 100}%`;
      axis.append(t);
    }
    return h('section', { class: 'card', 'aria-labelledby': 'tlTitle' },
      h('div', { class: 'card-head' },
        h('h3', { id: 'tlTitle', text: 'The day\'s timeline' }),
        h('span', { class: 'card-note', text: 'Empty spaces = breaks' })),
      h('div', {}, track, axis));
  }

  function sessionsCard(day) {
    const rows = day.sessions.map((s) => h('tr', {},
      h('td', { class: 'title' }, s.title,
        s.inProgress ? h('span', { class: 'tag live', text: s.state === 'paused' ? 'paused' : 'in progress' }) : null,
        s.parts ? h('span', { class: 'tag', text: `part ${s.part} of ${s.parts}`, title: 'The timer ran past midnight' }) : null),
      h('td', { class: 'when', text: `${hm(s.start)} – ${s.inProgress ? 'now' : hm(s.end)}` }),
      h('td', { class: 'num', text: s.segments.length > 1 ? String(s.segments.length - 1) : '–' }),
      h('td', { class: 'num', text: fmtShort(s.activeMs) })));
    return h('section', { class: 'card', 'aria-labelledby': 'sesTitle' },
      h('h3', { id: 'sesTitle', text: 'Sessions' }),
      h('table', {},
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: 'Title' }),
          h('th', { scope: 'col', text: 'Start – end' }),
          h('th', { scope: 'col', class: 'num', text: 'Breaks' }),
          h('th', { scope: 'col', class: 'num', text: 'Duration' }))),
        h('tbody', {}, ...rows)));
  }

  function appsCard(day) {
    const total = day.apps.reduce((t, a) => t + a.ms, 0);
    const LIMIT = 8;
    const showAll = expanded.has('*');
    const list = showAll ? day.apps : day.apps.slice(0, LIMIT);
    const body = day.apps.length
      ? h('ul', { class: 'apps' }, ...list.map((a) => {
          const share = total ? Math.round((a.ms / total) * 100) : 0;
          const fill = h('span', { class: 'fill' });
          fill.style.width = `${Math.max(1, total ? (a.ms / total) * 100 : 0)}%`;
          const open = expanded.has(a.name);
          return h('li', {},
            h('div', { class: 'app-row' },
              h('span', { class: 't', text: a.name, title: a.name }),
              h('span', { class: 'dur' }, fmtShort(a.ms), h('span', { class: 'pct', text: `${share}%` }))),
            h('div', { class: 'track' }, fill),
            a.titles.length
              ? h('button', {
                  class: 'more-btn', type: 'button', 'aria-expanded': open ? 'true' : 'false',
                  onclick: () => { if (open) expanded.delete(a.name); else expanded.add(a.name); renderDetail(); },
                }, open ? 'Hide windows' : `Windows (${a.titles.length})`)
              : null,
            open
              ? h('ul', { class: 'titles' }, ...a.titles.map((t) => h('li', {},
                  h('span', { class: 't', text: t.title, title: t.title }), h('span', { class: 'dur', text: fmtShort(t.ms) }))))
              : null);
        }))
      : h('p', { class: 'muted', text: 'No app list for this day.' });
    return h('section', { class: 'card', 'aria-labelledby': 'appsTitle' },
      h('div', { class: 'card-head' },
        h('h3', { id: 'appsTitle', text: 'Apps used' }),
        total ? h('span', { class: 'card-note', text: `${fmtShort(total)} tracked` }) : null),
      body,
      day.apps.length > LIMIT
        ? h('button', { class: 'more-btn', type: 'button', onclick: () => { if (showAll) expanded.delete('*'); else expanded.add('*'); renderDetail(); } },
            showAll ? 'Show fewer' : `Show all (${day.apps.length})`)
        : null);
  }

  function renderDetail() {
    hideTip();
    if (!days.length) {
      detailEl.replaceChildren(h('div', { class: 'empty' },
        h('h2', { text: 'No time yet' }),
        h('p', { text: 'Open the Time tab and press Start. When you stop the timer, the day shows up here. (Sessions = the times you used the timer.)' })));
      return;
    }
    if (!detail) { detailEl.replaceChildren(); return; }
    const d = detail;
    const rel = relDay(d.day);
    const first = d.sessions[0];
    const last = d.sessions[d.sessions.length - 1];
    const live = d.sessions.some((s) => s.inProgress);
    const kpi = (k, v) => h('div', { class: 'kpi' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }));
    detailEl.replaceChildren(
      h('header', { class: 'detail-head' },
        h('div', {},
          rel ? h('div', { class: 'rel', text: rel }) : null,
          h('h2', { text: longDate(d.day) })),
        h('div', { class: 'kpis' },
          kpi('Total worked', fmtShort(d.totalMs)),
          kpi('Sessions', String(d.sessions.length)),
          first ? kpi('Time span', `${hm(first.start)} – ${live && last.inProgress ? 'now' : hm(last.end)}`) : null)),
      timelineCard(d),
      sessionsCard(d),
      appsCard(d));
  }

  // ------------------------------------------------ last 30 days
  const rangeEl = document.getElementById('viewRange');
  let range = null;
  let showAllApps = false;
  const HOUR = 3600000;
  const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  // the calendar's color steps (one hue, darker = more hours)
  const LEVELS = [
    { min: 0, label: '0' },
    { min: 1, label: 'under 1 h' },
    { min: HOUR, label: '1–3 h' },
    { min: 3 * HOUR, label: '3–5 h' },
    { min: 5 * HOUR, label: '5 h +' },
  ];
  const levelOf = (ms) => { let l = 0; LEVELS.forEach((x, i) => { if (ms >= x.min && ms > 0) l = i; }); return l; };
  const weekdayMon = (key) => (dateOf(key).getDay() + 6) % 7;
  const addDays = (key, n) => { const d = dateOf(key); return keyOf(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };
  const dayMonth = (key, withYear) => dateOf(key).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
  /** Short hours, for the calendar cells: "40 min", "2.5 h", "6 h". */
  const fmtHours = (ms) => {
    if (!ms) return '';
    if (ms < HOUR) return `${Math.max(1, Math.round(ms / 60000))} min`;
    const v = Math.round(ms / (HOUR / 10)) / 10;
    return `${v} h`;
  };
  const weekLabel = (w) => {
    const a = dateOf(w.start);
    const b = dateOf(w.end);
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()}–${dayMonth(w.end)}`
      : `${dayMonth(w.start)} – ${dayMonth(w.end)}`;
  };

  function calendarCard(r) {
    const byDay = Object.fromEntries(r.days.map((d) => [d.day, d]));
    const today = r.to;
    const first = addDays(r.from, -weekdayMon(r.from));        // the Monday before the first day
    const last = addDays(today, 6 - weekdayMon(today));          // the Sunday after today
    const cells = [];
    for (let k = first; k <= last; k = addDays(k, 1)) {
      const d = byDay[k];
      if (!d) { cells.push(h('span', { class: 'cal-cell out', 'aria-hidden': 'true' })); continue; }
      const lvl = levelOf(d.totalMs);
      const date = dateOf(k);
      const label = `${cap(dateOf(k).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))}: ${d.totalMs ? fmtShort(d.totalMs) : 'no work'}${d.sessionCount ? `, ${sessionsWord(d.sessionCount)}` : ''}${d.inProgress ? ', timer running' : ''}`;
      const btn = h('button', {
        type: 'button', class: `cal-cell l${lvl}${k === today ? ' today' : ''}`,
        'aria-label': label, disabled: !d.sessionCount,
        onclick: () => openDay(k),
      },
        h('span', { class: 'cal-day', text: date.getDate() === 1 || k === r.from ? dayMonth(k) : String(date.getDate()) }),
        d.inProgress ? h('span', { class: 'cal-live', 'aria-hidden': 'true' }) : null,
        h('span', { class: 'cal-val', text: fmtHours(d.totalMs) }));
      const tipLine = `${d.totalMs ? fmtShort(d.totalMs) : 'no work'}${d.sessionCount ? ` · ${sessionsWord(d.sessionCount)}` : ''}`;
      const tipTitle = cap(date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }));
      btn.addEventListener('pointermove', (e) => placeTip(e, tipTitle, tipLine));
      btn.addEventListener('pointerleave', hideTip);
      cells.push(btn);
    }
    const legend = h('div', { class: 'cal-legend' },
      h('span', { class: 'muted', text: 'Hours per day:' }),
      ...LEVELS.map((l, i) => h('span', { class: 'leg-item' }, h('span', { class: `leg-sw l${i}`, 'aria-hidden': 'true' }), l.label)));
    return h('section', { class: 'card', 'aria-labelledby': 'calTitle' },
      h('div', { class: 'card-head' },
        h('h3', { id: 'calTitle', text: 'Calendar' }),
        h('span', { class: 'card-note', text: 'Click a day to see it in Day by day' })),
      h('div', { class: 'cal' },
        ...WEEKDAYS.map((w, i) => h('span', { class: 'cal-wd', text: w, title: WEEKDAYS_LONG[i] })),
        ...cells),
      legend);
  }

  function appsRangeCard(r) {
    const total = r.apps.reduce((t, a) => t + a.ms, 0);
    const LIMIT = 8;
    const list = showAllApps ? r.apps : r.apps.slice(0, LIMIT);
    return h('section', { class: 'card', 'aria-labelledby': 'mostTitle' },
      h('div', { class: 'card-head' },
        h('h3', { id: 'mostTitle', text: 'Most used apps' }),
        total ? h('span', { class: 'card-note', text: `${fmtShort(total)} tracked` }) : null),
      r.apps.length
        ? h('ol', { class: 'apps' }, ...list.map((a) => {
            const fill = h('span', { class: 'fill' });
            fill.style.width = `${Math.max(1, (a.ms / total) * 100)}%`;
            return h('li', {},
              h('div', { class: 'app-row' },
                h('span', { class: 't', text: a.name, title: a.name }),
                h('span', { class: 'dur' }, fmtShort(a.ms), h('span', { class: 'pct', text: `${Math.round((a.ms / total) * 100)}%` }))),
              h('div', { class: 'track' }, fill),
              h('div', { class: 'app-days', text: `on ${daysWord(a.days)}` }));
          }))
        : h('p', { class: 'muted', text: 'No apps tracked in the last 30 days.' }),
      r.apps.length > LIMIT
        ? h('button', { class: 'more-btn', type: 'button', onclick: () => { showAllApps = !showAllApps; renderRange(); } },
            showAllApps ? 'Show fewer' : `Show all (${r.apps.length})`)
        : null);
  }

  function deltaText(w) {
    if (w.prevMs === null) return { text: '—', cls: 'same', title: 'The week before falls outside the last 30 days.' };
    if (w.deltaMs === 0) return { text: 'same', cls: 'same' };
    const up = w.deltaMs > 0;
    const pct = w.deltaPct === null ? '' : ` (${up ? '+' : '−'}${Math.round(Math.abs(w.deltaPct) * 100)}%)`;
    return { text: `${up ? '▲ +' : '▼ −'}${fmtShort(Math.abs(w.deltaMs))}${pct}`, cls: up ? 'up' : 'down' };
  }

  function weeksCard(r) {
    const max = Math.max(1, ...r.weeks.map((w) => w.totalMs));
    const cur = r.weeks[0];
    let headline = null;
    if (cur) {
      const d = deltaText(cur);
      const same = cur.days === 7 ? 'last week' : `the same ${cur.days === 1 ? 'day' : cur.days + ' days'} last week`;
      headline = h('p', { class: 'week-headline' },
        'This week: ', h('strong', { text: fmtShort(cur.totalMs) }), ` · average ${fmtShort(cur.avgMs)} / day`,
        cur.prevMs === null ? null : h('span', {}, ` · vs ${same}: `, h('strong', { class: `delta ${d.cls}`, text: d.text })));
    }
    const rows = r.weeks.map((w) => {
      const d = deltaText(w);
      const bar = h('span', { class: 'fill' });
      bar.style.width = `${(w.totalMs / max) * 100}%`;
      return h('tr', {},
        h('th', { scope: 'row', class: 'wk' }, w.current ? 'This week' : weekLabel(w), h('span', { class: 'wk-sub', text: w.current ? `${weekLabel(w)} · ${daysWord(w.days)} so far` : '' })),
        h('td', { class: 'num wk-total' }, h('span', { text: fmtShort(w.totalMs) }), h('span', { class: 'track mini' }, bar)),
        h('td', { class: 'num', text: fmtShort(w.avgMs) }),
        h('td', { class: 'num', text: `${w.activeDays} / ${w.days}` }),
        h('td', { class: `num delta ${d.cls}`, text: d.text, title: d.title || null }));
    });
    return h('section', { class: 'card', 'aria-labelledby': 'weeksTitle' },
      h('h3', { id: 'weeksTitle', text: 'By week (Monday–Sunday)' }),
      headline,
      h('table', { class: 'weeks' },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', text: 'Week' }),
          h('th', { scope: 'col', class: 'num', text: 'Total' }),
          h('th', { scope: 'col', class: 'num', text: 'Average / day' }),
          h('th', { scope: 'col', class: 'num', text: 'Days worked' }),
          h('th', { scope: 'col', class: 'num', text: 'vs the week before' }))),
        h('tbody', {}, ...rows)),
      h('p', { class: 'foot-note adv', text: 'Average / day = the total divided by the days of the week (for this week, only the days so far). This week is compared with the same days of last week, so a started week isn\'t compared with a full one. Data older than 30 days isn\'t included here; you\'ll find it in Day by day.' }));
  }

  function renderRange() {
    hideTip();
    if (!range) { rangeEl.replaceChildren(); return; }
    const r = range;
    const kpi = (k, v, sub) => h('div', { class: 'kpi' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }), sub ? h('div', { class: 'kpi-sub', text: sub }) : null);
    rangeEl.replaceChildren(h('div', { class: 'range-inner' },
      h('header', { class: 'detail-head' },
        h('div', {},
          h('div', { class: 'rel', text: `${dayMonth(r.from, true)} – ${dayMonth(r.to, true)}` }),
          h('h2', { text: 'Last 30 days' })),
        h('div', { class: 'kpis' },
          kpi('Total worked', fmtShort(r.totalMs)),
          kpi('Days worked', `${r.activeDays} of ${r.n}`),
          kpi('Average / worked day', r.activeDays ? fmtShort(r.avgActiveMs) : '–', `${fmtShort(r.avgMs)} per calendar day`))),
      h('div', { class: 'range-grid' }, calendarCard(r), appsRangeCard(r)),
      weeksCard(r)));
  }

  async function loadRange() {
    try { range = await window.stats.lastDays(); } catch { range = null; }
    renderRange();
  }

  function openDay(day) {
    hideTip();
    setView('workdays');
    select(day, { focusDetail: true }).then(() => {
      const b = listEl.querySelector(`[data-day="${day}"]`);
      if (b) b.scrollIntoView({ block: 'nearest' });
    });
  }

  // ------------------------------------------------ the two views
  let view = 'workdays';
  const tabEls = [...document.querySelectorAll('.view-tabs [role="tab"]')];
  function setView(v, { focusTab = false } = {}) {
    if (v === view && !focusTab) return;
    view = v;
    hideTip();
    for (const t of tabEls) {
      const on = t.dataset.view === v;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
      if (on && focusTab) t.focus();
    }
    load();
  }
  tabEls.forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  document.querySelector('.view-tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const i = tabEls.findIndex((t) => t.dataset.view === view);
    const next = tabEls[(i + (e.key === 'ArrowRight' ? 1 : tabEls.length - 1)) % tabEls.length];
    setView(next.dataset.view, { focusTab: true });
  });

  // ------------------------------------------------ data
  async function select(day, { focusDetail = true } = {}) {
    if (day !== selected) expanded.clear();
    selected = day;
    listEl.querySelectorAll('.day-btn').forEach((b) => b.setAttribute('aria-current', b.dataset.day === day ? 'true' : 'false'));
    try { detail = await window.stats.day(day); } catch { detail = null; }
    if (selected !== day) return; // another day was chosen meanwhile
    renderDetail();
    if (focusDetail) detailEl.focus();
  }

  async function loadWorkdays() {
    try { days = await window.stats.workdays(); } catch { days = []; }
    if (!days.some((d) => d.day === selected)) selected = days.length ? days[0].day : null;
    renderList();
    if (selected) await select(selected, { focusDetail: false }); else { detail = null; renderDetail(); }
  }

  const load = () => (view === 'range' ? loadRange() : loadWorkdays());

  let reloadTimer = 0;
  const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(load, 300); };
  window.stats.onSessionChanged(reloadSoon);
  window.stats.onSessionStopped(reloadSoon);
  // with a session in progress the numbers grow: refresh every 30 s while the window is visible
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    const live = view === 'range' ? !!(range && range.days.some((d) => d.inProgress)) : days.some((d) => d.inProgress);
    if (live) load();
  }, 30000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });
  window.addEventListener('blur', hideTip);

  // simple / full mode (UX pass); an older main without 'ui:mode' rejects: full mode (nothing hidden)
  const applyMode = (m) => document.body.classList.toggle('simple', m === 'simple');
  window.stats.uiMode().then(applyMode, (e) => console.warn('[stats] ui mode unavailable:', e && e.message));
  window.stats.onUiMode(applyMode);

  load();
})();
