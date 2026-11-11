// @vitest-environment jsdom
// The video card grid used by every feed (components/Cards/Card3.jsx): each card
// links to its video and shows title, length, creator, counts and status badges;
// live rooms, members-only and AI-flagged videos are marked; dead, AI-hidden and
// already-watched videos are left out when asked; and "not interested" or
// "don't show this creator" from a card's menu drops cards at once, with Undo.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/hooks/useHoverPreview', () => ({
  default: () => ({ containerProps: {}, getCardProps: () => ({}), overlay: null, canHover: m.canHover, startPreview: () => {} }),
}))
vi.mock('../../../src/lib/deadVideos', () => ({ useDeadVideos: () => m.dead }))
vi.mock('../../../src/utils/aiFlags', () => ({
  aiKey: (a, p) => `${a}/${p}`,
  isAiFlagged: (a, p) => m.ai.has(`${a}/${p}`),
  useAiFlags: () => 0,
}))
vi.mock('../../../src/components/AuthorBadge/AuthorBadge', () => ({ default: ({ author }) => <span>@{author}</span> }))
vi.mock('../../../src/components/PayoutAmount/PayoutAmount', () => ({ default: ({ amount }) => <span>{amount == null ? '' : `$${amount}`}</span> }))
vi.mock('../../../src/components/UpvoteCount/UpvoteCount', () => ({ default: ({ count }) => <span>{count} votes</span> }))
vi.mock('../../../src/components/CommentCount/CommentCount', () => ({ default: ({ count }) => <span>{count} comments</span> }))
vi.mock('../../../src/components/ViewCount/ViewCount', () => ({ default: ({ views, formatViews, watched, title }) => <span title={title}>{formatViews(views)} views{watched ? ' (watched)' : ''}</span> }))
vi.mock('../../../src/components/TimeAgo/TimeAgo', () => ({ default: () => <span>2d</span> }))
vi.mock('../../../src/components/modal/ProfileModal', () => ({ default: () => null }))
// The card menu, reduced to its two dismiss actions and their Undo.
vi.mock('../../../src/components/CardOptionsMenu/CardOptionsMenu', () => ({
  default: ({ author, permlink, onDismiss }) => (
    <span>
      <button type="button" onClick={() => onDismiss('video', { owner: author, permlink })}>{`Not interested in ${permlink}`}</button>
      <button type="button" onClick={() => onDismiss('creator', { owner: author })}>{`Hide ${author} from ${permlink}`}</button>
      <button type="button" onClick={() => onDismiss('undo-creator', { owner: author })}>{`Undo hide from ${permlink}`}</button>
    </span>
  ),
}))

const { useAppStore } = await import('../../../src/lib/store')
const { default: Card3 } = await import('../../../src/components/Cards/Card3.jsx')

const video = (author, permlink, extra = {}) => ({
  author: { username: author }, permlink, title: `Title ${permlink}`, duration: 125, created_at: '2026-11-01T00:00:00',
  stats: { total_hive_reward: 1.5, num_votes: 7, num_comments: 2 }, views: 1234, ...extra,
})
const card = (title) => screen.getByRole('heading', { name: title }).closest('a')
// The grid cell around a card's link (its classes and grid placement live here).
const cell = (title) => screen.getByRole('heading', { name: title }).closest('.card')

function mount(props) {
  return renderWithProviders(<Card3 videos={[]} {...props} />)
}

beforeEach(() => {
  m.canHover = true
  m.dead = new Set()
  m.ai = new Set()
  useAppStore.setState({ hideAi: true })
})

describe('a grid of video cards', () => {
  it('says it is loading before the first videos arrive, and shows an error', () => {
    const { unmount } = mount({ loading: true })
    expect(screen.getByText('Loading...')).toBeInTheDocument()
    unmount()
    mount({ error: 'feed down' })
    expect(screen.getByText('Error: feed down')).toBeInTheDocument()
  })

  it('links each card to its video page with title, length, creator and counts', () => {
    mount({ videos: [video('badadib', 'lake-day')] })
    const c = card('Title lake-day')
    expect(c).toHaveAttribute('href', '/@badadib/lake-day')
    expect(within(c).getByText('2:05')).toBeInTheDocument()
    // The name alone, as 20a / 28b write it ("birdwatcher · 9.2K · 3w")
    expect(within(c).getByText('badadib')).toBeInTheDocument()
    expect(within(c).getByText('1.2K views')).toBeInTheDocument()
    expect(within(c).getAllByText('$1.5')[0]).toBeInTheDocument()
    // Hovering the payout explains it (28b): half to the author, half to the curators
    const tip = within(c).getByRole('tooltip', { hidden: true })
    expect(within(tip).getByText('Author').nextSibling).toHaveTextContent('$0.75')
    expect(within(tip).getByText('Curators').nextSibling).toHaveTextContent('$0.75')
    expect(within(c).getByText('7 votes')).toBeInTheDocument()
    expect(within(c).getByText('2 comments')).toBeInTheDocument()
  })

  it('prefers the live Hive numbers when the page has them', () => {
    mount({ videos: [video('badadib', 'lake-day')], getContentForVideo: () => ({ payout: 9.25, voters: 40, children: 12 }) })
    const c = card('Title lake-day')
    expect(within(c).getAllByText('$9.25')[0]).toBeInTheDocument()
    expect(within(c).getByText('40 votes')).toBeInTheDocument()
    expect(within(c).getByText('12 comments')).toBeInTheDocument()
  })

  it('formats big view counts and marks videos already watched', () => {
    mount({
      videos: [video('badadib', 'a', { views: 2_500_000 }), video('badadib', 'b', { views: 999 })],
      isWatched: (_a, p) => p === 'b',
    })
    expect(within(card('Title a')).getByText('2.5M views')).toBeInTheDocument()
    expect(within(card('Title b')).getByText('999 views (watched)')).toBeInTheDocument()
  })

  it('uses another link form for other prefixes, with the page\'s query', () => {
    mount({ videos: [video('badadib', 'clip')], linkPrefix: '/shorts', linkQuery: '&from=feed' })
    expect(card('Title clip')).toHaveAttribute('href', '/shorts?v=badadib/clip&from=feed')
  })

  it('a live room links to the stream and is badged LIVE, a group chat LIVE CHAT', () => {
    mount({
      videos: [
        video('badadib', 'live-1', { _liveStream: true, roomName: 'room-1', thumbnail: '/t.jpg', views: 5 }),
        video('badadib', 'chat-1', { _liveStream: true, _openpodRoom: true, roomName: 'pod-1', thumbnail: '/t.jpg' }),
      ],
    })
    expect(card('Title live-1')).toHaveAttribute('href', '/watch/room-1')
    expect(within(card('Title live-1')).getByText('● LIVE')).toBeInTheDocument()
    expect(within(card('Title live-1')).getByTitle('5 watching now')).toBeInTheDocument()
    expect(within(card('Title live-1')).queryByText('2:05')).not.toBeInTheDocument()
    expect(card('Title chat-1')).toHaveAttribute('href', '/openpods/pod-1')
    expect(within(card('Title chat-1')).getByText('● LIVE CHAT')).toBeInTheDocument()
  })

  it.each([
    [{ status: 'encoding' }, 'Processing'],
    [{ status: 'draft' }, 'Draft'],
    [{ status: 'failed' }, 'Failed'],
    [{ status: 'deleted' }, 'Deleted'],
    [{ unlisted: true }, 'Unlisted'],
    [{ status: 'scheduled', publish_type: 'schedule' }, 'Scheduled'],
    [{ publish_type: 'publish_manual' }, 'Mobile'],
    [{ gated: true }, 'PRO'],
  ])('badges a video with %o as "%s"', (extra, label) => {
    mount({ videos: [video('badadib', 'v', extra)] })
    expect(within(card('Title v')).getByText(label)).toBeInTheDocument()
  })

  it('a scheduled video opens in scheduled mode', () => {
    mount({ videos: [video('badadib', 'later', { _scheduled: true })] })
    expect(card('Title later')).toHaveAttribute('href', '/@badadib/later?scheduled=1')
  })

  it('marks what is new since the last visit', () => {
    mount({ videos: [video('badadib', 'a'), video('badadib', 'b')], isNew: (v) => v.permlink === 'a' })
    expect(within(card('Title a')).getByText('NEW')).toBeInTheDocument()
    expect(within(card('Title b')).queryByText('NEW')).not.toBeInTheDocument()
  })

  it('leaves out videos whose media is gone', () => {
    m.dead = new Set(['badadib/gone'])
    mount({ videos: [video('badadib', 'gone'), video('badadib', 'fine')] })
    expect(screen.queryByRole('heading', { name: 'Title gone' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Title fine' })).toBeInTheDocument()
  })

  it('hides AI-generated videos by default, and only badges them when that is off', () => {
    m.ai = new Set(['badadib/robot'])
    const { unmount } = mount({ videos: [video('badadib', 'robot'), video('badadib', 'human')] })
    expect(screen.queryByRole('heading', { name: 'Title robot' })).not.toBeInTheDocument()
    unmount()
    act(() => useAppStore.setState({ hideAi: false }))
    mount({ videos: [video('badadib', 'robot'), video('badadib', 'human')] })
    expect(within(card('Title robot')).getByText('AI')).toBeInTheDocument()
    expect(within(card('Title human')).queryByText('AI')).not.toBeInTheDocument()
  })

  it('drops watched videos only for a feed that asks for it', () => {
    const isWatched = (_a, p) => p === 'seen'
    const { unmount } = mount({ videos: [video('badadib', 'seen'), video('badadib', 'unseen')], isWatched })
    expect(screen.getByRole('heading', { name: 'Title seen' })).toBeInTheDocument()
    unmount()
    mount({ videos: [video('badadib', 'seen'), video('badadib', 'unseen')], isWatched, hideWatched: true })
    expect(screen.queryByRole('heading', { name: 'Title seen' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Title unseen' })).toBeInTheDocument()
  })

  it('a shorts grid shows the caption on hover instead of a length', () => {
    mount({ videos: [video('badadib', 's1', { heading: 'My first short' })], shortsGrid: true })
    const c = card('Title s1')
    expect(c).toHaveAttribute('title', 'My first short')
    expect(within(c).queryByText('2:05')).not.toBeInTheDocument()
  })

  it('splices a full-width rail in after every few cards, never after the last', () => {
    mount({
      videos: [video('badadib', 'a'), video('badadib', 'b'), video('badadib', 'c'), video('badadib', 'd')],
      interleaveEvery: 2,
      renderInterleave: (slot) => <p>{`Shorts rail ${slot}`}</p>,
    })
    expect(screen.getByText('Shorts rail 0')).toBeInTheDocument()
    expect(screen.queryByText('Shorts rail 1')).not.toBeInTheDocument()
    const order = [...document.querySelector('.card-container').children].map((el) => el.textContent.match(/Title \w|Shorts rail \d/)[0])
    expect(order).toEqual(['Title a', 'Title b', 'Shorts rail 0', 'Title c', 'Title d'])
  })

  it('names the broad category of the topic a video was filed under', () => {
    mount({ videos: [video('badadib', 'code', { tag_v2: 'programming' })] })
    expect(within(card('Title code')).getByTitle('Topic: Tech & Science')).toHaveTextContent('Tech & Science')
  })

  it('marks a creator who is new and not on Hive yet, without a payout', () => {
    mount({ videos: [video('newbie', 'hello', { _incubation: true })] })
    const c = card('Title hello')
    expect(within(c).getByRole('img', { name: 'New on 3Speak' })).toBeInTheDocument()
    expect(within(c).queryByText('$1.5')).not.toBeInTheDocument()
  })

  describe('the Spotlight card', () => {
    const items = [video('badadib', 'one'), video('badadib', 'two'), video('badadib', 'three')]
    const layout = { span: 2, rows: 2, weight: 4 }
    const nav = (over = {}) => ({ items, index: 0, onSelect: vi.fn(), size: 'small', onCycleSize: vi.fn(), ...over })

    it('draws the first video large, badged, with arrows and the rest of the line-up', async () => {
      const featuredNav = nav()
      const { user } = mount({ videos: [items[0], video('badadib', 'grid')], featuredKey: 'badadib/one', featuredLayout: layout, featuredNav })
      const big = cell('Title one')
      expect(big).toHaveClass('card--featured')
      expect(big).toHaveStyle({ gridColumn: 'span 2', gridRow: 'span 2' })
      expect(within(big).getByText('Spotlight')).toBeInTheDocument()
      expect(within(big).getByRole('button', { name: 'Title two' })).toBeInTheDocument()
      expect(within(big).queryByRole('button', { name: 'Title one' })).not.toBeInTheDocument()

      await user.click(within(big).getByRole('button', { name: 'Next video' }))
      expect(featuredNav.onSelect).toHaveBeenLastCalledWith(1)
      await user.click(within(big).getByRole('button', { name: 'Previous video' }))
      expect(featuredNav.onSelect).toHaveBeenLastCalledWith(2)
      await user.click(within(big).getByRole('button', { name: 'Title three' }))
      expect(featuredNav.onSelect).toHaveBeenLastCalledWith(2)
      // None of these follow the card's own link.
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/)
    })

    it('changes its size from its own button', async () => {
      const featuredNav = nav()
      const { user } = mount({ videos: [items[0]], featuredKey: 'badadib/one', featuredLayout: layout, featuredNav })
      await user.click(screen.getByRole('button', { name: 'Change size: Small' }))
      expect(featuredNav.onCycleSize).toHaveBeenCalledTimes(1)
    })

    it('holds its place with a skeleton while the featured videos are on their way', () => {
      mount({ videos: [video('badadib', 'grid')], featuredKey: 'badadib/one', featuredLayout: layout, featuredPending: true })
      expect(document.querySelector('.card-container').children).toHaveLength(2)
      expect(screen.getByRole('heading', { name: 'Title grid' })).toBeInTheDocument()
    })
  })

  describe('dismissing from a card\'s menu (touch screens draw it on the card)', () => {
    beforeEach(() => { m.canHover = false })

    it('"not interested" drops that card at once', async () => {
      const { user } = mount({ videos: [video('badadib', 'a'), video('badadib', 'b')] })
      await user.click(screen.getByRole('button', { name: 'Not interested in a' }))
      expect(screen.queryByRole('heading', { name: 'Title a' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Title b' })).toBeInTheDocument()
    })

    it('hiding a creator drops all their cards, whatever the letter case, and Undo brings them back', async () => {
      const { user } = mount({ videos: [video('badadib', 'a'), video('BadAdib', 'b'), video('other-creator', 'c')] })
      await user.click(screen.getByRole('button', { name: 'Hide badadib from a' }))
      expect(screen.queryByRole('heading', { name: 'Title a' })).not.toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Title b' })).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Title c' })).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Undo hide from c' }))
      expect(screen.getByRole('heading', { name: 'Title c' })).toBeInTheDocument()
    })

    it('puts the menu on the card only where there is no hover preview to carry it', () => {
      m.canHover = true
      mount({ videos: [video('badadib', 'a')] })
      expect(screen.queryByRole('button', { name: 'Not interested in a' })).not.toBeInTheDocument()
    })
  })

  // BUG: on touch screens the card's "more options" button is rendered inside the
  // card's <a> (Card3.jsx:489-496 inside the CardLink at :116-124): a button
  // nested in a link, which HTML forbids and assistive tech reads as one control.
  it('BUG: the card\'s controls are not nested inside its link', () => {
    m.canHover = false
    mount({ videos: [video('badadib', 'a')] })
    expect(within(card('Title a')).queryAllByRole('button')).toHaveLength(0)
  })
})
