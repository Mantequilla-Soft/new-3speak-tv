// The Player tab of a phone's audio page (page/Audio.jsx) borrows the global
// player's controls: they are drawn into the tab's element (`audioDock`), while
// the <audio> element itself stays where it is, so playback carries on when the
// tab closes or the page changes.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'

globalThis.IS_REACT_ACT_ENVIRONMENT = true
// jsdom has neither; set here, not stubbed, so they outlive each test's reset.
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }))

const track = {
  _id: 'f1:ep', external: true, src: 'https://host.example/ep.mp3', title: 'Episode', show: 'Show', show_id: 'f1', duration: 600,
}

let useAppStore
let GlobalAudioPlayer

beforeAll(async () => {
  window.HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve())
  window.HTMLMediaElement.prototype.pause = vi.fn()
  window.HTMLMediaElement.prototype.load = vi.fn()
  ;({ useAppStore } = await import('../../../src/lib/store'))
  ;({ default: GlobalAudioPlayer } = await import('../../../src/components/GlobalAudioPlayer/GlobalAudioPlayer.jsx'))
})

afterEach(() => {
  act(() => { useAppStore.getState().audioSetDock(null); useAppStore.getState().audioStop() })
  document.body.innerHTML = ''
})

function mount() {
  const host = document.createElement('div')
  const dock = document.createElement('div')
  document.body.append(host, dock)
  const root = createRoot(host)
  act(() => { root.render(<MemoryRouter><GlobalAudioPlayer /></MemoryRouter>) })
  return { host, dock, root }
}

describe('docked audio player', () => {
  it('draws the controls in the dock and keeps the audio element in place', () => {
    const { host, dock, root } = mount()
    act(() => { useAppStore.getState().audioPlay(track) })
    const audio = host.querySelector('audio')
    expect(audio).toBeTruthy()
    expect(host.querySelector('.audio-now-playing')).toBeTruthy()

    act(() => { useAppStore.getState().audioSetDock(dock) })
    expect(host.querySelector('.audio-now-playing')).toBeNull()
    expect(dock.querySelector('.audio-now-playing.audio-np-docked')).toBeTruthy()
    // The page's view includes what the sheet over the bar would show.
    expect(dock.querySelector('.audio-np-expanded-area')).toBeTruthy()
    expect(dock.querySelector('audio')).toBeNull()
    // The very same element: nothing reloaded, nothing stopped.
    expect(host.querySelector('audio')).toBe(audio)

    // Leaving the tab (or the page): the bar is back, still the same element.
    act(() => { useAppStore.getState().audioSetDock(null) })
    expect(host.querySelector('.audio-now-playing:not(.audio-np-docked)')).toBeTruthy()
    expect(host.querySelector('audio')).toBe(audio)
    expect(window.HTMLMediaElement.prototype.pause).not.toHaveBeenCalled()
    act(() => root.unmount())
  })

  it('opens the Player tab instead of the sheet while the page offers one', () => {
    const { host, root } = mount()
    act(() => { useAppStore.getState().audioPlay(track) })
    const open = vi.fn()
    act(() => { useAppStore.getState().audioSetDockOpener(open) })
    act(() => { host.querySelector('.audio-np-expand-btn').click() })
    expect(open).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().audioExpanded).toBe(false)

    act(() => { useAppStore.getState().audioSetDockOpener(null) })
    act(() => { host.querySelector('.audio-np-expand-btn').click() })
    expect(useAppStore.getState().audioExpanded).toBe(true)
    act(() => root.unmount())
  })
})
