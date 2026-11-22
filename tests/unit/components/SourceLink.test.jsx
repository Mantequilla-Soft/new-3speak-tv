// @vitest-environment jsdom
// The card on a Short made from a longer post (components/SourceLink): the full
// video (at the clip's moment), the stream, or a premiere's countdown.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ post: vi.fn(), premiere: vi.fn() }))
vi.mock('../../../src/hive-api/hiveApi', () => ({ getPostDetails: h.post }))
vi.mock('../../../src/lib/premieres', async (orig) => ({ ...(await orig()), fetchPremiere: h.premiere }))

const { default: SourceLink, untilParts } = await import('../../../src/components/SourceLink/SourceLink.jsx')

beforeEach(() => {
  h.post.mockReset().mockResolvedValue({ title: 'The long talk', json_metadata: JSON.stringify({ image: ['https://img/c.jpg'] }) })
  h.premiere.mockReset().mockResolvedValue({ premiere: null })
})

describe('SourceLink', () => {
  it('a clip opens the full video at its moment', async () => {
    renderWithProviders(<SourceLink source={{ kind: 'clip', author: 'bob', permlink: 'talk', start: 75 }} />)
    const link = screen.getByTestId('source-link')
    expect(link).toHaveAttribute('href', '/@bob/talk?t=75')
    expect(link).toHaveTextContent('Full video')
    await waitFor(() => expect(link).toHaveTextContent('The long talk'))
  })

  it('a stream clip opens the full stream', () => {
    renderWithProviders(<SourceLink source={{ kind: 'stream_clip', author: 'bob', permlink: 'bob-r1' }} />)
    expect(screen.getByTestId('source-link')).toHaveTextContent('Full stream')
  })

  it('a teaser of a premiere that has not started counts down to it', async () => {
    h.premiere.mockResolvedValue({ premiere: { startAt: new Date(Date.now() + (2 * 60 + 5) * 60000 - 1000).toISOString(), chatUntil: new Date(Date.now() + 9e6).toISOString() } })
    renderWithProviders(<SourceLink source={{ kind: 'teaser', author: 'bob', permlink: 'premiere' }} />)
    await waitFor(() => expect(screen.getByTestId('source-link')).toHaveTextContent('Premieres in 2 h 5 min'))
    expect(screen.getByTestId('source-link')).toHaveAttribute('href', '/@bob/premiere')
  })

  it('nothing for kinds with their own card, or no source', () => {
    const { container } = renderWithProviders(<SourceLink source={{ kind: 'audiogram', author: 'bob', permlink: 'ep' }} />)
    expect(container.querySelector('[data-testid="source-link"]')).toBeNull()
    expect(untilParts(Date.now() + 30000, Date.now())).toEqual({ h: 0, m: 1 })
  })
})
