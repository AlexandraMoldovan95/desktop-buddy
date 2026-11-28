# Changelog

All notable changes to Desktop Buddy (Portfolio Edition). Dates are day.month.year.

## Unreleased (28.11.2026)

- The **picture window** (the large picture and its drawing tools) follows the light or dark theme like the other windows; it was always dark. Its colours are now theme tokens in `view.css`, and every text in its bars passes 4.5:1 in both themes (the lowest is 5.37:1). The window opens with the background of the current theme, so it never flashes the other one. The drawings themselves keep their own colours.
- Presentation page: the hero, the clip editor and the drawing pictures each have a light and a dark version, and the page shows the one that matches its theme. A comment after a dark rule no longer breaks the web demo's Statistics layout in the light theme (`build-site.js`; a test covers it).

## 1.16.1 (05.10.2026)

Round 3 audit (confirmation): no critical, high or medium issues; the cheap low ones are fixed. 294 unit tests.

- Power saver now also stops the pulsing red dot on the buddy while recording (the dot stays, still). BUG-024.
- Data safety: a save written without fsync (inside the 30 s gap) is now fsync'd once the gap is over, even when no other change follows. BUG-025.
- Security: the removed AI key is scrubbed from `settings.json.bak` at startup also when the main file was already clean (migrated by an older version). BUG-026.
- The checklist backdrop in the note editor gets its height from CSS, which removes the "ResizeObserver loop" console warning and a one-frame scrollbar flicker. BUG-027.
- **ESLint 10** (`npm run lint`, flat config) and lint in CI before the tests; fixed what it found (unused variables, useless assignments, error causes kept with `{ cause }`, a regex written with invisible characters now uses `\u` escapes).
- QA workbook: 4 new defects (BUG-024…027), `r3-fixes.test.js` in Automated Tests.
- **Web presentation and live demo** (`npm run site`, `netlify.toml`): a one-page site with the app's real buddy, panel and statistics running in the browser on made-up data. The pages are the app's own, with a stand-in for the Electron preload; the main-process logic is bundled unchanged. A test fails if a preload channel has no demo answer.
- `npm run demo` and the web demo share one demo-data generator (`scripts/demo-data.js`); today's demo sessions always end before "now".

## 1.16.0 (05.10.2026)

- **Remember this moment from the buddy**: while recording, a small flag appears next to the buddy; one click marks the moment. The Ctrl+Shift+F9 shortcut and its setting are removed (it failed on a real laptop and could steal keys from the recorded app).
- The note toolbar no longer wraps *Delete* onto a second row when the reminder box is open.
- QA: 2 new test cases (TC-REC-008, TC-NOTE-007), run and passed on Windows; 3 new defects (BUG-021…023). 283 unit tests.
- `npm run demo` (development only): starts the app on a separate `_demo-data` folder with 30 days of made-up sessions, for README screenshots. Real data is not touched; the installed app ignores the switch.
- README: fixed stale names (the `clips` folder, *Change how the buddy looks*, the settings categories).
- README screenshots retaken on Windows with the English UI; 8 older pictures with the Romanian UI were removed.

## 1.15.4 (04.10.2026)

- Fix: the **heart eyes** and **cat eyes** showed only their white shine dots. The new petting heart (1.15.3) used the same CSS class name as the eyes and hid them. The petting heart has its own class now, and a test fails if the buddy page ever restyles a class the buddy's face is drawn with.

## 1.15.3 (04.10.2026)

- **QA**: all 69 test cases run and passed (46 manual on Windows, 23 automated); see `docs/qa/Desktop-Buddy-Test-Cases.xlsx`.
- `npm start` explains in the terminal when it quits because another copy (e.g. the installed app) is running.
- **Pet the buddy**: stroke it back and forth with the mouse (no click) and it giggles, with a small heart by its head. Works with the panel open or closed; off when animations are off.
- Time tab → "How do I grow?" now says plainly that only timer minutes give XP and that XP is never lost.

## 1.15.2 (04.10.2026)

- The **mouse Back button** goes one step back in the panel: settings page → list, note → notes list, then the previous tab. It works whether the mouse sends a button, a "Browser Back" key or a Windows command (also Alt+←); it never closes the panel.
- Settings → Copied: clearer delete controls ("Delete the whole history"; the tab's "Clear list" keeps starred texts).

## 1.15.1 (04.10.2026)

- **Locking the screen** (Win+L) during a timer session: your choice in Settings → Time & timer: *Pause*, *Pause, then go on* or *Keep counting* (default: Pause).
- **Power saver** keeps the buddy's short reactions (wave, happy, sleep, eyes); only endless effects stop.
- A **one-time notice** if the recordings folder is synced by OneDrive (recordings would be uploaded), with a way to pick another folder.
- Settings → Help → **Log file** button.
- An email password saved before the address was typed is kept when the address is filled in (same server).
- A recovered recording says "length unknown" instead of 0:00; the old unused PowerShell script from 1.14.0 is removed.
- QA: `docs/qa/Desktop-Buddy-Test-Cases.xlsx` (67 test cases, defect log, automated test map). 277 unit tests.

## 1.15.0 (03.10.2026): audit release

Two rounds of adversarial audits (robustness, media, security, performance on a 4 GB / HDD PC, code review, beginner UX), about 140 findings fixed, each with a test. 273 unit tests (was 148).

- **English everywhere**: the interface, messages, file names, code comments and tests. Old Romanian-era files still work: `- adnotat.png` copies, the `clipuri` folder and old day files.
- **Simple mode and a first-run tour** for new users. The panel tabs are now Copied / Notes / Pictures / Video / Time / Settings, with advanced tools under **More**. Existing users keep the full view.
- **AI chat tab removed**: it was a placeholder. An old saved API key is deleted from the settings file and its backup.
- **Checklists with real checkboxes** in the note editor.
- **Power saver** (Auto / On / Off): no decorative animations, less polling, lighter recording defaults on weak PCs.
- **Data safety**:
  - a file that is locked or unreadable is never overwritten with empty data;
  - a `.bak` of the last good version, with automatic recovery;
  - a guarded startup and a log file;
  - crashed windows reload once, then close with a notice.
- **Recordings**:
  - a late chunk can no longer empty a finished recording;
  - the list is saved when a recording ends and on quit;
  - interrupted recordings are recovered;
  - recordings and clips are listed separately.
- **Pictures**:
  - size checked from the file header (no huge decodes);
  - thumbnails off the main thread;
  - the gallery loads in pages;
  - trashing many pictures is fast;
  - saving a drawing can't corrupt the previous copy.
- **Security**:
  - the email password is bound to its server;
  - permissions are denied by default;
  - Electron fuses are set;
  - symlinks are refused;
  - pages get no file paths;
  - a stronger clipboard secret filter;
  - an offline guard test.
- **Performance**:
  - the buddy appears first and stats are cached;
  - the timer window exists only during a session;
  - no endless animations;
  - session autosave is async.

## 1.14.0 (02.10.2026)
The original of a cropped or drawn-on picture is reachable from the app ("+ original" badge, *Open original*, an Annotated | Original switch). Deleting one side of a pair asks what to do with the other.

## 1.13.0 (02.10.2026)
Right-click menu on drawings (colour, size, text, duplicate, order, delete), labelled Undo / Delete selection buttons, a new shape stays selected, Esc switches to Select.

## 1.12.0 (02.10.2026)
Pictures gallery: all screenshots by day, one tile per picture, search, filter, multi-select to the Recycle Bin, drag out to other apps, import from the PC by choice. Cached JPEG thumbnails.

## 1.11.0 (02.10.2026)
Drawing on screenshots: pen, marker, arrow, line, rectangle, ellipse, text, speech bubbles, sticky notes, numbered steps, blur and crop. Saved as an editable copy next to the original. Zoom up to 800 %.

## 1.10.0 (01.10.2026)
A card with the picture appears next to the buddy after each screenshot (Copy, Open, Folder, Delete), without taking focus. Thumbnails in the Video tab.

## 1.9.0 (01.10.2026)
27 buddy shapes, 7 colours, new eyes, mouths, hair, accessories and effects; 72 rewards up to level 60.

## 1.8.0 (01.10.2026)
Quick capture from buttons only: a quick note next to the buddy, and area or window screenshots.

## 1.7.0 (01.10.2026)
Checklists in notes and reminders (notification, the buddy waves, missed reminders shown at start, Snooze / Done). MIT licence.

## 1.6.0 (01.10.2026)
GIF export removed (MP4 only), loop playback, smooth timeline handles, 1 s keyframes, a `<video>` snippet for websites, spellchecker removed (it downloaded dictionaries).

## 1.5.0 (01.10.2026)
Montage preview in the player, faster XP curve.

## 1.4.0 (30.09.2026)
Montage export: parts of one recording, all marks, fade, title card.

## 1.3.0 (30.09.2026)
A buddy that grows: XP from sessions, daily streak, rewards, level-up animation.

## 1.2.0 (30.09.2026)
Text tools without AI: word count, transforms, "Clean up text" with a preview.

## 1.1.0 (30.09.2026)
Animations, buddy customization, Settings by category, send-only email over SMTP.

## 1.0.0 (29.09.2026)
Portfolio edition started from the course app (clipboard history, notes, sessions, statistics), plus the window recorder and clip editor.
