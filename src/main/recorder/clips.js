'use strict';
// Cutting recordings into short clips (Portfolio only).
// The editor page plays the chosen part and re-records it (MediaRecorder), without ffmpeg;
// here, in the main process: the file names, range validation, writing to disk and the list of clips.

const path = require('path');
const { exportByteCap } = require('../limits');
const M = require('../../shared/montage');

const MIN_CLIP_MS = 500;
const MAX_CLIP_MS = 10 * 60000;
const BEFORE_MARK_MS = 8000;   // the suggested clip for a mark: 8 s before, 7 s after
const AFTER_MARK_MS = 7000;

const pad = (n) => String(n).padStart(2, '0');
/** 83500 → "1:23" (or "1:02:03" above an hour) */
function clock(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  return h ? `${h}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}` : `${Math.floor(t / 60)}:${pad(t % 60)}`;
}
/** For file names (no ":"): 83500 → "1m23s" */
const fileClock = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(t / 60)}m${pad(t % 60)}s`; };

/** The suggested range around a mark, within the video's limits. */
function markRange(t, durationMs) {
  const d = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : Infinity;
  let start = Math.max(0, t - BEFORE_MARK_MS);
  let end = Math.min(d, t + AFTER_MARK_MS);
  if (end - start < MIN_CLIP_MS) { start = Math.max(0, end - MIN_CLIP_MS); }
  return { start: Math.round(start), end: Math.round(end) };
}

/** Validates a range asked for by the page; throws a clear error if it is wrong. */
function checkRange(startMs, endMs, durationMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new Error('Invalid range.');
  const start = Math.max(0, Math.round(startMs));
  const end = Math.round(endMs);
  if (end - start < MIN_CLIP_MS) throw new Error('The clip is too short (at least half a second).');
  if (end - start > MAX_CLIP_MS) throw new Error('The clip is too long (10 minutes max).');
  if (Number.isFinite(durationMs) && durationMs > 0 && start >= durationMs + 1000) throw new Error('The start is after the end of the recording.');
  return { start, end };
}

// Clips go to a "clips" subfolder next to the recording. Before the English pass it was "clipuri": clips there are
// still indexed by absolute path, and leftover .part files are cleaned in both (see RecorderManager.recover).
const CLIP_FOLDER = 'clips';
const CLIP_FOLDERS = [CLIP_FOLDER, 'clipuri'];

/** "Note Organizer 2026-09-29 16-08-55 - clip 0m34s-0m49s.mp4", in the "clips" subfolder. */
function clipPath(parentFile, startMs, endMs, exists = () => false, ext = 'mp4') {
  return uniquePath(parentFile, `clip ${fileClock(startMs)}-${fileClock(endMs)}`, ext, exists);
}

/** "… - montage 3 parts 0m42s.mp4", also in "clips". */
function montagePath(parentFile, count, totalMs, exists = () => false, ext = 'mp4') {
  return uniquePath(parentFile, `montage ${count === 1 ? '1 part' : `${count} parts`} ${fileClock(totalMs)}`, ext, exists);
}

function uniquePath(parentFile, what, ext, exists) {
  const dir = path.join(path.dirname(parentFile), CLIP_FOLDER);
  const base = path.basename(parentFile).replace(/\.\w+$/, '');
  let file = path.join(dir, `${base} - ${what}.${ext}`);
  for (let i = 2; exists(file) && i < 100; i++) file = path.join(dir, `${base} - ${what} (${i}).${ext}`);
  return file;
}

/** The text file with marks, next to the recording. */
const marksFilePath = (videoFile) => videoFile.replace(/\.\w+$/, '') + ' - marks.txt';

function marksText(videoName, marks) {
  const lines = [
    `Marks for: ${videoName}`,
    'Time in the video (without pauses). Suggested clip: 8 s before, 7 s after.',
    'You can cut clips right in Desktop Buddy Portfolio: Video tab → "Cut a clip".',
    '',
  ];
  marks.forEach((t, i) => {
    const r = markRange(t);
    lines.push(`${i + 1}. ${clock(t)}   →   suggested clip ${clock(r.start)} – ${clock(r.end)}`);
  });
  return lines.join('\r\n') + '\r\n';
}

/**
 * Caps the shared index: clips and recordings are capped separately (clips can't evict recordings),
 * and a recording beyond the cap stays while its file still exists.
 */
function capIndex(items, fs, max = 300) {
  let recs = 0;
  let clips = 0;
  return items.filter((it) => {
    if (it.clipOf) return ++clips <= max;
    if (++recs <= max) return true;
    try { return fs.existsSync(it.file); } catch { return false; }
  });
}

class ClipExporter {
  /**
   * @param {{ index: object, fs: object, now?: () => number, onSaved?: (item:object) => void }} o
   */
  constructor(o) {
    this.index = o.index;
    this.fs = o.fs;
    this.now = o.now || Date.now;
    this.onSaved = o.onSaved || (() => {});
    this.jobs = new Map();
    this.seq = 0;
  }

  /**
   * Starts an export. `spec` = { parts: [{ start, end }], format: 'mp4', montage?, title?, fade? }
   * (see shared/montage.js → checkExport). The old form, begin(parent, startMs, endMs), means an MP4 clip.
   */
  begin(parent, spec, endMs) {
    if (!parent || !parent.file) throw new Error('This recording no longer exists.');
    if (typeof spec !== 'object' || spec === null) {
      const r = checkRange(spec, endMs, parent.activeMs);
      spec = { parts: [r], format: 'mp4' };
    }
    const x = M.checkExport(spec, parent.activeMs);
    const taken = (f) => this.fs.existsSync(f) || [...this.jobs.values()].some((j) => j.file === f);
    const start = x.parts[0].start;
    const end = x.parts[x.parts.length - 1].end;
    const file = x.kind === 'montage'
      ? montagePath(parent.file, x.parts.length, x.totalMs, taken, x.format)
      : clipPath(parent.file, start, end, taken, x.format);
    this.fs.mkdirSync(path.dirname(file), { recursive: true });
    const id = `c${this.now().toString(36)}-${(++this.seq).toString(36)}`;
    const job = { id, parent, start, end, spec: x, file, part: file + '.part', bytes: 0, maxBytes: exportByteCap(x.totalMs) };
    job.stream = this.fs.createWriteStream(job.part);
    job.stream.on('error', (e) => { job.failed = e || new Error('write failed'); });
    this.jobs.set(id, job);
    return { id, file, name: path.basename(file), start, end, ...x };
  }

  chunk(id, buf) {
    const job = this.jobs.get(id);
    if (!job || !buf || !buf.length || job.failed) return;
    // far more bytes than the clip length allows: stop writing, end() discards the file (L5)
    if (job.bytes + buf.length > job.maxBytes) { job.tooBig = true; job.failed = new Error('too big'); console.warn(`[clips] export ${id} stopped: too big`); return; }
    job.stream.write(buf);
    job.bytes += buf.length;
  }

  /** Ends every open job without saving (the editor window closed mid-export). */
  cancelAll() {
    return Promise.all([...this.jobs.keys()].map((id) => this.end(id, false).catch((e) => console.warn('[clips] cancel failed:', e && e.message))));
  }

  /** ok = true: saves and adds to the list; otherwise deletes the partial file. Rejects with a short message when saving fails. */
  end(id, ok) {
    const job = this.jobs.get(id);
    if (!job) return Promise.resolve(null);
    this.jobs.delete(id);
    return new Promise((resolve, reject) => {
      job.stream.end(() => {
        try {
          if (ok && job.failed && !job.tooBig) {
            this.fs.rmSync(job.part, { force: true });
            console.warn('[clips] write failed:', job.failed.message);
            reject(new Error(/ENOSPC/.test(job.failed.message) ? 'The disk is full.' : 'Couldn\'t write the clip to disk.'));
            return;
          }
          if (!ok || job.failed || !job.bytes) { this.fs.rmSync(job.part, { force: true }); resolve(null); return; }
          this.fs.renameSync(job.part, job.file);
          const p = job.parent;
          const x = job.spec;
          const what = x.kind === 'montage'
            ? `montage ${x.parts.length === 1 ? '1 part' : `${x.parts.length} parts`} (${clock(x.totalMs)})`
            : `clip ${clock(job.start)}–${clock(job.end)}`;
          const item = {
            id: job.id, file: job.file, label: `${p.label} · ${what}`, clipOf: p.id,
            window: p.window, rule: p.rule, startedAt: this.now(), endedAt: this.now(),
            startMs: job.start, endMs: job.end, activeMs: x.totalMs, bytes: job.bytes, size: p.size, reason: 'clip',
            format: x.format, kind: x.kind, ...(x.kind === 'montage' ? { parts: x.parts.length } : {}),
          };
          this.index.update((d) => { d.items = capIndex([item, ...d.items.filter((x) => x.id !== item.id)], this.fs); });
          saveIndexNow(this.index);
          this.onSaved(item);
          resolve(item);
        } catch (e) {
          console.warn('[clips] save failed:', e && e.message);
          reject(new Error(/ENOSPC/.test(String(e && e.message)) ? 'The disk is full.' : 'Couldn\'t save the clip.'));
        }
      });
    });
  }
}

/** H1: a finished recording / clip is written to the index right away (not after the debounce), so a quit can't drop it. */
function saveIndexNow(index) {
  if (typeof index.flushAsync === 'function') {
    index.flushAsync().catch((e) => console.warn('[recorder] index save failed:', e && e.message));
  } else if (typeof index.flush === 'function') index.flush();
}

module.exports = { ClipExporter, capIndex, saveIndexNow, markRange, checkRange, clipPath, montagePath, marksFilePath, marksText, clock, fileClock, CLIP_FOLDER, CLIP_FOLDERS, BEFORE_MARK_MS, AFTER_MARK_MS, MIN_CLIP_MS, MAX_CLIP_MS };
