// The stale-build check against GitHub's production version.js, and the upload
// gate that reloads onto the new build first (src/utils/checkLatestVersion.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const toast = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => toast }))

import { isNewerVersion, fetchNewerVersion, reloadForUpdate, reloadIfStale } from '../../../src/utils/checkLatestVersion.js'
import { APP_VERSION } from '../../../src/version.js'

const bump = (v) => v.split('.').map((n, i) => (i === 2 ? Number(n) + 1 : n)).join('.')
const remoteFile = (v) => ({ ok: true, text: async () => `// release\nexport const APP_VERSION = '${v}';\n` })

let reload
beforeEach(() => {
  toast.mockReset()
  vi.stubEnv('DEV', false)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  reload = vi.fn()
  vi.stubGlobal('window', { location: { reload } })
  vi.stubGlobal('localStorage', { getItem: () => null })
  vi.stubGlobal('caches', { keys: async () => [], delete: async () => true })
})

describe('isNewerVersion', () => {
  it('compares dotted versions numerically, not as text', () => {
    expect(isNewerVersion('1.80.10', '1.80.9')).toBe(true)
    expect(isNewerVersion('1.80.9', '1.80.10')).toBe(false)
    expect(isNewerVersion('2.0.0', '1.99.99')).toBe(true)
    expect(isNewerVersion('1.80.2', '1.80.2')).toBe(false)
  })

  it('treats missing parts as zero', () => {
    expect(isNewerVersion('1.80', '1.80.0')).toBe(false)
    expect(isNewerVersion('1.80.0.1', '1.80')).toBe(true)
    expect(isNewerVersion('garbage', '0.0.0')).toBe(false)
  })
})

describe('fetchNewerVersion', () => {
  it('never prompts on the dev server', async () => {
    vi.stubEnv('DEV', true)
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect(await fetchNewerVersion()).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('returns the production version when it is newer, read uncached', async () => {
    const newer = bump(APP_VERSION)
    const f = vi.fn().mockResolvedValue(remoteFile(newer))
    vi.stubGlobal('fetch', f)
    expect(await fetchNewerVersion()).toBe(newer)
    const [url, opts] = f.mock.calls[0]
    expect(url).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Mantequilla-Soft\/new-3speak-tv\/production\/src\/version\.js\?t=\d+$/)
    expect(opts.cache).toBe('no-store')
  })

  it('is null when production is the same or older', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(remoteFile(APP_VERSION)))
    expect(await fetchNewerVersion()).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(remoteFile('1.0.0')))
    expect(await fetchNewerVersion()).toBeNull()
  })

  it('is null on an HTTP error, an unparseable file or offline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    expect(await fetchNewerVersion()).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => '<html>' }))
    expect(await fetchNewerVersion()).toBeNull()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    expect(await fetchNewerVersion()).toBeNull()
  })
})

describe('reloadForUpdate', () => {
  it('clears caches and service workers except the push worker, then reloads', async () => {
    const del = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('caches', { keys: async () => ['a', 'b'], delete: del })
    const appSw = { scope: 'https://3speak.tv/', unregister: vi.fn() }
    const pushSw = { scope: 'https://3speak.tv/push-scope/', unregister: vi.fn() }
    vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: async () => [appSw, pushSw] } })
    await reloadForUpdate()
    expect(del.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
    expect(appSw.unregister).toHaveBeenCalled()
    expect(pushSw.unregister).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
  })

  it('still reloads when clearing fails', async () => {
    vi.stubGlobal('caches', { keys: async () => { throw new Error('denied') } })
    await reloadForUpdate()
    expect(reload).toHaveBeenCalled()
  })
})

describe('reloadIfStale (upload gate)', () => {
  it('lets the upload run on a current build', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(remoteFile(APP_VERSION)))
    expect(await reloadIfStale()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('toasts and reloads a stale build before the upload starts', async () => {
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(remoteFile(bump(APP_VERSION))))
    expect(await reloadIfStale()).toBe(true)
    expect(toast).toHaveBeenCalledTimes(1)
    expect(reload).toHaveBeenCalled()
  })
})
