'use strict';
// Time per app and per window title (pure, tested functions).
//
// In the active session: usage = { 'YYYY-MM-DD': { apps: { name: ms }, titles: { 'name\u0000title': ms } } }
// The title key includes the app, so the same title in two apps doesn't get mixed up.

const MAX_TICK_MS = 5000;       // a longer "gap" (sleep, freeze) doesn't count as work
const MAX_TITLES_PER_DAY = 300; // above that, the rest goes to "(other windows)"
const MAX_TITLE_LEN = 200;
const SEP = '\u0000';
const OTHER_TITLES = '(other windows)';
// Day files written before the English pass use this key; topApps shows it as OTHER_TITLES.
const LEGACY_OTHER_TITLES = '(alte ferestre)';

/** Cleans a sample from the helper. Returns null if there is no active window. */
function normalizeSample(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let app = typeof raw.app === 'string' ? raw.app.trim() : '';
  let title = typeof raw.title === 'string' ? raw.title.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE_LEN) : '';
  // modern Windows apps (Settings, Calculator...) all show up as "Application Frame Host"
  if (/^application ?frame ?host$/i.test(app) && title) { app = title; title = ''; }
  if (!app) return null;
  return { app: app.slice(0, 80), title };
}

/** Adds `ms` for the sample's app (and, optionally, title) on the given day. Changes `usage`. */
function addUsage(usage, day, sample, ms, { titles = true } = {}) {
  if (!sample || !(ms > 0)) return usage;
  const d = (usage[day] ||= { apps: {}, titles: {} });
  d.apps[sample.app] = (d.apps[sample.app] || 0) + ms;
  if (titles && sample.title) {
    let key = sample.app + SEP + sample.title;
    if (!(key in d.titles) && Object.keys(d.titles).length >= MAX_TITLES_PER_DAY) key = sample.app + SEP + OTHER_TITLES;
    d.titles[key] = (d.titles[key] || 0) + ms;
  }
  return usage;
}

/** The length of a tick: the time since the previous tick, capped, so a big gap doesn't inflate the total. */
function tickMs(prevAt, now) {
  if (!prevAt || now <= prevAt) return 0;
  return Math.min(now - prevAt, MAX_TICK_MS);
}

/** The apps, sorted by time, with their top titles: [{ name, ms, titles: [{ title, ms }] }]. */
function topApps(dayUsages, { titlesPerApp = 3 } = {}) {
  const apps = {};
  const titles = {};
  for (const d of dayUsages) {
    if (!d) continue;
    for (const [name, ms] of Object.entries(d.apps || {})) apps[name] = (apps[name] || 0) + ms;
    for (const [key, ms] of Object.entries(d.titles || {})) {
      const k = key.endsWith(SEP + LEGACY_OTHER_TITLES) ? key.slice(0, -LEGACY_OTHER_TITLES.length) + OTHER_TITLES : key;
      titles[k] = (titles[k] || 0) + ms;
    }
  }
  return Object.entries(apps)
    .sort((a, b) => b[1] - a[1])
    .map(([name, ms]) => ({
      name,
      ms,
      titles: Object.entries(titles)
        .filter(([key]) => key.startsWith(name + SEP))
        .map(([key, t]) => ({ title: key.slice(name.length + 1), ms: t }))
        .sort((a, b) => b.ms - a.ms)
        .slice(0, titlesPerApp),
    }));
}

module.exports = { normalizeSample, addUsage, tickMs, topApps, MAX_TICK_MS, MAX_TITLES_PER_DAY, OTHER_TITLES, SEP };
