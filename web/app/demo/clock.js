'use strict';
// The taskbar clock of the fake desktop.
(function () {
  const el = document.getElementById('clock');
  const tick = () => { el.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 15000);
})();
