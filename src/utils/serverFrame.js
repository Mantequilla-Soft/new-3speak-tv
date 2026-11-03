// One frame of an MP4/MOV, decoded by our API. The last resort for browsers
// that can't read video frames at all and have no VideoDecoder (Firefox for
// Android): only the stretch of compressed video the frame needs is sent (the
// keyframe before the moment up to it, usually 1-5 MB), as a raw H.264 / HEVC
// stream that ffmpeg decodes (server/thumbnail-frame.cjs). The rotation phone
// videos carry is applied here, from the file's index.
import { annexBStream, locateFrame } from './mp4Index';
import { drawTurned } from './videoFrameImage';
import { EMBED_API_KEY } from './config';

const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';
// Same limit as the server's; a longer stretch (a keyframe every 10 s of 4K)
// is not worth sending for one picture.
const MAX_BYTES = 40 * 1024 * 1024;

/** The frame shown at `timeSec` (as a <video> counts time) as a canvas. */
export async function serverFrameFromFile(file, timeSec) {
  const loc = await locateFrame(file, timeSec);
  const { samples, ki, ti, rotation } = loc;
  // ffmpeg hands out the decoded frames in display order. Which one is ours:
  // its place among them, leaving out pictures shown before the keyframe (an
  // open GOP's leading pictures), which a decoder starting at the keyframe drops.
  const keyCts = samples[ki].cts;
  const shown = samples.slice(ki, ti + 1).map((s) => s.cts).filter((c) => c >= keyCts).sort((a, b) => a - b);
  const index = shown.indexOf(samples[ti].cts);
  if (index < 0) throw new Error('frame not in range');

  const { codec, bytes } = await annexBStream(file, loc);
  if (bytes.length > MAX_BYTES) throw new Error(`stretch too big (${Math.round(bytes.length / 1048576)} MB)`);

  const res = await fetch(`${THREESPEAK_API}/thumbnail-frame?codec=${codec}&index=${index}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-API-Key': EMBED_API_KEY },
    body: bytes,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`server ${res.status}${err.error ? ` ${err.error}` : ''}`);
  }
  const bitmap = await createImageBitmap(await res.blob());
  try {
    return drawTurned(bitmap, bitmap.width, bitmap.height, rotation);
  } finally {
    bitmap.close?.();
  }
}
