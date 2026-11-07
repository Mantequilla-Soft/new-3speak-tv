// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { needsCorsMode, setAudioSrc } from '../../../src/lib/audioCorsMode'

describe('audio CORS mode', () => {
  it('asks only ipfs-audio.3speak.tv in CORS mode', () => {
    expect(needsCorsMode('https://ipfs-audio.3speak.tv/ipfs/Qm1')).toBe(true)
    // Sends the CORS header twice (fails CORS) but types every range.
    expect(needsCorsMode('https://ipfs-3speak.b-cdn.net/ipfs/Qm1')).toBe(false)
    expect(needsCorsMode('https://ipfs.io/ipfs/Qm1')).toBe(false)
    expect(needsCorsMode('https://pod.example/ep1.mp3')).toBe(false)
    expect(needsCorsMode('blob:https://3speak.tv/1234')).toBe(false)
    expect(needsCorsMode('not a url')).toBe(false)
    expect(needsCorsMode(null)).toBe(false)
  })

  it('sets the mode before the source, and clears it for a plain one', () => {
    const el = document.createElement('audio')
    setAudioSrc(el, 'https://ipfs-audio.3speak.tv/ipfs/Qm1')
    expect(el.getAttribute('crossorigin')).toBe('anonymous')
    expect(el.getAttribute('src')).toBe('https://ipfs-audio.3speak.tv/ipfs/Qm1')
    setAudioSrc(el, 'https://ipfs-3speak.b-cdn.net/ipfs/Qm1')
    expect(el.hasAttribute('crossorigin')).toBe(false)
    expect(el.getAttribute('src')).toBe('https://ipfs-3speak.b-cdn.net/ipfs/Qm1')
  })

  it('keeps CORS mode for an element routed through Web Audio', () => {
    const el = document.createElement('audio')
    setAudioSrc(el, 'https://pod.example/ep1.mp3', true)
    expect(el.getAttribute('crossorigin')).toBe('anonymous')
  })
})
