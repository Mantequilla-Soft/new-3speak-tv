// @vitest-environment jsdom
// The points movements in the wallet (components/Wallet/PointsHistory.jsx): a
// spend on promoting a video (ref 'promote:<author>/<permlink>') says so and
// links that video; its refund says the points came back for it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const { default: PointsHistory } = await import('../../../src/components/Wallet/PointsHistory.jsx')

const items = [
  { id: '1', kind: 'spend', delta: -15000, at: '2026-11-26T10:00:00Z', ref: 'promote:badadib/my-video', tx: 'abc' },
  { id: '2', kind: 'refund', delta: 5000, at: '2026-11-26T09:00:00Z', ref: 'promote:badadib/other-one' },
  { id: '3', kind: 'spend', delta: -100, at: '2026-11-26T08:00:00Z', ref: 'some-room' },
]

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ items, next: null }) })))
})

describe('points history', () => {
  it('reads a promotion spend as promoting that video, with a link to it', async () => {
    renderWithProviders(<PointsHistory user="badadib" ttlDays={30} />)
    expect(await screen.findByText('Promoted a video by @badadib')).toBeInTheDocument()
    expect(screen.getByText('−15,000')).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'Open video' })
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/watch?v=badadib/my-video', '/watch?v=badadib/other-one'])
  })

  it('reads its refund as points back for that promotion, and leaves other spends alone', async () => {
    renderWithProviders(<PointsHistory user="badadib" ttlDays={30} />)
    expect(await screen.findByText('Points back for promoting a video by @badadib')).toBeInTheDocument()
    expect(screen.getByText('Points boost')).toBeInTheDocument()
    expect(screen.getByText('+5,000')).toBeInTheDocument()
  })
})
