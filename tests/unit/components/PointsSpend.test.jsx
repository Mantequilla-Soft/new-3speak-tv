// @vitest-environment jsdom
// "What you can do with your points" on the points card (PointsCard.jsx +
// pointsSpend.js): every way to spend points with its price from the live
// server, a button where the balance covers it, how many are missing where not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, within } from '@testing-library/react'
import i18n from 'i18next'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://live.test' }) }))
const { default: PointsCard } = await import('../../../src/components/Wallet/PointsCard.jsx')
const { buildSpendRows } = await import('../../../src/components/Wallet/pointsSpend.js')
const { readPromoteQuote } = await import('../../../src/components/Wallet/channelPoints.js')

const info = (balance) => ({ account: 'badadib', balance, start: 1000, ttlDays: 90, earn: {}, boostMin: 2500 })
let quote
beforeEach(() => {
  quote = { enabled: true, per24h: 5000, maxDays: 7 }
  vi.stubGlobal('fetch', vi.fn(async (url) => (url.endsWith('/points/promote/quote')
    ? { ok: true, json: async () => quote }
    : { ok: false, json: async () => ({}) })))
})
afterEach(() => vi.unstubAllGlobals())

const region = () => screen.findByRole('region', { name: 'What you can do with your points' })

describe('what you can do with your points', () => {
  it('a button for everything the balance covers', async () => {
    renderWithProviders(<PointsCard info={info(6000)} own />)
    const r = await region()
    expect(await within(r).findByText('Put a video at the top of Discover')).toBeTruthy()
    expect(within(r).getByText('5,000 a day')).toBeTruthy()
    expect(within(r).getByText('from 2,500')).toBeTruthy()
    expect(within(r).getByText('any amount')).toBeTruthy()
    expect(within(r).getByRole('link', { name: 'Pick a video' }).getAttribute('href')).toBe('/profile')
    expect(within(r).getAllByRole('link', { name: 'Find a live stream' }).map((a) => a.getAttribute('href'))).toEqual(['/live', '/live'])
  })

  it('what the balance does not cover says how many points are missing, with no button', async () => {
    renderWithProviders(<PointsCard info={info(2000)} own />)
    const r = await region()
    expect(await within(r).findByText('3,000 more needed')).toBeTruthy()
    expect(within(r).getByText('500 more needed')).toBeTruthy()
    expect(within(r).queryByRole('link', { name: 'Pick a video' })).toBeNull()
    // A prediction takes any amount: still a button.
    expect(within(r).getAllByRole('link', { name: 'Find a live stream' })).toHaveLength(1)
  })

  it('only on your own wallet', async () => {
    renderWithProviders(<PointsCard info={info(6000)} />)
    await screen.findByText(/Earned on 3Speak/)
    expect(screen.queryByRole('region', { name: 'What you can do with your points' })).toBeNull()
  })

  it('without the promote price only the stream spends show', () => {
    const t = i18n.t.bind(i18n)
    expect(buildSpendRows(t, { balance: 100, boostMin: 2500, promote: null }).map((r) => r.key)).toEqual(['boost', 'predict'])
    expect(buildSpendRows(t, { balance: 100 }).map((r) => r.key)).toEqual(['predict'])
    expect(readPromoteQuote({ enabled: false, per24h: 5000 })).toBeNull()
    expect(readPromoteQuote({ enabled: true, per24h: 5000 })).toEqual({ per24h: 5000, maxDays: 7 })
  })
})
