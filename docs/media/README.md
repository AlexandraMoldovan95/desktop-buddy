# Media

Images used by the main README and `docs/FEATURES.md`.

| File | What it shows | Source |
|---|---|---|
| `hero.png` / `hero-light.png` | the buddy + the panel while recording + Last 30 days, dark / light theme (the presentation page shows the one that matches its theme) | composite of the web demo (`npm run site`, served over http): its desktop with the buddy and the panel during a simulated recording, and its Statistics window, captured in headless Edge with the theme emulated |
| `panel-video.png` | Video tab during a recording, with *Remember this moment* | Windows screenshot |
| `editor-montage.png` / `editor-montage-light.png` | clip editor with three marked moments, dark / light theme (the presentation page shows the one that matches its theme) | the window's own content (no title bar), captured through the DevTools protocol with the theme emulated, from `npm start` on `_demo-data` with `--remote-debugging-port`; a real recording of a test app |
| `stats-30-days.png` | Statistics → Last 30 days | Windows screenshot, demo data |
| `panels-progress.png` | Time tab level card + *How the buddy looks* with locked shapes, dark theme | Windows screenshots, demo data |
| `screenshot-gallery.png` | the Pictures gallery | Windows screenshot |
| `screenshot-annotate.png` / `screenshot-annotate-light.png` | drawing on a screenshot (blur, a box, an ellipse, a sticky note, a speech bubble), dark / light theme (the presentation page shows the one that matches its theme) | the picture window's own content (no title bar), captured like the clip editor above; the drawings are the demo picture's saved drawings |
| `notes-checklist-reminders.png` | a checklist note, the reminder card, a reminder that went off (Snooze / Done), dark theme | Windows screenshots |
| `buddy-grow.png` | level-up frame (golden ring) + two unlocked looks | automated render |
| `buddy-idle-recording.png` | the buddy, idle and while recording | automated render |
| `buddy-looks.png` | six buddy styles, then the wave, happy, thinking and sleeping animations | automated render |
| `buddy-shapes.png` | the 27 buddy shapes | automated render |

**How to retake them:** run `npm run demo` (30 days of made-up sessions in `_demo-data\`, real data untouched), turn Simple mode off, and use `Win+Shift+S`. Keep the same file names. Use only made-up content: no real email addresses, user names or private window titles.

Desktop Buddy excludes its own windows from *its* recordings, so use **Xbox Game Bar** (`Win+Alt+R`) or the Snipping Tool to film the app itself.
