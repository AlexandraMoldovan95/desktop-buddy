'use strict';
// Session tests (step 1): pause, days, midnight, recovery after a crash.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../src/main/sessions');
const { SessionManager } = require('../src/main/session-manager');

const at = (y, mo, d, h, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
const MIN = 60000;
const HOUR = 3600000;

test('session: active time does not include pauses', () => {
  const t0 = at(2026, 9, 28, 10);
  let s = S.startSession('  Electron   homework ', t0);
  assert.equal(s.title, 'Electron homework');
  s = S.pauseSession(s, t0 + 20 * MIN);
  s = S.resumeSession(s, t0 + 50 * MIN);     // 30 min pause
  assert.equal(S.activeMs(s, t0 + 60 * MIN), 30 * MIN);
  assert.equal(S.pauseSession(S.pauseSession(s, t0 + 60 * MIN), t0 + 90 * MIN).segments.length, 2, 'a double pause breaks nothing');
});

test('session: empty title → "Untitled session", a title that is too long → cut', () => {
  assert.equal(S.cleanTitle('   '), 'Untitled session');
  assert.equal(S.cleanTitle('x'.repeat(500)).length, S.MAX_TITLE);
});

test('midnight: 23:00–01:30 is split over two days', () => {
  let s = S.startSession('Night', at(2026, 9, 28, 23));
  s = S.pauseSession(s, at(2026, 9, 29, 1, 30));
  const recs = S.toDayRecords(s, at(2026, 9, 29, 1, 30));
  assert.deepEqual(recs.map((r) => r.day), ['2026-09-28', '2026-09-29']);
  assert.equal(recs[0].record.activeMs, HOUR);
  assert.equal(recs[1].record.activeMs, 90 * MIN);
  assert.deepEqual([recs[0].record.part, recs[0].record.parts], [1, 2]);
  assert.equal(recs[0].record.id, recs[1].record.id);
});

test('recovery after a crash: the open segment closes at the last save, paused', () => {
  const t0 = at(2026, 9, 28, 9);
  const s = { ...S.startSession('X', t0), lastSavedAt: t0 + 45 * MIN };
  const r = S.recoverSession(s);
  assert.equal(r.state, 'paused');
  assert.equal(r.recovered, true);
  assert.equal(S.activeMs(r, t0 + 5 * HOUR), 45 * MIN, 'the time the app was closed does not count');
});

test('manager: start → pause → stop writes the day file; a second start is refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-s-'));
  let now = at(2026, 9, 28, 14);
  const events = [];
  const m = new SessionManager({ dir, now: () => now, onChange: (st) => events.push(st.session && st.session.state) });
  m.begin('Report');
  assert.throws(() => m.begin('Another session'));
  now += 40 * MIN; m.pause();
  now += 10 * MIN; m.resume();
  now += 20 * MIN;
  assert.equal(m.today().totalMs, 60 * MIN);
  const sum = m.stop();
  assert.equal(sum.activeMs, 60 * MIN);
  assert.equal(sum.saved, true);
  assert.equal(m.session, null);
  const day = JSON.parse(fs.readFileSync(path.join(dir, 'sessions', '2026-09-28.json'), 'utf8'));
  assert.equal(day.sessions.length, 1);
  assert.equal(day.sessions[0].title, 'Report');
  assert.equal(day.sessions[0].activeMs, 60 * MIN);
  assert.deepEqual(events, ['running', 'paused', 'running', null]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'active-session.json'), 'utf8')).session, null);
});

test('manager: a crash during a session → on restart it is recovered, paused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-s-'));
  let now = at(2026, 9, 28, 8);
  const m1 = new SessionManager({ dir, now: () => now });
  m1.begin('Work');
  now += 30 * MIN; await m1.autosave();    // the last periodic save
  now += 10 * MIN;                          // … then a "crash" (no shutdown)
  const m2 = new SessionManager({ dir, now: () => now + 2 * HOUR });
  assert.equal(m2.session.state, 'paused');
  assert.equal(m2.session.recovered, true);
  assert.equal(S.activeMs(m2.session, now + 2 * HOUR), 30 * MIN);
});

test('manager: a normal exit → the session stays paused, no time lost', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-s-'));
  let now = at(2026, 9, 28, 8);
  const m1 = new SessionManager({ dir, now: () => now });
  m1.begin('Work');
  now += 25 * MIN;
  m1.shutdown();
  const m2 = new SessionManager({ dir, now: () => now + HOUR });
  assert.equal(m2.session.state, 'paused');
  assert.equal(m2.session.recovered, false);
  assert.equal(S.activeMs(m2.session, now + HOUR), 25 * MIN);
});

test('manager: a repeated stop after a crash does not duplicate the session in the day file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-s-'));
  let now = at(2026, 9, 28, 10);
  const m = new SessionManager({ dir, now: () => now });
  m.begin('A');
  now += 10 * MIN;
  const s = m.session;
  m.stop();
  // we simulate: the active session stayed on disk (crash before deleting) and is stopped again
  const again = new SessionManager({ dir, now: () => now });
  again.set({ ...s, state: 'paused', segments: [{ start: s.startedAt, end: now }] }, { silent: true });
  again.stop();
  assert.equal(again.dayRecords('2026-09-28').length, 1);
});

test('manager: a session under one second is not saved', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-s-'));
  const now = at(2026, 9, 28, 10);
  const m = new SessionManager({ dir, now: () => now });
  m.begin('Mistake');
  assert.equal(m.stop().saved, false);
  assert.equal(fs.existsSync(path.join(dir, 'sessions')), false);
});

test('displayed length', () => {
  assert.equal(S.formatDuration(3723000), '1:02:03');
  assert.equal(S.formatDuration(3723000, { seconds: false }), '1 h 02 min');
});

// ------------------------------------------------------------ step 2: notifications and report
test('notification: the text in English, with the right plural', () => {
  assert.equal(S.hoursPassedText(1), '1 hour has passed');
  assert.equal(S.hoursPassedText(2), '2 hours have passed');
  assert.equal(S.hoursPassedText(19), '19 hours have passed');
  assert.equal(S.hoursPassedText(20), '20 hours have passed');
});

test('notification: once per active hour, not while paused, never twice', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-s-'));
  let now = at(2026, 9, 28, 9);
  const fired = [];
  const m = new SessionManager({ dir, now: () => now, onHour: (h) => fired.push(h) });
  m.begin('Work');
  now += 59 * MIN; m.checkHours();
  assert.deepEqual(fired, []);
  now += 1 * MIN; m.checkHours(); m.checkHours();          // exactly 1 h, checked twice
  assert.deepEqual(fired, [1]);
  m.pause(); now += 3 * HOUR; m.checkHours();              // the long pause does not count
  assert.deepEqual(fired, [1]);
  m.resume(); now += 59 * MIN; m.checkHours();
  assert.deepEqual(fired, [1]);
  now += 1 * MIN; m.checkHours();                           // the second active hour
  assert.deepEqual(fired, [1, 2]);
  // after a restart (crash), the number of announced hours stays
  const m2 = new SessionManager({ dir, now: () => now, onHour: (h) => fired.push(h) });
  m2.resume(); m2.checkHours();
  assert.deepEqual(fired, [1, 2]);
});

test('final report: title, active time, pauses', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-s-'));
  let now = at(2026, 9, 28, 9);
  const m = new SessionManager({ dir, now: () => now });
  m.begin('Final report');
  now += 50 * MIN; m.pause();
  now += 10 * MIN; m.resume();
  now += 25 * MIN;
  const r = m.stop();
  assert.equal(r.title, 'Final report');
  assert.equal(r.activeMs, 75 * MIN);
  assert.equal(r.pausedMs, 10 * MIN);
  assert.equal(r.pauses, 1);
  assert.deepEqual(r.apps, []);
  assert.equal(r.saved, true);
});
