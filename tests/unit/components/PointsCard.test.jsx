// @vitest-environment jsdom
// Wallet > Channel points: the balance card (components/Wallet/PointsCard.jsx),
// its info from the live server (usePointsInfo, nothing when that server has no
// points routes), and the movements in the Activity list's Points filter
// (TrxHistory + PointsHistory), "Show more" paging back.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor, renderHook } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://live.test' }) }))
const history = vi.fn(async () => [])
vi.mock('../../../src/utils/hiveNode', () => ({
  getHiveClient: () => ({ database: { getAccountHistory: history, getDynamicGlobalProperties: vi.fn() } }),
}))
const { default: PointsCard } = await import('../../../src/components/Wallet/PointsCard.jsx')
const { default: TrxHistory } = await import('../../../src/components/Wallet/TrxHistory.jsx')
const { usePointsInfo } = await import('../../../src/components/Wallet/channelPoints.js')

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
  it('shows the balance, how long it is kept and how to earn, but no movements', () => {
    renderWithProviders(<PointsCard info={info} own />)
    expect(screen.getByText('4,250')).toBeTruthy()
    expect(screen.getByText(/Kept until/)).toBeTruthy()
    expect(screen.getByText('How to earn')).toBeTruthy()
    expect(screen.queryByText('Watched streams')).toBeNull()
  })

  it('its Points history button opens the movements', () => {
    const onShowHistory = vi.fn()
    renderWithProviders(<PointsCard info={info} own onShowHistory={onShowHistory} />)
    fireEvent.click(screen.getByRole('button', { name: 'Points history' }))
    expect(onShowHistory).toHaveBeenCalled()
  })

  it('draws nothing without points info', () => {
    const { container } = renderWithProviders(<PointsCard info={null} own />)
    expect(container.querySelector('.points-card')).toBeNull()
  })
})

describe('usePointsInfo', () => {
  it('reads the balance from the live server', async () => {
    const { result } = renderHook(() => usePointsInfo('badadib'))
    await waitFor(() => expect(result.current?.balance).toBe(4250))
  })

  it('stays null when the server has no points', async () => {
    const { result } = renderHook(() => usePointsInfo('nobody'))
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(result.current).toBeNull()
  })
})

describe('Activity > Points', () => {
  it('has no Points filter without points info', async () => {
    renderWithProviders(<TrxHistory user="badadib" />)
    expect(await screen.findByText('Nothing here yet')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Sent' })).toBeTruthy()
    expect(screen.queryByRole('tab', { name: 'Points' })).toBeNull()
  })

  it('the Points tab switches the list to the movements', async () => {
    const onFilter = vi.fn()
    renderWithProviders(<TrxHistory user="badadib" points={info} filter="all" onFilter={onFilter} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Points' }))
    expect(onFilter).toHaveBeenCalledWith('points')
  })

  it('lists the movements with their Hive link and pages back with Show more', async () => {
    renderWithProviders(<TrxHistory user="badadib" points={info} filter="points" onFilter={() => {}} />)
    expect(await screen.findByText('Watched streams')).toBeTruthy()
    expect(screen.getByText('Raided @fan2')).toBeTruthy()
    expect(screen.getByText('+500')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'on Hive' }).getAttribute('href')).toBe('https://hivehub.dev/tx/abc123')
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(await screen.findByText('Points boost')).toBeTruthy()
    expect(screen.getByText('−2,500')).toBeTruthy()
    expect(screen.getByText('Reset after 90 days without activity')).toBeTruthy()
    expect(calls.some((u) => u.includes('before=1795000000000'))).toBe(true)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull())
  })
})
