'use strict';
// Email tests: settings, the encrypted password, email content, the SMTP provider (with a fake transport, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { sanitizePatch, withDefaults, publicView, DEFAULTS } = require('../src/shared/settings-schema');
const { makeSecrets } = require('../src/main/secrets');
const compose = require('../src/main/email/compose');
const provider = require('../src/main/email/provider');
const ST = require('../src/main/stats');

const HOUR = 3600000;
const MIN = 60000;

test('email settings: validation, and picking Gmail fills in the servers', () => {
  const p = sanitizePatch({
    emailAddress: ' me@example.com ', emailReportTo: 'not-an-address', emailSmtpHost: 'MAIL.Example.com',
    emailImapHost: 'wrong server', emailSmtpPort: 587, emailImapPort: 70000, emailSmtpSecurity: 'starttls',
    emailImapSecurity: 'nothing', emailUsername: 'has a space', emailSendSessionReport: 'yes',
  });
  assert.deepEqual(p, { emailAddress: 'me@example.com', emailSmtpHost: 'mail.example.com', emailSmtpPort: 587, emailSmtpSecurity: 'starttls' });
  const manual = { ...DEFAULTS, emailPreset: 'manual', emailSmtpHost: 'x.ro' };
  assert.deepEqual(sanitizePatch({ emailPreset: 'gmail' }, manual), {
    emailPreset: 'gmail', emailSmtpHost: 'smtp.gmail.com', emailSmtpPort: 465, emailSmtpSecurity: 'ssl',
    emailImapHost: 'imap.gmail.com', emailImapPort: 993, emailImapSecurity: 'ssl',
  });
  assert.deepEqual(sanitizePatch({ emailPreset: 'manual' }, DEFAULTS), { emailPreset: 'manual' }, 'manual keeps the servers');
  assert.deepEqual(sanitizePatch({ emailPassEnc: 'stolen' }), {}, 'the password can not be set through settings');
});

test('email password: encrypted, not in the view sent to pages', () => {
  const fakeSafe = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from('enc:' + [...s].reverse().join('')),
    decryptString: (b) => [...b.toString().slice(4)].reverse().join(''),
  };
  const sec = makeSecrets(fakeSafe);
  const enc = sec.encryptPassword('  abcd efgh ijkl mnop ');
  assert.equal(Buffer.from(enc, 'base64').toString().includes('abcd'), false, 'not in plain text');
  assert.equal(sec.decryptPassword(enc), 'abcd efgh ijkl mnop');
  assert.throws(() => sec.encryptPassword('   '), /Type the password/);
  assert.throws(() => makeSecrets({ isEncryptionAvailable: () => false }).encryptPassword('x'), /not saved/);
  const s = withDefaults({ emailPassEnc: enc, emailAddress: 'me@example.com' });
  assert.equal(s.emailPassEnc, enc, 'kept after a restart');
  const view = publicView(s);
  assert.deepEqual(view.emailPassword, { saved: true });
  assert.equal(JSON.stringify(view).includes(enc), false);
});

const report = {
  id: 'x', title: 'Homework\r\nBcc: someone@example.com', startedAt: new Date(2026, 8, 29, 9).getTime(), endedAt: new Date(2026, 8, 29, 11, 30).getTime(),
  activeMs: 2 * HOUR, pausedMs: 30 * MIN, pauses: 1,
  apps: [{ name: 'Visual Studio Code', ms: 90 * MIN, titles: [{ title: 'main.js', ms: 60 * MIN }] }, { name: 'Chrome', ms: 30 * MIN, titles: [] }],
};

test('report email: a one-line subject, the content from the report', () => {
  const m = compose.sessionReportEmail(report);
  assert.equal(/[\r\n]/.test(m.subject), false, 'no new lines in the subject (headers can not be injected)');
  assert.match(m.subject, /^Session ended: Homework Bcc: someone@example.com · 2 h 00 min$/);
  assert.match(m.text, /Work time: 2 h 00 min/);
  assert.match(m.text, /Breaks: 1 \(30 min\)/);
  assert.match(m.text, /• Visual Studio Code: 1 h 30 min\n {6}– main\.js: 1 h 00 min/);
});

test('a report rebuilt from a saved session (preview after a restart)', () => {
  const t0 = new Date(2026, 8, 29, 9).getTime();
  const r = compose.reportFromRecord({
    title: 'Saved', start: t0, end: t0 + 3 * HOUR, activeMs: 2 * HOUR,
    segments: [{ start: t0, end: t0 + HOUR }, { start: t0 + 2 * HOUR, end: t0 + 3 * HOUR }],
    apps: { Code: 2 * HOUR }, titles: {},
  });
  assert.deepEqual([r.pauses, r.pausedMs, r.apps[0].name], [1, HOUR, 'Code']);
});

test('30-day email: totals, weeks and apps', () => {
  const data = { '2026-09-29': { totalMs: 2 * HOUR, sessions: [{}], apps: [{ name: 'Code', ms: 2 * HOUR }] } };
  const m = compose.rangeReportEmail(ST.rangeSummary('2026-09-29', (d) => data[d] || null));
  assert.match(m.subject, /last 30 days · 2 h 00 min/);
  assert.match(m.text, /Days worked: 1 of 30/);
  assert.match(m.text, /This week: 2 h 00 min/);
  assert.match(m.text, /Code \(on 1 day\): 2 h 00 min/);
});

test('SMTP provider: TLS required, the password only when connecting, clear errors without the password', async () => {
  const opts = [];
  let sent = null;
  let verifyErr = null;
  let sendErr = null;
  const createTransport = (o) => { opts.push(o); return {
    verify: async () => { if (verifyErr) throw verifyErr; return true; },
    sendMail: async (m) => { if (sendErr) throw sendErr; sent = m; return { accepted: m.to, rejected: [] }; },
    close: () => {},
  }; };
  let pwReads = 0;
  const logs = [];
  const smtp = provider.createSmtpProvider({ createTransport, getPassword: () => { pwReads++; return 'abcd efgh ijkl mnop'; }, log: (m) => logs.push(m) });

  const { cfg, missing } = provider.configFrom(DEFAULTS);
  assert.deepEqual(missing, ['email address', 'password'], 'IMAP is no longer required: the app only sends');
  await assert.rejects(smtp.sendMail(cfg, { to: 'me@example.com', subject: 'x', text: 'y' }), /Still missing: email address, password/);
  assert.equal(pwReads, 0, 'without a complete config the password is not read');

  const full = provider.configFrom({ ...DEFAULTS, emailAddress: 'eu@gmail.com', emailPassEnc: 'x' });
  assert.equal(full.complete, true);
  assert.equal(full.cfg.reportTo, 'eu@gmail.com', 'reports go to your own address by default');
  await assert.rejects(smtp.sendMail(full.cfg, { to: 'not-an-address', subject: 'x', text: 'y' }), /recipient/);
  await assert.rejects(smtp.sendMail(full.cfg, { to: 'eu@gmail.com', subject: 'x', text: '  ' }), /empty/);

  const r = await smtp.sendMail(full.cfg, { to: 'eu@gmail.com', subject: 'Report\r\nBcc: x@y.ro', text: 'body' });
  assert.equal(r.sent, true);
  assert.deepEqual([sent.from, sent.to, sent.subject], ['eu@gmail.com', ['eu@gmail.com'], 'Report Bcc: x@y.ro']);
  const o = opts.at(-1);
  assert.deepEqual([o.host, o.port, o.secure, o.requireTLS, o.tls.minVersion], ['smtp.gmail.com', 465, true, false, 'TLSv1.2']);
  assert.equal(o.auth.user, 'eu@gmail.com');
  assert.equal(o.disableFileAccess && o.disableUrlAccess, true, 'no attachments from the disk or the internet');
  const tls587 = provider.transportOptions({ ...full.cfg, smtp: { host: 'smtp.x.ro', port: 587, security: 'starttls' } }, 'p');
  assert.deepEqual([tls587.secure, tls587.requireTLS], [false, true], 'STARTTLS is required, no plain text');

  verifyErr = Object.assign(new Error('535-5.7.8 Username and Password not accepted abcd efgh ijkl mnop'), { code: 'EAUTH', responseCode: 535 });
  const t = await smtp.testConnection(full.cfg);
  assert.equal(t.ok, false);
  assert.match(t.message, /app password/);
  sendErr = Object.assign(new Error('getaddrinfo ENOTFOUND smtp.gmail.com'), { code: 'EDNS' });
  await assert.rejects(smtp.sendMail(full.cfg, { to: 'eu@gmail.com', subject: 'x', text: 'y' }), /find the server/);
  assert.equal([...logs, t.message].join('\n').includes('abcd'), false, 'the password never shows in logs or messages');
  verifyErr = null;
  assert.equal((await smtp.testConnection(full.cfg)).ok, true);
});

test('a note email: the subject = the first line, on one line', () => {
  const m = compose.noteEmail('\n  Shopping list\r\nmilk\n');
  assert.equal(m.subject, 'Note: Shopping list');
  assert.match(m.text, /^\n {2}Shopping list\nmilk\n\n— Sent from Desktop Buddy\.$/);
  assert.equal(compose.noteEmail('').subject, 'Note: Note');
});

test('email: send only; compose.js never touches the network, provider.js uses only nodemailer', () => {
  const dir = path.join(__dirname, '../src/main/email');
  const net = /require\(['"](node:)?(net|tls|http|https|dns|dgram|imapflow)['"]\)|fetch\(/;
  assert.equal(net.test(fs.readFileSync(path.join(dir, 'compose.js'), 'utf8')), false);
  assert.equal(net.test(fs.readFileSync(path.join(dir, 'provider.js'), 'utf8')), false);
  assert.equal(/require\(['"]nodemailer['"]\)/.test(fs.readFileSync(path.join(dir, 'provider.js'), 'utf8')), false, 'nodemailer is passed in from main.js (a fake one in tests)');
});

test('recipients: one or more addresses, no duplicates; the recent ones without your own address', () => {
  assert.deepEqual(provider.parseRecipients(' ana@x.ro,  Dan@y.ro; ana@X.ro '), ['ana@x.ro', 'Dan@y.ro']);
  assert.throws(() => provider.parseRecipients(''), /Type the address/);
  assert.throws(() => provider.parseRecipients('ana@x.ro, not-an-address'), /look like an email address/);
  assert.throws(() => provider.parseRecipients('a@x.ro b@x.ro c@x.ro d@x.ro e@x.ro f@x.ro'), /At most 5/);
  assert.throws(() => provider.parseRecipients('a@x.ro\r\nBcc: b@x.ro'), /look like an email address/, 'headers can not be smuggled in');
  assert.deepEqual(provider.updateRecent(['b@x.ro', 'eu@gmail.com', 'c@x.ro'], ['A@x.ro', 'B@x.ro'], 'EU@gmail.com'), ['A@x.ro', 'B@x.ro', 'c@x.ro']);
  assert.equal(provider.updateRecent([], ['1@x.ro', '2@x.ro', '3@x.ro', '4@x.ro', '5@x.ro', '6@x.ro', '7@x.ro'], '').length, 6);
  assert.deepEqual(sanitizePatch({ emailRecent: ['a@x.ro', 'A@x.ro', 'bad', 5] }), { emailRecent: ['a@x.ro'] });
  assert.deepEqual(withDefaults({}).emailRecent, []);
});
