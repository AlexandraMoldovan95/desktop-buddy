'use strict';
// Starts the helper, reads the JSON lines and passes the samples on.
// If the helper crashes, it restarts it a few times, then reports the error.

const { spawn } = require('child_process');
const readline = require('readline');
const { log } = require('../log');

const MAX_RESTARTS = 3;
const RESTART_DELAY_MS = 3000;

class ActiveWindowTracker {
  /**
   * @param {{ getCommand: () => ({command:string,args:string[]}|null),
   *           onSample: (raw:object) => void,
   *           onStatus?: (status:{state:string, message?:string}) => void,
   *           spawnFn?: typeof spawn }} opts
   */
  constructor({ getCommand, onSample, onStatus, spawnFn = spawn }) {
    this.getCommand = getCommand;
    this.onSample = onSample;
    this.onStatus = onStatus || (() => {});
    this.spawnFn = spawnFn;
    this.child = null;
    this.wanted = false;
    this.restarts = 0;
    this.restartTimer = null;
    this.status = { state: 'stopped' };
  }

  setStatus(state, message) {
    const next = { state, message: message || undefined };
    if (this.status.state === next.state && this.status.message === next.message) return;
    this.status = next;
    this.onStatus(next);
  }

  get running() { return !!this.child; }

  start() {
    this.wanted = true;
    if (this.child) return;
    let cmd;
    try { cmd = this.getCommand(); } catch (err) { return this.setStatus('error', `Can't prepare app tracking: ${err.message}`); }
    if (!cmd) return this.setStatus('unsupported', 'App tracking isn\'t available on this system.');
    let child;
    try {
      child = this.spawnFn(cmd.command, cmd.args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      return this.setStatus('error', `Can't start app tracking: ${err.message}`);
    }
    this.child = child;
    this.setStatus('starting');
    let stderr = '';
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let raw;
      try { raw = JSON.parse(line); } catch { return; }
      this.restarts = 0;
      if (raw && raw.perm === false) this.setStatus('permission', 'The permission for window titles is missing.');
      else this.setStatus('ok');
      this.onSample(raw);
    });
    child.on('error', (err) => {
      stderr += err.message;
      // M1: a spawn that fails (ENOENT, blocked by antivirus / AppLocker) emits 'error' and no 'exit'
      if (this.child !== child) return;
      this.child = null;
      log.error('activity', 'helper failed to start', err);
      this.setStatus('error', 'Can\'t start PowerShell for app tracking (maybe an antivirus or your company blocks it).');
    });
    child.on('exit', (code) => {
      if (this.child !== child) return;
      this.child = null;
      if (!this.wanted) return this.setStatus('stopped');
      if (this.restarts >= MAX_RESTARTS) {
        return this.setStatus('error', `Tracking stopped (code ${code}). ${stderr.trim().slice(-300)}`.trim());
      }
      this.restarts++;
      this.restartTimer = setTimeout(() => { this.restartTimer = null; if (this.wanted) this.start(); }, RESTART_DELAY_MS);
    });
  }

  stop() {
    this.wanted = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    const child = this.child;
    this.child = null;
    // only a child that really started: kill() on a failed spawn (no pid) can signal our own process group
    if (child && child.pid > 0 && child.exitCode === null) { try { child.kill(); } catch { /* already stopped */ } }
    this.setStatus('stopped');
  }
}

module.exports = { ActiveWindowTracker, MAX_RESTARTS };
