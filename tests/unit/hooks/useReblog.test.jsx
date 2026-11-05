// The Hive Reblog button (src/hooks/useReblog.js): who may reblog (a signed-in Hive
// account, not on their own post), whether it is already reblogged, the two-tap
// confirm (the first tap arms for 4 seconds, the second broadcasts), success and
// failure toasts, ignoring taps while busy, and starting over on another post
// without a stale answer from the previous one leaking in.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const me = vi.hoisted(() => ({ loggedIn: true, user: 'alice' }))
const hive = vi.hoisted(() => ({ call: null }))
const broadcast = vi.hoisted(() => ({ reblog: null }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }))
vi.mock('../../../src/utils/hiveNode', () => ({ hiveClient: { call: (...a) => hive.call(...a) } }))
vi.mock('../../../src/hive-api/aioha', () => ({
  isLoggedIn: () => me.loggedIn,
  getOperationUser: () => me.user,
  reblogWithAioha: (...a) => broadcast.reblog(...a),
}))

const { default: useReblog } = await import('../../../src/hooks/useReblog.js')

let toast
const mount = (author = 'bob', permlink = 'my-video') =>
  renderHook(({ a, p }) => useReblog(a, p, toast), { initialProps: { a: author, p: permlink } })

// A promise the test resolves by hand.
function deferred() {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  me.loggedIn = true
  me.user = 'alice'
  hive.call = vi.fn(async () => [])
  broadcast.reblog = vi.fn(async () => ({ success: true }))
  toast = { success: vi.fn(), error: vi.fn() }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.useRealTimers())

describe('who can reblog', () => {
  it.each([
    ['a logged-out viewer', () => { me.loggedIn = false }, 'bob', 'my-video'],
    ['the author, on their own post', () => { me.user = 'bob' }, 'bob', 'my-video'],
    ['a warm-up user with no Hive account', () => { me.user = null }, 'bob', 'my-video'],
    ['anyone, on a post with no Hive permlink', () => {}, 'bob', ''],
  ])('not %s', async (_, arrange, author, permlink) => {
    arrange()
    const { result } = mount(author, permlink)
    expect(result.current.canReblog).toBe(false)
    expect(hive.call).not.toHaveBeenCalled()
    await act(async () => { expect(await result.current.press()).toBe(false) })
    expect(broadcast.reblog).not.toHaveBeenCalled()
  })

  it('a signed-in viewer on someone else\'s post', () => {
    const { result } = mount()
    expect(result.current.canReblog).toBe(true)
    expect(result.current.label).toBe('common.reblog.reblog')
  })
})

describe('already reblogged', () => {
  it('asks Hive who reblogged the post, and shows Reblogged when the viewer did', async () => {
    hive.call.mockResolvedValue(['carol', 'alice'])
    const { result } = mount()
    expect(hive.call).toHaveBeenCalledWith('condenser_api', 'get_reblogged_by', ['bob', 'my-video'])
    await waitFor(() => expect(result.current.reblogged).toBe(true))
    expect(result.current.label).toBe('common.reblog.reblogged')
  })

  it('someone else\'s reblog does not count', async () => {
    hive.call.mockResolvedValue(['carol'])
    const { result } = mount()
    await act(async () => {})
    expect(result.current.reblogged).toBe(false)
  })

  it('a failed lookup leaves the button usable', async () => {
    hive.call.mockRejectedValue(new Error('timeout'))
    const { result } = mount()
    await act(async () => {})
    expect(result.current.reblogged).toBe(false)
    expect(result.current.canReblog).toBe(true)
  })

  it('pressing an already reblogged post does nothing', async () => {
    hive.call.mockResolvedValue(['alice'])
    const { result } = mount()
    await waitFor(() => expect(result.current.reblogged).toBe(true))
    await act(async () => { expect(await result.current.press()).toBe(false) })
    expect(result.current.armed).toBe(false)
    expect(broadcast.reblog).not.toHaveBeenCalled()
  })
})

describe('the two-tap confirm', () => {
  it('the first tap only arms the button', async () => {
    const { result } = mount()
    await act(async () => { expect(await result.current.press()).toBe(false) })
    expect(result.current.armed).toBe(true)
    expect(result.current.label).toBe('common.reblog.confirm')
    expect(broadcast.reblog).not.toHaveBeenCalled()
  })

  it('falls back after 4 seconds without a second tap', async () => {
    vi.useFakeTimers()
    const { result } = mount()
    await act(async () => { await result.current.press() })
    await act(async () => { await vi.advanceTimersByTimeAsync(3999) })
    expect(result.current.armed).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(result.current.armed).toBe(false)
    expect(result.current.label).toBe('common.reblog.reblog')
  })

  it('leaves no timer running after unmount', async () => {
    vi.useFakeTimers()
    const { result, unmount } = mount()
    await act(async () => { await result.current.press() })
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('the second tap reblogs, says so, and reports success to the caller', async () => {
    const { result } = mount()
    await act(async () => { await result.current.press() })
    let done
    await act(async () => { done = await result.current.press() })
    expect(done).toBe(true)
    expect(broadcast.reblog).toHaveBeenCalledWith('bob', 'my-video')
    expect(result.current).toMatchObject({ reblogged: true, armed: false, busy: false, label: 'common.reblog.reblogged' })
    expect(toast.success).toHaveBeenCalledWith('common.reblog.success')
  })

  it('is busy while broadcasting, and ignores a third tap meanwhile', async () => {
    const pending = deferred()
    broadcast.reblog.mockReturnValue(pending.promise)
    const { result } = mount()
    await act(async () => { await result.current.press() })
    let second
    act(() => { second = result.current.press() })
    expect(result.current.busy).toBe(true)
    await act(async () => { expect(await result.current.press()).toBe(false) })
    expect(broadcast.reblog).toHaveBeenCalledTimes(1)
    await act(async () => { pending.resolve({ success: true }); await second })
    expect(result.current.busy).toBe(false)
  })

  it.each([
    ['the broadcast is refused', () => broadcast.reblog.mockResolvedValue({ success: false, error: 'RC exhausted' })],
    ['the broadcast throws', () => broadcast.reblog.mockRejectedValue(new Error('Keychain locked'))],
  ])('says it failed when %s, and can be tried again', async (_, arrange) => {
    arrange()
    const { result } = mount()
    await act(async () => { await result.current.press() })
    let done
    await act(async () => { done = await result.current.press() })
    expect(done).toBe(false)
    expect(toast.error).toHaveBeenCalledWith('common.reblog.failed')
    expect(toast.success).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ reblogged: false, busy: false, armed: false })
  })
})

describe('another post', () => {
  it('starts over: not reblogged, not armed', async () => {
    hive.call.mockResolvedValue(['alice'])
    const { result, rerender } = mount()
    await waitFor(() => expect(result.current.reblogged).toBe(true))
    hive.call.mockResolvedValue([])
    rerender({ a: 'bob', p: 'other-video' })
    expect(result.current.reblogged).toBe(false)
    expect(hive.call).toHaveBeenLastCalledWith('condenser_api', 'get_reblogged_by', ['bob', 'other-video'])
  })

  it('a late answer for the previous post is ignored', async () => {
    const first = deferred()
    hive.call.mockReturnValueOnce(first.promise).mockResolvedValue([])
    const { result, rerender } = mount()
    rerender({ a: 'bob', p: 'other-video' })
    await act(async () => { first.resolve(['alice']); await first.promise })
    expect(result.current.reblogged).toBe(false)
  })

  it('an armed button is disarmed', async () => {
    const { result, rerender } = mount()
    await act(async () => { await result.current.press() })
    rerender({ a: 'dana', p: 'x' })
    expect(result.current.armed).toBe(false)
  })
})
