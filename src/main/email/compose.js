'use strict';
// Email content (plain text), from the data the app already has.
// Pure functions: they send nothing, they only build { subject, text }.

const S = require('../sessions');
const U = require('../activity/usage');

const MAX_SUBJECT = 200;
/** The subject must not contain new lines (otherwise headers could be "injected" into the email). */
const oneLine = (s) => String(s).replace(/[\r\n\t\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, MAX_SUBJECT);
/** "1 day", "5 days" (English plural). */
const days = (n) => (n === 1 ? '1 day' : `${n} days`);
const hm = (ts) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const longDate = (ts) => new Date(ts).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const dayLabel = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); };

function appsBlock(apps, limit = 8) {
  if (!apps || !apps.length) return ['  (no apps recorded)'];
  const lines = [];
  for (const a of apps.slice(0, limit)) {
    lines.push(`  • ${a.name}: ${S.formatShort(a.ms)}`);
    for (const t of (a.titles || []).slice(0, 3)) lines.push(`      – ${t.title}: ${S.formatShort(t.ms)}`);
  }
  if (apps.length > limit) lines.push(`  … and ${apps.length - limit} more`);
  return lines;
}

/** The report of a stopped session (the same content as the report in the Session tab). */
function sessionReportEmail(r) {
  const text = [
    `Session: ${r.title}`,
    `${longDate(r.startedAt)}, ${hm(r.startedAt)} – ${hm(r.endedAt)}`,
    '',
    `Work time: ${S.formatShort(r.activeMs)}`,
    `Breaks: ${r.pauses ? `${r.pauses} (${S.formatShort(r.pausedMs)})` : 'no breaks'}`,
    '',
    'Apps used:',
    ...appsBlock(r.apps),
    '',
    '— Sent by Desktop Buddy. Active time only, breaks not counted.',
  ].join('\n');
  return { subject: oneLine(`Session ended: ${r.title} · ${S.formatShort(r.activeMs)}`), text };
}

/** A session report rebuilt from a saved record (for the preview). */
function reportFromRecord(rec) {
  return {
    title: rec.title,
    startedAt: rec.start,
    endedAt: rec.end,
    activeMs: rec.activeMs,
    pauses: Math.max(0, (rec.segments || []).length - 1),
    pausedMs: Math.max(0, rec.end - rec.start - rec.activeMs),
    apps: U.topApps([{ apps: rec.apps, titles: rec.titles }], { titlesPerApp: 3 }),
  };
}

/** The summary of the last 30 days (from ST.rangeSummary). */
function rangeReportEmail(r) {
  const pct = (w) => (w.deltaPct === null ? '' : ` (${w.deltaPct >= 0 ? '+' : '−'}${Math.round(Math.abs(w.deltaPct) * 100)}%)`);
  const delta = (w) => {
    if (w.prevMs === null) return '—';
    if (w.deltaMs === 0) return 'the same';
    return `${w.deltaMs > 0 ? '+' : '−'}${S.formatShort(Math.abs(w.deltaMs))}${pct(w)}`;
  };
  const weeks = r.weeks.map((w) => `  • ${w.current ? 'This week' : `${dayLabel(w.start)} – ${dayLabel(w.end)}`}: ${S.formatShort(w.totalMs)}, average ${S.formatShort(w.avgMs)} / day, compared with the week before: ${delta(w)}`);
  const text = [
    `Last ${days(r.n)} (${dayLabel(r.from)} – ${dayLabel(r.to)})`,
    '',
    `Total worked: ${S.formatShort(r.totalMs)}`,
    `Days worked: ${r.activeDays} of ${r.n}`,
    `Average per day worked: ${r.activeDays ? S.formatShort(r.avgActiveMs) : '–'}`,
    '',
    'By week (Monday–Sunday):',
    ...(weeks.length ? weeks : ['  (nothing)']),
    '',
    'Most used apps:',
    ...appsBlock(r.apps.map((a) => ({ name: `${a.name} (on ${days(a.days)})`, ms: a.ms }))),
    '',
    '— Sent by Desktop Buddy.',
  ].join('\n');
  return { subject: oneLine(`Desktop Buddy: last ${days(r.n)} · ${S.formatShort(r.totalMs)}`), text };
}

/** A note: the subject = the first line (the title), the body = the whole text. */
function noteEmail(body) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const title = (text.split('\n').find((l) => l.trim()) || '').trim() || 'Note';
  return { subject: oneLine(`Note: ${title}`), text: `${text.trimEnd()}\n\n— Sent from Desktop Buddy.` };
}

module.exports = { sessionReportEmail, reportFromRecord, rangeReportEmail, noteEmail, oneLine, days };
