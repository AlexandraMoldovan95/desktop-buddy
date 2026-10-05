'use strict';
// A JSON file with atomic writes (tmp + rename) and grouped writes (debounce).
// A corrupt file doesn't stop the app: it is kept as *.corrupt-<time>.json and the app starts empty.
//
// Robustness (fix round 1):
// - a read error other than ENOENT is retried; if the file stays unreadable the store is
//   read-only for this run (flush refuses to overwrite a file we could not read);
// - every write is fsync'd, and the previous version is kept as <file>.bak;
// - an empty / corrupt main file is recovered from .bak automatically (`recovered`);
// - flush() returns true / false and keeps `lastError`.

const fs = require('fs');
const path = require('path');
const { log } = require('./log');

const RETRY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EIO', 'EAGAIN', 'EMFILE', 'ENFILE', 'UNKNOWN']);
const READ_RETRIES = 5;
const READ_RETRY_MS = 200;
const SAVE_RETRY_MAX_MS = 30000;
const FSYNC_GAP_MS = 30000;   // r2 perf M2: debounced saves fsync at most this often (explicit flush() always does)
const CORRUPT_KEEP = 2;       // r2 sec L1: broken copies kept per file

/** r2 sec L5: a JSON.parse error without the quoted file text (it can be note / clipboard text). */
function safeParseError(err) {
  const m = /position (\d+)/.exec(String(err && err.message));
  const out = new Error(`invalid JSON${m ? ` at position ${m[1]}` : ''}`);
  out.name = (err && err.name) || 'SyntaxError';
  return out;
}

function sleepSync(ms) {
  // only used on the error path at load time (antivirus / sync tool holding the file)
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

class JsonStore {
  /**
   * @param {string} file  the file's full path
   * @param {() => any} makeDefault  the initial value, when the file is missing or corrupt
   * @param {{ debounceMs?: number, normalize?: (data:any) => any, fs?: typeof fs, readRetryMs?: number,
   *           onProblem?: (p: { kind: string, file: string, error?: Error }) => void }} [opts]
   */
  constructor(file, makeDefault, opts = {}) {
    this.file = file;
    this.bak = file + '.bak';
    this.makeDefault = makeDefault;
    this.debounceMs = opts.debounceMs ?? 300;
    this.maxWaitMs = opts.maxWaitMs ?? Infinity;   // r2 perf M2: a stream of changes still saves at least this often
    this.pendingSince = null;
    this.normalize = opts.normalize || ((d) => d);
    this.fs = opts.fs || fs;
    this.readRetryMs = opts.readRetryMs ?? READ_RETRY_MS;
    this.onProblem = opts.onProblem || null;
    this.timer = null;
    this.readOnly = false;   // true = the file exists but could not be read: never overwrite it
    this.lastError = null;   // last save / load error (null when the last save worked)
    this.recovered = null;   // 'bak' = loaded from the backup copy, 'reset' = started empty, file kept aside
    this.saveFailures = 0;
    this.lastSyncAt = -Infinity;  // when a write was last fsync'd
    this.fsyncGapMs = opts.fsyncGapMs ?? FSYNC_GAP_MS;
    this.syncTimer = null;        // r3: catch-up fsync for an unsynced last write
    this.mainSynced = true;       // the current main file is durable (fsync'd or from an earlier run)
    this.now = opts.now || Date.now;
    this.data = this.load();
  }

  get name() { return path.basename(this.file); }

  /** Reads a file with a few retries for transient locks. @returns {{raw?: string, missing?: true, error?: Error}} */
  readRaw(file) {
    for (let i = 0; ; i++) {
      try {
        return { raw: this.fs.readFileSync(file, 'utf8') };
      } catch (err) {
        if (err.code === 'ENOENT') return { missing: true };
        if (!RETRY_CODES.has(err.code) || i >= READ_RETRIES - 1) return { error: err };
        sleepSync(this.readRetryMs);
      }
    }
  }

  /** Parses + normalizes; null when the content is empty or broken. */
  parse(raw) {
    if (typeof raw !== 'string' || !raw.replace(/[\s\0]/g, '')) return null;
    try {
      return { data: this.normalize(JSON.parse(raw)) };
    } catch (err) {
      return { error: err instanceof SyntaxError ? safeParseError(err) : err };
    }
  }

  problem(kind, error) {
    if (this.onProblem) {
      try { this.onProblem({ kind, file: this.file, error, failures: this.saveFailures }); } catch (e) { log.warn('store', `onProblem failed for ${this.name}`, e); }
    }
  }

  load() {
    const main = this.readRaw(this.file);
    if (main.error) {
      // C2: never treat "unreadable" as "empty": keep defaults in memory but don't save over it
      this.readOnly = true;
      this.lastError = main.error;
      log.error('store', `cannot read ${this.name}; read-only for this run`, main.error);
      this.problem('unreadable', main.error);
      return this.normalize(this.makeDefault());
    }
    if (main.missing) {
      // a crash between "main → .bak" and "tmp → main" leaves only the backup
      const b = this.readRaw(this.bak);
      const parsed = b.raw !== undefined ? this.parse(b.raw) : null;
      if (parsed && parsed.data !== undefined) {
        log.warn('store', `${this.name} missing, recovered from .bak`);
        this.recovered = 'bak';
        this.problem('recovered');
        return parsed.data;
      }
      return this.normalize(this.makeDefault());
    }
    const parsed = this.parse(main.raw);
    if (parsed && parsed.data !== undefined) return parsed.data;

    // empty or corrupt: keep the broken file aside, then try the backup copy
    const reason = parsed && parsed.error ? parsed.error : new Error('empty file');
    const aside = this.file.replace(/\.json$/, '') + `.corrupt-${Date.now()}.json`;
    let keptAside = false;
    try {
      this.fs.renameSync(this.file, aside);
      keptAside = true;
    } catch (err) {
      try { this.fs.copyFileSync(this.file, aside); keptAside = true; } catch (err2) {
        log.error('store', `cannot keep a copy of the broken ${this.name}`, err2);
      }
      if (!keptAside) log.error('store', `cannot move the broken ${this.name}`, err);
    }
    if (keptAside) { log.warn('store', `${this.name} was broken, kept as ${path.basename(aside)}`, reason); this.pruneCorrupt(CORRUPT_KEEP); }

    const b = this.readRaw(this.bak);
    const fromBak = b.raw !== undefined ? this.parse(b.raw) : null;
    if (fromBak && fromBak.data !== undefined) {
      log.warn('store', `${this.name} recovered from .bak`);
      this.recovered = 'bak';
      this.problem('recovered');
      return fromBak.data;
    }
    if (!keptAside) {
      // could not keep the original anywhere: don't overwrite it
      this.readOnly = true;
      this.lastError = reason;
      this.problem('unreadable', reason);
    } else {
      this.recovered = 'reset';
      this.problem('reset', reason);
    }
    return this.normalize(this.makeDefault());
  }

  /** The broken copies kept aside for this file (`<name>.corrupt-<time>.json`), newest first. */
  corruptCopies() {
    const dir = path.dirname(this.file);
    const base = path.basename(this.file).replace(/\.json$/, '');
    let names;
    try { names = this.fs.readdirSync(dir); } catch (err) { log.warn('store', `cannot list broken copies of ${this.name}`, err); return []; }
    const re = /^(.*)\.corrupt-(\d+)\.json$/;
    return names.map((n) => re.exec(n)).filter((m) => m && m[1] === base)
      .sort((a, b) => Number(b[2]) - Number(a[2])).map((m) => path.join(dir, m[0]));
  }

  /** Deletes all but the newest `keep` broken copies (0 = all). @returns {number} deleted */
  pruneCorrupt(keep = 0) {
    let n = 0;
    for (const f of this.corruptCopies().slice(keep)) {
      try { this.fs.unlinkSync(f); n++; } catch (err) { log.warn('store', `cannot delete an old broken copy of ${this.name}`, err); }
    }
    return n;
  }

  /**
   * r2 sec L2: saves now and rewrites .bak with the same content, so removed data (a password, cleared history)
   * doesn't survive in the backup copy. @returns {boolean}
   */
  flushScrubbed() {
    return this.flush() && this.flush();
  }

  /** The same, off the main thread (startup migration). */
  async flushScrubbedAsync() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return (await this.flushAsync({ fsync: true })) && this.flushAsync({ fsync: true });
  }

  /** Changes the data and schedules the save. */
  update(mutator) {
    const result = mutator(this.data);
    if (result !== undefined) this.data = result;
    this.scheduleSave();
    return this.data;
  }

  scheduleSave(delay = this.debounceMs, retry = false) {
    if (this.timer) clearTimeout(this.timer);
    const t = this.now();
    if (this.pendingSince === null) this.pendingSince = t;
    if (!retry) delay = Math.max(0, Math.min(delay, this.pendingSince + this.maxWaitMs - t));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pendingSince = null;
      this.flushAsync().then((ok) => {
        // a failed debounced save is retried with backoff (transient antivirus lock)
        if (!ok && !this.readOnly && !this.timer) {
          this.scheduleSave(Math.min(SAVE_RETRY_MAX_MS, 1000 * 2 ** Math.min(this.saveFailures, 5)), true);
        }
      });
    }, delay);
  }

  /**
   * Swaps tmp in: main → .bak, tmp → main (sync, metadata only).
   * The .bak is always a durable (fsync'd) version: when the current main was not fsync'd, it is replaced
   * without becoming the .bak.
   */
  commit(tmp, synced = true) {
    const f = this.fs;
    let movedToBak = false;
    if (this.mainSynced) {
      try {
        f.renameSync(this.file, this.bak);
        movedToBak = true;
      } catch (err) {
        if (err.code !== 'ENOENT') log.warn('store', `cannot refresh ${this.name}.bak`, err);
      }
    }
    try {
      f.renameSync(tmp, this.file);
    } catch (err) {
      if (movedToBak) {
        try { f.renameSync(this.bak, this.file); } catch (e) { log.warn('store', `cannot put ${this.name} back from .bak`, e); }
      }
      throw err;
    }
    this.mainSynced = synced;
    if (synced) this.lastSyncAt = this.now();
  }

  saved(ok, err) {
    if (ok) {
      if (this.saveFailures) log.info('store', `${this.name} saved again after ${this.saveFailures} failed attempt(s)`);
      this.saveFailures = 0;
      this.lastError = null;
      return true;
    }
    if (!this.saveFailures) log.error('store', `cannot save ${this.name}`, err);
    this.saveFailures++;
    this.lastError = err;
    this.problem('save-failed', err);
    return false;
  }

  /**
   * r3: an unsynced write with no later write would stay unsynced; fsync it once the gap is over.
   * The timer is unref'd so it never keeps a process alive.
   */
  armSyncCatchUp() {
    if (this.syncTimer || this.mainSynced || this.readOnly) return;
    const delay = Math.max(0, this.lastSyncAt + this.fsyncGapMs - this.now());
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      // a pending debounced save will sync (or re-arm) by itself
      if (!this.mainSynced && !this.timer && !this.readOnly) this.flushAsync({ fsync: true });
    }, delay);
    if (this.syncTimer.unref) this.syncTimer.unref();
  }

  /** True when the .bak parses and `pred(saved object)` is true (e.g. it still holds removed keys). */
  bakMatches(pred) {
    const b = this.readRaw(this.bak);
    if (b.raw === undefined) return false;
    try {
      return !!pred(JSON.parse(b.raw));
    } catch {
      return false; // a broken .bak holds nothing we can scrub; load() handles broken files
    }
  }

  /** Writes right away (on app exit or in tests). @returns {boolean} saved */
  flush() {
    if (this.syncTimer) { clearTimeout(this.syncTimer); this.syncTimer = null; }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.pendingSince = null;
    if (this.readOnly) return false;
    this.gen = (this.gen || 0) + 1; // an async write still in flight is now stale
    const f = this.fs;
    const tmp = this.file + '.tmp';
    try {
      f.mkdirSync(path.dirname(this.file), { recursive: true });
      const fd = f.openSync(tmp, 'w');
      try {
        f.writeSync(fd, JSON.stringify(this.data));
        f.fsyncSync(fd);
      } finally {
        f.closeSync(fd);
      }
      this.commit(tmp);
    } catch (err) {
      return this.saved(false, err);
    }
    return this.saved(true);
  }

  /**
   * Debounced save: write (+ fsync at most every FSYNC_GAP_MS, or when asked) off the main thread, then the quick sync renames.
   * @param {{ fsync?: boolean }} [opts]
   */
  async flushAsync(opts = {}) {
    if (this.readOnly) return false;
    if (this.writing) { this.writeAgain = true; if (opts.fsync) this.fsyncAgain = true; return this.writing; }
    const gen = this.gen = (this.gen || 0) + 1;
    const doSync = !!opts.fsync || this.now() - this.lastSyncAt >= this.fsyncGapMs;
    const json = JSON.stringify(this.data);
    const fsp = this.fs.promises;
    const tmp = this.file + '.atmp';
    this.writing = (async () => {
      let fh = null;
      try {
        await fsp.mkdir(path.dirname(this.file), { recursive: true });
        fh = await fsp.open(tmp, 'w');
        await fh.writeFile(json, 'utf8');
        if (doSync) await fh.sync();
        await fh.close();
        fh = null;
        if (gen !== this.gen || this.readOnly) {
          // a newer sync flush already wrote fresher data
          await fsp.unlink(tmp).catch(() => {}); // leftover tmp is harmless
          return true;
        }
        this.commit(tmp, doSync);
        if (!doSync) this.armSyncCatchUp();
        return this.saved(true);
      } catch (err) {
        if (fh) await fh.close().catch(() => {}); // already failing; the write error is what matters
        return this.saved(false, err);
      }
    })();
    const ok = await this.writing;
    this.writing = null;
    if (this.writeAgain) { const fsync = !!this.fsyncAgain; this.writeAgain = false; this.fsyncAgain = false; return this.flushAsync({ fsync }); }
    return ok;
  }
}

module.exports = { JsonStore, safeParseError, FSYNC_GAP_MS, CORRUPT_KEEP };
