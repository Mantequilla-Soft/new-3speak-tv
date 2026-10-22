// Saving an author's caption corrections (src/lib/captionEdit.js): the text
// cleaning and SRT bytes the checker re-derives, and the signing fallbacks.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'

const h = vi.hoisted(() => ({
  provider: 'keychain',
  manteAuth: false,
  signMessageWithAioha: vi.fn(),
  establishWalletSession: vi.fn(),
}))

vi.mock('../../../src/hive-api/aioha', () => ({
  signMessageWithAioha: h.signMessageWithAioha,
  getCurrentProvider: () => h.provider,
  isManteAuthLogin: () => h.manteAuth,
  establishWalletSession: h.establishWalletSession,
  KeyTypes: { Posting: 'posting' },
  Providers: { Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', HiveSigner: 'hivesigner' },
}))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))

import { cleanCaptionText, normaliseCues, saveCaptionEdit } from '../../../src/lib/captionEdit.js'

const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const cues = [
  { start: 0, end: 1.5, text: 'Hello <b>world</b>' },
  { start: 3661.5, end: 3662.0004, text: '  second  \n line \n third' },
  { start: '5', end: '6', text: '   ' },
]
// The exact file the checker builds from `cues` (routes/subtitleEdit.js cuesToSrt).
const EXPECTED_SRT = '1\n00:00:00,000 --> 00:00:01,500\nHello world\n\n2\n01:01:01,500 --> 01:01:02,000\nsecond\nline\n\n'
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')

let fetchMock
let checkerAnswer
let signAnswers

beforeEach(() => {
  h.provider = 'keychain'
  h.manteAuth = false
  h.signMessageWithAioha.mockReset()
  h.establishWalletSession.mockReset()
  localStorage.clear()
  checkerAnswer = res(200, { success: true, cid: 'bafy-cid' })
  signAnswers = [res(200, { signature: 'sig', timestamp: 111, username: 'alice' })]
  fetchMock = vi.fn(async (url) => (url.startsWith('https://checker.example') ? checkerAnswer : signAnswers.shift() || res(500, {})))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => { vi.useRealTimers() })

describe('cleanCaptionText', () => {
  it('strips markup and control characters, keeps at most two trimmed lines', () => {
    expect(cleanCaptionText('<i>a</i>\u0007b')).toBe('ab')
    expect(cleanCaptionText(' one \r\n\n two \n three ')).toBe('one\ntwo')
    expect(cleanCaptionText('tab\there')).toBe('tab\there')
  })

  it('caps a line at 500 characters and copes with non-strings', () => {
    expect(cleanCaptionText('x'.repeat(600))).toHaveLength(500)
    expect(cleanCaptionText(42)).toBe('42')
    expect(cleanCaptionText('日本語 ✓')).toBe('日本語 ✓')
  })
})

describe('normaliseCues', () => {
  it('turns times into numbers and drops lines that clean to nothing', () => {
    expect(normaliseCues(cues)).toEqual([
      { start: 0, end: 1.5, text: 'Hello world' },
      { start: 3661.5, end: 3662.0004, text: 'second\nline' },
    ])
    expect(normaliseCues([{ start: 1, end: 2 }])).toEqual([])
  })
})

describe('saveCaptionEdit', () => {
  it('signs the hash of the exact SRT the checker will build, then stores it', async () => {
    const out = await saveCaptionEdit({ author: 'alice', permlink: 'p', lang: 'en', cues })
    expect(out).toEqual({ cid: 'bafy-cid', cues: normaliseCues(cues) })

    const [signUrl, signInit] = fetchMock.mock.calls[0]
    expect(signUrl).toBe('/api/captions/edit-signature')
    expect(signInit.credentials).toBe('include')
    expect(JSON.parse(signInit.body)).toEqual({ permlink: 'p', lang: 'en', srtSha256: sha(EXPECTED_SRT) })

    const [saveUrl, saveInit] = fetchMock.mock.calls[1]
    expect(saveUrl).toBe('https://checker.example/subtitles/edit')
    expect(JSON.parse(saveInit.body)).toEqual({
      author: 'alice', permlink: 'p', lang: 'en', cues: normaliseCues(cues), signature: 'sig', timestamp: 111,
    })
  })

  it('refuses to save captions that are all empty', async () => {
    await expect(saveCaptionEdit({ author: 'a', permlink: 'p', lang: 'en', cues: [{ start: 0, end: 1, text: '<b></b>' }] }))
      .rejects.toThrow('comments.transcript.edit.empty')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a HiveSigner login sends its token to the signing endpoint', async () => {
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'hs-token')
    await saveCaptionEdit({ author: 'alice', permlink: 'p', lang: 'en', cues })
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer hs-token')
  })

  it('a wallet without a session cookie gets one minted and asks again', async () => {
    signAnswers = [res(401, { error: 'no session' }), res(200, { signature: 's2', timestamp: 2, username: 'alice' })]
    h.establishWalletSession.mockResolvedValue(true)
    await saveCaptionEdit({ author: 'alice', permlink: 'p', lang: 'en', cues })
    expect(h.establishWalletSession).toHaveBeenCalledWith('alice')
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).signature).toBe('s2')
  })

  it('a session for another account is refreshed for the author', async () => {
    signAnswers = [res(200, { signature: 'x', timestamp: 1, username: 'bob' }), res(200, { signature: 'ok', timestamp: 2, username: 'Alice' })]
    h.establishWalletSession.mockResolvedValue(true)
    await saveCaptionEdit({ author: 'alice', permlink: 'p', lang: 'en', cues })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body).signature).toBe('ok')
  })

  it('never stores a signature made for a different account', async () => {
    h.provider = 'hivesigner'
    signAnswers = [res(200, { signature: 'x', timestamp: 1, username: 'bob' })]
    await expect(saveCaptionEdit({ author: 'alice', permlink: 'p', lang: 'en', cues }))
      .rejects.toThrow('comments.transcript.edit.signedInAsOther')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a wallet that can sign does it itself when @threespeak cannot', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1760000000000)
    signAnswers = [res(403, { error: 'no grant' })]
    h.establishWalletSession.mockResolvedValue(false)
    h.signMessageWithAioha.mockResolvedValue({ success: true, result: 'local-sig' })
    await saveCaptionEdit({ author: 'alice', permlink: 'p', lang: 'en', cues })
    expect(h.signMessageWithAioha.mock.calls[0][0])
      .toBe(`3speak-captions|edit|alice|p|en|${sha(EXPECTED_SRT)}|1760000000000`)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ signature: 'local-sig', timestamp: 1760000000000 })
  })

  it('HiveSigner and Butter Auth logins cannot sign locally, so the server error stands', async () => {
    signAnswers = [res(403, { error: 'grant missing' })]
    h.provider = 'hivesigner'
    await expect(saveCaptionEdit({ author: 'a', permlink: 'p', lang: 'en', cues })).rejects.toThrow('grant missing')
    h.provider = 'keychain'
    h.manteAuth = true
    signAnswers = [res(500, {})]
    await expect(saveCaptionEdit({ author: 'a', permlink: 'p', lang: 'en', cues })).rejects.toThrow('comments.transcript.edit.saveFailed')
    expect(h.signMessageWithAioha).not.toHaveBeenCalled()
  })

  it('a rejected wallet prompt and a refused save both surface as errors', async () => {
    signAnswers = [res(500, {})]
    h.signMessageWithAioha.mockResolvedValue({ success: false })
    await expect(saveCaptionEdit({ author: 'a', permlink: 'p', lang: 'en', cues })).rejects.toThrow('comments.transcript.edit.signatureRejected')
    signAnswers = [res(200, { signature: 'sig', timestamp: 1, username: 'alice' })]
    checkerAnswer = res(400, { error: 'Invalid signature' })
    await expect(saveCaptionEdit({ author: 'alice', permlink: 'p', lang: 'en', cues })).rejects.toThrow('Invalid signature')
  })
})
