// @vitest-environment jsdom
// The virtual series of a source (components/Episodes/SourceSeriesBar): the
// Shorts one creator cut from one episode or video, in the source's order.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ fetchDerived: vi.fn(), post: vi.fn() }))
vi.mock('../../../src/lib/derived', async (orig) => ({ ...(await orig()), fetchDerived: h.fetchDerived }))
vi.mock('../../../src/hive-api/hiveApi', () => ({ getPostDetails: h.post }))

const { default: SourceSeriesBar } = await import('../../../src/components/Episodes/SourceSeriesBar.jsx')
const { sourceSeriesPosition } = await import('../../../src/lib/derived')

const parts = ['p1', 'p2', 'p3'].map((permlink) => ({ author: 'bob', permlink }))
beforeEach(() => {
  h.fetchDerived.mockReset().mockResolvedValue({ items: parts, counts: {}, total: 3 })
  h.post.mockReset().mockResolvedValue({ title: 'Episode 5' })
})

describe('SourceSeriesBar', () => {
  it('Part 2 of 3 from the episode, Next part to the third', async () => {
    renderWithProviders(<SourceSeriesBar author="bob" permlink="p2" source={{ kind: 'audiogram', author: 'bob', permlink: 'ep-5' }} />)
    const bar = await screen.findByTestId('source-series-bar')
    expect(bar).toHaveTextContent('Part 2 of 3')
    await waitFor(() => expect(bar).toHaveTextContent('from Episode 5'))
    expect(screen.getByTestId('source-series-next')).toHaveAttribute('href', '/shorts?v=bob/p3')
    expect(h.fetchDerived).toHaveBeenCalledWith('bob', 'ep-5', { by: 'bob', media: 'short', order: 'start', limit: 60 })
  })

  it('nothing for a lone Short, a teaser, or no source', async () => {
    h.fetchDerived.mockResolvedValue({ items: [parts[0]], counts: {}, total: 1 })
    const { container } = renderWithProviders(<SourceSeriesBar author="bob" permlink="p1" source={{ kind: 'clip', author: 'bob', permlink: 'v' }} />)
    await waitFor(() => expect(h.fetchDerived).toHaveBeenCalled())
    expect(container.querySelector('[data-testid="source-series-bar"]')).toBeNull()
    h.fetchDerived.mockClear()
    renderWithProviders(<SourceSeriesBar author="bob" permlink="p1" source={{ kind: 'teaser', author: 'bob', permlink: 'v' }} />)
    expect(h.fetchDerived).not.toHaveBeenCalled()
  })

  it('sourceSeriesPosition', () => {
    expect(sourceSeriesPosition(parts, 'bob', 'p3')).toEqual({ part: 3, total: 3, next: null })
    expect(sourceSeriesPosition(parts, 'bob', 'x')).toBeNull()
    expect(sourceSeriesPosition([parts[0]], 'bob', 'p1')).toBeNull()
  })
})
