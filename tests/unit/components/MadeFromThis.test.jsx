// @vitest-environment jsdom
// The "Made from this" row (components/MadeFromThis): nothing until something
// was made from the post, then one card per derived post with its kind.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const fetchDerived = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/derived', async (importOriginal) => ({ ...(await importOriginal()), fetchDerived }))

const { default: MadeFromThis } = await import('../../../src/components/MadeFromThis/MadeFromThis.jsx')

describe('MadeFromThis', () => {
  beforeEach(() => fetchDerived.mockReset())

  it('renders nothing when nothing was made from the post', async () => {
    fetchDerived.mockResolvedValueOnce({ items: [], counts: {}, total: 0 })
    const { container } = renderWithProviders(<MadeFromThis author="bob" permlink="ep" />)
    await waitFor(() => expect(fetchDerived).toHaveBeenCalledWith('bob', 'ep', expect.anything()))
    expect(container.querySelector('.made-from-this')).toBeNull()
  })

  it('one card per post, with its kind, length, piece and link', async () => {
    fetchDerived.mockResolvedValueOnce({
      total: 2,
      counts: { audiogram: 1, reaction: 1 },
      items: [
        { author: 'bob', permlink: 'teaser-1', kind: 'audiogram', media: 'short', title: 'The best bit', thumbnail: 'https://img/1.jpg', duration: 42, start: 75 },
        { author: 'carol', permlink: 're-ep', kind: 'reaction', media: 'video', title: '', thumbnail: null, duration: 3700 },
      ],
    })
    renderWithProviders(<MadeFromThis author="bob" permlink="ep" />)
    expect(await screen.findByRole('heading', { name: 'Made from this' })).toBeInTheDocument()
    expect(screen.getByText('2 posts made from this one')).toBeInTheDocument()

    const first = screen.getByRole('link', { name: 'Audiogram: The best bit, by @bob' })
    expect(first).toHaveAttribute('href', '/shorts?v=bob/teaser-1')
    expect(first).toHaveTextContent('0:42')
    expect(first).toHaveTextContent('from 1:15')
    expect(first.querySelector('img')).toHaveAttribute('src', 'https://img/1.jpg')

    const second = screen.getByRole('link', { name: 'Reaction: Untitled, by @carol' })
    expect(second).toHaveTextContent('1:01:40')
    expect(second.querySelector('img')).toBeNull()
  })
})
