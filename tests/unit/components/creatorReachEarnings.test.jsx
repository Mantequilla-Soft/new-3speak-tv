// Creator stats, Reach and Earnings cards (components/CreatorStats/ReachEarnings):
// impressions, CTR and where viewers found the videos; earnings stacked per day
// by source with their totals, and the two CSV exports.
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const { ReachCard, EarningsCard } = await import('../../../src/components/CreatorStats/ReachEarnings.jsx')

const wrap = (ui) => renderWithProviders(<div className="creator-stats">{ui}</div>)

describe('Reach card', () => {
  const reach = {
    since: '2026-11-15',
    totals: { impressions: 1200, clicks: 60, opens: 90, ctr: 5 },
    bySurface: [{ surface: 'discover', impressions: 900, clicks: 50, ctr: 5.6 }, { surface: 'search', impressions: 300, clicks: 10, ctr: 3.3 }],
    found: [{ source: 'discover', opens: 50 }, { source: 'social', opens: 30 }, { source: 'embed', opens: 10 }],
  }

  it('shows the totals, where viewers found it and where cards were shown', () => {
    wrap(<ReachCard reach={reach} />)
    expect(screen.getByText('1.2K')).toBeInTheDocument()
    expect(screen.getByText('5%')).toBeInTheDocument()
    expect(screen.getByText('Where viewers found it')).toBeInTheDocument()
    expect(screen.getByText('Social media')).toBeInTheDocument()
    expect(screen.getByText('Embeds on other sites')).toBeInTheDocument()
    expect(screen.getByText('CTR 5.6%')).toBeInTheDocument()
    expect(screen.getByText(/Counting started on/)).toBeInTheDocument()
  })

  it('says so when nothing was counted yet', () => {
    wrap(<ReachCard reach={{ totals: { impressions: 0, opens: 0, clicks: 0, ctr: null }, found: [], bySurface: [] }} />)
    expect(screen.getByText(/No impressions yet/)).toBeInTheDocument()
    expect(screen.getByText('-')).toBeInTheDocument()
  })
})

describe('Earnings card', () => {
  const day = (date, over) => ({ date, votes: 0, curation: 0, tips: 0, ads: 0, boosts: 0, lightningSats: 0, ...over })
  const earnings = {
    series: [day('2026-11-14', { votes: 2, tips: 0.5 }), day('2026-11-15', { ads: 0.25, boosts: 1, lightningSats: 300 })],
    totals: { votes: 2, curation: 0, tips: 0.5, ads: 0.25, boosts: 1, lightningSats: 300 },
  }

  it('the total, a stacked bar per day and each source with its sum', () => {
    const { container } = wrap(<EarningsCard earnings={earnings} onExportDaily={() => {}} onExportContent={() => {}} />)
    expect(screen.getByText('$3.75')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /over 2 days/ })).toBeInTheDocument()
    expect(container.querySelectorAll('rect.re-seg')).toHaveLength(4)
    expect(container.querySelectorAll('rect.is-votes')).toHaveLength(1)
    expect(screen.getByText('Stream boosts')).toBeInTheDocument()
    expect(screen.getByText('300 sats')).toBeInTheDocument()
  })

  it('the export buttons call back; daily waits for the data', async () => {
    const daily = vi.fn()
    const content = vi.fn()
    const { user, rerender } = wrap(<EarningsCard earnings={null} onExportDaily={daily} onExportContent={content} />)
    expect(screen.getByRole('button', { name: 'Export daily earnings (CSV)' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Export content table (CSV)' }))
    expect(content).toHaveBeenCalled()
    rerender(<div className="creator-stats"><EarningsCard earnings={earnings} onExportDaily={daily} onExportContent={content} /></div>)
    await user.click(screen.getByRole('button', { name: 'Export daily earnings (CSV)' }))
    expect(daily).toHaveBeenCalled()
  })

  it('no earnings in the range, and the checker down, each say so', () => {
    const { unmount } = wrap(<EarningsCard earnings={{ series: [day('2026-11-15', {})], totals: day(null, {}) }} />)
    expect(screen.getByText('No earnings in this range yet.')).toBeInTheDocument()
    unmount()
    wrap(<EarningsCard earnings={null} error />)
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument()
  })
})
