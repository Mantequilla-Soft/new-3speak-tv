// Shorts from this video (components/ShortsFromVideo): the owner's clip
// suggestions with why each was picked, a preview and Make a Short; nobody else
// sees the card or asks the checker.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const fetchClipIdeas = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/clipIdeas', async (orig) => ({ ...(await orig()), fetchClipIdeas }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: ShortsFromVideo } = await import('../../../src/components/ShortsFromVideo/ShortsFromVideo.jsx')

const IDEAS = {
  duration: 600,
  short: false,
  signals: { replay: true, comments: 3, chat: 0, transcript: true },
  suggestions: [
    {
      start: 240, end: 270, score: 100,
      reasons: [{ kind: 'replay', lift: 1.2 }, { kind: 'comments', count: 3 }, { kind: 'quote', text: 'Why do 9 out of 10 people never finish?' }],
    },
    { start: 465, end: 495, score: 40, reasons: [{ kind: 'comments', count: 1 }] },
  ],
}

beforeEach(() => {
  fetchClipIdeas.mockReset()
  useAppStore.setState({ authenticated: true, user: 'badadib' })
})

describe('Shorts from this video', () => {
  it('shows nothing to anyone but the owner, and asks nobody', () => {
    useAppStore.setState({ authenticated: true, user: 'fan' })
    const { container } = renderWithProviders(<ShortsFromVideo owner="badadib" permlink="my-video" />)
    expect(container.querySelector('.shorts-from-video')).toBeNull()
    expect(fetchClipIdeas).not.toHaveBeenCalled()
  })

  it('lists the ranges with their reasons; preview and Make a Short hand back the range', async () => {
    fetchClipIdeas.mockResolvedValue(IDEAS)
    const onPreview = vi.fn()
    const onMakeShort = vi.fn()
    const { user } = renderWithProviders(
      <ShortsFromVideo owner="badadib" permlink="my-video" onPreview={onPreview} onMakeShort={onMakeShort} />,
    )
    expect(await screen.findByText('4:00 to 4:30')).toBeInTheDocument()
    expect(fetchClipIdeas).toHaveBeenCalledWith('badadib', 'my-video', { lang: 'en' })
    const [first, second] = screen.getAllByRole('listitem')
    expect(within(first).getByText('Most replayed')).toBeInTheDocument()
    expect(within(first).getByText('3 comments point here')).toBeInTheDocument()
    expect(within(first).getByText('Quotable line')).toBeInTheDocument()
    expect(within(first).getByText('Why do 9 out of 10 people never finish?')).toBeInTheDocument()
    expect(within(first).getByText('30 s')).toBeInTheDocument()
    expect(within(second).getByText('1 comment points here')).toBeInTheDocument()

    await user.click(within(first).getByRole('button', { name: 'Preview' }))
    expect(onPreview).toHaveBeenCalledWith(IDEAS.suggestions[0])
    await user.click(within(second).getByRole('button', { name: 'Make a Short' }))
    expect(onMakeShort).toHaveBeenCalledWith(IDEAS.suggestions[1])
  })

  it('the range playing now offers Stop', async () => {
    fetchClipIdeas.mockResolvedValue(IDEAS)
    renderWithProviders(<ShortsFromVideo owner="badadib" permlink="my-video" onPreview={() => {}} onMakeShort={() => {}} previewing={240} />)
    const [first] = await screen.findAllByRole('listitem')
    expect(within(first).getByRole('button', { name: 'Stop' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('without a player (Stats tab) both are links to the watch page', async () => {
    fetchClipIdeas.mockResolvedValue(IDEAS)
    renderWithProviders(<ShortsFromVideo owner="badadib" permlink="my-video" />)
    const [first] = await screen.findAllByRole('listitem')
    expect(within(first).getByRole('link', { name: 'Preview 4:00 to 4:30' })).toHaveAttribute('href', '/@badadib/my-video?t=240')
    expect(within(first).getByRole('link', { name: 'Make a Short 4:00 to 4:30' })).toHaveAttribute('href', '/@badadib/my-video?t=240&short=240-270')
  })

  it('links go to the Hive post when the id is 3Speak\'s own (the Stats tab)', async () => {
    fetchClipIdeas.mockResolvedValue(IDEAS)
    renderWithProviders(<ShortsFromVideo owner="badadib" permlink="ydtx92iw" watchPermlink="my-video" />)
    const [first] = await screen.findAllByRole('listitem')
    expect(fetchClipIdeas).toHaveBeenCalledWith('badadib', 'ydtx92iw', expect.anything())
    expect(within(first).getByRole('link', { name: 'Make a Short 4:00 to 4:30' })).toHaveAttribute('href', '/@badadib/my-video?t=240&short=240-270')
  })

  it('no Make a Short where the editor is off', async () => {
    fetchClipIdeas.mockResolvedValue(IDEAS)
    renderWithProviders(<ShortsFromVideo owner="badadib" permlink="my-video" canMake={false} />)
    await screen.findAllByRole('listitem')
    expect(screen.queryByText('Make a Short')).toBeNull()
  })

  it('says so when there is nothing to suggest yet', async () => {
    fetchClipIdeas.mockResolvedValue({ ...IDEAS, suggestions: [] })
    renderWithProviders(<ShortsFromVideo owner="badadib" permlink="my-video" />)
    expect(await screen.findByText(/No suggestions yet/)).toBeInTheDocument()
  })

  it('no card for a Short or a video that is not theirs', async () => {
    fetchClipIdeas.mockResolvedValue({ ...IDEAS, short: true, suggestions: [] })
    const { container, unmount } = renderWithProviders(<ShortsFromVideo owner="badadib" permlink="short1" />)
    await waitFor(() => expect(container.querySelector('.shorts-from-video')).toBeNull())
    unmount()
    fetchClipIdeas.mockResolvedValue(null)
    const second = renderWithProviders(<ShortsFromVideo owner="badadib" permlink="other" />)
    await waitFor(() => expect(fetchClipIdeas).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(second.container.querySelector('.shorts-from-video')).toBeNull())
  })
})
