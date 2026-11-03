/**
 * Mobile-safe replacement for `@rajesh896/video-thumbnails-generator`.
 *
 * The upstream library creates a <video> element, sets crossOrigin="Anonymous",
 * seeks, and draws to canvas — but never sets `muted` / `playsInline` and
 * never primes the decoder. iOS Safari (and several Android Chromium builds)
 * will not decode frames inline under those conditions, so videoWidth /
 * videoHeight stay 0 and drawImage produces a black/empty frame.
 *
 * This implementation:
 *   - sets `muted`, `playsInline`, and the matching attributes BEFORE assigning src
 *   - briefly play()/pause()s after loadedmetadata to kick the decode pipeline
 *   - waits for the `seeked` event before draw
 *   - times out instead of hanging forever if the device refuses
 *
 * Signature is drop-in compatible with the third-party export:
 *   generateVideoThumbnails(file, count, 'url') → Promise<string[]>
 * Returned strings are base64 JPEG data URLs.
 */
export async function generateVideoThumbnails(file, count = 2 /* , type ignored */) {
  return generateVideoThumbnailsAt(file, evenSpread(count));
}

/**
 * The frames the upload wizard offers on its thumbnail step: the start, then a
 * quarter, half and three quarters into the video, in that order.
 */
export const THUMBNAIL_FRAME_POINTS = [0, 0.25, 0.5, 0.75];

// A frame whose average brightness (0-255) is below this reads as black.
const DARK_LUMA = 18;
// Where to look instead when the opening frame is black (a fade-in, a black
// leader): the first of these, in seconds, that shows something.
const OPENING_RETRIES_SEC = [1, 2.5];

/**
 * A phone or tablet (not a narrow desktop window or a touch laptop). Frames
 * grabbed in mobile browsers come out black or garbled (Firefox for Android
 * can't read video frames back at all), so the upload wizard doesn't generate
 * any there: the creator picks a frame in the thumbnail editor, which asks our
 * API for it (utils/frameCapture.js), or uploads an image. Same flow on every
 * mobile device.
 */
export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile === true) return true;
  const ua = navigator.userAgent || '';
  // Android tablets drop "Mobile" from the UA; iPads ask for desktop sites
  // and say "Macintosh", but no Mac has a touch screen.
  if (/iPhone|iPod|iPad|Android|Mobi/i.test(ua)) return true;
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
}

/**
 * One JPEG data URL per point, each point a fraction of the duration (0..1).
 * Point 0 is "the start": if the opening frame is black, a frame a moment later
 * is taken instead, so the first option is never an empty black card.
 * Mobile devices get none (see isMobileDevice); callers handle an empty list.
 */
export async function generateVideoThumbnailsAt(file, points = THUMBNAIL_FRAME_POINTS) {
  if (isMobileDevice()) return [];
  if (!file || !(file.type || '').startsWith('video/')) {
    throw new Error('Not a video file');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const duration = await getDurationFromUrl(objectUrl);
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Invalid video duration');
    }
    const safe = Math.max(0, duration - 0.1);
    const out = [];
    for (const point of points) {
      try {
        let frame = await captureFrame(objectUrl, Math.min(safe, Math.max(0.1, duration * point)));
        if (point === 0) {
          for (const sec of OPENING_RETRIES_SEC) {
            if (frame.luma >= DARK_LUMA || sec >= duration * 0.25) break;
            try {
              const later = await captureFrame(objectUrl, sec);
              if (later.luma > frame.luma) frame = later;
            } catch { /* keep the dark one */ }
          }
        }
        out.push(frame.dataUrl);
      } catch {
        // skip individual failed frames; try the rest
      }
    }
    if (out.length === 0) throw new Error('Failed to extract any frames');
    return out;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** One frame at `time` seconds as a JPEG data URL, by the same mobile-safe path. */
export async function captureFrameAt(file, time) {
  const objectUrl = URL.createObjectURL(file);
  try {
    return (await captureFrame(objectUrl, Math.max(0.05, time))).dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Even spread as fractions, centred in equal slices so neither end is hit. */
function evenSpread(count) {
  return Array.from({ length: count }, (_, i) => (i + 0.5) / count);
}

function getDurationFromUrl(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.preload = 'metadata';
    const cleanup = () => { v.removeAttribute('src'); v.load(); };
    v.addEventListener('loadedmetadata', () => {
      const d = v.duration;
      cleanup();
      resolve(d);
    }, { once: true });
    v.addEventListener('error', () => {
      cleanup();
      reject(new Error('Failed to read video metadata'));
    }, { once: true });
    v.src = src;
  });
}

/** Resolves { dataUrl, luma } for the frame at `time` seconds. */
function captureFrame(src, time) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');

    // Order matters: iOS latches some of these at load time.
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';

    // iOS Safari and Firefox Android both refuse to put rendered frames in
    // a buffer that drawImage can read unless the <video> is in the DOM AND
    // is actually being composited. Position fixed at -9999px is treated as
    // "not visible" by Firefox's compositor, which skips painting the video
    // entirely — drawImage then reads black pixels. Keep it 1×1 in-viewport
    // with near-zero opacity so the compositor paints it for real.
    v.style.position = 'fixed';
    v.style.left = '0';
    v.style.top = '0';
    v.style.width = '1px';
    v.style.height = '1px';
    v.style.opacity = '0.001';
    v.style.pointerEvents = 'none';
    v.style.zIndex = '-9999';
    document.body.appendChild(v);

    let done = false;
    const cleanup = () => {
      done = true;
      try { v.pause(); } catch { /* ignore */ }
      v.removeAttribute('src');
      try { v.load(); } catch { /* ignore */ }
      try { v.parentNode && v.parentNode.removeChild(v); } catch { /* ignore */ }
      clearTimeout(timeoutId);
    };

    const finish = (resOrErr, isError) => {
      if (done) return;
      cleanup();
      if (isError) reject(resOrErr); else resolve(resOrErr);
    };

    const timeoutId = setTimeout(
      () => finish(new Error('Thumbnail capture timed out'), true),
      10000,
    );

    v.addEventListener('error', () => finish(new Error('Video element error'), true), { once: true });

    const drawAndFinish = () => {
      try {
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) { finish(new Error('Video dimensions unavailable'), true); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(v, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        finish({ dataUrl, luma: averageLuma(v) }, false);
      } catch (e) {
        finish(e, true);
      }
    };

    // Once the video is past the seek point AND actually painting frames
    // (i.e. play() has produced output), capture and bail. requestVideoFrameCallback
    // is the right hook for "frame is presentable" on iOS 15.4+ and Chromium.
    // Firefox doesn't implement it — fall back to two rAF ticks after play.
    const captureNextFrame = () => {
      if (typeof v.requestVideoFrameCallback === 'function') {
        v.requestVideoFrameCallback(() => drawAndFinish());
      } else {
        requestAnimationFrame(() => requestAnimationFrame(() => drawAndFinish()));
      }
    };

    v.addEventListener('seeked', async () => {
      // The play→capture path is what actually works across mobile browsers.
      // For a *paused* off-screen video, Firefox Android and pre-15.4 iOS
      // never copy the decoded frame into a buffer drawImage can read,
      // so the canvas comes out black. Playing for one frame fixes that;
      // the cleanup pauses immediately afterwards.
      const start = async () => {
        try { await v.play(); } catch { /* autoplay denied — draw anyway */ }
        // play() resolves when the request is accepted, but on Firefox
        // Android the compositor may not have rendered the first frame yet.
        // Wait for `playing` if it hasn't already fired, THEN capture.
        if (v.paused) {
          v.addEventListener('playing', captureNextFrame, { once: true });
          // Safety: if `playing` never fires, still try to capture.
          setTimeout(captureNextFrame, 600);
        } else {
          captureNextFrame();
        }
      };
      start();
    }, { once: true });

    // `canplay` fires once the browser believes it can play the media; at
    // this point seeking is reliable. Using `loadeddata` instead works on
    // iOS but is sometimes too early on Firefox Android.
    v.addEventListener('canplay', () => {
      try {
        const target = Math.min(Math.max(0.05, time), Math.max(0.05, v.duration - 0.05));
        if (Math.abs(v.currentTime - target) < 0.01) {
          v.currentTime = Math.min(target + 0.05, v.duration - 0.01);
        } else {
          v.currentTime = target;
        }
      } catch (e) {
        finish(e, true);
      }
    }, { once: true });

    v.src = src;
    v.load();
  });
}

/** Average brightness (0-255) of a frame, read from a tiny downscaled copy. */
function averageLuma(source) {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 9;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, 16, 9);
    const px = ctx.getImageData(0, 0, 16, 9).data;
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    return sum / (px.length / 4);
  } catch {
    return 255; // unreadable: treat as fine rather than retry
  }
}

/** A base64 data URL (what generateVideoThumbnails returns) as a Blob for upload. */
export function dataUrlToBlob(dataUrl) {
  const [head, data] = String(dataUrl).split(',');
  const mime = head.split(';')[0].split(':')[1] || 'image/jpeg';
  const bytes = atob(data);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}
