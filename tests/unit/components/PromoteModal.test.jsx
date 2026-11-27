// @vitest-environment jsdom
// "Promote this video" (components/Promote/PromoteModal.jsx), issue #580: prices
// and the balance must never sit at "…" for good. A failed or hung load says so
// and offers Retry. Paying with 3Speak Points: the option shows only when the
// live server sells it and someone is signed in, and the spend follows the
// 428 sign / 202 pending protocol (lib/pointsSpend.js).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('axios', async (importOriginal) => {
  const real = (await importOriginal()).default
  return { default: Object.assign(Object.create(real), { create: real.create, get: (...a) => m.get(...a), put: vi.fn() }) }
})
vi.mock('../../../src/hive-api/api', () => ({ fetchBalances: (...a) => m.balances(...a) }))
vi.mock('../../../src/hive-api/aioha', () => ({ transferWithAioha: vi.fn(), isLoggedIn: () => true, broadcastWithAioha: (...a) => m.broadcast(...a) }))
vi.mock('../../../src/context/HangoutContext', () => ({ useHangoutOptional: () => m.hangout }))
vi.mock('../../../src/components/Wallet/channelPoints', () => ({ usePointsInfo: (user) => (user ? m.points : null) }))
// The module makes its toast once, at import: each call goes to this test's m.toast.
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => new Proxy({}, { get: (_, k) => (...a) => m.toast[k](...a) }) }))
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
  m.hangout = null
  m.points = null
  m.broadcast = vi.fn()
  m.toast = { error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn() }
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

describe('promoting with 3Speak Points', () => {
  const LIVE = 'https://live.example'
  const future = () => new Date(Date.now() + 2 * 86400000).toISOString()
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  let posts
  let spends

  // The live server: the quote, then the answers to POST /points/promote and
  // GET /points/spends/:id in turn.
  function liveServer({ quote = { per24h: 5000, maxDays: 7, enabled: true }, quoteStatus = 200 } = {}) {
    posts = []
    spends = []
    const f = vi.fn(async (url, init = {}) => {
      if (url === `${LIVE}/points/promote/quote`) return json(quoteStatus, quote)
      if (url === `${LIVE}/points/promote` && init.method === 'POST') return posts.shift() || json(500, {})
      if (url.startsWith(`${LIVE}/points/spends/`)) return spends.shift() || json(200, { status: 'sent' })
      return json(404, {})
    })
    vi.stubGlobal('fetch', f)
    return f
  }
  const promoteCalls = (f) => f.mock.calls.filter(([url]) => url === `${LIVE}/points/promote`)
  const pointsTab = () => screen.findByRole('tab', { name: 'Points' })

  let onPromoted
  let onClose
  const mountPoints = (props = {}) => renderWithProviders(
    <PromoteModal open onClose={onClose} onPromoted={onPromoted} author="badadib" permlink="abc" {...props} />,
  )

  beforeEach(() => {
    vi.stubEnv('VITE_HANGOUTS_API_URL', LIVE)
    m.hangout = { retryLogin: vi.fn(async () => 'tok') }
    m.points = { balance: 20000 }
    onPromoted = vi.fn()
    onClose = vi.fn()
  })

  it('offers Points next to HBD and HIVE when the live server sells it', async () => {
    liveServer()
    mountPoints()
    expect(await pointsTab()).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'HBD' })).toBeInTheDocument()
  })

  it('shows no Points option without a quote route, a disabled quote, a sign-in or a live session', async () => {
    const cases = [
      () => liveServer({ quoteStatus: 404 }),
      () => liveServer({ quote: { per24h: 5000, maxDays: 7, enabled: false } }),
      () => { liveServer(); useAppStore.setState({ user: null, authenticated: false }) },
      () => { liveServer(); m.hangout = null },
    ]
    for (const setup of cases) {
      setup()
      const { unmount } = mountPoints()
      await screen.findByRole('tab', { name: 'HBD' })
      await new Promise((r) => setTimeout(r, 20))
      expect(screen.queryByRole('tab', { name: 'Points' })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('prices per24h times the days, with thousands separators', async () => {
    liveServer()
    const { user } = mountPoints()
    await user.click(await pointsTab())
    expect(screen.getByText('5,000')).toBeInTheDocument()
    expect(screen.getByText('15,000')).toBeInTheDocument()
    expect(screen.getByText('35,000')).toBeInTheDocument()
    expect(screen.getByText('Your balance', { exact: false })).toHaveTextContent('20,000 points')
    expect(screen.getByRole('button', { name: /Promote for 5,000 points/ })).toBeEnabled()
    await user.click(screen.getByText('15,000').closest('button'))
    expect(screen.getByRole('button', { name: /Promote for 15,000 points/ })).toBeEnabled()
    expect(screen.getByText('Paid with your 3Speak Points. Your wallet may ask you to sign once.')).toBeInTheDocument()
  })

  it('turns the button off when the points do not cover it', async () => {
    liveServer()
    m.points = { balance: 4000 }
    const { user } = mountPoints()
    await user.click(await pointsTab())
    expect(screen.getByRole('button', { name: /Not enough points/ })).toBeDisabled()
  })

  it('pays with the live session and hands back promotedUntil', async () => {
    const f = liveServer()
    const until = future()
    const { user } = mountPoints()
    await user.click(await pointsTab())
    posts.push(json(201, { promotedUntil: until, balance: 15000 }))
    await user.click(screen.getByRole('button', { name: /Promote for 5,000 points/ }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(until))
    expect(onClose).toHaveBeenCalled()
    expect(m.hangout.retryLogin).toHaveBeenCalledWith('badadib', { interactive: false })
    const [, init] = promoteCalls(f)[0]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok' })
    expect(JSON.parse(init.body)).toEqual({ author: 'badadib', permlink: 'abc', days: 1 })
    expect(m.toast.success).toHaveBeenCalled()
  })

  it('asks the wallet for a session when the silent sign-in gives none', async () => {
    liveServer()
    m.hangout.retryLogin = vi.fn(async (_u, { interactive }) => (interactive ? 'tok2' : null))
    const { user } = mountPoints()
    await user.click(await pointsTab())
    posts.push(json(201, { promotedUntil: future() }))
    await user.click(screen.getByRole('button', { name: /Promote for/ }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(m.hangout.retryLogin).toHaveBeenLastCalledWith('badadib', { interactive: true })
  })

  it('has the wallet sign the burn on a 428 and sends it again with burnTx', async () => {
    const f = liveServer()
    const op = ['custom_json', { id: 'magi', required_posting_auths: ['badadib'], json: '{}' }]
    m.broadcast = vi.fn(async () => ({ success: true, result: 'tx1' }))
    const { user } = mountPoints()
    await user.click(await pointsTab())
    posts.push(json(428, { code: 'sign', op }), json(201, { promotedUntil: future() }))
    await user.click(screen.getByRole('button', { name: /Promote for/ }))
    await waitFor(() => expect(onPromoted).toHaveBeenCalled())
    expect(m.broadcast).toHaveBeenCalledWith([op], 'posting')
    expect(JSON.parse(promoteCalls(f)[1][1].body)).toMatchObject({ burnTx: 'tx1', days: 1 })
  })

  it('follows a 202 until the spend is confirmed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      liveServer()
      const until = future()
      const { user } = mountPoints()
      await user.click(await pointsTab())
      posts.push(json(202, { pending: true, spendId: 's1' }))
      spends.push(json(200, { status: 'sent' }), json(200, { status: 'ok', promotedUntil: until }))
      await user.click(screen.getByRole('button', { name: /Promote for/ }))
      await waitFor(() => expect(m.toast.message).toHaveBeenCalledWith('Spending your points. This can take a minute.'))
      await vi.advanceTimersByTimeAsync(7000)
      await waitFor(() => expect(onPromoted).toHaveBeenCalledWith(until))
    } finally {
      vi.useRealTimers()
    }
  })

  it('says what went wrong and stays open', async () => {
    liveServer()
    const { user } = mountPoints()
    await user.click(await pointsTab())
    posts.push(json(409, { code: 'ineligible', reason: 'short', message: 'Not eligible' }))
    await user.click(screen.getByRole('button', { name: /Promote for/ }))
    await waitFor(() => expect(m.toast.error).toHaveBeenCalledWith('This video cannot be promoted right now.'))
    posts.push(json(503, { message: 'Your points are back.' }))
    await user.click(screen.getByRole('button', { name: /Promote for/ }))
    await waitFor(() => expect(m.toast.error).toHaveBeenCalledWith('Your points are back.'))
    expect(onClose).not.toHaveBeenCalled()
    expect(onPromoted).not.toHaveBeenCalled()
  })

  it('still blocks a video that is already promoted', async () => {
    liveServer()
    const until = future()
    m.get = vi.fn((url) => Promise.resolve({ data: /quote$/.test(url) ? QUOTE : { success: true, promotedUntil: until } }))
    mountPoints()
    const banner = await screen.findByText('This video is already promoted until')
    expect(banner).toBeInTheDocument()
    expect(within(document.body).queryByRole('button', { name: /Promote for/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Points' })).not.toBeInTheDocument()
  })
})
