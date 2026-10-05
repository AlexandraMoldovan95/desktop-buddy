'use strict';
// The email password is encrypted with safeStorage (on Windows: DPAPI, tied to the Windows account).
// The plain password is never written anywhere and never reaches the pages.

function makeSecrets(safeStorage) {
  function available() {
    try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
  }

  /** Main process only (the SMTP connection). */
  function decryptPassword(enc) {
    if (!enc) return null;
    try {
      return safeStorage.decryptString(Buffer.from(enc, 'base64'));
    } catch {
      return null; // e.g. a settings file copied from another computer
    }
  }

  /** The email password. Returns the encrypted text (base64). */
  function encryptPassword(password) {
    if (typeof password !== 'string') throw new Error('The password must be text.');
    const p = password.trim();
    if (!p) throw new Error('Type the password.');
    if (p.length > 256) throw new Error('The password is too long.');
    if (!available()) throw new Error('Encryption isn\'t available on this system, so the password is not saved.');
    return safeStorage.encryptString(p).toString('base64');
  }

  return { available, encryptPassword, decryptPassword };
}

module.exports = { makeSecrets };
