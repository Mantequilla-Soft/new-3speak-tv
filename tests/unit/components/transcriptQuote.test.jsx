// @vitest-environment jsdom
// Quote mode in the transcript (components/playVideo/Transcript): the quote
// button turns "jump to this line" into "make a quote card of this line".
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hooks/useSubtitles', () => ({
  listSubtitleLanguages: async () => [{ lang: 'en', url: 'x' }],
  pickSubtitleLang: () => 'en',
  loadSubtitleCues: async () => [{ start: 10, end: 14, text: 'First line.' }, { start: 20, end: 25, text: 'Ship it, then fix it.' }],
  publishSubtitleEdit: vi.fn(),
}))

const { default: Transcript } = await import('../../../src/components/playVideo/Transcript.jsx')

describe('Transcript quote mode', () => {
  let onSeek
  let onQuote
  beforeEach(() => { onSeek = vi.fn(); onQuote = vi.fn() })

  it('a line jumps there; in quote mode it is quoted instead, once', async () => {
    const { user } = renderWithProviders(<Transcript author="bob" permlink="talk" embedded onSeek={onSeek} onQuote={onQuote} />)
    const line = await screen.findByText('Ship it, then fix it.')
    await user.click(line)
    expect(onSeek).toHaveBeenCalledWith(20)
    await user.click(screen.getByRole('button', { name: 'Quote card' }))
    expect(screen.getByText('Tap a line to make a quote card of it.')).toBeInTheDocument()
    await user.click(screen.getByText('Ship it, then fix it.'))
    expect(onQuote).toHaveBeenCalledWith({ start: 20, end: 25, text: 'Ship it, then fix it.' })
    expect(onSeek).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('Tap a line to make a quote card of it.')).not.toBeInTheDocument()
  })

  it('no quote button without onQuote', async () => {
    renderWithProviders(<Transcript author="bob" permlink="talk" embedded onSeek={onSeek} />)
    await screen.findByText('First line.')
    expect(screen.queryByRole('button', { name: 'Quote card' })).not.toBeInTheDocument()
  })
})
