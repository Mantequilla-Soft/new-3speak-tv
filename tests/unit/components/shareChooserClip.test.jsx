// Share → Clip (components/Chat/ShareChooserModal): clipping happens on the
// player, so the Clip tab closes the sheet and starts the page's clip mode at
// once instead of showing an empty pane. Everything that reaches out is a stand-in.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hooks/useReblog', () => ({ default: () => ({ canReblog: false }) }))
vi.mock('../../../src/components/modal/usePostThumb', () => ({ default: () => ({}) }))
vi.mock('../../../src/hive-api/api', () => ({ getFollowers: async () => ({ follower_count: 0 }) }))
vi.mock('../../../src/hive-api/aioha', () => ({ isLoggedIn: () => false, getOperationUser: () => null }))
vi.mock('../../../src/context/ChatContext', () => ({ useChat: () => ({}) }))
vi.mock('../../../src/hooks/useOpenChat', () => ({ useOpenChat: () => () => {} }))

const { default: ShareChooserModal } = await import('../../../src/components/Chat/ShareChooserModal.jsx')

describe('Share → Clip', () => {
  it('closes the sheet and starts clip mode', async () => {
    const onClip = vi.fn()
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <ShareChooserModal open url="https://3speak.tv/watch?v=badadib/test" title="Test" onClip={onClip} onClose={onClose} />,
    )
    await user.click(screen.getByRole('tab', { name: 'Clip' }))
    expect(onClose).toHaveBeenCalled()
    expect(onClip).toHaveBeenCalled()
  })

  it('has no Clip tab where clipping is not offered', () => {
    renderWithProviders(<ShareChooserModal open url="https://3speak.tv/watch?v=badadib/test" title="Test" onClose={() => {}} />)
    expect(screen.queryByRole('tab', { name: 'Clip' })).not.toBeInTheDocument()
  })
})
