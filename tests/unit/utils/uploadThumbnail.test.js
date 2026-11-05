// @vitest-environment jsdom
// uploadThumbnail (src/utils/uploadThumbnail.js): a cover upload never hard-fails
// on one outage. First @threespeak's backend (signs server-side), then the
// user-signed images.hive.blog path, then the 3Speak image server. fetch and
// the wallet signature are stubbed; nothing leaves the test.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/utils/config', () => ({
  IMAGE_UPLOAD_URL: 'https://images.example',
  IMAGE_UPLOAD_KEY: 'static-key',
  EMBED_API_KEY: 'embed-key',
}))
vi.mock('../../../src/hive-api/aioha', () => ({
  signMessageWithAioha: vi.fn(async () => ({ result: 'SIG123' })),
  isLoggedIn: vi.fn(() => true),
}))
vi.mock('@aioha/aioha', () => ({ KeyTypes: { Posting: 'posting' } }))

const { uploadThumbnail } = await import('../../../src/utils/uploadThumbnail.js')
const { signMessageWithAioha, isLoggedIn } = await import('../../../src/hive-api/aioha')

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

// Routes by URL so each test only says how each service answers.
let answers
let fetchMock
beforeEach(() => {
  answers = {
    threespeak: () => json(200, { url: 'https://images.hive.blog/DQm/via-threespeak.png' }),
    hive: () => json(200, { url: 'https://images.hive.blog/DQm/user-signed.png' }),
    static: () => json(200, { success: true, url: 'https://images.example/static.png' }),
  }
  fetchMock = vi.fn(async (url) => {
    if (url.endsWith('/upload-image')) return answers.threespeak()
    if (url.startsWith('/hive-image-api/')) return answers.hive()
    if (url.endsWith('/upload')) return answers.static()
    throw new Error(`unexpected ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  isLoggedIn.mockReturnValue(true)
})

const image = () => new File([new Uint8Array([1, 2, 3])], 'cover.png', { type: 'image/png' })
const calledUrls = () => fetchMock.mock.calls.map(([url]) => url)

describe('uploadThumbnail', () => {
  it('uploads through the @threespeak backend first, sending the raw bytes with the API key', async () => {
    const file = image()
    const url = await uploadThumbnail(file, 'alice')

    expect(url).toBe('https://images.hive.blog/DQm/via-threespeak.png')
    expect(calledUrls()).toEqual(['/api/upload-image'])
    const [, init] = fetchMock.mock.calls[0]
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'image/png', 'X-API-Key': 'embed-key' },
      body: file,
    })
  })

  it('labels a file with no type as octet-stream', async () => {
    await uploadThumbnail(new Blob([new Uint8Array([1])]), 'alice')
    expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBe('application/octet-stream')
  })

  it.each([
    ['an error status', () => json(502, { error: 'signer down' })],
    ['a 200 without a URL', () => json(200, {})],
    ['a body that is not JSON', () => ({ ok: false, status: 500, json: async () => { throw new SyntaxError('html') } })],
  ])('falls back to the user-signed hive.blog upload after %s', async (_label, answer) => {
    answers.threespeak = answer
    const url = await uploadThumbnail(image(), 'alice')
    expect(url).toBe('https://images.hive.blog/DQm/user-signed.png')
    expect(calledUrls()).toEqual(['/api/upload-image', '/hive-image-api/alice/SIG123'])
  })

  it('signs the standard ImageSigningChallenge over the image bytes with the posting key', async () => {
    answers.threespeak = () => json(500, {})
    await uploadThumbnail(image(), 'alice')

    const [challenge, keyType] = signMessageWithAioha.mock.calls[0]
    expect(keyType).toBe('posting')
    const expected = Buffer.concat([Buffer.from('ImageSigningChallenge'), Buffer.from([1, 2, 3])])
    expect(challenge).toBe(JSON.stringify(expected))
    // The file itself goes up as multipart "file".
    const body = fetchMock.mock.calls[1][1].body
    expect(body).toBeInstanceOf(FormData)
    expect(body.get('file').name).toBe('cover.png')
  })

  it.each([
    ['no username is given', undefined, {}, true],
    ['the caller prefers the static path', 'alice', { preferStatic: true }, true],
    ['nobody is logged in to sign', 'alice', {}, false],
  ])('skips the user-signed path when %s', async (_label, username, opts, loggedIn) => {
    isLoggedIn.mockReturnValue(loggedIn)
    answers.threespeak = () => json(500, {})
    const url = await uploadThumbnail(image(), username, opts)
    expect(url).toBe('https://images.example/static.png')
    expect(calledUrls()).toEqual(['/api/upload-image', '/image-api/upload'])
    expect(signMessageWithAioha).not.toHaveBeenCalled()
  })

  it.each([
    ['refuses the upload', () => json(401, { error: 'bad signature' })],
    ['answers without a URL', () => json(200, {})],
  ])('falls back to the 3Speak image server when hive.blog %s', async (_label, answer) => {
    answers.threespeak = () => json(500, {})
    answers.hive = answer
    const url = await uploadThumbnail(image(), 'alice')
    expect(url).toBe('https://images.example/static.png')
    expect(calledUrls()).toEqual(['/api/upload-image', '/hive-image-api/alice/SIG123', '/image-api/upload'])
  })

  it('falls back to the 3Speak image server when the wallet will not sign', async () => {
    answers.threespeak = () => json(500, {})
    signMessageWithAioha.mockRejectedValueOnce(new Error('user cancelled'))
    expect(await uploadThumbnail(image(), 'alice')).toBe('https://images.example/static.png')
  })

  it('sends the static upload as multipart "image" with the Bearer key', async () => {
    answers.threespeak = () => json(500, {})
    await uploadThumbnail(image(), undefined)
    const [, init] = fetchMock.mock.calls[1]
    expect(init.headers).toEqual({ Authorization: 'Bearer static-key' })
    expect(init.body.get('image').name).toBe('cover.png')
  })

  it.each([
    ['the server names the error', () => json(413, { error: { name: 'FileTooLarge' } }), 'FileTooLarge'],
    ['the server gives only a status', () => json(503, {}), '3Speak image upload failed (503)'],
    ['the server reports no success', () => json(200, { success: false, url: 'x' }), '3Speak image upload returned no URL'],
  ])('throws when every path fails and %s', async (_label, answer, message) => {
    answers.threespeak = () => json(500, {})
    answers.static = answer
    await expect(uploadThumbnail(image(), undefined)).rejects.toThrow(message)
  })

  it('uses the configured image server outside the dev server', async () => {
    vi.resetModules()
    vi.stubEnv('DEV', false)
    const fresh = await import('../../../src/utils/uploadThumbnail.js')
    answers.threespeak = () => json(500, {})
    await fresh.uploadThumbnail(image(), undefined)
    expect(calledUrls()).toEqual(['/api/upload-image', 'https://images.example/upload'])
  })
})
