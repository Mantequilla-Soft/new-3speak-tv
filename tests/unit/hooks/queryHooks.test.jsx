// Small TanStack Query hooks: the live Hangouts room count
// (src/hooks/useOpenPodsCount.js), the public playlists holding a video
// (useVideoPlaylists.js) and the watched-videos count and list
// (useWatchedVideos.js). What each asks for, and when it asks nothing at all.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { queryWrapper } from './helpers/query.jsx'

const rooms = vi.hoisted(() => ({ listRooms: vi.fn(), ctor: vi.fn() }))
vi.mock('@snapie/hangouts-core', () => ({
  HangoutsApiClient: class { constructor(o) { rooms.ctor(o) } listRooms() { return rooms.listRooms() } },
}))
const axiosGet = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { get: axiosGet } }))
vi.mock('../../../src/utils/config', () => ({ PLAYLISTS_READ_URL: 'https://playlists.test' }))
const history = vi.hoisted(() => ({ getWatchHistoryCount: vi.fn(), getWatchHistory: vi.fn() }))
vi.mock('../../../src/utils/watchHistory', () => history)
const store = vi.hoisted(() => ({ user: 'badadib' }))
vi.mock('../../../src/lib/store', () => ({ useAppStore: () => store }))

beforeEach(() => {
  vi.resetModules()
  rooms.listRooms.mockReset()
  axiosGet.mockReset()
  history.getWatchHistoryCount.mockReset()
  history.getWatchHistory.mockReset()
  store.user = 'badadib'
})

describe('useOpenPodsCount', () => {
  it('counts the live rooms from the public Hangouts API', async () => {
    vi.stubEnv('VITE_HANGOUTS_API_URL', 'https://hangouts.test')
    rooms.listRooms.mockResolvedValue([{ id: 1 }, { id: 2 }])
    const { default: useOpenPodsCount } = await import('../../../src/hooks/useOpenPodsCount.js')
    const { result } = renderHook(() => useOpenPodsCount(), queryWrapper())
    expect(result.current).toBe(0)
    await waitFor(() => expect(result.current).toBe(2))
    expect(rooms.ctor).toHaveBeenCalledWith({ baseUrl: 'https://hangouts.test' })
  })

  it('is zero and asks nothing without a configured API', async () => {
    vi.stubEnv('VITE_HANGOUTS_API_URL', '')
    const { default: useOpenPodsCount } = await import('../../../src/hooks/useOpenPodsCount.js')
    const { result } = renderHook(() => useOpenPodsCount(), queryWrapper())
    expect(result.current).toBe(0)
    expect(rooms.listRooms).not.toHaveBeenCalled()
  })
})

describe('useVideoPlaylists', () => {
  it('reads the public playlists that hold the video', async () => {
    axiosGet.mockResolvedValue({ data: { count: 1, playlists: [{ id: 'pl1' }] } })
    const { useVideoPlaylists } = await import('../../../src/hooks/useVideoPlaylists.js')
    const { result } = renderHook(() => useVideoPlaylists('badadib', 'my-video'), queryWrapper())
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'pl1' }]))
    expect(axiosGet).toHaveBeenCalledWith('https://playlists.test/video/badadib/my-video/playlists/public')
  })

  it('an answer with no playlists field is an empty list', async () => {
    axiosGet.mockResolvedValue({ data: {} })
    const { default: useVideoPlaylists } = await import('../../../src/hooks/useVideoPlaylists.js')
    const { result } = renderHook(() => useVideoPlaylists('badadib', 'my-video'), queryWrapper())
    await waitFor(() => expect(result.current.data).toEqual([]))
  })

  it('without a video asks nothing', async () => {
    const { useVideoPlaylists } = await import('../../../src/hooks/useVideoPlaylists.js')
    const { result } = renderHook(() => useVideoPlaylists('badadib', ''), queryWrapper())
    expect(result.current.fetchStatus).toBe('idle')
    expect(axiosGet).not.toHaveBeenCalled()
  })
})

describe('useWatchedVideos', () => {
  it('the count is the signed-in user\'s', async () => {
    history.getWatchHistoryCount.mockResolvedValue(12)
    const { default: useWatchedVideosCount } = await import('../../../src/hooks/useWatchedVideos.js')
    const { result } = renderHook(() => useWatchedVideosCount(), queryWrapper())
    await waitFor(() => expect(result.current.data).toBe(12))
    expect(history.getWatchHistoryCount).toHaveBeenCalledWith('badadib')
  })

  it('the list pages by limit and offset', async () => {
    history.getWatchHistory.mockResolvedValue([{ permlink: 'p' }])
    const { useWatchedVideos } = await import('../../../src/hooks/useWatchedVideos.js')
    const { result } = renderHook(() => useWatchedVideos(10, 20), queryWrapper())
    await waitFor(() => expect(result.current.data).toEqual([{ permlink: 'p' }]))
    expect(history.getWatchHistory).toHaveBeenCalledWith('badadib', 10, 20)
  })

  it('the list defaults to the first 50', async () => {
    history.getWatchHistory.mockResolvedValue([])
    const { useWatchedVideos } = await import('../../../src/hooks/useWatchedVideos.js')
    renderHook(() => useWatchedVideos(), queryWrapper())
    await waitFor(() => expect(history.getWatchHistory).toHaveBeenCalledWith('badadib', 50, 0))
  })

  it('a guest asks nothing', async () => {
    store.user = null
    const { useWatchedVideos, useWatchedVideosCount } = await import('../../../src/hooks/useWatchedVideos.js')
    renderHook(() => { useWatchedVideos(); useWatchedVideosCount() }, queryWrapper())
    expect(history.getWatchHistory).not.toHaveBeenCalled()
    expect(history.getWatchHistoryCount).not.toHaveBeenCalled()
  })
})
