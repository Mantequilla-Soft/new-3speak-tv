// @vitest-environment jsdom
// The OBS chat dock (/obs/chat?dock=1): the boost counter and goal come from the
// stream's tally (GET /rooms/:name/boost/summary), the ledger on an older
// server, and the dock plays the host's boost alerts (BoostAlerts) unless told not to.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const API = 'https://live.example'

vi.mock('@livekit/components-react', () => ({
  LiveKitRoom: ({ children }) => <div data-testid="lk-room">{children}</div>,
  useParticipants: () => [],
}))
const alertsProps = []
vi.mock('@snapie/hangouts-react', () => ({
  useChat: () => ({ messages: [] }),
  resolveStreamCap: () => ({ capMs: 4 * 3600 * 1000 }),
  BoostAlerts: (props) => { alertsProps.push(props); return <span data-testid="boost-alerts" /> },
}))

const SUMMARY = {
  goal: { title: 'New mic', targetHbd: 50, progressHbd: 12.5, reached: false },
  count: 2,
  totalHbd: 17.5,
  top: [{ account: 'fan', hbd: 10, count: 1 }],
}

let summaryStatus
function installFetch() {
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u.includes('/overlay/')) return ok({ live: true, room: 'badadib-live' })
    if (u.endsWith('/listen')) return ok({ token: 'tok' })
    if (u.endsWith('/boost/summary')) return summaryStatus === 200 ? ok(SUMMARY) : { ok: false, status: summaryStatus, json: async () => ({}) }
    if (u.includes('/boosts/ledger')) return ok([{ usdAmount: 3 }, { usdAmount: 1.25 }])
    if (u.includes('/rooms/badadib-live')) return ok({ host: 'badadib', liveAt: new Date().toISOString() })
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

describe('OBS chat dock boosts', () => {
  beforeEach(() => { alertsProps.length = 0; summaryStatus = 200; installFetch() })
  afterEach(() => { vi.unstubAllEnvs() })

  it('shows the total and the goal from the boost summary, and plays alerts', async () => {
    await renderDock('?key=k1&dock=1')
    expect(await screen.findByText('$17.50')).toBeInTheDocument()
    expect(screen.getByText('12.5 / 50 HBD')).toBeInTheDocument()
    expect(screen.getByTitle('New mic')).toBeInTheDocument()
    expect(screen.getByTestId('boost-alerts')).toBeInTheDocument()
    expect(alertsProps.at(-1).speechTemplate).toBe('{name} boosted {amount} {asset}. {message}')
    expect(globalThis.fetch.mock.calls.some(([u]) => String(u).includes('/boosts/ledger'))).toBe(false)
  })

  it('falls back to the ledger on a server without the summary route', async () => {
    summaryStatus = 404
    await renderDock('?key=k1&dock=1')
    expect(await screen.findByText('$4.25')).toBeInTheDocument()
    expect(screen.queryByText(/ HBD$/)).not.toBeInTheDocument()
  })

  it('plays no alerts with alerts=0, nor over the video unless alerts=1', async () => {
    const { unmount } = await renderDock('?key=k1&dock=1&alerts=0')
    await screen.findByText('$17.50')
    expect(screen.queryByTestId('boost-alerts')).not.toBeInTheDocument()
    unmount()

    const second = await renderDock('?key=k1')
    await waitFor(() => expect(screen.getByTestId('lk-room')).toBeInTheDocument())
    expect(screen.queryByTestId('boost-alerts')).not.toBeInTheDocument()
    second.unmount()

    await renderDock('?key=k1&alerts=1')
    expect(await screen.findByTestId('boost-alerts')).toBeInTheDocument()
  })
})
