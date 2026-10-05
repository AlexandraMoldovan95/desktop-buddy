'use strict';
// One frame from the chosen window, at its real size (1.8.0). The main process provides the source through
// setDisplayMediaRequestHandler (the "shot" session) and calls grab() with executeJavaScript(…, true).
(function () {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // the window is hidden: requestVideoFrameCallback never fires (nothing is painted), so we wait for video data
  const hasData = (v) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      if (v.readyState >= 2 && v.videoWidth > 0) return resolve();
      if (Date.now() - t0 > 5000) return reject(new Error('The window sent no image.'));
      setTimeout(poll, 50);
    })();
  });

  async function grab() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false });
    try {
      const v = document.createElement('video');
      v.muted = true;
      v.srcObject = stream;
      v.play().catch(() => {});
      await hasData(v);
      await wait(250);      // the first frame can be empty on some systems
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      if (!c.width || !c.height) throw new Error('The window sent no image.');
      c.getContext('2d').drawImage(v, 0, 0);
      return c.toDataURL('image/png');
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  window.shotGrab = { grab };
})();
