// Reading single frames' worth of data out of an MP4/MOV without loading the
// file: only its index (ftyp + moov) and the samples from the keyframe before a
// moment up to it. Shared by softwareFrame.js (decode in the browser) and
// serverFrame.js (send that stretch to our API to decode). Loaded on demand,
// so mp4box stays out of the main bundle.
import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';

/** Top-level boxes: [{ type, start, size }], from their 8/16-byte headers only. */
async function topLevelBoxes(file) {
  const boxes = [];
  let pos = 0;
  while (pos + 8 <= file.size && boxes.length < 100) {
    const view = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
    let size = view.getUint32(0);
    const type = String.fromCharCode(view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7));
    let header = 8;
    if (size === 1) {
      size = Number(view.getBigUint64(8));
      header = 16;
    } else if (size === 0) {
      size = file.size - pos;
    }
    if (size < header) break;
    boxes.push({ type, start: pos, size });
    pos += size;
  }
  return boxes;
}

/** Clockwise display rotation (0/90/180/270) from a track's matrix. */
function trackRotation(matrix) {
  if (!matrix) return 0;
  const deg = (Math.atan2(matrix[1], matrix[0]) * 180) / Math.PI;
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

/**
 * The video track of `file` and where the frame at `timeSec` (as a <video>
 * counts time) is: { track, trak, samples, ki, ti, rotation }. `ki` is the
 * keyframe to start decoding from and `ti` the target, both in decode order.
 */
export async function locateFrame(file, timeSec) {
  const boxes = await topLevelBoxes(file);
  const moov = boxes.find((b) => b.type === 'moov');
  if (!moov) throw new Error('no moov (not an MP4/MOV, or fragmented)');
  const ftyp = boxes.find((b) => b.type === 'ftyp');
  // Fed as one stream with moov right after ftyp: the sample offsets inside
  // moov stay absolute positions in the real file, which is where we read.
  const parts = [ftyp, moov].filter(Boolean).map((b) => file.slice(b.start, b.start + b.size));
  const ab = await new Blob(parts).arrayBuffer();
  const mp4 = createFile();
  let info = null;
  let failure = null;
  mp4.onReady = (i) => { info = i; };
  mp4.onError = (e) => { failure = e; };
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, 0));
  mp4.flush();
  if (!info) throw new Error(`index not readable${failure ? `: ${failure}` : ''}`);

  const track = info.videoTracks?.[0];
  if (!track) throw new Error('no video track');
  const trak = mp4.getTrackById(track.id);
  const samples = trak?.samples || [];
  if (!samples.length) throw new Error('no samples');

  // An edit list's start offset moves media time 0 to that point.
  const mediaStart = Math.max(0, trak.edts?.elst?.entries?.[0]?.media_time || 0);
  const target = mediaStart + timeSec * track.timescale;
  // The frame on screen at the target (presentation order), then back in
  // decode order to the keyframe it needs. The target's own references always
  // precede it in decode order.
  let ti = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].cts <= target && samples[i].cts >= samples[ti].cts) ti = i;
  }
  let ki = ti;
  while (ki > 0 && !samples[ki].is_sync) ki -= 1;
  return { track, trak, samples, ki, ti, rotation: trackRotation(track.matrix) };
}

/** The decoder's codec description (avcC / hvcC / vpcC / av1C box body). */
export function codecDescription(trak) {
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer, 8); // without the box header
    }
  }
  return undefined;
}

/** A sample's bytes, read from the file. */
export async function readSample(file, s) {
  return new Uint8Array(await file.slice(s.offset, s.offset + s.size).arrayBuffer());
}

const START_CODE = new Uint8Array([0, 0, 0, 1]);

/**
 * Samples ki..ti of an H.264 / HEVC track as a raw "Annex B" stream (what
 * ffmpeg reads with -f h264 / -f hevc): the parameter sets first, then every
 * NAL unit behind a start code instead of its length prefix.
 * Returns { codec: 'h264' | 'hevc', bytes }.
 */
export async function annexBStream(file, { trak, samples, ki, ti }) {
  let config = null;
  let codec = null;
  let paramSets = [];
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    if (entry.avcC) {
      codec = 'h264';
      config = entry.avcC;
      paramSets = [...(config.SPS || []), ...(config.PPS || [])].map((n) => n.data);
      break;
    }
    if (entry.hvcC) {
      codec = 'hevc';
      config = entry.hvcC;
      paramSets = (config.nalu_arrays || []).flatMap((arr) => Array.from(arr).map((n) => n.data));
      break;
    }
  }
  if (!codec) throw new Error('not H.264 or HEVC');
  const lengthSize = (config.lengthSizeMinusOne ?? 3) + 1;

  const parts = [];
  for (const ps of paramSets) parts.push(START_CODE, ps);
  for (let i = ki; i <= ti; i += 1) {
    const data = await readSample(file, samples[i]);
    let p = 0;
    while (p + lengthSize <= data.length) {
      let len = 0;
      for (let k = 0; k < lengthSize; k += 1) len = len * 256 + data[p + k];
      p += lengthSize;
      if (len <= 0 || p + len > data.length) break;
      parts.push(START_CODE, data.subarray(p, p + len));
      p += len;
    }
  }
  const total = parts.reduce((n, a) => n + a.length, 0);
  const bytes = new Uint8Array(total);
  let o = 0;
  for (const a of parts) { bytes.set(a, o); o += a.length; }
  return { codec, bytes };
}
