// @vitest-environment jsdom
// The weekly Shorts challenge switch on a Short's details step
// (components/embed-studio/EmbedDetails.jsx): it adds or removes the week's tag,
// comes on by itself after /challenge's "Join with a Short", and is not offered
// for a 24h Story or a normal video.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders, stubMatchMedia } from './_render.jsx'

const m = vi.hoisted(() => ({ ctx: {}, set: [] }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/hooks/usePremiumStatus', () => ({ usePremiumStatus: () => ({ premium: false }) }))
vi.mock('../../../src/lib/advertiseData', () => ({ fetchCreatorAdPrefs: async () => null }))
vi.mock('../../../src/lib/shortsChallenge', async (importOriginal) => ({
  ...(await importOriginal()),
  useCurrentChallenge: () => ({ week: '2026-W48', tag: 'challenge2026w48', theme: 'workspace', texts: { en: { title: 'Your workspace', prompt: 'Show where you create.' } } }),
}))
vi.mock('../../../src/context/EmbedUploadContext', () => {
  const noop = () => {}
  return {
    useEmbedUpload: () => new Proxy(m.ctx, {
      get: (t, k) => {
        if (k in t) return t[k]
        if (typeof k === 'string' && /^(set|Set)/.test(k)) return (...a) => { m.set.push([k, ...a]) }
        if (k === 'list' || k === 'tagsPreview' || k === 'pollOptions' || k === 'communitiesData' || k === 'BeneficiaryList' || k === 'gatedAllowlist') return []
        if (k === 'startEarlyUpload' || k === 'navigate') return noop
        return undefined
      },
    }),
  }
})
const { useAppStore } = await import('../../../src/lib/store')
const { default: EmbedDetails } = await import('../../../src/components/embed-studio/EmbedDetails.jsx')

const tagCalls = () => m.set.filter((c) => c[0] === 'setTagsPreview').map((c) => c[1])
const mount = () => renderWithProviders(<EmbedDetails />, { route: '/embed-studio/details' })

beforeEach(() => {
  stubMatchMedia(false)
  sessionStorage.clear()
  m.set = []
  m.ctx = { fromStories: true, isStory: false, tagsPreview: [], user: 'badadib', title: '', description: 'hi', tagsInputValue: '', selectedThumbnail: 'x', step: 3, remaingPercent: 100 }
  useAppStore.setState({ user: 'badadib', incubationHandle: null })
})

describe('EmbedDetails: weekly Shorts challenge', () => {
  it('a Short gets the switch, off; turning it on adds the week\'s tag', async () => {
    const { user } = mount()
    const sw = await screen.findByRole('switch', { name: "Join this week's challenge" })
    expect(sw).not.toBeChecked()
    expect(screen.getByText(/"Your workspace": adds #challenge2026w48/)).toBeInTheDocument()
    await user.click(sw)
    expect(tagCalls().at(-1)).toEqual(['challenge2026w48'])
  })

  it('on when the tag is there; turning it off removes only that tag', async () => {
    m.ctx.tagsPreview = ['cats', 'challenge2026w48']
    const { user } = mount()
    const sw = await screen.findByRole('switch', { name: "Join this week's challenge" })
    expect(sw).toBeChecked()
    await user.click(sw)
    expect(tagCalls().at(-1)).toEqual(['cats'])
  })

  it('comes on by itself after "Join with a Short" for this week', async () => {
    sessionStorage.setItem('3speak-challenge-join', '2026-W48')
    mount()
    await waitFor(() => expect(tagCalls()).toEqual([['challenge2026w48']]))
    expect(sessionStorage.getItem('3speak-challenge-join')).toBeNull()
  })

  it('is not offered for a 24h Story or a normal video', async () => {
    m.ctx.isStory = true
    const { unmount } = mount()
    await screen.findByText('Description')
    expect(screen.queryByRole('switch', { name: "Join this week's challenge" })).toBeNull()
    unmount()
    m.ctx = { ...m.ctx, isStory: false, fromStories: false, title: 'A video', tagsPreview: ['a'] }
    mount()
    await screen.findByText('Description')
    expect(screen.queryByRole('switch', { name: "Join this week's challenge" })).toBeNull()
  })
})
