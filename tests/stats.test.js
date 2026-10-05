'use strict';
// Statistics tests (step 4): a day's summary and the "Workdays" list.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ST = require('../src/main/stats');
const S = require('../src/main/sessions');
const U = require('../src/main/activity/usage');
const { SessionManager } = require('../src/main/session-manager');

const at = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const MIN = 60000;
const HOUR = 3600000;

const rec = (id, title, start, end, apps = {}, titles = {}) => ({
  id, title, start, end, activeMs: end - start, segments: [{ start, end }], apps, titles,
});

test('day: sessions sorted by time, total, top apps with titles', () => {
  const d = '2026-09-28';
  const K = (app, t) => app + U.SEP + t;
  const day = ST.summarizeDay(d, [
    rec('b', 'Afternoon', at(2026, 9, 28, 14), at(2026, 9, 28, 15), { Code: 40 * MIN, Chrome: 20 * MIN }, { [K('Code', 'main.js')]: 40 * MIN }),
    rec('a', 'Morning', at(2026, 9, 28, 9), at(2026, 9, 28, 10, 30), { Chrome: 90 * MIN }, { [K('Chrome', 'Docs')]: 90 * MIN }),
  ]);
  assert.deepEqual(day.sessions.map((s) => s.title), ['Morning', 'Afternoon']);
  assert.equal(day.totalMs, 150 * MIN);
  assert.deepEqual(day.apps.map((a) => [a.name, a.ms]), [['Chrome', 110 * MIN], ['Code', 40 * MIN]]);
  assert.deepEqual(day.apps[1].titles, [{ title: 'main.js', ms: 40 * MIN }]);
});

test('day: broken records are ignored, they do not break the view', () => {
  const ok = rec('a', 'Bun', at(2026, 9, 28, 9), at(2026, 9, 28, 10), { Code: 'mult', Chrome: 5 * MIN });
  const day = ST.summarizeDay('2026-09-28', [null, { id: 'x' }, { id: 'y', start: 'ieri', end: 1, activeMs: 1 }, ok, { ...ok, id: 'z', activeMs: -5 }]);
  assert.equal(day.sessions.length, 1);
  assert.equal(day.totalMs, HOUR);
  assert.deepEqual(day.apps.map((a) => a.name), ['Chrome'], 'a non-numeric value is ignored');
  assert.deepEqual(ST.summarizeDay('2026-09-28', 'not a list').sessions, []);
});

test('the running session: shows on its day, marked "in progress", pauses not in the total', () => {
  const t0 = at(2026, 9, 28, 16);
  let s = S.startSession('Live', t0);
  s = S.pauseSession(s, t0 + 30 * MIN);
  s = S.resumeSession(s, t0 + 45 * MIN);
  const now = t0 + 75 * MIN;
  const live = ST.activePart(s, '2026-09-28', now);
  assert.equal(live.activeMs, 60 * MIN);
  assert.equal(live.inProgress, true);
  assert.equal(live.segments.length, 2);
  assert.equal(ST.activePart(s, '2026-09-27', now), null);
  assert.equal(ST.activePart(null, '2026-09-28', now), null);
  const day = ST.summarizeDay('2026-09-28', [rec('a', 'Done', at(2026, 9, 28, 9), at(2026, 9, 28, 10))], live);
  assert.equal(day.totalMs, 2 * HOUR);
  assert.deepEqual(day.sessions.map((x) => x.inProgress), [false, true]);
});

test('workdays: only days with sessions, newest first, top 3 apps', () => {
  const list = ST.workdaysList([
    ST.summarizeDay('2026-09-26', [rec('a', 'A', at(2026, 9, 26, 9), at(2026, 9, 26, 10), { A: 1, B: 4, C: 3, D: 2 })]),
    ST.summarizeDay('2026-09-27', []),
    ST.summarizeDay('2026-09-28', [rec('b', 'B', at(2026, 9, 28, 9), at(2026, 9, 28, 9, 20))]),
  ]);
  assert.deepEqual(list.map((d) => d.day), ['2026-09-28', '2026-09-26']);
  assert.deepEqual(list[1].topApps.map((a) => a.name), ['B', 'C', 'D']);
  assert.equal(list[0].sessionCount, 1);
  assert.equal(list[0].sessions[0].activeMs, 20 * MIN);
});

test('manager: workdays reads the per-day files + the running session across midnight', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-st-'));
  let now = at(2026, 9, 27, 10);
  const m = new SessionManager({ dir, now: () => now });
  m.begin('Ieri'); now += HOUR; m.stop();
  now = at(2026, 9, 28, 23, 30);
  m.begin('Noapte');
  now = at(2026, 9, 29, 0, 45);
  fs.writeFileSync(path.join(dir, 'sessions', 'not-a-day.json'), '{}');   // ignored
  const w = m.workdays();
  assert.deepEqual(w.map((d) => [d.day, d.totalMs, d.inProgress]), [
    ['2026-09-29', 45 * MIN, true],
    ['2026-09-28', 30 * MIN, true],
    ['2026-09-27', HOUR, false],
  ]);
  assert.throws(() => m.daySummary('../settings'), /invalid/i);
  m.stop();
  const after = m.workdays();
  assert.equal(after.some((d) => d.inProgress), false, 'after stop, nothing "in progress"');
  assert.deepEqual(after.map((d) => d.totalMs), [45 * MIN, 30 * MIN, HOUR], 'the same numbers, now from the files');
});

// ------------------------------------------------ step 5: the last 30 days
const dayOf = (totalH, apps = {}) => ({
  totalMs: totalH * HOUR,
  sessions: [{ inProgress: false }],
  apps: Object.entries(apps).map(([name, h]) => ({ name, ms: h * HOUR })),
});

test('30 days: exactly 30 days up to today, nothing older', () => {
  const data = { '2026-09-30': dayOf(2), '2026-09-01': dayOf(3), '2026-08-31': dayOf(100) };
  const r = ST.rangeSummary('2026-09-30', (d) => data[d] || null);
  assert.equal(r.days.length, 30);
  assert.equal(r.from, '2026-09-01');
  assert.equal(r.days[29].day, '2026-09-30');
  assert.equal(r.totalMs, 5 * HOUR, '31 August (the 31st day) is not included');
  assert.equal(r.activeDays, 2);
  assert.equal(r.avgMs, Math.round(5 * HOUR / 30));
  assert.equal(r.avgActiveMs, 2.5 * HOUR);
});

test('30 days: apps added up over the whole period, with the number of days', () => {
  const data = { '2026-09-29': dayOf(3, { Code: 2, Chrome: 1 }), '2026-09-20': dayOf(2, { Chrome: 2 }) };
  const r = ST.rangeSummary('2026-09-30', (d) => data[d] || null);
  assert.deepEqual(r.apps, [{ name: 'Chrome', ms: 3 * HOUR, days: 2 }, { name: 'Code', ms: 2 * HOUR, days: 1 }]);
});

test('weeks: Monday–Sunday; the current one is compared with the same days of last week', () => {
  // 30.09.2026 is a Wednesday → the current week has 3 days (Mon, Tue, Wed)
  assert.equal(ST.weekdayMon('2026-09-30'), 2);
  const data = {
    '2026-09-28': dayOf(4), '2026-09-30': dayOf(2),     // current week: 6 h
    '2026-09-21': dayOf(2), '2026-09-23': dayOf(1),     // Mon–Wed last week: 3 h
    '2026-09-26': dayOf(5),                             // Saturday last week: not in the current comparison
  };
  const r = ST.rangeSummary('2026-09-30', (d) => data[d] || null);
  const [cur, prev] = r.weeks;
  assert.deepEqual([cur.start, cur.end, cur.days, cur.totalMs, cur.activeDays], ['2026-09-28', '2026-10-04', 3, 6 * HOUR, 2]);
  assert.equal(cur.avgMs, 2 * HOUR);
  assert.equal(cur.prevMs, 3 * HOUR);
  assert.equal(cur.deltaPct, 1);
  assert.deepEqual([prev.start, prev.days, prev.totalMs, prev.avgMs], ['2026-09-21', 7, 8 * HOUR, Math.round(8 * HOUR / 7)]);
  assert.equal(r.weeks.length, 4);
  // the oldest week (07.09) would compare with 31.08–06.09, which is outside the 30 days
  assert.equal(r.weeks[3].start, '2026-09-07');
  assert.equal(r.weeks[3].prevMs, null);
  assert.equal(r.weeks[3].deltaPct, null);
});

test('weeks: a week before with no hours → null percent, difference in time', () => {
  const r = ST.rangeSummary('2026-09-30', (d) => (d === '2026-09-29' ? dayOf(1) : null));
  assert.equal(r.weeks[0].deltaMs, HOUR);
  assert.equal(r.weeks[0].deltaPct, null);
});

test('addDays crosses the daylight saving change (25.10.2026) and the month end correctly', () => {
  assert.equal(ST.addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(ST.addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(ST.addDays('2026-12-31', 1), '2027-01-01');
});

test('manager: lastDays includes the running session of today', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-st-'));
  let now = at(2026, 9, 29, 9);
  const m = new SessionManager({ dir, now: () => now });
  m.begin('Ieri'); now += 2 * HOUR; m.stop();
  now = at(2026, 9, 30, 10);
  m.begin('Azi'); now += 30 * MIN;
  const r = m.lastDays(30);
  assert.equal(r.to, '2026-09-30');
  assert.deepEqual(r.days.slice(-2).map((d) => [d.day, d.totalMs, d.inProgress]), [['2026-09-29', 2 * HOUR, false], ['2026-09-30', 30 * MIN, true]]);
  assert.equal(r.weeks[0].totalMs, 2.5 * HOUR);
});
