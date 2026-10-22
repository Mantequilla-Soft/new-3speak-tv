// The advertiser / creator / viewer ad data layer: signed creator and viewer
// settings (delegated first, wallet second), watch tokens, the per-video sync
// retries, remembered references, request shapes and formatting
// (src/lib/advertiseData.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const h = vi.hoisted(() => ({
  provider: 'keychain',
  mante: false,
  signMessageWithAioha: vi.fn(),
  establishWalletSession: vi.fn(),
  uploadThumbnail: vi.fn(),
}))
vi.mock('../../../src/hive-api/aioha', () => ({
  signMessageWithAioha: h.signMessageWithAioha,
  getCurrentProvider: () => h.provider,
  isManteAuthLogin: () => h.mante,
  establishWalletSession: h.establishWalletSession,
  KeyTypes: { Posting: 'posting' },
  Providers: { Keychain: 'keychain', HiveAuth: 'hiveauth', PeakVault: 'peakvault', Ledger: 'ledger', HiveSigner: 'hivesigner' },
}))
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: h.uploadThumbnail }))

import * as ad from '../../../src/lib/advertiseData.js'

const A = 'https://checker.3speak.tv/advertise'
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const notJson = (status) => ({ ok: false, status, json: async () => { throw new SyntaxError('<html>') } })

let fetchMock
beforeEach(() => {
  h.provider = 'keychain'
  h.mante = false
  h.signMessageWithAioha.mockReset()
  h.establishWalletSession.mockReset()
  h.uploadThumbnail.mockReset()
  localStorage.clear()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.useRealTimers())

const call = (i) => ({ url: fetchMock.mock.calls[i][0], opts: fetchMock.mock.calls[i][1] || {}, body: fetchMock.mock.calls[i][1]?.body ? JSON.parse(fetchMock.mock.calls[i][1].body) : undefined })

describe('error handling (readJson)', () => {
  it('throws the server\'s error with its status and body', async () => {
    fetchMock.mockResolvedValue(res(503, { error: 'Forecast not ready' }))
    await expect(ad.fetchInventory()).rejects.toMatchObject({ message: 'Forecast not ready', status: 503, body: { error: 'Forecast not ready' } })
  })

  it('a non-JSON error page gets a generic message with the status', async () => {
    fetchMock.mockResolvedValue(notJson(502))
    await expect(ad.fetchApplication('ref 1')).rejects.toMatchObject({ message: 'Request failed (502)', status: 502 })
    expect(call(0).url).toBe(`${A}/application/ref%201`)
  })

  it('returns the body on success', async () => {
    fetchMock.mockResolvedValue(res(200, { ok: 1 }))
    expect(await ad.submitApplication({ a: 1 })).toEqual({ ok: 1 })
    expect(call(0)).toMatchObject({ url: `${A}/apply`, opts: { method: 'POST' }, body: { a: 1 } })
  })
})

describe('fetchAdAccess', () => {
  it('returns allowed and stage', async () => {
    fetchMock.mockResolvedValue(res(200, { allowed: true, stage: 'beta' }))
    expect(await ad.fetchAdAccess('alice')).toEqual({ allowed: true, stage: 'beta' })
    fetchMock.mockResolvedValue(res(200, { allowed: false }))
    expect(await ad.fetchAdAccess('alice')).toEqual({ allowed: false, stage: null })
  })

  it('is null (unknown, not "no") for an old checker, a malformed answer or a network error', async () => {
    fetchMock.mockResolvedValueOnce(res(404, {}))
    expect(await ad.fetchAdAccess('a')).toBeNull()
    fetchMock.mockResolvedValueOnce(res(200, { allowed: 'yes' }))
    expect(await ad.fetchAdAccess('a')).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await ad.fetchAdAccess('a')).toBeNull()
  })
})

describe('syncVideoAdOptOut', () => {
  it('retries a 404 (post not readable yet) after 2, 4 and 8 seconds', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(res(404, {}))
      .mockResolvedValueOnce(res(404, {}))
      .mockResolvedValueOnce(res(200, { adsEnabled: false }))
    const p = ad.syncVideoAdOptOut('alice', 'vid')
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(await p).toEqual({ adsEnabled: false })
    expect(call(0)).toMatchObject({ url: `${A}/creator/video-ads/sync`, body: { author: 'alice', permlink: 'vid' } })
  })

  it('gives up after the third retry', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(res(404, { error: 'not found' }))
    const p = ad.syncVideoAdOptOut('a', 'p')
    const assertion = expect(p).rejects.toMatchObject({ status: 404 })
    await vi.advanceTimersByTimeAsync(14000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does not retry any other error', async () => {
    fetchMock.mockResolvedValue(res(500, { error: 'boom' }))
    await expect(ad.syncVideoAdOptOut('a', 'p')).rejects.toThrow('boom')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('syncVideoAdChoice', () => {
  it('keeps syncing until the checker reads the edited choice', async () => {
    vi.useFakeTimers()
    fetchMock
      .mockResolvedValueOnce(res(200, { adMode: 'on' }))
      .mockResolvedValueOnce(res(200, { adMode: 'no-rolls' }))
    const p = ad.syncVideoAdChoice('a', 'p', 'no-rolls')
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toEqual({ adMode: 'no-rolls' })
  })

  it('understands an older checker that only answers adsEnabled', async () => {
    fetchMock.mockResolvedValue(res(200, { adsEnabled: false }))
    expect(await ad.syncVideoAdChoice('a', 'p', 'off')).toEqual({ adsEnabled: false })
  })

  it('throws once the choice still reads wrong after every retry', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(res(200, { adMode: 'on' }))
    const p = ad.syncVideoAdChoice('a', 'p', 'off')
    const assertion = expect(p).rejects.toThrow('video ad choice still reads on, expected off')
    await vi.advanceTimersByTimeAsync(21000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})

describe('setCreatorAdPrefs', () => {
  it('signs through @threespeak with the app key for a wallet login, then saves', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { signature: 'sig', timestamp: 9, username: 'alice' }))
      .mockResolvedValueOnce(res(200, { saved: true }))
    expect(await ad.setCreatorAdPrefs('alice', { adsEnabled: true, rollsEnabled: false, communitySharePct: 20 })).toEqual({ saved: true })

    const sign = call(0)
    expect(sign.url).toBe('/api/ads/opt-out-signature')
    expect(sign.opts.credentials).toBe('include')
    expect('X-API-Key' in sign.opts.headers).toBe(true)
    expect(sign.body).toEqual({ adsEnabled: true, rollsEnabled: false, communitySharePct: 20, username: 'alice' })

    const save = call(1)
    expect(save.url).toBe(`${A}/creator/prefs`)
    expect(save.body).toEqual({ account: 'alice', adsEnabled: true, rollsEnabled: false, communitySharePct: 20, signature: 'sig', timestamp: 9 })
  })

  it('turning ads off always records rolls as on (there is no rolls choice when off)', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(res(200, {}))
    await ad.setCreatorAdPrefs('alice', { adsEnabled: false, rollsEnabled: false })
    expect(call(0).body.rollsEnabled).toBe(true)
    expect(call(1).body.rollsEnabled).toBe(true)
  })

  it('HiveSigner sends its bearer token and no claimed username', async () => {
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'tok')
    fetchMock
      .mockResolvedValueOnce(res(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(res(200, {}))
    await ad.setCreatorAdPrefs('alice', { adsEnabled: true })
    expect(call(0).opts.headers.Authorization).toBe('Bearer tok')
    expect(call(0).body.username).toBeUndefined()
  })

  it('an expired HiveSigner login fails without a request', async () => {
    h.provider = 'hivesigner'
    await expect(ad.setCreatorAdPrefs('alice', { adsEnabled: true })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a Butter Auth session sends neither app key nor username (the cookie speaks)', async () => {
    h.mante = true
    fetchMock
      .mockResolvedValueOnce(res(200, { signature: 's', timestamp: 1 }))
      .mockResolvedValueOnce(res(200, {}))
    await ad.setCreatorAdPrefs('alice', { adsEnabled: true })
    expect(call(0).opts.headers['X-API-Key']).toBeUndefined()
    expect(call(0).body.username).toBeUndefined()
  })

  it('re-mints the wallet session and retries on a 401 or a signature for another account', async () => {
    h.establishWalletSession.mockResolvedValue(true)
    fetchMock
      .mockResolvedValueOnce(res(200, { signature: 'old', timestamp: 1, username: 'previous' }))
      .mockResolvedValueOnce(res(200, { signature: 'new', timestamp: 2, username: 'alice' }))
      .mockResolvedValueOnce(res(200, {}))
    await ad.setCreatorAdPrefs('alice', { adsEnabled: true })
    expect(h.establishWalletSession).toHaveBeenCalledWith('alice')
    expect(call(2).body.signature).toBe('new')
  })

  it('never saves a setting signed in somebody else\'s name', async () => {
    h.mante = true
    fetchMock.mockResolvedValueOnce(res(200, { signature: 's', timestamp: 1, username: 'mallory' }))
    await expect(ad.setCreatorAdPrefs('alice', { adsEnabled: true })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the creator\'s wallet, signing exactly the checker\'s message', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    h.signMessageWithAioha.mockResolvedValue({ success: true, result: 'walletsig' })
    fetchMock
      .mockResolvedValueOnce(res(403, { error: 'no grant' }))
      .mockResolvedValueOnce(res(200, { saved: true }))
    await ad.setCreatorAdPrefs('alice', { adsEnabled: true, rollsEnabled: false, communitySharePct: 15 })
    expect(h.signMessageWithAioha.mock.calls[0][0]).toBe('3speak-ads|creator-prefs|alice|no-rolls|15|1700000000000')
    expect(h.signMessageWithAioha.mock.calls[0][1]).toBe('posting')
    expect(call(1).body).toMatchObject({ signature: 'walletsig', timestamp: 1700000000000 })
  })

  it('the wallet message reads "off" when ads are off and "on" otherwise', async () => {
    h.signMessageWithAioha.mockResolvedValue({ success: true, result: 'w' })
    fetchMock.mockResolvedValueOnce(res(403, {})).mockResolvedValueOnce(res(200, {}))
    await ad.setCreatorAdPrefs('alice', { adsEnabled: false, communitySharePct: 0 })
    expect(h.signMessageWithAioha.mock.calls[0][0]).toMatch(/^3speak-ads\|creator-prefs\|alice\|off\|0\|\d+$/)
    fetchMock.mockResolvedValueOnce(res(403, {})).mockResolvedValueOnce(res(200, {}))
    await ad.setCreatorAdPrefs('alice', { adsEnabled: true, communitySharePct: 5 })
    expect(h.signMessageWithAioha.mock.calls[1][0]).toMatch(/^3speak-ads\|creator-prefs\|alice\|on\|5\|\d+$/)
  })

  it('without a signing wallet the server\'s reason surfaces', async () => {
    h.mante = true
    fetchMock.mockResolvedValueOnce(res(403, { error: 'Grant @threespeak posting authority first' }))
    await expect(ad.setCreatorAdPrefs('alice', { adsEnabled: false })).rejects.toThrow('Grant @threespeak posting authority first')
  })

  it('a rejected wallet prompt fails the save', async () => {
    h.signMessageWithAioha.mockResolvedValue({ success: false })
    fetchMock.mockResolvedValueOnce(res(403, {}))
    await expect(ad.setCreatorAdPrefs('alice', { adsEnabled: true })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('setViewerAdPrefs', () => {
  it('signs through @threespeak and saves the opt-in', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { signature: 's', timestamp: 3 }))
      .mockResolvedValueOnce(res(200, { rewardsEnabled: true }))
    expect(await ad.setViewerAdPrefs('bob', { rewardsEnabled: true })).toEqual({ rewardsEnabled: true })
    expect(call(0)).toMatchObject({ url: '/api/ads/viewer-signature', body: { rewardsEnabled: true, username: 'bob' } })
    expect(call(1)).toMatchObject({ url: `${A}/viewer/prefs`, body: { account: 'bob', rewardsEnabled: true, signature: 's', timestamp: 3 } })
  })

  it('wallet fallback signs a viewer-prefs message that cannot be replayed as creator-prefs', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    h.signMessageWithAioha.mockResolvedValue({ success: true, result: 'w' })
    fetchMock.mockResolvedValueOnce(res(403, {})).mockResolvedValueOnce(res(200, {}))
    await ad.setViewerAdPrefs('bob', { rewardsEnabled: false })
    expect(h.signMessageWithAioha.mock.calls[0][0]).toBe('3speak-ads|viewer-prefs|bob|off|1700000000000')
  })

  it('a rejected prompt keeps the delegated failure as its cause', async () => {
    h.signMessageWithAioha.mockResolvedValue({ success: false })
    fetchMock.mockResolvedValueOnce(res(403, { error: 'no grant' }))
    const err = await ad.setViewerAdPrefs('bob', { rewardsEnabled: true }).catch((e) => e)
    expect(err.cause.message).toBe('no grant')
  })

  it('refuses a viewer signature made for another account', async () => {
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 't')
    fetchMock.mockResolvedValueOnce(res(200, { signature: 's', timestamp: 1, username: 'carol' }))
    await expect(ad.setViewerAdPrefs('bob', { rewardsEnabled: true })).rejects.toThrow()
  })
})

describe('fetchWatchToken', () => {
  it('asks the server for a token bound to the video', async () => {
    fetchMock.mockResolvedValue(res(200, { token: 'wt' }))
    expect(await ad.fetchWatchToken('alice', 'vid')).toBe('wt')
    expect(call(0)).toMatchObject({ url: '/api/watch/token', opts: { method: 'POST', credentials: 'include' }, body: { owner: 'alice', permlink: 'vid' } })
  })

  it('adds the HiveSigner bearer token', async () => {
    h.provider = 'hivesigner'
    localStorage.setItem('hivesignerToken', 'hs')
    fetchMock.mockResolvedValue(res(200, { token: 'wt' }))
    await ad.fetchWatchToken('alice', 'vid')
    expect(call(0).opts.headers.Authorization).toBe('Bearer hs')
  })

  it('is null (an unattributed watch) on any failure', async () => {
    expect(await ad.fetchWatchToken('', 'vid')).toBeNull()
    fetchMock.mockResolvedValueOnce(res(401, {}))
    expect(await ad.fetchWatchToken('a', 'p')).toBeNull()
    fetchMock.mockResolvedValueOnce(res(200, {}))
    expect(await ad.fetchWatchToken('a', 'p')).toBeNull()
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await ad.fetchWatchToken('a', 'p')).toBeNull()
  })
})

describe('wizard and remembered references', () => {
  it('resumes an enrollment per account, keeping the ad type across steps', () => {
    ad.rememberWizard('Alice', 'ref1', 2, 'banner')
    ad.rememberWizard('alice', 'ref1', 3)
    expect(ad.readWizard('ALICE')).toEqual({ reference: 'ref1', step: 3, adType: 'banner' })
    ad.clearWizard('alice')
    expect(ad.readWizard('alice')).toBeNull()
  })

  it('defaults the ad type to video and ignores junk', () => {
    ad.rememberWizard('a', 'r', 1)
    expect(ad.readWizard('a').adType).toBe('video')
    ad.rememberWizard('', 'r', 1)
    ad.rememberWizard('b', '', 1)
    expect(ad.readWizard('b')).toBeNull()
    expect(ad.readWizard(null)).toBeNull()
    localStorage.setItem('3speak-ads-wizard:c', '{"reference":5}')
    expect(ad.readWizard('c')).toBeNull()
  })

  it('remembers up to 25 references, newest first, without duplicates', () => {
    for (let i = 0; i < 27; i++) ad.rememberReference('alice', `r${i}`)
    ad.rememberReference('alice', 'r26')
    const held = ad.rememberedReferences('alice')
    expect(held).toHaveLength(25)
    expect(held[0]).toBe('r26')
    expect(held).not.toContain('r0')
    ad.forgetReferences('alice')
    expect(ad.rememberedReferences('alice')).toEqual([])
  })

  it('drops non-string entries from corrupt storage', () => {
    localStorage.setItem('3speak-ads-refs:alice', JSON.stringify(['ok', 5, null]))
    expect(ad.rememberedReferences('alice')).toEqual(['ok'])
    localStorage.setItem('3speak-ads-refs:alice', '{bad')
    expect(ad.rememberedReferences('alice')).toEqual([])
    expect(ad.rememberedReferences('')).toEqual([])
  })
})

describe('fetchMyApplications', () => {
  it('is empty without an account', async () => {
    expect(await ad.fetchMyApplications('')).toEqual([])
  })

  it('uses the server vouch silently and remembers what comes back', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { signature: 'v', timestamp: 4, username: 'alice', vouched: true }))
      .mockResolvedValueOnce(res(200, { applications: [{ reference: 'r1' }, { reference: 'r2' }] }))
    expect(await ad.fetchMyApplications('Alice')).toEqual([{ reference: 'r1' }, { reference: 'r2' }])
    expect(call(0).url).toBe('/api/ads/identity-signature')
    expect(call(1)).toMatchObject({ url: `${A}/mine`, body: { account: 'alice', signature: 'v', timestamp: 4, vouched: true } })
    expect(ad.rememberedReferences('alice')).toEqual(['r2', 'r1'])
  })

  it('stops when the session belongs to a different account', async () => {
    h.mante = true
    fetchMock.mockResolvedValueOnce(res(200, { signature: 'v', timestamp: 4, username: 'mallory' }))
    await expect(ad.fetchMyApplications('alice')).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('a wallet login with no session asks for nothing unless prompted', async () => {
    fetchMock.mockResolvedValueOnce(res(401, {}))
    await expect(ad.fetchMyApplications('alice')).rejects.toThrow()
    expect(h.establishWalletSession).not.toHaveBeenCalled()
    expect(h.signMessageWithAioha).not.toHaveBeenCalled()
  })

  it('when prompted, sets up the session and asks again', async () => {
    h.establishWalletSession.mockResolvedValue(true)
    fetchMock
      .mockResolvedValueOnce(res(401, {}))
      .mockResolvedValueOnce(res(200, { signature: 'v', timestamp: 1, username: 'alice', vouched: true }))
      .mockResolvedValueOnce(res(200, { applications: [] }))
    expect(await ad.fetchMyApplications('alice', { prompt: true })).toEqual([])
    expect(h.signMessageWithAioha).not.toHaveBeenCalled()
  })

  it('signs the "mine" message by hand as the last resort, unvouched', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1700000000000)
    h.establishWalletSession.mockResolvedValue(false)
    h.signMessageWithAioha.mockResolvedValue({ success: true, result: 'hand' })
    fetchMock
      .mockResolvedValueOnce(res(401, {}))
      .mockResolvedValueOnce(res(200, {}))
    await ad.fetchMyApplications('alice', { prompt: true })
    expect(h.signMessageWithAioha.mock.calls[0][0]).toBe('3speak-ads|mine|alice|1700000000000')
    expect(call(1).body).toEqual({ account: 'alice', signature: 'hand', timestamp: 1700000000000, vouched: false })
  })
})

describe('formatCount', () => {
  it('keeps one decimal below 10 and rounds the rest', () => {
    expect(ad.formatCount(0.24)).toBe('0.2')
    expect(ad.formatCount(9.96)).toBe('10')
    expect(ad.formatCount(3)).toBe('3')
    expect(ad.formatCount(0)).toBe('0')
    expect(ad.formatCount(12.6)).toBe('13')
  })

  it('shows a dash for nothing', () => {
    expect(ad.formatCount(NaN)).toBe('—')
    expect(ad.formatCount(undefined)).toBe('—')
  })
})

describe('slotLabel', () => {
  it('names the common percentages', () => {
    expect(ad.slotLabel({ percent: 0 })).toBe('Before the video')
    expect(ad.slotLabel({ percent: 25 })).toBe('A quarter of the way in')
    expect(ad.slotLabel({ percent: 50 })).toBe('Halfway through')
    expect(ad.slotLabel({ percent: 75 })).toBe('Three quarters in')
    expect(ad.slotLabel({ percent: 10 })).toBe('10% in')
  })

  it('a banner at 0% starts with the video rather than before it', () => {
    expect(ad.slotLabel({ percent: 0, banner: true })).toBe('At the beginning of the video')
  })

  it('still describes legacy campaigns booked in seconds', () => {
    expect(ad.slotLabel(null)).toBe('Before the video')
    expect(ad.slotLabel({ position: 0 })).toBe('Before the video')
    expect(ad.slotLabel({ position: 1 })).toBe('1 second in')
    expect(ad.slotLabel({ position: 30 })).toBe('30 seconds in')
    expect(ad.slotLabel({ position: 60 })).toBe('1 minute in')
    expect(ad.slotLabel({ position: 90 })).toBe('1.5 minutes in')
    expect(ad.slotLabel({ position: 120 })).toBe('2 minutes in')
  })
})

describe('countryName', () => {
  it('uses the browser\'s region names and falls back to the code', () => {
    expect(ad.countryName('DE')).toBeTruthy()
    expect(ad.countryName('unknown')).toBe('Unplaced')
    expect(ad.countryName('')).toBe('Unplaced')
    expect(ad.countryName('not-a-code')).toBe('not-a-code')
  })
})

describe('creatives and branding', () => {
  it('saveBranding leaves untouched fields out and sends an empty string to clear', async () => {
    fetchMock.mockResolvedValue(res(200, {}))
    await ad.saveBranding({ reference: 'r', slogan: 'Go' })
    await ad.saveBranding({ reference: 'r', logoUrl: '' })
    expect(call(0).body).toEqual({ reference: 'r', slogan: 'Go' })
    expect(call(1).body).toEqual({ reference: 'r', logoUrl: '' })
    expect(ad.SLOGAN_MAX).toBe(50)
  })

  it('uploadLogo and uploadImageAsset use the static image route and fail clearly', async () => {
    h.uploadThumbnail.mockResolvedValueOnce('https://img/logo.png')
    fetchMock.mockResolvedValue(res(200, {}))
    await ad.uploadLogo({ file: new Blob(['x']), reference: 'r' })
    expect(h.uploadThumbnail.mock.calls[0][2]).toEqual({ preferStatic: true })
    expect(call(0)).toMatchObject({ url: `${A}/branding`, body: { reference: 'r', logoUrl: 'https://img/logo.png' } })

    h.uploadThumbnail.mockResolvedValueOnce('https://img/a.png')
    await ad.uploadImageAsset({ file: new Blob(['x']), reference: 'r' })
    expect(call(1)).toMatchObject({ url: `${A}/creatives`, body: { reference: 'r', imageUrl: 'https://img/a.png' } })

    h.uploadThumbnail.mockResolvedValueOnce(null)
    await expect(ad.uploadImageAsset({ file: new Blob(['x']), reference: 'r' })).rejects.toThrow()
  })

  it('uploadCreative uploads as a 3speak-ads embed and claims it by permlink', async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, { permlink: 'emb1' }))
      .mockResolvedValueOnce(res(200, { creative: 1 }))
    const file = new File(['v'], 'spot.mp4', { type: 'video/mp4' })
    expect(await ad.uploadCreative({ file, account: 'alice', reference: 'r', durationSeconds: 15 })).toEqual({ creative: 1 })
    const up = fetchMock.mock.calls[0]
    expect(up[0]).toBe('https://embed2.3speak.tv/upload/simple')
    const form = up[1].body
    expect(form.get('owner')).toBe('alice')
    expect(form.get('frontend_app')).toBe('3speak-ads')
    expect(form.get('duration')).toBe('15')
    expect(call(1).body).toEqual({ reference: 'r', embedId: 'emb1' })
  })

  it('uploadCreative surfaces an upload failure and claims nothing', async () => {
    fetchMock.mockResolvedValueOnce(res(413, { error: 'too large' }))
    await expect(ad.uploadCreative({ file: new File(['v'], 'a.mp4'), account: 'a', reference: 'r' })).rejects.toThrow('too large')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('attachCreative sends an image OR an embed, never both', async () => {
    fetchMock.mockResolvedValue(res(200, {}))
    await ad.attachCreative({ reference: 'r', campaignId: 'c/1', imageUrl: 'https://i', embedId: 'e' })
    await ad.attachCreative({ reference: 'r', campaignId: 'c2', embedId: 'e' })
    expect(call(0)).toMatchObject({ url: `${A}/campaigns/c%2F1/creative`, body: { reference: 'r', imageUrl: 'https://i' } })
    expect(call(1).body).toEqual({ reference: 'r', embedId: 'e' })
  })

  it('saveTickerCreative defaults to the crawl style', async () => {
    fetchMock.mockResolvedValue(res(200, {}))
    await ad.saveTickerCreative({ reference: 'r', message: 'Hi', clickUrl: 'https://x' })
    expect(call(0).body).toEqual({ reference: 'r', message: 'Hi', clickUrl: 'https://x', style: 'crawl' })
  })
})

describe('pricing, slots, forecast and campaigns', () => {
  beforeEach(() => fetchMock.mockResolvedValue(res(200, {})))

  it('fetchPricing quotes this advertiser\'s rate when given a reference', async () => {
    await ad.fetchPricing()
    await ad.fetchPricing('ref 1', { beta: true })
    expect(call(0).url).toBe(`${A}/pricing`)
    expect(call(1).url).toBe(`${A}/pricing?reference=ref+1&beta=1`)
  })

  it('fetchSlots and fetchForecast pass only the fields given', async () => {
    await ad.fetchSlots({ days: 3 })
    await ad.fetchSlots({ days: 7, startAt: 123, format: 'video_banner' })
    await ad.fetchForecast({ format: 'video_roll', days: 3, slotPercent: 0 })
    await ad.fetchForecast({ days: 1, minVideoSeconds: 60, maxVideoSeconds: 600, startAt: 5 })
    expect(call(0).url).toBe(`${A}/slots?days=3`)
    expect(call(1).url).toBe(`${A}/slots?days=7&startAt=123&format=video_banner`)
    expect(call(2).url).toBe(`${A}/forecast?days=3&format=video_roll&slotPercent=0`)
    expect(call(3).url).toBe(`${A}/forecast?days=1&startAt=5&minVideoSeconds=60&maxVideoSeconds=600`)
  })

  it('createCampaign posts the booking as given and claimCampaign only asks the server to look', async () => {
    const booking = { reference: 'r', format: 'video_roll', name: 'n', days: 3, slotPercent: 25, spotSeconds: 15, startAt: 1, production: 'basic' }
    await ad.createCampaign(booking)
    expect(call(0)).toMatchObject({ url: `${A}/campaigns`, opts: { method: 'POST' } })
    expect(call(0).body).toMatchObject(booking)
    await ad.claimCampaign('c 1')
    expect(call(1)).toMatchObject({ url: `${A}/campaigns/c%201/claim`, body: {} })
  })

  it('discardProduct and the list reads hit their endpoints', async () => {
    await ad.discardProduct('r')
    await ad.fetchCreatives('r&x')
    await ad.fetchCampaigns('r')
    await ad.fetchCreatorAdPrefs('a b')
    await ad.fetchViewerAdPrefs('bob')
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      `${A}/product/discard`,
      `${A}/creatives?reference=r%26x`,
      `${A}/campaigns?reference=r`,
      `${A}/creator/prefs/a%20b`,
      `${A}/viewer/prefs/bob`,
    ])
  })
})

it('every blocked reason maps to an i18n key under ads.blocked', () => {
  for (const [k, v] of Object.entries(ad.BLOCKED_REASON)) expect(v).toBe(`ads.blocked.${k}`)
  expect(ad.AD_CATEGORIES.map((c) => c.id)).toContain('other')
})
