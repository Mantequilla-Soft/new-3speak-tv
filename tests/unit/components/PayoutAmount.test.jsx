// @vitest-environment jsdom
// The reward badge on cards, audio rows and the watch page (components/
// PayoutAmount): a signed-in Hive account sees the reward in dollars, while a
// guest or a warm-up account (no Hive account yet) sees it in HIVE, converted
// with the chain's median price feed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'

vi.mock('../../../src/utils/hiveNode', () => ({ getHiveUrl: () => 'https://api.hive.example', getHiveClient: () => ({}) }))
vi.mock('../../../src/hive-api/aioha', () => ({ aioha: { getCurrentUser: () => null } }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: PayoutAmount } = await import('../../../src/components/PayoutAmount/PayoutAmount')

// 0.25 HBD per HIVE: $1.00 is 4 HIVE. Spied per test (the config restores
// mocks after each one); the store resets BEFORE each test so no badge from
// the last one re-renders as a guest once the spy is gone.
let fetchSpy
beforeEach(() => {
  act(() => useAppStore.setState({ user: null, authenticated: false, incubationHandle: null }))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    json: async () => ({ result: { base: '0.250 HBD', quote: '1.000 HIVE' } }),
  })
})

describe('PayoutAmount', () => {
  it('shows a Hive account the dollar value and does not load the price', () => {
    act(() => useAppStore.setState({ user: 'badadib', authenticated: true }))
    render(<PayoutAmount amount={1.5} />)
    expect(screen.getByText('$1.50')).toBeInTheDocument()
    expect(screen.queryByText(/HIVE/)).not.toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('shows a guest the HIVE value', async () => {
    render(<PayoutAmount amount={1.5} />)
    expect(await screen.findByText('6.00')).toBeInTheDocument()
    expect(screen.queryByText(/HIVE/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })

  it('shows a warm-up account the HIVE value', async () => {
    act(() => useAppStore.setState({ user: null, authenticated: true, incubationHandle: 'newbie' }))
    render(<PayoutAmount amount={0.5} />)
    expect(await screen.findByText('2.00')).toBeInTheDocument()
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument()
  })
})
