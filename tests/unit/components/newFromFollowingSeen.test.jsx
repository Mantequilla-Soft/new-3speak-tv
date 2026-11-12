// "Mark all as seen" on the new-from-following strip (components/NewFromFollowing):
// it stores the moment per viewer, hides the strip, and asks the checker only
// for later uploads (`since`). Owner 2026-11-12.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const get = vi.hoisted(() => vi.fn())
vi.mock('axios', async (importOriginal) => {
  const real = await importOriginal()
  return { ...real, default: { ...real.default, get } }
})
vi.mock('../../../src/components/HiveAvatar/HiveAvatar', () => ({ default: () => null }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: NewFromFollowing } = await import('../../../src/components/NewFromFollowing/NewFromFollowing.jsx')

const creators = [
  { username: 'vid', shorts: 0, videos: 3, total: 3, latest_at: '2026-11-12T10:00:00.000Z' },
  { username: 'shorty', shorts: 2, videos: 0, total: 2, latest_at: '2026-11-11T10:00:00.000Z' },
]

beforeEach(() => {
  localStorage.clear()
  get.mockReset()
  useAppStore.setState({ authenticated: true, user: 'fan', showNsfw: false })
})

describe('new from following: mark all as seen', () => {
  it('stores the moment, hides the strip, and asks only for later uploads', async () => {
    get.mockResolvedValue({ data: { creators } })
    const { user } = renderWithProviders(<NewFromFollowing />)
    expect(await screen.findByText('5 new videos')).toBeInTheDocument()
    expect(get.mock.calls[0][1].params.since).toBeUndefined()

    get.mockResolvedValue({ data: { creators: [] } })
    await user.click(screen.getByRole('button', { name: 'Mark all as seen' }))

    const stored = localStorage.getItem('nff-seen-until:fan')
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await waitFor(() => expect(screen.queryByText(/new videos?/)).toBeNull())
    await waitFor(() => expect(get.mock.calls.at(-1)[1].params.since).toBe(stored))
  })

  it('without the checker\'s since, it still leaves out creators with nothing after that moment', async () => {
    localStorage.setItem('nff-seen-until:fan', '2026-11-11T12:00:00.000Z')
    get.mockResolvedValue({ data: { creators } })   // a checker that ignores since
    renderWithProviders(<NewFromFollowing />)
    expect(await screen.findByText('3 new videos')).toBeInTheDocument()
  })
})
