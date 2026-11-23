// @vitest-environment jsdom
// "Promote this video" (components/Promote/PromoteModal.jsx), issue #580: prices
// and the balance must never sit at "…" for good. A failed or hung load says so
// and offers Retry.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('axios', async (importOriginal) => {
  const real = (await importOriginal()).default
  return { default: Object.assign(Object.create(real), { create: real.create, get: (...a) => m.get(...a), put: vi.fn() }) }
})
vi.mock('../../../src/hive-api/api', () => ({ fetchBalances: (...a) => m.balances(...a) }))
vi.mock('../../../src/hive-api/aioha', () => ({ transferWithAioha: vi.fn(), isLoggedIn: () => true }))
vi.mock('../../../src/components/modal/usePostThumb', () => ({ default: () => ({}) }))
vi.mock('../../../src/utils/config', async (importOriginal) => ({
  ...(await importOriginal()),
  selfPromoEnabledFor: () => false,
}))

const { useAppStore } = await import('../../../src/lib/store')
const { default: PromoteModal } = await import('../../../src/components/Promote/PromoteModal.jsx')

const QUOTE = { success: true, account: 'threespeakfund', costPer24hHbd: 0.5, maxDays: 7, hbdPerHive: 0.25 }
const quoteOk = (url) => Promise.resolve({ data: /quote$/.test(url) ? QUOTE : { success: true, promotedUntil: null } })
const mount = () => renderWithProviders(<PromoteModal open onClose={() => {}} author="badadib" permlink="abc" />)

beforeEach(() => {
  useAppStore.setState({ user: 'badadib', authenticated: true })
  m.get = vi.fn(quoteOk)
  m.balances = vi.fn(async () => ({ hbd: 10, hive: 20 }))
})

describe('promoting a video', () => {
  it('shows the prices and the balance', async () => {
    mount()
    expect(await screen.findByText('0.500')).toBeInTheDocument()
    expect(await screen.findByText('10.000 HBD')).toBeInTheDocument()
    expect(m.get).toHaveBeenCalledWith(expect.stringMatching(/\/promote\/quote$/), expect.objectContaining({ timeout: expect.any(Number) }))
  })

  it('says the prices failed and loads them again on Retry', async () => {
    m.get = vi.fn((url) => (/quote$/.test(url) ? Promise.reject(new Error('Network Error')) : quoteOk(url)))
    const { user } = mount()
    expect(await screen.findByText('Could not load promotion pricing.')).toBeInTheDocument()
    expect(screen.queryByText('…')).not.toBeInTheDocument()
    m.get = vi.fn(quoteOk)
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('0.500')).toBeInTheDocument()
    expect(screen.queryByText('Could not load promotion pricing.')).not.toBeInTheDocument()
  })

  it('says the balance failed when the wallet lookup gives nothing back', async () => {
    m.balances = vi.fn(async () => undefined)
    const { user } = mount()
    expect(await screen.findByText('Could not load your balance.')).toBeInTheDocument()
    m.balances = vi.fn(async () => ({ hbd: 3, hive: 4 }))
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('3.000 HBD')).toBeInTheDocument()
  })

  it('gives up on a balance lookup that never answers', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      m.balances = vi.fn(() => new Promise(() => {}))
      mount()
      await vi.advanceTimersByTimeAsync(13000)
      await waitFor(() => expect(screen.getByText('Could not load your balance.')).toBeInTheDocument())
    } finally {
      vi.useRealTimers()
    }
  })
})
