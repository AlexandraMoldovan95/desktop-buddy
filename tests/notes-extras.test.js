'use strict';
// Checklists and reminders in notes (1.7.0): shared/checklist.js, shared/reminder-time.js,
// the rules in main/notes.js and ReminderScheduler (fake clock and timers, no Electron).
const test = require('node:test');
const assert = require('node:assert/strict');
const CL = require('../src/shared/checklist');
const RT = require('../src/shared/reminder-time');
const N = require('../src/main/notes');
const { ReminderScheduler, due, nextAt, STARTUP_GRACE_MS } = require('../src/main/reminders');

const apply = (text, r) => text.slice(0, r.start) + r.text + text.slice(r.end);

test('checklists: which line is a checkbox ([ ] / [x] / - [ ]), how many are checked', () => {
  assert.deepEqual(CL.parseLine('[ ] bread'), { indent: '', bullet: '', checked: false, boxStart: 0, boxEnd: 3, textStart: 4 });
  assert.equal(CL.parseLine('  - [X] tea').checked, true);
  assert.equal(CL.parseLine('  - [X] tea').boxStart, 4);
  assert.equal(CL.parseLine('[ ]').textStart, 3, 'an empty box at the end of a line');
  for (const no of ['[] bread', '[ ]bread', 'bread [ ]', '[y] x', '']) assert.equal(CL.parseLine(no), null, no);
  assert.deepEqual(CL.count('Weekly shop\n[ ] bread\n[x] honey\n - [X] tea\ntext'), { total: 3, done: 2 });
  assert.deepEqual(CL.count(''), { total: 0, done: 0 });
});

test('checklists: Ctrl+Enter adds boxes, then checks / unchecks; a selection over several lines', () => {
  const t = 'Weekly shop\nbread\nhoney\n\ntea';
  const r1 = CL.toggle(t, 13, 20);                  // "bread" + "honey" selected
  const t1 = apply(t, r1);
  assert.equal(t1, 'Weekly shop\n[ ] bread\n[ ] honey\n\ntea', 'empty lines get no box');
  const r2 = CL.toggle(t1, 14);                     // the caret on "bread"
  const t2 = apply(t1, r2);
  assert.equal(t2, 'Weekly shop\n[x] bread\n[ ] honey\n\ntea');
  assert.deepEqual([r2.selStart, r2.selEnd], [14, 14], 'the caret stays put');
  const t3 = apply(t2, CL.toggle(t2, 12, t2.length));   // mixed → all checked
  assert.equal(t3, 'Weekly shop\n[x] bread\n[x] honey\n\ntea', 'lines without a box stay untouched');
  assert.equal(apply(t3, CL.toggle(t3, 12, 31)), 'Weekly shop\n[ ] bread\n[ ] honey\n\ntea', 'all checked → all unchecked');
  const ind = apply('  soup', CL.toggle('  soup', 3));
  assert.equal(ind, '  [ ] soup', 'the indent stays');
  const r = CL.toggle('a\nb', 0, 2);                // the selection ends at the start of line "b"
  assert.equal(apply('a\nb', r), '[ ] a\nb');
});

test('checklists: Enter continues the list, Enter on an empty line ends it; a click between the brackets', () => {
  assert.deepEqual(CL.onEnter('[ ] bread', 9), { start: 9, end: 9, text: '\n[ ] ', caret: 14 });
  assert.deepEqual(CL.onEnter('  - [x] done', 12), { start: 12, end: 12, text: '\n  - [ ] ', caret: 21 }, 'same indent and dash, unchecked');
  assert.deepEqual(CL.onEnter('x\n[ ] ', 6), { start: 2, end: 6, text: '', caret: 2 });
  assert.equal(CL.onEnter('text simplu', 5), null);
  assert.equal(CL.onEnter('[ ] bread', 1), null, 'the caret in the box: a normal Enter');
  assert.deepEqual(CL.boxAt('x\n[ ] a', 3), { start: 2, end: 7 });
  assert.equal(CL.boxAt('x\n[ ] a', 2), null, 'at the start of the line it does not check (you can put the caret there)');
  assert.equal(CL.boxAt('x\n[ ] a', 6), null);
});

test('reminder time: "today / tomorrow / yesterday / day, date", the quick choices, the date / time fields', () => {
  const now = new Date(2026, 9, 1, 14, 20).getTime();   // Wednesday, 1 Oct 2026, 14:20
  assert.equal(RT.formatAt(new Date(2026, 9, 1, 15, 0).getTime(), now), 'today at 15:00');
  assert.equal(RT.formatAt(new Date(2026, 9, 2, 9, 5).getTime(), now), 'tomorrow at 09:05');
  assert.equal(RT.formatAt(new Date(2026, 8, 30, 18, 0).getTime(), now), 'yesterday at 18:00');
  assert.equal(RT.formatAt(new Date(2026, 9, 9, 15, 0).getTime(), now), 'Friday, 9 Oct at 15:00');
  assert.equal(RT.formatAt(new Date(2027, 0, 4, 8, 0).getTime(), now), 'Monday, 4 Jan 2027 at 08:00');
  const p = RT.presets(now);
  assert.deepEqual(p.map((x) => x.id), ['30m', '1h', 'evening', 'tomorrow']);
  assert.equal(p[0].at, new Date(2026, 9, 1, 14, 50).getTime());
  assert.equal(p[3].at, new Date(2026, 9, 2, 9, 0).getTime());
  assert.ok(!RT.presets(new Date(2026, 9, 1, 17, 45).getTime()).some((x) => x.id === 'evening'), 'in the evening: no "Today at 18:00"');
  assert.equal(RT.fromInputs('2026-10-02', '09:30'), new Date(2026, 9, 2, 9, 30).getTime());
  assert.equal(RT.fromInputs('2026-02-31', '09:30'), null, '31 February does not exist');
  assert.equal(RT.fromInputs('today', '9'), null);
  assert.deepEqual(RT.toInputs(new Date(2026, 9, 2, 9, 5).getTime()), { date: '2026-10-02', time: '09:05' });
  assert.equal(RT.isValidAt(now + 60000, now), true);
  assert.equal(RT.isValidAt(now - 60000, now), false, 'in the past');
  assert.equal(RT.isValidAt(now + 3 * 365 * 864e5, now), false, 'more than 2 years ahead');
  assert.equal(RT.isValidAt('15:00', now), false);
});

test('notes: a reminder is set / removed without changing the order; from the file it is validated', () => {
  const now = 1_800_000_000_000;
  const notes = [{ id: 'a', body: 'x', createdAt: 1, updatedAt: 5 }];
  const n1 = N.setReminder(notes, 'a', now + 3600000, now);
  assert.deepEqual(n1[0].remind, { at: now + 3600000, status: 'pending' });
  assert.equal(n1[0].updatedAt, 5);
  assert.equal('remind' in N.setReminder(n1, 'a', null, now)[0], false);
  assert.throws(() => N.setReminder(notes, 'a', now - 60000, now), /future/);
  assert.throws(() => N.setReminder(notes, 'b', now + 1, now), /no longer exists/);
  // saving the text keeps the reminder
  assert.deepEqual(N.saveNote(n1, 'a', 'new', now)[0].remind, n1[0].remind);
  assert.deepEqual(N.normalizeNote({ id: 'a', body: '', remind: { at: 5, status: 'fired', firedAt: 9, extra: 1 } }).remind, { at: 5, status: 'fired', firedAt: 9 });
  for (const bad of [{ at: 'x', status: 'pending' }, { at: 5, status: 'oops' }, null, 7]) {
    assert.equal('remind' in N.normalizeNote({ id: 'a', body: '', remind: bad }), false, JSON.stringify(bad));
  }
});

function fakeWorld(notes, start) {
  const w = { now: start, timers: [], fired: [], missed: [], notes };
  w.deps = {
    getNotes: () => w.notes,
    setStatus: (ids, status, now) => { w.notes = w.notes.map((n) => (ids.includes(n.id) ? { ...n, remind: { ...n.remind, status, firedAt: now } } : n)); },
    onFire: (n, late) => w.fired.push([n.id, late]),
    onMissed: (list) => w.missed.push(list.map((n) => n.id)),
    now: () => w.now,
    setTimer: (fn, ms) => { const t = { fn, at: w.now + ms }; w.timers.push(t); return t; },
    clearTimer: (t) => { w.timers = w.timers.filter((x) => x !== t); },
  };
  w.advance = (ms) => {
    const until = w.now + ms;
    for (;;) {
      w.timers.sort((a, b) => a.at - b.at);
      const t = w.timers[0];
      if (!t || t.at > until) break;
      w.timers.shift();
      w.now = t.at;
      t.fn();
    }
    w.now = until;
  };
  return w;
}

test('reminders: at startup, what passed while the app was closed is "missed" (only once); what is due now rings', () => {
  const T = 1_800_000_000_000;
  const w = fakeWorld([
    { id: 'old', body: 'a', remind: { at: T - 3 * 3600000, status: 'pending' } },
    { id: 'now', body: 'b', remind: { at: T - 20000, status: 'pending' } },          // under 1 min: still rings
    { id: 'future', body: 'c', remind: { at: T + 90000, status: 'pending' } },
    { id: 'done', body: 'd', remind: { at: T - 5000, status: 'fired' } },
  ], T);
  const s = new ReminderScheduler(w.deps);
  s.start();
  assert.deepEqual(w.missed, [['old']]);
  assert.deepEqual(w.fired, [['now', 20000]]);
  assert.equal(w.notes.find((n) => n.id === 'old').remind.status, 'missed');
  w.advance(89000);
  assert.equal(w.fired.length, 1, 'not yet');
  w.advance(1500);
  assert.deepEqual(w.fired[1], ['future', 0], 'rings right on time (the timer is set to its time)');
  w.advance(10 * 60000);
  assert.equal(w.fired.length, 2, 'nothing rings twice');
  // "restart": the state is in the notes, so nothing repeats
  const s2 = new ReminderScheduler(w.deps);
  s2.start();
  assert.deepEqual(w.missed.length, 1);
  assert.equal(w.fired.length, 2);
  s.stop(); s2.stop();
});

test('reminders: a new one set after startup rings (poke), the computer sleeping does not lose it', () => {
  const T = 1_800_000_000_000;
  const w = fakeWorld([{ id: 'a', body: 'x' }], T);
  const s = new ReminderScheduler(w.deps);
  s.start();
  assert.equal(nextAt(w.notes), null);
  w.notes = N.setReminder(w.notes, 'a', T + 5 * 60000, T);
  s.check();   // what ipc.js does after notes:set-reminder
  w.advance(5 * 60000 + 1000);
  assert.deepEqual(w.fired, [['a', 0]]);
  // sleep: timers don't run, then "resume" → check()
  w.notes = N.setReminder(w.notes, 'a', w.now + 60000, w.now);
  w.timers = [];
  w.now += 2 * 3600000;
  s.check();
  assert.equal(w.fired[1][0], 'a');
  assert.ok(w.fired[1][1] > 3600000, 'the delay is known (the notification says "was due …")');
  assert.deepEqual(due([{ id: 'x', remind: { at: 1, status: 'pending' } }], 0), []);
  assert.ok(STARTUP_GRACE_MS >= 30000);
  s.stop();
});
