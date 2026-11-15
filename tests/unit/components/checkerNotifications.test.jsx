// The checker's notifications in the bell and on /notifications: they come in
// the stories list as `_checker` items (lib/stories.js) and StoryNotifications
// draws them as rows: "is live" / "went live", and a collab invite with Accept
// and Decline that answer the checker (stand-in).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const respondToCollab = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/collabs', () => ({ respondToCollab }))
const success = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success, error: vi.fn() }) }))

const { default: StoryNotifications } = await import('../../../src/components/nav/StoryNotifications.jsx')

const at = new Date().toISOString()
const items = [
  { _checker: true, _viewer: 'fan', id: 'live:1', type: 'live', actor: 'badadib', title: 'Building in public', url: '/watch/room-1', at, live: true, seen: false },
  { _checker: true, _viewer: 'fan', id: 'live:2', type: 'live', actor: 'quiet', title: 'Earlier', url: '/watch/q', at, live: false, seen: true },
  { _checker: true, _viewer: 'fan', id: 'collab:1', type: 'collab_invite', actor: 'badadib', author: 'badadib', permlink: 'p1', title: 'Our video', url: '/watch?v=badadib/p1', at, seen: false },
]

beforeEach(() => { respondToCollab.mockReset().mockResolvedValue({}); success.mockReset() })

describe('checker notifications', () => {
  it('draws live and was-live rows, unseen ones washed, and opens the stream', async () => {
    const onOpen = vi.fn()
    const { user, container } = renderWithProviders(<StoryNotifications stories={items} onOpen={onOpen} />)
    expect(screen.getByText('@badadib is live')).toBeInTheDocument()
    expect(screen.getByText('@quiet went live')).toBeInTheDocument()
    expect(container.querySelectorAll('.checker-notif.podcast-notif--unseen')).toHaveLength(2)
    await user.click(screen.getByText('@badadib is live'))
    expect(onOpen).toHaveBeenCalled()
    expect(screen.getByTestId('location').textContent).toBe('/watch/room-1')
  })

  it('a collab invite is answered in place, without opening the post', async () => {
    const { user } = renderWithProviders(<StoryNotifications stories={items} />)
    await user.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(respondToCollab).toHaveBeenCalledWith('fan', 'badadib', 'p1', true))
    expect(success).toHaveBeenCalledWith('The collab with @badadib is now on your channel.')
    expect(screen.getByTestId('location').textContent).toBe('/')
  })

  it('ready stream clips: the host and a clipper each get their line, and it opens /clips', async () => {
    const host = { _checker: true, _viewer: 'badadib', id: 'clips:r1', type: 'stream_clips', actor: 'badadib', role: 'host', count: 4, title: 'Friday', url: '/clips', at, seen: false }
    const fan = { _checker: true, _viewer: 'fan', id: 'clips:r2', type: 'stream_clips', actor: 'badadib', role: 'clipper', count: 2, title: 'Friday', url: '/clips', at, seen: false }
    const { user } = renderWithProviders(<StoryNotifications stories={[host, fan]} />)
    expect(screen.getByText("Your stream's clips are ready to post as Shorts (4)")).toBeInTheDocument()
    await user.click(screen.getByText("Your clips of @badadib's stream are ready (2)"))
    expect(screen.getByTestId('location').textContent).toBe('/clips')
  })

  it('a started premiere you asked about opens the video, marked live', async () => {
    const premiere = { _checker: true, _viewer: 'fan', id: 'premiere:badadib/p2', type: 'premiere', actor: 'badadib', author: 'badadib', permlink: 'p2', title: 'Launch day', url: '/watch?v=badadib/p2', at, live: true, seen: false }
    const { user } = renderWithProviders(<StoryNotifications stories={[premiere]} />)
    expect(screen.getByText("@badadib's premiere has started")).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    await user.click(screen.getByText("@badadib's premiere has started"))
    expect(screen.getByTestId('location').textContent).toBe('/watch?v=badadib/p2')
  })

  it('no checker items: nothing extra', () => {
    const { container } = renderWithProviders(<StoryNotifications stories={[]} />)
    expect(container.querySelector('.checker-notifs-section')).toBeNull()
  })
})
