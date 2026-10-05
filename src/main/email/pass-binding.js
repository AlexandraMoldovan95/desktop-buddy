'use strict';
// Binds the saved email password to the server it was saved for (host, port, security, username).
// If any of these change, the password is cleared so it is never sent to a different server.

const crypto = require('crypto');

/** Fingerprint of where the password may be sent. */
function bindingOf(s) {
  const username = String(s.emailUsername || s.emailAddress || '').trim().toLowerCase();
  const host = String(s.emailSmtpHost || '').trim().toLowerCase();
  const key = `${host}|${Number(s.emailSmtpPort) || 0}|${s.emailSmtpSecurity || ''}|${username}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

/** True only if a password is saved and it was saved for the current server + username. */
function isBound(s) {
  return !!s.emailPassEnc && typeof s.emailPassFor === 'string' && s.emailPassFor === bindingOf(s);
}

/**
 * Fields to write after a settings change: clears the password when its binding no longer matches.
 * Returns null when nothing must change.
 */
function enforce(s) {
  if (!s.emailPassEnc || isBound(s)) return null;
  // saved before any address / username was typed (same server): filling them in is not a different account
  if (s.emailPassFor === bindingOf({ ...s, emailUsername: '', emailAddress: '' })) return { emailPassFor: bindingOf(s) };
  return { emailPassEnc: null, emailPassFor: null, emailPassReenter: true };
}

/** Upgrade from versions without a binding: trust the server saved together with the password. */
function migrate(s) {
  if (s.emailPassEnc && typeof s.emailPassFor !== 'string') return { emailPassFor: bindingOf(s) };
  return null;
}

module.exports = { bindingOf, isBound, enforce, migrate };
