'use strict';
// The button: press + move = move it, press without moving = open the panel.
// The main process computes the threshold and the position (in screen coordinates).
// Animations: the main process sends reactions (buddy:react), the gaze (buddy:look) and the config;
// the page only decides how it looks. Everything goes through classes on #stage (see buddy.css).
(function () {
  const el = document.getElementById('buddy');
  const stage = document.getElementById('stage');
  // body + face + hair + accessories (colors go on #stage, so the hand, Zzz etc. use them too)
  window.BuddyLook.build(el);
  window.BuddyLook.apply(el, window.BuddyLook.DEFAULT_LOOK, stage);
  let pressed = false;
  let frame = 0;
  let startX = 0;
  let startY = 0;

  // ------------------------------------------------ animations
  const DURATION = { wave: 1600, happy: 900, wow: 700, yawn: 1200, levelup: 1800, giggle: 900 };
  const WAVE_COOLDOWN = 12000;   // the wave on hover, at most once every 12 s
  const WOW_COOLDOWN = 3000;
  let enabled = true;
  let sleeping = false;
  let oneShot = null;
  let oneShotTimer = 0;
  let lastWave = 0;
  let lastWow = 0;

  function play(name) {
    if (!enabled) return;
    if (sleeping && name !== 'yawn') return;
    if (oneShot) stage.classList.remove(`do-${oneShot}`);
    clearTimeout(oneShotTimer);
    void stage.offsetWidth;                 // restarts the CSS animation if it is the same one
    oneShot = name;
    stage.classList.add(`do-${name}`);
    oneShotTimer = setTimeout(() => { stage.classList.remove(`do-${name}`); oneShot = null; }, DURATION[name]);
  }

  function wave() { lastWave = Date.now(); play('wave'); }

  function sleep() {
    if (!enabled || sleeping) return;
    sleeping = true;
    if (oneShot) { stage.classList.remove(`do-${oneShot}`); oneShot = null; }
    stage.classList.add('st-sleep');
  }

  /** Wakes up: yawns, then waves. fromUser = you woke it (hover / click). */
  function wake(fromUser) {
    if (!sleeping) return;
    sleeping = false;
    stage.classList.remove('st-sleep');
    play('yawn');
    setTimeout(wave, DURATION.yawn);
    if (fromUser) window.buddy.woke();
  }

  function think(on) {
    stage.classList.toggle('st-think', !!on && enabled);
  }

  function look({ x, y }) {
    if (!enabled || sleeping) return;
    stage.style.setProperty('--lx', `${(x * 2.6).toFixed(2)}px`);
    stage.style.setProperty('--ly', `${(y * 2.2).toFixed(2)}px`);
  }

  let lowPower = false;
  function setEnabled(on) {
    enabled = !!on;
    stage.classList.toggle('calm', !enabled);
    if (!enabled) {
      stage.classList.remove('st-sleep', 'st-think');
      sleeping = false;
      if (oneShot) { stage.classList.remove(`do-${oneShot}`); oneShot = null; }
      stage.style.setProperty('--lx', '0px');
      stage.style.setProperty('--ly', '0px');
    }
  }

  // One breath every ~16 s while awake, one snore every ~20 s while asleep: short one-shot CSS animations
  // instead of infinite ones, and nothing at all while the window is hidden or animations are off (H1).
  const BREATH_EVERY = 16000;
  const SNORE_EVERY = 20000;
  function idleLoop() {
    setTimeout(() => {
      if (enabled && !lowPower && !document.hidden && !oneShot && !pressed) {
        const cls = sleeping ? 'snore' : 'breath';
        stage.classList.add(cls);
        setTimeout(() => stage.classList.remove(cls), sleeping ? 5200 : 4000);
      }
      idleLoop();
    }, sleeping ? SNORE_EVERY : BREATH_EVERY);
  }
  idleLoop();

  // blinking: every 2.5–6 s, sometimes twice
  function blinkLoop() {
    setTimeout(() => {
      if (!sleeping && !document.hidden) {
        stage.classList.add('blink');
        setTimeout(() => stage.classList.remove('blink'), 140);
        if (Math.random() < 0.2) setTimeout(() => { stage.classList.add('blink'); setTimeout(() => stage.classList.remove('blink'), 140); }, 320);
      }
      blinkLoop();
    }, 2500 + Math.random() * 3500);
  }
  blinkLoop();

  window.buddy.onReact(({ type }) => {
    if (type === 'wave') wave();
    else if (type === 'happy') play('happy');
    else if (type === 'levelup') play('levelup');
    else if (type === 'wow') { if (Date.now() - lastWow > WOW_COOLDOWN) { lastWow = Date.now(); play('wow'); } }
    else if (type === 'yawn') play('yawn');
    else if (type === 'think-on') think(true);
    else if (type === 'think-off') think(false);
    else if (type === 'sleep') sleep();
    else if (type === 'wake') wake(false);
  });
  window.buddy.onLook(look);
  window.buddy.onConfig((c) => {
    setEnabled(c.animations);
    lowPower = !!c.lowPower;   // power saver: short reactions stay, endless effects stop
    stage.classList.toggle('lowfx', lowPower);
    if (c.look) window.BuddyLook.apply(el, c.look, stage);
  });

  // ------------------------------------------------ petting: stroke the buddy with the mouse (no click)
  // A few back-and-forth moves over it within ~1.5 s count as petting: it giggles and a heart floats up.
  // Only while awake and with animations on; a gentle cooldown keeps hearts from piling up.
  const PET_WINDOW = 1500;
  const PET_TURNS = 3;            // direction changes needed
  const PET_COOLDOWN = 1200;
  let petDir = 0;
  let petLastX = null;
  let petTurns = [];
  let lastPet = 0;
  const heart = document.querySelector('.pet-heart');
  function pet() {
    lastPet = Date.now();
    petTurns = [];
    play('giggle');
    heart.classList.remove('show');
    void heart.getBoundingClientRect();   // restart the float animation
    heart.classList.add('show');
  }
  el.addEventListener('pointermove', (e) => {
    if (pressed || !enabled || sleeping) return;
    const x = e.clientX;   // the window doesn't move while you pet it (dragging is excluded above)
    if (petLastX === null) { petLastX = x; return; }
    const dx = x - petLastX;
    if (Math.abs(dx) < 3) return;          // ignore tiny jitter
    petLastX = x;
    const dir = Math.sign(dx);
    if (petDir && dir !== petDir) {
      const t = Date.now();
      petTurns = petTurns.filter((at) => t - at < PET_WINDOW);
      petTurns.push(t);
      if (petTurns.length >= PET_TURNS && t - lastPet > PET_COOLDOWN) pet();
    }
    petDir = dir;
  });
  el.addEventListener('pointerleave', () => { petLastX = null; petDir = 0; });
  heart.addEventListener('animationend', () => heart.classList.remove('show'));

  el.addEventListener('pointerenter', () => {
    if (pressed) return;
    if (sleeping) wake(true);
    else if (Date.now() - lastWave > WAVE_COOLDOWN) wave();
  });

  // ------------------------------------------------ move / click
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (sleeping) wake(true);
    pressed = true;
    startX = e.screenX;
    startY = e.screenY;
    el.setPointerCapture(e.pointerId);
    el.classList.add('pressed');
    window.buddy.dragStart();
  });

  el.addEventListener('pointermove', (e) => {
    if (!pressed) return;
    if (Math.hypot(e.screenX - startX, e.screenY - startY) >= 4) {
      el.classList.remove('pressed');
      stage.classList.add('dragging');
    }
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; window.buddy.dragMove(); });
  });

  const end = () => {
    if (!pressed) return;
    pressed = false;
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
    el.classList.remove('pressed');
    stage.classList.remove('dragging');
    window.buddy.dragMove(); // the last position, before saving
    window.buddy.dragEnd();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.buddy.contextMenu();
  });

  // Portfolio: a red dot while recording
  let lastMarks = 0;
  window.buddy.onRecorder((st) => {
    const on = !!(st && st.recording && st.recording.status !== 'stopping');
    // a new mark: the buddy "blinks" briefly, as a sign it was noted
    const marks = on ? st.recording.marks || 0 : 0;
    if (marks > lastMarks) { el.classList.remove('marked'); void el.offsetWidth; el.classList.add('marked'); setTimeout(() => el.classList.remove('marked'), 700); }
    lastMarks = marks;
    el.classList.toggle('recording', on);
    stage.classList.toggle('rec-on', on);
    el.setAttribute('aria-label', on ? `Recording: ${st.recording.label}. Click to open the window.` : 'Desktop Buddy: click to open the window, drag to move, right-click for shortcuts');
  });

  // the flag (only visible while recording): one click marks the moment; the buddy's "marked" pop confirms it
  document.getElementById('markFlag').addEventListener('click', () => window.buddy.mark());

  window.buddy.ready();
})();
