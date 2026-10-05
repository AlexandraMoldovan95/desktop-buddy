'use strict';
// `npm run demo`: starts the app (development mode) on a separate data folder, `_demo-data\`, filled with
// 30 days of made-up timer sessions, so README screenshots show full statistics and no real window titles.
// Your real data in %APPDATA%\Desktop Buddy Portfolio is not read or changed.
// Sessions are rebuilt on every run (so "today" is always today); settings, notes and pictures you make
// in the demo stay until you delete `_demo-data\`.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const DIR = path.join(__dirname, '..', '_demo-data');

function writeDemo() {
  const sessionsDir = path.join(DIR, 'sessions');
  fs.rmSync(sessionsDir, { recursive: true, force: true });
  fs.rmSync(path.join(DIR, 'progress-totals.json'), { force: true });   // the level cache is rebuilt from the sessions
  fs.mkdirSync(sessionsDir, { recursive: true });

  const settingsFile = path.join(DIR, 'settings.json');
  if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify({
      theme: 'light', uiMode: 'full', tourDone: true, lastTab: 'session',
      trackApps: false, launchAtLogin: false, recNotify: false,
    }, null, 2));
  }

  const days = require('./demo-data').days(Date.now());
  let n = 0;
  for (const [date, file] of Object.entries(days)) {
    fs.writeFileSync(path.join(sessionsDir, `${date}.json`), JSON.stringify(file));
    n += file.sessions.length;
  }
  return n;
}

const count = writeDemo();
console.log(`[demo] ${count} demo sessions written to _demo-data\\. Your real data is not touched.`);
console.log('[demo] Quit the installed Desktop Buddy Portfolio first (tray icon -> Quit), or this copy closes at once.');
const electron = require('electron');   // the path to the Electron binary
const child = spawn(electron, ['.'], { cwd: path.join(__dirname, '..'), stdio: 'inherit', env: { ...process.env, BUDDY_DATA_DIR: DIR } });
child.on('exit', (code) => process.exit(code ?? 0));
