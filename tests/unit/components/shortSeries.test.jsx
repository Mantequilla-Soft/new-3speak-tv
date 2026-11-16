// @vitest-environment jsdom
// Shorts series (lib/series.js): the "Part 3 of 7" line and Next part on a Short
// (ShortSeriesBar), the series select while publishing one, making a series from
// your Shorts (SeriesModal, one transaction) and the channel's Series row.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const h = vi.hoisted(() => ({ videoPlaylists: vi.fn(), myPlaylists: vi.fn(), shorts: vi.fn(), partDetails: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', async () => (await import('./_render.jsx')).aiohaModule({ KeyTypes: { Posting: 'posting', Active: 'active' } }))
vi.mock('sonner', async () => (await import('./_render.jsx')).sonnerModule())
vi.mock('../../../src/hooks/useVideoPlaylists', () => ({ useVideoPlaylists: (...a) => h.videoPlaylists(...a) }))
vi.mock('../../../src/hooks/useMyPlaylists', () => ({ useMyPlaylists: (...a) => h.myPlaylists(...a) }))
vi.mock('../../../src/hive-api/hiveApi', () => ({ fetchUserShortsWithDetails: (...a) => h.shorts(...a) }))
vi.mock('../../../src/utils/playlistVideos', () => ({ fetchVideosForPlaylist: (...a) => h.partDetails(...a) }))

const aioha = await import('../../../src/hive-api/aioha')
const { default: ShortSeriesBar } = await import('../../../src/components/Episodes/ShortSeriesBar.jsx')
const { default: ShortSeriesSelect } = await import('../../../src/components/Episodes/ShortSeriesSelect.jsx')
const { default: SeriesModal, seriesOps } = await import('../../../src/components/Episodes/SeriesModal.jsx')
const { default: ChannelSeries } = await import('../../../src/components/Episodes/ChannelSeries.jsx')

const meta = JSON.stringify({ type: 'video', series: true })
const garden = {
  id: 'pl-garden-1', owner: 'badadib', name: 'Garden diary', type: 'video', json_metadata: meta,
  items: [
    { author: 'badadib', permlink: 'part-two', position: 1 },
    { author: 'badadib', permlink: 'part-one', position: 0 },
    { author: 'badadib', permlink: 'part-three', position: 2 },
  ],
}

beforeEach(() => {
  h.videoPlaylists.mockReset()
  h.myPlaylists.mockReset()
  h.shorts.mockReset()
  h.partDetails.mockReset()
  aioha.broadcastWithAioha.mockClear()
})

describe('ShortSeriesBar', () => {
  it('shows the part, the series and a Next part link to the following Short', () => {
    h.videoPlaylists.mockReturnValue({ data: [{ ...garden, id: 'pl-other', json_metadata: '{}' }, garden] })
    renderWithProviders(<ShortSeriesBar author="badadib" permlink="part-two" />)
    const bar = screen.getByTestId('short-series-bar')
    expect(bar).toHaveTextContent('Part 2 of 3')
    expect(bar).toHaveTextContent('Garden diary')
    expect(screen.getByTestId('short-series-next')).toHaveAttribute('href', '/shorts?v=badadib/part-three')
  })

  it('the series line opens every part to jump to, the one playing marked, and the series page', async () => {
    h.videoPlaylists.mockReturnValue({ data: [garden] })
    h.partDetails.mockResolvedValue([
      { author: 'badadib', permlink: 'part-one', title: 'Digging the beds', images: { thumbnail: 'https://img.example/1.jpg' } },
      { author: 'badadib', permlink: 'part-two', title: 'Planting', images: { thumbnail: null } },
    ])
    renderWithProviders(<ShortSeriesBar author="badadib" permlink="part-two" />)
    fireEvent.click(within(screen.getByTestId('short-series-bar')).getByRole('button', { name: /Garden diary/ }))
    const list = await screen.findByRole('list', { name: 'All parts' })
    const parts = within(list).getAllByRole('link')
    expect(parts.map((a) => a.getAttribute('href'))).toEqual(['/shorts?v=badadib/part-one', '/shorts?v=badadib/part-two', '/shorts?v=badadib/part-three'])
    expect(await within(list).findByText('Digging the beds')).toBeInTheDocument()
    // A part Hive did not answer for still lists, by its number
    expect(within(list).getByText('Part 3')).toBeInTheDocument()
    expect(parts[1]).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('series-parts-start')).toHaveAttribute('href', '/shorts?v=badadib/part-one')
    expect(screen.getByRole('link', { name: /Open the series page/ })).toHaveAttribute('href', '/playlist/pl-garden-1')
    // Jumping to a part closes the list
    fireEvent.click(parts[2])
    await waitFor(() => expect(screen.queryByRole('list', { name: 'All parts' })).toBeNull())
  })

  it('no Play from part 1 on the first part', async () => {
    h.videoPlaylists.mockReturnValue({ data: [garden] })
    h.partDetails.mockResolvedValue([])
    renderWithProviders(<ShortSeriesBar author="badadib" permlink="part-one" />)
    fireEvent.click(within(screen.getByTestId('short-series-bar')).getByRole('button', { name: /Garden diary/ }))
    await screen.findByRole('list', { name: 'All parts' })
    expect(screen.queryByTestId('series-parts-start')).toBeNull()
  })

  it('no Next part on the last part; nothing outside a series or in someone else\'s', () => {
    h.videoPlaylists.mockReturnValue({ data: [garden] })
    const { unmount } = renderWithProviders(<ShortSeriesBar author="badadib" permlink="part-three" />)
    expect(screen.getByTestId('short-series-bar')).toHaveTextContent('Part 3 of 3')
    expect(screen.queryByTestId('short-series-next')).toBeNull()
    unmount()
    h.videoPlaylists.mockReturnValue({ data: [{ ...garden, owner: 'fan' }] })
    renderWithProviders(<ShortSeriesBar author="badadib" permlink="part-two" />)
    expect(screen.queryByTestId('short-series-bar')).toBeNull()
  })
})

describe('ShortSeriesSelect', () => {
  it('offers the creator\'s series and says which part the Short becomes', async () => {
    h.myPlaylists.mockReturnValue({ data: [garden, { id: 'pl-mix', name: 'Mix', json_metadata: '{}' }], isLoading: false })
    const onChange = vi.fn()
    const { user, rerender } = renderWithProviders(<ShortSeriesSelect value="" onChange={onChange} />)
    const select = screen.getByTestId('short-series-select')
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Not in a series', 'Garden diary'])
    await user.selectOptions(select, 'pl-garden-1')
    expect(onChange).toHaveBeenCalledWith('pl-garden-1')
    rerender(<ShortSeriesSelect value="pl-garden-1" onChange={onChange} />)
    expect(screen.getByText('This Short becomes part 4')).toBeInTheDocument()
  })

  it('without a series it says where to make one', () => {
    h.myPlaylists.mockReturnValue({ data: [], isLoading: false })
    renderWithProviders(<ShortSeriesSelect value="" onChange={() => {}} />)
    expect(screen.getByText(/Shorts tab of your channel/)).toBeInTheDocument()
  })
})

describe('making a series', () => {
  it('seriesOps: create as a video playlist marked series, then each part appended in order', () => {
    const ops = seriesOps({ owner: 'badadib', newId: 'pl-new', name: 'Cooking', parts: [{ author: 'badadib', permlink: 'b' }, { author: 'badadib', permlink: 'a' }] })
    expect(ops.map((o) => o[1].id)).toEqual(['3speak_playlist_create', '3speak_playlist_add', '3speak_playlist_add'])
    const create = JSON.parse(ops[0][1].json)
    expect(create).toMatchObject({ name: 'Cooking', access: 'public', playlist_id: 'pl-new', type: 'video' })
    expect(JSON.parse(create.json_metadata)).toEqual({ type: 'video', series: true })
    expect(ops.slice(1).map((o) => JSON.parse(o[1].json).permlink)).toEqual(['b', 'a'])
    expect(JSON.parse(ops[1][1].json).position).toBeGreaterThan(1000)
    expect(ops.every((o) => o[1].required_posting_auths[0] === 'badadib')).toBe(true)
    // Adding to an existing series: no create.
    expect(seriesOps({ owner: 'badadib', seriesId: 'pl-garden-1', parts: [{ author: 'badadib', permlink: 'x' }] }).map((o) => o[1].id)).toEqual(['3speak_playlist_add'])
  })

  it('picks Shorts in order (the numbers are the parts) and broadcasts once', async () => {
    h.shorts.mockResolvedValue({ page: 1, totalPages: 1, shorts: [
      { author: 'badadib', permlink: 's1', hivePermlink: 's1', heading: 'First' },
      { author: 'badadib', permlink: 's2', hivePermlink: 's2', heading: 'Second' },
    ] })
    const { user } = renderWithProviders(<SeriesModal open owner="badadib" onClose={() => {}} />)
    const picks = await screen.findAllByTestId('series-pick')
    expect(screen.getByTestId('series-save')).toBeDisabled()
    await user.type(screen.getByTestId('series-name'), 'Cooking')
    await user.click(picks[1])
    await user.click(picks[0])
    expect(within(picks[1]).getByText('1')).toBeInTheDocument()
    expect(within(picks[0]).getByText('2')).toBeInTheDocument()
    await user.click(screen.getByTestId('series-save'))
    await waitFor(() => expect(aioha.broadcastWithAioha).toHaveBeenCalledTimes(1))
    const [ops, keyType] = aioha.broadcastWithAioha.mock.calls[0]
    expect(keyType).toBe('posting')
    expect(ops.slice(1).map((o) => JSON.parse(o[1].json).permlink)).toEqual(['s2', 's1'])
  })

  it('a wallet login goes through broadcastWithAioha too (it falls back when @threespeak is not granted)', async () => {
    aioha.getCurrentProvider.mockReturnValue('keychain')
    aioha.broadcastViaThreespeak.mockClear()
    h.shorts.mockResolvedValue({ page: 1, totalPages: 1, shorts: [{ author: 'badadib', permlink: 's1', hivePermlink: 's1', heading: 'First' }] })
    const { user } = renderWithProviders(<SeriesModal open owner="badadib" onClose={() => {}} />)
    const picks = await screen.findAllByTestId('series-pick')
    await user.type(screen.getByTestId('series-name'), 'Cooking')
    await user.click(picks[0])
    await user.click(screen.getByTestId('series-save'))
    await waitFor(() => expect(aioha.broadcastWithAioha).toHaveBeenCalledTimes(1))
    expect(aioha.broadcastWithAioha.mock.calls[0][1]).toBe('posting')
    expect(aioha.broadcastViaThreespeak).not.toHaveBeenCalled()
    aioha.getCurrentProvider.mockReturnValue(null)
  })
})

describe('ChannelSeries', () => {
  it('lists the channel\'s series with their part count', () => {
    renderWithProviders(<ChannelSeries owner="badadib" playlists={[garden, { id: 'pl-x', owner: 'badadib', name: 'Plain', json_metadata: '{}' }]} isOwnProfile={false} />)
    const row = screen.getByTestId('channel-series')
    expect(within(row).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/playlist/pl-garden-1'])
    expect(row).toHaveTextContent('3 parts')
    expect(within(row).queryByRole('button', { name: 'New series' })).toBeNull()
  })

  it('a visitor sees nothing without a series; the owner gets New series', () => {
    const { unmount } = renderWithProviders(<ChannelSeries owner="badadib" playlists={[]} isOwnProfile={false} />)
    expect(screen.queryByTestId('channel-series')).toBeNull()
    unmount()
    renderWithProviders(<ChannelSeries owner="badadib" playlists={[]} isOwnProfile />)
    expect(screen.getByRole('button', { name: 'New series' })).toBeInTheDocument()
  })
})
