// @vitest-environment jsdom
// A quote card from a transcript line (components/QuoteCard/QuoteCardModal):
// uploads the card, posts the snap with the video as source, registers it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import { useAppStore } from '../../../src/lib/store'

const h = vi.hoisted(() => ({ publishSnap: vi.fn(), upload: vi.fn(), register: vi.fn() }))
vi.mock('../../../src/lib/snaps', () => ({ publishSnap: h.publishSnap }))
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: h.upload }))
vi.mock('../../../src/lib/derived', async (orig) => ({ ...(await orig()), registerDerivedLater: h.register }))

const { default: QuoteCardModal } = await import('../../../src/components/QuoteCard/QuoteCardModal.jsx')

beforeEach(() => {
  useAppStore.setState({ user: 'alice' })
  h.publishSnap.mockReset().mockResolvedValue({ author: 'alice', permlink: 'quote-x' })
  h.upload.mockReset().mockResolvedValue('https://images.hive.blog/q.png')
  h.register.mockReset()
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb) { cb(new Blob(['png'], { type: 'image/png' })) }
})

describe('QuoteCardModal', () => {
  it('posts the card as a snap that names the video and the moment', async () => {
    const onClose = vi.fn()
    const { user } = renderWithProviders(
      <QuoteCardModal open onClose={onClose} author="bob" permlink="talk" title="My talk" cue={{ start: 754, end: 760, text: 'Ship it, then fix it.' }} />,
    )
    expect(screen.getByText('The line at 12:34')).toBeInTheDocument()
    expect(screen.getByLabelText(/The line/)).toHaveValue('Ship it, then fix it.')
    await user.type(screen.getByLabelText(/Your words/), 'So true')
    await user.click(screen.getByRole('button', { name: /Post as snap/ }))
    await waitFor(() => expect(h.publishSnap).toHaveBeenCalled())
    const arg = h.publishSnap.mock.calls[0][0]
    expect(arg.user).toBe('alice')
    expect(arg.tags).toEqual(['quote'])
    expect(arg.body).toContain('> Ship it, then fix it.')
    expect(arg.body).toContain('So true')
    expect(arg.meta['3speak'].source).toEqual({ kind: 'quote', author: 'bob', permlink: 'talk', start: 754, end: 760 })
    expect(arg.meta.image).toEqual(['https://images.hive.blog/q.png'])
    expect(h.register).toHaveBeenCalledWith('alice', 'quote-x')
    expect(onClose).toHaveBeenCalled()
  })

  it('a failed upload posts nothing', async () => {
    h.upload.mockRejectedValueOnce(new Error('down'))
    const { user } = renderWithProviders(<QuoteCardModal open onClose={() => {}} author="bob" permlink="talk" title="T" cue={{ start: 1, end: 2, text: 'Hi' }} />)
    await user.click(screen.getByRole('button', { name: /Post as snap/ }))
    await waitFor(() => expect(h.upload).toHaveBeenCalled())
    expect(h.publishSnap).not.toHaveBeenCalled()
  })
})
