'use strict';
// Draws the annotations on a canvas (1.11.0). The same function draws on screen (with the selection and handles)
// and the saved picture (without them), so what you see is exactly what gets saved.
(function (root) {
  const A = root.Annot;
  const FONT = '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif';
  const font = (size, weight = 600) => `${weight} ${size}px ${FONT}`;

  // ------------------------------------------------ the items
  function strokePath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) { ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); return; }
    // curves through segment midpoints: a hand-drawn line comes out smooth
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const l = pts[pts.length - 1];
    ctx.lineTo(l[0], l[1]);
  }

  function arrowHead(ctx, it) {
    const ang = Math.atan2(it.y2 - it.y1, it.x2 - it.x1);
    const len = Math.max(12, it.width * 3.6);
    const half = Math.max(7, it.width * 2.1);
    const bx = it.x2 - Math.cos(ang) * len;
    const by = it.y2 - Math.sin(ang) * len;
    ctx.beginPath();
    ctx.moveTo(it.x2, it.y2);
    ctx.lineTo(bx + Math.sin(ang) * half, by - Math.cos(ang) * half);
    ctx.lineTo(bx - Math.sin(ang) * half, by + Math.cos(ang) * half);
    ctx.closePath();
    ctx.fill();
    return { bx, by };
  }

  function roundRectPath(ctx, x, y, w, h, r, tail) {
    // outline clockwise; the tail is inserted on its edge
    const t = (edge) => tail && tail.edge === edge;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    if (t('top')) { ctx.lineTo(tail.a.x, tail.a.y); ctx.lineTo(tail.tip.x, tail.tip.y); ctx.lineTo(tail.b.x, tail.b.y); }
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    if (t('right')) { ctx.lineTo(tail.a.x, tail.a.y); ctx.lineTo(tail.tip.x, tail.tip.y); ctx.lineTo(tail.b.x, tail.b.y); }
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    if (t('bottom')) { ctx.lineTo(tail.a.x, tail.a.y); ctx.lineTo(tail.tip.x, tail.tip.y); ctx.lineTo(tail.b.x, tail.b.y); }
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    if (t('left')) { ctx.lineTo(tail.a.x, tail.a.y); ctx.lineTo(tail.tip.x, tail.tip.y); ctx.lineTo(tail.b.x, tail.b.y); }
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  /** The text in a box (bubble / note): lines wrapped by width; the box grows down as needed. */
  function boxText(ctx, it, color, hideText) {
    ctx.font = font(it.size, 500);
    const p = A.pad(it);
    const lines = A.wrapLines(it.text || '', Math.max(10, it.w - 2 * p), (s) => ctx.measureText(s).width);
    const need = lines.length * A.lineH(it) + 2 * p;
    if (need > it.h) it.h = need;   // the grown height is saved too
    if (hideText) return;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, it.x + p, it.y + p + i * A.lineH(it) + it.size * 0.12));
  }

  function pixelate(ctx, img, it, cache) {
    const x = Math.max(0, Math.floor(it.x));
    const y = Math.max(0, Math.floor(it.y));
    const w = Math.min(img.width - x, Math.ceil(it.w + it.x - x));
    const h = Math.min(img.height - y, Math.ceil(it.h + it.y - y));
    if (w < 1 || h < 1) return;
    const block = A.pixelBlock(w, h);
    const sw = Math.max(1, Math.ceil(w / block));
    const sh = Math.max(1, Math.ceil(h / block));
    const small = cache.small || (cache.small = document.createElement('canvas'));
    small.width = sw;
    small.height = sh;
    const s = small.getContext('2d');
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = 'high';
    s.drawImage(img, x, y, w, h, 0, 0, sw, sh);   // from the original picture, not from what is drawn over it
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, sw, sh, x, y, sw * block, sh * block);
    ctx.restore();
    // pixels outside the box (the last block can stick out) are clipped
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + w, y, sw * block, sh * block);
    ctx.rect(x, y + h, sw * block, sh * block);
    ctx.clip();
    ctx.drawImage(img, x + w, y, sw * block, sh * block, x + w, y, sw * block, sh * block);
    ctx.drawImage(img, x, y + h, sw * block, sh * block, x, y + h, sw * block, sh * block);
    ctx.restore();
  }

  function drawItem(ctx, it, n, opts) {
    const editing = opts.editingId === it.id;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = it.color;
    ctx.fillStyle = it.color;
    switch (it.type) {
      case 'pen':
        ctx.lineWidth = it.width;
        strokePath(ctx, it.points);
        ctx.stroke();
        break;
      case 'marker':
        // like a highlighter: transparent, and the text underneath stays dark
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = 0.45;
        ctx.lineCap = 'square';
        ctx.lineWidth = it.width;
        strokePath(ctx, it.points);
        ctx.stroke();
        break;
      case 'line':
        ctx.lineWidth = it.width;
        ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(it.x2, it.y2); ctx.stroke();
        break;
      case 'arrow': {
        const { bx, by } = arrowHead(ctx, it);
        ctx.lineWidth = it.width;
        ctx.beginPath(); ctx.moveTo(it.x1, it.y1); ctx.lineTo(bx, by); ctx.stroke();
        break;
      }
      case 'rect':
        ctx.lineWidth = it.width;
        ctx.strokeRect(it.x, it.y, it.w, it.h);
        break;
      case 'ellipse':
        ctx.lineWidth = it.width;
        ctx.beginPath();
        ctx.ellipse(it.x + it.w / 2, it.y + it.h / 2, Math.max(0.5, it.w / 2), Math.max(0.5, it.h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'text': {
        ctx.font = font(it.size, 650);
        ctx.textBaseline = 'top';
        const lines = it.text.split('\n');
        it.w = Math.max(...lines.map((l) => ctx.measureText(l).width), it.size * 0.5);
        it.h = lines.length * A.lineH(it);
        if (editing) break;
        // outline in the opposite color: the text reads on any background
        ctx.lineWidth = Math.max(2, it.size / 7);
        ctx.strokeStyle = A.contrastOn(it.color);
        lines.forEach((l, i) => ctx.strokeText(l, it.x, it.y + i * A.lineH(it)));
        lines.forEach((l, i) => ctx.fillText(l, it.x, it.y + i * A.lineH(it)));
        break;
      }
      case 'bubble': {
        boxText(ctx, it, A.INK, true);   // the height first
        const g = A.bubbleGeometry(it);
        roundRectPath(ctx, it.x, it.y, it.w, it.h, g.r, g.tail);
        ctx.shadowColor = 'rgba(0,0,0,.22)';
        ctx.shadowBlur = it.size * 0.5;
        ctx.shadowOffsetY = it.size * 0.12;
        ctx.fillStyle = '#FFFFFF';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = Math.max(2, it.size / 7);
        ctx.stroke();
        boxText(ctx, it, A.INK, editing);
        break;
      }
      case 'note': {
        boxText(ctx, it, A.INK, true);
        ctx.shadowColor = 'rgba(0,0,0,.25)';
        ctx.shadowBlur = it.size * 0.6;
        ctx.shadowOffsetY = it.size * 0.18;
        ctx.fillStyle = A.noteFill(it.color);
        const fold = Math.min(it.size * 1.1, it.w / 4, it.h / 4);
        ctx.beginPath();
        ctx.moveTo(it.x, it.y);
        ctx.lineTo(it.x + it.w, it.y);
        ctx.lineTo(it.x + it.w, it.y + it.h - fold);
        ctx.lineTo(it.x + it.w - fold, it.y + it.h);
        ctx.lineTo(it.x, it.y + it.h);
        ctx.closePath();
        ctx.fill();
        ctx.shadowColor = 'transparent';
        // a folded corner and a darker band on top, like a sticky note
        ctx.fillStyle = 'rgba(0,0,0,.12)';
        ctx.beginPath();
        ctx.moveTo(it.x + it.w, it.y + it.h - fold);
        ctx.lineTo(it.x + it.w - fold, it.y + it.h - fold);
        ctx.lineTo(it.x + it.w - fold, it.y + it.h);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,.06)';
        ctx.fillRect(it.x, it.y, it.w, Math.min(it.size * 0.5, it.h / 5));
        boxText(ctx, it, A.INK, editing);
        break;
      }
      case 'step': {
        ctx.beginPath();
        ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
        ctx.shadowColor = 'rgba(0,0,0,.25)';
        ctx.shadowBlur = it.r * 0.35;
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.lineWidth = Math.max(1.5, it.r / 7);
        ctx.strokeStyle = it.color === '#FFFFFF' ? A.INK : '#FFFFFF';
        ctx.stroke();
        ctx.fillStyle = A.contrastOn(it.color);
        ctx.font = font(it.r * (n > 9 ? 1 : 1.15), 750);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(n), it.x, it.y + it.r * 0.06);
        break;
      }
      default: break;
    }
    ctx.restore();
  }

  // ------------------------------------------------ the selection (on screen only)
  function drawSelection(ctx, it, zoom) {
    const px = 1 / zoom;   // one screen pixel, in picture pixels
    const b = A.boundsOf(it);
    ctx.save();
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.strokeStyle = '#7A3FE0';
    ctx.strokeRect(b.x - 4 * px, b.y - 4 * px, b.w + 8 * px, b.h + 8 * px);
    ctx.setLineDash([]);
    for (const hd of A.handlesOf(it)) {
      ctx.beginPath();
      if (hd.key === 'tail') ctx.arc(hd.x, hd.y, 6 * px, 0, Math.PI * 2);
      else ctx.rect(hd.x - 5 * px, hd.y - 5 * px, 10 * px, 10 * px);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 2 * px;
      ctx.strokeStyle = '#7A3FE0';
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCropShade(ctx, crop, W, H, zoom, showHandles) {
    ctx.save();
    ctx.fillStyle = 'rgba(12, 8, 24, .58)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.rect(crop.x, crop.y, crop.w, crop.h);
    ctx.fill('evenodd');
    const px = 1 / zoom;
    ctx.lineWidth = 2 * px;
    ctx.strokeStyle = '#FFFFFF';
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeRect(crop.x, crop.y, crop.w, crop.h);
    ctx.setLineDash([]);
    if (showHandles) {
      for (const [x, y] of [[crop.x, crop.y], [crop.x + crop.w, crop.y], [crop.x, crop.y + crop.h], [crop.x + crop.w, crop.y + crop.h]]) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px);
        ctx.strokeStyle = '#7A3FE0';
        ctx.strokeRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px);
      }
    }
    ctx.restore();
  }

  /**
   * Draws the picture + annotations on a canvas the size of the picture.
   * opts: { selectedId, editingId, zoom, showCrop, cropHandles, draft } (draft = the item being drawn right now)
   */
  function drawDoc(ctx, doc, img, opts = {}) {
    const W = img.width;
    const H = img.height;
    const cache = drawDoc.cache || (drawDoc.cache = {});
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);
    const items = opts.draft ? [...doc.items, opts.draft] : doc.items;
    // blurs first: they pixelate the picture, not the annotations on top of it
    for (const it of items) if (it.type === 'blur') pixelate(ctx, img, it, cache);
    const nums = A.stepNumbers(items);
    for (const it of items) if (it.type !== 'blur') drawItem(ctx, it, nums.get(it.id), opts);
    if (opts.showCrop && doc.crop) drawCropShade(ctx, doc.crop, W, H, opts.zoom || 1, opts.cropHandles);
    const sel = opts.selectedId && items.find((i) => i.id === opts.selectedId);
    if (sel) {
      if (sel.type === 'blur') {   // the blur's edge, so you can see it when selected
        ctx.save(); ctx.strokeStyle = 'rgba(122,63,224,.6)'; ctx.lineWidth = 1 / (opts.zoom || 1); ctx.strokeRect(sel.x, sel.y, sel.w, sel.h); ctx.restore();
      }
      drawSelection(ctx, sel, opts.zoom || 1);
    }
  }

  /** The final picture (annotated, cropped) as a PNG. @returns {Promise<ArrayBuffer>} */
  function renderPng(doc, img) {
    const full = document.createElement('canvas');
    full.width = img.width;
    full.height = img.height;
    drawDoc(full.getContext('2d'), doc, img, {});
    let out = full;
    if (doc.crop) {
      out = document.createElement('canvas');
      out.width = doc.crop.w;
      out.height = doc.crop.h;
      out.getContext('2d').drawImage(full, doc.crop.x, doc.crop.y, doc.crop.w, doc.crop.h, 0, 0, doc.crop.w, doc.crop.h);
    }
    return new Promise((resolve, reject) => out.toBlob((b) => (b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('The picture couldn\'t be created.'))), 'image/png'));
  }

  root.AnnotRender = { drawDoc, renderPng, font };
})(window);
