// One frame of an MP4/MOV, decoded from the file itself with WebCodecs set to
// software decoding. For browsers whose <video> frames can't be read back
// (2D canvas black, WebGL a flat colour, VideoFrame "format null") but that do
// have a VideoDecoder: a software decoder hands its frames over in normal
// memory. (Firefox for Android has no VideoDecoder: serverFrame.js covers it.)
import { codecDescription, locateFrame, readSample } from './mp4Index';
import { videoFrameToCanvas } from './videoFrameImage';

async function pickConfig(base) {
  for (const hardwareAcceleration of ['prefer-software', 'no-preference']) {
    const config = { ...base, hardwareAcceleration };
    try {
      const { supported } = await window.VideoDecoder.isConfigSupported(config);
      if (supported) return config;
    } catch { /* try the next */ }
  }
  throw new Error(`codec ${base.codec} not decodable here`);
}

/**
 * The frame shown at `timeSec` (as a <video> counts time) as a canvas.
 * Throws with a short reason when it can't (no WebCodecs, not MP4, codec, ...).
 */
export async function decodeFrameFromFile(file, timeSec) {
  if (typeof window.VideoDecoder !== 'function') throw new Error('no VideoDecoder');
  const { track, trak, samples, ki, ti, rotation } = await locateFrame(file, timeSec);
  const wantTs = Math.round((samples[ti].cts * 1e6) / track.timescale);

  const config = await pickConfig({
    codec: track.codec,
    codedWidth: track.video?.width || track.track_width,
    codedHeight: track.video?.height || track.track_height,
    description: codecDescription(trak),
    optimizeForLatency: true,
  });

  let picked = null;
  let decodeError = null;
  const decoder = new window.VideoDecoder({
    output: (frame) => {
      if (!picked && frame.timestamp === wantTs) picked = frame;
      else frame.close();
    },
    error: (e) => { decodeError = e; },
  });
  try {
    decoder.configure(config);
    for (let i = ki; i <= ti; i += 1) {
      const s = samples[i];
      decoder.decode(new window.EncodedVideoChunk({
        type: i === ki ? 'key' : 'delta',
        timestamp: Math.round((s.cts * 1e6) / track.timescale),
        duration: Math.round((s.duration * 1e6) / track.timescale),
        data: await readSample(file, s),
      }));
    }
    await decoder.flush();
    if (decodeError) throw decodeError;
    if (!picked) throw new Error('frame not decoded');
    return await videoFrameToCanvas(picked, rotation);
  } finally {
    picked?.close();
    if (decoder.state !== 'closed') decoder.close();
  }
}
