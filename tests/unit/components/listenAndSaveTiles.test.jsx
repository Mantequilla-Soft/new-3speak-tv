// @vitest-environment jsdom
// The watch page's Listen and Download tiles (components/playVideo/useListenAndSaveTiles.js).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({ dl: { saved: false, progress: null, entry: null }, track: null }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/lib/videoAsAudio', () => ({ videoAudioTrack: vi.fn(async () => m.track) }))
vi.mock('../../../src/lib/videoDownloads', () => ({
  downloadVideo: vi.fn(async () => {}),
  cancelVideoDownload: vi.fn(),
  useVideoDownload: () => m.dl,
}))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const videoAsAudio = await import('../../../src/lib/videoAsAudio')
const videoDownloads = await import('../../../src/lib/videoDownloads')
const { default: useListenAndSaveTiles } = await import('../../../src/components/playVideo/useListenAndSaveTiles.js')

const wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>
const tiles = (props) => renderHook(() => useListenAndSaveTiles({ author: 'badadib', permlink: 'test-stream', videoDetails: { title: 'Test stream' }, ...props }), { wrapper })

beforeEach(() => {
  m.dl = { saved: false, progress: null, entry: null }
  m.track = { _id: 'video:badadib/test-stream' }
})
afterEach(() => { vi.clearAllMocks() })

describe('Listen and Download on the watch page', () => {
  it('none for a live stream or a post without media', () => {
    expect(tiles({ available: false }).result.current).toEqual([])
  })

  it('Listen carries on from where the video is', async () => {
    const audioPlayAt = vi.fn()
    const audioPlay = vi.fn()
    act(() => useAppStore.setState({ audioPlayAt, audioPlay }))
    const { result } = tiles({ currentTime: 42 })
    const [listen] = result.current
    expect(listen).toMatchObject({ id: 'listen', icon: 'headphones', label: 'Listen' })
    await act(async () => { await listen.onClick() })
    expect(videoAsAudio.videoAudioTrack).toHaveBeenCalledWith(expect.objectContaining({ author: 'badadib', permlink: 'test-stream', title: 'Test stream' }))
    expect(audioPlayAt).toHaveBeenCalledWith(m.track, 42)
    const { result: fromStart } = tiles({ currentTime: 2 })
    await act(async () => { await fromStart.current[0].onClick() })
    expect(audioPlay).toHaveBeenCalledWith(m.track)
  })

  it('Download saves the video, shows its progress, cancels on a second press, and opens Downloads once saved', async () => {
    const { result, rerender } = tiles()
    expect(result.current[1]).toMatchObject({ id: 'download', label: 'Download' })
    act(() => result.current[1].onClick())
    expect(videoDownloads.downloadVideo).toHaveBeenCalledWith(expect.objectContaining({ author: 'badadib', permlink: 'test-stream' }))
    await waitFor(() => expect(toastMessages(toast.success)).toContain('Saved for offline. It stays for 30 days.'))
    m.dl = { saved: false, progress: 0.42, entry: null }
    rerender()
    expect(result.current[1].label).toBe('Downloading 42%')
    act(() => result.current[1].onClick())
    expect(videoDownloads.cancelVideoDownload).toHaveBeenCalledWith('badadib', 'test-stream')
    m.dl = { saved: true, progress: null, entry: {} }
    rerender()
    expect(result.current[1]).toMatchObject({ label: 'Saved', icon: 'download_done', active: true })
  })

  it('a download over the storage cap says how to make room', async () => {
    videoDownloads.downloadVideo.mockRejectedValueOnce(Object.assign(new Error('cap'), { code: 'cap' }))
    const { result } = tiles()
    act(() => result.current[1].onClick())
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(['Not enough room under your storage limit. Remove a download or raise the limit on the Downloads page.']))
  })
})
