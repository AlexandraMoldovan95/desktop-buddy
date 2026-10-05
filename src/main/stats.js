'use strict';
// Statistics from the per-day files (pure, tested functions).
// A day = { day, totalMs, sessions: [...], apps: [{ name, ms, titles }] }.

const S = require('./sessions');
const U = require('./activity/usage');

/** Today's part (or day `day`'s part) of the running session, as an "in progress" record. */
function activePart(session, day, now) {
  if (!session) return null;
  const segs = session.segments.map((x) => ({ start: x.start, end: x.end ?? now }));
  const inDay = S.splitByDay(segs)[day];
  if (!inDay || !inDay.length) return null;
  const usage = (session.usage && session.usage[day]) || {};
  return {
    id: session.id,
    title: session.title,
    start: inDay[0].start,
    end: inDay[inDay.length - 1].end,
    activeMs: inDay.reduce((t, x) => t + (x.end - x.start), 0),
    segments: inDay,
    apps: usage.apps || {},
    titles: usage.titles || {},
    inProgress: true,
    state: session.state,
  };
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
function validRecord(r) {
  return !!r && typeof r.id === 'string' && num(r.start) && num(r.end) && num(r.activeMs) && r.activeMs >= 0;
}
/** Only name → milliseconds pairs (a broken file can have anything there). */
function msMap(o) {
  const out = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  for (const [k, v] of Object.entries(o)) if (num(v) && v > 0) out[k] = v;
  return out;
}
const validSegments = (segs) => (Array.isArray(segs) ? segs.filter((x) => x && num(x.start) && num(x.end) && x.end > x.start) : []);

/** A day's summary from its records (+ optionally the running session's part). */
function summarizeDay(day, records, live = null) {
  // a file edited by hand or broken must not break the whole view
  const all = (Array.isArray(records) ? records : []).filter(validRecord);
  if (live && !all.some((r) => r.id === live.id)) all.push(live);
  all.sort((a, b) => a.start - b.start);
  return {
    day,
    totalMs: all.reduce((t, r) => t + (r.activeMs || 0), 0),
    sessions: all.map((r) => ({
      id: r.id,
      title: typeof r.title === 'string' ? r.title : 'Untitled session',
      start: r.start,
      end: r.end,
      activeMs: r.activeMs,
      segments: validSegments(r.segments),
      part: r.part,
      parts: r.parts,
      inProgress: !!r.inProgress,
      state: r.state,
    })),
    apps: U.topApps(all.map((r) => ({ apps: msMap(r.apps), titles: msMap(r.titles) })), { titlesPerApp: 5 }),
  };
}

/** The list for "Workdays": days with at least one session, newest first, with the top 3 apps. */
function workdaysList(daySummaries) {
  return daySummaries
    .filter((d) => d.sessions.length)
    .sort((a, b) => (a.day < b.day ? 1 : -1))
    .map((d) => ({
      day: d.day,
      totalMs: d.totalMs,
      sessionCount: d.sessions.length,
      inProgress: d.sessions.some((s) => s.inProgress),
      sessions: d.sessions.map((s) => ({ title: s.title, start: s.start, end: s.end, activeMs: s.activeMs, inProgress: s.inProgress })),
      topApps: d.apps.slice(0, 3).map((a) => ({ name: a.name, ms: a.ms })),
    }));
}

/**
 * The same row as workdaysList([summarizeDay(day, records)])[0], straight from a past day's records,
 * without the per-title breakdown the list doesn't show (much cheaper). null = no valid session.
 */
function workdayRow(day, records) {
  const all = (Array.isArray(records) ? records : []).filter(validRecord);
  if (!all.length) return null;
  all.sort((a, b) => a.start - b.start);
  const apps = {};
  for (const r of all) for (const [name, ms] of Object.entries(msMap(r.apps))) apps[name] = (apps[name] || 0) + ms;
  return {
    day,
    totalMs: all.reduce((t, r) => t + (r.activeMs || 0), 0),
    sessionCount: all.length,
    inProgress: all.some((r) => !!r.inProgress),
    sessions: all.map((r) => ({ title: typeof r.title === 'string' ? r.title : 'Untitled session', start: r.start, end: r.end, activeMs: r.activeMs, inProgress: !!r.inProgress })),
    topApps: Object.entries(apps).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, ms]) => ({ name, ms })),
  };
}

// ------------------------------------------------ the last N days (step 5)
const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };
/** Day `key` ± n days (on the local calendar, correct across daylight saving changes). */
function addDays(key, n) {
  const d = parseKey(key);
  return S.dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime());
}
/** 0 = Monday … 6 = Sunday */
const weekdayMon = (key) => (parseKey(key).getDay() + 6) % 7;

const WEEKS_SHOWN = 4;

/**
 * The last `n` days, including today: hours per day, the most used apps and the weeks.
 * Nothing older than `n` days goes into the numbers (not even the week-to-week comparisons).
 * @param {string} today  'YYYY-MM-DD'
 * @param {(day:string) => object|null} getDay  a day's summary (summarizeDay) or null
 */
function rangeSummary(today, getDay, n = 30) {
  const from = addDays(today, -(n - 1));
  const days = [];
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    const d = getDay(day);
    days.push({
      day,
      totalMs: d ? d.totalMs : 0,
      sessionCount: d ? d.sessions.length : 0,
      inProgress: !!(d && d.sessions.some((x) => x.inProgress)),
      apps: d ? d.apps : [],
    });
  }
  const byDay = Object.fromEntries(days.map((d) => [d.day, d]));
  const totalMs = days.reduce((t, d) => t + d.totalMs, 0);
  const activeDays = days.filter((d) => d.totalMs > 0).length;

  // apps over the whole period: total time + on how many days they were used
  const apps = {};
  for (const d of days) {
    for (const a of d.apps) {
      const cur = apps[a.name] || (apps[a.name] = { name: a.name, ms: 0, days: 0 });
      cur.ms += a.ms;
      cur.days += 1;
    }
  }
  const appList = Object.values(apps).sort((a, b) => b.ms - a.ms);

  // the weeks (Monday–Sunday): the current one (up to today) + the 3 before it
  const sumOf = (start, len) => {
    let ms = 0;
    let worked = 0;
    for (let i = 0; i < len; i++) {
      const d = byDay[addDays(start, i)];
      if (d) { ms += d.totalMs; if (d.totalMs > 0) worked += 1; }
    }
    return { ms, worked };
  };
  const monday = addDays(today, -weekdayMon(today));
  const elapsed = weekdayMon(today) + 1;
  const weeks = [];
  for (let i = 0; i < WEEKS_SHOWN; i++) {
    const start = addDays(monday, -7 * i);
    if (start < from) break;
    const len = i === 0 ? elapsed : 7;          // the current week: only the days so far
    const cur = sumOf(start, len);
    const prevStart = addDays(start, -7);
    // we compare with the same days of the week before, only if they are all within the last n days
    const prev = prevStart >= from ? sumOf(prevStart, len) : null;
    weeks.push({
      start,
      end: addDays(start, 6),
      current: i === 0,
      days: len,
      totalMs: cur.ms,
      avgMs: Math.round(cur.ms / len),
      activeDays: cur.worked,
      prevMs: prev ? prev.ms : null,
      deltaMs: prev ? cur.ms - prev.ms : null,
      deltaPct: prev && prev.ms > 0 ? (cur.ms - prev.ms) / prev.ms : null,
    });
  }

  return {
    from,
    to: today,
    n,
    days: days.map(({ apps: _a, ...d }) => d),
    totalMs,
    activeDays,
    avgMs: Math.round(totalMs / n),
    avgActiveMs: activeDays ? Math.round(totalMs / activeDays) : 0,
    apps: appList,
    weeks,
  };
}

module.exports = { activePart, summarizeDay, workdaysList, workdayRow, rangeSummary, addDays, weekdayMon };
