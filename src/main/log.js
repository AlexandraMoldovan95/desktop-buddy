'use strict';
// Small file logger for the main process: userData/logs/main.log, rotated at a size cap
// (main.log + main.1.log). Appends are async and queued, so callers never block on disk.
// Never pass note / clipboard text or secrets here: only codes, channels and file names.

const fs = require('fs');
const path = require('path');

const MAX_BYTES = 1024 * 1024; // per file; two files kept

// Full paths are shortened to their file name (user names live in paths).
const PATH_RE = /(?:[A-Za-z]:)?(?:[\\/][^\\/\s'"`:*?<>|]+)+[\\/]([^\\/\s'"`]+)/g;
const QUOTED_PATH_RE = /(['"])([^'"]*[\\/][^'"]*)\1/g; // node quotes paths, which may contain spaces

// r2 sec L4: known private folders (home, data, app) are replaced by a short tag first, whatever characters
// the user name has (spaces included). Case-insensitive, either slash.
let prefixes = [];
const escapeRe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function setPrivatePrefixes(list) {
  prefixes = list
    .filter(([p]) => typeof p === 'string' && p.replace(/[\\/]+$/, '').length > 3)
    .map(([p, tag]) => [p.replace(/[\\/]+$/, ''), tag])
    .sort((a, b) => b[0].length - a[0].length)   // the longest (most specific) first
    .map(([p, tag]) => [new RegExp(p.split(/[\\/]+/).map(escapeRe).join('[\\\\/]+') + '(?=$|[\\\\/\\s\'"`:)\\]])', 'gi'), tag]);
}
setPrivatePrefixes([[require('os').homedir(), '~']]);

function scrub(text) {
  let t = String(text);
  for (const [re, tag] of prefixes) t = t.replace(re, tag);
  return t
    .replace(QUOTED_PATH_RE, (_m, q, p) => `${q}…/${p.split(/[\\/]/).pop()}${q}`)
    .replace(PATH_RE, '…/$1').replace(/\s+/g, ' ').slice(0, 500);
}

function describe(err) {
  if (!err) return '';
  if (typeof err !== 'object') return scrub(err);
  const code = err.code ? `${err.code} ` : '';
  const msg = scrub(err.message || String(err));
  const stack = typeof err.stack === 'string'
    ? err.stack.split('\n').slice(1, 4).map((l) => scrub(l.trim())).join(' | ')
    : '';
  return `${code}${msg}${stack ? ` @ ${stack}` : ''}`;
}

/**
 * @param {{ fs?: typeof fs, maxBytes?: number, console?: Console, now?: () => Date }} [opts]
 */
function createLogger(opts = {}) {
  const fsx = opts.fs || fs;
  const maxBytes = opts.maxBytes || MAX_BYTES;
  const out = opts.console || console;
  const now = opts.now || (() => new Date());
  let file = null;
  let size = 0;
  let chain = Promise.resolve();
  let broken = false; // the log itself failed: stop trying, console only

  function init(dir) {
    file = path.join(dir, 'main.log');
    try {
      fsx.mkdirSync(dir, { recursive: true });
      size = fsx.statSync(file).size;
    } catch (err) {
      // ENOENT is the normal first run; anything else means no file log this run
      if (err.code !== 'ENOENT') { broken = true; out.warn('[log] no log file:', err.code || err.message); }
      size = 0;
    }
  }

  async function append(line) {
    if (size + line.length > maxBytes) {
      try { await fsx.promises.rename(file, file.replace(/\.log$/, '.1.log')); } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      size = 0;
    }
    await fsx.promises.appendFile(file, line, 'utf8');
    size += Buffer.byteLength(line);
  }

  function write(level, scope, msg, err) {
    const line = `${now().toISOString()} ${level.toUpperCase()} [${scope}] ${scrub(msg)}${err ? ' — ' + describe(err) : ''}\n`;
    (level === 'error' ? out.error : level === 'warn' ? out.warn : out.log).call(out, line.trimEnd());
    if (!file || broken) return chain;
    chain = chain.then(() => append(line)).catch((e) => {
      broken = true;
      out.warn('[log] cannot write the log file:', e.code || e.message);
    });
    return chain;
  }

  /** Synchronous last-resort write (startup failure right before exit). */
  function fatalSync(scope, msg, err) {
    const line = `${now().toISOString()} FATAL [${scope}] ${scrub(msg)}${err ? ' — ' + describe(err) : ''}\n`;
    out.error(line.trimEnd());
    if (!file) return;
    try { fsx.appendFileSync(file, line, 'utf8'); } catch (e) { out.error('[log] fatalSync failed:', e.code || e.message); }
  }

  return {
    init,
    info: (scope, msg, err) => write('info', scope, msg, err),
    warn: (scope, msg, err) => write('warn', scope, msg, err),
    error: (scope, msg, err) => write('error', scope, msg, err),
    fatalSync,
    /** Resolves when queued writes are done (tests). */
    flushed: () => chain,
    get file() { return file; },
    get dir() { return file ? path.dirname(file) : null; },
  };
}

const log = createLogger();

module.exports = { log, createLogger, scrub, describe, setPrivatePrefixes, MAX_BYTES };
