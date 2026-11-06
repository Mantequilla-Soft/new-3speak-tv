// webPush (src/utils/webPush.js): the browser side of push notifications. Three
// things must line up (support, permission, a subscription the server knows),
// and getPushState reports each one. The service worker container, the push
// manager, Notification and the checker API (fetch) are fakes; nothing is
// subscribed for real.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example' }))
// Our API's session vouch (lib/sessionVouch.js): none unless a test gives one.
const vouch = vi.hoisted(() => ({ fn: null }))
vi.mock('../../../src/lib/sessionVouch', () => ({ fetchSessionVouch: (...a) => vouch.fn(...a) }))

const {
  pushSupported, getPushState, enablePush, syncPushSubscription, disablePush, getPushPrefs, setPushPrefs,
} = await import('../../../src/utils/webPush.js')

const subscription = (endpoint = 'https://push.example/abc') => ({
  endpoint,
  toJSON: () => ({ endpoint, keys: { p256dh: 'k', auth: 'a' } }),
  unsubscribe: vi.fn(async () => true),
})

const registrationWith = ({ sub = null, active = true } = {}) => ({
  active: active ? { state: 'activated' } : null,
  pushManager: {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => subscription('https://push.example/new')),
  },
})

let regs // scope -> registration
let sw
let fetchMock
let permission

function installBrowser() {
  regs = {}
  permission = 'default'
  sw = {
    getRegistration: vi.fn(async (scope) => regs[scope]),
    register: vi.fn(async () => { throw new TypeError('bad script') }),
  }
  const NotificationFake = {
    get permission() { return permission },
    requestPermission: vi.fn(async () => permission),
  }
  vi.stubGlobal('navigator', { serviceWorker: sw })
  vi.stubGlobal('Notification', NotificationFake)
  vi.stubGlobal('window', { PushManager: class {}, Notification: NotificationFake })
}

const ok = (body = {}) => ({ ok: true, json: async () => body })
const notOk = () => ({ ok: false, json: async () => ({}) })

beforeEach(() => {
  vouch.fn = vi.fn(async () => null)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  installBrowser()
  fetchMock = vi.fn(async () => ok())
  vi.stubGlobal('fetch', fetchMock)
})

describe('pushSupported', () => {
  it('is true with service workers, PushManager and Notification', () => {
    expect(pushSupported()).toBe(true)
  })

  it.each([
    ['no window (server render)', () => vi.stubGlobal('window', undefined)],
    ['no service workers', () => vi.stubGlobal('navigator', {})],
    ['no PushManager (iOS outside an installed app)', () => { delete window.PushManager }],
    ['no Notification', () => { delete window.Notification }],
  ])('is false with %s', (_label, arrange) => {
    arrange()
    expect(pushSupported()).toBe(false)
  })
})

describe('getPushState', () => {
  it('says unsupported without touching service workers', async () => {
    delete window.PushManager
    expect(await getPushState()).toEqual({ supported: false, permission: 'unsupported', subscribed: false })
    expect(sw.getRegistration).not.toHaveBeenCalled()
  })

  it('prefers the dedicated push registration and reports its subscription', async () => {
    regs['/push-scope/'] = registrationWith({ sub: subscription() })
    regs['/'] = registrationWith()
    permission = 'granted'
    expect(await getPushState()).toEqual({ supported: true, worker: true, permission: 'granted', subscribed: true })
    expect(regs['/'].pushManager.getSubscription).not.toHaveBeenCalled()
  })

  it('uses the app\'s root worker when it is active', async () => {
    regs['/'] = registrationWith()
    expect(await getPushState()).toMatchObject({ worker: true, subscribed: false })
    expect(sw.register).not.toHaveBeenCalled()
  })

  it('registers the production worker at / when the root registration is half dead', async () => {
    regs['/'] = registrationWith({ active: false })
    sw.register.mockResolvedValueOnce(registrationWith())
    expect(await getPushState()).toMatchObject({ worker: true })
    expect(sw.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
  })

  it('falls back to its own classic worker at a scope nothing else claims', async () => {
    sw.register
      .mockRejectedValueOnce(new TypeError('SPA shell is not a worker'))
      .mockResolvedValueOnce(registrationWith())
    expect(await getPushState()).toMatchObject({ worker: true })
    expect(sw.register).toHaveBeenLastCalledWith('/push-sw.js', { scope: '/push-scope/' })
  })

  it('gives a freshly created registration a moment to activate', async () => {
    vi.useFakeTimers()
    try {
      sw.register.mockResolvedValueOnce(registrationWith({ active: false }))
      let state
      getPushState().then((s) => { state = s })
      await vi.advanceTimersByTimeAsync(699)
      expect(state).toBeUndefined()
      await vi.advanceTimersByTimeAsync(1)
      expect(state).toMatchObject({ worker: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports "no worker" when nothing can be registered', async () => {
    permission = 'denied'
    expect(await getPushState()).toEqual({ supported: true, worker: false, permission: 'denied', subscribed: false })
    expect(sw.register).toHaveBeenCalledTimes(2)
  })
})

describe('enablePush', () => {
  beforeEach(() => {
    permission = 'granted'
    regs['/push-scope/'] = registrationWith()
    fetchMock.mockImplementation(async (url) => (url.endsWith('/push/vapid-key') ? ok({ publicKey: 'AQID-_8' }) : ok()))
  })

  it.each([
    ['the browser cannot do push', () => { delete window.PushManager }, 'alice', 'does not support notifications'],
    ['nobody is logged in', () => {}, '', 'Log in first'],
    ['permission is refused', () => { permission = 'denied' }, 'alice', 'Notifications are blocked for this site.'],
  ])('refuses when %s', async (_label, arrange, user, message) => {
    arrange()
    await expect(enablePush(user)).rejects.toThrow(message)
  })

  it('says notifications are not switched on when the server has no VAPID key', async () => {
    fetchMock.mockResolvedValueOnce(notOk())
    await expect(enablePush('alice')).rejects.toThrow('Notifications are not switched on yet.')
  })

  it('asks for a reload when no worker can be started', async () => {
    delete regs['/push-scope/']
    await expect(enablePush('alice')).rejects.toThrow(/background worker/)
  })

  it('subscribes with the VAPID key decoded from base64url and saves it for the user', async () => {
    expect(await enablePush('alice')).toBe(true)

    const { subscribe } = regs['/push-scope/'].pushManager
    const { userVisibleOnly, applicationServerKey } = subscribe.mock.calls[0][0]
    expect(userVisibleOnly).toBe(true)
    expect([...applicationServerKey]).toEqual([1, 2, 3, 251, 255])

    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://checker.example/push/subscribe')
    expect(JSON.parse(init.body)).toEqual({
      username: 'alice',
      subscription: { endpoint: 'https://push.example/new', keys: { p256dh: 'k', auth: 'a' } },
    })
  })

  it('reuses the subscription the browser already holds instead of making a second', async () => {
    regs['/push-scope/'] = registrationWith({ sub: subscription('https://push.example/old') })
    await enablePush('alice')
    expect(regs['/push-scope/'].pushManager.subscribe).not.toHaveBeenCalled()
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).subscription.endpoint).toBe('https://push.example/old')
  })

  it('fails when the server will not save the subscription', async () => {
    fetchMock.mockImplementation(async (url) => (url.endsWith('/push/vapid-key') ? ok({ publicKey: 'AQID' }) : notOk()))
    await expect(enablePush('alice')).rejects.toThrow('Could not save your notification settings.')
  })
})

describe('syncPushSubscription', () => {
  it('re-sends the browser\'s subscription for the user', async () => {
    regs['/push-scope/'] = registrationWith({ sub: subscription() })
    expect(await syncPushSubscription('alice')).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://checker.example/push/subscribe')
    expect(JSON.parse(init.body).username).toBe('alice')
  })

  it.each([
    ['push is unsupported', () => { delete window.PushManager }, 'alice'],
    ['nobody is logged in', () => {}, ''],
    ['the browser has no subscription', () => { regs['/push-scope/'] = registrationWith() }, 'alice'],
    ['there is no registration', () => {}, 'alice'],
  ])('does nothing when %s', async (_label, arrange, user) => {
    arrange()
    expect(await syncPushSubscription(user)).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not register a worker of its own', async () => {
    await syncPushSubscription('alice')
    expect(sw.register).not.toHaveBeenCalled()
  })

  it('returns false when the server is unreachable', async () => {
    regs['/push-scope/'] = registrationWith({ sub: subscription() })
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await syncPushSubscription('alice')).toBe(false)
  })
})

describe('disablePush', () => {
  it('tells the server the endpoint first, then unsubscribes locally', async () => {
    const sub = subscription('https://push.example/xyz')
    regs['/push-scope/'] = registrationWith({ sub })
    expect(await disablePush('alice')).toBe(true)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://checker.example/push/unsubscribe')
    expect(JSON.parse(init.body)).toEqual({ username: 'alice', endpoint: 'https://push.example/xyz' })
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(sub.unsubscribe.mock.invocationCallOrder[0])
  })

  it('still unsubscribes when the server cannot be told', async () => {
    const sub = subscription()
    regs['/push-scope/'] = registrationWith({ sub })
    fetchMock.mockRejectedValueOnce(new TypeError('offline'))
    expect(await disablePush('alice')).toBe(true)
    expect(sub.unsubscribe).toHaveBeenCalled()
  })

  it('succeeds quietly when the unsubscribe itself fails', async () => {
    const sub = subscription()
    sub.unsubscribe.mockRejectedValueOnce(new Error('gone'))
    regs['/push-scope/'] = registrationWith({ sub })
    expect(await disablePush('alice')).toBe(true)
  })

  it('is a no-op when there is nothing to unsubscribe', async () => {
    expect(await disablePush('alice')).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('getPushPrefs / setPushPrefs', () => {
  it('reads the kinds and choices for the user, with the name encoded', async () => {
    fetchMock.mockResolvedValueOnce(ok({ kinds: ['upload', 'live'], prefs: { live: false } }))
    expect(await getPushPrefs('a b')).toEqual({ kinds: ['upload', 'live'], prefs: { live: false } })
    expect(fetchMock).toHaveBeenCalledWith('https://checker.example/push/prefs?username=a%20b')
  })

  it.each([
    ['without a username', '', null],
    ['when the server refuses', 'alice', () => notOk()],
    ['when the server is unreachable', 'alice', () => { throw new TypeError('offline') }],
    ['when the answer has no fields', 'alice', () => ok({})],
  ])('falls back to empty preferences %s', async (_label, user, impl) => {
    if (impl) fetchMock.mockImplementationOnce(async () => impl())
    expect(await getPushPrefs(user)).toEqual({ kinds: [], prefs: {} })
  })

  it('saves choices and returns what the server stored', async () => {
    fetchMock.mockResolvedValueOnce(ok({ prefs: { live: true } }))
    expect(await setPushPrefs('alice', { live: true })).toEqual({ live: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://checker.example/push/prefs')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ username: 'alice', prefs: { live: true } })
  })

  it('returns no choices when the server echoes none', async () => {
    fetchMock.mockResolvedValueOnce(ok({}))
    expect(await setPushPrefs('alice', {})).toEqual({})
  })

  it('throws when the choices cannot be saved', async () => {
    fetchMock.mockResolvedValueOnce(notOk())
    await expect(setPushPrefs('alice', {})).rejects.toThrow('Could not save your notification choices.')
  })

  // Each test uses its own account: the vouch is cached per account for the module's life.
  const v = (user, signature = 'SIG', timestamp = Date.now()) => ({ user, signature, timestamp })
  const status = (code, body = {}) => ({ ok: code < 300, status: code, json: async () => body })
  const sentBodies = () => fetchMock.mock.calls.filter(([u]) => u.endsWith('/push/prefs')).map(([, i]) => JSON.parse(i.body))

  it('sends the session vouch for exactly that account, cleaned like the checker cleans it', async () => {
    vouch.fn = vi.fn(async (_a, user) => v(user))
    fetchMock.mockResolvedValueOnce(ok({ prefs: {} }))
    await setPushPrefs('@Vouched', { live: false })
    expect(vouch.fn).toHaveBeenCalledWith('push', 'vouched', { named: true })
    expect(sentBodies()[0]).toEqual({ username: '@Vouched', prefs: { live: false }, signature: 'SIG', timestamp: expect.any(Number) })
  })

  it('reuses one vouch for most of a day, then gets a new one', async () => {
    const start = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(start)
    vouch.fn = vi.fn(async (_a, user) => v(user, 'SIG', start))
    await setPushPrefs('reuser', {})
    await setPushPrefs('reuser', {})
    expect(vouch.fn).toHaveBeenCalledTimes(1)
    Date.now.mockReturnValue(start + 23 * 3600 * 1000 + 1)
    await setPushPrefs('reuser', {})
    expect(vouch.fn).toHaveBeenCalledTimes(2)
  })

  it('a cached vouch the checker refuses is replaced once', async () => {
    vouch.fn = vi.fn(async (_a, user) => v(user, 'OLD'))
    await setPushPrefs('stale', {})
    vouch.fn = vi.fn(async (_a, user) => v(user, 'NEW'))
    fetchMock.mockResolvedValueOnce(status(401)).mockResolvedValueOnce(ok({ prefs: { live: true } }))
    expect(await setPushPrefs('stale', { live: true })).toEqual({ live: true })
    expect(sentBodies().slice(-2).map((b) => b.signature)).toEqual(['OLD', 'NEW'])
  })

  it('without a vouch it still saves, unsigned, while the checker takes that', async () => {
    fetchMock.mockResolvedValueOnce(ok({ prefs: { live: true } }))
    expect(await setPushPrefs('novouch', { live: true })).toEqual({ live: true })
    expect(sentBodies()[0]).toEqual({ username: 'novouch', prefs: { live: true } })
    expect(console.warn).toHaveBeenCalledWith(expect.stringMatching(/no session vouch for @novouch/))
  })

  it('a refusal for want of proof says so (code not_confirmed)', async () => {
    fetchMock.mockResolvedValueOnce(status(401))
    await expect(setPushPrefs('refused', {})).rejects.toMatchObject({ code: 'not_confirmed' })
  })
})
