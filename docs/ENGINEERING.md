# Engineering

The technical side of Desktop Buddy: the hardest problems and how they were solved, security, tests and the code layout. The short version is in the [README](../README.md); the full design is in [ARCHITECTURE.md](ARCHITECTURE.md).

## Problems and decisions

The decisions I'm happiest with, and the problem behind each one.

| Problem | Decision |
|---|---|
| Recording a single window without a picker dialog | `desktopCapturer` finds the window, a **hidden recorder window** calls `getDisplayMedia`, and the main process answers through `setDisplayMediaRequestHandler`. `getDisplayMedia` requires a user gesture, so it's started with `executeJavaScript(…, true)`. |
| An app that closes and reopens should stay one video | The window is drawn onto a **canvas compositor** and the **canvas** is recorded, not the window stream. When the window reappears, the new stream is swapped in underneath and `MediaRecorder` never notices. |
| Timeline handles froze while dragging | Every `pointermove` set `currentTime`, so seeks on a long-GOP MP4 piled up. Now pointer moves are handled **once per animation frame**, only the **latest** target is sought, and the next seek waits for `seeked`; the handle and selection update immediately from the mouse, not from the video. Recordings are also encoded with a **1 s keyframe interval** (`videoKeyFrameIntervalDuration`). Measured in an automated run: 60 mouse moves → 17 seeks, no frame longer than ~25 ms. |
| One continuous montage from separate ranges | The MP4 path plays each part into the same canvas and **pauses the `MediaRecorder` while seeking** between parts, so there are no frozen frames at the joins; fades and the title card are drawn on the canvas. Parts and limits are validated again in the main process (`checkExport`), not trusted from the page. |
| Cutting MP4s without shipping ffmpeg (a large extra binary) | **Real-time re-encoding**: play the range in a hidden `<video>`, draw it to a canvas, record with `MediaRecorder`. It takes as long as the clip and is accurate to ~0.1 s. |
| The exported clip came out **empty (0 bytes)** | Videos are served through a custom `buddy-media://` protocol. Cross-origin frames **taint the canvas**, so nothing can be recorded. Fix: register the scheme with `corsEnabled`, send `Access-Control-Allow-Origin`, and add `crossorigin="anonymous"` on the `<video>`. It also answers **HTTP Range requests (206)**, so seeking works. |
| Short AI test launches were missed | Polling went from 2 s to **0.5 s**; a window has to be missing **twice in a row** before it counts as closed, which filters out flicker. |
| Tracking the active app without native modules | `active-win` / `get-windows` need node-gyp and Visual Studio Build Tools. Instead, a tiny **PowerShell helper** (`GetForegroundWindow`) streams one JSON line every 1.5 s, and it runs only while a session is active. |
| Never losing data on a crash | Every JSON file is written **atomically** (`.tmp` + `rename`). The active session is saved every 15 s and recovered paused after a crash. Corrupt files are backed up, not fatal. |
| Detecting "nothing is happening" cheaply | Frames are downscaled to **96×54 grayscale** and compared, with a small tolerance so a blinking cursor doesn't count as activity. |
| Two editions on one machine | All identity (name, appId, data folder) lives in **one module**, so the course app and the portfolio app install and run side by side with separate data. |
| Animations that are testable | The page only draws (CSS classes). **When** the buddy sleeps, where it looks and what it reacts to is decided in the main process by a small class (`BuddyMood`) with injected clock, idle time and cursor, so it's covered by unit tests. Eye direction is sent only when it changes. |
| One look, drawn in three places | The desktop buddy, the big preview and every option tile use **the same module** (`buddy-look.js`, works in Node and in the page, with the 27 shapes as data in `buddy-shapes.js`: where the face, hats, side and neck accessories go on each). It validates the saved look and draws SVG with `createElementNS`: no `innerHTML`, and colors go through CSSOM because the CSP blocks `style` attributes. |
| A spellchecker that was removed on purpose | 1.2.0 shipped spellcheck assuming Electron uses the Windows spellchecker, like Chrome. Testing on Windows showed it doesn't: on Windows, Electron's checker uses **Hunspell dictionaries downloaded from a Google CDN** (the Electron docs say so), which broke the "network only for email" rule. Instead of bundling dictionaries, the feature was **removed in 1.6.0** (it's a simple app); the checker is disabled and the dictionary URL still points at a closed local port, as a guard. |
| Progression that can't drift | XP, level and streak are **derived** from the per-day session files every time (`computeProgress(dayTotals, today)`, pure and tested), with past days cached. The only stored value is the last level celebrated, so a level-up is announced exactly once, including after a restart. Locked rewards are enforced in the main process (`lockLook`), not just greyed out in the page. |
| Proofing that respects the user | "Clean up text" never edits silently: rules run on a copy (URLs, emails and paths are masked first), the result is shown as a word diff with whitespace made visible (`·`, `↵`), and *Accept* applies it with `execCommand('insertText')` so **Ctrl+Z** still works. The rules are idempotent (tested). |
| Email that can't leak or downgrade | SMTP only, from the main process. Port 465 is TLS from the start, 587 **requires** STARTTLS (a server that doesn't offer it is refused, never plain text), TLS 1.2 minimum. The password is decrypted just before connecting, and server errors are translated without echoing the raw response. |

A deeper walkthrough, with diagrams, is in **[`docs/ARCHITECTURE.md`](ARCHITECTURE.md)**.

## The web demo

`npm run site` builds `site/` (published on Netlify): a presentation page plus a playable demo.

- **The app's real pages** (buddy, panel, statistics) are copied unchanged. One extra script, `web/app/demo/shim.js`, stands in for Electron: the page's **own preload** (`src/preload/*.js`) then runs as usual and calls `require('electron')`, which returns objects that forward to the demo host instead of IPC.
- **The main-process logic is bundled as it is**: `SessionManager`, `ProgressTracker`, `BuddyMood`, `ReminderScheduler`, notes, the clipboard secret filter, settings validation and email composing. `fs`, `path`, `crypto` and the JSON store get small in-memory stand-ins.
- `web/app/demo/host.js` plays the main process: same channel names as `src/main/ipc.js`. What a browser can't do (record other windows, float over the desktop, send email) is simulated or explained.
- `tests/web-demo.test.js` fails if a preload channel has no demo answer, so the demo keeps up with the app. The pages keep their strict CSP; the Theme setting works through `[data-theme]` copies of the dark rules.

## Security and privacy

- **Secrets are encrypted** with Electron `safeStorage` (Windows **DPAPI**, tied to the Windows account). The email password is never sent to a page; pages only learn whether one is saved. If encryption isn't available, the app **refuses to save** instead of storing plaintext.
- **Hardened windows**: `contextIsolation`, `sandbox`, no Node in pages, a strict **Content-Security-Policy** in every page, **no external resources** (no CDNs or web fonts).
- **Small, validated IPC surface**: every channel checks types, lengths and **which window sent it**. Files are opened by **id from the app's own index**, never by a path coming from a page.
- **User text is rendered with `textContent` only**, so a copied `<script>` shows up as text.
- **Network only when you send an email**: SMTP over TLS to the server in your settings, from the main process. No IMAP, so the app has no access to your inbox. A test scans all of `src/` and fails on any network API outside the email module, and there is **no spellchecker**, so no dictionaries are downloaded (removed in 1.6.0; the download URL also points at a closed local port).
- **Recordings never include the app itself**: its own windows are excluded from capture.

## Tech stack

**Electron 44** (Chromium 152) · **HTML / CSS / JavaScript**, no framework and no bundler · **`node:test`** for tests · **electron-builder** (NSIS installer) · **PowerShell** helper for app tracking · **MediaRecorder + Canvas** for recording and clip export · **nodemailer** (the only runtime dependency) for SMTP.

## Testing

- **Manual test plan**: [`qa/Desktop-Buddy-Test-Cases.xlsx`](qa/Desktop-Buddy-Test-Cases.xlsx), 72 test cases in standard QA format (ID, module, preconditions, steps, test data, expected result, priority, type, actual result, status), all run and passed on Windows (1.15.3 – 1.16.0). Also a defect log of the 27 real bugs found by the audits and by hand (steps to reproduce, expected vs actual, severity, priority, fixed-in version), and a map of the automated tests.
- **Lint + CI**: ESLint 10 (flat config, `@eslint/js` recommended, Node / browser globals per folder; `npm run lint`). GitHub Actions runs `npm ci`, `npm run lint` and `npm test` on `windows-latest` for every push and pull request.
- **Three audit rounds** (regressions, security, UX): round 1 ≈100 findings, round 2 ≈40, round 3 (confirmation) 7 low findings and no critical, high or medium ones; the cheap lows were fixed in 1.16.1, the rest are listed as deferred.
- **295 unit tests** (`npm test`, `node:test`, no Electron needed) cover the logic without UI:
  - **data safety**: atomic saves with fsync, a `.bak` of the last good version, recovery from corrupt or locked files, a guarded startup, crashed or hung windows that reload once and then close with a notice;
  - **security**: deny-by-default permissions, Electron fuses, the SMTP password bound to its server, symlinks refused, IPC accepted only from the app's own top frames, size and rate limits, a stronger clipboard secret filter, and an offline guard that fails on any network API outside email;
  - **features**: montage, progression, text tools, checklists, reminders, sessions (sleep and clock jumps not counted), statistics, email, the buddy shapes, the recorder state machine, screenshots, annotations and the gallery (including old "- adnotat.png" copies from earlier versions);
  - **UX**: settings migration (new users get simple mode and the tour; existing users keep the full view) and the `ui:mode` switch.
- **SMTP checked against a local TLS server**: 465 and 587 send, a wrong password and a closed port give clear messages, and a server without STARTTLS on 587 is **refused**.
- **Automated visual runs** in Electron under Xvfb: screenshots of every screen in both themes, plus a full record → mark → export pipeline on a **synthetic capture** that checks the exported MP4s are valid.
- **Manual testing on Windows** for what can't be automated headless: real window capture, transparency, multi-monitor positioning, the installer.

## Project structure

```
src/main/             main process: app lifecycle, windows, tray, IPC, storage, encryption
  recorder/           window recorder: rules, state machine, clips, media protocol
  activity/           active-app tracking (PowerShell / osascript helper)
  stats.js            pure functions behind Day by day and Last 30 days
  buddy-mood.js       when the buddy sleeps, where it looks, what it reacts to
  context-menu.js     right-click menu model (edit, transform, clean up)
  progress.js         XP / level / streak tracker over the session files
  reminders.js        note reminders: when they ring, what was missed while closed
  capture.js, screenshots.js   quick capture: area / window screenshots, quick note rules
  email/              email content + SMTP sending (send only)
src/preload/          the only bridge between pages and the app (contextBridge)
src/renderer/         buddy, panel (6 tabs), timer, statistics, recorder (hidden), clip editor, loop viewer,
                      quick note, screenshot area / window picker / grabber (hidden) / card after capture / large view
src/shared/           settings schema + validation, app identity, presets, buddy-look (styles + drawing), buddy-shapes (27 body shapes), annotations (screenshot annotations: model + geometry),
                      text-tools (word count, transforms, clean-up rules), progression (XP rules, rewards),
                      montage (parts, fades, export validation), checklist ([ ] / [x] lines),
                      reminder-time (formatting, quick choices, validation)
tests/                node:test suites for everything that has no UI
docs/                 architecture notes and screenshots
```
