// @vitest-environment jsdom
// The OBS dock's live controls (/obs/chat?dock=1&control=<dock key>): the dock
// trades its key for a dock session and shows Chat, Polls and raids, and Boosts
// (payout locked). Without a key, or with an old one, it is the chat only.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const API = 'https://live.example'
const roomInfo = vi.hoisted(() => ({ metadata: '' }))
const META = JSON.stringify({ boost: { enabled: true, minBoostUsd: 1, creatorPayoutAccount: 'badadib' } })

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }) => <div data-testid="lk-room">{children}</div>,
  useParticipants: () => [],
  useRoomInfo: () => ({ metadata: roomInfo.metadata }),
}))
const seen = { provider: [], live: [], boost: [] }
vi.mock('@snapie/hangouts-react', () => ({
  useChat: () => ({ messages: [] }),
  resolveStreamCap: () => ({ capMs: 4 * 3600 * 1000 }),
  BoostAlerts: () => null,
  HangoutsProvider: (props) => { seen.provider.push(props); return props.children },
  StudioLivePanel: (props) => { seen.live.push(props); return <div data-testid="live-panel" /> },
  BoostSettingsPanel: (props) => { seen.boost.push(props); return <div data-testid="boost-panel" /> },
}))

let sessionStatus
let offline = false
let clips = { room: null, count: 0, clippers: 0 }
let vod = {}
function installFetch() {
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u.includes('/overlay/')) return ok(offline ? { live: false, room: null } : { live: true, room: 'badadib-live' })
    if (u.endsWith('/dock/clips')) { seen.clipsAuth = init?.headers?.Authorization; return ok(clips) }
    if (u.includes('/api/embed?v=badadib/badadib-old')) return ok(vod)
    if (u.endsWith('/listen')) return ok({ token: 'tok' })
    if (u.endsWith('/dock/session')) {
      seen.sessionBody = JSON.parse(init.body)
      return sessionStatus === 200 ? ok({ token: 'dock-tok', username: 'badadib' }) : { ok: false, status: sessionStatus, json: async () => ({}) }
    }
    if (u.endsWith('/boost/summary')) return ok({ goal: null, count: 0, totalHbd: 0, top: [] })
    if (u.includes('/rooms/badadib-live')) return ok({ host: 'badadib', liveAt: new Date().toISOString(), boost: { enabled: true, minBoostUsd: 3, creatorPayoutAccount: 'badadib' } })
    if (u.includes('/premium/')) return ok({ premium: true })
    return { ok: false, status: 404, json: async () => ({}) }
  })
}

async function renderDock(search) {
  window.history.replaceState(null, '', `/obs/chat${search}`)
  vi.stubEnv('VITE_HANGOUTS_TEMPLATES_API_URL', API)
  vi.resetModules()
  await import('../../../src/i18n')
  const { default: ObsChatOverlay } = await import('../../../src/page/ObsChatOverlay.jsx')
  return render(<ObsChatOverlay />)
}

describe('OBS dock controls', () => {
  beforeEach(() => { seen.provider.length = 0; seen.live.length = 0; seen.boost.length = 0; sessionStatus = 200; offline = false; clips = { room: null, count: 0, clippers: 0 }; vod = {}; localStorage.clear(); roomInfo.metadata = META; installFetch() })
  afterEach(() => { vi.unstubAllEnvs() })

  it('with the dock key: Chat, Polls and raids, Boosts, signed in as the dock', async () => {
    await renderDock('?key=k1&dock=1&control=badadib.secret')
    fireEvent.click(await screen.findByRole('tab', { name: 'Polls and raids' }))
    expect(seen.sessionBody).toEqual({ key: 'badadib.secret' })
    expect(await screen.findByTestId('live-panel')).toBeInTheDocument()
    expect(seen.live.at(-1).roomName).toBe('badadib-live')
    expect(seen.provider.at(-1)).toMatchObject({ apiBaseUrl: API, sessionToken: 'dock-tok', username: 'badadib' })

    fireEvent.click(screen.getByRole('tab', { name: 'Boosts' }))
    expect(await screen.findByTestId('boost-panel')).toBeInTheDocument()
    expect(seen.boost.at(-1)).toMatchObject({ roomName: 'badadib-live', payoutLocked: true, currentConfig: { minBoostUsd: 1 } })

    fireEvent.click(screen.getByRole('tab', { name: 'Chat' }))
    expect(await screen.findByText(/You are live/)).toBeInTheDocument()
  })

  it('opens the boost form only on the room\'s real settings, from the server before the room metadata arrives', async () => {
    roomInfo.metadata = ''
    await renderDock('?key=k1&dock=1&control=badadib.secret')
    fireEvent.click(await screen.findByRole('tab', { name: 'Boosts' }))
    expect(await screen.findByTestId('boost-panel')).toBeInTheDocument()
    expect(seen.boost.every((p) => p.currentConfig?.minBoostUsd === 3)).toBe(true)
  })

  it('without a key: the chat only, and no session asked for', async () => {
    await renderDock('?key=k1&dock=1')
    expect(await screen.findByText(/You are live/)).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).endsWith('/dock/session'))).toBe(false)
  })

  it('a reset key: says so, and keeps the chat', async () => {
    sessionStatus = 401
    await renderDock('?key=k1&dock=1&control=badadib.old')
    expect(await screen.findByText(/This dock link was reset/)).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByText(/You are live/)).toBeInTheDocument()
  })

  it('over the video (no dock) the key is ignored', async () => {
    await renderDock('?key=k1&control=badadib.secret')
    await screen.findByTestId('lk-room')
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).endsWith('/dock/session'))).toBe(false)
  })

  describe('after the stream', () => {
    const PUBLISHED = { success: true, videoUrl: 'https://x/v.m3u8', status: 'published' }

    it('leads to the viewers\' clips once the VOD is up', async () => {
      offline = true
      clips = { room: 'badadib-old', count: 3, clippers: 2 }
      vod = PUBLISHED
      await renderDock('?key=k1&dock=1&control=badadib.secret')
      const link = await screen.findByRole('link', { name: /See the clip suggestions and post them/ })
      expect(link.getAttribute('href')).toMatch(/\/live\/clips\/badadib-old$/)
      expect(seen.clipsAuth).toBe('Bearer dock-tok')
      expect(screen.getByText(/3 clips from 2 viewers/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
      expect(screen.queryByRole('link', { name: /See the clip suggestions/ })).toBeNull()
    })

    it('waits while the VOD is still processing, and shows nothing without viewer clips', async () => {
      offline = true
      clips = { room: 'badadib-old', count: 3, clippers: 2 }
      vod = { ...PUBLISHED, isPlaceholder: true, status: 'processing' }
      await renderDock('?key=k1&dock=1&control=badadib.secret')
      await screen.findByText(/Not live right now/)
      await new Promise((r) => setTimeout(r, 20))
      expect(screen.queryByRole('link', { name: /See the clip suggestions/ })).toBeNull()
    })
  })
})

