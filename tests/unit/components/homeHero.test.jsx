// The Spotlight hero on Home (components/HomeHero/HomeHero.jsx) slides through
// the featured videos on its own (owner 2026-11-12). The timer is the fill
// animation of the active segment: its animationend moves on, so these tests
// end that animation instead of waiting.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hive-api/hiveApi', () => ({ getPostDetails: async () => ({ community_title: 'Test Community' }) }))
vi.mock('../../../src/hive-api/api', () => ({ getFollowers: async () => ({ follower_count: 3 }) }))
vi.mock('../../../src/components/HiveAvatar/HiveAvatar', () => ({ default: () => null }))
vi.mock('../../../src/components/AddToPlaylistModal/AddToPlaylistModal', () => ({ default: () => null }))
vi.mock('../../../src/components/Chat/ShareChooserModal', () => ({ default: () => null }))

const { default: HomeHero } = await import('../../../src/components/HomeHero/HomeHero.jsx')

const vid = (n) => ({ author: 'badadib', permlink: `test-${n}`, title: `Video ${n}`, duration: 60 })
const VIDEOS = [vid(1), vid(2), vid(3)]
const title = () => screen.getByRole('heading', { level: 2 }).textContent
// jsdom has no AnimationEvent, so React listens for the WebKit name instead:
// send both, only one of them reaches the handler.
const endFill = (container) => {
  const el = container.querySelector('.home-hero__seg-fill')
  for (const type of ['animationend', 'webkitAnimationEnd']) fireEvent(el, new Event(type, { bubbles: true }))
}

describe('Spotlight hero slider', () => {
  it('starts on the first video with one segment per video', () => {
    renderWithProviders(<HomeHero videos={VIDEOS} />)
    expect(title()).toBe('Video 1')
    const segs = screen.getAllByRole('button', { name: /^Spotlight \d of 3$/ })
    expect(segs).toHaveLength(3)
    expect(segs[0]).toHaveAttribute('aria-current', 'true')
  })

  it('moves on when the active segment has filled, and wraps around after the last', () => {
    const { container } = renderWithProviders(<HomeHero videos={VIDEOS} />)
    endFill(container)
    expect(title()).toBe('Video 2')
    endFill(container)
    endFill(container)
    expect(title()).toBe('Video 1')
  })

  it('jumps to a video from its segment', async () => {
    const { user } = renderWithProviders(<HomeHero videos={VIDEOS} />)
    await user.click(screen.getByRole('button', { name: 'Spotlight 3 of 3' }))
    expect(title()).toBe('Video 3')
    expect(screen.getByRole('button', { name: 'Spotlight 3 of 3' })).toHaveAttribute('aria-current', 'true')
  })

  it('holds while paused or under the mouse, and goes on after Play', async () => {
    const { user, container } = renderWithProviders(<HomeHero videos={VIDEOS} />)
    const hero = container.querySelector('.home-hero')
    expect(hero).not.toHaveClass('is-paused')
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(hero).toHaveClass('is-paused')
    await user.click(screen.getByRole('button', { name: 'Play', pressed: true }))
    // The mouse is still on the hero after the click, which holds it too.
    expect(hero).toHaveClass('is-paused')
    await user.unhover(hero)
    expect(hero).not.toHaveClass('is-paused')
  })

  it('keeps showing the same video when the list is refetched in another order', async () => {
    function Refetch() {
      const [list, setList] = useState(VIDEOS)
      return <><button type="button" onClick={() => setList([vid(3), vid(2), vid(1)])}>refetch</button><HomeHero videos={list} /></>
    }
    const { user, container } = renderWithProviders(<Refetch />)
    endFill(container)
    expect(title()).toBe('Video 2')
    await user.click(screen.getByRole('button', { name: 'refetch' }))
    expect(title()).toBe('Video 2')
    expect(screen.getByRole('button', { name: 'Spotlight 2 of 3' })).toHaveAttribute('aria-current', 'true')
  })

  it('shows no slider controls for a single video', () => {
    renderWithProviders(<HomeHero videos={[vid(1)]} />)
    expect(title()).toBe('Video 1')
    expect(screen.queryByRole('button', { name: /^Spotlight/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull()
  })
})
