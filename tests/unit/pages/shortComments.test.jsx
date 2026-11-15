// @vitest-environment jsdom
// Comments in the Shorts player (page/Short.jsx): the thread goes through
// markAndDropMuted (tested in utils/hiddenCreators.test.js), and a comment row for a
// muted, hidden or low-score author renders nothing.
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

vi.mock('../../../src/hive-api/aioha', async () => (await import('../components/_render.jsx')).aiohaModule())
vi.mock('sonner', async () => (await import('../components/_render.jsx')).sonnerModule())

const { CommentItem } = await import('../../../src/page/Short.jsx')

describe('a Shorts comment row', () => {
  it('renders nothing for a muted bot (no placeholder), nor for hidden or low-score authors', () => {
    for (const flag of ['isMuted', 'isHidden', 'isLowReputation']) {
      const { container, unmount } = render(
        <CommentItem comment={{ author: { username: 'ai-agent-hunter' }, permlink: 'bot1', body: 'beep', [flag]: true, children: [] }} depth={0} />,
      )
      expect(container).toBeEmptyDOMElement()
      unmount()
    }
  })
})
