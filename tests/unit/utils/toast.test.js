// @vitest-environment jsdom
// Toasts with a category heading (src/utils/toast.js): every message gets its
// module's translated heading as the title and the text underneath, a caller's
// own two-line toast is kept as written, the rest of sonner passes through, and
// the stack can be hidden while a menu is open. Each toast also carries its
// category's icon and tone (34d). sonner is a recording fake.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => {
  const sonner = vi.fn(() => 'id-base')
  for (const m of ['success', 'error', 'warning', 'info', 'loading', 'message', 'dismiss', 'custom', 'promise']) sonner[m] = vi.fn(() => `id-${m}`)
  return { sonner, t: vi.fn((key, { defaultValue }) => (key === 'toastCategories.Upload' ? 'Hochladen' : defaultValue)) }
})
vi.mock('sonner', () => ({ toast: h.sonner }))
vi.mock('../../../src/i18n', () => ({ t: h.t }))
vi.mock('../../../src/components/v2/Icon', () => ({ Icon: () => null }))

// The options a toast is sent with: the caller's, plus the category's look.
const sent = (opts, tone = 'accent') => expect.objectContaining({ ...opts, className: `ts-cat ts-tone-${tone}` })

import toastInDefault, { toastIn, hideToastLayer, showToastLayer } from '../../../src/utils/toast.js'

beforeEach(() => {
  h.sonner.mockClear()
  for (const m of Object.keys(h.sonner)) if (typeof h.sonner[m]?.mockClear === 'function') h.sonner[m].mockClear()
  h.t.mockClear()
})

describe('toastIn', () => {
  it('is also the default export', () => {
    expect(toastInDefault).toBe(toastIn)
  })

  it.each(['success', 'error', 'warning', 'info', 'loading', 'message'])('%s shows the translated heading over the message', (method) => {
    const toast = toastIn('Upload')
    expect(toast[method]('File is too big', { duration: 5000 })).toBe(`id-${method}`)
    expect(h.sonner[method]).toHaveBeenCalledWith('Hochladen', sent({ duration: 5000, description: 'File is too big' }))
  })

  it('the plain call works the same way', () => {
    expect(toastIn('Upload')('Done')).toBe('id-base')
    expect(h.sonner).toHaveBeenCalledWith('Hochladen', sent({ description: 'Done' }))
  })

  it('turns the category into a plain translation key and shows English when it is missing', () => {
    toastIn('Sign in').error('Wrong password')
    expect(h.t).toHaveBeenCalledWith('toastCategories.Sign_in', { defaultValue: 'Sign in' })
    expect(h.sonner.error).toHaveBeenCalledWith('Sign in', sent({ description: 'Wrong password' }))
  })

  it('translates when the toast is shown, not when the module binds it', () => {
    const toast = toastIn('Upload')
    expect(h.t).not.toHaveBeenCalled()
    toast.info('x')
    expect(h.t).toHaveBeenCalledTimes(1)
  })

  it('a per-call title overrides the heading, and keeps an id so a toast updates in place', () => {
    toastIn('Upload').loading('40%', { title: 'Stream', id: 'vod-1' })
    expect(h.sonner.loading).toHaveBeenCalledWith('Stream', sent({ id: 'vod-1', description: '40%' }))
  })

  it('keeps a toast the caller already wrote with two lines', () => {
    toastIn('Upload').success('Their title', { description: 'their text' })
    expect(h.sonner.success).toHaveBeenCalledWith('Their title', sent({ description: 'their text' }))
  })

  it('gives each category its icon and tone, errors always in the accent, and keeps a loading spinner', () => {
    toastIn('Playlist').success('Saved')
    const [, opts] = h.sonner.success.mock.calls[0]
    expect(opts.className).toBe('ts-cat ts-tone-cyan')
    expect(opts.icon).toBeTruthy()
    toastIn('Playlist').error('Could not save')
    expect(h.sonner.error.mock.calls[0][1].className).toBe('ts-cat ts-tone-accent')
    toastIn('Upload').loading('40%')
    expect(h.sonner.loading.mock.calls[0][1].icon).toBeUndefined()
  })

  it('passes dismiss, custom and promise straight through', () => {
    const toast = toastIn('Upload')
    const p = Promise.resolve()
    toast.dismiss('id-1')
    toast.custom('jsx', { id: 2 })
    toast.promise(p, { loading: 'x' })
    expect(h.sonner.dismiss).toHaveBeenCalledWith('id-1')
    expect(h.sonner.custom).toHaveBeenCalledWith('jsx', { id: 2 })
    expect(h.sonner.promise).toHaveBeenCalledWith(p, { loading: 'x' })
  })
})

describe('hiding the stack', () => {
  it('marks <html> while a menu is open and clears it after', () => {
    hideToastLayer()
    expect(document.documentElement.getAttribute('data-toasts-hidden')).toBe('true')
    showToastLayer()
    expect(document.documentElement.hasAttribute('data-toasts-hidden')).toBe(false)
  })
})
