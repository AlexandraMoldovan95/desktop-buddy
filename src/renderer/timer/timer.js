'use strict';
// The timer: active time, editable title, pause / resume, stop (with confirmation), opacity, hide.
// Drag anywhere except the buttons to move the window. The main process saves the position.
(function () {
  const { icon, hydrateIcons } = window.UI;
  const STEPS = [100, 85, 70, 55, 40];
  const bar = document.getElementById('bar');
  const titleBtn = document.getElementById('title');
  const tag = document.getElementById('tag');
  const timeEl = document.getElementById('time');
  const toggle = document.getElementById('toggle');
  const stopBtn = document.getElementById('stop');
  const opacityBtn = document.getElementById('opacity');
  const hideBtn = document.getElementById('hide');

  let session = null;
  let opacity = 100;
  let editing = false;
  let stopArmed = 0;

  const fmt = (ms) => {
    const t = Math.max(0, Math.floor(ms / 1000));
    const p = (n) => String(n).padStart(2, '0');
    return `${Math.floor(t / 3600)}:${p(Math.floor((t % 3600) / 60))}:${p(t % 60)}`;
  };
  const activeMs = (s) => (s ? s.segments.reduce((sum, seg) => sum + Math.max(0, (seg.end ?? Date.now()) - seg.start), 0) : 0);

  // the text changes once a second: write it only then, and wake up at the next whole second (H1)
  let tickTimer = 0;
  function renderTime() {
    const ms = activeMs(session);
    const text = fmt(ms);
    if (timeEl.textContent !== text) timeEl.textContent = text;
    clearTimeout(tickTimer);
    tickTimer = 0;
    if (session && session.state === 'running' && !document.hidden) tickTimer = setTimeout(renderTime, 1000 - (ms % 1000) + 5);
  }
  document.addEventListener('visibilitychange', renderTime);

  function render() {
    const state = session ? session.state : 'idle';
    bar.dataset.state = state;
    if (!editing) {
      titleBtn.textContent = session ? session.title : 'No timer running';
      titleBtn.title = session ? `${session.title}\nClick to change the title · drag to move` : '';
    }
    tag.hidden = !(session && session.recovered);
    tag.textContent = 'recovered';
    tag.title = 'The app closed suddenly. The time up to the last save was kept and the timer was paused.';
    const running = state === 'running';
    toggle.replaceChildren(icon(running ? 'pause' : 'play', 18));
    toggle.setAttribute('aria-label', running ? 'Pause' : 'Resume');
    toggle.title = running ? 'Pause' : 'Resume';
    opacityBtn.setAttribute('aria-label', `Opacity ${opacity} %. Click for more transparent.`);
    opacityBtn.title = `Opacity ${opacity} % (click to change)`;
    renderTime();
  }

  // ------------------------------------------------ buttons
  toggle.addEventListener('click', () => (session && session.state === 'running' ? window.timer.pause() : window.timer.resume()));

  stopBtn.addEventListener('click', async () => {
    if (!stopArmed) {
      // the first click asks for confirmation, so you don't stop the session by mistake
      stopBtn.classList.add('confirm');
      stopBtn.replaceChildren('Stop?');
      stopArmed = setTimeout(disarmStop, 3000);
      return;
    }
    disarmStop();
    await window.timer.stop();
  });
  function disarmStop() {
    clearTimeout(stopArmed);
    stopArmed = 0;
    stopBtn.classList.remove('confirm');
    stopBtn.replaceChildren(icon('stop', 18));
  }

  opacityBtn.addEventListener('click', () => {
    const i = STEPS.indexOf(opacity);
    window.timer.setOpacity(STEPS[(i + 1) % STEPS.length]);
  });
  hideBtn.addEventListener('click', () => window.timer.hide());

  // ------------------------------------------------ editable title
  function startEdit() {
    if (!session || editing) return;
    editing = true;
    const input = document.createElement('input');
    input.className = 'title-input';
    input.maxLength = 120;
    input.value = session.title;
    input.setAttribute('aria-label', 'What are you working on?');
    titleBtn.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      editing = false;
      input.replaceWith(titleBtn);
      if (save && input.value.trim() && input.value.trim() !== session.title) await window.timer.rename(input.value);
      render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  // ------------------------------------------------ moving (drag)
  let pressed = false;
  let frame = 0;
  let downOnTitle = false; // with pointer capture, pointerup lands on the bar, not on the title
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || editing || e.target.closest('.actions')) return;
    pressed = true;
    downOnTitle = !!e.target.closest('#title');
    bar.setPointerCapture(e.pointerId);
    window.timer.dragStart();
  });
  bar.addEventListener('pointermove', () => {
    if (!pressed || frame) return;
    bar.classList.add('dragging');
    frame = requestAnimationFrame(() => { frame = 0; window.timer.dragMove(); });
  });
  const end = async () => {
    if (!pressed) return;
    pressed = false;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    bar.classList.remove('dragging');
    const { moved } = await window.timer.dragEnd();
    // a click (no movement) on the title = edit
    if (!moved && downOnTitle) startEdit();
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);

  // ------------------------------------------------ state
  window.timer.onChanged((state) => { session = state.session; if (!session) disarmStop(); render(); });
  // pulse off with animations off or in Power saver
  const applyCalm = (s) => bar.classList.toggle('calm', !s.buddyAnimations || !!(s.powerInfo && s.powerInfo.low));
  window.timer.onSettings((s) => { opacity = s.timerOpacity; applyCalm(s); render(); });

  // simple / full mode (UX pass); an older main without 'ui:mode' rejects: full mode (nothing hidden)
  const applyMode = (m) => document.body.classList.toggle('simple', m === 'simple');
  window.timer.uiMode().then(applyMode, (e) => console.warn('[timer] ui mode unavailable:', e && e.message));
  window.timer.onUiMode(applyMode);

  (async () => {
    hydrateIcons();
    const [state, s] = await Promise.all([window.timer.getState(), window.timer.getSettings()]);
    session = state.session;
    opacity = s.timerOpacity;
    applyCalm(s);
    render();
  })();
})();
