// mp4Index (src/utils/mp4Index.js): finding the frame shown at a moment in an
// MP4/MOV from its index alone, the display rotation phone videos carry, and
// turning the samples a frame needs into a raw H.264 / HEVC stream. The files
// are tiny real MP4s built byte by byte (helpers/mp4Fixture.js) and parsed by
// the real mp4box, so the tests cover the same path a user's upload takes.
import { describe, it, expect } from 'vitest'
import { buildMp4, lengthPrefixed, box, FTYP, SPS, PPS } from './helpers/mp4Fixture.js'
import { locateFrame, codecDescription, readSample, annexBStream } from '../../../src/utils/mp4Index.js'

const START = [0, 0, 0, 1]

// Six samples at 10 fps (timescale 1000, 100 per frame), keyframes at 0 and 3.
// Sample i carries two NAL units: [0x65, i] and [0x06, 0xee, i].
const sixFrames = (extra = {}) => buildMp4({
  samples: [0, 1, 2, 3, 4, 5].map((i) => lengthPrefixed([[0x65, i], [0x06, 0xee, i]])),
  sync: [0, 3],
  ...extra,
})

describe('locateFrame', () => {
  it.each([
    [0, 0, 0],
    [0.05, 0, 0],
    [0.1, 1, 0],
    [0.25, 2, 0],
    [0.3, 3, 3],
    [0.49, 4, 3],
  ])('at %ss the frame on screen is sample %i, decoded from keyframe %i', async (time, ti, ki) => {
    const { file } = sixFrames()
    const loc = await locateFrame(file, time)
    expect(loc.ti).toBe(ti)
    expect(loc.ki).toBe(ki)
  })

  it('stops at the last frame for a moment past the end', async () => {
    const { file } = sixFrames()
    const loc = await locateFrame(file, 99)
    expect(loc.ti).toBe(5)
    expect(loc.ki).toBe(3)
  })

  it('picks the frame by presentation time when B-frames reorder decoding', async () => {
    // Decode order I P B B, shown as I B B P: cts 100, 400, 200, 300.
    const { file } = buildMp4({
      samples: [0, 1, 2, 3].map((i) => lengthPrefixed([[0x41, i]])),
      ctsOffsets: [100, 300, 0, 0],
    })
    // At 0.25 s (250) the latest frame shown is the first B (cts 200, decode index 2),
    // not the P frame that decodes before it.
    const loc = await locateFrame(file, 0.25)
    expect(loc.samples.map((s) => s.cts)).toEqual([100, 400, 200, 300])
    expect(loc.ti).toBe(2)
    expect(loc.ki).toBe(0)
  })

  it('applies the edit list start, so 0 s is the first frame the edit shows', async () => {
    // Same reordered file with an edit list starting media time at 100 (the usual
    // B-frame delay): 0 s is the frame with cts 100, 0.1 s the one with cts 200.
    const reordered = (mediaTime) => buildMp4({
      samples: [0, 1, 2, 3].map((i) => lengthPrefixed([[0x41, i]])),
      ctsOffsets: [100, 300, 0, 0],
      mediaTime,
    }).file
    expect((await locateFrame(reordered(100), 0)).ti).toBe(0)
    expect((await locateFrame(reordered(100), 0.1)).ti).toBe(2)
    // Without the edit list, 0.1 s is still the first frame (cts 100).
    expect((await locateFrame(reordered(undefined), 0.1)).ti).toBe(0)
  })

  it('treats a negative edit list start (an empty edit) as no offset', async () => {
    const { file } = sixFrames({ mediaTime: 0xffffffff }) // media_time -1
    expect((await locateFrame(file, 0.2)).ti).toBe(2)
  })

  it.each([0, 90, 180, 270])('reads a %i degree display rotation from the track matrix', async (deg) => {
    const { file } = sixFrames({ rotation: deg })
    expect((await locateFrame(file, 0)).rotation).toBe(deg)
  })

  it('reports the track, its timescale and codec, and sample offsets into the real file', async () => {
    const { file, bytes, sampleStart } = sixFrames()
    const loc = await locateFrame(file, 0)
    expect(loc.track.codec).toBe('avc1.42c01e')
    expect(loc.track.timescale).toBe(1000)
    expect(loc.samples).toHaveLength(6)
    expect(loc.samples[0].offset).toBe(sampleStart)
    // The first sample's first NAL unit sits right after its 4-byte length.
    expect([...bytes.subarray(sampleStart + 4, sampleStart + 6)]).toEqual([0x65, 0])
  })

  it.each([
    ['moov after mdat', { moovFirst: false }],
    ['moov before mdat (fast start)', { moovFirst: true }],
    ['a 64-bit mdat size', { mdatHeader: 'large' }],
    ['an mdat that runs to the end of the file', { moovFirst: true, mdatHeader: 'toEnd' }],
  ])('finds the index with %s', async (_label, layout) => {
    const { file, sampleStart } = sixFrames(layout)
    const loc = await locateFrame(file, 0.3)
    expect(loc.ti).toBe(3)
    expect(loc.samples[0].offset).toBe(sampleStart)
    expect([...(await readSample(file, loc.samples[3]))]).toEqual(lengthPrefixed([[0x65, 3], [0x06, 0xee, 3]]))
  })

  it.each([
    ['a file with no moov (a WebM, or a fragmented MP4)', new Blob([new Uint8Array([...FTYP, ...box('mdat', [1, 2, 3])])])],
    ['an empty file', new Blob([])],
    ['a box whose size is smaller than its header', new Blob([new Uint8Array([0, 0, 0, 4, 0x6d, 0x6f, 0x6f, 0x76])])],
  ])('refuses %s with "no moov"', async (_label, file) => {
    await expect(locateFrame(file, 0)).rejects.toThrow(/no moov/)
  })

  it('refuses a moov cut short by a truncated file', async () => {
    const { bytes } = sixFrames()
    const cut = new Blob([bytes.subarray(0, bytes.length - 20)])
    await expect(locateFrame(cut, 0)).rejects.toThrow(/index not readable/)
  })

  it('refuses a track with no samples', async () => {
    const { file } = buildMp4({ samples: [], sync: [] })
    await expect(locateFrame(file, 0)).rejects.toThrow('no samples')
  })

  // BUG: locateFrame deliberately feeds mp4box only [ftyp, moov].filter(Boolean),
  // i.e. it means to read files without an ftyp (older QuickTime .mov files start
  // with "wide"/"mdat"/"moov"). mp4box 2.5 then throws a raw TypeError
  // ("Cannot read properties of undefined (reading 'major_brand')") from
  // appendBuffer, so such a file can never be located. src/utils/mp4Index.js:48-56.
  it('BUG: locates a frame in a QuickTime file that has no ftyp box', async () => {
    const { file } = sixFrames({ withFtyp: false })
    expect((await locateFrame(file, 0.3)).ti).toBe(3)
  })
})

describe('codecDescription', () => {
  it('is the avcC body without its 8-byte box header', async () => {
    const { file } = sixFrames()
    const { trak } = await locateFrame(file, 0)
    expect([...codecDescription(trak)]).toEqual([
      1, SPS[1], SPS[2], SPS[3], 0xff,
      0xe1, 0, SPS.length, ...SPS,
      1, 0, PPS.length, ...PPS,
    ])
  })

  it('is undefined for a sample entry with no decoder configuration', () => {
    const trak = { mdia: { minf: { stbl: { stsd: { entries: [{ type: 'mp4v' }] } } } } }
    expect(codecDescription(trak)).toBeUndefined()
  })
})

describe('annexBStream', () => {
  it('turns H.264 samples into parameter sets plus start-coded NAL units', async () => {
    const { file } = sixFrames()
    const loc = await locateFrame(file, 0.25) // keyframe 0 .. target 2
    const { codec, bytes } = await annexBStream(file, loc)
    expect(codec).toBe('h264')
    expect([...bytes]).toEqual([
      ...START, ...SPS,
      ...START, ...PPS,
      ...[0, 1, 2].flatMap((i) => [...START, 0x65, i, ...START, 0x06, 0xee, i]),
    ])
  })

  it('only includes the samples from the keyframe up to the target', async () => {
    const { file } = sixFrames()
    const loc = await locateFrame(file, 0.4) // keyframe 3 .. target 4
    const { bytes } = await annexBStream(file, loc)
    expect([...bytes.subarray(-13)]).toEqual([
      ...START, 0x65, 4, ...START, 0x06, 0xee, 4,
    ])
    // Two parameter sets, then two samples of two NAL units.
    const startCodes = [...bytes].filter((_b, i) => bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1)
    expect(startCodes).toHaveLength(6)
  })

  // A hand-made track: the conversion only reads the sample entry and the samples.
  const fakeTrack = (entry, sampleBytes) => {
    const file = new Blob([new Uint8Array(sampleBytes.flat())])
    let offset = 0
    const samples = sampleBytes.map((b) => {
      const s = { offset, size: b.length }
      offset += b.length
      return s
    })
    const trak = { mdia: { minf: { stbl: { stsd: { entries: [entry] } } } } }
    return { file, loc: { trak, samples, ki: 0, ti: samples.length - 1 } }
  }

  it('reads HEVC parameter sets from every NAL array and honours a 2-byte length size', async () => {
    const entry = {
      hvcC: {
        lengthSizeMinusOne: 1,
        nalu_arrays: [
          [{ data: new Uint8Array([0x40, 1]) }], // VPS
          [{ data: new Uint8Array([0x42, 2]) }], // SPS
          [{ data: new Uint8Array([0x44, 3]) }], // PPS
        ],
      },
    }
    const { file, loc } = fakeTrack(entry, [lengthPrefixed([[0x26, 0x01, 0xaa]], 2)])
    const { codec, bytes } = await annexBStream(file, loc)
    expect(codec).toBe('hevc')
    expect([...bytes]).toEqual([
      ...START, 0x40, 1, ...START, 0x42, 2, ...START, 0x44, 3,
      ...START, 0x26, 0x01, 0xaa,
    ])
  })

  it('assumes 4-byte lengths when the configuration does not say', async () => {
    const { file, loc } = fakeTrack({ avcC: { SPS: [], PPS: [] } }, [lengthPrefixed([[9, 9]])])
    const { bytes } = await annexBStream(file, loc)
    expect([...bytes]).toEqual([...START, 9, 9])
  })

  it.each([
    ['a length running past the end of the sample', [0, 0, 0, 9, 1, 2]],
    ['a zero length', [0, 0, 0, 0, 1, 2]],
  ])('stops reading a sample at %s instead of copying garbage', async (_label, broken) => {
    const good = lengthPrefixed([[7, 7]])
    const { file, loc } = fakeTrack({ avcC: { lengthSizeMinusOne: 3 } }, [[...good, ...broken], lengthPrefixed([[8]])])
    const { bytes } = await annexBStream(file, loc)
    expect([...bytes]).toEqual([...START, 7, 7, ...START, 8])
  })

  it('refuses codecs other than H.264 and HEVC', async () => {
    const { file, loc } = fakeTrack({ vpcC: {} }, [[1, 2, 3]])
    await expect(annexBStream(file, loc)).rejects.toThrow('not H.264 or HEVC')
  })
})
