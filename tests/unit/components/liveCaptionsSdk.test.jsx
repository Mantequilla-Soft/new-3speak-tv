// @vitest-environment jsdom
// Live captions (H11) end to end on the viewer side with the REAL SDK pieces:
// caption messages arrive on the LiveKit data channel, only the host's are
// shown, lines update in place, and the browser's built-in Translator (when
// there is one) turns them into the viewer's language on the device.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoomContext } from '@livekit/components-react'
import { Room, RoomEvent } from 'livekit-client'
import { StreamCaptions } from '@snapie/hangouts-react'

const enc = new TextEncoder()
function makeRoom(meta) {
  const room = new Room()
  Object.defineProperty(room, 'metadata', { get: () => JSON.stringify(meta) })
  return room
}
const say = (room, from, msg) => act(() => {
  room.emit(RoomEvent.DataReceived, enc.encode(JSON.stringify({ t: 'cap', lang: 'en-us', ...msg })), { identity: from }, undefined, 'captions')
})
const view = (room, props) => render(<RoomContext.Provider value={room}><StreamCaptions show {...props} /></RoomContext.Provider>)

afterEach(() => { delete globalThis.Translator })

describe('StreamCaptions with the data channel', () => {
  let room
  beforeEach(() => { room = makeRoom({ host: 'badadib', captions: { lang: 'en-us' } }) })

  it('shows the host\'s lines, updates one in place, ignores anyone else', async () => {
    view(room, { targetLang: 'en' })
    await say(room, 'fan', { id: 0, text: 'Fake caption', final: true })
    expect(screen.queryByText('Fake caption')).not.toBeInTheDocument()
    await say(room, 'badadib', { id: 0, text: 'Hello', final: false })
    await say(room, 'badadib', { id: 0, text: 'Hello everyone', final: false })
    expect(screen.getByText('Hello everyone')).toBeInTheDocument()
    expect(screen.queryByText('Hello')).not.toBeInTheDocument()
    await say(room, 'badadib', { id: 0, text: 'Hello everyone', final: true })
    await say(room, 'badadib', { id: 1, text: 'Welcome', final: false })
    expect(screen.getByText('Welcome')).toBeInTheDocument()
    expect(screen.getByText('Hello everyone')).toBeInTheDocument()
    // Same language as the viewer: no note.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('translates on the device when the browser can, and shows the original on request', async () => {
    const translate = vi.fn(async (t) => `DE ${t}`)
    globalThis.Translator = { availability: vi.fn(async () => 'available'), create: vi.fn(async () => ({ translate })) }
    view(room, { targetLang: 'de', labels: { translatedFrom: 'Übersetzt aus {lang}', showOriginal: 'Original' } })
    await say(room, 'badadib', { id: 0, text: 'Good evening', final: true })
    expect(await screen.findByText('DE Good evening')).toBeInTheDocument()
    expect(screen.getByText('Übersetzt aus Englisch')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Original' }))
    expect(screen.getByText('Good evening')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Translate to/ })).toBeInTheDocument()
  })

  it('asks for a click when the language pack must download first', async () => {
    const translate = vi.fn(async (t) => `FR ${t}`)
    const create = vi.fn(async () => ({ translate }))
    globalThis.Translator = { availability: vi.fn(async () => 'downloadable'), create }
    view(room, { targetLang: 'fr' })
    await say(room, 'badadib', { id: 0, text: 'Hi there', final: true })
    const btn = await screen.findByRole('button', { name: /Translate to/ })
    expect(screen.getByText('Hi there')).toBeInTheDocument()
    await userEvent.click(btn)
    expect(await screen.findByText('FR Hi there')).toBeInTheDocument()
  })

  it('without a translator the original stays, with a note', async () => {
    view(room, { targetLang: 'ja' })
    await say(room, 'badadib', { id: 0, text: 'Thanks for watching', final: true })
    expect(screen.getByText('Thanks for watching')).toBeInTheDocument()
    expect(await screen.findByText(/this browser cannot translate captions/)).toBeInTheDocument()
  })

  it('renders nothing while the viewer has captions off', async () => {
    render(<RoomContext.Provider value={room}><StreamCaptions show={false} /></RoomContext.Provider>)
    await say(room, 'badadib', { id: 0, text: 'Hidden', final: true })
    expect(screen.queryByText('Hidden')).not.toBeInTheDocument()
  })
})
