'use strict';
// Made-up data for screenshots and the web demo: 30 days of timer sessions, a few notes and copied texts.
// Used by `npm run demo` (Node) and by the web demo (browser), so both show the same history.
// Everything is relative to `now`, so "today" is always today.
(function (root) {
  const MIN = 60000;
  const SEP = '\u0000';
  const pad = (n) => String(n).padStart(2, '0');
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const code = ['Visual Studio Code', 0.5, [['recorder.js - desktop buddy portfolio', 0.6], ['editor.js - desktop buddy portfolio', 0.3], ['README.md', 0.1]]];
  const ue = ['Unreal Editor', 0.2, [['Prototype_Map - Unreal Editor', 1]]];
  const chrome = ['Google Chrome', 0.2, [['Electron docs - desktopCapturer', 0.5], ['MDN - MediaRecorder', 0.5]]];
  const term = ['Windows Terminal', 0.1, [['npm start', 1]]];
  const figma = ['Figma', 0.1, [['Desktop Buddy - UI', 1]]];
  const word = ['Microsoft Word', 0.3, [['Game design doc.docx', 1]]];
  const notesApp = ['Note Organizer', 0.6, [['Note Organizer', 1]]];

  // hours per day, today first; 0 = a day off. Today and yesterday get their own sessions below.
  const HOURS = [0, 0, 5.6, 3.1, 0.6, 0, 0, 4.2, 6.3, 1.5, 3.8, 2.2, 0, 0.4, 5.1, 3.3, 0, 2.9, 4.4, 0, 0, 1.2, 3.6, 5.8, 2.7, 0.9, 0, 3.2, 4.9, 1.8];
  const TITLES = ['Prototype - combat feel', 'Level blockout', 'Statistics window', 'Design doc review', 'Session timer', 'Clipboard secret filter'];

  /**
   * The per-day session files: { 'YYYY-MM-DD': { version, date, sessions } }.
   * @param {number} now  ms
   */
  function days(now) {
    const out = {};
    let n = 0;
    const day = (offset, sessions) => {
      const base = new Date(now);
      base.setHours(0, 0, 0, 0);
      base.setDate(base.getDate() - offset);
      const records = sessions.map(([title, segs, apps]) => {
        const segments = segs.map((g) => (g.abs ? { start: g.abs[0], end: g.abs[1] }
          : { start: base.getTime() + (g[0] * 60 + g[1]) * MIN, end: base.getTime() + (g[2] * 60 + g[3]) * MIN }))
          .filter((x) => x.end <= now);   // never in the future
        if (!segments.length) return null;
        const activeMs = segments.reduce((t, x) => t + x.end - x.start, 0);
        const appMs = {};
        const titleMs = {};
        for (const [name, share, titles] of apps) {
          appMs[name] = Math.round(activeMs * share);
          for (const [t, sh] of titles) titleMs[name + SEP + t] = Math.round(activeMs * share * sh);
        }
        n += 1;
        const id = `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`;
        return { id, title, start: segments[0].start, end: segments[segments.length - 1].end, activeMs, segments, apps: appMs, titles: titleMs };
      }).filter(Boolean);
      if (!records.length) return;
      const date = dayKey(base);
      out[date] = { version: 1, date, sessions: records };
    };
    // today: two sessions that end before now (relative to the current time, never in the future)
    const H = 3600000;
    const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
    const rel = (a, b) => [Math.max(midnight.getTime(), now - a * H), now - b * H];
    const today = [['Clip editor - export queue', [rel(6, 4.5), rel(4.2, 2.6)], [code, chrome, term]], ['Note Organizer - AI test run', [rel(2, 0.7)], [notesApp, term, code]]];
    day(0, today.map(([t, segs, apps]) => [t, segs.filter(([a, b]) => b - a >= 5 * MIN).map(([a, b]) => ({ abs: [a, b] })), apps]).filter((x) => x[1].length));
    day(1, [['Window recorder - merge relaunches', [[9, 30, 12, 5], [12, 50, 15, 10]], [code, term, chrome]],
      ['Portfolio README', [[20, 0, 21, 5]], [code, chrome]]]);
    HOURS.forEach((h, i) => {
      if (!h) return;
      const end = 9 * 60 + Math.round(h * 60);
      const apps = i % 3 === 0 ? [ue, chrome, figma, word] : i % 3 === 1 ? [code, chrome, term, figma] : [word, chrome, ue];
      day(i, [[TITLES[i % TITLES.length], [[9, 0, Math.floor(end / 60), end % 60]], apps]]);
    });
    return out;
  }

  /** A few notes (one with a checklist, one with a reminder later today). */
  function notes(now) {
    const id = (k) => `0000000${k}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
    return [
      { id: id(1), body: 'Shopping list\n[x] bread\n[x] eggs\n[ ] milk\n[ ] coffee', createdAt: now - 3 * 3600000, updatedAt: now - 3 * 3600000 },
      { id: id(2), body: 'Boss fight ideas\nPhase 2: the arena floods, the boss can only be hit from the pillars.\nPhase 3: the water freezes.', createdAt: now - 26 * 3600000, updatedAt: now - 26 * 3600000 },
      { id: id(3), body: 'Portfolio\nRecord the AI test run of Note Organizer and cut 3 short clips.', createdAt: now - 50 * 3600000, updatedAt: now - 2 * 3600000, remind: { at: now + 2 * 3600000, status: 'pending' } },
    ];
  }

  /** Copied texts (no secrets: those are never saved). */
  function clipboard(now) {
    const id = (k) => `0000000${k}-cccc-4ccc-8ccc-cccccccccccc`;
    return [
      { id: id(1), text: 'npm run dist', createdAt: now - 4 * 60000, pinned: false },
      { id: id(2), text: 'https://www.electronjs.org/docs/latest/api/desktop-capturer', createdAt: now - 35 * 60000, pinned: true },
      { id: id(3), text: 'Phase 2: the arena floods, the boss can only be hit from the pillars.', createdAt: now - 2 * 3600000, pinned: false },
      { id: id(4), text: 'git commit -m "feat: mark moments with a flag on the buddy"', createdAt: now - 5 * 3600000, pinned: false },
    ];
  }

  const api = { days, notes, clipboard, dayKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DemoData = api;
})(globalThis);
