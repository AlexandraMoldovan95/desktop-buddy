# Publishing clips on a portfolio site and GitHub

How to put clips exported by Desktop Buddy Portfolio online, **looping or not**. Written so that a person **or an AI assistant** building the portfolio can follow it step by step.

> **For an AI assistant:** follow the steps below exactly. Ask the owner **one** question before you start if it isn't clear yet: *"Should this clip loop silently (autoplay) or play only when clicked?"* Then use variant **A** or **B**. Never rename a video file without updating every `src` that points to it.

---

## 1. What the app gives you

In the clip editor, every MP4 clip and movie under **"Your clips"** has a **`</>`** button ("Copy the code for a website"; in simple mode it sits under **More**). One click:

1. Makes a copy of the clip with a **web-safe file name** (lowercase, no spaces, no diacritics), for example `note-organizer-test-2026-10-01-clip-0m02s-0m05s.mp4`, in the folder **`clips\for web\`** next to the recording. Explorer opens on it.
2. Copies this HTML to the clipboard (variant **A**, looping):

```html
<!-- Desktop Buddy clip: put "note-organizer-…-clip-0m02s-0m05s.mp4" in the site's videos/ folder. autoplay needs muted + playsinline; loop repeats it forever. -->
<video src="videos/note-organizer-…-clip-0m02s-0m05s.mp4" width="1280" height="720" autoplay loop muted playsinline preload="auto" aria-label="Note Organizer · clip 0:02–0:05" style="max-width:100%;height:auto"></video>
```

**Why the code matters:** an MP4 file has **no "loop" setting inside it**. Whether a video repeats is decided by the **player**, here the `<video>` tag. GIFs had a built-in loop flag, but the app no longer exports GIFs because text in app windows stayed unreadable and the files were large.

The clips have **no sound**: Windows doesn't record per-window audio. `muted` costs nothing.

---

## 2. Choose: loop or click-to-play

| Use | Variant | Why |
|---|---|---|
| Short demo of one feature (≈ 3–15 s), hero section, project card | **A: loop**, autoplay, silent | reads like an animated screenshot; nobody has to click |
| Longer walkthrough or montage (> ~20 s), several videos on one page | **B: click-to-play**, with controls | autoplaying long videos wastes bandwidth and distracts; the visitor decides |

When in doubt: **A** for clips under ~15 s, **B** for everything longer.

---

## 3. Your own HTML site on Netlify (or GitHub Pages)

### 3.1 Files

```
my-portfolio/
├── index.html
└── videos/
    └── note-organizer-…-clip-0m02s-0m05s.mp4   ← copied from clips\for web\
```

1. Copy the file from `clips\for web\` into the site's **`videos/`** folder. Create `videos/` if it doesn't exist.
2. Paste the code where the video should appear.
3. Deploy as usual: drag the folder onto Netlify, or push to the GitHub repo that Netlify builds from. Netlify serves `.mp4` with the right content type; no configuration is needed.

### 3.2 Variant A: loop (silent autoplay)

Use the code exactly as copied by the app. **Keep all of** `autoplay loop muted playsinline`:

| Attribute | If you remove it |
|---|---|
| `muted` | browsers **block autoplay** |
| `playsinline` | on iPhone the video can jump to full screen or not start |
| `loop` | it plays once and stops on the last frame |
| `width` / `height` | the page jumps when the video loads (layout shift) |

### 3.3 Variant B: click-to-play (no loop)

Take the copied code and change the attributes:

```html
<video src="videos/note-organizer-…-clip-0m02s-0m05s.mp4" width="1280" height="720" controls playsinline preload="metadata" aria-label="Note Organizer · clip 0:02–0:05" style="max-width:100%;height:auto"></video>
```

- **Remove** `autoplay`, `loop` and `muted`. **Add** `controls`.
- Change `preload="auto"` to **`preload="metadata"`**, so the browser only loads the length and the first frame until someone presses play.
- Optional: `poster="images/clip-cover.jpg"` shows a chosen image instead of the first frame. Take a screenshot of a good moment in the clip.

### 3.4 Recommended extras (both variants)

**Respect "reduce motion".** Some visitors turn off animations in their OS. Put this once at the end of the page; it pauses autoplaying clips for them and gives them controls:

```html
<script>
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('video[autoplay]').forEach((v) => { v.pause(); v.removeAttribute('autoplay'); v.controls = true; });
  }
</script>
```

**Many looping clips on one page?** Play each one only while it is on screen, to save bandwidth and battery. Use `preload="none"` on those videos and add:

```html
<script>
  const io = new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? e.target.play().catch(() => {}) : e.target.pause())), { threshold: 0.25 });
  document.querySelectorAll('video[loop]').forEach((v) => io.observe(v));
</script>
```

### 3.5 Size

- Netlify support recommends **no more than ~10 MB per uploaded file**.
- The app exports at up to **12 Mbit/s for 1080p** (≈ 1.5 MB per second, worst case) and **8 Mbit/s for 720p** (≈ 1 MB/s). Screen recordings with little motion usually come out **much smaller**, but a busy 15 s clip at 1080p **can pass 10 MB**. **Check the file size** in Explorer before uploading.
- To stay small: export **short clips** (the app's marks already make ~15 s clips), or record at **720p** (Video tab → Recording settings → Quality).
- For a long walkthrough, prefer a video platform (YouTube, Vimeo) and link or embed it there, instead of putting a large MP4 in the site.

---

## 4. GitHub

### 4.1 README of a repository

A README is **not** a normal web page: GitHub cleans the HTML.

- **A video stored in the repo and referenced by a relative path does not play** in the README.
- **What works:** edit the README on github.com and **drag the MP4 into the editor**. GitHub uploads it and inserts a link like `https://github.com/user-attachments/assets/<id>`. On its own line, that link becomes a **video player**.
- **Limits** for those uploads: about **10 MB** on free accounts (larger on paid plans). Formats: MP4, MOV, WebM.
- **Don't rely on autoplay or loop in a README.** Treat it as **variant B** (click-to-play). If a looping demo matters, put a screenshot in the README that **links to the Netlify page** where the clip loops.

### 4.2 The site's code in a GitHub repo (for Netlify or GitHub Pages)

- The `videos/` folder is committed like any other file. Sections 3.1–3.5 apply unchanged.
- GitHub **warns above 50 MB** per file and **refuses files above 100 MB**. Short clips are far below that.
- **GitHub Pages** is a normal web host: variants A and B work there exactly as on Netlify.

---

## 5. Other platforms (LinkedIn, Behance, etc.)

Upload the **MP4 file itself** through the platform's own upload button. Whether it autoplays or loops is decided by **that platform's player** and can change at any time. The `<video>` code from the app is only for sites you control.

---

## 6. Checklist (for the AI or for you)

- [ ] The clip shows **nothing private** (other windows, emails, keys, personal data). Watch it once to the end.
- [ ] The file in `videos/` has the **same name** as the `src` in the code.
- [ ] Variant **A** keeps `autoplay loop muted playsinline`; variant **B** has `controls` and no `autoplay`.
- [ ] `width` / `height` are present, and `style="max-width:100%;height:auto"` keeps the video inside the layout on phones.
- [ ] The file is ≲ 10 MB (Netlify) or ≲ 10 MB for a README drag-and-drop on a free GitHub account.
- [ ] After deploying, test on the live URL in Chrome **and** on a phone: A starts by itself and repeats; B starts on click.

<sub>Platform limits checked on 01.10.2026; they can change. Sources: Netlify support forum ("the recommended size for uploading to deploys is no more than 10MB", May 2025); GitHub community discussion #19403 on README videos and `user-attachments`.</sub>
