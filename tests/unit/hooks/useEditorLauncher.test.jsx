// @vitest-environment jsdom
// Which editor App.jsx's global popup shows (hooks/useEditorLauncher.js): the
// shorts editor or the audio editor, with the file and the audio upload track
// they came with.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// 🔒 The landscape video editor is Pro only: the Pro status, steered per test
const m = vi.hoisted(() => ({ premium: { premium: true } }))
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => m.premium }))
const { useAppStore } = await import('../../../src/lib/store')
const { useEditorLauncher } = await import('../../../src/hooks/useEditorLauncher')

beforeEach(() => {
  m.premium = { premium: true }
  useAppStore.setState({ user: 'badadib', incubationHandle: null })
})

const fire = (type, detail) => act(() => { window.dispatchEvent(new CustomEvent(type, detail === undefined ? undefined : { detail })) })

describe('useEditorLauncher', () => {
  it('starts closed, as the video editor', () => {
    const { result } = renderHook(() => useEditorLauncher())
    expect(result.current).toMatchObject({ open: false, mode: 'video', file: null, audioTrackId: null })
  })

  it('opens the shorts editor, with the uploader video when there is one', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-shorts-editor')
    expect(result.current).toMatchObject({ open: true, mode: 'video', file: null })
    const video = new File(['v'], 'clip.mp4', { type: 'video/mp4' })
    fire('open-shorts-editor', { file: video })
    expect(result.current.file).toBe(video)
  })

  it('opens the audio editor empty from the share menu', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-audio-editor')
    expect(result.current).toMatchObject({ open: true, mode: 'audio', file: null, audioTrackId: null })
  })

  it('opens the audio editor on an audio upload track', () => {
    const { result } = renderHook(() => useEditorLauncher())
    const track = new File(['a'], 'ep.wav', { type: 'audio/wav' })
    fire('open-audio-editor', { file: track, trackId: 't-1', name: 'Episode' })
    expect(result.current).toMatchObject({ open: true, mode: 'audio', file: track, audioTrackId: 't-1' })
  })

  it('takes neither a non-file nor a non-string track id', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-audio-editor', { file: 'blob:x', trackId: 42 })
    expect(result.current).toMatchObject({ file: null, audioTrackId: null })
  })

  it('switches from audio back to video cleanly', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-audio-editor', { file: new File(['a'], 'a.mp3'), trackId: 't' })
    fire('open-shorts-editor')
    expect(result.current).toMatchObject({ mode: 'video', file: null, audioTrackId: null })
  })

  it('closes, keeping the mode, and forgets the file and track', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-audio-editor', { file: new File(['a'], 'a.mp3'), trackId: 't' })
    act(() => result.current.close())
    expect(result.current).toMatchObject({ open: false, mode: 'audio', file: null, audioTrackId: null })
  })

  it('a sound page\'s "Use this sound" opens the shorts editor with the sound, checked', () => {
    const { result } = renderHook(() => useEditorLauncher())
    const credit = { id: 'short_badadib_beat-1', title: 'Beat', source: '3speak', account: 'badadib' }
    fire('open-shorts-editor', { sound: { url: 'https://play.example/hls?u=480', name: 'Beat', credit } })
    expect(result.current).toMatchObject({ open: true, mode: 'video', sound: { url: 'https://play.example/hls?u=480', name: 'Beat', credit } })
    fire('open-shorts-editor', { sound: { url: 'javascript:alert(1)', credit } })
    expect(result.current.sound).toBeNull()
    fire('open-shorts-editor', { sound: { url: 'https://x.example/a.mp3' } })
    expect(result.current.sound).toBeNull()
    fire('open-shorts-editor', { sound: { url: 'https://x.example/a.mp3', credit } })
    act(() => result.current.close())
    expect(result.current.sound).toBeNull()
  })

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useEditorLauncher())
    unmount()
    fire('open-audio-editor')
    expect(result.current.open).toBe(false)
  })

  it('opens the video editor as a landscape project, with the upload\'s video when there is one', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-video-editor')
    expect(result.current).toMatchObject({ open: true, mode: 'video', file: null, aspect: '16:9' })
    const video = new File(['v'], 'talk.mp4', { type: 'video/mp4' })
    fire('open-video-editor', { file: video, aspect: '1:1' })
    expect(result.current).toMatchObject({ file: video, aspect: '1:1' })
    fire('open-video-editor', { aspect: 'nonsense' })
    expect(result.current.aspect).toBe('16:9')
    fire('open-shorts-editor')
    expect(result.current.aspect).toBe(null)
  })

  it('the audio page\'s "Video podcast" opens the audio editor with the episode, checked', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-audio-editor', { episode: { url: 'https://audio.3speak.tv/Qm1', title: 'Ep 1', cover: 'https://img.test/c.jpg', durationSec: 1800 } })
    expect(result.current).toMatchObject({ open: true, mode: 'audio', episode: { url: 'https://audio.3speak.tv/Qm1', title: 'Ep 1', cover: 'https://img.test/c.jpg', durationSec: 1800 } })
    fire('open-audio-editor', { episode: { url: 'http://audio.3speak.tv/Qm1', cover: 'https://img.test/c.jpg' } })
    expect(result.current.episode).toBeNull()
    fire('open-audio-editor', { episode: { url: 'https://audio.3speak.tv/Qm1', cover: 'javascript:x', durationSec: 'long' } })
    expect(result.current.episode).toEqual({ url: 'https://audio.3speak.tv/Qm1', title: '', cover: null, durationSec: null })
    act(() => result.current.close())
    expect(result.current.episode).toBeNull()
    fire('open-shorts-editor')
    expect(result.current.episode).toBeNull()
  })
})

describe('useEditorLauncher: the landscape video editor is Pro only', () => {
  it('a free account gets the Pro upsell instead of the editor', () => {
    m.premium = { premium: false }
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-video-editor', { file: new File(['v'], 'talk.mp4', { type: 'video/mp4' }) })
    expect(result.current).toMatchObject({ open: false, upsell: true, file: null })
    act(() => result.current.closeUpsell())
    expect(result.current.upsell).toBe(false)
  })

  it('a warm-up account is not Pro: upsell', () => {
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-video-editor')
    expect(result.current).toMatchObject({ open: false, upsell: true })
  })

  it('waits for the Pro status, then opens the editor for Pro without the upsell flashing', () => {
    m.premium = null
    const { result, rerender } = renderHook(() => useEditorLauncher())
    fire('open-video-editor', { aspect: '4:3' })
    expect(result.current).toMatchObject({ open: false, upsell: false })
    m.premium = { premium: true }
    rerender()
    expect(result.current).toMatchObject({ open: true, aspect: '4:3', upsell: false })
  })

  it('the Shorts and audio editors stay free, warm-up included', () => {
    m.premium = { premium: false }
    useAppStore.setState({ user: null, incubationHandle: 'newbie' })
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-shorts-editor')
    expect(result.current).toMatchObject({ open: true, mode: 'video', aspect: null, upsell: false })
    fire('open-audio-editor')
    expect(result.current).toMatchObject({ open: true, mode: 'audio', upsell: false })
  })

  it('EditorModal\'s guard (open-pro-upsell) opens the upsell', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-pro-upsell', { feature: 'landscape-editor' })
    expect(result.current.upsell).toBe(true)
  })

  it('opens the shorts editor with the whole video just published ("Make a Short from this video")', () => {
    const { result } = renderHook(() => useEditorLauncher())
    const video = new File(['v'], 'talk.mp4', { type: 'video/mp4' })
    fire('open-shorts-editor', { file: video, teaser: { author: 'BadAdib', permlink: 'my-talk' } })
    expect(result.current).toMatchObject({ open: true, mode: 'video', file: video, teaser: { author: 'badadib', permlink: 'my-talk' } })
    act(() => result.current.close())
    expect(result.current.teaser).toBeNull()
  })

  it('takes no teaser without the file, nor a malformed one', () => {
    const { result } = renderHook(() => useEditorLauncher())
    fire('open-shorts-editor', { teaser: { author: 'badadib', permlink: 'my-talk' } })
    expect(result.current.teaser).toBeNull()
    const video = new File(['v'], 'talk.mp4', { type: 'video/mp4' })
    fire('open-shorts-editor', { file: video, teaser: { author: '<b>', permlink: '../x' } })
    expect(result.current.teaser).toBeNull()
    fire('open-shorts-editor', { file: video, teaser: { author: 'badadib', permlink: 'my-talk', extra: 'dropped' } })
    expect(result.current.teaser).toEqual({ author: 'badadib', permlink: 'my-talk' })
  })
})
