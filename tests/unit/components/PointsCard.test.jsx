// @vitest-environment jsdom
// Wallet > Channel points (components/Wallet/PointsCard.jsx): the balance and
// the movements from the live server's public routes, "Show more" paging back,
// and nothing at all when that server has no points routes.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://live.test' }) }))
const { default: PointsCard } = await import('../../../src/components/Wallet/PointsCard.jsx')

const info = {
  account: 'badadib', balance: 4250, expiresAt: '2027-02-16T00:00:00.000Z', start: 1000, ttlDays: 90,
  earn: { watchPerMin: 10, chatPerWord: 1, streamPerMin: 100, raid: 500, battle: 500, boostMax: 2000 }, boostMin: 2500,
}
const row = (id, delta, kind, extra = {}) => ({ id, delta, kind, at: '2026-11-18T10:00:00.000Z', tx: null, ...extra })

let calls
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    calls.push(url)
    if (url.endsWith('/users/badadib/points')) return { ok: true, json: async () => info }
    if (url.includes('/points/history') && url.includes('before=')) {
      return { ok: true, json: async () => ({ items: [row('c', -2500, 'spend'), row('d', -700, 'expire')], next: null }) }
    }
    if (url.includes('/points/history')) {
      return { ok: true, json: async () => ({ items: [row('a', 100, 'watch', { tx: 'abc123' }), row('b', 500, 'raid', { ref: 'fan2' })], next: 1795000000000 }) }
    }
    return { ok: false, json: async () => ({}) }
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('PointsCard', () => {
  it('shows the balance, the movements and their Hive link', async () => {
    renderWithProviders(<PointsCard user="badadib" own />)
    expect(await screen.findByText('4,250')).toBeTruthy()
    expect(screen.getByText('Watched streams')).toBeTruthy()
    expect(screen.getByText('Raided @fan2')).toBeTruthy()
    expect(screen.getByText('+500')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'on Hive' }).getAttribute('href')).toBe('https://hivehub.dev/tx/abc123')
    expect(screen.getByText(/Kept until/)).toBeTruthy()
  })

  it('pages back with Show more', async () => {
    renderWithProviders(<PointsCard user="badadib" own />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Points boost')).toBeTruthy()
    expect(screen.getByText('−2,500')).toBeTruthy()
    expect(screen.getByText('Reset after 90 days without activity')).toBeTruthy()
    expect(calls.some((u) => u.includes('before=1795000000000'))).toBe(true)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull())
  })

  it('stays hidden when the server has no points', async () => {
    const { container } = renderWithProviders(<PointsCard user="nobody" own />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(container.querySelector('.points-card')).toBeNull()
  })
})
