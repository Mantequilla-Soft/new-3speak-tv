// @vitest-environment jsdom
// The Channel Surfing remote under the video (components/SurfBar/SurfBar.jsx):
// the channel display opens the guide, Zap plays what is up next on the same
// channel, CH - / CH + change channel and Stop leaves surf mode on this video.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, within, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())
vi.mock('../../../src/lib/videoData', () => ({ fetchVideoDetails: vi.fn(async () => ({})) }))

const findNextOnChannel = vi.fn()
vi.mock('../../../src/utils/surf', async (importOriginal) => ({
  ...(await importOriginal()),
  findNextOnChannel: (...a) => findNextOnChannel(...a),
  markSeen: vi.fn(),
  saveLastChannel: vi.fn(),
}))

const { default: SurfBar } = await import('../../../src/components/SurfBar/SurfBar.jsx')

const NEXT = { author: 'badadib', permlink: 'next-clip', title: 'The next clip' }

function mount(channel = 'technology') {
  return renderWithProviders(
    <SurfBar channel={channel} author="badadib" permlink="this-clip" />,
    { route: `/@badadib/this-clip?surf=${channel}` },
  )
}

const location = () => screen.getByTestId('location').textContent

beforeEach(() => {
  findNextOnChannel.mockReset()
  findNextOnChannel.mockResolvedValue(NEXT)
})

describe('the Channel Surfing remote', () => {
  it('shows the channel, what Zap plays next, and the channel and stop tiles', async () => {
    mount()
    const remote = screen.getByRole('region', { name: 'Channel Surfing remote' })
    expect(within(remote).getByText('CH 02')).toBeInTheDocument()
    expect(within(remote).getByText(/Technology/)).toBeInTheDocument()
    expect(await within(remote).findByText('The next clip')).toBeInTheDocument()
    expect(within(remote).getByRole('button', { name: 'Previous channel' })).toBeInTheDocument()
    expect(within(remote).getByRole('button', { name: 'Next channel' })).toBeInTheDocument()
    expect(within(remote).getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('Zap plays the video that is up next, staying on the channel', async () => {
    const { user } = mount()
    await screen.findByText('The next clip')
    await user.click(screen.getByRole('button', { name: /Zap/ }))
    await waitFor(() => expect(location()).toBe('/@badadib/next-clip?surf=technology'))
  })

  it('CH + tunes to the next channel in the lineup', async () => {
    const { user } = mount()
    await screen.findByText('The next clip')
    await user.click(screen.getByRole('button', { name: 'Next channel' }))
    await waitFor(() => expect(findNextOnChannel).toHaveBeenCalledWith('education', 'badadib/this-clip'))
    await waitFor(() => expect(location()).toBe('/@badadib/next-clip?surf=education'))
  })

  it('Stop keeps this video and drops surf mode', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(location()).toBe('/@badadib/this-clip')
  })

  it('the channel display opens the guide with the current channel marked, and Esc closes it', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /CH 02/ }))
    const guide = screen.getByRole('dialog', { name: 'Channel guide' })
    const current = within(guide).getAllByRole('button').find((b) => b.getAttribute('aria-current'))
    expect(current).toHaveTextContent('Technology')
    expect(within(guide).getByRole('button', { name: /Surprise me/ })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Channel guide' })).not.toBeInTheDocument()
  })

  it('picking another channel in the guide tunes to it', async () => {
    const { user } = mount()
    await user.click(screen.getByRole('button', { name: /CH 02/ }))
    const guide = screen.getByRole('dialog', { name: 'Channel guide' })
    const science = within(guide).getAllByRole('button').find((b) => b.querySelector('.surf-guide__num')?.textContent === '04')
    expect(science).toHaveTextContent('Science')
    await user.click(science)
    await waitFor(() => expect(location()).toBe('/@badadib/next-clip?surf=science'))
    expect(screen.queryByRole('dialog', { name: 'Channel guide' })).not.toBeInTheDocument()
  })
})
