'use strict';
// H1: the saved email password is bound to (host, port, security, username) and never sent to another server.
const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizePatch, withDefaults, publicView, DEFAULTS } = require('../src/shared/settings-schema');
const binding = require('../src/main/email/pass-binding');
const provider = require('../src/main/email/provider');

// Same steps as main.js updateSettings + ipc.js email:set-password, on a plain object.
function makeState() {
  const d = withDefaults({ emailPreset: 'gmail', emailAddress: 'me@gmail.com' });
  const setPassword = () => { d.emailPassEnc = 'ENC'; d.emailPassFor = binding.bindingOf(d); d.emailPassReenter = false; };
  const set = (patch) => {
    Object.assign(d, sanitizePatch(patch, d));
    const unbound = binding.enforce(d);
    if (unbound) Object.assign(d, unbound);
  };
  return { d, setPassword, set };
}

function smtpFor(d) {
  const calls = [];
  const smtp = provider.createSmtpProvider({
    createTransport: (opts) => { calls.push(opts); return { verify: async () => true, sendMail: async () => ({}) }; },
    getPassword: () => (binding.isBound(d) ? 'abcd efgh ijkl mnop' : null),
  });
  return { smtp, calls };
}

test('password stays usable while server and username are unchanged', async () => {
  const { d, setPassword, set } = makeState();
  setPassword();
  set({ emailSendSessionReport: true, emailReportTo: 'boss@x.ro' });
  assert.equal(binding.isBound(d), true);
  const { smtp, calls } = smtpFor(d);
  assert.equal((await smtp.testConnection(provider.configFrom(d).cfg)).ok, true);
  assert.equal(calls[0].host, 'smtp.gmail.com');
  assert.equal(calls[0].auth.pass, 'abcd efgh ijkl mnop');
});

for (const [what, patch] of [
  ['host', { emailSmtpHost: 'smtp.gmial.com' }],
  ['port', { emailSmtpPort: 2465 }],
  ['security', { emailSmtpSecurity: 'starttls' }],
  ['username', { emailUsername: 'other@gmail.com' }],
  ['address (username empty = address)', { emailAddress: 'other@gmail.com' }],
]) {
  test(`changing the ${what} clears the saved password and nothing is sent`, async () => {
    const { d, setPassword, set } = makeState();
    setPassword();
    set(patch);
    assert.equal(d.emailPassEnc, null);
    assert.equal(d.emailPassFor, null);
    const view = publicView(d);
    assert.deepEqual(view.emailPassword, { saved: false, reenter: true }, 'UI is told to ask for the password again');
    const { smtp, calls } = smtpFor(d);
    const r = await smtp.testConnection(provider.configFrom(d).cfg);
    assert.equal(r.ok, false);
    assert.equal(calls.length, 0, 'no connection is made');
    // entering the password again works and clears the notice
    setPassword();
    assert.deepEqual(publicView(d).emailPassword, { saved: true });
  });
}

test('getPassword refuses a password whose binding does not match (defence in depth)', async () => {
  const d = withDefaults({ emailPreset: 'gmail', emailAddress: 'me@gmail.com', emailPassEnc: 'ENC' });
  d.emailPassFor = binding.bindingOf(d);
  d.emailSmtpHost = 'evil.example.com'; // changed without going through enforce
  const { smtp, calls } = smtpFor(d);
  const r = await smtp.testConnection(provider.configFrom(d).cfg);
  assert.equal(r.ok, false);
  assert.equal(calls.length, 0);
});

test('binding ignores host case and is stable; settings.json keeps it; pages never see it', () => {
  const a = { ...DEFAULTS, emailAddress: 'Me@Gmail.com', emailSmtpHost: 'SMTP.gmail.com' };
  const b = { ...DEFAULTS, emailAddress: 'me@gmail.com', emailSmtpHost: 'smtp.gmail.com' };
  assert.equal(binding.bindingOf(a), binding.bindingOf(b));
  const saved = withDefaults({ emailPassEnc: 'ENC', emailPassFor: 'f'.repeat(64), emailPassReenter: true });
  assert.equal(saved.emailPassFor, 'f'.repeat(64));
  const view = publicView(saved);
  assert.equal('emailPassFor' in view, false);
  assert.equal('emailPassReenter' in view, false);
  assert.deepEqual(sanitizePatch({ emailPassFor: 'x', emailPassReenter: false }), {}, 'pages cannot set the binding');
});

test('upgrade from 1.14.0: a password saved without a binding is bound to the current server', () => {
  const d = withDefaults({ emailPreset: 'gmail', emailAddress: 'me@gmail.com', emailPassEnc: 'ENC' });
  assert.equal(binding.isBound(d), false);
  Object.assign(d, binding.migrate(d));
  assert.equal(binding.isBound(d), true);
  assert.equal(binding.migrate(d), null);
  assert.equal(binding.migrate(withDefaults({})), null, 'nothing to migrate without a password');
});
