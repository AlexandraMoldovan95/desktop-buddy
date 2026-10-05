'use strict';
// Email server settings. They rarely change, but they do: check them before connecting for real.
// Gmail: the account password does NOT work over SMTP / IMAP; you need an "app password"
// (requires 2-step verification) or OAuth.

const VERIFIED_AT = '2026-09-29';

const PRESETS = [
  {
    id: 'gmail',
    label: 'Gmail',
    smtp: { host: 'smtp.gmail.com', port: 465, security: 'ssl' },
    imap: { host: 'imap.gmail.com', port: 993, security: 'ssl' },
    passwordHint: 'Google app password (16 characters). Your normal password won\'t work.',
  },
  {
    id: 'manual',
    label: 'Other server (SMTP + IMAP)',
    smtp: null,
    imap: null,
    passwordHint: 'Your account password or an app password, depending on the provider.',
  },
];

const SECURITY = [
  ['ssl', 'SSL / TLS'],
  ['starttls', 'STARTTLS'],
];

const getPreset = (id) => PRESETS.find((p) => p.id === id) || null;

module.exports = { PRESETS, SECURITY, VERIFIED_AT, getPreset };
