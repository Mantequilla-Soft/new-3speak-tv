// @vitest-environment jsdom
// The comments under a video on the watch page (components/playVideo/CommentSection.jsx):
// the thread loaded from Hive with its replies, the count, sorting, pins by the
// video's creator, writing a comment (with the moment of the video it refers
// to), replying, and editing your own comment. Hive is a stand-in client; the
// broadcast (commentWithAioha) and the pin call are spies.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, screen, within, waitFor } from '@testing-library/react'
import { renderWithProviders, toastMessages } from './_render.jsx'

const m = vi.hoisted(() => ({}))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule({
  commentWithAioha: (...a) => m.comment(...a),
}))
vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => ({ call: (...a) => m.call(...a) }), getHiveUrl: () => 'https://api.hive.example' }))
vi.mock('../../../src/lib/hiveRenderer', () => ({ getHiveRenderer: async () => (md) => `<p>${md}</p>` }))
vi.mock('../../../src/utils/reputation', () => ({
  markByReputation: async (list) => list.map((c) => ({ ...c, isLowReputation: c.author.username === 'spammer' })),
  getUserReputation: async () => 60,
}))
vi.mock('../../../src/utils/hiddenCreators', () => ({ markByHidden: async (list) => list }))
vi.mock('../../../src/utils/offChainReplies', () => ({
  mergeOffChainReplies: async (_p, list) => [...list, ...m.offChain],
  applyOffChainLikes: async (list) => list,
}))
vi.mock('../../../src/lib/commentPins', () => ({ setCommentPinned: (...a) => m.pin(...a) }))
vi.mock('../../../src/lib/incubation', () => ({ handleAvatar: () => '/avatar.png', postIncubationContent: (...a) => m.storeOffChain(...a) }))
vi.mock('../../../src/utils/hiveUtils', () => ({ estimate: async () => 0, getVotePower: async () => null }))
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn() }))
vi.mock('../../../src/hooks/useTranslation', () => ({ default: () => ({ translate: vi.fn(), getTranslation: () => null, clearTranslation: vi.fn(), translating: {} }) }))
vi.mock('../../../src/hooks/useEmojiShortcodes', () => ({ default: () => ({ change: (e) => e.target.value, keyDown: () => {}, blur: () => {}, popup: null }) }))
vi.mock('ldrs/react', () => ({ TailChase: () => <span>Loading comments</span> }))
// Children with their own data or wallet calls.
vi.mock('../../../src/components/AuthorBadge/AuthorBadge', () => ({ default: ({ author }) => <span>@{author}</span> }))
vi.mock('../../../src/components/TimeAgo/TimeAgo', () => ({ default: () => <span>1h</span> }))
vi.mock('../../../src/components/UpvoteCount/UpvoteCount', () => ({ default: ({ count }) => <span>{count} likes</span> }))
vi.mock('../../../src/components/PayoutAmount/PayoutAmount', () => ({ default: () => null }))
vi.mock('../../../src/components/TranslateButton/TranslateButton', () => ({ default: () => null }))
vi.mock('../../../src/components/ReactVideoModal/ReactVideoModal', () => ({ default: () => <p>Record a reaction</p> }))
vi.mock('../../../src/components/common/EmojiGifPicker/EmojiGifPicker', () => ({ default: () => null }))
vi.mock('../../../src/components/tooltip/UpvoteTooltip', () => ({ default: () => null }))
vi.mock('../../../src/components/tooltip/CommentVoteTooltip', () => ({ default: () => null }))
vi.mock('../../../src/components/modal/ReportModal', () => ({
  default: ({ isOpen, target }) => (isOpen ? <div role="dialog" aria-label="Report">{`${target.author}/${target.permlink}`}</div> : null),
  isReported: () => false,
}))

const { toast } = await import('sonner')
const { useAppStore } = await import('../../../src/lib/store')
const { default: CommentSection } = await import('../../../src/components/playVideo/CommentSection.jsx')

const raw = (author, permlink, extra = {}) => ({
  author, permlink, body: `Body of ${permlink}`, created: '2026-11-01T10:00:00', last_update: '2026-11-01T10:00:00',
  parent_author: 'badadib', parent_permlink: 'my-video', json_metadata: '{}', active_votes: [], pending_payout_value: '0.000 HBD', ...extra,
})

// The thread: two top-level comments, one with a reply, plus a low-reputation one.
const THREAD = {
  'badadib/my-video': [
    raw('viewer-a', 'c1', { created: '2026-11-01T09:00:00', active_votes: [{ voter: 'x', percent: 100 }] }),
    raw('viewer-b', 'c2', { created: '2026-11-02T09:00:00', json_metadata: '{"parentTimestamp":75}' }),
    raw('spammer', 'c3'),
  ],
  'viewer-a/c1': [raw('viewer-c', 'r1', { parent_author: 'viewer-a', parent_permlink: 'c1' })],
}

function mount(props = {}) {
  const onSeek = vi.fn()
  const r = renderWithProviders(
    <CommentSection author="badadib" permlink="my-video" currentTime={0} duration={600} onSeek={onSeek} {...props} />,
  )
  return { ...r, onSeek }
}
const loaded = () => screen.findByText('Body of c1')
const composer = () => screen.getByPlaceholderText('Write your comment here...')
const commentOf = (text) => screen.getByText(text).closest('.comment-container')

beforeEach(() => {
  localStorage.clear()
  m.call = vi.fn(async (_api, _method, [a, p]) => THREAD[`${a}/${p}`] || [])
  m.comment = vi.fn(async () => ({ success: true }))
  m.pin = vi.fn(async ({ comment, pinned }) => (pinned ? [comment] : []))
  m.storeOffChain = vi.fn(async () => ({ permlink: 'stored-1' }))
  m.offChain = []
  useAppStore.setState({ user: null, incubationHandle: null })
})

describe('the comments under a video', () => {
  it('loads the Hive thread with its replies and counts them', async () => {
    mount()
    await loaded()
    expect(m.call).toHaveBeenCalledWith('condenser_api', 'get_content_replies', ['badadib', 'my-video'])
    expect(screen.getByRole('heading', { name: '3 Comments' })).toBeInTheDocument()
    expect(screen.getByText('Body of c2')).toBeInTheDocument()
    expect(within(commentOf('Body of c1')).getByText('Body of r1')).toBeInTheDocument()
    expect(within(commentOf('Body of c1')).getAllByRole('button', { name: 'Vote' })[0]).toHaveTextContent('1')
  })

  it('leaves out low-reputation accounts, also from the count', async () => {
    mount()
    await loaded()
    expect(screen.queryByText('Body of c3')).not.toBeInTheDocument()
  })

  it('still shows the off-chain replies of a post Hive does not know', async () => {
    m.call = vi.fn(async () => { throw new Error('Post badadib/my-video does not exist') })
    m.offChain = [{ author: { username: 'newbie' }, permlink: 'oc1', body: 'Off-chain hello', created_at: '2026-11-03T10:00:00Z', onChain: false, children: [] }]
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mount()
    expect(await screen.findByText('Off-chain hello')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '1 Comment' })).toBeInTheDocument()
  })

  it('sorts newest first by default and remembers another order', async () => {
    const { user } = mount()
    await loaded()
    const order = () => [...document.querySelectorAll('.comment-list > .comment-container')].map((c) => c.querySelector('.markdown-view').textContent)
    expect(order()).toEqual(['Body of c2', 'Body of c1'])
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'oldest')
    expect(order()).toEqual(['Body of c1', 'Body of c2'])
    expect(localStorage.getItem('3speak_comment_sort')).toBe('oldest')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'popular')
    expect(order()[0]).toBe('Body of c1')
  })

  it('puts the creator\'s pins first, marked as pinned', async () => {
    mount({ pinnedComments: ['c1'] })
    await loaded()
    const first = document.querySelector('.comment-list > .comment-container')
    expect(within(first).getByText('Body of c1')).toBeInTheDocument()
    expect(within(first).getByText('Pinned by creator')).toBeInTheDocument()
  })

  it('jumps the video to the moment a comment refers to', async () => {
    const { user, onSeek } = mount()
    await loaded()
    await user.click(screen.getByText('at 1:15'))
    expect(onSeek).toHaveBeenCalledWith(75)
  })

  it('folds a comment away and opens it again', async () => {
    const { user } = mount()
    await loaded()
    const c2 = commentOf('Body of c2')
    await user.click(c2.querySelector('.comment-collapse-chevron'))
    expect(screen.queryByText('Body of c2')).not.toBeInTheDocument()
    await user.click(screen.getByText('@viewer-b').closest('.comment-collapsed-bar'))
    expect(screen.getByText('Body of c2')).toBeInTheDocument()
  })

  it('opens the report window for a comment', async () => {
    const { user } = mount()
    await loaded()
    await user.click(within(commentOf('Body of c2')).getByRole('button', { name: 'Report comment' }))
    expect(screen.getByRole('dialog', { name: 'Report' })).toHaveTextContent('viewer-b/c2')
  })

  it('switches the composer to recording a video reaction', async () => {
    const { user } = mount()
    await loaded()
    await user.click(screen.getAllByRole('tab', { name: 'React' })[0])
    expect(screen.getByText('Record a reaction')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Write your comment here...')).not.toBeInTheDocument()
  })

  // BUG: the "at 0:00" field that sets which moment a comment refers to has no
  // label: the "at" beside it is a plain <span> (CommentSection.jsx:701-710), so
  // a screen reader announces only its placeholder, "0:00".
  it('BUG: the moment field is labelled', async () => {
    mount()
    await loaded()
    expect(screen.getByRole('textbox', { name: /^at/i })).toBeInTheDocument()
  })

  // BUG: folding a comment is a <span onClick> (CommentSection.jsx:996), and the
  // folded bar a <div onClick> (:974): neither can be reached or used from the
  // keyboard, and neither has a name.
  it('BUG: a comment can be folded from the keyboard', async () => {
    mount()
    await loaded()
    expect(within(commentOf('Body of c2')).getByRole('button', { name: /collapse|hide|fold/i })).toBeInTheDocument()
  })
})

describe('writing a comment', () => {
  beforeEach(() => act(() => useAppStore.setState({ user: 'listener' })))

  it('posts it under the video and shows it at the top straight away', async () => {
    const { user } = mount()
    await loaded()
    await user.type(composer(), 'Great video')
    await user.click(screen.getAllByRole('button', { name: 'Comment' }).at(-1))
    expect(m.comment).toHaveBeenCalledWith('badadib', 'my-video', expect.stringMatching(/^re-my-video-\d+$/), '', 'Great video', { app: '3speak/new-version' })
    expect(toastMessages(toast.success)).toContain('Comment posted successfully!')
    const first = document.querySelector('.comment-list > .comment-container')
    await waitFor(() => expect(within(first).getByText('Great video')).toBeInTheDocument())
    expect(within(first).getByText('@listener')).toBeInTheDocument()
    expect(composer()).toHaveValue('')
    expect(screen.getByRole('heading', { name: '4 Comments' })).toBeInTheDocument()
  })

  it('ties the comment to the moment it was written at, and links timestamps in it', async () => {
    const { user } = mount({ currentTime: 42.6 })
    await loaded()
    expect(screen.getByDisplayValue('0:42')).toBeInTheDocument()
    await user.type(composer(), 'See 1:30')
    await user.click(screen.getAllByRole('button', { name: 'Comment' }).at(-1))
    const [, , , , body, meta] = m.comment.mock.calls[0]
    expect(meta).toEqual({ app: '3speak/new-version', parentTimestamp: 42 })
    expect(body).toMatch(/^See \[1:30\]\(https:\/\/3speak\.tv\/watch\?v=badadib\/my-video&t=90\)/)
    expect(body).toMatch(/<sup>replied to \[0:42\]\(.*&t=42\) on \[.*\]\(.*\)<\/sup>$/)
  })

  it('a moment typed by hand wins over the playhead, and a moment past the end is refused', async () => {
    const { user } = mount({ currentTime: 10 })
    await loaded()
    const at = screen.getByDisplayValue('0:10')
    await user.clear(at)
    await user.type(at, '2:05')
    await user.tab()
    expect(at).toHaveValue('2:05')
    await user.clear(at)
    await user.type(at, '99:00')
    await user.tab()
    expect(at).toHaveValue('0:10')
  })

  it('posts nothing for an empty comment', async () => {
    const { user } = mount()
    await loaded()
    await user.type(composer(), '   ')
    await user.click(screen.getAllByRole('button', { name: 'Comment' }).at(-1))
    expect(m.comment).not.toHaveBeenCalled()
  })

  it('keeps the text and says so when the broadcast fails', async () => {
    m.comment = vi.fn(async () => ({ success: false }))
    const { user } = mount()
    await loaded()
    await user.type(composer(), 'Great video')
    await user.click(screen.getAllByRole('button', { name: 'Comment' }).at(-1))
    expect(toastMessages(toast.error)).toContain('Comment failed, please try again')
    expect(composer()).toHaveValue('Great video')
  })

  it('shows the wallet\'s own error', async () => {
    m.comment = vi.fn(async () => { throw new Error('Keychain locked') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = mount()
    await loaded()
    await user.type(composer(), 'Great video')
    await user.click(screen.getAllByRole('button', { name: 'Comment' }).at(-1))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('Keychain locked'))
  })

  it('Cancel empties the composer', async () => {
    const { user } = mount()
    await loaded()
    await user.type(composer(), 'Draft')
    await user.click(screen.getAllByRole('button', { name: 'Cancel' })[0])
    expect(composer()).toHaveValue('')
  })

  it('stores the comment off-chain when the video itself is not on Hive', async () => {
    const { user } = mount({ videoDetails: { _incubation: true } })
    await loaded()
    await user.type(composer(), 'Welcome!')
    await user.click(screen.getAllByRole('button', { name: 'Comment' }).at(-1))
    expect(m.storeOffChain).toHaveBeenCalledWith({ body: 'Welcome!', parentAuthor: 'badadib', parentPermlink: 'my-video', jsonMetadata: { app: '3speak/new-version' } })
    expect(m.comment).not.toHaveBeenCalled()
  })

  it('replies to a comment, inheriting its moment, and shows the reply under it', async () => {
    const { user } = mount()
    await loaded()
    const c2 = commentOf('Body of c2')
    await user.click(within(c2).getByRole('button', { name: 'Reply' }))
    const box = screen.getByPlaceholderText('Write your reply here...')
    expect(within(c2).getAllByText('at 1:15').length).toBe(2)
    await user.type(box, 'Agreed')
    await user.click(within(c2).getAllByRole('button', { name: 'Comment' }).at(-1))
    expect(m.comment).toHaveBeenCalledWith('viewer-b', 'c2', expect.stringMatching(/^re-c2-\d+$/), '', expect.stringMatching(/^Agreed\n<br><sup>replied to \[1:15\]/), { app: '3speak/new-version', parentTimestamp: 75 })
    await waitFor(() => expect(within(commentOf('Body of c2')).getByText('Agreed')).toBeInTheDocument())
    expect(screen.queryByPlaceholderText('Write your reply here...')).not.toBeInTheDocument()
  })

  it('Cancel closes the reply box', async () => {
    const { user } = mount()
    await loaded()
    await user.click(within(commentOf('Body of c2')).getByRole('button', { name: 'Reply' }))
    await user.click(within(commentOf('Body of c2')).getAllByRole('button', { name: 'Cancel' }).at(-1))
    expect(screen.queryByPlaceholderText('Write your reply here...')).not.toBeInTheDocument()
  })
})

describe('editing your own comment', () => {
  beforeEach(() => act(() => useAppStore.setState({ user: 'viewer-b' })))

  it('offers Edit only on your own comments', async () => {
    mount()
    await loaded()
    expect(within(commentOf('Body of c2')).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(within(commentOf('Body of r1')).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('re-broadcasts the same comment with the new text and marks it edited', async () => {
    const { user } = mount()
    await loaded()
    await user.click(within(commentOf('Body of c2')).getByRole('button', { name: 'Edit' }))
    const box = screen.getByDisplayValue('Body of c2')
    await user.clear(box)
    await user.type(box, 'Fixed typo')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    // Same parent, same permlink, and the original metadata (its moment) kept.
    expect(m.comment).toHaveBeenCalledWith('badadib', 'my-video', 'c2', '', 'Fixed typo', { parentTimestamp: 75 })
    expect(await screen.findByText('Fixed typo')).toBeInTheDocument()
    expect(within(commentOf('Fixed typo')).getByText('(edited)')).toBeInTheDocument()
    expect(toastMessages(toast.success)).toContain('Comment updated')
  })

  it('keeps the editor open when the edit fails', async () => {
    m.comment = vi.fn(async () => ({ success: false }))
    const { user } = mount()
    await loaded()
    await user.click(within(commentOf('Body of c2')).getByRole('button', { name: 'Edit' }))
    await user.type(screen.getByDisplayValue('Body of c2'), '!')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(toastMessages(toast.error)).toContain('Edit failed, please try again')
    expect(screen.getByDisplayValue('Body of c2!')).toBeInTheDocument()
  })
})

describe('pinning comments', () => {
  it('lets the video\'s creator pin a comment to the top', async () => {
    act(() => useAppStore.setState({ user: 'badadib' }))
    const { user } = mount({ pinnable: true })
    await loaded()
    await user.click(within(commentOf('Body of c1')).getByRole('button', { name: 'Pin' }))
    expect(m.pin).toHaveBeenCalledWith({ author: 'badadib', permlink: 'my-video', comment: 'c1', pinned: true })
    await waitFor(() => expect(within(commentOf('Body of c1')).getByText('Pinned by creator')).toBeInTheDocument())
    expect(toastMessages(toast.success)).toContain('Comment pinned')
    // and to unpin it again
    await user.click(within(commentOf('Body of c1')).getByRole('button', { name: 'Unpin' }))
    expect(m.pin).toHaveBeenLastCalledWith({ author: 'badadib', permlink: 'my-video', comment: 'c1', pinned: false })
    await waitFor(() => expect(within(commentOf('Body of c1')).queryByText('Pinned by creator')).not.toBeInTheDocument())
  })

  it('says when the pin could not be changed', async () => {
    act(() => useAppStore.setState({ user: 'badadib' }))
    m.pin = vi.fn(async () => { throw new Error('Signature refused') })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { user } = mount({ pinnable: true })
    await loaded()
    await user.click(within(commentOf('Body of c1')).getByRole('button', { name: 'Pin' }))
    await waitFor(() => expect(toastMessages(toast.error)).toContain('Signature refused'))
  })

  it('offers no pins to anyone else, and none on replies', async () => {
    act(() => useAppStore.setState({ user: 'viewer-a' }))
    mount({ pinnable: true })
    await loaded()
    expect(screen.queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument()
  })

  it('offers pins on top-level comments only', async () => {
    act(() => useAppStore.setState({ user: 'badadib' }))
    mount({ pinnable: true })
    await loaded()
    expect(screen.getAllByRole('button', { name: 'Pin' })).toHaveLength(2)
  })
})
