// @vitest-environment jsdom
// The weekly quests in the wallet (components/Wallet/PointsQuests.jsx): the
// signed-in account's quests from GET /points/quests?user=, a progress bar
// each, a done state with the points, an unknown title key read as a generic
// "Weekly quest", and nothing at all when the route is missing or fails.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://live.test' }) }))
const { default: PointsQuests } = await import('../../../src/components/Wallet/PointsQuests.jsx')

const body = {
  week: '2026-W48',
  quests: [
    { id: 'finish3', kind: 'finish', target: 3, progress: 2, done: false, points: 300, title_key: 'wallet.points.quests.finish3' },
    { id: 'listen30', kind: 'listen', target: 30, progress: 45, done: true, points: 300, title_key: 'wallet.points.quests.listen30' },
    { id: 'raid1', kind: 'raid', target: 1, progress: 0, done: false, points: 300, title_key: 'wallet.points.quests.raid1' },
  ],
}

let response
let calls
beforeEach(() => {
  calls = []
  response = { ok: true, json: async () => body }
  vi.stubGlobal('fetch', vi.fn(async (url) => { calls.push(url); return typeof response === 'function' ? response() : response }))
})
afterEach(() => vi.unstubAllGlobals())

describe('weekly quests', () => {
  it('shows each quest with its progress, done state and points', async () => {
    renderWithProviders(<PointsQuests user="badadib" />)
    expect(await screen.findByText('Weekly quests')).toBeInTheDocument()
    expect(calls[0]).toBe('https://live.test/points/quests?user=badadib')
    expect(screen.getByText('Watch 3 videos to the end')).toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument()
    const bars = screen.getAllByRole('progressbar')
    expect(bars.map((b) => b.getAttribute('aria-valuenow'))).toEqual(['67', '100', '0'])
    // Done: says so, and the bar is full even when the count went past.
    expect(screen.getByText('Listen for 30 minutes').closest('li').className).toMatch(/is-done/)
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getAllByText('+300')).toHaveLength(3)
    // A key this app does not have: generic, never the raw key.
    expect(screen.getByText('Weekly quest')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/wallet\.points\.quests/)
  })

  it('renders nothing when the route is missing', async () => {
    response = { ok: false, status: 404, json: async () => ({ message: 'Not found' }) }
    const { container } = renderWithProviders(<PointsQuests user="badadib" />)
    await waitFor(() => expect(calls).toHaveLength(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.points-quests')).toBeNull()
  })

  it('renders nothing when the request fails or there are no quests', async () => {
    response = () => { throw new Error('offline') }
    const { container, unmount } = renderWithProviders(<PointsQuests user="badadib" />)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(container.querySelector('.points-quests')).toBeNull()
    unmount()
    response = { ok: true, json: async () => ({ week: '2026-W48', quests: [] }) }
    const second = renderWithProviders(<PointsQuests user="badadib" />)
    await waitFor(() => expect(calls).toHaveLength(2))
    await new Promise((r) => setTimeout(r, 0))
    expect(second.container.querySelector('.points-quests')).toBeNull()
  })

  it('asks nothing without a user', () => {
    renderWithProviders(<PointsQuests user={null} />)
    expect(calls).toHaveLength(0)
  })
})
