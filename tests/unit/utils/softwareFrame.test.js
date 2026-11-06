// decodeFrameFromFile (src/utils/softwareFrame.js): one frame decoded from the
// file with WebCodecs set to software decoding. The MP4s are tiny real files
// (helpers/mp4Fixture.js) read by the real mp4Index; VideoDecoder and
// EncodedVideoChunk are fakes that record what they are fed and "decode" every
// chunk into a frame with the same timestamp.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildMp4, lengthPrefixed } from './helpers/mp4Fixture.js'

vi.mock('../../../src/utils/videoFrameImage', () => ({
  videoFrameToCanvas: vi.fn(async (frame, rotation) => ({ canvasOf: frame.timestamp, rotation })),
}))

const { decodeFrameFromFile } = await import('../../../src/utils/softwareFrame.js')
const { videoFrameToCanvas } = await import('../../../src/utils/videoFrameImage')

class FakeChunk {
  constructor(init) { Object.assign(this, init) }
}

let decoders
let support
let decoderBehaviour

function installWebCodecs() {
  decoders = []
  support = () => true
  decoderBehaviour = {}
  class FakeDecoder {
    constructor({ output, error }) {
      this.output = output
      this.error = error
      this.state = 'unconfigured'
      this.chunks = []
      this.frames = []
      this.close = vi.fn(() => { this.state = 'closed' })
      decoders.push(this)
    }

    static isConfigSupported = vi.fn(async (config) => ({ supported: support(config), config }))

    configure(config) { this.config = config; this.state = 'configured' }

    decode(chunk) { this.chunks.push(chunk) }

    async flush() {
      if (decoderBehaviour.error) this.error(decoderBehaviour.error)
      if (decoderBehaviour.noOutput) return
      for (const c of this.chunks) {
        const frame = { timestamp: c.timestamp, close: vi.fn() }
        this.frames.push(frame)
        this.output(frame)
      }
      if (decoderBehaviour.closeItself) this.state = 'closed'
    }
  }
  vi.stubGlobal('window', { VideoDecoder: FakeDecoder, EncodedVideoChunk: FakeChunk })
  return FakeDecoder
}

beforeEach(() => { installWebCodecs() })

// Six samples at 10 fps (timescale 1000), keyframes at 0 and 3.
const sixFrames = (extra = {}) => buildMp4({
  samples: [0, 1, 2, 3, 4, 5].map((i) => lengthPrefixed([[0x65, i]])),
  sync: [0, 3],
  ...extra,
}).file

describe('decodeFrameFromFile', () => {
  it('needs WebCodecs', async () => {
    vi.stubGlobal('window', {})
    await expect(decodeFrameFromFile(sixFrames(), 0)).rejects.toThrow('no VideoDecoder')
  })

  it('feeds the keyframe and the delta frames up to the target, in microseconds', async () => {
    const file = sixFrames()
    await decodeFrameFromFile(file, 0.45) // keyframe 3, target 4

    const [decoder] = decoders
    expect(decoder.chunks.map((c) => [c.type, c.timestamp, c.duration])).toEqual([
      ['key', 300000, 100000],
      ['delta', 400000, 100000],
    ])
    // The chunk data is the sample's bytes, read straight from the file.
    expect([...decoder.chunks[1].data]).toEqual(lengthPrefixed([[0x65, 4]]))
  })

  it('configures a software decoder with the track size, codec and avcC description', async () => {
    await decodeFrameFromFile(sixFrames({ width: 640, height: 360 }), 0)
    const { config } = decoders[0]
    expect(config).toMatchObject({
      codec: 'avc1.42c01e',
      codedWidth: 640,
      codedHeight: 360,
      optimizeForLatency: true,
      hardwareAcceleration: 'prefer-software',
    })
    expect(config.description).toBeInstanceOf(Uint8Array)
    expect(config.description[0]).toBe(1) // avcC configurationVersion
  })

  it('falls back to "no-preference" when software decoding is not offered', async () => {
    support = (c) => c.hardwareAcceleration === 'no-preference'
    await decodeFrameFromFile(sixFrames(), 0)
    expect(decoders[0].config.hardwareAcceleration).toBe('no-preference')
  })

  it('tries the next setting when the support check itself throws', async () => {
    window.VideoDecoder.isConfigSupported.mockRejectedValueOnce(new TypeError('bad config'))
    await decodeFrameFromFile(sixFrames(), 0)
    expect(decoders[0].config.hardwareAcceleration).toBe('no-preference')
  })

  it('names the codec when no setting can decode it', async () => {
    support = () => false
    await expect(decodeFrameFromFile(sixFrames(), 0)).rejects.toThrow('codec avc1.42c01e not decodable here')
    expect(decoders).toHaveLength(0)
  })

  it('returns the target frame as a canvas, turned by the track rotation', async () => {
    const out = await decodeFrameFromFile(sixFrames({ rotation: 270 }), 0.2)
    expect(out).toEqual({ canvasOf: 200000, rotation: 270 })
  })

  it('closes every frame it does not keep, then the kept one and the decoder', async () => {
    await decodeFrameFromFile(sixFrames(), 0.2) // frames 0, 1, 2; target 2
    const [decoder] = decoders
    expect(decoder.frames.map((f) => f.close.mock.calls.length)).toEqual([1, 1, 1])
    // The kept frame is closed only after it was copied out.
    expect(videoFrameToCanvas.mock.invocationCallOrder[0])
      .toBeLessThan(decoder.frames[2].close.mock.invocationCallOrder[0])
    expect(decoder.close).toHaveBeenCalledTimes(1)
  })

  it('surfaces a decoder error and still closes the decoder', async () => {
    decoderBehaviour.error = new DOMException('Decoding error', 'EncodingError')
    await expect(decodeFrameFromFile(sixFrames(), 0)).rejects.toThrow('Decoding error')
    expect(decoders[0].close).toHaveBeenCalledTimes(1)
  })

  it('reports a target frame the decoder never produced', async () => {
    decoderBehaviour.noOutput = true
    await expect(decodeFrameFromFile(sixFrames(), 0)).rejects.toThrow('frame not decoded')
    expect(videoFrameToCanvas).not.toHaveBeenCalled()
  })

  it('does not close a decoder that already closed itself', async () => {
    decoderBehaviour.closeItself = true
    await decodeFrameFromFile(sixFrames(), 0)
    expect(decoders[0].close).not.toHaveBeenCalled()
  })

  it('rejects a file that is not an MP4 before creating a decoder', async () => {
    await expect(decodeFrameFromFile(new Blob([new Uint8Array(24)]), 0)).rejects.toThrow(/no moov/)
    expect(decoders).toHaveLength(0)
  })
})
