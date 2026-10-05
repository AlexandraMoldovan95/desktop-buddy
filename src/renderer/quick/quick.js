'use strict';
// Quick note (1.8.0). Enter = save as a new note; Shift+Enter = new line; Esc = cancel (the text is lost).
// Clicking elsewhere with text written saves it (so you don't lose what you typed by mistake).
(function () {
  const text = document.getElementById('qText');
  const done = document.getElementById('qDone');
  let busy = false;

  function reset() {
    text.value = '';
    done.hidden = true;
    busy = false;
    text.focus();
  }

  async function save(closeAfter = true) {
    if (busy) return;
    if (!text.value.trim()) { window.quick.close(); return; }
    busy = true;
    try {
      await window.quick.save(text.value);
      text.value = '';
      done.hidden = false;
      if (closeAfter) setTimeout(() => { window.quick.close(); reset(); }, 500);
      else reset();
    } catch {
      busy = false;   // the text stays: you can try again
    }
  }

  text.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); text.value = ''; window.quick.close(); reset(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); save(); }
  });
  document.getElementById('qSave').addEventListener('click', () => save());
  window.addEventListener('blur', () => { if (text.value.trim()) save(); else window.quick.close(); });
  window.quick.onShown(reset);
  reset();
})();
