'use strict';
// Picture size from the file header (PNG IHDR / JPEG SOF), without decoding pixels,
// plus the size limits and the thumbnail maker used by the screenshot gallery.

const MAX_SIDE = 12000;
const MAX_PIXELS = 50e6;
const TOO_BIG_MSG = 'The image is too big (12000 px per side and 50 megapixels max).';

/** { width, height } from the first bytes of a PNG or JPEG, or null. */
function sizeFromBuffer(b) {
  if (!b || b.length < 24) return null;
  if (b.readUInt32BE(0) === 0x89504e47 && b.readUInt32BE(4) === 0x0d0a1a0a && b.toString('latin1', 12, 16) === 'IHDR') {
    const width = b.readUInt32BE(16);
    const height = b.readUInt32BE(20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) { i += 2; continue; }   // markers without length
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const height = b.readUInt16BE(i + 5);
        const width = b.readUInt16BE(i + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}

const isTooBig = (sz) => !!sz && (sz.width > MAX_SIDE || sz.height > MAX_SIDE || sz.width * sz.height > MAX_PIXELS);

/** Reads only the header (64 KB, up to 1 MB for a JPEG with large metadata). Small sync read: no decode. */
function sizeOfFileSync(fs, file) {
  const fd = fs.openSync(file, 'r');
  try {
    for (const len of [64 * 1024, 1024 * 1024]) {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, 0);
      const sz = sizeFromBuffer(buf.subarray(0, n));
      if (sz || n < len || buf[0] !== 0xff) return sz;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Async variant of sizeOfFileSync. */
async function sizeOfFile(fs, file) {
  const h = await fs.promises.open(file, 'r');
  try {
    for (const len of [64 * 1024, 1024 * 1024]) {
      const buf = Buffer.alloc(len);
      const { bytesRead: n } = await h.read(buf, 0, len, 0);
      const sz = sizeFromBuffer(buf.subarray(0, n));
      if (sz || n < len || buf[0] !== 0xff) return sz;
    }
    return null;
  } finally {
    await h.close();
  }
}

/**
 * JPEG thumbnail (no enlarging). Uses the OS thumbnailer (async, off the main thread) when the picture is
 * larger than the thumbnail; falls back to a decode on main only for pictures under the size limit.
 * @returns {Promise<Buffer|null>}
 */
async function makeThumbnail(nativeImage, fs, file, width) {
  const sz = await sizeOfFile(fs, file);
  if (sz && sz.width > width && nativeImage.createThumbnailFromPath) {
    try {
      const h = Math.max(1, Math.round((width * sz.height) / sz.width));
      const img = await nativeImage.createThumbnailFromPath(file, { width, height: h });
      if (img && !img.isEmpty()) return img.toJPEG(82);
    } catch (e) {
      // not supported on Linux, or the OS has no thumbnailer for this file: fall back below
      if (process.platform === 'win32') console.warn('[thumbnail] OS thumbnail failed:', e && e.message);
    }
  }
  if (!sz || isTooBig(sz)) return null;   // never decode an oversized picture on main
  // r2 perf L2: one decode at a time, with a turn of the event loop between them (a gallery of 40 doesn't block main)
  return decodeQueue.run(() => {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    const s = img.getSize();
    return (s.width > width ? img.resize({ width, quality: 'good' }) : img).toJPEG(82);
  });
}

/** Runs sync jobs one at a time, each after a setImmediate yield. */
function makeSerialQueue() {
  let tail = Promise.resolve();
  return {
    run(job) {
      const p = tail.then(() => new Promise((resolve) => setImmediate(resolve))).then(job);
      tail = p.catch(() => {});   // one failed decode doesn't stop the queue; the caller gets the error
      return p;
    },
  };
}
const decodeQueue = makeSerialQueue();

module.exports = { sizeFromBuffer, sizeOfFileSync, sizeOfFile, isTooBig, makeThumbnail, makeSerialQueue, MAX_SIDE, MAX_PIXELS, TOO_BIG_MSG };
