// @vitest-environment jsdom
// The audio.3speak.tv player inside a post (src/components/AudioPlayerInline):
// ipfs-audio.3speak.tv is loaded in CORS mode, because the browser's ORB check
// blocks its mid-file ranges otherwise (lib/audioCorsMode.js); the fallback plainly.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import AudioPlayerInline from '../../../src/components/AudioPlayerInline/AudioPlayerInline.jsx'

const CID = 'QmdjihhgTuyfiybEwKnLk4eydSKJVSbfRcXdaVvG1oqDcj'
let answer

beforeEach(() => {
  answer = {
    audioUrl: `https://ipfs-audio.3speak.tv/ipfs/${CID}`,
    audioUrlFallback: `https://ipfs.io/ipfs/${CID}`,
    duration: 49.6,
  }
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => answer })))
})
afterEach(() => { vi.unstubAllGlobals() })

const audio = () => document.querySelector('audio')

describe('the audio player inside a post', () => {
  it('asks ipfs-audio in CORS mode and the fallback plainly', async () => {
    renderWithProviders(<AudioPlayerInline src="https://audio.3speak.tv/play?a=x3zqsd31" />)
    await waitFor(() => expect(audio()).toBeTruthy())
    expect(fetch).toHaveBeenCalledWith('https://audio.3speak.tv/api/audio?a=x3zqsd31')
    expect(audio()).toHaveAttribute('src', answer.audioUrl)
    expect(audio()).toHaveAttribute('crossorigin', 'anonymous')

    fireEvent.error(audio())
    expect(audio()).toHaveAttribute('src', answer.audioUrlFallback)
    expect(audio()).not.toHaveAttribute('crossorigin')
  })

  it('loads any other host plainly', async () => {
    answer.audioUrl = `https://ipfs-3speak.b-cdn.net/ipfs/${CID}`
    renderWithProviders(<AudioPlayerInline src="https://audio.3speak.tv/play?a=x3zqsd31" />)
    await waitFor(() => expect(audio()).toBeTruthy())
    expect(audio()).toHaveAttribute('src', answer.audioUrl)
    expect(audio()).not.toHaveAttribute('crossorigin')
  })
})
