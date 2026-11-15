// The bell next to Follow (components/NotifyLevel/NotifyLevelButton): it shows
// the current level, the dialog offers All / Highlights / Off, and a choice is
// saved to the checker (stand-in) with a toast; a failed save rolls back.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: vi.fn(async (user) => ({ user, signature: 'SIG', timestamp: 7 })) }))
const fetchMock = vi.hoisted(() => vi.fn())
const h = vi.hoisted(() => ({ levels: {} }))
const saved = () => fetchMock.mock.calls.filter(([url]) => /\/notify\/level$/.test(url)).map(([, init]) => JSON.parse(init.body))
const success = vi.hoisted(() => vi.fn())
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success, error }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: NotifyLevelButton } = await import('../../../src/components/NotifyLevel/NotifyLevelButton.jsx')

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url, init) => ({
    ok: true, status: 200, json: async () => ({ success: true, levels: h.levels, level: JSON.parse(init.body).level, notifications: [] }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  h.levels = {}
  success.mockReset()
  error.mockReset()
  useAppStore.setState({ authenticated: true, user: 'fan' })
})

describe('notification level button', () => {
  it('nothing for the creator themself or signed out', () => {
    useAppStore.setState({ authenticated: true, user: 'badadib' })
    const { container } = renderWithProviders(<NotifyLevelButton creator="badadib" />)
    expect(container.querySelector('.ph-tile--notify')).toBeNull()
  })

  it('opens the three levels with the current one selected, and saves a new one', async () => {
    h.levels = { badadib: 'highlights' }
    const { user, queryClient } = renderWithProviders(<NotifyLevelButton creator="badadib" />)
    const tile = await screen.findByRole('button', { name: 'Notifications from @badadib: Highlights' })
    await user.click(tile)
    const radios = screen.getAllByRole('radio')
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    await user.click(screen.getByRole('radio', { name: /^Off/ }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('Notifications from @badadib are off.'))
    expect(saved()).toEqual([expect.objectContaining({ user: 'fan', creator: 'badadib', level: 'off', signature: 'SIG' })])
    expect(queryClient.getQueryData(['notify-levels', 'fan'])).toEqual({ badadib: 'off' })
  })

  it('a failed save puts the old level back', async () => {
    fetchMock.mockImplementation(async (url) => (/\/notify\/level$/.test(url)
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => ({ success: true, levels: {} }) }))
    const { user, queryClient } = renderWithProviders(<NotifyLevelButton creator="badadib" />)
    await user.click(await screen.findByRole('button', { name: 'Notifications from @badadib: All' }))
    await user.click(screen.getByRole('radio', { name: /^Highlights/ }))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(queryClient.getQueryData(['notify-levels', 'fan'])).toEqual({})
  })
})
