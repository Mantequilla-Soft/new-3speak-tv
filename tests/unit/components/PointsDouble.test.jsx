// @vitest-environment jsdom
// Double points (components/Wallet/PointsDouble.jsx): the wallet banner and the
// Live page's one-line hint from GET /points/events, with the end time; nothing
// when the window is off, already over, or the route is missing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://live.test' }) }))
const { default: PointsDoubleBanner, PointsDoubleHint } = await import('../../../src/components/Wallet/PointsDouble.jsx')

let response
let calls
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(url); return response }))
})
afterEach(() => vi.unstubAllGlobals())

const events = (double) => ({ ok: true, json: async () => ({ double }) })
const later = new Date(Date.now() + 36 * 3600 * 1000).toISOString()

describe('double points', () => {
  it('shows the banner with the end time while active', async () => {
    response = events({ active: true, until: later })
    renderWithProviders(<PointsDoubleBanner />)
    expect(await screen.findByText('Double points')).toBeInTheDocument()
    expect(screen.getByText(/^Every earning pays twice until .+\.$/)).toBeInTheDocument()
    expect(calls[0]).toBe('https://live.test/points/events')
  })

  it('says "right now" without an end time', async () => {
    response = events({ active: true })
    renderWithProviders(<PointsDoubleBanner />)
    expect(await screen.findByText('Every earning pays twice right now.')).toBeInTheDocument()
  })

  it('the hint is one line with the end time', async () => {
    response = events({ active: true, until: later })
    renderWithProviders(<PointsDoubleHint />)
    expect(await screen.findByText(/^Double points until /)).toBeInTheDocument()
  })

  it.each([
    ['off', () => events({ active: false, next: later })],
    ['over', () => events({ active: true, until: new Date(Date.now() - 60000).toISOString() })],
    ['missing route', () => ({ ok: false, status: 404, json: async () => ({}) })],
    ['bad body', () => ({ ok: true, json: async () => ({}) })],
  ])('nothing when %s', async (_name, make) => {
    response = make()
    const { container } = renderWithProviders(<><PointsDoubleBanner /><PointsDoubleHint /></>)
    await waitFor(() => expect(calls).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.points-double, .points-double-hint')).toBeNull()
  })
})
