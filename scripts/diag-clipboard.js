// Clipboard diagnostics (not part of the app, not in the installer).
// Run it with the Desktop Buddy app CLOSED (tray → Quit):
//   npx electron scripts/diag-clipboard.js
// Then copy (Ctrl+C) texts from Notepad, a browser etc. while it runs (60 s).
const { app, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const clip = require('../src/main/clipboard');

const DURATION_MS = 60000;
const short = (v) => JSON.stringify(String(v).slice(0, 40));
const time = () => new Date().toLocaleTimeString('en-GB');

app.whenReady().then(async () => {
  console.log('Electron', process.versions.electron, '| platform', process.platform);
  const dataDir = path.join(app.getPath('appData'), 'Desktop Buddy');
  for (const f of ['settings.json', 'clipboard.json']) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
      if (f === 'settings.json') console.log('[settings] clipboardEnabled =', d.clipboardEnabled, '| clipboardMax =', d.clipboardMax);
      else console.log('[saved history] entries =', (d.items || []).length);
    } catch (e) {
      console.log(`[${f}]`, e.code === 'ENOENT' ? 'missing' : e.message);
    }
  }

  // 1) round-trip test: we write a text and read it back
  const original = await clipboard.readText();
  const marker = 'diag-buddy-' + Date.now();
  await clipboard.writeText(marker);
  const back = await clipboard.readText();
  console.log('[write/read test]', back === marker ? 'OK' : `DIFFERENT: wrote ${short(marker)}, read ${short(back)}`);
  await clipboard.writeText(original); // put back what was there

  // 2) watching, exactly as in the app
  const added = [];
  const watcher = new clip.ClipboardWatcher(clipboard, (txt) => {
    added.push(txt);
    console.log(`${time()} >>> ADDED TO HISTORY:`, short(txt));
  });
  watcher.start();

  // 3) one read every 5 seconds, to see if the value changes
  let beat = 0;
  const heartbeat = setInterval(async () => {
    beat += 5;
    let text;
    try { text = await clipboard.readText(); } catch (e) { text = 'ERROR ' + e.message; }
    let sensitive;
    try { sensitive = await clip.isSensitive(clipboard); } catch (e) { sensitive = 'ERROR ' + e.message; }
    console.log(`${time()} [${beat}s] clipboard now = ${short(text)} | marked as password: ${sensitive}`);
  }, 5000);

  console.log(`\n>>> ${time()} COPY NOW (Ctrl+C) texts from Notepad and from a browser. Running for ${DURATION_MS / 1000} seconds.\n`);
  setTimeout(() => {
    clearInterval(heartbeat);
    watcher.stop();
    console.log(`\nDONE. Texts added by the watcher: ${added.length}`);
    app.quit();
  }, DURATION_MS);
});
