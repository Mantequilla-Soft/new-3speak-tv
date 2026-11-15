// Creating a poll from the channel (Userprofilepage/SnapComposer): Poll opens 2
// option fields (up to 4), the end is picked, and the post goes out with the poll
// block; too few options never publish. publishSnap and the editor are stand-ins.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const publishSnap = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/snaps', () => ({ publishSnap, SNAP_TAG: 'community', MAX_USER_TAGS: 9 }))
vi.mock('../../../src/components/studio/MarkdownComposer', () => ({
  default: ({ value, onChange, placeholder }) => <textarea aria-label="body" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />,
}))
const error = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/toast', () => ({ toastIn: () => ({ success: vi.fn(), error }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: SnapComposer } = await import('../../../src/components/Userprofilepage/SnapComposer.jsx')

beforeEach(() => {
  publishSnap.mockReset().mockResolvedValue({ permlink: 'which-topic-1', indexed: null })
  error.mockReset()
  useAppStore.setState({ authenticated: true, user: 'badadib' })
})

describe('poll in the composer', () => {
  it('publishes the question with 3 options ending in 3 days', async () => {
    const onPosted = vi.fn()
    const { user } = renderWithProviders(<SnapComposer onPosted={onPosted} />)
    await user.click(screen.getByRole('button', { name: 'Poll' }))
    expect(screen.getByPlaceholderText('Ask your followers a question')).toBeInTheDocument()
    await user.type(screen.getByLabelText('body'), 'Which topic next?')
    await user.type(screen.getByLabelText('Option 1'), 'Music')
    await user.type(screen.getByLabelText('Option 2'), 'Code')
    await user.click(screen.getByRole('button', { name: 'Add option' }))
    await user.type(screen.getByLabelText('Option 3'), 'Art')
    await user.click(screen.getByRole('tab', { name: '3 days' }))
    await user.click(screen.getByRole('button', { name: /Post/ }))
    await waitFor(() => expect(publishSnap).toHaveBeenCalled())
    const { poll, body } = publishSnap.mock.calls[0][0]
    expect(body).toBe('Which topic next?')
    expect(poll.options).toEqual(['Music', 'Code', 'Art'])
    expect(new Date(poll.ends_at).getTime() - Date.now()).toBeGreaterThan(2.9 * 86400000)
    expect(onPosted).toHaveBeenCalledWith(expect.objectContaining({ poll }))
  })

  it('one filled option is not a poll and nothing is published', async () => {
    const { user } = renderWithProviders(<SnapComposer />)
    await user.click(screen.getByRole('button', { name: 'Poll' }))
    await user.type(screen.getByLabelText('body'), 'Hmm?')
    await user.type(screen.getByLabelText('Option 1'), 'Only one')
    await user.click(screen.getByRole('button', { name: /Post/ }))
    expect(error).toHaveBeenCalledWith('A poll needs 2 to 4 different options.')
    expect(publishSnap).not.toHaveBeenCalled()
  })
})
