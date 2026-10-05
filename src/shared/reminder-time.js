'use strict';
// Reminders in notes (1.7.0): a reminder's time, the quick choices and the displayed text ("today at 15:00").
// Pure functions (page + main process + tests). The time is kept as milliseconds (Date.now()), so a daylight
// saving change does not move a reminder; the display uses the local calendar.
(function (root) {
  const MIN = 60000;
  const MAX_AHEAD_MS = 2 * 365 * 24 * 60 * MIN;     // at most 2 years ahead
  const PAST_TOLERANCE_MS = 5000;                   // "now" sent from a page may be a few seconds behind
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const pad = (n) => String(n).padStart(2, '0');
  const clock = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const dayStart = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  /** The difference in calendar days (correct across daylight saving changes: we round). */
  const dayDiff = (a, b) => Math.round((dayStart(a) - dayStart(b)) / (24 * 60 * MIN));
  const at = (now, addDays, h, m) => { const d = new Date(now); d.setDate(d.getDate() + addDays); d.setHours(h, m, 0, 0); return d.getTime(); };
  /** Rounded to the minute (reminders have no seconds). */
  const roundMin = (ms) => Math.ceil(ms / MIN) * MIN;

  /** A valid reminder: an integer, in the future (with tolerance), at most 2 years ahead. */
  function isValidAt(ms, now = Date.now()) {
    return typeof ms === 'number' && Number.isFinite(ms) && ms > now - PAST_TOLERANCE_MS && ms <= now + MAX_AHEAD_MS;
  }

  /** "today at 15:00", "tomorrow at 09:30", "yesterday at 18:00", "Thursday, 9 Oct at 15:00" (+ the year, if different). */
  function formatAt(ms, now = Date.now()) {
    const d = new Date(ms);
    const diff = dayDiff(ms, now);
    const t = clock(d);
    if (diff === 0) return `today at ${t}`;
    if (diff === 1) return `tomorrow at ${t}`;
    if (diff === -1) return `yesterday at ${t}`;
    const year = d.getFullYear() !== new Date(now).getFullYear() ? ` ${d.getFullYear()}` : '';
    return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}${year} at ${t}`;
  }

  /** The quick choices on the reminder card (only those in the future). */
  function presets(now = Date.now()) {
    const list = [
      { id: '30m', label: 'In 30 min', at: roundMin(now + 30 * MIN) },
      { id: '1h', label: 'In 1 hour', at: roundMin(now + 60 * MIN) },
    ];
    const evening = at(now, 0, 18, 0);
    if (evening - now >= 30 * MIN) list.push({ id: 'evening', label: 'Today at 18:00', at: evening });
    list.push({ id: 'tomorrow', label: 'Tomorrow at 9:00', at: at(now, 1, 9, 0) });
    return list;
  }

  /** "Snooze": the choices after it rang. */
  function snoozes(now = Date.now()) {
    return [
      { id: '10m', label: '10 min', at: roundMin(now + 10 * MIN) },
      { id: '1h', label: '1 hour', at: roundMin(now + 60 * MIN) },
      { id: 'tomorrow', label: 'tomorrow at 9:00', at: at(now, 1, 9, 0) },
    ];
  }

  /** From the <input type="date"> and <input type="time"> fields → ms (local time), or null if invalid. */
  function fromInputs(date, time) {
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
    const tm = /^(\d{2}):(\d{2})$/.exec(String(time || ''));
    if (!dm || !tm) return null;
    const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]), 0, 0);
    // 31 February etc. → Date "slides" into the next month: we refuse it
    if (d.getMonth() !== Number(dm[2]) - 1 || d.getHours() !== Number(tm[1])) return null;
    return d.getTime();
  }

  /** The values for the date / time fields (prefill). */
  function toInputs(ms) {
    const d = new Date(ms);
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: clock(d) };
  }

  const api = { MIN, MAX_AHEAD_MS, PAST_TOLERANCE_MS, isValidAt, formatAt, presets, snoozes, fromInputs, toInputs, roundMin };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReminderTime = api;
})(typeof window !== 'undefined' ? window : globalThis);
