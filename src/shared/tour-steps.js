'use strict';
// The first-run tour (F1): its steps and a tiny state machine. Pure (page + tests).
// Text parts: a string, or { b: 'text' } for a bold part (rendered with textContent, never HTML).
(function (root) {
  const STEPS = [
    {
      id: 'hello', tab: null, target: 'buddy',
      title: "Hi! I'm Buddy 👋",
      text: ['I always stay here, in the corner of your screen. ', { b: 'Click me' }, ' to open me, and again to close me. ',
        { b: 'Drag me' }, ' with the mouse to move me. ', { b: 'Right-click me' }, ' for shortcuts: a picture of the screen, a quick note.'],
    },
    {
      id: 'copied', tab: 'clipboard', target: '#tab-clipboard',
      title: 'Everything you copy stays here',
      text: ['When you copy some text (Ctrl+C), I keep it here. ', { b: 'Click a row' }, ' and I copy it again, ready to paste.'],
    },
    {
      id: 'notes', tab: 'notes', target: '#noteNew',
      title: 'Notes that save themselves',
      text: ['Press ', { b: '+ New note' }, " and write. You don't need to save anything. Inside a note, ", { b: '🔔 Remind me' }, " lets me tell you at the time you pick."],
    },
    {
      id: 'pictures', tab: 'pictures', target: '#picArea',
      title: 'Pictures of your screen',
      text: ['Press ', { b: 'Picture of an area' }, ' and drag a box. A small card pops up: press ', { b: 'Draw on it' },
        ' to add an arrow, then ', { b: 'Copy to send' }, ' and paste it in a chat.'],
    },
    {
      id: 'video', tab: 'video', target: '#recStart',
      title: 'Record a window',
      text: ['Pick a window and I record it (no sound). ', { b: "Don't minimize it" }, ' while I record. To stop, click me and press ',
        { b: 'Stop and save' }, '. Then ', { b: 'Cut a clip' }, ' keeps just the good part.'],
    },
    {
      id: 'time', tab: 'session', target: '#tab-session',
      title: 'Count your work time',
      text: ['Write what you work on and press ', { b: 'Start' }, '. Using the timer helps me grow and unlocks new looks for me. Pick them in ',
        { b: 'Settings → Change how the buddy looks' }, '.'],
    },
    {
      // r2 F-L3: the ring sits on "More settings" (simple mode); in full mode it falls back to the Settings tab
      id: 'done', tab: 'settings', target: '.set-menu > .more-toggle',
      title: 'All set! 🎉',
      text: ['I hid the trickier buttons to keep things simple. You can always find them under ', { b: 'More' },
        '. You can see this tour again in ', { b: 'Settings → Help' }, '.'],
      textFull: ['Everything is shown right now. Turn on ', { b: 'Simple mode' }, ' in Settings to hide the trickier buttons. You can see this tour again in ',
        { b: 'Settings → Help' }, '.'],
    },
  ];

  const start = () => ({ i: 0, open: true });
  const clamp = (i) => Math.max(0, Math.min(STEPS.length - 1, i));
  /** Next step; past the last one the tour is finished (open: false, done: true). */
  function next(st) {
    if (!st || !st.open) return st;
    if (st.i >= STEPS.length - 1) return { i: st.i, open: false, done: true, finished: true };
    return { i: st.i + 1, open: true };
  }
  function back(st) { return st && st.open ? { i: clamp(st.i - 1), open: true } : st; }
  /** Closing midway also counts as done (it must not come back at every start). */
  function close(st) { return { i: st ? st.i : 0, open: false, done: true, finished: false }; }
  const step = (st) => STEPS[clamp(st ? st.i : 0)];
  const counter = (st) => `${clamp(st.i) + 1} of ${STEPS.length}`;
  const isFirst = (st) => clamp(st.i) === 0;
  const isLast = (st) => clamp(st.i) === STEPS.length - 1;
  /** The text of a step for the current mode (the last step differs in full mode). */
  const textOf = (s, mode) => (mode === 'full' && s.textFull ? s.textFull : s.text);
  const plainText = (parts) => parts.map((p) => (typeof p === 'string' ? p : p.b)).join('');

  const api = { STEPS, start, next, back, close, step, counter, isFirst, isLast, textOf, plainText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TourSteps = api;
})(typeof window !== 'undefined' ? window : globalThis);
