'use strict';
// Clipboard history: the rules (pure, tested functions) + watching the clipboard.
// Electron has no "clipboard changed" event, so we check once per second.
//
// NOTE: since Electron 44 the clipboard API is ASYNC (aligned with the W3C Clipboard API):
// readText(), writeText() and has() return a Promise, and availableFormats() / readBuffer()
// were removed. The code below uses `await` everywhere, so it also works with the old API.
// https://www.electronjs.org/docs/latest/breaking-changes

const crypto = require('crypto');

const MAX_TEXT_LENGTH = 20000;
const POLL_MS = 1000;
// Electron has no cheap "clipboard changed" counter, and readText() of a huge text (a 5 MB log) costs
// 40-170 ms on main. After a text over the limit was seen, the clipboard is read only every 5 s (perf).
const BIG_BACKOFF_MS = 5000;
// Password managers mark what they copy with the Windows format
// "ExcludeClipboardContentFromMonitorProcessing" = "don't save in history".
// The new API exposes the system's native formats as a special MIME type.
const EXCLUDE_FORMAT = 'ExcludeClipboardContentFromMonitorProcessing';
const EXCLUDE_MIME = `electron application/osclipboard;format="${EXCLUDE_FORMAT}"`;
// Older password managers use this one ("don't show in clipboard viewers")
const VIEWER_IGNORE_MIME = 'electron application/osclipboard;format="Clipboard Viewer Ignore"';

// Texts that look like API keys, tokens or app passwords are not saved in the history
// (the "Don't save API keys and tokens" setting, on by default). They are searched anywhere in the text, so a
// piece of code that contains a key is skipped too. The patterns are strict, so they don't catch ordinary text.
const B = '(?<![A-Za-z0-9])'; // start of a token ('_' allowed before, e.g. KEY_sk-ant-…)
const SECRET_PATTERNS = [
  ['Anthropic key', new RegExp(B + 'sk-ant-[A-Za-z0-9_-]{20,}')],
  ['OpenAI key', new RegExp(B + 'sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}')],
  ['GitHub token', new RegExp(B + '(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})')],
  ['Google key', new RegExp(B + 'AIza[0-9A-Za-z_-]{35}(?![0-9A-Za-z_-])')],
  ['Google OAuth key', new RegExp(B + '(?:GOCSPX-[A-Za-z0-9_-]{20,}|ya29\\.[0-9A-Za-z_-]{20,}|1//0[0-9A-Za-z_-]{30,})')],
  ['AWS key', new RegExp(B + '(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])')],
  ['AWS key', /(?:aws_secret_access_key|secret_?access_?key)["']?\s*[:=]\s*["']?[A-Za-z0-9/+]{40}(?![A-Za-z0-9/+])/i],
  ['Supabase key', new RegExp(B + 'sb_secret_[A-Za-z0-9_-]{20,}')],
  ['Stripe key', new RegExp(B + '(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}')],
  ['Slack token', new RegExp(B + 'xox[abprs]-[A-Za-z0-9-]{10,}')],
  ['Hugging Face token', new RegExp(B + 'hf_[A-Za-z0-9]{30,}')],
  ['npm token', new RegExp(B + 'npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])')],
  ['SendGrid key', new RegExp(B + 'SG\\.[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}')],
  ['Azure key', /AccountKey=[A-Za-z0-9+/]{20,}={0,2}|SharedAccessKey=[A-Za-z0-9+/]{20,}={0,2}|[?&]sig=[A-Za-z0-9%+/]{30,}/],
  ['Azure key', new RegExp(B + '[A-Za-z0-9_~.-]{3}\\dQ~[A-Za-z0-9_~.-]{31,34}(?![A-Za-z0-9_~.-])')],
  ['Discord token', new RegExp(B + '[MNO][A-Za-z0-9_-]{23,25}\\.[A-Za-z0-9_-]{6}\\.[A-Za-z0-9_-]{27,38}(?![A-Za-z0-9_-])')],
  ['Discord token', /discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{50,}/i],
  ['JWT token', new RegExp(B + 'eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}')],
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  ['address with a password', /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,30}:\/\/[^/\s:@]{1,256}:[^/\s@]{1,256}@[^/\s@]/i],
  // Google app password as Google shows it: 4 groups of 4 letters, whole text only (all lower or all upper case)
  ['Google app password', /^\s*(?:[a-z]{4} ){3}[a-z]{4}\s*$|^\s*(?:[A-Z]{4} ){3}[A-Z]{4}\s*$/],
  // … or after a label ("App password: …", or the Romanian "parola: …"), with or without spaces
  ['Google app password', /(?:app\s*password|password|parol[aă](?: de aplica[tț]ie)?)\s*[:=]\s*(?:(?:[a-z]{4} ?){3}[a-z]{4}|(?:[A-Z]{4} ?){3}[A-Z]{4})(?![A-Za-z])/i],
  // a password after a label: letters and digits, 8-64 chars (e.g. DB_PASSWORD=s3cretPass)
  ['password', /(?:pass(?:word|wd)?|pwd|parol[aă])["']?\s*[:=]\s*["']?(?=[^\s"'().,;{}<>]*[A-Za-z])(?=[^\s"'().,;{}<>]*\d)[^\s"'().,;{}<>]{8,64}/i],
];

// zero-width characters that would split a key so the patterns miss it
const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00AD]/g;

/** NFKC turns NBSP / full-width letters into plain ones; zero-width characters are removed. */
function normalizeForScan(text) {
  return text.normalize('NFKC').replace(ZERO_WIDTH, '');
}

/** 16 random lowercase letters (an app password copied without spaces). Real words have more vowels. */
function looksLikeBareAppPassword(t) {
  const m = /^\s*([a-z]{16}|[A-Z]{16})\s*$/.exec(t);
  if (!m) return false;
  const vowels = (m[1].toLowerCase().match(/[aeiou]/g) || []).length;
  return vowels <= 4;
}

/** The kind of secret found in the text (e.g. "Anthropic key") or null. */
function looksLikeSecret(text) {
  if (typeof text !== 'string') return null;
  const t = normalizeForScan(text);
  const hit = SECRET_PATTERNS.find(([, re]) => re.test(t));
  if (hit) return hit[0];
  if (looksLikeBareAppPassword(t)) return 'Google app password';
  // whole text = 40 chars of base64 with upper, lower and digit: an AWS secret access key (not a git hash)
  if (/^\s*[A-Za-z0-9/+]{40}\s*$/.test(t) && /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t)) return 'AWS key';
  return null;
}

/** Removes the entries that look like secrets from the history (pinned ones too). */
function removeSecrets(items) {
  const kept = items.filter((it) => !looksLikeSecret(it.text));
  return { items: kept, removed: items.length - kept.length };
}

/**
 * Adds a text to the history by the rules. Returns { items, changed }.
 * - skips empty / whitespace-only text and texts that are too long;
 * - skips API keys / tokens (if `skipSecrets`);
 * - no duplicates: if the text exists, it moves to the top;
 * - `max` limit; pinned entries are never removed.
 */
function addEntry(items, text, { max = 50, now = Date.now(), maxLength = MAX_TEXT_LENGTH, skipSecrets = true } = {}) {
  if (typeof text !== 'string' || !text.trim() || text.length > maxLength) return { items, changed: false };
  if (skipSecrets && looksLikeSecret(text)) return { items, changed: false, skipped: 'secret' };
  const existing = items.find((it) => it.text === text);
  let next;
  if (existing) {
    if (items[0] === existing) return { items, changed: false };
    next = [{ ...existing, createdAt: now }, ...items.filter((it) => it !== existing)];
  } else {
    next = [{ id: crypto.randomUUID(), text, createdAt: now, pinned: false }, ...items];
  }
  return { items: enforceMax(next, max), changed: true };
}

/** Trims the oldest unpinned entries until it fits in `max`. */
function enforceMax(items, max) {
  if (items.length <= max) return items;
  const out = [...items];
  for (let i = out.length - 1; i >= 0 && out.length > max; i--) {
    if (!out[i].pinned) out.splice(i, 1);
  }
  return out;
}

/** Text marked by a password manager is not saved. Any error = "not marked". */
async function isSensitive(clipboard) {
  try {
    if (typeof clipboard.has !== 'function') return false;
    if ((await clipboard.has(EXCLUDE_MIME)) === true) return true;
    if ((await clipboard.has(VIEWER_IGNORE_MIME)) === true) return true;
  } catch {
    // the type is not supported on this system: we can't know, so we don't block
  }
  return false;
}

class ClipboardWatcher {
  /**
   * @param {object} clipboard  Electron's clipboard module (or a mock in tests)
   * @param {(text:string) => void} onText  called for each new text
   */
  constructor(clipboard, onText, { now = () => Date.now() } = {}) {
    this.clipboard = clipboard;
    this.onText = onText;
    this.now = now;
    this.skipUntil = 0;   // backoff after a text too big for the history
    this.timer = null;
    this.paused = false;
    this.busy = false;
    this.lastSeen = null;
    // what is already in the clipboard at startup does not go into the history
    this.ready = this.read().then((t) => { if (this.lastSeen === null) this.lastSeen = t; });
  }

  /** The clipboard text, always a string ('' on error). */
  async read() {
    try {
      const t = await this.clipboard.readText();
      return typeof t === 'string' ? t : '';
    } catch {
      return '';
    }
  }

  start() {
    if (!this.timer) this.timer = setInterval(() => { this.tick(); }, POLL_MS);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  async setPaused(paused) {
    this.paused = !!paused;
    // on restart, we don't add what was copied during the pause
    if (!this.paused) this.lastSeen = await this.read();
  }

  /** The current clipboard text, or null if a password manager marked it "do not save". */
  async readUnlessExcluded() {
    if (await isSensitive(this.clipboard)) return null;
    return this.read();
  }

  /** Copies a text from the history without adding it again as a new entry. */
  async write(text) {
    this.lastSeen = text;
    await this.clipboard.writeText(text);
  }

  async tick() {
    if (this.busy) return; // a slow check doesn't overlap the next one
    if (this.now() < this.skipUntil) return;
    this.busy = true;
    try {
      await this.ready;
      const text = await this.read();
      this.skipUntil = text.length > MAX_TEXT_LENGTH ? this.now() + BIG_BACKOFF_MS : 0;
      if (text === this.lastSeen) return;
      this.lastSeen = text;
      if (this.paused || (await isSensitive(this.clipboard))) return;
      this.onText(text);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { addEntry, enforceMax, isSensitive, looksLikeSecret, removeSecrets, SECRET_PATTERNS, ClipboardWatcher, MAX_TEXT_LENGTH, BIG_BACKOFF_MS, EXCLUDE_FORMAT, EXCLUDE_MIME, VIEWER_IGNORE_MIME };
