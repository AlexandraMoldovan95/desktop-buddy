'use strict';
// Screenshots (1.8.0), in the main process. They start only from buttons: right-click on the buddy, tray, Video tab.
//
//  Area:     hides the panel / buddy → captures the screen under the mouse (at real resolution) → the selection window
//            (the frozen, darkened image) → you drag an area → it is cropped from the capture → PNG.
//  Window:   the list of open windows, with thumbnails → you pick one → a hidden window grabs a frame with getDisplayMedia
//            (at the window's real size, even if other windows cover it) → PNG.
const path = require('path');
const crypto = require('crypto');
const LIST_MAX_AGE_MS = 2 * 60000;   // r2 perf M3: the cached list is rescanned at least this often
const C = require('./capture');
const A = require('../shared/annotations');
const { pickable } = require('./recorder/rules');
const IMG = require('./shot-image');

/** Short plain-English message for a failed shell.trashItem (no paths). */
function trashError(e) {
  const m = String((e && (e.code || e.message)) || '');
  if (/ENOENT/.test(m)) return 'This picture no longer exists.';
  if (/EBUSY|EPERM|in use|used by another/i.test(m)) return 'The picture is open in another program. Close it and try again.';
  return 'Couldn\'t move it to the Recycle Bin. Maybe the folder has no Recycle Bin (USB stick, network): delete the picture in Explorer.';
}
let tmpSeq = 0;
const tmpName = (file) => `${file}.${process.pid}.${++tmpSeq}.tmp`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const { hasFreeSpace } = require('./limits');
// Windows device names: "NUL.png" or "COM1.png" are not files
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

class ScreenshotService {
  /**
   * @param {{
   *   capturer: { getSources: Function }, screen: Electron.Screen, fs: typeof import('fs'),
   *   folder: () => string,                       // the recordings folder; screenshots go to <folder>/Screenshots
   *   ui: { hideOwn: () => (() => void), showOverlay: (display) => void, closeOverlay: () => void,
   *         showPicker: () => void, closePicker: () => void, grabFrame: (source) => Promise<string> },
   *   imageFromDataURL: (url: string) => Electron.NativeImage,
   *   onSaved: (file: string, kind: 'zone'|'window') => void,
   *   trashItem?: (file: string) => Promise<void>,   // shell.trashItem: moves to the Recycle Bin (1.10.0)
   *   onRemoved?: (name: string) => void,
   *   annotDir?: () => string,                        // where the editable annotations live (1.11.0), in the data folder
   *   imageSize?: (file: string) => { width: number, height: number },
   *   onExported?: (name: string) => void,
   *   thumbnail?: (file: string, width: number) => Buffer|null,   // small JPEG for the gallery (1.12.0)
   *   thumbDir?: () => string,
   *   imageFromBuffer?: (buf: Buffer) => { isEmpty(): boolean, getSize(): {width:number,height:number} },
   *   onError: (message: string) => void,
   * }} d
   */
  constructor(d) {
    this.d = d;
    this.busy = false;
    this.frame = null;         // { image, display } while the area selection is open
    this.sources = new Map();  // id → desktopCapturer source, from the last list of windows
    this.pending = null;       // the source for getDisplayMedia (the "shot" session handler passes it on)
  }

  dir() { return path.join(this.d.folder(), C.SHOT_FOLDER); }

  async save(png, title, kind) {
    const dir = this.dir();
    await this.d.fs.promises.mkdir(dir, { recursive: true });
    const file = C.uniqueFile(dir, C.shotFileName(title), (f) => this.d.fs.existsSync(f));
    await this.d.fs.promises.writeFile(file, png);
    this.invalidateList();
    this.d.onSaved(file, kind);
    return file;
  }

  // ------------------------------------------------ area
  async startZone() {
    if (this.busy) return false;
    this.busy = true;
    const restore = this.d.ui.hideOwn();
    try {
      await wait(150);   // the panel / buddy must leave the screen before the capture
      const display = this.d.screen.getDisplayNearestPoint(this.d.screen.getCursorScreenPoint());
      const size = { width: Math.round(display.size.width * display.scaleFactor), height: Math.round(display.size.height * display.scaleFactor) };
      const list = await this.d.capturer.getSources({ types: ['screen'], thumbnailSize: size });
      const src = list.find((s) => String(s.display_id) === String(display.id)) || list[0];
      if (!src || src.thumbnail.isEmpty()) throw new Error('Couldn\'t capture the screen.');
      this.frame = { image: src.thumbnail, display };
    } catch (e) {
      this.busy = false;
      restore();
      this.d.onError(e.message || 'The capture didn\'t work.');
      return false;
    }
    restore();
    this.d.ui.showOverlay(this.frame.display);
    return true;
  }

  /** What the selection window shows: the frozen image (JPEG, just to look at; the crop is made from the original). */
  overlayInfo() {
    if (!this.frame) return null;
    const { image, display } = this.frame;
    return { image: `data:image/jpeg;base64,${image.toJPEG(88).toString('base64')}`, width: display.bounds.width, height: display.bounds.height };
  }

  /** @param {{x1,y1,x2,y2}|null} corners  null = cancelled (Esc / right-click) */
  async finishZone(corners) {
    const frame = this.frame;
    this.frame = null;
    this.d.ui.closeOverlay();
    this.busy = false;
    if (!frame || !corners) return null;
    const { width: W, height: H } = frame.display.bounds;
    const rect = C.normalizeRect(corners, W, H);
    if (!rect) return null;
    const img = frame.image.getSize();
    const crop = frame.image.crop(C.toImageRect(rect, W, H, img.width, img.height));
    return this.save(crop.toPNG(), 'Screenshot', 'zone');
  }

  /** From the area selection: "Window…" → the list of windows. */
  async zoneToWindow() {
    this.frame = null;
    this.d.ui.closeOverlay();
    this.busy = false;
    await wait(100);
    this.openPicker();
  }

  // ------------------------------------------------ window
  openPicker() { this.d.ui.showPicker(); }

  /** Open windows (not the app's own), with small thumbnails for the list. */
  async listWindows() {
    const list = await this.d.capturer.getSources({ types: ['window'], thumbnailSize: { width: 320, height: 200 }, fetchWindowIcons: false });
    const ok = new Set(pickable(list).map((s) => s.id));
    this.sources = new Map(list.filter((s) => ok.has(s.id)).map((s) => [s.id, s]));
    return [...this.sources.values()].map((s) => ({ id: s.id, name: s.name, thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '' }));
  }

  async captureWindow(id) {
    this.d.ui.closePicker();
    const src = this.sources.get(id);
    if (!src || this.busy) return null;
    this.busy = true;
    try {
      await wait(150);
      this.pending = src;
      const url = await this.d.ui.grabFrame(src);
      const img = this.d.imageFromDataURL(url);
      if (!img || img.isEmpty()) throw new Error('Couldn\'t capture the window (is it minimized?).');
      return await this.save(img.toPNG(), src.name, 'window');
    } catch (e) {
      this.d.onError(e.message || 'The capture didn\'t work.');
      return null;
    } finally {
      this.pending = null;
      this.busy = false;
    }
  }

  // ------------------------------------------------ the gallery and the list in the Video tab (1.12.0: grouped, with thumbnails)
  /**
   * All screenshots, one entry per screenshot (the annotated copy attached to its original).
   * r2 perf M3: cached; reused while the folder and annotations folder mtimes are unchanged (2 stats instead of N),
   * dropped by invalidateList() (every change the app makes) and after LIST_MAX_AGE_MS.
   */
  async all() {
    const dir = this.dir();
    const stamp = await this.listStamp(dir);
    const c = this.listCache;
    const copyOf = (x) => ({ ...x, copy: x.copy ? { ...x.copy } : null });
    if (c && stamp && c.stamp === stamp && Date.now() - c.at < LIST_MAX_AGE_MS) return c.list.map(copyOf);
    const gen = this.listGen = (this.listGen || 0) + 1;
    const list = await this.scanAll(dir);
    // a change during the scan (invalidateList) makes this result stale: don't keep it
    if (stamp && gen === this.listGen) this.listCache = { stamp, at: Date.now(), list: list.map(copyOf) };
    return list;
  }

  /** Drops the cached list (a picture was saved, deleted, imported or drawn on). */
  invalidateList() {
    this.listCache = null;
    this.listGen = (this.listGen || 0) + 1;
  }

  /** "<dir>|<mtime>|<annot mtime>", or null when the folder can't be read (never cached then). */
  async listStamp(dir) {
    const fsp = this.d.fs.promises;
    try {
      const st = await fsp.stat(dir);
      let a = 0;
      if (this.d.annotDir) { try { a = (await fsp.stat(this.d.annotDir())).mtimeMs; } catch { a = 0; } }   // no annotations yet
      return `${dir}|${st.mtimeMs}|${a}`;
    } catch { return null; }
  }

  async scanAll(dir) {
    let names;
    try { names = await this.d.fs.promises.readdir(dir); } catch { return []; }
    const files = [];
    const safe = names.filter(C.isSafeShotName);
    for (let i = 0; i < safe.length; i += 16) {   // a few stats at a time: faster on HDD, still bounded
      await Promise.all(safe.slice(i, i + 16).map(async (name) => {
        try { const st = await this.d.fs.promises.stat(path.join(dir, name)); if (st.isFile()) files.push({ name, at: st.mtimeMs, bytes: st.size }); } catch { /* deleted in the meantime */ }
      }));
    }
    const outs = await this.annotOutputs(files.map((f) => f.name));
    return C.groupShots(files, (n) => outs.get(n) || null);
  }

  /**
   * name → annotated copy, for the shots that have an annotation document. One readdir of the annotations
   * folder replaces a sync read per picture; documents are read once (async) and cached (only saveAnnot writes them).
   */
  async annotOutputs(names) {
    const out = new Map();
    if (!this.d.annotDir) return out;
    let have;
    try { have = new Set(await this.d.fs.promises.readdir(this.d.annotDir())); } catch { return out; }   // no annotations yet
    this.annotCache = this.annotCache || new Map();
    const dir = this.dir();
    for (const name of names) {
      const p = this.annotPathOfFile(path.join(dir, name));
      if (!have.has(path.basename(p))) continue;
      let v = this.annotCache.get(p);
      if (v === undefined) {
        try { v = this.outputFromRaw(name, JSON.parse(await this.d.fs.promises.readFile(p, 'utf8'))); } catch { v = null; }
        this.annotCache.set(p, v);
      }
      if (v) out.set(name, v);
    }
    return out;
  }

  outputFromRaw(name, raw) {
    const out = raw && raw.file === name && raw.doc && raw.doc.output;
    return typeof out === 'string' && C.isSafeShotName(out) && A.sourceOfAnnotated(out) === name ? out : null;
  }

  async recent(limit = 6) { return (await this.all()).slice(0, limit); }

  /** The name of a screenshot's annotated copy (read straight from the document, without decoding the image) or null. */
  annotOutputOf(name) {
    if (!this.d.annotDir) return null;
    try {
      const p = this.annotPath(name);
      if (this.annotCache && this.annotCache.has(p)) return this.annotCache.get(p);
      return this.outputFromRaw(name, JSON.parse(this.d.fs.readFileSync(p, 'utf8')));
    } catch { return null; }
  }

  /** A screenshot's thumbnail (JPEG, ~360 px wide), from memory or disk; remade only when the screenshot changes. */
  async thumb(name) {
    const file = this.fileOf(name);
    const st = await this.d.fs.promises.stat(file);
    const key = `${file}|${st.mtimeMs}|${st.size}`;
    this.thumbs = this.thumbs || new Map();
    if (this.thumbs.has(key)) {
      const b = this.thumbs.get(key);
      this.thumbs.delete(key);
      this.thumbs.set(key, b);   // most recently used at the end
      return b;
    }
    const hash = crypto.createHash('sha1').update(key.toLowerCase()).digest('hex').slice(0, 32);
    const disk = this.d.thumbDir ? path.join(this.d.thumbDir(), `${hash}.jpg`) : null;
    let buf = null;
    if (disk) { try { buf = await this.d.fs.promises.readFile(disk); } catch { buf = null; } }   // not cached yet
    if (!buf) {
      // the same thumbnail asked twice at once (gallery + Video tab) is made once
      this.making = this.making || new Map();
      let job = this.making.get(key);
      if (!job) {
        job = Promise.resolve(this.d.thumbnail(file, 360)).finally(() => this.making.delete(key));
        this.making.set(key, job);
      }
      buf = await job;
      if (!buf || !buf.length) throw new Error('Couldn\'t make the thumbnail.');
      if (disk) {
        try {
          await this.d.fs.promises.mkdir(path.dirname(disk), { recursive: true });
          await this.d.fs.promises.writeFile(disk, buf);
        } catch (e) { console.warn('[screenshots] thumbnail cache not written:', e && e.code); }   // only a cache
      }
    }
    this.thumbs.set(key, buf);
    while (this.thumbs.size > 300) this.thumbs.delete(this.thumbs.keys().next().value);
    return buf;
  }

  /** The thumbnail already in memory (for the drag icon), or null. Never decodes. */
  cachedThumb(name) {
    if (!this.thumbs) return null;
    const file = path.join(this.dir(), name);
    for (const [k, b] of this.thumbs) if (k.startsWith(`${file}|`)) return b;
    return null;
  }

  /** From the gallery: moves the chosen screenshots to the Recycle Bin, each with its annotated copy. @returns how many files moved */
  /**
   * @param {string[]} names  the originals (the gallery entries)
   * @param {'all'|'copies'} mode  1.14.0: "copies" = for screenshots with an annotated copy only the copy goes (the original stays);
   *                               screenshots without a copy go anyway (they are their only version).
   */
  async trashMany(names, mode = 'all') {
    if (!Array.isArray(names) || names.length > 500) throw new Error('Invalid list.');
    if (!this.d.trashItem) throw new Error('Deleting is not available.');
    if (mode !== 'all' && mode !== 'copies') throw new Error('Invalid mode.');
    for (const name of names) if (!C.isSafeShotName(name)) throw new Error('Invalid file.');
    const moved = [];
    const failed = [];
    let lastErr = null;
    const out = async (name) => { await this.d.trashItem(path.join(this.dir(), name)); moved.push(name); };
    try {
      for (const name of new Set(names)) {
        try {
          this.fileOf(name);
          const copy = this.annotOutputOf(name);
          const hasCopy = !!copy && this.d.fs.existsSync(path.join(this.dir(), copy));
          if (hasCopy) await out(copy);   // if the copy can't go, the original stays too (no orphan copy)
          if (!hasCopy || mode === 'all') await out(name);
        } catch (e) {
          console.warn('[screenshots] trash failed:', e && (e.code || e.message));
          lastErr = e;
          failed.push(name);
        }
      }
    } finally {
      // one notification for the whole batch (not one full rescan per file)
      if (moved.length) {
        this.invalidateList();
        if (this.d.onRemovedMany) this.d.onRemovedMany(moved);
        else if (this.d.onRemoved) moved.forEach((n) => this.d.onRemoved(n));
      }
    }
    return { moved: moved.length, failed, error: failed.length ? trashError(lastErr) : null };
  }

  /** The pair of an annotated screenshot (1.14.0): { original, copy } if the screenshot is the saved copy or its original; otherwise null. */
  pairOf(name) {
    this.fileOf(name);
    const src = this.resolveSource(name);
    if (src !== name) return { original: src, copy: name };
    const copy = this.annotOutputOf(name);
    return copy && this.d.fs.existsSync(path.join(this.dir(), copy)) ? { original: name, copy } : null;
  }

  /** From the large window: deletes the screenshot shown and, if asked, its pair too (the original / the copy). */
  async trashWithPair(name, both) {
    const pair = both ? this.pairOf(name) : null;
    await this.trash(name);
    const other = pair && (pair.original === name ? pair.copy : pair.original);
    if (other && this.d.fs.existsSync(path.join(this.dir(), other))) await this.trash(other);
    return true;
  }

  /**
   * An image added from the PC (dragged into the gallery or picked with the button). The page already converted it to PNG;
   * here we check again that it is a real image and put it in the Screenshots folder, under its own name. @returns the name
   */
  async importImage(originalName, png) {
    const buf = Buffer.isBuffer(png) ? png : Buffer.from(png || []);
    if (buf.length < 67 || buf.length > 80 * 1024 * 1024 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
      throw new Error('This is not a valid image.');
    }
    // size from the PNG header: no full decode on main
    const sz = IMG.sizeFromBuffer(buf);
    if (!sz) throw new Error('This is not a valid image.');
    if (IMG.isTooBig(sz)) throw new Error(IMG.TOO_BIG_MSG);
    const dir = this.dir();
    await this.d.fs.promises.mkdir(dir, { recursive: true });
    if (!(await hasFreeSpace(this.d.fs.promises, dir))) throw new Error('Not enough disk space (at least 1 GB free needed).');
    const file = C.uniqueFile(dir, C.importName(originalName), (f) => this.d.fs.existsSync(f));
    await this.d.fs.promises.writeFile(file, buf);
    this.invalidateList();
    if (this.d.onExported) this.d.onExported(path.basename(file));
    return path.basename(file);
  }

  /** Which file leaves when a screenshot is dragged from the gallery into another app: the annotated copy, if any. */
  dragFile(name) {
    const file = this.fileOf(name);
    const copy = this.annotOutputOf(name);
    const cfile = copy && path.join(this.dir(), copy);
    const out = cfile && this.plainFile(cfile) ? cfile : file;
    if (!this.insideFolder(out)) throw new Error('Invalid file.');
    return out;
  }

  /** What the card after a capture and the view window show (1.10.0). */
  info(name) {
    const st = this.d.fs.statSync(this.fileOf(name));
    return { name, at: st.mtimeMs, bytes: st.size };
  }

  /** Moves the screenshot to the Recycle Bin (it can be restored from there), it doesn't delete it for good. */
  async trash(name) {
    const file = this.fileOf(name);
    if (!this.d.trashItem) throw new Error('Deleting is not available.');
    try {
      await this.d.trashItem(file);
    } catch (e) {
      console.warn('[screenshots] trash failed:', e && (e.code || e.message));
      throw new Error(trashError(e), { cause: e });
    }
    this.invalidateList();
    if (this.d.onRemoved) this.d.onRemoved(name);
    return true;
  }

  // ------------------------------------------------ annotations (1.11.0)
  // The original never changes. The editable document lives in <data>/annotations/<hash of the path>.json,
  // and "Save copy" writes "<name> - annotated.png" next to the original (always the same copy, overwritten).

  annotPath(name) { return this.annotPathOfFile(this.fileOf(name)); }

  annotPathOfFile(file) {
    const key = crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 32);
    return path.join(this.d.annotDir(), `${key}.json`);
  }

  /** True when the picture is over the size limit (header only). */
  isTooBig(name) {
    try { return IMG.isTooBig(this.sizeOf(name)); } catch { return false; }   // unreadable: the page shows its own error
  }

  sizeOf(name) {
    const file = this.fileOf(name);
    this.sizes = this.sizes || new Map();
    const st = this.d.fs.statSync(file);
    const hit = this.sizes.get(file);
    if (hit && hit.mtime === st.mtimeMs) return hit.size;
    const sz = this.d.imageSize(file);
    if (!sz || !(sz.width > 0) || !(sz.height > 0)) throw new Error('Couldn\'t read the picture.');
    this.sizes.set(file, { mtime: st.mtimeMs, size: { width: sz.width, height: sz.height } });
    return { width: sz.width, height: sz.height };
  }

  readAnnot(name, strict = false) {
    let raw;
    try { raw = JSON.parse(this.d.fs.readFileSync(this.annotPath(name), 'utf8')); } catch { return null; }
    if (!raw || raw.file !== name) return null;
    if (strict && Number(raw.version) > 1) throw new Error('These annotations were made with a newer version of the app. Update the app to change them.');
    const { width, height } = this.sizeOf(name);
    return A.normalizeDoc(raw.doc, width, height, (n) => C.isSafeShotName(n) && A.sourceOfAnnotated(n) === name);
  }

  /** Which screenshot is annotated: a copy "X - annotated.png" (or old "X - adnotat.png") made by the app points to its original, if it still exists. */
  resolveSource(name) {
    this.fileOf(name);
    const src = A.sourceOfAnnotated(name);
    if (src && C.isSafeShotName(src) && this.d.fs.existsSync(path.join(this.dir(), src))) {
      const doc = this.readAnnot(src);
      if (doc && doc.output === name) return src;
    }
    return name;
  }

  loadAnnot(name) {
    const source = this.resolveSource(name);
    const { width, height } = this.sizeOf(source);
    if (IMG.isTooBig({ width, height })) throw new Error('The picture is too big to draw on.');
    return { source, image: { width, height }, doc: this.readAnnot(source, true) };
  }

  /** Writes to one annotation document run one after another (autosave and "Save copy" can overlap). */
  async saveAnnot(source, raw) {
    const file = this.annotPath(source);
    this.annotQueue = this.annotQueue || new Map();
    const prev = this.annotQueue.get(file) || Promise.resolve();
    // the previous writer already got its own error: here we only wait for it to finish
    const run = prev.catch(() => {}).then(() => this.writeAnnot(source, raw));
    this.annotQueue.set(file, run);
    const done = () => { if (this.annotQueue.get(file) === run) this.annotQueue.delete(file); };
    run.then(done, done);
    return run;
  }

  async writeAnnot(source, raw) {
    const { width, height } = this.sizeOf(source);
    const doc = A.normalizeDoc(raw, width, height, (n) => C.isSafeShotName(n) && A.sourceOfAnnotated(n) === source);
    const json = JSON.stringify({ version: 1, file: source, doc });
    if (json.length > 4 * 1024 * 1024) throw new Error('Too many drawings on one picture.');
    const file = this.annotPath(source);
    await this.d.fs.promises.mkdir(path.dirname(file), { recursive: true });
    const tmp = tmpName(file);
    try {
      await this.d.fs.promises.writeFile(tmp, json);
      await this.d.fs.promises.rename(tmp, file);
    } catch (e) {
      await this.d.fs.promises.rm(tmp, { force: true }).catch((e2) => console.warn('[screenshots] tmp not removed:', e2 && e2.code));
      throw e;
    }
    this.annotCache = this.annotCache || new Map();
    this.annotCache.set(file, this.outputFromRaw(source, { file: source, doc }));
    return doc;
  }

  /** Writes the annotated copy (PNG made in the page) and remembers its name. @returns the copy's name */
  async exportAnnot(source, png, raw) {
    // two exports of the same picture (double Ctrl+S) run one after another and reuse the same copy name
    this.exportQueue = this.exportQueue || new Map();
    const prev = this.exportQueue.get(source) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.writeExport(source, png, raw));   // the previous caller got its own error
    this.exportQueue.set(source, run);
    const done = () => { if (this.exportQueue.get(source) === run) this.exportQueue.delete(source); };
    run.then(done, done);
    return run;
  }

  async writeExport(source, png, raw) {
    const buf = Buffer.isBuffer(png) ? png : Buffer.from(png instanceof ArrayBuffer ? new Uint8Array(png) : png || []);
    if (buf.length < 67 || buf.length > 200 * 1024 * 1024 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
      throw new Error('The annotated image is not a valid PNG.');
    }
    const prevOut = this.annotOutputOf(source);
    let doc = await this.saveAnnot(source, raw);
    let name = doc.output || prevOut || path.basename(C.uniqueFile(this.dir(), A.annotatedName(source), (f) => this.d.fs.existsSync(f)));
    // the saved copy was replaced by a link or device name: write a new file instead of writing through it
    if ((doc.output || prevOut) && (RESERVED_NAME.test(name) || (this.d.fs.existsSync(path.join(this.dir(), name)) && !this.plainFile(path.join(this.dir(), name))))) {
      name = path.basename(C.uniqueFile(this.dir(), A.annotatedName(source), (f) => this.d.fs.existsSync(f)));
    }
    // tmp + rename: a full disk never replaces the previous good copy with a truncated PNG
    const target = path.join(this.dir(), name);
    const tmp = tmpName(target);
    try {
      await this.d.fs.promises.writeFile(tmp, buf);
      await this.d.fs.promises.rename(tmp, target);
    } catch (e) {
      await this.d.fs.promises.rm(tmp, { force: true }).catch((e2) => console.warn('[screenshots] tmp not removed:', e2 && e2.code));
      throw e;
    }
    doc = await this.saveAnnot(source, { ...doc, output: name });
    this.invalidateList();
    if (this.d.onExported) this.d.onExported(name);
    return { name, doc };
  }

  /** The path of a screenshot asked for by a page, only by name and only from the Screenshots folder. */
  fileOf(name) {
    if (!C.isSafeShotName(name) || RESERVED_NAME.test(name)) throw new Error('Invalid file.');
    const file = path.join(this.dir(), name);
    // one lstat (instead of exists): the name has no separators, so a regular, non-linked file is inside the folder
    if (!this.plainFile(file)) throw new Error('This picture no longer exists.');
    return file;
  }

  /** A regular file, not a symlink / junction / hard link (they could point outside the folder). */
  plainFile(file) {
    let st;
    try { st = this.d.fs.lstatSync(file); } catch { return false; } // missing or unreadable = not served
    return st.isFile() && !st.isSymbolicLink() && st.nlink <= 1;
  }

  /** Extra check before a file leaves the app (drag-out): its real path must stay inside the folder. */
  insideFolder(file) {
    try {
      const real = this.d.fs.realpathSync.native(file);
      const dir = this.d.fs.realpathSync.native(this.dir());
      return real.toLowerCase().startsWith(dir.toLowerCase() + path.sep) && path.dirname(real).toLowerCase() === dir.toLowerCase();
    } catch { return false; } // cannot resolve = refuse
  }
}

module.exports = { ScreenshotService };
