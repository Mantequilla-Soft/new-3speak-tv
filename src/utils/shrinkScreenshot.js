// Turns a picked or pasted image into a JPEG data URL small enough for the
// checker's POST /reviews. It refuses a screenshot over 750 kB, because the whole
// review (base64 is a third bigger) must stay under nginx's 1 MB body limit. A
// phone screenshot is often 3 to 8 MB as a PNG; scaled to 1920 px on its long
// edge as a JPEG it is usually 200 to 500 kB, and the text on it stays readable.

export const SCREENSHOT_MAX_BYTES = 700 * 1024; // a margin under the checker's 750 kB
const MAX_INPUT_BYTES = 40 * 1024 * 1024;              // larger than any real screenshot
// Tried in order until one fits: long edge in px, JPEG quality.
const STEPS = [[1920, 0.85], [1600, 0.75], [1280, 0.7], [1024, 0.6]];

export class ScreenshotError extends Error {
  constructor(code) { super(code); this.code = code; } // 'unreadable' | 'tooBig'
}

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

const toDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/** File/Blob → 'data:image/jpeg;base64,…'. Throws ScreenshotError. */
export async function shrinkScreenshot(file) {
  if (!file || !/^image\//.test(file.type || '')) throw new ScreenshotError('unreadable');
  if (file.size > MAX_INPUT_BYTES) throw new ScreenshotError('tooBig');

  let img;
  try { img = await decode(file); } catch { throw new ScreenshotError('unreadable'); }
  const w = img.width || img.naturalWidth;
  const h = img.height || img.naturalHeight;
  if (!w || !h) throw new ScreenshotError('unreadable');

  try {
    for (const [edge, quality] of STEPS) {
      const scale = Math.min(1, edge / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new ScreenshotError('unreadable');
      // JPEG has no transparency: a see-through PNG would otherwise turn black.
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await toBlob(canvas, quality);
      if (!blob) throw new ScreenshotError('unreadable');
      if (blob.size <= SCREENSHOT_MAX_BYTES) return toDataUrl(blob);
    }
  } finally {
    img.close?.();
  }
  throw new ScreenshotError('tooBig');
}
