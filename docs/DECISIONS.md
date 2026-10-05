# Decisions

The product and engineering decisions behind Desktop Buddy, and why they were made. For the details of how things work, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Product

| Decision | Why |
|---|---|
| Record a window chosen by its **title**, not by the app | Every Python / Tkinter app shows up as "Python"; the title is what tells them apart. |
| Recording **starts and stops by itself** and merges relaunches within 15 s | AI test agents reopen the app dozens of times; one file per run is what you want to edit. |
| **Screenshots from buttons only**, no global hotkeys | Nothing fires by accident while typing in another app. |
| **GIF export removed** (1.6.0), MP4 + a ready `<video loop>` tag instead | Real tests showed GIF text was unreadable and files were huge. |
| **Spellchecker removed** (1.6.0) | On Windows, Electron downloads dictionaries from Google, which broke the "offline except email" rule. |
| **AI chat tab removed** (1.15.0) | It was a placeholder that never called a model. A reviewer reads a fake feature as unfinished work; the app is better without it. |
| **Simple mode by default for new users**, full view for existing users (1.15.0) | The goal is that a complete beginner understands it at first sight; experienced users shouldn't lose anything. Simple mode only hides, never removes. |
| **The tour shows only once, at the first start after a fresh install** | Repeating it after updates would interrupt people who already know the app; anyone can reopen it from Settings → Help. |
| **English interface** (1.15.0) | The app is a portfolio piece for international employers. Old Romanian-era file names are still recognized. |
| **Marks from a flag on the buddy, no global shortcut** (1.16.0) | Ctrl+Shift+F9 didn't work on a real laptop (F-keys behind Fn, or the combination taken by another app), and a global key can steal input from the app being tested. The flag is one click, visible only while recording. |
| **Date and time boxes follow the Windows region** (1.16.0) | People see dates the way they set them in Windows; the rest of the app writes dates in en-GB words ("5 Oct"), which read the same everywhere. |
| **A live web demo that runs the app's real pages** (Unreleased) | Recruiters won't install an unsigned app. A demo rebuilt by hand would drift from the app; running the real pages with a stand-in preload and the real logic modules keeps them identical, and a test checks every channel. Recording and the always-on-top buddy can't exist in a browser, so they are simulated and the page says so. |
| **Drawings go to a copy** (`- annotated.png`); the original is never changed | Users can always go back to the clean picture, and drawings stay editable. |
| Deleting one side of an original / copy pair **asks every time** | It's the user's file; a silent "delete both" lost originals in testing. |

## Engineering

| Decision | Why |
|---|---|
| Electron + vanilla JS, **no framework, no bundler** | Small, readable, nothing to build; every window is a plain page. |
| **Logic in pure modules with injected dependencies** | 277 tests run with `node:test` in seconds, without Electron. |
| **Network only from main, only for SMTP email** (TLS 1.2+, no IMAP) | Privacy: the app can't read an inbox and sends nothing else. A test fails on any other network API. |
| **Secrets encrypted with `safeStorage`**, never sent to a page, no plain-text fallback | A page compromise can't leak them; a missing keyring fails safe. |
| Email password **bound to host / port / security / user** | A typo in the server name would otherwise send the password to someone else. |
| **Pages never receive file paths**; files are addressed by id or validated name | Paths leak the Windows user name and invite path tricks. |
| **Strict CSP**, no inline styles, user text only through `textContent` | No HTML injection surface at all. |
| Exports re-encoded in real time with `MediaRecorder` instead of ffmpeg | The installer stays small and there's no external binary to ship or update. |
| **Never overwrite a file the app couldn't read** (1.15.0) | Antivirus and OneDrive lock files briefly; treating "unreadable" as "empty" erased notes in testing. |
| Error handling **at boundaries** (fs, IPC, child processes, windows), logged, with a short user message | Wrapping everything in try/catch hides bugs; catching at the edges keeps failures visible and recoverable. |
| **Power saver** decided from RAM / CPU count, user-overridable | The target includes 4 GB / HDD / dual-core PCs; strong PCs keep full behaviour. Short buddy reactions stay on (1.15.1): without them the buddy looks lifeless, and they cost almost nothing. |
| **Screen lock behaviour is a setting** (1.15.1) | Whether time with the screen locked is "work" depends on the person; the default (pause) keeps statistics honest. |
| **Strict TLS for email** (1.15.1), no trust in extra Windows certificates | Antivirus mail shields then fail with a clear message instead of the app accepting intercepted TLS. |
| **OneDrive notice, not an automatic folder change** (1.15.1) | Recordings must stay private, but the app never moves user files without asking. |
| Progress (XP, level, streak) **derived from session history**, not stored | There is no counter that can drift or be tampered with. |
