import { hiveProxy, hiveProxyRefuses, squareCover } from '../../utils/fixThumbnails';

// The cover designer draws on a canvas and exports it, which a picture from
// another site only allows when that site sends CORS headers. So the picture is
// read into a data URL first: straight from its host when it allows that, else
// through our own /img/ cache (same origin), square already.

export const BLANK_COVER_COLOR = '#202124';

const readAsDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('Could not read the picture'));
  reader.readAsDataURL(blob);
});

async function fetchImage(url) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`picture ${res.status}`);
  const blob = await res.blob();
  if (!String(blob.type || '').startsWith('image/')) throw new Error('not a picture');
  return readAsDataUrl(blob);
}

/** Where to try reading `src` from, in order. */
export function coverImageCandidates(src) {
  const url = String(src || '').trim();
  if (!url) return [];
  if (/^(data|blob):/i.test(url)) return [url];
  if (!/^https?:\/\//i.test(url)) return [url]; // a path on this site
  const viaCache = /^https?:\/\/images\.3speak\.tv\//i.test(url)
    ? squareCover(url, 512)
    : hiveProxyRefuses(url) ? null : hiveProxy(url, { w: 1080, h: 1080 });
  return viaCache && viaCache !== url ? [url, viaCache] : [url];
}

/** A data URL (or blob/data URL as given) of `src` the canvas can export, or a rejection. */
export async function toEditableImage(src) {
  const candidates = coverImageCandidates(src);
  if (candidates.length === 1 && /^(data|blob):/i.test(candidates[0])) return candidates[0];
  let lastError = new Error('no picture');
  for (const url of candidates) {
    try {
      return await fetchImage(url);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** A plain square to design a cover from scratch on (text and stickers only). */
export function blankCover(size = 1080, color = BLANK_COVER_COLOR) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  return canvas.toDataURL('image/png');
}
