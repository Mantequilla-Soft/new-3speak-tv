// @vitest-environment jsdom
// The studio's ?show= tab (src/components/studio/DraftStudio.jsx): the upload
// windows link to /draft?show=unsent or ?show=scheduled, and the studio follows
// such a link also when it is already open. The APIs are stand-ins.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { Link } from 'react-router-dom'
import { renderWithProviders } from './_render.jsx'

vi.mock('axios', async (importOriginal) => {
  const real = (await importOriginal()).default
  return { default: Object.assign(real.create(), { create: real.create, get: vi.fn(async () => ({ data: [] })) }) }
})
vi.mock('../../../src/utils/scheduledPosts', () => ({ fetchDrafts: vi.fn(async () => []) }))
vi.mock('../../../src/lib/creatorStats', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchCreatorOverview: vi.fn(async () => null),
  fetchCreatorFollows: vi.fn(async () => null),
  fetchCreatorTimeseries: vi.fn(async () => null),
}))

const { useAppStore } = await import('../../../src/lib/store')
const { default: DraftStudio } = await import('../../../src/components/studio/DraftStudio.jsx')

beforeEach(() => useAppStore.setState({ user: 'badadib' }))
afterEach(() => useAppStore.setState({ user: null }))

// The studio, with links elsewhere on the page that stay on /draft.
const open = (route) => renderWithProviders(
  <>
    <DraftStudio />
    <Link to="/draft?show=scheduled">to scheduled</Link>
    <Link to="/draft?show=unsent">to drafts</Link>
  </>,
  { route, path: '/draft' },
)
const selected = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })

describe('DraftStudio ?show=', () => {
  it('opens on the tab the link names', async () => {
    open('/draft?show=unsent')
    await waitFor(() => expect(selected('Drafts')).toHaveAttribute('aria-selected', 'true'))
  })

  it('follows a new ?show= while it is open, and the same link again after a tab was picked', async () => {
    const { user } = open('/draft')
    await waitFor(() => expect(selected('All')).toHaveAttribute('aria-selected', 'true'))
    await user.click(screen.getByRole('link', { name: 'to drafts' }))
    await waitFor(() => expect(selected('Drafts')).toHaveAttribute('aria-selected', 'true'))
    await user.click(screen.getByRole('link', { name: 'to scheduled' }))
    await waitFor(() => expect(selected('Scheduled')).toHaveAttribute('aria-selected', 'true'))
    // Picked by hand, then the same link once more: back to that tab.
    await user.click(selected('All'))
    expect(selected('All')).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('link', { name: 'to scheduled' }))
    await waitFor(() => expect(selected('Scheduled')).toHaveAttribute('aria-selected', 'true'))
  })
})
