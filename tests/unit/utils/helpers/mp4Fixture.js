// Builds tiny but real MP4 files in memory, for the tests of mp4Index.js and the
// two frame decoders built on it. Only the boxes mp4box needs to read a video
// track's index are written: ftyp, mdat (the samples) and moov with one H.264
// track (tkhd, an optional edit list, mdhd, hdlr, vmhd, dref and a sample table).
//
// Each sample's bytes are length-prefixed NAL units, as they are in a real file,
// so the Annex B conversion can be checked byte for byte.

const ascii = (s) => [...s].map((c) => c.charCodeAt(0))
const u8 = (n) => [n & 0xff]
const u16 = (n) => [(n >>> 8) & 0xff, n & 0xff]
const u32 = (n) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const zeros = (n) => new Array(n).fill(0)

/** A plain box: 32-bit size, four-letter type, payload. */
export function box(type, ...payload) {
  const body = payload.flat(Infinity)
  return [...u32(8 + body.length), ...ascii(type), ...body]
}

/** A full box: a plain box whose payload starts with version + flags. */
const fullBox = (type, version, flags, ...payload) => box(type, u8(version), u8(flags >> 16), u16(flags & 0xffff), ...payload)

/** The 3x3 display matrix for a clockwise rotation (16.16 / 2.30 fixed point). */
export function rotationMatrix(deg) {
  const one = 0x10000
  const [a, b, c, d] = {
    0: [one, 0, 0, one],
    90: [0, one, -one, 0],
    180: [-one, 0, 0, -one],
    270: [0, -one, one, 0],
  }[deg]
  return [a, b, 0, c, d, 0, 0, 0, 0x40000000]
}

/** One length-prefixed sample made of the given NAL units (4-byte lengths). */
export function lengthPrefixed(nalus, lengthSize = 4) {
  const out = []
  for (const n of nalus) {
    const len = n.length
    for (let k = lengthSize - 1; k >= 0; k -= 1) out.push((len >>> (8 * k)) & 0xff)
    out.push(...n)
  }
  return out
}

/** The file-type box every fixture starts with. */
export const FTYP = box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('avc1'))

export const SPS = [0x67, 0x42, 0xc0, 0x1e, 0xda, 0x01]
export const PPS = [0x68, 0xce, 0x3c, 0x80]

/**
 * An MP4 as a Blob plus the facts the tests check against.
 *
 * @param {object} o
 * @param {number[][]} o.samples   each sample's bytes (already length-prefixed)
 * @param {number[]}  [o.sync]     indexes (0-based) of keyframes; default only the first
 * @param {number[]}  [o.ctsOffsets] composition offsets per sample (ctts); none by default
 * @param {number}    [o.timescale] media timescale (default 1000)
 * @param {number}    [o.delta]     sample duration in timescale units (default 100)
 * @param {number}    [o.rotation]  0 / 90 / 180 / 270
 * @param {number}    [o.mediaTime] edit list start (elst media_time); no edts when undefined
 * @param {boolean}   [o.moovFirst] put moov before mdat ("fast start"); default after
 * @param {boolean}   [o.withFtyp]  default true
 * @param {'plain'|'large'|'toEnd'} [o.mdatHeader] how the mdat states its size:
 *   a 32-bit size, the 64-bit "largesize" form (size field 1), or 0 for "runs to
 *   the end of the file" (only valid when mdat is the last box, so with moovFirst)
 */
export function buildMp4({
  samples,
  sync = [0],
  ctsOffsets,
  timescale = 1000,
  delta = 100,
  rotation = 0,
  mediaTime,
  moovFirst = false,
  withFtyp = true,
  width = 320,
  height = 240,
  mdatHeader = 'plain',
} = {}) {
  const ftyp = withFtyp ? FTYP : []
  const mdatPayload = samples.flat()
  const mdatHeaderBytes = {
    plain: [...u32(8 + mdatPayload.length), ...ascii('mdat')],
    large: [...u32(1), ...ascii('mdat'), ...u32(0), ...u32(16 + mdatPayload.length)],
    toEnd: [...u32(0), ...ascii('mdat')],
  }[mdatHeader]
  const mdat = [...mdatHeaderBytes, ...mdatPayload]
  const duration = samples.length * delta

  const moovFor = (chunkOffset) => {
    const matrix = rotationMatrix(rotation).map(u32)
    const mvhd = fullBox('mvhd', 0, 0,
      u32(0), u32(0), u32(timescale), u32(duration),
      u32(0x10000), u16(0x100), zeros(10), matrix, zeros(24), u32(2))
    const tkhd = fullBox('tkhd', 0, 3,
      u32(0), u32(0), u32(1), u32(0), u32(duration), zeros(8),
      u16(0), u16(0), u16(0), u16(0), matrix, u32(width << 16), u32(height << 16))
    const edts = mediaTime === undefined ? [] : box('edts',
      fullBox('elst', 0, 0, u32(1), u32(duration), u32(mediaTime), u16(1), u16(0)))
    const mdhd = fullBox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0))
    const hdlr = fullBox('hdlr', 0, 0, u32(0), ascii('vide'), zeros(12), ascii('V'), u8(0))
    const vmhd = fullBox('vmhd', 0, 1, u16(0), zeros(6))
    const dinf = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, 1)))
    const avcC = box('avcC',
      u8(1), u8(SPS[1]), u8(SPS[2]), u8(SPS[3]), u8(0xff),
      u8(0xe1), u16(SPS.length), SPS,
      u8(1), u16(PPS.length), PPS)
    const avc1 = box('avc1',
      zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(width), u16(height),
      u32(0x480000), u32(0x480000), u32(0), u16(1), zeros(32), u16(0x18), u16(0xffff), avcC)
    const stsd = fullBox('stsd', 0, 0, u32(1), avc1)
    const stts = fullBox('stts', 0, 0, u32(1), u32(samples.length), u32(delta))
    const ctts = ctsOffsets
      ? fullBox('ctts', 0, 0, u32(ctsOffsets.length), ctsOffsets.map((o) => [u32(1), u32(o)]))
      : []
    const stss = fullBox('stss', 0, 0, u32(sync.length), sync.map((i) => u32(i + 1)))
    const stsc = fullBox('stsc', 0, 0, u32(1), u32(1), u32(samples.length), u32(1))
    const stsz = fullBox('stsz', 0, 0, u32(0), u32(samples.length), samples.map((s) => u32(s.length)))
    const stco = fullBox('stco', 0, 0, u32(1), u32(chunkOffset))
    const stbl = box('stbl', stsd, stts, ctts, stss, stsc, stsz, stco)
    const minf = box('minf', vmhd, dinf, stbl)
    const mdia = box('mdia', mdhd, hdlr, minf)
    const trak = box('trak', tkhd, edts, mdia)
    return box('moov', mvhd, trak)
  }

  let bytes
  let sampleStart
  if (moovFirst) {
    // The moov size does not depend on the offset value, so build it twice.
    const probe = moovFor(0)
    sampleStart = ftyp.length + probe.length + mdatHeaderBytes.length
    bytes = [...ftyp, ...moovFor(sampleStart), ...mdat]
  } else {
    sampleStart = ftyp.length + mdatHeaderBytes.length
    bytes = [...ftyp, ...mdat, ...moovFor(sampleStart)]
  }
  const file = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
  return { file, bytes: new Uint8Array(bytes), sampleStart }
}
