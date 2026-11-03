// Draws a thumbnail from a picture + an edit (editState.js). The preview canvas
// and the exported image both come from renderThumbnail(), at the same output
// size, so what the preview shows is what gets uploaded. Only the preview adds
// guides (selection outline, centre lines), and only when asked.
import { cssFont, fontFor, loadFont } from './fonts';
import { MAX_ZOOM, MIN_ZOOM, TEXT_DEFAULTS } from './editState';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where the picture lands: scaled to cover width × height, times `zoom`, with
 * the frame's centre point kept far enough in that no empty edge shows.
 */
export function frameRect(image, frame, width, height) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const zoom = clamp(frame.zoom || 1, MIN_ZOOM, MAX_ZOOM);
  const scale = Math.max(width / iw, height / ih) * zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const { x, y } = clampFramePoint(frame, dw, dh, width, height);
  return { dx: width / 2 - x * dw, dy: height / 2 - y * dh, dw, dh, x, y };
}

function clampFramePoint(frame, dw, dh, width, height) {
  const hx = width / 2 / dw;
  const hy = height / 2 / dh;
  return {
    x: hx >= 0.5 ? 0.5 : clamp(frame.x ?? 0.5, hx, 1 - hx),
    y: hy >= 0.5 ? 0.5 : clamp(frame.y ?? 0.5, hy, 1 - hy),
  };
}

/** The frame with its centre pulled back inside the picture (after a zoom out or pan). */
export function clampFrame(frame, image, width, height) {
  if (!image) return frame;
  const { x, y } = frameRect(image, frame, width, height);
  return { ...frame, x, y };
}

// ── Layers ───────────────────────────────────────────────────────────────────
// Each draws itself and returns its box ({ x, y, w, h } in output pixels), which
// the preview uses to pick a layer up under the pointer.

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawText(ctx, saved, width, height) {
  // Layers saved before a setting existed get its default.
  const layer = { ...TEXT_DEFAULTS, ...saved };
  const lines = String(layer.text || '').split('\n');
  if (!lines.some((l) => l.trim())) return null;
  const px = (layer.size / 100) * height;
  const lineHeight = px * 1.15;
  ctx.font = cssFont(fontFor(layer.font), px);
  ctx.textAlign = layer.align;

  // Centred on the letters actually drawn, not on the font's em box: fonts
  // place their glyphs differently inside it ('middle' left some with more room
  // below than above, which showed as uneven box padding). Baselines are
  // lineHeight apart; the block runs from the tallest letter of the first line
  // to the lowest of the last.
  ctx.textBaseline = 'alphabetic';
  const metrics = lines.map((line) => ctx.measureText(line));
  const ascent = Math.max(0, ...metrics.map((m) => m.actualBoundingBoxAscent || 0)) || px * 0.7;
  const descent = Math.max(0, ...metrics.map((m) => m.actualBoundingBoxDescent || 0));
  const ax = layer.x * width;
  const blockH = ascent + descent + lineHeight * (lines.length - 1);
  const top = layer.y * height - blockH / 2;
  const lineY = (i) => top + ascent + lineHeight * i;
  const w = Math.max(...metrics.map((m) => m.width));
  const left = layer.align === 'left' ? ax : layer.align === 'right' ? ax - w : ax - w / 2;
  let box = { x: left, y: top, w, h: blockH };

  // The box behind the text (drawn first), with its own border.
  if (layer.box) {
    const pad = (layer.boxPadding / 100) * px;
    const r = { x: left - pad, y: top - pad, w: w + pad * 2, h: blockH + pad * 2 };
    const radius = (layer.boxRadius / 100) * px;
    roundedRect(ctx, r.x, r.y, r.w, r.h, radius);
    ctx.save();
    ctx.globalAlpha = layer.boxOpacity / 100;
    ctx.fillStyle = layer.boxColor;
    ctx.fill();
    ctx.restore();
    const bw = (layer.boxBorder / 100) * px;
    if (bw > 0) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = layer.boxBorderColor;
      ctx.stroke();
    }
    box = { x: r.x - bw / 2, y: r.y - bw / 2, w: r.w + bw, h: r.h + bw };
  }

  // A stroke is centred on the glyph edge, so twice the width shows the full
  // border outside once the fill covers the inner half. All borders go first,
  // so a thick one never cuts into the line above.
  const border = layer.border ? (layer.borderSize / 100) * px : 0;
  if (border) {
    ctx.lineWidth = border * 2;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = layer.borderColor;
    lines.forEach((line, i) => ctx.strokeText(line, ax, lineY(i)));
  }

  ctx.fillStyle = layer.color;
  lines.forEach((line, i) => ctx.fillText(line, ax, lineY(i)));

  const tx = { x: left - border, y: top - border, w: w + border * 2, h: blockH + border * 2 };
  const x0 = Math.min(box.x, tx.x);
  const y0 = Math.min(box.y, tx.y);
  return {
    x: x0,
    y: y0,
    w: Math.max(box.x + box.w, tx.x + tx.w) - x0,
    h: Math.max(box.y + box.h, tx.y + tx.h) - y0,
  };
}

// Sticker pictures, once loaded (see loadSticker); drawing is synchronous.
const stickerImages = new Map();

function drawSticker(ctx, layer, width, height) {
  const img = stickerImages.get(layer.url);
  if (!img) return null;
  const iw = img.naturalWidth || 1;
  const ih = img.naturalHeight || 1;
  const scale = ((layer.size / 100) * height) / Math.max(iw, ih);
  const w = iw * scale;
  const h = ih * scale;
  const cx = layer.x * width;
  const cy = layer.y * height;
  const a = ((layer.rotation || 0) * Math.PI) / 180;
  ctx.translate(cx, cy);
  ctx.rotate(a);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  // The turned picture's upright bounding box.
  const bw = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
  const bh = Math.abs(w * Math.sin(a)) + Math.abs(h * Math.cos(a));
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}

export const LAYER_RENDERERS = {
  text: drawText,
  sticker: drawSticker,
};

const stickerLoads = new Map();

/**
 * Loads a sticker picture for drawing. They come from the editor's sticker
 * host, so CORS mode: without it the canvas would be "tainted" and refuse to
 * export (the host sends Access-Control-Allow-Origin: *).
 */
export function loadSticker(url) {
  if (!stickerLoads.has(url)) {
    stickerLoads.set(url, new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => { stickerImages.set(url, img); resolve(img); };
      img.onerror = () => { stickerLoads.delete(url); reject(new Error('Sticker failed to load')); };
      img.src = url;
    }));
  }
  return stickerLoads.get(url);
}

/** Everything the layers draw with (fonts, sticker pictures), loaded. */
export function loadLayerAssets(layers) {
  return Promise.all(layers.map((l) => {
    if (l.type === 'text') return loadFont(l.font, l.text);
    if (l.type === 'sticker') return loadSticker(l.url).catch(() => {});
    return null;
  }));
}

// ── Whole thumbnail ─────────────────────────────────────────────────────────

/**
 * @param guides  preview only: { selectedId, snapX, snapY }
 * @returns       { [layerId]: box } for hit-testing
 */
export function renderThumbnail(ctx, { image, edit, width, height, guides = null }) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  if (image) {
    const { dx, dy, dw, dh } = frameRect(image, edit.frame, width, height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, dx, dy, dw, dh);
  }

  const boxes = {};
  for (const layer of edit.layers) {
    const draw = LAYER_RENDERERS[layer.type];
    if (!draw) continue;
    ctx.save();
    const box = draw(ctx, layer, width, height);
    ctx.restore();
    if (box) boxes[layer.id] = box;
  }

  if (guides) drawGuides(ctx, guides, boxes, width, height);
  ctx.restore();
  return boxes;
}

function drawGuides(ctx, { selectedId, snapX, snapY }, boxes, width, height) {
  const line = Math.max(2, Math.round(height / 360));
  ctx.lineWidth = line;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.setLineDash([line * 5, line * 4]);
  ctx.beginPath();
  if (snapX) { ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); }
  if (snapY) { ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); }
  ctx.stroke();

  const box = selectedId && boxes[selectedId];
  if (box) {
    const pad = line * 4;
    // Dark under light, so the outline shows on any picture.
    ctx.setLineDash([line * 4, line * 3]);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = line * 2;
    ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = line;
    ctx.strokeRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
  }
}

/** The finished thumbnail as a JPEG: { blob, dataUrl }. */
export async function exportThumbnail({ image, edit, width, height }) {
  await loadLayerAssets(edit.layers);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  renderThumbnail(canvas.getContext('2d'), { image, edit, width, height });
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  return { blob, dataUrl };
}

// ── Pictures ────────────────────────────────────────────────────────────────

const imageCache = new Map();

/** Decoded <img> for a data URL / URL, cached (the options are re-selected often). */
export function loadImage(src) {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => { imageCache.delete(src); reject(new Error('Image failed to load')); };
      img.src = src;
    }));
    // Keep only the recent few: data URLs of full frames are large.
    if (imageCache.size > 12) imageCache.delete(imageCache.keys().next().value);
  }
  return imageCache.get(src);
}
