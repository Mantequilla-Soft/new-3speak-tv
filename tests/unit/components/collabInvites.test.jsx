// Collab invites on your own channel (components/Collabs/CollabInvites) and the
// "with @fan" line on the watch page (playVideo/WatchCollaborators): pending
// invites with Accept / Decline, accepted collaborators only. The checker is a fake.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/lib/podcastProgress', () => ({ sessionVouch: vi.fn(async (user) => ({ user, signature: 'SIG', timestamp: 7 })) }))
const success = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success, error: vi.fn() }) }))

const { default: CollabInvites } = await import('../../../src/components/Collabs/CollabInvites.jsx')
const { default: WatchCollaborators } = await import('../../../src/components/playVideo/WatchCollaborators.jsx')

const reply = (body) => ({ ok: true, status: 200, json: async () => body })
let fetchMock
beforeEach(() => {
  success.mockReset()
  fetchMock = vi.fn(async (url) => {
    if (url.endsWith('/collabs/mine')) {
      return reply({ invites: [
        { author: 'badadib', permlink: 'p1', title: 'Our video', status: 'pending' },
        { author: 'badadib', permlink: 'p0', title: 'Old one', status: 'accepted' },
      ] })
    }
    if (url.includes('/collabs/post/')) return reply({ collaborators: [{ account: 'fan', weight: 4450 }] })
    return reply({ success: true, status: 'accepted' })
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('collab invites', () => {
  it('lists pending invites and accepts one', async () => {
    const { user } = renderWithProviders(<CollabInvites user="fan" />)
    expect(await screen.findByText('Our video')).toBeInTheDocument()
    expect(screen.queryByText('Old one')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(success).toHaveBeenCalledWith('The collab with @badadib is now on your channel.'))
    const respond = fetchMock.mock.calls.find(([url]) => url.endsWith('/collabs/respond'))
    expect(JSON.parse(respond[1].body)).toMatchObject({ author: 'badadib', permlink: 'p1', accept: true, user: 'fan' })
  })
})

describe('watch page', () => {
  it('shows "with @fan" for an accepted collaborator', async () => {
    renderWithProviders(<div className="wv2-meta"><WatchCollaborators author="badadib" permlink="p1" /></div>)
    expect(await screen.findByRole('link', { name: '@fan' })).toHaveAttribute('href', '/@fan')
  })
})
