// Comment inbox (components/CommentInbox): unanswered comments first, the
// filters, an inline reply posted under the comment, "Reply with a video" with
// the comment as the parent, and mark done with its counts.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const fetchCommentInbox = vi.hoisted(() => vi.fn())
const setCommentDone = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/commentInbox', async () => ({
  ...(await vi.importActual('../../../src/lib/commentInbox')),
  fetchCommentInbox,
  setCommentDone,
}))
const commentWithAioha = vi.hoisted(() => vi.fn())
vi.mock('../../../src/hive-api/aioha', () => ({ commentWithAioha }))
vi.mock('../../../src/lib/hiveRenderer', () => ({ getHiveRenderer: async () => (body) => `<p>${body}</p>` }))
vi.mock('../../../src/components/HiveAvatar/HiveAvatar', () => ({ default: () => <span /> }))
vi.mock('../../../src/components/TimeAgo/TimeAgo', () => ({ default: () => <span>1h</span> }))
vi.mock('../../../src/components/ReactVideoModal/ReactVideoModal', () => ({
  default: ({ author, permlink }) => <div data-testid="react-tab">{`${author}/${permlink}`}</div>,
}))
const success = vi.hoisted(() => vi.fn())
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success, error }) }))
// The comments section's filters, with stand-in Hive lookups: @spammy has a low
// score, @mutedbot is on the comment mutelist.
vi.mock('../../../src/utils/reputation', () => ({
  markByReputation: async (list) => list.map((i) => ({ ...i, isLowReputation: i.author === 'spammy' })),
}))
vi.mock('../../../src/utils/hiddenCreators', async () => ({
  ...(await vi.importActual('../../../src/utils/hiddenCreators')),
  markByHidden: async (list) => list.map((i) => (i.author === 'mutedbot' ? { ...i, isMuted: true } : i)),
}))

const { default: CommentInbox, INBOX_PAGE } = await import('../../../src/components/CommentInbox/CommentInbox.jsx')

const item = (permlink, body, over = {}) => ({
  author: 'fan', permlink, parentPermlink: 'post-a', rootPermlink: 'post-a', rootTitle: 'My first video', onPost: true,
  body, created: '2026-11-15T10:00:00.000Z', answered: false, question: false, firstTime: false, supporter: false, done: false, ...over,
})
const items = [
  item('re-1', 'What camera do you use?', { question: true, firstTime: true }),
  item('re-2', 'Great video', { supporter: true }),
  item('re-3', 'Already answered', { answered: true }),
  item('re-4', 'Handled earlier', { done: true }),
]

beforeEach(() => {
  fetchCommentInbox.mockReset()
  setCommentDone.mockReset()
  commentWithAioha.mockReset()
  success.mockReset()
  error.mockReset()
  fetchCommentInbox.mockResolvedValue({ days: 90, items })
  setCommentDone.mockResolvedValue({ success: true })
})

const articles = () => screen.queryAllByRole('article')

describe('comment inbox', () => {
  it('leaves out the comment mutelist and folds low scores away, as under a video', async () => {
    fetchCommentInbox.mockResolvedValue({ days: 90, items: [
      item('re-1', 'What camera do you use?'),
      item('re-5', 'Buy followers here', { author: 'mutedbot' }),
      item('re-6', 'Low score words', { author: 'spammy' }),
    ] })
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    expect(await screen.findByText('What camera do you use?')).toBeInTheDocument()
    expect(screen.queryByText('Buy followers here')).not.toBeInTheDocument()
    expect(screen.queryByText('Low score words')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Show/ }))
    expect(await screen.findByText('Low score words')).toBeInTheDocument()
  })

  it('opens on the unanswered ones, with what each one is', async () => {
    renderWithProviders(<CommentInbox user="badadib" />)
    expect(await screen.findByText('What camera do you use?')).toBeInTheDocument()
    expect(articles()).toHaveLength(2)
    const first = articles()[0]
    expect(within(first).getByText('@fan')).toHaveAttribute('href', '/@fan')
    expect(within(first).getByRole('link', { name: 'My first video' })).toHaveAttribute('href', '/@badadib/post-a')
    expect(within(first).getByText('Questions')).toBeInTheDocument()
    expect(within(first).getByText('First-time')).toBeInTheDocument()
    expect(fetchCommentInbox).toHaveBeenCalledWith('badadib')
  })

  it('All, Done and the flag chips', async () => {
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    await screen.findByText('Great video')
    await user.click(screen.getByRole('tab', { name: /All/ }))
    expect(articles()).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: /Supporters/ }))
    expect(articles()).toHaveLength(1)
    expect(screen.getByText('Great video')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Supporters/ }))
    await user.click(screen.getByRole('tab', { name: /Done/ }))
    expect(articles()).toHaveLength(1)
    expect(screen.getByText('Handled earlier')).toBeInTheDocument()
  })

  it('a reply is posted under the comment, and it leaves the unanswered list', async () => {
    commentWithAioha.mockResolvedValue({ success: true })
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    await screen.findByText('What camera do you use?')
    const first = articles()[0]
    await user.click(within(first).getByRole('button', { name: 'Reply' }))
    await user.type(within(first).getByRole('textbox', { name: 'Reply to @fan' }), 'A small mirrorless one')
    await user.click(within(first).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(commentWithAioha).toHaveBeenCalled())
    const [parentAuthor, parentPermlink, permlink, title, body] = commentWithAioha.mock.calls[0]
    expect([parentAuthor, parentPermlink, title, body]).toEqual(['fan', 're-1', '', 'A small mirrorless one'])
    expect(permlink).toMatch(/^re-re-1-\d+$/)
    expect(success).toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByText('What camera do you use?')).toBeNull())
  })

  it('a failed reply says so and keeps the text', async () => {
    commentWithAioha.mockResolvedValue({ success: false })
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    await screen.findByText('What camera do you use?')
    const first = articles()[0]
    await user.click(within(first).getByRole('button', { name: 'Reply' }))
    await user.type(within(first).getByRole('textbox'), 'Hello')
    await user.click(within(first).getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(error).toHaveBeenCalled())
    expect(within(first).getByRole('textbox')).toHaveValue('Hello')
  })

  it('reply with a video opens the React tab with the comment as the parent', async () => {
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    await screen.findByText('What camera do you use?')
    await user.click(within(articles()[0]).getByRole('button', { name: 'Reply with a video' }))
    expect(screen.getByTestId('react-tab')).toHaveTextContent('fan/re-1')
  })

  it('mark done saves it on the checker and takes it off the list', async () => {
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    await screen.findByText('Great video')
    await user.click(within(articles()[1]).getByRole('button', { name: 'Mark done' }))
    expect(setCommentDone).toHaveBeenCalledWith('badadib', 'fan', 're-2', true)
    expect(screen.queryByText('Great video')).toBeNull()
  })

  it('a failed load offers to try again', async () => {
    fetchCommentInbox.mockRejectedValueOnce(new Error('down'))
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    await user.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Great video')).toBeInTheDocument()
  })

  it('draws a page at a time: Show more adds the next, a new filter starts over', async () => {
    const many = Array.from({ length: INBOX_PAGE + 5 }, (_, i) => item(`re-m${i}`, `Comment ${i}`, { question: i % 2 === 0 }))
    fetchCommentInbox.mockResolvedValue({ days: 90, items: many })
    const { user } = renderWithProviders(<CommentInbox user="badadib" />)
    await screen.findByText('Comment 0')
    expect(articles()).toHaveLength(INBOX_PAGE)
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(articles()).toHaveLength(INBOX_PAGE + 5)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    // Questions only: 18 of them, one page, no Show more.
    await user.click(screen.getByRole('button', { name: /Questions/ }))
    expect(articles()).toHaveLength(18)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
    await user.click(screen.getByRole('button', { name: /Questions/ }))
    expect(articles()).toHaveLength(INBOX_PAGE)
  })
})
