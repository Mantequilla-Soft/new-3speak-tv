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
  if (!file || !(file.type || '').startsWith('video/')) {
    throw new Error('Not a video file');
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const duration = await getDurationFromUrl(objectUrl);
    if (!isFinite(duration) || duration <= 0) {
      throw new Error('Invalid video duration');
    }
    const stamps = pickStamps(duration, count);
    const out = [];
    for (const t of stamps) {
      try {
        const b64 = await captureFrame(objectUrl, t);
        if (b64) out.push(b64);
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

/** Even spread, biased ~5% off both ends so we don't catch a black frame. */
function pickStamps(duration, count) {
  const stamps = [];
  const safe = Math.max(0, duration - 0.1);
  for (let i = 0; i < count; i++) {
    const t = (duration * (i + 0.5)) / count;
    stamps.push(Math.min(safe, Math.max(0.1, t)));
  }
  return stamps;
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
        const b64 = canvas.toDataURL('image/jpeg', 0.85);
        finish(b64, false);
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

/** A base64 data URL (what generateVideoThumbnails returns) as a Blob for upload. */
export function dataUrlToBlob(dataUrl) {
  const [head, data] = String(dataUrl).split(',');
  const mime = head.split(';')[0].split(':')[1] || 'image/jpeg';
  const bytes = atob(data);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}
