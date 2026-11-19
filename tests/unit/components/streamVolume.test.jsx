// @vitest-environment jsdom
// The viewer's sound for live streams (components/openpods/StreamVolume.jsx):
// one level and mute for every stream, kept on this device, a slider over the
// desktop player and a mute switch on the phone's action rail.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import StreamVolumeControl, { useStreamVolume } from '../../../src/components/openpods/StreamVolume.jsx'

const KEY = '3speak-stream-volume'

beforeEach(() => { localStorage.clear() })

describe('useStreamVolume', () => {
  it('starts at full volume, and remembers a level and mute for the next stream', () => {
    const { result } = renderHook(() => useStreamVolume())
    expect(result.current).toMatchObject({ volume: 1, muted: false })
    act(() => result.current.setVolume(0.3))
    expect(result.current).toMatchObject({ volume: 0.3, muted: false })
    act(() => result.current.toggleMute())
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ volume: 0.3, muted: true })
    const next = renderHook(() => useStreamVolume())
    expect(next.result.current).toMatchObject({ volume: 0.3, muted: true })
  })

  it('sliding to zero mutes; unmuting a level of zero comes back at half', () => {
    const { result } = renderHook(() => useStreamVolume())
    act(() => result.current.setVolume(0))
    expect(result.current).toMatchObject({ volume: 0, muted: true })
    act(() => result.current.toggleMute())
    expect(result.current).toMatchObject({ volume: 0.5, muted: false })
  })

  it('ignores a broken saved value', () => {
    localStorage.setItem(KEY, '{nope')
    expect(renderHook(() => useStreamVolume()).result.current).toMatchObject({ volume: 1, muted: false })
    localStorage.setItem(KEY, JSON.stringify({ volume: 7 }))
    expect(renderHook(() => useStreamVolume()).result.current.volume).toBe(1)
  })
})

describe('StreamVolumeControl', () => {
  function Harness({ variant }) {
    const v = useStreamVolume()
    return <StreamVolumeControl variant={variant} volume={v.volume} muted={v.muted} onVolume={v.setVolume} onToggleMute={v.toggleMute} />
  }

  it('over the player: a mute button and a level slider', () => {
    renderWithProviders(<Harness />)
    const slider = screen.getByRole('slider', { name: 'Volume' })
    expect(slider.value).toBe('100')
    fireEvent.change(slider, { target: { value: '40' } })
    expect(JSON.parse(localStorage.getItem(KEY))).toEqual({ volume: 0.4, muted: false })
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(screen.getByRole('slider', { name: 'Volume' }).value).toBe('0')
    expect(screen.getByRole('button', { name: 'Unmute' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('on the phone rail: a Sound switch', () => {
    renderWithProviders(<Harness variant="rail" />)
    expect(screen.getByText('Sound')).toBeTruthy()
    expect(screen.queryByRole('slider')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }))
    expect(JSON.parse(localStorage.getItem(KEY)).muted).toBe(true)
  })
})
