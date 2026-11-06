// @vitest-environment jsdom
// The audio player's share options (components/GlobalAudioPlayer/PlayerShare.jsx):
// copy an episode's link, the link at the current moment, or a 15 to 90 second
// clip from there (&t=&end=), with a toast either way.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders, stubClipboard, toastMessages } from './_render.jsx'

vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule())

const { toast } = await import('sonner')
const { ClipForm, CopyAtOption, EpisodeShareOptions } = await import('../../../src/components/GlobalAudioPlayer/PlayerShare.jsx')

const URL_ = 'https://3speak.tv/audio?play=badadib/ep-1'
let clipboard
let user
const mount = (ui) => { ({ user } = renderWithProviders(ui)); clipboard = stubClipboard() }
afterEach(() => clipboard?.restore())

describe('copying the link at the current moment', () => {
  it('is offered only once playback is past the first second', () => {
    mount(<CopyAtOption url={URL_} at={0.6} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('copies the link with the whole second and confirms it', async () => {
    const onDone = vi.fn()
    mount(<CopyAtOption url={URL_} at={75.9} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Copy link at 1:15' }))
    expect(clipboard.writeText).toHaveBeenCalledWith(`${URL_}&t=75`)
    expect(onDone).toHaveBeenCalled()
    await waitFor(() => expect(toastMessages(toast.success)).toEqual(['Link at 1:15 copied!']))
  })

  it('says so when the clipboard refuses', async () => {
    renderWithProviders(<CopyAtOption url={URL_} at={10} />)
    clipboard = stubClipboard({ fail: true })
    fireEvent.click(screen.getByRole('button', { name: 'Copy link at 0:10' }))
    await waitFor(() => expect(toastMessages(toast.error)).toEqual(["Couldn't copy the link"]))
  })
})

describe('making a clip', () => {
  it('opens on a 30 second clip from where playback is', async () => {
    mount(<ClipForm url={URL_} start={60} duration={600} />)
    await user.click(screen.getByRole('button', { name: 'Make a clip' }))
    expect(screen.getByText('From 1:00 to 1:30')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: /Length/ })).toHaveAttribute('aria-valuetext', '30 s')
  })

  it('changes the length and copies a link that starts and stops there', async () => {
    const onDone = vi.fn()
    mount(<ClipForm url={URL_} start={60} duration={600} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: 'Make a clip' }))
    fireEvent.change(screen.getByRole('slider', { name: /Length/ }), { target: { value: '90' } })
    expect(screen.getByText('From 1:00 to 2:30')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy clip link' }))
    expect(clipboard.writeText).toHaveBeenCalledWith(`${URL_}&t=60&end=150`)
    expect(onDone).toHaveBeenCalled()
    await waitFor(() => expect(toastMessages(toast.success)).toEqual(['Clip link copied!']))
  })

  it('never runs past the end of the episode', async () => {
    mount(<ClipForm url={URL_} start={590} duration={600} />)
    await user.click(screen.getByRole('button', { name: 'Make a clip' }))
    expect(screen.getByText('From 9:50 to 10:00')).toBeInTheDocument()
  })
})

describe('the share menu of an outside episode', () => {

  it('copies the episode page link and closes', async () => {
    const onClose = vi.fn()
    mount(<EpisodeShareOptions track={{ _id: 'ep 7' }} at={0} duration={1200} onClose={onClose} />)
    await user.click(screen.getByRole('button', { name: 'Copy episode link' }))
    expect(clipboard.writeText).toHaveBeenCalledWith(`${window.location.origin}/audio?type=external&episode=ep%207`)
    expect(onClose).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /Copy link at/ })).not.toBeInTheDocument()
    await waitFor(() => expect(toastMessages(toast.success)).toEqual(['Episode link copied!']))
  })

  it('offers the moment and a clip once playback has started', () => {
    mount(<EpisodeShareOptions track={{ _id: 'ep-7' }} at={125} duration={1200} onClose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Copy link at 2:05' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Make a clip' })).toBeInTheDocument()
  })
})
