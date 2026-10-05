'use strict';
// Captures one window (the one the main process picked through setDisplayMediaRequestHandler)
// and records it with MediaRecorder. Video chunks go to the main process right away.
(function () {
  const video = document.getElementById('preview');
  const probe = document.getElementById('probe');
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  let stream = null;
  let rec = null;
  let queue = Promise.resolve();   // chunks are sent in order
  let activeMs = 0;
  let activeSince = null;
  let idleTimer = 0;
  let statusTimer = 0;
  let stopping = false;

  const active = () => activeMs + (activeSince !== null ? performance.now() - activeSince : 0);
  const sendStatus = () => window.rec.status({ activeMs: Math.round(active()), paused: !!rec && rec.state === 'paused' });

  /** ONLY for tests in development mode (BUDDY_FAKE_CAPTURE=1): an animation instead of a real window.
   *  It moves for 2 s, stands still for 3 s, then moves again, so "skip idle parts" can be checked. */
  function fakeStream() {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    const t0 = performance.now();
    let x = 0;
    setInterval(() => {
      const t = (performance.now() - t0) % 7000;
      if (t < 2000 || t > 5000) x = (x + 6) % 600;
      g.fillStyle = '#1f2330'; g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#7c7ce8'; g.fillRect(x, 150, 40, 40);
    }, 33);
    return c.captureStream(30);
  }

  function pickMime(candidates) {
    for (const [mime, ext] of candidates) if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
    throw new Error('This PC can\'t record video (no supported format).');
  }

  // We record a canvas we draw the window onto, not the window directly: this way, if the app
  // closes and reopens (repeated tests), we switch to the new window in the same file.
  const out = document.createElement('canvas');
  const outCtx = out.getContext('2d', { alpha: false });
  let cfg = null;
  let drawTimer = 0;
  let waiting = false;       // the window closed; waiting for it to come back
  let idlePaused = false;    // paused by "skip idle parts"
  let detector = null;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);

  function draw() {
    // paused (idle skip / window gone): nothing is encoded, so no full-frame copy either (M1)
    if (waiting || (rec && rec.state === 'paused') || video.readyState < 2 || !video.videoWidth) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const k = Math.min(out.width / vw, out.height / vh);
    const w = Math.round(vw * k);
    const h = Math.round(vh * k);
    outCtx.fillStyle = '#111217';
    outCtx.fillRect(0, 0, out.width, out.height);
    outCtx.drawImage(video, Math.round((out.width - w) / 2), Math.round((out.height - h) / 2), w, h);
  }

  const pauseRec = () => { if (rec && rec.state === 'recording') { rec.pause(); activeMs = active(); activeSince = null; sendStatus(); } };
  const resumeRec = () => { if (rec && rec.state === 'paused' && !waiting && !idlePaused) { rec.resume(); activeSince = performance.now(); sendStatus(); } };

  function watchIdle(idleMs) {
    detector = window.Idle.createIdleDetector({ idleMs });
    idleTimer = setInterval(() => {
      if (!rec || rec.state === 'inactive' || waiting || video.readyState < 2) return;
      ctx.drawImage(video, 0, 0, probe.width, probe.height);
      const frame = window.Idle.toGray(ctx.getImageData(0, 0, probe.width, probe.height).data);
      const decision = detector.update(frame, performance.now());
      if (decision === 'pause' && !idlePaused) { idlePaused = true; pauseRec(); }
      else if (decision === 'record' && idlePaused) { idlePaused = false; resumeRec(); }
    }, 200);
  }

  /** Captures the window the main process picked (the first time and on re-attach). */
  async function attachSource() {
    const p = cfg.profile;
    const s = cfg.fake ? fakeStream() : await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: { width: { max: p.maxWidth }, height: { max: p.maxHeight }, frameRate: { ideal: p.fps, max: p.fps } },
    });
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = s;
    const track = s.getVideoTracks()[0];
    track.addEventListener('ended', () => { if (stream === s) sourceEnded(); });   // the window closed
    video.srcObject = s;
    await video.play().catch(() => {});
    return track.getSettings();
  }

  function sourceEnded() {
    if (waiting || stopping) return;
    waiting = true;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
    pauseRec();
    window.rec.sourceEnded();
  }

  async function start(c) {
    cfg = c;
    const p = cfg.profile;
    const set = await attachSource();
    // the file size = the first window's size (within the chosen quality); later windows fit inside it
    const k = Math.min(1, p.maxWidth / (set.width || p.maxWidth), p.maxHeight / (set.height || p.maxHeight));
    out.width = even((set.width || 1280) * k);
    out.height = even((set.height || 720) * k);
    draw();
    drawTimer = setInterval(draw, Math.round(1000 / p.fps));
    const { mime, ext } = pickMime(cfg.mimes);
    rec = new MediaRecorder(out.captureStream(p.fps), { mimeType: mime, videoBitsPerSecond: p.bitsPerSecond, videoKeyFrameIntervalDuration: 1000 });   // a key frame every 1 s: the editor seeks faster on the timeline (1.6.0)
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      queue = queue.then(async () => window.rec.chunk(new Uint8Array(await e.data.arrayBuffer())));
    };
    rec.onerror = (e) => window.rec.error((e.error && e.error.message) || 'Recording error.');
    window.rec.started({ ext, width: out.width, height: out.height });
    rec.start(1000);
    activeSince = performance.now();
    statusTimer = setInterval(sendStatus, 1000);
    if (cfg.skipIdle) watchIdle(cfg.idleMs);
  }

  /** The main process saw the window close before we did. */
  function detach() { sourceEnded(); }

  /** The window came back: capture it and continue in the same file. */
  async function attach() {
    await attachSource();
    waiting = false;
    idlePaused = false;
    if (detector) detector.reset();
    resumeRec();
    window.rec.attached();
  }

  function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(idleTimer);
    clearInterval(statusTimer);
    clearInterval(drawTimer);
    if (!rec || rec.state === 'inactive') { finish(); return; }
    rec.onstop = () => finish();
    if (rec.state === 'recording') { activeMs = active(); activeSince = null; }
    rec.stop();
  }

  function finish() {
    queue.then(() => {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      window.rec.done({ activeMs: Math.round(active()) });
    });
  }

  // called from the main process (executeJavaScript with a "user gesture", which getDisplayMedia needs)
  const report = (err) => window.rec.error(`${err.name || 'Error'}: ${err.message}`);
  window.recorder = {
    start: (c) => start(c).catch(report),
    attach: () => attach().catch(report),
    detach,
    stop,
  };
})();
