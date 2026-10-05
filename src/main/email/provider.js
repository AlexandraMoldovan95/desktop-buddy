'use strict';
// Email: SEND ONLY, over SMTP (nodemailer). Reading the inbox (IMAP) is NOT connected, on purpose:
// it would mean access to all your email, and the app only needs to send.
// Runs only in the main process. The password is decrypted right before connecting and never reaches
// the pages, the logs or the error messages.
// TLS required: "ssl" = direct TLS (465), "starttls" = required upgrade (587), never plain text.

const { isEmail } = require('../../shared/settings-schema');
const { oneLine } = require('./compose');

const MAX_BODY = 100000;
const TIMEOUTS = { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 };

/** The config from settings (without the password) + what is missing before it can be used. */
function configFrom(s) {
  const cfg = {
    address: s.emailAddress,
    username: s.emailUsername || s.emailAddress,
    smtp: { host: s.emailSmtpHost, port: s.emailSmtpPort, security: s.emailSmtpSecurity },
    reportTo: s.emailReportTo || s.emailAddress,
    hasPassword: !!s.emailPassEnc,
  };
  const missing = [];
  if (!cfg.address) missing.push('email address');
  if (!cfg.smtp.host) missing.push('sending server (SMTP)');
  if (!cfg.hasPassword) missing.push('password');
  return { cfg, missing, complete: missing.length === 0 };
}

/** Validates a message before sending. */
function validateMessage({ to, subject, text }) {
  const list = (Array.isArray(to) ? to : [to]).filter(Boolean);
  if (!list.length || list.length > 10 || !list.every(isEmail)) throw new Error('The recipient\'s address isn\'t valid.');
  if (typeof text !== 'string' || !text.trim()) throw new Error('The email is empty.');
  return { to: list, subject: oneLine(subject || '(no subject)'), text: text.slice(0, MAX_BODY) };
}

/** The options for nodemailer (pure, tested). TLS is required in both modes. */
function transportOptions(cfg, password) {
  const ssl = cfg.smtp.security !== 'starttls';
  return {
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: ssl,                 // 465: TLS from the start
    requireTLS: !ssl,            // 587: STARTTLS required; if the server doesn't offer it, we don't send
    ignoreTLS: false,
    auth: { user: cfg.username, pass: password },
    tls: { minVersion: 'TLSv1.2', servername: cfg.smtp.host },
    ...TIMEOUTS,
    disableFileAccess: true,     // an email can't attach files from the disk
    disableUrlAccess: true,      // … nor download from the internet
  };
}

// M2: TLS certificate problems (antivirus mail shield, company proxy, expired certificate)
const CERT_RE = /SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER_CERT(?:_LOCALLY)?|CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|ERR_TLS_CERT_ALTNAME_INVALID|CERT_UNTRUSTED|self[- ]signed certificate|certificate has expired|unable to verify the first certificate/i;
/** The certificate error code hidden in a nodemailer / TLS error, or null. */
function certReason(err) {
  if (!err) return null;
  const text = [err.code, err.message, err.cause && err.cause.code, err.cause && err.cause.message].filter(Boolean).join(' ');
  const m = text.match(CERT_RE);
  return m ? m[0] : null;
}

/** A nodemailer error → a clear message, without the password and without the server's raw reply. */
function friendlyError(err, cfg) {
  const code = err && (err.code || '');
  const rc = err && err.responseCode;
  const gmail = /gmail\.com$/i.test(cfg.smtp.host || '');
  if (code === 'EAUTH' || rc === 535 || rc === 534) {
    return gmail
      ? 'Gmail refused the sign-in. Use an app password (16 characters, from your Google account → Security → App passwords), not your account password.'
      : 'The server refused the username or password.';
  }
  if (certReason(err)) return 'The server\'s certificate isn\'t trusted. An antivirus (email scanning) or a company network may be intercepting the email. Turn off email scanning in the antivirus or try another network.';
  if (code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(String(err && err.message))) return `Can't find the server "${cfg.smtp.host}". Check the server name and your internet connection.`;
  if (/ECONNREFUSED/.test(String(err && err.message))) return `The server "${cfg.smtp.host}" refuses the connection on port ${cfg.smtp.port}. Check the port (465 with SSL / TLS or 587 with STARTTLS).`;
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET' && /timeout/i.test(String(err.message))) return 'The server isn\'t answering. Check your internet connection, the server and the port (465 with SSL / TLS or 587 with STARTTLS).';
  if (code === 'ETLS' || code === 'ESOCKET') return 'The secure connection (TLS) didn\'t work. Check the port and the security type (465 = SSL / TLS, 587 = STARTTLS).';
  if (code === 'EENVELOPE' || rc === 550 || rc === 553) return 'The server refused the sender\'s or the recipient\'s address.';
  if (rc === 454 || rc === 421 || rc === 452) return 'The server is limiting sending for now. Try again later.';
  return 'The email couldn\'t be sent. Check the settings and try again.';
}

/**
 * The SMTP provider.
 * @param {{ createTransport: Function, getPassword: () => string|null, log?: Function }} deps
 */
function createSmtpProvider({ createTransport, getPassword, log = () => {} }) {
  function transport(cfg) {
    const missing = [];
    if (!cfg.address) missing.push('email address');
    if (!cfg.smtp || !cfg.smtp.host) missing.push('sending server (SMTP)');
    if (!cfg.hasPassword) missing.push('password');
    if (missing.length) throw new Error(`Still missing: ${missing.join(', ')} (Settings → Email).`);
    const password = getPassword();
    if (!password) throw new Error('The email password can\'t be read on this computer. Save it again in Settings → Email.');
    return createTransport(transportOptions(cfg, password));
  }

  return {
    id: 'smtp',
    connected: true,
    /** Connect + sign in, without sending anything. */
    async testConnection(cfg) {
      let t;
      try {
        t = transport(cfg);
        await t.verify();
        log(`[email] SMTP test passed (${cfg.smtp.host}:${cfg.smtp.port})`);
        return { ok: true, message: `Connected to ${cfg.smtp.host}. You can send emails.` };
      } catch (err) {
        log(`[email] SMTP test failed: ${err.code || err.name}${err.responseCode ? ' ' + err.responseCode : ''}${certReason(err) ? ' ' + certReason(err) : ''}`);
        return { ok: false, message: err.code || err.responseCode || certReason(err) ? friendlyError(err, cfg) : err.message };
      } finally {
        if (t && t.close) t.close();
      }
    },
    async sendMail(cfg, message) {
      const msg = validateMessage(message);
      let t;
      try {
        t = transport(cfg);
        const info = await t.sendMail({ from: cfg.address, to: msg.to, subject: msg.subject, text: msg.text });
        const rejected = (info && info.rejected) || [];
        log(`[email] sent "${msg.subject.slice(0, 60)}" to ${msg.to.length} recipient(s)${rejected.length ? `, ${rejected.length} refused` : ''}`);
        if (rejected.length) return { sent: false, message: `The server refused: ${rejected.join(', ')}.` };
        return { sent: true, message: `Sent to ${msg.to.join(', ')}.` };
      } catch (err) {
        log(`[email] sending failed: ${err.code || err.name}${err.responseCode ? ' ' + err.responseCode : ''}${certReason(err) ? ' ' + certReason(err) : ''}`);
        throw new Error(err.code || err.responseCode || certReason(err) ? friendlyError(err, cfg) : err.message, { cause: err });
      } finally {
        if (t && t.close) t.close();
      }
    },
  };
}

const MAX_RECIPIENTS = 5;
const MAX_RECENT = 6;

/** "ana@x.ro, dan@y.ro" → ['ana@x.ro', 'dan@y.ro'] (no duplicates; 1–5 valid addresses, otherwise a clear error). */
function parseRecipients(text) {
  const parts = String(text || '').split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);
  const seen = new Set();
  const list = [];
  for (const p of parts) {
    if (!isEmail(p)) throw new Error(`"${p.slice(0, 60)}" doesn't look like an email address.`);
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); list.push(p); }
  }
  if (!list.length) throw new Error('Type the address you are sending to.');
  if (list.length > MAX_RECIPIENTS) throw new Error(`At most ${MAX_RECIPIENTS} addresses at a time.`);
  return list;
}

/** The last addresses used (newest first, without your own address, max 6). */
function updateRecent(recent, used, own) {
  const ownKey = String(own || '').toLowerCase();
  const out = [];
  for (const a of [...used, ...(Array.isArray(recent) ? recent : [])]) {
    const k = String(a).toLowerCase();
    if (!isEmail(a) || k === ownKey || out.some((x) => x.toLowerCase() === k)) continue;
    out.push(a);
  }
  return out.slice(0, MAX_RECENT);
}

module.exports = { parseRecipients, updateRecent, MAX_RECIPIENTS, configFrom, validateMessage, transportOptions, friendlyError, certReason, createSmtpProvider, TIMEOUTS };
