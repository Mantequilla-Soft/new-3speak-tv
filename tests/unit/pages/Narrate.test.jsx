// @vitest-environment jsdom
// /narrate (page/Narrate.jsx): blog to podcast. Picking an own post loads its
// script, free accounts get the free voices and the focus moods only, a
// recording is made and handed to the audio uploader with the synthetic-voice
// label and the link back, and the written post gets its Listen link after.
// The server is a stand-in (lib/narration), and so is Hive.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from '../components/_render.jsx'

const hive = vi.hoisted(() => ({ comment: vi.fn(async () => ({ success: true })) }))
vi.mock('../../../src/hive-api/aioha', async () => ({
  ...(await import('../components/_render.jsx')).aiohaModule(),
  commentWithAioha: hive.comment,
}))
vi.mock('../../../src/hive-api/hiveApi', () => ({
  getPostDetails: vi.fn(async () => ({
    author: 'badadib', permlink: 'holidays', parent_author: '', parent_permlink: 'hive-181335', category: 'hive-181335',
    title: 'My holidays', body: 'We went to Dresden.', json_metadata: { tags: ['travel'] },
  })),
}))

const api = vi.hoisted(() => ({
  getNarrationOptions: vi.fn(),
  getMyPosts: vi.fn(),
  getScript: vi.fn(),
  getScriptFromText: vi.fn(),
  startNarration: vi.fn(),
  getNarration: vi.fn(),
  getNarrationAudio: vi.fn(async () => new Blob(['ID3'], { type: 'audio/mpeg' })),
  uploadNarrationMusic: vi.fn(),
  musicPreviewUrl: vi.fn(async () => 'blob:bed'),
}))
vi.mock('../../../src/lib/narration', async (orig) => ({ ...(await orig()), ...api }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Narrate } = await import('../../../src/page/Narrate.jsx')

const voices = [
  { id: 'en_GB-alan-medium', name: 'Alan', gender: 'male', accent: 'British', free: true },
  { id: 'en_GB-cori-high', name: 'Cori', gender: 'female', accent: 'British', free: true },
  { id: 'en_US-amy-medium', name: 'Amy', gender: 'female', accent: 'American', free: false },
]
const options = (pro = false) => ({
  pro, voices, focus: ['rain', 'piano', 'fireplace'],
  library: { moods: [], tracks: pro ? [{ id: 'carefree', title: 'Carefree', artist: 'Kevin MacLeod', mood: 'upbeat', duration: 205 }] : [] },
  allowance: { limit: 900, used: 0, left: 900 }, defaultVoice: 'en_GB-alan-medium', wordsPerMinute: 155,
})

beforeEach(() => {
  for (const f of Object.values(api)) f.mockClear()
  hive.comment.mockClear()
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:narration')
  globalThis.URL.revokeObjectURL = vi.fn()
  api.getNarrationOptions.mockImplementation(async () => options())
  api.getMyPosts.mockResolvedValue({ posts: [{ permlink: 'holidays', title: 'My holidays', created: '2026-11-18T10:00:00', words: 120, kind: 'text', narrated: false }], more: false })
  api.getScript.mockResolvedValue({ author: 'badadib', permlink: 'holidays', title: 'My holidays', script: 'We went to Dresden.\n\nIt rained.', words: 6, image: 'https://x.y/a.jpg', tags: ['travel', 'hive-181335'], community: 'hive-181335' })
  api.startNarration.mockResolvedValue({ id: 'job1' })
  api.getNarration.mockResolvedValue({ id: 'job1', status: 'done', progress: 1, seconds: 42, voice: 'en_GB-alan-medium', credit: null })
  useAppStore.setState({ user: 'badadib', authenticated: true })
})

const page = (route = '/narrate') => renderWithProviders(<Narrate />, { route, path: '/narrate/:permlink?' })

describe('Narrate page', () => {
  it('is not offered to accounts outside the team, and never asks the server', async () => {
    useAppStore.setState({ user: 'someoneelse', authenticated: true })
    page()
    expect(await screen.findByText(/not open for your account/i)).toBeTruthy()
    expect(api.getNarrationOptions).not.toHaveBeenCalled()
  })

  it('loads the script of the picked post; free accounts get the free voices and the focus moods', async () => {
    page()
    fireEvent.click(await screen.findByRole('button', { name: /My holidays/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'The script' }).value).toBe('We went to Dresden.\n\nIt rained.'))
    expect(api.getScript).toHaveBeenCalledWith('badadib', 'holidays')
    expect(screen.getByRole('radio', { name: /Amy/ }).disabled).toBe(true)
    expect(screen.getByRole('radio', { name: /Cori/ }).disabled).toBe(false)
    expect(screen.getByRole('button', { name: 'Night piano' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Music library/ }).disabled).toBe(true)
  })

  it('opens the post from /narrate/:permlink', async () => {
    page('/narrate/holidays')
    await waitFor(() => expect(api.getScript).toHaveBeenCalledWith('badadib', 'holidays'))
  })

  it('records and hands the MP3 to the audio uploader with the label and the link back', async () => {
    const opened = vi.fn()
    window.addEventListener('open-audio-upload', opened)
    page('/narrate/holidays')
    fireEvent.click(await screen.findByRole('button', { name: 'Rain' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Make the recording' }))
    await waitFor(() => expect(api.startNarration).toHaveBeenCalled())
    expect(api.startNarration.mock.calls[0][0]).toMatchObject({ voice: 'en_GB-alan-medium', music: { kind: 'focus', id: 'rain' }, intro: true, preview: false, title: 'My holidays' })
    fireEvent.click(await screen.findByRole('button', { name: 'Publish as an audio post' }))
    const detail = opened.mock.calls[0][0].detail
    expect(detail.blob).toBeInstanceOf(Blob)
    expect(detail.prefill).toMatchObject({ title: 'My holidays', coverUrl: 'https://x.y/a.jpg', tags: ['travel', 'narrated'], narration: { voice: 'en_GB-alan-medium', source: 'badadib/holidays' } })
    expect(detail.prefill.description).toContain('https://3speak.tv/@badadib/holidays')
    expect(detail.prefill.description).toContain('Read by a synthetic voice (Alan).')
    window.removeEventListener('open-audio-upload', opened)

    // Out: the written post gets a Listen link to it.
    window.dispatchEvent(new CustomEvent('narration-published', { detail: { source: 'badadib/holidays', author: 'badadib', permlink: 'my-holidays-audio' } }))
    fireEvent.click(await screen.findByRole('button', { name: 'Add a Listen link to your written post' }))
    await waitFor(() => expect(hive.comment).toHaveBeenCalled())
    const [parentAuthor, parentPermlink, permlink, title, body, meta] = hive.comment.mock.calls[0]
    expect([parentAuthor, parentPermlink, permlink, title]).toEqual(['', 'hive-181335', 'holidays', 'My holidays'])
    expect(body).toBe('We went to Dresden.\n\n---\n🎧 [Listen to this post](https://3speak.tv/audio/badadib/my-holidays-audio)')
    expect(meta['3speak'].narration).toBe('badadib/my-holidays-audio')
  })

  it('says when the recording is longer than the time left today', async () => {
    api.startNarration.mockRejectedValueOnce(Object.assign(new Error('limit'), { code: 'daily_limit', allowance: { left: 120 } }))
    page('/narrate/holidays')
    fireEvent.click(await screen.findByRole('button', { name: 'Make the recording' }))
    expect(await screen.findByText(/narration time left today \(2:00\)/)).toBeTruthy()
  })
})
