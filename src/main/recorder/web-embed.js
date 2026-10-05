'use strict';
// "Code for a website" (1.6.0): an MP4 doesn't repeat by itself (looping is the player's job), so for an HTML portfolio
// we give the <video> code set to autoplay + loop + muted, plus a copy of the clip with a web-friendly name.
// Pure functions (tested); copying the file and the clipboard are in ipc.js.
const path = require('path');

const WEB_FOLDER = 'for web';          // next to the clips: clips\for web\ (older copies stay in the old Romanian-named folder)
const SITE_DIR = 'videos';             // the site folder where clips go (only in the generated code)
const MAX_SLUG = 80;

/** A web-safe name: lowercase letters without accents, digits and hyphens ("Note Organizer — test · clip 0m02s" → "note-organizer-test-clip-0m02s"). */
function slugify(name) {
  const s = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')          // strips accents: é → e
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG)
    .replace(/-+$/g, '');
  return s || 'clip';
}

/** The web file name, from the clip's file: "….mp4" → "slug.mp4". */
const webFileName = (file) => `${slugify(path.basename(String(file || ''), path.extname(String(file || ''))))}.mp4`;

const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const even = (n) => { const v = Math.round(Number(n) || 0); return v > 0 && v <= 8000 ? v - (v % 2) : 0; };

/**
 * The HTML code to paste into the site. `muted` + `playsinline` are required for autoplay in browsers (and on phones);
 * width / height hold the space in the page until the video loads, and the style makes it shrink on small screens.
 * @param {{ fileName: string, width?: number, height?: number, label?: string }} o
 */
function embedSnippet({ fileName, width, height, label }) {
  const w = even(width);
  const h = even(height);
  const src = `${SITE_DIR}/${fileName}`;
  const alt = String(label || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  return [
    `<!-- Desktop Buddy clip: put "${fileName}" in the site's ${SITE_DIR}/ folder. autoplay needs muted + playsinline; loop repeats it forever. -->`,
    `<video src="${attr(src)}"${w && h ? ` width="${w}" height="${h}"` : ''} autoplay loop muted playsinline preload="auto"${alt ? ` aria-label="${attr(alt)}"` : ''} style="max-width:100%;height:auto"></video>`,
  ].join('\n');
}

module.exports = { WEB_FOLDER, SITE_DIR, slugify, webFileName, embedSnippet };
