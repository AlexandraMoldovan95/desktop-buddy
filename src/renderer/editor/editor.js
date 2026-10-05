'use strict';
// The clip editor: pick a range (or a mark) and export it as a separate MP4, or build a montage.
// (GIF export existed in 1.4–1.5 and was removed in 1.6.0: app text didn't stay readable.)
// Export plays the part in a hidden <video>, draws it on a canvas and records it again
// with MediaRecorder (no ffmpeg). It takes as long as the clip, but it is frame-accurate.
(function () {
  const { h, icon, hydrateIcons, toast } = window.UI;
  const $ = (id) => document.getElementById(id);
  const player = $('player');
  const exporter = $('exporter');
  const tl = $('timeline');
  const tlSel = $('tlSel');
  const tlHead = $('tlHead');
  const hIn = $('hIn');
  const hOut = $('hOut');

  // ------------------------------------------------ simple / full mode (UX pass)
  let simple = false;
  function applyMode(m) {
    simple = m === 'simple';
    document.body.classList.toggle('simple', simple);
    drawTimeline();
  }
  // an older main without 'ui:mode' rejects: the editor stays in full mode (nothing hidden)
  window.editor.uiMode().then(applyMode, (e) => console.warn('[editor] ui mode unavailable:', e && e.message));
  window.editor.onUiMode(applyMode);
  $('moreBtn').addEventListener('click', () => {
    const open = !document.body.classList.contains('show-adv');
    document.body.classList.toggle('show-adv', open);
    $('moreBtn').setAttribute('aria-expanded', String(open));
    $('moreBtn').textContent = open ? 'Less' : 'More';
  });

  const BEFORE = 8000;
  const AFTER = 7000;
  const MIN = 500;

  let info = null;          // { id, name, url, marks, activeMs, fps }
  let dur = 0;              // duration in ms (from the player)
  let sel = { start: 0, end: 0 };
  let activeMark = -1;
  let playUntil = null;     // "Play selection" stops here
  const queue = [];         // exports: { id, start, end, state, progress, result, error }
  let exporting = false;
  let mp = null;            // the montage preview in progress: { i, titleStart } (see below)

  // ------------------------------------------------ formatting
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (ms, tenths = false) => {
    const t = Math.max(0, ms) / 1000;
    const s = Math.floor(t);
    const base = s >= 3600 ? `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${Math.floor(s / 60)}:${pad(s % 60)}`;
    return tenths ? `${base}.${Math.floor((t - s) * 10)}` : base;
  };
  const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
  const errText = (e) => ((e && e.message) || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Error';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const markRange = (t) => {
    let start = Math.max(0, t - BEFORE);
    const end = Math.min(dur || Infinity, t + AFTER);
    if (end - start < MIN) start = Math.max(0, end - MIN);
    return { start, end };
  };

  // ------------------------------------------------ the timeline
  const pct = (ms) => (dur ? (ms / dur) * 100 : 0);
  function drawTimeline() {
    tlSel.style.left = `${pct(sel.start)}%`;
    tlSel.style.width = `${Math.max(0, pct(sel.end) - pct(sel.start))}%`;
    hIn.style.left = `${pct(sel.start)}%`;
    hOut.style.left = `${pct(sel.end)}%`;
    const now = headNow();
    tlHead.style.left = `${pct(now)}%`;
    tl.setAttribute('aria-valuemax', String(Math.round(dur / 1000)));
    tl.setAttribute('aria-valuenow', String(Math.round(now / 1000)));
    tl.setAttribute('aria-valuetext', clock(now));
    $('timeNow').textContent = clock(now, true);
    const len = Math.round((sel.end - sel.start) / 1000);
    $('selInfo').textContent = !dur ? '' : simple ? `${len} ${len === 1 ? 'second' : 'seconds'} long` : `${clock(sel.start, true)} – ${clock(sel.end, true)} · ${secs(sel.end - sel.start)}`;
    $('exportSel').disabled = !dur || sel.end - sel.start < MIN;
    $('addToMontage').disabled = !dur || sel.end - sel.start < MIN;
  }

  function drawMarks() {
    const marks = (info && info.marks) || [];
    $('tlMarks').replaceChildren(...marks.map((t) => { const m = h('span', { class: 'tl-mark' }); m.style.left = `${pct(t)}%`; return m; }));
    $('marksCount').textContent = marks.length ? String(marks.length) : '';
    const list = $('marksList');
    if (!marks.length) {
      list.replaceChildren(h('li', {}, h('p', { class: 'empty-note', text: 'This recording has no marked moments. Next time, while recording, click the flag next to the buddy when something interesting happens.' })));
    } else {
      list.replaceChildren(...marks.map((t, i) => {
        const r = markRange(t);
        return h('li', {}, h('button', {
          class: 'mark-btn', type: 'button', 'aria-current': i === activeMark ? 'true' : 'false',
          onclick: () => { activeMark = i; setSel(r.start, r.end); seek(r.start); drawMarks(); },
        }, h('span', { class: 'mark-dot', 'aria-hidden': 'true' }), h('span', { class: 'mark-t', text: `${i + 1} · ${clock(t)}` }),
        h('span', { class: 'mark-r', text: `${clock(r.start)}–${clock(r.end)}` })));
      }));
    }
    $('exportMarks').disabled = !marks.length || !dur;
    $('exportMarks').querySelector('span').textContent = marks.length ? `Save all moments (${marks.length})` : 'Save all moments';
  }

  function setSel(start, end) {
    const a = clamp(Math.min(start, end), 0, dur);
    const b = clamp(Math.max(start, end), 0, dur);
    sel = { start: a, end: b };
    drawTimeline();
  }

  // Seeking in an MP4 is expensive (it decodes from the last key frame). While dragging we don't ask for a seek
  // on every mouse move: the playhead moves right away, and the video seeks only to the latest position,
  // after the previous seek is done (otherwise requests pile up and the bar "freezes").
  let headMs = 0;
  let seekWant = null;
  const headNow = () => (player.seeking || seekWant !== null ? headMs : player.currentTime * 1000);
  function flushSeek() {
    if (seekWant === null) return;
    const t = seekWant;
    seekWant = null;
    player.currentTime = t / 1000;
  }
  player.addEventListener('seeked', () => { flushSeek(); drawTimeline(); });
  function seek(ms) {
    headMs = clamp(ms, 0, dur);
    seekWant = headMs;
    if (!player.seeking) flushSeek();
    drawTimeline();
  }
  const msAt = (clientX) => { const r = tl.getBoundingClientRect(); return clamp(((clientX - r.left) / r.width) * dur, 0, dur); };

  // dragging: on the handles = move the start / end; elsewhere = seek in the video.
  // Moves are processed once per screen frame (requestAnimationFrame), not on every event.
  let drag = null;
  let dragX = 0;
  let dragFrame = 0;
  tl.addEventListener('pointerdown', (e) => {
    if (!dur) return;
    if (mp) stopMontage();
    if (!player.paused) player.pause();
    const r = tl.getBoundingClientRect();
    const x = (ms) => r.left + (ms / dur) * r.width;
    const near = (ms) => Math.abs(e.clientX - x(ms)) <= 12;
    // a handle grabbed directly wins; when they touch, the nearest one wins
    if (e.target === hIn) drag = 'in';
    else if (e.target === hOut) drag = 'out';
    else if (near(sel.start) || near(sel.end)) drag = Math.abs(e.clientX - x(sel.start)) < Math.abs(e.clientX - x(sel.end)) ? 'in' : 'out';
    else drag = 'seek';
    tl.classList.add('dragging');
    tl.setPointerCapture(e.pointerId);
    e.preventDefault();
    dragX = e.clientX;
    onDrag(dragX);
  });
  tl.addEventListener('pointermove', (e) => {
    if (!drag) return;
    dragX = e.clientX;
    if (!dragFrame) dragFrame = requestAnimationFrame(() => { dragFrame = 0; if (drag) onDrag(dragX); });
  });
  const endDrag = () => {
    if (!drag) return;
    cancelAnimationFrame(dragFrame);
    dragFrame = 0;
    onDrag(dragX);
    drag = null;
    tl.classList.remove('dragging');
  };
  tl.addEventListener('pointerup', endDrag);
  tl.addEventListener('pointercancel', endDrag);
  tl.addEventListener('lostpointercapture', endDrag);
  function onDrag(clientX) {
    const t = msAt(clientX);
    activeMark = -1;
    if (drag === 'in') { setSel(Math.min(t, sel.end - MIN), sel.end); seek(sel.start); }
    else if (drag === 'out') { setSel(sel.start, Math.max(t, sel.start + MIN)); seek(sel.end); }
    else seek(t);
  }

  // ------------------------------------------------ playback
  // Loop: "Play selection", "Play montage" and normal playback start over until Pause
  let loopOn = false;
  let playFrom = 0;
  function setLoop(on) {
    loopOn = on;
    player.loop = on && playUntil === null && !mp;
    $('loopBtn').setAttribute('aria-pressed', String(on));
    $('loopBtn').title = on ? 'Repeat is on: playback starts over (L)' : 'Repeat (L)';
  }
  function togglePlay() {
    if (!dur) return;
    if (player.paused) { playUntil = null; player.loop = loopOn && !mp; player.play().catch(() => {}); } else player.pause();
  }
  function playSelection() {
    if (!dur) return;
    if (mp) stopMontage();
    seek(sel.start);
    playFrom = sel.start;
    playUntil = sel.end;
    player.loop = false;
    player.play().catch(() => {});
  }
  /** The end of the selection: checked every frame (timeupdate fires only ~4 times a second). */
  function selectionTick() {
    if (playUntil === null || player.paused || player.seeking) return;
    if (player.currentTime * 1000 >= playUntil) {
      if (loopOn) seek(playFrom);
      else { player.pause(); playUntil = null; }
    }
  }
  player.addEventListener('play', () => setPlayIcon(true));
  player.addEventListener('pause', () => setPlayIcon(false));
  player.addEventListener('timeupdate', () => { selectionTick(); drawTimeline(); });
  function setPlayIcon(playing) {
    const b = $('playBtn');
    b.replaceChildren(icon(playing ? 'pause' : 'play'));
    b.setAttribute('aria-label', playing ? 'Pause (Space)' : 'Play (Space)');
  }
  // the playhead moves smoothly between timeupdate events
  // only while playing or previewing a montage; paused, it doesn't wake up at all (M4)
  let loopId = 0;
  function loop() {
    loopId = 0;
    if (!player.paused) { selectionTick(); drawTimeline(); }
    if (mp) montageTick();
    if (!player.paused || mp) loopId = requestAnimationFrame(loop);
  }
  const kickLoop = () => { if (!loopId) loopId = requestAnimationFrame(loop); };
  player.addEventListener('play', kickLoop);
  kickLoop();

  document.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const step = e.shiftKey ? 5000 : 1000;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); seek(player.currentTime * 1000 - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); seek(player.currentTime * 1000 + step); }
    else if (e.key === 'i' || e.key === 'I') { activeMark = -1; setSel(player.currentTime * 1000, Math.max(sel.end, player.currentTime * 1000 + MIN)); drawMarks(); }
    else if (e.key === 'l' || e.key === 'L') setLoop(!loopOn);
    else if (e.key === 'm' || e.key === 'M') { if (dur && addPart(sel)) toast(`Clip ${montage.parts.length} added to the movie`); }
    else if (e.key === 'o' || e.key === 'O') { activeMark = -1; setSel(Math.min(sel.start, player.currentTime * 1000 - MIN), player.currentTime * 1000); drawMarks(); }
  });
  $('playBtn').addEventListener('click', togglePlay);
  $('loopBtn').addEventListener('click', () => setLoop(!loopOn));
  $('playSel').addEventListener('click', playSelection);
  $('setIn').addEventListener('click', () => { activeMark = -1; setSel(player.currentTime * 1000, Math.max(sel.end, player.currentTime * 1000 + MIN)); drawMarks(); });
  $('setOut').addEventListener('click', () => { activeMark = -1; setSel(Math.min(sel.start, player.currentTime * 1000 - MIN), player.currentTime * 1000); drawMarks(); });

  // ------------------------------------------------ export: MP4 clip and montage (see shared/montage.js)
  const MT = window.Montage;
  let montage = { parts: [], fade: false, title: '' };

  /** spec = { parts, format: 'mp4', montage?, title?, fade? } — the main process checks it again. */
  function addJob(spec, label) {
    // the job keeps its own recording: the editor may switch to another recording while the queue runs
    queue.push({ key: `${Date.now()}-${queue.length}`, spec, label, state: 'waiting', progress: 0, recId: info.id, url: info.url, fps: info.fps });
    drawJobs();
    runQueue();
  }
  const clipLabel = (a, b, gif) => `${gif ? 'GIF' : 'Clip'} ${clock(a)}–${clock(b)}`;
  $('exportSel').addEventListener('click', () => {
    addJob({ parts: [{ start: sel.start, end: sel.end }], format: 'mp4' }, clipLabel(sel.start, sel.end, false));
    toast('Saving the clip…');
  });
  $('exportMarks').addEventListener('click', () => {
    const marks = (info && info.marks) || [];
    marks.forEach((t) => { const r = markRange(t); addJob({ parts: [r], format: 'mp4' }, clipLabel(r.start, r.end, false)); });
    toast(`Saving ${marks.length} ${marks.length === 1 ? 'clip' : 'clips'}…`);
  });

  async function runQueue() {
    if (exporting) return;
    const job = queue.find((j) => j.state === 'waiting');
    if (!job) return;
    exporting = true;
    job.state = 'running';
    drawJobs();
    try {
      job.result = await exportJob(job, (p) => { job.progress = p; drawJobProgress(job); });
      job.state = job.result ? 'done' : 'error';
      if (!job.result) job.error = 'The file came out empty.';
      else toast('Saved! Find it under "Your clips".');
    } catch (e) {
      if (job.cancel) job.state = 'cancelled';
      else { job.state = 'error'; job.error = errText(e); }
    }
    exporting = false;
    drawJobs();
    refreshClips();
    runQueue();
  }

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  function pickMime() {
    for (const m of ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
    throw new Error('This PC can\'t record video.');
  }
  const seekTo = async (ms) => {
    exporter.currentTime = ms / 1000;
    let t = 0;
    // a seek that never ends (unreadable file) must not hang the queue
    try { await Promise.race([once(exporter, 'seeked'), new Promise((_r, rej) => { t = setTimeout(() => rej(new Error('The video can\'t be read.')), 15000); })]); } finally { clearTimeout(t); }
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** The title frame: white text on a dark background, with a line in the buddy's colors. */
  function drawTitle(g, w, h, text) {
    g.fillStyle = '#15151C';
    g.fillRect(0, 0, w, h);
    const css = getComputedStyle(document.documentElement);
    const grad = g.createLinearGradient(w * 0.3, 0, w * 0.7, 0);
    grad.addColorStop(0, (css.getPropertyValue('--buddy-a') || '#B38CFF').trim());
    grad.addColorStop(1, (css.getPropertyValue('--buddy-b') || '#7A3FE0').trim());
    let size = Math.round(h * 0.075);
    g.font = `700 ${size}px "Segoe UI Variable Display", "Segoe UI", sans-serif`;
    while (g.measureText(text).width > w * 0.86 && size > 10) { size -= 2; g.font = `700 ${size}px "Segoe UI Variable Display", "Segoe UI", sans-serif`; }
    g.fillStyle = '#FFFFFF';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 - size * 0.25);
    g.fillStyle = grad;
    g.fillRect(w * 0.38, h / 2 + size * 0.75, w * 0.24, Math.max(2, Math.round(h * 0.008)));
  }
  const shade = (g, w, h, a) => { if (a > 0) { g.fillStyle = `rgba(0,0,0,${a.toFixed(3)})`; g.fillRect(0, 0, w, h); } };

  /** Starts the export in the main process, then plays and records again; on error, the partial file is deleted. */
  async function exportJob(job, onProgress) {
    if (mp) stopMontage();
    const begin = await window.editor.exportBegin(job.spec, job.recId);
    job.name = begin.name;
    drawJobs();
    try {
      exporter.src = job.url;
      await once(exporter, 'loadedmetadata');
      await renderMp4({ ...begin, fps: job.fps }, onProgress, job);
    } catch (e) {
      // close the job in main (removes the partial file); the original error is the one to show
      await window.editor.exportEnd(begin.id, false).catch((e2) => console.warn('[editor] export end failed:', e2 && e2.message));
      throw e;
    } finally {
      exporter.pause();
      exporter.removeAttribute('src');
      exporter.load();
    }
    return window.editor.exportEnd(begin.id, true);
  }

  /**
   * MP4: the parts play one after another in a hidden <video>, drawn on a canvas recorded with MediaRecorder.
   * Between parts the recording is paused while seeking (no frozen frames); the fade is a black layer over the frame.
   */
  async function renderMp4(b, onProgress, job = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = even(exporter.videoWidth);
    canvas.height = even(exporter.videoHeight);
    const W = canvas.width;
    const H = canvas.height;
    const g = canvas.getContext('2d', { alpha: false });
    const fps = b.fps || info.fps || 30;
    const bits = H >= 1400 ? 16e6 : H >= 1000 ? 12e6 : 8e6;
    const rec = new MediaRecorder(canvas.captureStream(fps), { mimeType: pickMime(), videoBitsPerSecond: bits * (fps === 60 ? 1.5 : 1), videoKeyFrameIntervalDuration: 1000 });
    let q = Promise.resolve();
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      q = q.then(async () => window.editor.exportChunk(b.id, new Uint8Array(await e.data.arrayBuffer())));
    };
    const stopped = new Promise((r) => { rec.onstop = r; });
    const tick = Math.round(1000 / fps);
    let done = 0;
    const hasTitle = !!b.title;
    const checkCancel = () => { if (job.cancel) throw new Error('Cancelled.'); };
    try {
      if (hasTitle) {
        drawTitle(g, W, H, b.title);
        rec.start(500);
        const t0 = performance.now();
        while (performance.now() - t0 < MT.TITLE_MS) {
          const u = performance.now() - t0;
          drawTitle(g, W, H, b.title);
          if (b.fade) shade(g, W, H, Math.max(0, (u - (MT.TITLE_MS - MT.FADE_MS)) / MT.FADE_MS));
          onProgress(clamp(u / b.totalMs, 0, 1));
          await sleep(tick);
          checkCancel();
        }
        done = MT.TITLE_MS;
      }
      for (let i = 0; i < b.parts.length; i++) {
        const p = b.parts[i];
        const partMs = p.end - p.start;
        const alphaAt = (u) => MT.fadeAlpha({ i, u, partMs, count: b.parts.length, fade: b.fade, hasTitle });
        if (rec.state === 'recording') rec.pause();
        await seekTo(p.start);
        g.drawImage(exporter, 0, 0, W, H);
        shade(g, W, H, alphaAt(0));
        if (rec.state === 'inactive') rec.start(500); else rec.resume();
        checkCancel();
        await exporter.play();
        await new Promise((resolve, reject) => {
          let lastT = -1;
          let movedAt = performance.now();
          const finish = (err) => { clearInterval(timer); exporter.removeEventListener('error', onErr); if (err) reject(err); else resolve(); };
          const onErr = () => finish(new Error('The video can\'t be read.'));
          exporter.addEventListener('error', onErr);
          const timer = setInterval(() => {
            if (job.cancel) { finish(new Error('Cancelled.')); return; }
            // playback stuck (file gone, read error without an event) → fail instead of "running" forever
            if (exporter.currentTime !== lastT) { lastT = exporter.currentTime; movedAt = performance.now(); }
            else if (performance.now() - movedAt > 5000) { finish(new Error('The video got stuck. Try again.')); return; }
            const u = exporter.currentTime * 1000 - p.start;
            g.drawImage(exporter, 0, 0, W, H);
            shade(g, W, H, alphaAt(u));
            onProgress(clamp((done + u) / b.totalMs, 0, 1));
            if (exporter.currentTime * 1000 >= p.end || exporter.ended) finish();
          }, tick);
        });
        exporter.pause();
        done += partMs;
      }
    } finally {
      // always stop the recorder (on error too), so no stream keeps running
      if (rec.state !== 'inactive') rec.stop();
    }
    await stopped;
    await q;
  }

  const once = (el, ev) => new Promise((resolve, reject) => {
    const done = () => { el.removeEventListener(ev, done); el.removeEventListener('error', fail); resolve(); };
    const fail = () => { el.removeEventListener(ev, done); el.removeEventListener('error', fail); reject(new Error('The video can\'t be read.')); };
    el.addEventListener(ev, done);
    el.addEventListener('error', fail);
  });

  // ------------------------------------------------ the montage: parts of the same recording, saved per recording
  let saveTimer = 0;
  let montageFailed = false;   // the last save failed: the next change (or opening another recording) retries
  function saveMontage() {
    clearTimeout(saveTimer);
    const id = info && info.id;   // the recording this montage belongs to, even if the editor switches meanwhile
    const m = montage;
    saveTimer = setTimeout(async () => {
      saveTimer = 0;
      try {
        const saved = await window.editor.montageSet(m, id);
        if (info && info.id === id) montage = saved;
        montageFailed = false;
      } catch (e) {
        if (!montageFailed) toast(`The movie wasn't saved. ${errText(e)}`, 'error');
        montageFailed = true;
      }
    }, 250);
  }
  function setMontage(next) {
    montage = { ...montage, ...next };
    saveMontage();
    drawMontage();
  }

  function addPart(r) {
    if (montage.parts.length >= MT.MAX_PARTS) { toast(`At most ${MT.MAX_PARTS} clips in a movie.`, 'error'); return false; }
    if (r.end - r.start < MT.MIN_PART_MS) { toast('The chosen clip is too short.', 'error'); return false; }
    setMontage({ parts: [...montage.parts, { start: Math.round(r.start), end: Math.round(r.end) }] });
    return true;
  }
  $('addToMontage').addEventListener('click', () => { if (addPart(sel)) toast(`Clip ${montage.parts.length} added to the movie`); });
  $('montAddSel').addEventListener('click', () => { if (addPart(sel)) toast(`Clip ${montage.parts.length} added`); });
  $('montAddMarks').addEventListener('click', () => {
    const marks = (info && info.marks) || [];
    if (!marks.length) { toast('The recording has no marked moments.', 'error'); return; }
    // close marks give overlapping ranges: merge them, so the same moment doesn't appear twice
    const ranges = MT.mergeRanges(marks.map((t) => markRange(t)));
    const free = MT.MAX_PARTS - montage.parts.length;
    setMontage({ parts: [...montage.parts, ...ranges.slice(0, free)] });
    toast(`${Math.min(free, ranges.length)} ${Math.min(free, ranges.length) === 1 ? 'clip' : 'clips'} added from ${marks.length} ${marks.length === 1 ? 'moment' : 'moments'}`);
  });
  $('montFade').addEventListener('change', (e) => setMontage({ fade: e.target.checked }));
  $('montTitle').addEventListener('input', (e) => { montage.title = e.target.value.slice(0, MT.MAX_TITLE); saveMontage(); drawMontageSummary(); });
  $('montClear').addEventListener('click', () => {
    if (!montage.parts.length) return;
    const old = montage.parts;
    setMontage({ parts: [] });
    toast('Movie clips cleared');
    lastCleared = old;
    $('montUndo').hidden = false;
  });
  let lastCleared = null;
  $('montUndo').addEventListener('click', () => { if (lastCleared) setMontage({ parts: lastCleared }); lastCleared = null; $('montUndo').hidden = true; });

  const montageSpec = () => ({ parts: montage.parts, format: 'mp4', montage: true, title: montage.title, fade: montage.fade });
  const partsWord = (n) => `${n} ${n === 1 ? 'clip' : 'clips'}`;
  const montageLabel = () => `Movie, ${partsWord(montage.parts.length)}`;
  $('montMp4').addEventListener('click', () => { addJob(montageSpec(), montageLabel()); toast('Saving the movie…'); });

  // ------------------------------------------------ the montage preview: the parts one after another, in the player
  // The title and the fade are simulated with a layer over the video (the same rules as the export: MT.fadeAlpha).
  const overlay = $('stageOverlay');
  const ovTitle = $('ovTitle');
  const ovBadge = $('ovBadge');

  function setOverlay(alpha, title = '', titleAlpha = 1) {
    overlay.hidden = alpha <= 0.001;
    overlay.style.opacity = String(Math.min(1, alpha));
    overlay.classList.toggle('titlecard', !!title);
    ovTitle.textContent = title;
    ovTitle.style.opacity = String(titleAlpha);
  }
  function markPlaying() {
    document.querySelectorAll('#montList .mont-item').forEach((el, k) => el.classList.toggle('playing', !!mp && k === mp.i));
    document.querySelectorAll('#tlParts .tl-part').forEach((el, k) => el.classList.toggle('playing', !!mp && k === mp.i));
    ovBadge.hidden = !mp || mp.i < 0;
    if (mp && mp.i >= 0) ovBadge.textContent = `Movie · part ${mp.i + 1} of ${montage.parts.length}`;
  }
  function playMontage() {
    if (!dur || !montage.parts.length) return;
    if (mp) { stopMontage(); return; }
    playUntil = null;
    mp = { i: -1, titleStart: null };
    kickLoop();
    $('montPlay').replaceChildren(icon('stop'), h('span', { text: 'Stop' }));
    if (montage.title) {
      player.pause();
      seek(montage.parts[0].start);
      mp.titleStart = performance.now();
      setOverlay(1, montage.title);
    } else nextPart();
    markPlaying();
  }
  function nextPart() {
    mp.i++;
    mp.titleStart = null;
    if (mp.i >= montage.parts.length) {
      stopMontage();
      if (loopOn) playMontage(); else toast('End of the movie');
      return;
    }
    const p = montage.parts[mp.i];
    seek(p.start);
    player.play().catch(() => {});
    markPlaying();
  }
  function stopMontage() {
    mp = null;
    setOverlay(0);
    player.pause();
    $('montPlay').replaceChildren(icon('play'), h('span', { text: 'Watch the movie' }));
    markPlaying();
  }
  function montageTick() {
    if (mp.titleStart !== null) {
      const u = performance.now() - mp.titleStart;
      if (u >= MT.TITLE_MS) { setOverlay(0); nextPart(); return; }
      const fadeOut = montage.fade ? Math.max(0, (u - (MT.TITLE_MS - MT.FADE_MS)) / MT.FADE_MS) : 0;
      setOverlay(1, montage.title, 1 - fadeOut);
      return;
    }
    const p = montage.parts[mp.i];
    if (!p) { stopMontage(); return; }
    const t = player.currentTime * 1000;
    if (t >= p.end || player.ended) { nextPart(); return; }
    setOverlay(MT.fadeAlpha({ i: mp.i, u: t - p.start, partMs: p.end - p.start, count: montage.parts.length, fade: montage.fade, hasTitle: !!montage.title }));
  }
  $('montPlay').addEventListener('click', playMontage);

  function movePart(i, delta) {
    const parts = montage.parts.slice();
    const j = i + delta;
    if (j < 0 || j >= parts.length) return;
    [parts[i], parts[j]] = [parts[j], parts[i]];
    setMontage({ parts });
  }

  const mb = (bytes) => `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`;
  function drawMontageSummary() {
    const n = montage.parts.length;
    const total = MT.totalMs(montage.parts, montage.title);
    $('montSum').textContent = n ? `${partsWord(n)} · ${clock(total)}` : '';
    $('montMp4').disabled = !n || !dur;
    $('montPlay').disabled = !n || !dur;
    $('montNote').textContent = n && total > 10 * 60000 ? 'A movie can be at most 10 minutes long.' : '';
    $('montMp4').disabled = !n || !dur || total > 10 * 60000;
  }

  function drawMontage() {
    const list = $('montList');
    $('montFade').checked = montage.fade;
    if (document.activeElement !== $('montTitle')) $('montTitle').value = montage.title;
    if (!montage.parts.length) {
      list.replaceChildren(h('li', {}, h('p', { class: 'empty-note', text: 'Choose a clip and click "Add to movie" (or press M), or add all moments. The list stays saved after you close this window.' })));
    } else {
      list.replaceChildren(...montage.parts.map((p, i) => h('li', { class: 'mont-item' },
        h('button', { class: 'mont-main', type: 'button', title: 'Show the clip in the player', onclick: () => { activeMark = -1; setSel(p.start, p.end); seek(p.start); drawMarks(); } },
          h('span', { class: 'mont-n', text: String(i + 1) }),
          h('span', { class: 'mont-t', text: `${clock(p.start)}–${clock(p.end)}` }),
          h('span', { class: 'mark-r', text: secs(p.end - p.start) })),
        h('span', { class: 'mont-actions' },
          h('button', { class: 'icon-btn icon-xs', type: 'button', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, onclick: () => movePart(i, -1) }, icon('up', 14)),
          h('button', { class: 'icon-btn icon-xs', type: 'button', 'aria-label': 'Move down', title: 'Move down', disabled: i === montage.parts.length - 1, onclick: () => movePart(i, 1) }, icon('down', 14)),
          h('button', { class: 'icon-btn icon-xs', type: 'button', 'aria-label': `Remove part ${i + 1}`, title: 'Remove', onclick: () => setMontage({ parts: montage.parts.filter((_, k) => k !== i) }) }, icon('close', 14))))));
    }
    $('montClear').hidden = !montage.parts.length;
    // the montage parts, on the timeline too (numbered)
    $('tlParts').replaceChildren(...montage.parts.map((p, i) => {
      const el = h('span', { class: 'tl-part', text: String(i + 1), title: `Clip ${i + 1}: ${clock(p.start)}–${clock(p.end)}` });
      el.style.left = `${pct(p.start)}%`;
      el.style.width = `${Math.max(0.4, pct(p.end) - pct(p.start))}%`;
      return el;
    }));
    if (mp && mp.i >= montage.parts.length) stopMontage();
    markPlaying();
    drawMontageSummary();
  }

  function jobActions(id, format = 'mp4') {
    return h('span', { class: 'job-actions' },
      format === 'mp4'
        // in a loop, in an app window, as big as the screen (for presentations / a portfolio)
        ? h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Play in a loop', title: 'Play in a loop (big screen)', onclick: () => window.editor.playLoop(id, { width: player.videoWidth, height: player.videoHeight }) }, icon('loop', 16), h('span', { class: 'act-label', text: 'Watch' }))
        : h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Open', title: 'Open', onclick: () => window.editor.open(id) }, icon('play', 16), h('span', { class: 'act-label', text: 'Open' })),
      // an MP4 doesn't repeat by itself: for a website, the <video autoplay loop muted> code + a copy with a web-friendly name
      format === 'mp4'
        ? h('button', { class: 'icon-btn icon-sm adv', type: 'button', 'aria-label': 'Copy the code for a website', title: 'Code for a website: copies <video> (autoplay, loop) and prepares the file', onclick: () => copyForSite(id) }, icon('code', 16))
        : null,
      h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Show in folder', title: 'Show in folder', onclick: () => window.editor.show(id) }, icon('folder', 16), h('span', { class: 'act-label', text: 'Show in folder' })));
  }

  async function copyForSite(id) {
    try {
      const r = await window.editor.webEmbed(id, { width: player.videoWidth, height: player.videoHeight });
      toast(`Code copied. Put "${r.fileName}" in your website's videos/ folder.`);
    } catch (e) { toast(errText(e), 'error'); }
  }

  function drawJobs() {
    const shown = queue.filter((j) => j.state !== 'done');   // F-M6: a saved clip shows up under "Your clips" instead
    $('queueCard').hidden = !shown.length;
    $('jobs').replaceChildren(...shown.reverse().map((j) => {
      const state = j.state === 'waiting' ? 'Waiting'
        : j.state === 'running' ? `Saving… ${Math.round(j.progress * 100)}%`
          : j.state === 'done' ? 'Saved' : j.state === 'cancelled' ? 'Stopped' : `Not saved: ${j.error}`;
      const bar = h('span', {});
      bar.style.width = `${Math.round((j.state === 'done' ? 1 : j.progress) * 100)}%`;
      return h('li', {}, h('div', { class: 'job' + (j.state === 'error' ? ' error' : ''), dataset: { key: j.key } },
        h('span', { class: 'job-name', text: j.label, title: j.name || '' }),
        j.state === 'done' && j.result ? jobActions(j.result.id)
          : j.state === 'running' || j.state === 'waiting' ? h('button', { class: 'icon-btn icon-sm', type: 'button', 'aria-label': 'Stop saving', title: 'Stop saving', onclick: () => cancelJob(j) }, icon('close', 16))
            : h('span', {}),
        h('span', { class: 'job-state', text: state }),
        j.state === 'running' || j.state === 'waiting' ? h('div', { class: 'job-bar' }, bar) : null));
    }));
  }
  function cancelJob(j) {
    if (j.state === 'waiting') { j.state = 'cancelled'; drawJobs(); return; }
    if (j.state === 'running') { j.cancel = true; j.progress = 0; drawJobs(); }
  }
  function drawJobProgress(j) {
    const el = document.querySelector(`.job[data-key="${j.key}"]`);
    if (!el) return;
    el.querySelector('.job-state').textContent = `Saving… ${Math.round(j.progress * 100)}%`;
    const bar = el.querySelector('.job-bar span');
    if (bar) bar.style.width = `${Math.round(j.progress * 100)}%`;
  }

  async function refreshClips() {
    let clips = [];
    try { clips = await window.editor.clips(); } catch { /* the list just stays empty */ }
    $('clipsList').replaceChildren(...(clips.length
      ? clips.map((c) => h('li', {}, h('div', { class: 'job' },
          h('span', { class: 'job-name', text: c.kind === 'montage' ? `Movie, ${partsWord(c.parts)}${c.format === 'gif' ? ' · GIF' : ''}` : clipLabel(c.startMs, c.endMs, c.format === 'gif'), title: c.name }),
          jobActions(c.id, c.format),
          h('span', { class: 'job-state', text: `${secs(c.activeMs || (c.endMs - c.startMs))} · ${mb(c.bytes)}` }))))
      : [h('li', {}, h('p', { class: 'empty-note', text: 'Nothing saved yet. Move the two handles, then press "Save this clip".' }))]));
  }

  // ------------------------------------------------ loading
  async function load() {
    if (montageFailed && info) saveMontage();   // retry the failed save for the recording being left
    try { info = await window.editor.info(); } catch (e) { toast(errText(e), 'error'); return; }
    $('fileName').textContent = info.name;
    $('fileName').title = info.name;
    document.title = `Cut a clip: ${info.label} – Desktop Buddy`;
    dur = 0;
    activeMark = -1;
    player.src = info.url;
    try { await once(player, 'loadedmetadata'); } catch (e) { toast(errText(e), 'error'); return; }
    dur = Number.isFinite(player.duration) ? player.duration * 1000 : info.activeMs;
    $('timeTotal').textContent = clock(dur);
    // the starting selection: the first mark, if there is one; otherwise the first 15 s
    if (info.marks.length) { activeMark = 0; const r = markRange(info.marks[0]); setSel(r.start, r.end); seek(r.start); }
    else setSel(0, Math.min(dur, 15000));
    drawMarks();
    try { montage = await window.editor.montageGet(); } catch { montage = MT.normalizeMontage(null); }
    lastCleared = null;
    $('montUndo').hidden = true;
    drawMontage();
    drawTimeline();
    refreshClips();
  }

  $('showFile').addEventListener('click', () => info && window.editor.show(info.id));
  window.editor.onLoad(() => { player.pause(); load(); });
  hydrateIcons();
  load();
})();
