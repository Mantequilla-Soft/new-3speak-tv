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
  act(() => { useAppStore.getState().audioSetDock(null); useAppStore.getState().audioStop(); useAppStore.getState().audioClearQueue(); useAppStore.getState().audioSetShowQueue(false) })
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
    // The bar says where it is and how long it runs.
    expect(host.querySelector('.audio-np-subline-time').textContent).toBe('0:00 / 10:00')

    act(() => { useAppStore.getState().audioSetDock(dock) })
    // The Player tab: elapsed and length under the timeline.
    expect([...dock.querySelectorAll('.audio-np-timeline-times span')].map((e) => e.textContent)).toEqual(['0:00', '10:00'])
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

  it('closing the player keeps the queue, and an Up next bar offers it', () => {
    const { host, root } = mount()
    const second = { ...track, _id: 'f1:two', title: 'Second' }
    act(() => {
      useAppStore.getState().audioAddToQueue(track)
      useAppStore.getState().audioAddToQueue(second)
      useAppStore.getState().audioPlay(track, [track, second])
    })
    act(() => { host.querySelector('.audio-np-close-btn').click() })
    expect(useAppStore.getState().audioCurrent).toBeNull()
    expect(useAppStore.getState().audioQueue.map((i) => i._id)).toEqual(['f1:ep', 'f1:two'])
    expect(JSON.parse(localStorage.getItem('audio-queue')).length).toBe(2)

    const idle = host.querySelector('.audio-np-idle')
    expect(idle).toBeTruthy()
    expect(idle.textContent).toContain('Episode')
    // Its queue button opens the queue as usual.
    act(() => { idle.querySelector('.audio-np-queue-btn').click() })
    expect(host.querySelectorAll('.audio-queue-item')).toHaveLength(2)
    // Play starts the queue from the top.
    act(() => { idle.querySelector('.audio-np-play-btn').click() })
    expect(useAppStore.getState().audioCurrent?._id).toBe('f1:ep')

    // Hiding the Up next bar still keeps the queue.
    act(() => { host.querySelector('.audio-np-close-btn').click() })
    act(() => { host.querySelector('.audio-np-idle .audio-np-close-btn').click() })
    expect(host.querySelector('.audio-np-idle')).toBeNull()
    expect(useAppStore.getState().audioQueue).toHaveLength(2)
    act(() => root.unmount())
  })

  it('docked, the queue is unfolded under the player', () => {
    const { host, dock, root } = mount()
    const second = { ...track, _id: 'f1:two', title: 'Second' }
    act(() => {
      useAppStore.getState().audioAddToQueue(track)
      useAppStore.getState().audioAddToQueue(second)
      useAppStore.getState().audioPlay(track, [track, second])
      useAppStore.getState().audioSetDock(dock)
    })
    const inline = dock.querySelector('.audio-np-queue-inline')
    expect(inline).toBeTruthy()
    expect(inline.querySelectorAll('.audio-queue-item')).toHaveLength(2)
    // No queue window over the page while docked.
    act(() => { useAppStore.getState().audioSetShowQueue(true) })
    expect(host.querySelector('.audio-queue-overlay')).toBeNull()
    act(() => root.unmount())
  })
})
