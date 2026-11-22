// @vitest-environment jsdom
// "Make a Short from this video" on a finished upload's screen
// (components/TeaserShortCard): opens the Shorts editor with the whole uploaded
// video, and on the Short's own screen offers it again for another moment.
import { describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'
import { _resetTeaserSource } from '../../../src/lib/teaserSourceFile'

const { default: TeaserShortCard } = await import('../../../src/components/TeaserShortCard/TeaserShortCard.jsx')

const file = new File(['v'], 'talk.mp4', { type: 'video/mp4' })
const VIDEO = { file, author: 'badadib', permlink: 'my-talk', duration: 600 }
let got
const on = (e) => got.push(e.detail)

beforeEach(() => { _resetTeaserSource(); got = [] })

describe('TeaserShortCard', () => {
  it('renders nothing without a file, or for an audio file', () => {
    const { container, rerender } = renderWithProviders(<TeaserShortCard video={{ ...VIDEO, file: null }} />)
    expect(container.querySelector('.teaser-short-card')).toBeNull()
    rerender(<TeaserShortCard video={{ ...VIDEO, file: new File(['a'], 'ep.mp3', { type: 'audio/mpeg' }) }} />)
    expect(container.querySelector('.teaser-short-card')).toBeNull()
  })

  it('only for videos of 5 to 30 minutes and at most 1 GB', () => {
    const big = new File(['v'], 'big.mp4', { type: 'video/mp4' })
    Object.defineProperty(big, 'size', { value: 1024 * 1024 * 1024 + 1 })
    for (const v of [{ ...VIDEO, duration: 120 }, { ...VIDEO, duration: 45 * 60 }, { ...VIDEO, duration: 0 }, { ...VIDEO, file: big }]) {
      const { container, unmount } = renderWithProviders(<TeaserShortCard video={v} />)
      expect(container.querySelector('.teaser-short-card')).toBeNull()
      unmount()
    }
    const { container } = renderWithProviders(<TeaserShortCard video={VIDEO} />)
    expect(container.querySelector('.teaser-short-card')).not.toBeNull()
  })

  it('opens the Shorts editor with the whole video just published', () => {
    window.addEventListener('open-shorts-editor', on)
    renderWithProviders(<TeaserShortCard video={VIDEO} />)
    fireEvent.click(screen.getByRole('button', { name: /Make a Short/ }))
    window.removeEventListener('open-shorts-editor', on)
    expect(got).toEqual([{ file, teaser: { author: 'badadib', permlink: 'my-talk' } }])
  })

  it('on the Short\'s screen: the same video again for another moment, only while this tab has it', () => {
    const { container, unmount } = renderWithProviders(<TeaserShortCard teaserOf={{ author: 'badadib', permlink: 'my-talk' }} />)
    expect(container.querySelector('.teaser-short-card')).toBeNull()
    unmount()
    renderWithProviders(<TeaserShortCard video={VIDEO} />)
    fireEvent.click(screen.getByRole('button', { name: /Make a Short/ }))
    window.addEventListener('open-shorts-editor', on)
    renderWithProviders(<TeaserShortCard teaserOf={{ author: 'badadib', permlink: 'my-talk' }} />)
    fireEvent.click(screen.getByRole('button', { name: /Make another$/ }))
    window.removeEventListener('open-shorts-editor', on)
    expect(got).toEqual([{ file, teaser: { author: 'badadib', permlink: 'my-talk' } }])
  })
})
