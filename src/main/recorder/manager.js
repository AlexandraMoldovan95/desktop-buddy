'use strict';
// Window recording: starts automatically from rules (or by hand), writes the file in chunks,
// stops when the window closes, on request or after the maximum length.
//
// Who does what:
//  - here (main process): picks the window, writes the file, keeps the list of recordings;
//  - a hidden window (src/renderer/recorder/) does the capture (getDisplayMedia + MediaRecorder)
//    and sends video chunks every ~1–3 s, so a crash loses only the last few seconds.
// All dependencies (Electron, fs, clock) come from outside, so it can be tested with stand-ins.

const path = require('path');
const R = require('./rules');
const C = require('./clips');

const POLL_MS = 500;        // how often we check the open windows (automated tests open and close the app quickly)
const IDLE_POLL_MS = 2000;  // nothing recording: rules are checked less often
const MISS_LIMIT = 2;       // the window is missing 2 times in a row → it closed
const ATTACH_TIMEOUT_MS = 8000;
const STOP_TIMEOUT_MS = 10000;
const MAX_INDEX = 300;
const EMPTY_MSG = 'The file came out empty.';
/** A timer that doesn't keep the process alive (matters in tests; changes nothing in the app). */
const later = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); return t; };

class RecorderManager {
  /**
   * @param {object} o
   * @param {() => object} o.getSettings
   * @param {() => Promise<{id:string,name:string}[]>} o.getSources     the open windows
   * @param {() => Promise<{ start(cfg:object):Promise<void>, attach():Promise<void>, stop():Promise<void>, destroy():void }>} o.openCapture
   * @param {() => string} o.resolveFolder
   * @param {object} o.index        JsonStore with { items: [...] }
   * @param {object} o.fs
   * @param {(s:object) => void} [o.onChange]
   * @param {(kind:string, info:object) => void} [o.onEvent]  'started' | 'saved' | 'error'
   * @param {() => number} [o.now]
   */
  constructor(o) {
    Object.assign(this, {
      getSettings: o.getSettings,
      getSources: o.getSources,
      openCapture: o.openCapture,
      resolveFolder: o.resolveFolder,
      index: o.index,
      fs: o.fs,
      onChange: o.onChange || (() => {}),
      onEvent: o.onEvent || (() => {}),
      onDiag: o.onDiag || (() => {}),
      now: o.now || Date.now,
      pollMs: o.pollMs || POLL_MS,
      idlePollMs: o.idlePollMs || (() => IDLE_POLL_MS),   // while only rules wait for a match
    });
    this.autoOn = false;      // syncAuto() was called (the app, not unit tests)
    this.timerMs = 0;
    this.cur = null;          // the recording in progress
    this.capture = null;
    this.pending = null;      // the source we give to getDisplayMedia
    this.skip = new Set();    // windows stopped by hand: we don't restart on them until they close
    this.timer = null;
    this.polling = false;
    this.lastError = null;
    this.lastSaved = null;
  }

  // ------------------------------------------------ checking the windows
  /**
   * (Re)arms the window check at the rate the current state needs:
   * fast while recording / waiting, slow while only rules wait for a match, off when there is nothing to watch.
   */
  syncAuto() {
    this.autoOn = true;
    const ms = this.nextPollMs();
    if (ms === this.timerMs && (this.timer || !ms)) return;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.timerMs = ms;
    if (!ms) { this.skip.clear(); return; }
    this.timer = setInterval(() => { this.poll(); }, ms);
    if (this.timer.unref) this.timer.unref();
  }

  /** 0 = no polling needed. */
  nextPollMs() {
    if (this.cur) return this.pollMs;
    const s = this.getSettings();
    if (!(s.recAuto && (s.recRules || []).some((r) => r && r.enabled !== false))) return 0;
    return Math.max(this.pollMs, this.idlePollMs());
  }

  /** How many milliseconds we wait for the app to reopen, to continue in the same file (0 = not at all). */
  mergeMs() {
    const n = Number(this.getSettings().recMergeSec);
    return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
  }

  /** When the app quits: stops and waits for the file to close (at most `ms`). */
  async shutdown(ms = 12000) {
    this.autoOn = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (!this.cur) return;
    await this.stop('quit');
    await this.waitIdle(ms);
  }

  /** Resolves when no recording is in progress (or after `ms`). */
  waitIdle(ms = 12000) {
    return new Promise((resolve) => {
      const t0 = this.now();
      const check = () => {
        if (!this.cur || this.now() - t0 > ms) return resolve(!this.cur);
        setTimeout(check, 100);
      };
      check();
    });
  }

  /** One check: starts / stops based on the open windows. */
  async poll() {
    if (this.polling) return;
    // with no recording in progress and no automatic start from rules, there is no point listing the windows
    const s = this.getSettings();
    if (!this.cur && !(s.recAuto && (s.recRules || []).some((r) => r && r.enabled !== false))) {
      this.skip.clear();
      return;
    }
    // waiting, with no new window: the wait ends even if the listing fails
    if (this.cur && this.cur.status === 'waiting' && this.now() > this.cur.waitUntil) { await this.stop('closed'); return; }
    this.polling = true;
    try {
      let sources;
      try {
        sources = await this.getSources();
      } catch (err) {
        // a transient listing error (sleep/resume, session lock) must not end a running recording: count it as a miss
        const c = this.cur;
        if (!c || c.status !== 'recording') throw err;
        console.warn('[recorder] getSources failed while recording:', err && err.message);
        if (++c.miss >= MISS_LIMIT) await this.onSourceEnded();
        return;
      }
      const ids = new Set(sources.map((s) => s.id));
      for (const id of [...this.skip]) if (!ids.has(id)) this.skip.delete(id);
      if (this.cur && this.cur.status === 'recording') {
        if (ids.has(this.cur.source.id)) this.cur.miss = 0;
        else if (++this.cur.miss >= MISS_LIMIT) await this.onSourceEnded();
        return;
      }
      if (this.cur && this.cur.status === 'waiting') {
        const c = this.cur;
        const m = c.rule
          ? R.findMatch(sources, [{ ...c.rule, enabled: true }], this.skip)
          : (() => { const src = R.pickable(sources).find((x) => x.name === c.source.name && !this.skip.has(x.id)); return src ? { source: src } : null; })();
        if (m) await this.reattach(m.source);
        return;
      }
      if (this.cur || !this.getSettings().recAuto) return;
      // H5: after a failed auto start (folder unreachable…) wait 10 s, 20 s … 5 min; a new folder retries now
      const folder = this.resolveFolder();
      if (folder !== this.autoFailFolder) this.autoFails = 0;
      if (this.autoFails && this.now() < this.autoRetryAt) return;
      const m = R.findMatch(sources, this.getSettings().recRules, this.skip);
      if (m) {
        try { await this.begin(m.source, m.rule); } catch (err) { this.fail(err); }
        if (this.cur) this.autoFails = 0;
        else {
          this.autoFails = (this.autoFails || 0) + 1;
          this.autoFailFolder = folder;
          this.autoRetryAt = this.now() + Math.min(300000, 10000 * 2 ** (this.autoFails - 1));
        }
      } else this.onDiag({ windows: R.pickable(sources).map((s) => s.name), skipped: this.skip.size });
    } catch (err) {
      this.fail(err);
    } finally {
      this.polling = false;
    }
  }

  // ------------------------------------------------ start / stop
  async startManual(sourceId) {
    if (this.cur) throw new Error('Already recording a window.');
    const source = (await this.getSources()).find((s) => s.id === sourceId);
    if (!source || R.OWN_TITLE_RE.test(source.name)) throw new Error('That window is no longer open.');
    return this.begin(source, null);
  }

  async begin(source, rule) {
    const s = this.getSettings();
    const folder = this.resolveFolder();
    this.fs.mkdirSync(folder, { recursive: true });
    this.lastError = null;
    this.pending = source;
    this.cur = {
      id: `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'starting',
      source: { id: source.id, name: source.name },
      rule: rule ? { id: rule.id, title: rule.title } : null,
      label: rule ? rule.title : source.name,
      folder,
      startedAt: this.now(),
      activeMs: 0,
      paused: false,
      bytes: 0,
      miss: 0,
      marks: [],
      file: null,
      stream: null,
    };
    this.changed();
    const cur = this.cur;
    cur.startTimer = later(() => {
      if (this.cur === cur && cur.status === 'starting') this.fail(new Error('The capture didn\'t start within 15 seconds.'));
    }, 15000);
    try {
      this.capture = await this.openCapture();
      await this.capture.start({
        profile: R.captureProfile(s.recQuality, s.recFps, { lowPower: !!(s.powerInfo && s.powerInfo.low) }),
        mimes: R.MIME_CANDIDATES,
        skipIdle: !!s.recSkipIdle,
        idleMs: Math.round(s.recIdleSec * 1000),
      });
      const maxMs = s.recMaxMinutes * 60000;
      if (this.cur === cur) cur.maxTimer = later(() => { this.stop('max'); }, maxMs);
    } catch (err) {
      this.fail(err);
    }
  }

  /** The capture window started and picked the format: we open the file. */
  onStarted({ ext, width, height } = {}) {
    const c = this.cur;
    if (!c || c.status !== 'starting') return;
    const safeExt = ext === 'webm' ? 'webm' : 'mp4';
    let name = R.fileName(c.label, new Date(c.startedAt), safeExt);
    if (this.fs.existsSync(path.join(c.folder, name))) name = name.replace(/\.(\w+)$/, ` (${c.id.slice(-4)}).$1`);
    c.file = path.join(c.folder, name);
    c.part = c.file + '.part';
    c.stream = this.fs.createWriteStream(c.part);
    c.stream.on('error', (err) => this.fail(err));
    clearTimeout(c.startTimer);
    c.size = width && height ? `${width}×${height}` : null;
    c.status = 'recording';
    this.pending = null;
    this.changed();
    this.onEvent('started', { label: c.label });
  }

  onChunk(buf) {
    const c = this.cur;
    // after onDone the stream is ending: a late chunk must never reach it (write after end → error)
    if (!c || !c.stream || c.done || !buf || !buf.length) return;
    c.stream.write(buf);
    c.bytes += buf.length;
  }

  onStatus({ activeMs, paused } = {}) {
    const c = this.cur;
    if (!c) return;
    const wasPaused = c.paused;
    if (Number.isFinite(activeMs)) c.activeMs = activeMs;
    c.paused = !!paused;
    c.statusAt = this.now();
    this.changed(wasPaused !== c.paused);
  }

  // ------------------------------------------------ marks (good moments, for cutting)
  /** Marks the current moment in the video (time in the file, without pauses). Returns ms or null. */
  mark() {
    const c = this.cur;
    if (!c || !['recording', 'waiting', 'attaching'].includes(c.status) || !c.stream) return null;
    const running = c.status === 'recording' && !c.paused && c.statusAt;
    const t = Math.max(0, Math.round(c.activeMs + (running ? this.now() - c.statusAt : 0)));
    const last = c.marks[c.marks.length - 1];
    if (last !== undefined && t - last < 1000) return null;   // double press
    c.marks.push(t);
    this.changed();
    this.onEvent('marked', { label: c.label, n: c.marks.length, t });
    return t;
  }

  // ------------------------------------------------ the app closes and reopens (repeated tests)
  /** The window closed: either we stop, or we wait for it to come back and continue in the same file. */
  async onSourceEnded() {
    const c = this.cur;
    if (!c || c.status !== 'recording') return;
    const wait = this.mergeMs();
    if (!wait) { await this.stop('closed'); return; }
    c.status = 'waiting';
    c.waitUntil = this.now() + wait;
    c.miss = 0;
    this.pending = null;
    this.changed();
    if (this.capture && this.capture.detach) { try { await this.capture.detach(); } catch { /* nimic */ } }
  }

  /** The window appeared again: the capture moves to it, no new file. */
  async reattach(source) {
    const c = this.cur;
    if (!c || c.status !== 'waiting') return;
    c.status = 'attaching';
    c.nextSource = { id: source.id, name: source.name };
    this.pending = source;
    this.changed();
    c.attachTimer = later(() => {
      // it didn't work: back to waiting (until the deadline)
      if (this.cur === c && c.status === 'attaching') { c.status = 'waiting'; this.pending = null; this.changed(); }
    }, ATTACH_TIMEOUT_MS);
    try { await this.capture.attach(); } catch (err) { this.fail(err); }
  }

  onAttached() {
    const c = this.cur;
    if (!c || c.status !== 'attaching') return;
    clearTimeout(c.attachTimer);
    c.source = c.nextSource || c.source;
    c.status = 'recording';
    c.miss = 0;
    c.parts = (c.parts || 1) + 1;
    this.pending = null;
    this.changed();
    this.onEvent('resumed', { label: c.label, parts: c.parts });
  }

  /** Stop: we ask the capture window to finish; the file closes in onDone. */
  async stop(reason = 'manual') {
    const c = this.cur;
    if (!c) return null;
    if (reason === 'manual') this.skip.add(c.source.id);
    if (c.status === 'starting') { this.cleanup(); this.changed(); return null; }
    if (!['recording', 'waiting', 'attaching'].includes(c.status)) return null;
    clearTimeout(c.attachTimer);
    c.status = 'stopping';
    c.reason = reason;
    this.changed();
    clearTimeout(c.maxTimer);
    c.stopTimer = later(() => { this.onDone({}); }, STOP_TIMEOUT_MS);
    try { await this.capture.stop(); } catch { this.onDone({}); }
    return c.id;
  }

  onDone({ activeMs } = {}) {
    const c = this.cur;
    if (!c || !c.stream || c.done) return;
    c.done = true;
    clearTimeout(c.stopTimer);
    clearTimeout(c.maxTimer);
    if (Number.isFinite(activeMs)) c.activeMs = activeMs;
    const finish = () => {
      try {
        // trust the disk, not the counter: an ENOSPC or a failed flush leaves fewer bytes than were sent
        let size = 0;
        try { size = this.fs.statSync(c.part).size; } catch { size = 0; }   // missing .part = nothing saved
        if (!c.bytes || !size) {
          this.fs.rmSync(c.part, { force: true });
          if (c.bytes) throw new Error(EMPTY_MSG);
        } else {
          this.fs.renameSync(c.part, c.file);
          const marks = c.marks.filter((t) => t <= c.activeMs + 1000);
          let marksFile = null;
          if (marks.length) {
            marksFile = C.marksFilePath(c.file);
            try { this.fs.writeFileSync(marksFile, C.marksText(path.basename(c.file), marks), 'utf8'); } catch { marksFile = null; }
          }
          const item = {
            id: c.id, file: c.file, label: c.label, rule: c.rule ? c.rule.title : null, window: c.source.name,
            startedAt: c.startedAt, endedAt: this.now(), activeMs: c.activeMs, bytes: size, size: c.size, reason: c.reason || 'manual', parts: c.parts || 1,
            marks, marksFile,
          };
          this.index.update((d) => { d.items = C.capIndex([item, ...d.items.filter((x) => x.id !== item.id)], this.fs, MAX_INDEX); });
          C.saveIndexNow(this.index);
          this.lastSaved = item;
          // stopped by an error: one notification (the error, saying the data was kept) instead of "error" + "saved"
          if (c.failMsg) this.onEvent('error', { message: `${c.failMsg} What was recorded so far is kept.` });
          else this.onEvent('saved', item);
        }
      } catch (err) {
        console.warn('[recorder] finish failed:', err && err.message);
        const m = (err && err.message) || '';
        const known = friendlyError(m);
        this.lastError = known !== m || m === EMPTY_MSG ? `Couldn't save the recording. ${known}` : 'Couldn\'t save the recording.';
        this.onEvent('error', { message: this.lastError });
      }
      this.cleanup();
      this.changed();
    };
    c.stream.end(finish);
  }

  fail(err) {
    const message = (err && err.message) || String(err);
    this.lastError = friendlyError(message);
    const c = this.cur;
    if (c && c.done) {
      // already finalizing: never destroy or delete the file being closed; finish() reports the result
      console.warn('[recorder] error while finalizing:', message);
      this.changed();
      return;
    }
    if (c && c.stream && c.bytes) {
      // keep what was recorded so far
      c.failMsg = this.lastError;
      this.onDone({});
      this.changed();
      return;
    } else {
      if (c && c.stream) { try { c.stream.destroy(); this.fs.rmSync(c.part, { force: true }); } catch { /* nimic */ } }
      this.cleanup();
    }
    this.changed();
    this.onEvent('error', { message: this.lastError });
  }

  cleanup() {
    const c = this.cur;
    if (c) { clearTimeout(c.maxTimer); clearTimeout(c.stopTimer); clearTimeout(c.startTimer); clearTimeout(c.attachTimer); }
    if (this.capture) { try { this.capture.destroy(); } catch { /* nimic */ } }
    this.capture = null;
    this.pending = null;
    this.cur = null;
  }

  // ------------------------------------------------ for the interface
  state() {
    const c = this.cur;
    return {
      auto: !!this.getSettings().recAuto,
      recording: c ? {
        status: c.status, label: c.label, window: c.source.name, rule: c.rule && c.rule.title,
        startedAt: c.startedAt, activeMs: c.activeMs, paused: c.paused, bytes: c.bytes, manual: !c.rule,
        parts: c.parts || 1, marks: c.marks.length, waitLeftMs: c.status === 'waiting' ? Math.max(0, c.waitUntil - this.now()) : null,
      } : null,
      lastError: this.lastError,
      lastSaved: this.lastSaved ? { id: this.lastSaved.id, label: this.lastSaved.label } : null,
    };
  }

  /**
   * Startup: a crash or power loss mid-recording leaves "X.mp4.part". MediaRecorder output stays playable when cut,
   * so it becomes a normal recording (reason 'recovered'). Unfinished clip exports ("clips/*.part", old "clipuri/*.part") are removed.
   * @returns {Promise<number>} how many recordings were recovered
   */
  async recoverParts() {
    const fsp = this.fs.promises;
    const folder = this.resolveFolder();
    const curPart = this.cur && this.cur.part;
    let names;
    try { names = await fsp.readdir(folder); } catch { return 0; }   // no recordings folder yet
    const items = [];
    for (const name of names) {
      const m = /^(.+)\.(mp4|webm)\.part$/i.exec(name);
      if (!m) continue;
      const part = path.join(folder, name);
      if (part === curPart) continue;
      try {
        const st = await fsp.stat(part);
        if (!st.isFile()) continue;
        if (!st.size) { await fsp.rm(part, { force: true }); continue; }
        let file = path.join(folder, `${m[1]}.${m[2]}`);
        for (let i = 2; this.fs.existsSync(file) && i < 100; i++) file = path.join(folder, `${m[1]} (${i}).${m[2]}`);
        await fsp.rename(part, file);
        const label = m[1].replace(/ \d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}(?: \(\w+\))?$/, '') || m[1];
        items.push({
          id: `${Math.round(st.mtimeMs).toString(36)}-${Math.random().toString(36).slice(2, 8)}`, file, label, rule: null, window: label,
          startedAt: Math.round(st.birthtimeMs || st.mtimeMs), endedAt: Math.round(st.mtimeMs), activeMs: 0, bytes: st.size, size: null,
          reason: 'recovered', parts: 1, marks: [], marksFile: null,
        });
      } catch (e) {
        console.warn('[recorder] could not recover a .part file:', e && (e.code || e.message));
      }
    }
    try {
      for (const sub of C.CLIP_FOLDERS) {   // "clips" and the old "clipuri" folder
        let names = [];
        try { names = await fsp.readdir(path.join(folder, sub)); } catch (e) { if (e && e.code !== 'ENOENT') throw e; }
        for (const name of names) {
          if (/\.part$/i.test(name)) await fsp.rm(path.join(folder, sub, name), { force: true });
        }
      }
    } catch (e) {
      if (e && e.code !== 'ENOENT') console.warn('[recorder] unfinished clips not removed:', e.code || e.message);
    }
    if (items.length) {
      items.sort((a, b) => b.endedAt - a.endedAt);
      this.index.update((d) => { d.items = C.capIndex([...items, ...d.items], this.fs, MAX_INDEX); });
      C.saveIndexNow(this.index);
    }
    return items.length;
  }

  /**
   * Recordings only (no clips), newest first, each with `clips` = how many of its clips still exist.
   * Clips must not push recordings out of the Video tab list.
   */
  listRecordings(limit = 20) {
    const exists = (f) => { try { return this.fs.existsSync(f); } catch { return false; } };
    const out = [];
    for (const it of this.index.data.items) {
      if (out.length >= limit) break;
      if (!it.clipOf && exists(it.file)) out.push({ ...publicItem(it), clips: 0 });
    }
    const byId = new Map(out.map((x) => [x.id, x]));
    for (const it of this.index.data.items) {
      const p = it.clipOf && byId.get(it.clipOf);
      if (p && exists(it.file)) p.clips++;
    }
    return out;
  }

  /** Saved recordings that still exist on disk, newest first. */
  list(limit = 20) {
    return this.index.data.items
      .filter((it) => { try { return this.fs.existsSync(it.file); } catch { return false; } })
      .slice(0, limit)
      .map((it) => ({ ...it, name: path.basename(it.file) }));
  }

  find(id) {
    return this.index.data.items.find((it) => it.id === id) || null;
  }

  changed() {
    if (this.autoOn) this.syncAuto();   // recording started / ended: switch the polling rate
    this.onChange(this.state());
  }
}

// r2 M1: what a page may see of an index item (pages never receive file paths: no `file`, `marksFile`)
const PUBLIC_FIELDS = ['id', 'label', 'window', 'rule', 'startedAt', 'endedAt', 'activeMs', 'bytes', 'size', 'reason', 'parts', 'marks', 'clipOf'];
function publicItem(it) {
  const out = { name: path.basename(it.file) };
  for (const k of PUBLIC_FIELDS) if (it[k] !== undefined) out[k] = it[k];
  return out;
}

function friendlyError(msg) {
  if (/Permission|NotAllowed/i.test(msg)) return 'Windows didn\'t allow capturing the window.';
  if (/NotReadable|Could not start/i.test(msg)) return 'This window can\'t be recorded (maybe it is minimized or protected).';
  if (/ENOSPC/.test(msg)) return 'The disk is full.';
  if (/EACCES|EPERM/.test(msg)) return 'No permission to write in the recordings folder. Pick another folder.';
  if (/ENOENT|ENOTDIR|EROFS|ENODEV/.test(msg)) return 'The recordings folder isn\'t available (maybe it is on a USB stick that was removed). Pick another folder.';
  if (/EBUSY/.test(msg)) return 'The file is open in another program. Close it and try again.';
  return msg;
}

module.exports = { IDLE_POLL_MS, RecorderManager, publicItem, PUBLIC_FIELDS, POLL_MS, MISS_LIMIT, ATTACH_TIMEOUT_MS, friendlyError };
