// @vitest-environment jsdom
// Live captions (H11), host side with the REAL SDK hook: nothing runs until the
// host switches captions on AND is live; then the studio takes a caption slot
// from the hangouts server, opens the speech session on the mic track, and
// sends the lines on the data channel; the replay subtitles are collected
// from the recording start.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { RoomContext } from '@livekit/components-react'
import { Room } from 'livekit-client'
import { HangoutsProvider, useStudioCaptions } from '@snapie/hangouts-react'

const API = 'https://hangouts.test'

function setup({ status = { enabled: true }, start = { ok: true, renewInSec: 30 }, startCode = 200 } = {}) {
  const room = new Room()
  const published = []
  room.localParticipant.publishData = vi.fn(async (data, opts) => { published.push({ msg: JSON.parse(new TextDecoder().decode(data)), opts }) })
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push(`${init?.method || 'GET'} ${String(url).replace(API, '')}`)
    if (String(url).endsWith('/captions/status')) return new Response(JSON.stringify(status), { status: 200 })
    if (String(url).endsWith('/captions/start')) return new Response(JSON.stringify(start), { status: startCode })
    return new Response('{}', { status: 200 })
  }))
  const sessions = []
  const source = vi.fn((track, o) => { const s = { track, o, stop: vi.fn() }; sessions.push(s); return s })
  const options = { source, languages: [{ code: 'en-us', label: 'American English' }] }
  const wrapper = ({ children }) => (
    <HangoutsProvider apiBaseUrl={API} livekitServerUrl="wss://lk.test" sessionToken="tok" username="badadib">
      <RoomContext.Provider value={room}>{children}</RoomContext.Provider>
    </HangoutsProvider>
  )
  const track = { id: 'mic' }
  const hook = renderHook(({ live, t }) => useStudioCaptions({ roomName: 'badadib-live1', options, live, track: t }), {
    wrapper, initialProps: { live: false, t: track },
  })
  return { hook, room, published, calls, sessions, source, track }
}

beforeEach(() => { localStorage.clear() })

describe('useStudioCaptions', () => {
  it('is off by default and asks the server nothing but whether it can caption', async () => {
    const h = setup()
    await waitFor(() => expect(h.hook.result.current.supported).toBe(true))
    expect(h.hook.result.current.enabled).toBe(false)
    h.hook.rerender({ live: true, t: h.track })
    await act(async () => {})
    expect(h.calls).toEqual(['GET /captions/status'])
    expect(h.source).not.toHaveBeenCalled()
  })

  it('switched on and live: slot, speech session, lines on the data channel', async () => {
    const h = setup()
    await waitFor(() => expect(h.hook.result.current.supported).toBe(true))
    act(() => h.hook.result.current.setEnabled(true))
    expect(localStorage.getItem('hh-captions-on')).toBe('1')
    expect(h.hook.result.current.status).toBe('waiting')
    h.hook.result.current.markRecordingStart()
    h.hook.rerender({ live: true, t: h.track })
    await waitFor(() => expect(h.hook.result.current.status).toBe('on'))
    expect(h.calls).toContain('POST /rooms/badadib-live1/captions/start')
    expect(h.sessions[0].track).toBe(h.track)
    expect(h.sessions[0].o.lang).toBe('en-us')
    act(() => { h.sessions[0].o.onText('hello i am live', true) })
    expect(h.published[0].msg).toEqual({ t: 'cap', id: 0, text: 'Hello I am live', final: true, lang: 'en-us' })
    expect(h.published[0].opts).toEqual({ reliable: true, topic: 'captions' })
    const replay = h.hook.result.current.takeCues()
    expect(replay.lang).toBe('en')
    expect(replay.cues[0].text).toBe('Hello I am live')
    // Off air: the session closes and the slot goes back.
    h.hook.rerender({ live: false, t: h.track })
    await act(async () => {})
    expect(h.sessions[0].stop).toHaveBeenCalled()
    expect(h.calls).toContain('POST /rooms/badadib-live1/captions/stop')
  })

  it('every slot in use: says so instead of captioning', async () => {
    localStorage.setItem('hh-captions-on', '1')
    const h = setup({ start: { reason: 'full' }, startCode: 429 })
    await waitFor(() => expect(h.hook.result.current.supported).toBe(true))
    h.hook.rerender({ live: true, t: h.track })
    await waitFor(() => expect(h.hook.result.current.status).toBe('full'))
    expect(h.source).not.toHaveBeenCalled()
  })

  it('a server without the captions route hides the setting', async () => {
    const h = setup({ status: { enabled: false } })
    await act(async () => {})
    await waitFor(() => expect(h.calls).toContain('GET /captions/status'))
    expect(h.hook.result.current.supported).toBe(false)
  })
})
