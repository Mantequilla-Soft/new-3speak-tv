// @vitest-environment jsdom
// Editing an audio post (components/AudioEdit/EditAudioModal.jsx): title, show
// notes, tags and cover, broadcast as a `comment` on the same permlink, with
// the player line of the body and the payout terms left alone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const hive = vi.hoisted(() => ({ post: null }))
const comment = vi.hoisted(() => vi.fn(async () => ({ success: true })))
const put = vi.hoisted(() => vi.fn(async () => ({ data: {} })))
const post = vi.hoisted(() => vi.fn(async () => ({ data: {} })))

vi.mock('../../../src/utils/hiveNode', () => ({ getHiveClient: () => ({ call: async () => hive.post }) }))
vi.mock('../../../src/hive-api/aioha', () => ({ commentWithAioha: comment }))
vi.mock('../../../src/utils/uploadThumbnail', () => ({ uploadThumbnail: vi.fn(async () => 'https://images.example/up.png') }))
vi.mock('../../../src/utils/config', () => ({ CHECKER_URL: 'https://checker.example', CHECKER_API_KEY: 'k' }))
vi.mock('axios', () => ({ default: { put, post } }))

const { default: EditAudioModal } = await import('../../../src/components/AudioEdit/EditAudioModal.jsx')

const PLAY = 'https://audio.3speak.tv/play?a=yn0ivldj'
const COVER = 'https://images.3speak.tv/images/cover.webp'

// A snap: a reply under the snaps container, no Hive title.
const snap = {
  author: 'badadib', permlink: 'test-import-mwh1yrhk', title: '',
  parent_author: 'peak.snaps', parent_permlink: 'snap-container-1', category: 'hive-193552',
  body: `![test import](${COVER})\n\n${PLAY}\n\ntest test`,
  json_metadata: JSON.stringify({ app: 'new-3speak-tv', tags: ['audio', 'three-speak', 'mantequilla'], audio: { type: 'podcast' } }),
}
// A standalone post in a community.
const root = {
  ...snap, permlink: 'my-episode', title: 'My Episode', parent_author: '', parent_permlink: 'hive-181335', category: 'hive-181335',
  json_metadata: JSON.stringify({ tags: ['hive-181335', 'podcast'], image: [COVER] }),
}

function open(post, props = {}) {
  hive.post = post
  const onSaved = vi.fn()
  const onClose = vi.fn()
  const utils = renderWithProviders(
    <EditAudioModal isOpen author="badadib" permlink={post.permlink} onClose={onClose} onSaved={onSaved} {...props} />,
  )
  return { ...utils, onSaved, onClose }
}

const save = () => screen.getByRole('button', { name: /Save changes/ })

describe('EditAudioModal', () => {
  beforeEach(() => { comment.mockClear(); put.mockClear(); post.mockClear() })
  afterEach(() => { vi.useRealTimers() })

  it('a new title asks the checker to re-read the post from Hive, once the edit is in a block and again later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true })
    open(root)
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'My Episode (new)' } })
    fireEvent.click(save())
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    expect(post).not.toHaveBeenCalled()
    vi.advanceTimersByTime(6000)
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      'https://checker.example/audio/resync',
      { author: 'badadib', permlink: 'my-episode' },
      { headers: { Authorization: 'Bearer k' } },
    )
    vi.advanceTimersByTime(24000)
    expect(post).toHaveBeenCalledTimes(2)
  })

  it('an edit that keeps the title does not ask for a re-read', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true })
    open(root)
    await screen.findByLabelText('Title')
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Only notes' } })
    fireEvent.click(save())
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    vi.advanceTimersByTime(60000)
    expect(post).not.toHaveBeenCalled()
  })

  it("a snap starts from the audio row's title and writes it to the post when changed", async () => {
    const { onSaved, onClose } = open(snap, { rowTitle: 'test import' })
    const title = await screen.findByLabelText('Title')
    expect(title).toHaveValue('test import')
    expect(screen.getByLabelText('Description')).toHaveValue('test test')
    expect(save()).toBeDisabled()

    fireEvent.change(title, { target: { value: 'Renamed' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'New notes' } })
    fireEvent.click(save())

    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    const [pa, pp, permlink, t, body, meta, options] = comment.mock.calls[0]
    expect([pa, pp, permlink, t, options]).toEqual(['peak.snaps', 'snap-container-1', 'test-import-mwh1yrhk', 'Renamed', null])
    expect(body).toBe(`![Renamed](${COVER})\n\n${PLAY}\n\nNew notes`)
    expect(meta).toMatchObject({ app: 'new-3speak-tv', tags: ['audio', 'three-speak', 'mantequilla'], audio: { type: 'podcast' } })
    expect(put).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed', cover: null }))
    expect(onClose).toHaveBeenCalled()
  })

  it('a snap edited elsewhere keeps its empty Hive title', async () => {
    open(snap, { rowTitle: 'test import' })
    fireEvent.change(await screen.findByLabelText('Description'), { target: { value: 'Only notes' } })
    fireEvent.click(save())
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    expect(comment.mock.calls[0][3]).toBe('')
    expect(comment.mock.calls[0][4]).toBe(`![test import](${COVER})\n\n${PLAY}\n\nOnly notes`)
  })

  it('a post needs its title; the community tag stays locked', async () => {
    open(root)
    const title = await screen.findByLabelText('Title')
    expect(screen.getByLabelText('Tags')).toHaveValue('podcast')
    fireEvent.change(title, { target: { value: '  ' } })
    expect(save()).toBeDisabled()
    fireEvent.change(title, { target: { value: 'My Episode' } })
    fireEvent.change(screen.getByLabelText('Tags'), { target: { value: 'podcast #Music' } })
    fireEvent.click(save())
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    expect(comment.mock.calls[0][5].tags).toEqual(['hive-181335', 'podcast', 'music'])
  })

  it('a new cover goes into the body, the metadata and the audio row', async () => {
    const { onSaved } = open(root)
    fireEvent.change(await screen.findByLabelText('Cover'), { target: { value: 'https://images.example/new.png' } })
    fireEvent.click(save())
    await waitFor(() => expect(comment).toHaveBeenCalledTimes(1))
    expect(comment.mock.calls[0][4].startsWith(`![test import](https://images.example/new.png)\n\n${PLAY}`)).toBe(true)
    expect(comment.mock.calls[0][5].image).toEqual(['https://images.example/new.png', COVER])
    expect(put).toHaveBeenCalledWith(
      'https://checker.example/video/thumbnail',
      { owner: 'badadib', permlink: 'my-episode', thumbnail: 'https://images.example/new.png' },
      { headers: { Authorization: 'Bearer k' } },
    )
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ cover: 'https://images.example/new.png' }))
  })
})
