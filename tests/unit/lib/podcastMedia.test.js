// Chapters and transcripts of outside podcast episodes (src/lib/podcastMedia.js):
// read once from the checker and remembered, retried after a failure, with the
// session vouch for a private feed, and the chapter playing at a given time.
// fetch and the vouch are mocked; each test loads a fresh module (it caches).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ vouchQuery: vi.fn() }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
vi.mock('../../../src/lib/podcasts', () => ({ vouchQuery: h.vouchQuery }))

const reply = (status, body) => ({ ok: status < 300, status, json: async () => body })
const BASE = 'https://checker.example/podcasts/episode'

let fetchMock
let media
beforeEach(async () => {
  fetchMock = vi.fn(async () => reply(200, {}))
  vi.stubGlobal('fetch', fetchMock)
  h.vouchQuery.mockReset().mockResolvedValue('vu=alice&vts=1&vsig=S')
  vi.resetModules()
  media = await import('../../../src/lib/podcastMedia.js')
})

describe('fetchChapters', () => {
  const chapters = [{ start: 0, title: 'Intro' }, { start: 60, title: 'Main' }]

  it('reads an episode\'s chapters once and remembers them', async () => {
    fetchMock.mockResolvedValue(reply(200, { chapters }))
    expect(await media.fetchChapters('ep/1')).toEqual(chapters)
    expect(await media.fetchChapters('ep/1')).toEqual(chapters)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/ep%2F1/chapters`)
  })

  it('does not remember a failure, so the next track change tries again', async () => {
    fetchMock.mockResolvedValueOnce(reply(500, {})).mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(reply(200, { chapters }))
    expect(await media.fetchChapters('ep1')).toEqual([])
    expect(await media.fetchChapters('ep1')).toEqual([])
    expect(await media.fetchChapters('ep1')).toEqual(chapters)
  })

  it.each([
    ['no episode', undefined, false],
    ['an answer without a chapter list', 'ep1', true],
  ])('is empty for %s', async (_name, id, asked) => {
    fetchMock.mockResolvedValue(reply(200, { chapters: 'nope' }))
    expect(await media.fetchChapters(id)).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(asked ? 1 : 0)
  })

  it('sends the session vouch for a private feed only', async () => {
    h.vouchQuery.mockResolvedValue('?vu=alice&vts=1&vsig=S')
    await media.fetchChapters('ep1', { private: true })
    expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/ep1/chapters?vu=alice&vts=1&vsig=S`)
    await media.fetchChapters('ep2', { private: false })
    expect(fetchMock).toHaveBeenLastCalledWith(`${BASE}/ep2/chapters`)
    expect(h.vouchQuery).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the vouch fails', () => h.vouchQuery.mockRejectedValue(new Error('x'))],
    ['there is no vouch', () => h.vouchQuery.mockResolvedValue(null)],
  ])('reads without a vouch when %s', async (_name, arrange) => {
    arrange()
    await media.fetchChapters('ep1', { private: true })
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/ep1/chapters`)
  })
})

describe('fetchTranscript', () => {
  const transcript = { lang: 'en', languages: ['en', 'de'], cues: [{ start: 0, end: 2, text: 'Hi' }] }

  it('reads the feed\'s first language, or the one asked for, each remembered separately', async () => {
    fetchMock.mockResolvedValue(reply(200, transcript))
    expect(await media.fetchTranscript('ep1')).toEqual(transcript)
    await media.fetchTranscript('ep1', 'de')
    await media.fetchTranscript('ep1', 'de')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([`${BASE}/ep1/transcript`, `${BASE}/ep1/transcript?lang=de`])
  })

  it('adds the vouch after the language with &', async () => {
    fetchMock.mockResolvedValue(reply(200, transcript))
    await media.fetchTranscript('ep1', 'pt-BR', { private: true })
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/ep1/transcript?lang=pt-BR&vu=alice&vts=1&vsig=S`)
  })

  it('is null without an episode or cues', async () => {
    expect(await media.fetchTranscript('')).toBeNull()
    fetchMock.mockResolvedValue(reply(200, { lang: 'en' }))
    expect(await media.fetchTranscript('ep1')).toBeNull()
  })
})

describe('chapterAt', () => {
  const chapters = [{ start: 0, end: 60, title: 'A' }, { start: 60, title: 'B' }, { start: 120, end: 150, title: 'C' }]

  it.each([
    [0, 'A'],
    [59.9, 'A'],
    [60, 'B'],
    [119, 'B'],
    [149, 'C'],
    [150, null],
    [-1, null],
  ])('at %ss plays %s', (time, title) => {
    expect(media.chapterAt(chapters, time)?.title ?? null).toBe(title)
  })

  it('is null without chapters', () => {
    expect(media.chapterAt(null, 10)).toBeNull()
  })
})
