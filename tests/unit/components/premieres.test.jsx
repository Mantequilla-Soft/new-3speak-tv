// Premieres in the app: the countdown with Notify me, the chat (live and the
// timecoded replay), the Upcoming premieres row, the in-app reminder and the
// "List as a premiere" switch. The checker calls are stand-ins.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const api = vi.hoisted(() => ({}))
vi.mock('../../../src/lib/premieres', async (orig) => ({
  ...(await orig()),
  fetchMyPremiereReminders: (...a) => api.mine(...a),
  setPremiereReminder: (...a) => api.remind(...a),
  fetchPremiereChat: (...a) => api.chat(...a),
  sendPremiereChat: (...a) => api.send(...a),
  removePremiereChat: (...a) => api.remove(...a),
  fetchUpcomingPremieres: (...a) => api.upcoming(...a),
}))
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => toasts }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: PremiereCountdown, splitCountdown } = await import('../../../src/components/Premiere/PremiereCountdown.jsx')
const { default: PremiereChat } = await import('../../../src/components/Premiere/PremiereChat.jsx')
const { default: UpcomingPremieres } = await import('../../../src/components/Premiere/UpcomingPremieres.jsx')
const { default: PremiereReminders } = await import('../../../src/components/Premiere/PremiereReminders.jsx')
const { default: PremiereSwitch } = await import('../../../src/components/Premiere/PremiereSwitch.jsx')
const { default: PremiereBar } = await import('../../../src/components/Premiere/PremiereBar.jsx')

const inMs = (ms) => new Date(Date.now() + ms).toISOString()
const premiere = (extra = {}) => ({
  owner: 'badadib', permlink: 'p1', title: 'Lake day', thumbnail: 'https://img.example/t.jpg',
  startAt: inMs(2 * 3600 * 1000 + 5 * 60 * 1000 + 7000), chatUntil: inMs(3 * 3600 * 1000), duration: 600, reminders: 4, state: 'upcoming', ...extra,
})

beforeEach(() => {
  api.mine = vi.fn(async () => ({ reminders: [], due: [] }))
  api.remind = vi.fn(async () => ({ reminded: true, reminders: 5 }))
  api.chat = vi.fn(async () => ({ messages: [], removed: [], open: true, state: 'live' }))
  api.send = vi.fn()
  api.remove = vi.fn(async () => ({ success: true }))
  api.upcoming = vi.fn(async () => ({ premieres: [], skew: 0 }))
  Object.values(toasts).forEach((f) => f.mockReset())
  useAppStore.setState({ authenticated: true, user: 'fan' })
  try { sessionStorage.clear() } catch { /* none */ }
})

describe('the countdown', () => {
  it('splits time into days, hours, minutes and seconds', () => {
    expect(splitCountdown((26 * 3600 + 61) * 1000)).toEqual({ days: 1, hours: 2, minutes: 1, seconds: 1 })
    expect(splitCountdown(-5)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })

  it('shows the time left, the title, the creator and how many wait; Notify me sets a reminder', async () => {
    const { user } = renderWithProviders(<PremiereCountdown premiere={premiere()} serverNow={() => Date.now()} />)
    expect(screen.getByText(/^02:05:0[67]$/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Lake day' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /@badadib/ })).toBeInTheDocument()
    expect(screen.getByText(/4 people waiting/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Notify me' }))
    expect(api.remind).toHaveBeenCalledWith('fan', 'badadib', 'p1', true)
    await waitFor(() => expect(toasts.success).toHaveBeenCalled())
  })

  it('already reminded: says so, and a click takes it back', async () => {
    api.mine = vi.fn(async () => ({ reminders: [premiere()], due: [] }))
    const { user } = renderWithProviders(<PremiereCountdown premiere={premiere()} serverNow={() => Date.now()} />)
    const b = await screen.findByRole('button', { name: 'You will be reminded' })
    expect(b).toHaveAttribute('aria-pressed', 'true')
    await user.click(b)
    expect(api.remind).toHaveBeenCalledWith('fan', 'badadib', 'p1', false)
  })

  it('signed out, the button leads to sign in', async () => {
    useAppStore.setState({ authenticated: false, user: null })
    const { user } = renderWithProviders(<PremiereCountdown premiere={premiere()} serverNow={() => Date.now()} />)
    await user.click(screen.getByRole('button', { name: 'Sign in to get a reminder' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/login')
    expect(api.remind).not.toHaveBeenCalled()
  })

  it('at zero it is starting, with no Notify me any more', () => {
    renderWithProviders(<PremiereCountdown premiere={premiere({ startAt: inMs(-1000) })} serverNow={() => Date.now()} starting />)
    expect(screen.getByText('Starting now')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Notify me' })).toBeNull()
  })
})

describe('the chat', () => {
  const msg = (id, user, text, offset, s) => ({ id, user, text, offset, at: new Date(Date.UTC(2026, 10, 15, 12, 0, s)).toISOString() })

  it('live: shows the messages, sends one, and its author can take it down', async () => {
    api.chat = vi.fn(async () => ({ messages: [msg('a', 'badadib', 'Welcome all', 2, 2)], removed: [], open: true }))
    api.send = vi.fn(async (_u, _o, _p, text) => msg('b', 'fan', text, 5, 5))
    const { user } = renderWithProviders(<PremiereChat owner="badadib" permlink="p1" live />)
    expect(await screen.findByText('Welcome all')).toBeInTheDocument()
    await user.type(screen.getByRole('textbox', { name: 'Write in the premiere chat' }), 'Hello there')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    expect(api.send).toHaveBeenCalledWith('fan', 'badadib', 'p1', 'Hello there')
    expect(await screen.findByText('Hello there')).toBeInTheDocument()
    // Only one remove button: the viewer's own message.
    const removes = screen.getAllByRole('button', { name: 'Remove message' })
    expect(removes).toHaveLength(1)
    await user.click(removes[0])
    await waitFor(() => expect(screen.queryByText('Hello there')).toBeNull())
    expect(api.remove).toHaveBeenCalledWith('fan', 'badadib', 'p1', 'b')
  })

  it('live: a refused message says why', async () => {
    api.send = vi.fn(async () => { throw Object.assign(new Error('slow'), { status: 429 }) })
    const { user } = renderWithProviders(<PremiereChat owner="badadib" permlink="p1" live />)
    await user.type(screen.getByRole('textbox'), 'x')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Slow down a little, then send again.'))
  })

  it('live: keeps polling for new messages', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderWithProviders(<PremiereChat owner="badadib" permlink="p1" live />)
      await waitFor(() => expect(api.chat).toHaveBeenCalledTimes(1))
      api.chat.mockResolvedValueOnce({ messages: [msg('c', 'fan2', 'late hello', 9, 9)], removed: [] })
      await act(async () => { await vi.advanceTimersByTimeAsync(3100) })
      expect(await screen.findByText('late hello')).toBeInTheDocument()
      expect(api.chat).toHaveBeenLastCalledWith('badadib', 'p1', 0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('signed out: a sign-in prompt instead of the composer', async () => {
    useAppStore.setState({ authenticated: false, user: null })
    renderWithProviders(<PremiereChat owner="badadib" permlink="p1" live />)
    expect(await screen.findByText('Sign in to chat.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('replay: timecoded messages, and a time seeks the video there', async () => {
    api.chat = vi.fn(async () => ({ messages: [msg('a', 'fan', 'this part!', 75, 1)], removed: [], open: false }))
    const onSeek = vi.fn()
    const { user } = renderWithProviders(<PremiereChat owner="badadib" permlink="p1" live={false} onSeek={onSeek} />)
    await user.click(await screen.findByRole('button', { name: 'Go to 1:15' }))
    expect(onSeek).toHaveBeenCalledWith(75)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('replay with nothing said says so', async () => {
    api.chat = vi.fn(async () => ({ messages: [], removed: [], open: false }))
    renderWithProviders(<PremiereChat owner="badadib" permlink="p1" live={false} />)
    expect(await screen.findByText('Nobody wrote in the premiere chat.')).toBeInTheDocument()
  })
})

describe('Upcoming premieres', () => {
  it('is not there when there are none', async () => {
    const { container } = renderWithProviders(<UpcomingPremieres />)
    await waitFor(() => expect(api.upcoming).toHaveBeenCalled())
    expect(container.querySelector('.upcoming-premieres')).toBeNull()
  })

  it('lists them with when they start, linking to the watch address', async () => {
    api.upcoming = vi.fn(async () => ({ premieres: [premiere(), premiere({ permlink: 'p2', title: 'Now on', startAt: inMs(-60000) })], skew: 0 }))
    renderWithProviders(<UpcomingPremieres owner="badadib" />)
    expect(await screen.findByRole('region', { name: 'Upcoming premieres' })).toBeInTheDocument()
    expect(api.upcoming).toHaveBeenCalledWith({ owner: 'badadib', limit: 12 })
    expect(screen.getByText('in 2 hours')).toBeInTheDocument()
    expect(screen.getByText('Premiere now')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Lake day/ })).toHaveAttribute('href', '/@badadib/p1')
  })
})

describe('the in-app reminder', () => {
  afterEach(() => vi.useRealTimers())

  it('a reminded premiere that just started shows once, with Watch', async () => {
    api.mine = vi.fn(async () => ({ reminders: [premiere({ startAt: inMs(-60 * 1000) })], due: [] }))
    const { unmount } = renderWithProviders(<PremiereReminders />)
    await waitFor(() => expect(toasts.info).toHaveBeenCalledTimes(1))
    expect(toasts.info.mock.calls[0][0]).toBe('"Lake day" by @badadib is starting now.')
    expect(toasts.info.mock.calls[0][1].action.label).toBe('Watch')
    unmount()
    renderWithProviders(<PremiereReminders />)
    await waitFor(() => expect(api.mine).toHaveBeenCalledTimes(2))
    expect(toasts.info).toHaveBeenCalledTimes(1)
  })

  it('one coming up shows when it starts, an old one never', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.mine = vi.fn(async () => ({ reminders: [premiere({ startAt: inMs(5000) }), premiere({ permlink: 'old', startAt: inMs(-3600 * 1000) })], due: [] }))
    renderWithProviders(<PremiereReminders />)
    await waitFor(() => expect(api.mine).toHaveBeenCalled())
    expect(toasts.info).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(toasts.info).toHaveBeenCalledTimes(1)
  })
})

describe('the switch and the bar', () => {
  it('"List as a premiere" is a switch', () => {
    const onChange = vi.fn()
    renderWithProviders(<PremiereSwitch checked={false} onChange={onChange} />)
    const s = screen.getByRole('switch', { name: 'List as a premiere' })
    expect(s).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(s)
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('the bar under the player offers the way back when the viewer is behind', () => {
    const onJump = vi.fn()
    const p = premiere({ startAt: inMs(-120 * 1000) })
    const { rerender } = renderWithProviders(<PremiereBar premiere={p} serverNow={() => Date.now()} currentTime={118} onJump={onJump} />)
    expect(screen.getByText('Started 2 minutes ago, everyone is watching together')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Back to the premiere' })).toBeNull()
    rerender(<PremiereBar premiere={p} serverNow={() => Date.now()} currentTime={30} onJump={onJump} />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to the premiere' }))
    expect(onJump.mock.calls[0][0]).toBeGreaterThan(119)
  })
})
