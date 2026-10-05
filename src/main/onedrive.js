'use strict';
// Is a folder synced by OneDrive? Windows "folder backup" can move Videos / Documents into OneDrive,
// and then recordings would be uploaded to the cloud. Pure (env and paths injected), so it is tested on any OS.

const path = require('path');

const ENV_KEYS = ['OneDrive', 'OneDriveConsumer', 'OneDriveCommercial'];

/**
 * @param {string} folder  absolute folder path
 * @param {Record<string,string|undefined>} env  process.env
 * @returns {boolean}
 */
function isInOneDrive(folder, env = process.env) {
  if (typeof folder !== 'string' || !folder) return false;
  const norm = (p) => path.win32.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
  const f = norm(folder);
  for (const k of ENV_KEYS) {
    const root = env && env[k];
    if (typeof root === 'string' && root.length > 2) {
      const r = norm(root);
      if (f === r || f.startsWith(r + '\\')) return true;
    }
  }
  // fallback when the env vars are missing: a path segment named "OneDrive" or "OneDrive - <Company>"
  return /(^|\\)onedrive( - [^\\]+)?(\\|$)/.test(f);
}

module.exports = { isInOneDrive };
