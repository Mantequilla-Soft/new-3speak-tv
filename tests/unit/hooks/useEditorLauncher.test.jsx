// @vitest-environment jsdom
// Which editor App.jsx's global popup shows (hooks/useEditorLauncher.js): the
// shorts editor or the audio editor, with the file and the audio upload track
// they came with.
import { describe, it, expect } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEditorLauncher } from '../../../src/hooks/useEditorLauncher'

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

  it('stops listening once unmounted', () => {
    const { result, unmount } = renderHook(() => useEditorLauncher())
    unmount()
    fire('open-audio-editor')
    expect(result.current.open).toBe(false)
  })
})
