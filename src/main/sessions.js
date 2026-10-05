'use strict';
// Work sessions: the rules (pure, tested functions).
//
// An active session is an object:
//   { id, title, startedAt, state: 'running' | 'paused', segments: [{ start, end|null }],
//     lastSavedAt, recovered, hoursNotified }
// Active time = the sum of the segments (only while running, without pauses).
// On stop, the session is split by days (at local midnight) and each part
// is written to its day's file: sessions/YYYY-MM-DD.json.

const crypto = require('crypto');
const U = require('./activity/usage');

const MAX_TITLE = 120;

function cleanTitle(title) {
  const t = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE) : '';
  return t || 'Untitled session';
}

function startSession(title, now = Date.now()) {
  return {
    version: 1,
    id: crypto.randomUUID(),
    title: cleanTitle(title),
    startedAt: now,
    state: 'running',
    segments: [{ start: now, end: null }],
    lastSavedAt: now,
    recovered: false,
    hoursNotified: 0,
    usage: {},  // time per app, per day (see activity/usage.js)
  };
}

function pauseSession(s, now = Date.now()) {
  if (!s || s.state !== 'running') return s;
  const segments = s.segments.map((seg, i) => (i === s.segments.length - 1 && seg.end === null ? { ...seg, end: Math.max(seg.start, now) } : seg));
  return { ...s, state: 'paused', segments };
}

function resumeSession(s, now = Date.now()) {
  if (!s || s.state !== 'paused') return s;
  return { ...s, state: 'running', recovered: false, segments: [...s.segments, { start: now, end: null }] };
}

function renameSession(s, title) {
  return s ? { ...s, title: cleanTitle(title) } : s;
}

/** Active time in milliseconds (the open segment counts until `now`). */
function activeMs(s, now = Date.now()) {
  if (!s) return 0;
  return s.segments.reduce((sum, seg) => sum + Math.max(0, (seg.end ?? now) - seg.start), 0);
}

/**
 * After a crash we don't know how long the app kept running: we close the open segment at the last
 * save and pause the session. At most the interval between saves is lost.
 */
function recoverSession(s) {
  if (!s || !Array.isArray(s.segments) || !s.segments.length) return null;
  const last = s.segments[s.segments.length - 1];
  if (last.end === null) {
    const end = Math.max(last.start, s.lastSavedAt || last.start);
    return { ...s, state: 'paused', recovered: true, segments: [...s.segments.slice(0, -1), { ...last, end }] };
  }
  return { ...s, state: 'paused' };
}

// ------------------------------------------------ days (local time)
function dayKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function nextMidnight(ts) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** Splits the segments by day: { '2026-09-28': [{start,end}], ... }. */
function splitByDay(segments) {
  const out = {};
  for (const seg of segments) {
    if (seg.end === null || seg.end <= seg.start) continue;
    let a = seg.start;
    while (a < seg.end) {
      const b = Math.min(seg.end, nextMidnight(a));
      (out[dayKey(a)] ||= []).push({ start: a, end: b });
      a = b;
    }
  }
  return out;
}

/**
 * Turns a stopped session into per-day records. A 23:00–01:30 session
 * becomes two parts: one on day 1 (23:00–24:00) and one on day 2 (00:00–01:30).
 * @returns {{ day: string, record: object }[]}
 */
function toDayRecords(s, endedAt) {
  const byDay = splitByDay(s.segments);
  const days = Object.keys(byDay).sort();
  return days.map((day, i) => {
    const segs = byDay[day];
    return {
      day,
      record: {
        id: s.id,
        part: days.length > 1 ? i + 1 : undefined,
        parts: days.length > 1 ? days.length : undefined,
        title: s.title,
        start: segs[0].start,
        end: segs[segs.length - 1].end,
        activeMs: segs.reduce((t, x) => t + (x.end - x.start), 0),
        segments: segs,
        sessionStartedAt: s.startedAt,
        sessionEndedAt: endedAt,
        apps: { ...((s.usage && s.usage[day] && s.usage[day].apps) || {}) },
        titles: { ...((s.usage && s.usage[day] && s.usage[day].titles) || {}) },
      },
    };
  });
}

/** Adds or replaces (by id) the record in a day's list. */
function upsertDayRecord(list, record) {
  const i = list.findIndex((r) => r.id === record.id);
  if (i === -1) return [...list, record].sort((a, b) => a.start - b.start);
  const next = [...list];
  next[i] = record;
  return next;
}

/** "1 hour has passed", "2 hours have passed" (English plural). */
function hoursPassedText(n) {
  return n === 1 ? '1 hour has passed' : `${n} hours have passed`;
}

/** How many full hours of active work were reached and not announced yet. */
function hoursToNotify(s, now = Date.now(), hourMs = 3600000) {
  if (!s || s.state !== 'running') return 0;
  const done = Math.floor(activeMs(s, now) / hourMs);
  return done > (s.hoursNotified || 0) ? done : 0;
}

/** The final summary (without apps; those are added in step 3). */
function buildReport(s, endedAt) {
  const total = activeMs(s, endedAt);
  const span = Math.max(0, endedAt - s.startedAt);
  return {
    id: s.id,
    title: s.title,
    startedAt: s.startedAt,
    endedAt,
    activeMs: total,
    pausedMs: Math.max(0, span - total),
    pauses: Math.max(0, s.segments.length - 1),
    apps: U.topApps(Object.values(s.usage || {})), // [{ name, ms, titles: [{ title, ms }] }]
  };
}

/** "45 s", "12 min", "1 h 05 min" — for notifications. */
function formatShort(ms) {
  if (ms < 60000) return `${Math.max(0, Math.round(ms / 1000))} s`;
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

function formatDuration(ms, { seconds = true } = {}) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const p = (n) => String(n).padStart(2, '0');
  return seconds ? `${h}:${p(m)}:${p(s)}` : `${h} h ${p(m)} min`;
}

module.exports = {
  MAX_TITLE, cleanTitle, startSession, pauseSession, resumeSession, renameSession, activeMs,
  recoverSession, dayKey, nextMidnight, splitByDay, toDayRecords, upsertDayRecord, formatDuration,
  hoursPassedText, hoursToNotify, buildReport, formatShort,
};
