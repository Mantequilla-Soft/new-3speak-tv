// Creator stats page (components/CreatorStats): the Streams / Audio / Podcasts
// filters, impressions and CTR next to each video, earnings from every source in
// the Earned tile, and the CSV exports.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const api = vi.hoisted(() => ({
  fetchCreatorOverview: vi.fn(), fetchCreatorTimeseries: vi.fn(), fetchCreatorDemographics: vi.fn(),
  fetchVideoAnalytics: vi.fn(), fetchCreatorFollows: vi.fn(), fetchCreatorReach: vi.fn(), fetchCreatorEarnings: vi.fn(),
}))
vi.mock('../../../src/lib/creatorStats', async () => ({ ...(await vi.importActual('../../../src/lib/creatorStats')), ...api }))
const downloadCsv = vi.hoisted(() => vi.fn())
vi.mock('../../../src/lib/csvExport', async () => ({ ...(await vi.importActual('../../../src/lib/csvExport')), downloadCsv }))
vi.mock('../../../src/hive-api/api', () => ({ getFollowers: vi.fn(async () => ({ follower_count: 3 })) }))
vi.mock('../../../src/components/CreatorStats/VideoStats', () => ({ default: ({ permlink, kind }) => <div data-testid="video-stats">{`${permlink}:${kind || 'video'}`}</div> }))

const { default: CreatorStats } = await import('../../../src/components/CreatorStats/CreatorStats.jsx')

const vid = (permlink, over = {}) => ({
  permlink, hivePermlink: `hive-${permlink}`, title: `Video ${permlink}`, sessions: 10, watchSeconds: 600, avgPct: 50,
  votes: 2, comments: 1, payout: 0.5, created: '2026-11-01T00:00:00', ...over,
})

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset())
  downloadCsv.mockReset()
  api.fetchCreatorOverview.mockResolvedValue({ totals: { videos: 2, sessions: 20, watchSeconds: 1200, payout: 1 }, videos: [vid('a'), vid('b', { sessions: 5 })] })
  api.fetchCreatorTimeseries.mockResolvedValue({ series: [] })
  api.fetchCreatorDemographics.mockResolvedValue({})
  api.fetchCreatorFollows.mockResolvedValue({})
  api.fetchCreatorReach.mockResolvedValue({
    totals: { impressions: 400, clicks: 20, opens: 30, ctr: 5 }, bySurface: [], found: [],
    videos: [{ permlink: 'a', impressions: 300, clicks: 15, opens: 20, ctr: 5 }],
  })
  api.fetchCreatorEarnings.mockResolvedValue({
    series: [{ date: '2026-11-15', votes: 4, curation: 1, tips: 0, ads: 0, boosts: 0, lightningSats: 0 }],
    totals: { votes: 4, curation: 1, tips: 0, ads: 0, boosts: 0, lightningSats: 0 },
    byPost: { 'hive-a': 4 },
  })
})

describe('creator stats', () => {
  it('Earned is every source in the range; each video has its impressions and CTR', async () => {
    renderWithProviders(<CreatorStats user="badadib" />)
    expect(await screen.findByText('$5.00', { selector: '.cs-tile-v' })).toBeInTheDocument()
    expect(screen.getByText(/300 impressions · CTR 5%/)).toBeInTheDocument()
    expect(api.fetchCreatorEarnings).toHaveBeenCalledWith('badadib', { days: 28 })
    expect(api.fetchCreatorReach).toHaveBeenCalledWith('badadib', { days: 28, content: 'all' })
  })

  it('filtered to some content, or over all time, the tile is that payout and says so', async () => {
    const { user } = renderWithProviders(<CreatorStats user="badadib" />)
    await screen.findByText('$5.00', { selector: '.cs-tile-v' })
    expect(screen.getByText('Earned', { selector: '.cs-tile-l' })).toBeInTheDocument()
    // Shorts only: the earnings by source are channel-wide, so the posts' payout.
    await user.click(screen.getByRole('tab', { name: 'Shorts' }))
    expect(await screen.findByText('$1.00', { selector: '.cs-tile-v' })).toBeInTheDocument()
    expect(screen.getByText('Payout', { selector: '.cs-tile-l' })).toBeInTheDocument()
    // All time, every kind: the earnings reach back 12 months only.
    await user.click(screen.getAllByRole('tab', { name: 'All' })[1])
    await user.click(screen.getAllByRole('tab', { name: 'All' })[0])
    await waitFor(() => expect(api.fetchCreatorEarnings).toHaveBeenLastCalledWith('badadib', { days: 365 }))
    expect(await screen.findByText('$1.00', { selector: '.cs-tile-v' })).toBeInTheDocument()
    expect(screen.getByText('Payout', { selector: '.cs-tile-l' })).toBeInTheDocument()
  })

  it('audio reads listening, opens the audio detail and asks for no reach', async () => {
    api.fetchCreatorOverview.mockResolvedValue({ totals: { videos: 1, sessions: 3, watchSeconds: 90 }, videos: [vid('pod1', { audio: true })] })
    const { user } = renderWithProviders(<CreatorStats user="badadib" />)
    await screen.findByTestId('video-stats')
    api.fetchCreatorReach.mockClear()
    await user.click(screen.getByRole('tab', { name: 'Podcasts' }))
    await waitFor(() => expect(api.fetchCreatorOverview).toHaveBeenLastCalledWith('badadib', { days: 28, content: 'podcasts' }))
    expect(await screen.findByText('pod1:audio')).toBeInTheDocument()
    expect(api.fetchCreatorReach).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: /Video pod1/ })).toHaveAttribute('href', '/audio/badadib/hive-pod1')
    expect(screen.getByRole('tab', { name: 'Streams' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Audio' })).toBeInTheDocument()
  })

  it('exports the daily earnings and the content table as CSV', async () => {
    const { user } = renderWithProviders(<CreatorStats user="badadib" />)
    await screen.findByText('$5.00', { selector: '.cs-tile-v' })
    await user.click(screen.getByRole('button', { name: 'Export daily earnings (CSV)' }))
    const [name, csv] = downloadCsv.mock.calls[0]
    expect(name).toBe('3speak-earnings-badadib-28d.csv')
    expect(csv.split('\r\n')[0]).toBe('Date,Votes (HBD),Curation (HBD),Tips (HBD),Ads (HBD),Stream boosts (HBD),Total (HBD),Lightning (sats)')
    expect(csv.split('\r\n')[1]).toBe('2026-11-15,4,1,0,0,0,5,0')

    await user.click(screen.getByRole('button', { name: 'Export content table (CSV)' }))
    const rows = downloadCsv.mock.calls[1][1].split('\r\n')
    expect(rows[0]).toMatch(/^Title,Link,Published,Views,Watch time \(seconds\),/)
    expect(rows[0]).toMatch(/Earned from votes \(HBD\),Impressions,Click-through rate \(%\)$/)
    expect(rows[1]).toMatch(/^Video a,http.*\/@badadib\/a,2026-11-01,10,600,50,2,1,0.5,4,300,5$/)
  })
})
