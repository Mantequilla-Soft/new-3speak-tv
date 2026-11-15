// @vitest-environment jsdom
// A post's boost wall (components/boosts/BoostWall.jsx) from a stand-in checker answer.
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const axios = (await import('axios')).default
const { default: BoostWall } = await import('../../../src/components/boosts/BoostWall.jsx')

describe('BoostWall', () => {
  it('lists boosts with message, amount and kind, and offers Boost', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: {
      success: true, total_hbd: 2, total_sats: 120, count: 2, boosts: 1,
      items: [
        { tipper: null, amount: 120, currency: 'SATS', stream: true, boost: false, message: null, tippedAt: new Date().toISOString() },
        { tipper: 'fan', amount: 2, currency: 'HBD', boost: true, stream: false, message: 'Loved it', tippedAt: new Date().toISOString() },
      ],
    } })
    const onBoost = vi.fn()
    const { user } = renderWithProviders(<BoostWall author="badadib" permlink="vid" onBoost={onBoost} />)
    expect(await screen.findByText('Loved it')).toBeInTheDocument()
    expect(axios.get).toHaveBeenCalledWith(expect.stringMatching(/\/boosts\/badadib\/vid$/), { params: { limit: 30 } })
    expect(screen.getByText('2.000 HBD')).toBeInTheDocument()
    expect(screen.getByText('120 sats')).toBeInTheDocument()
    expect(screen.getByText('Lightning supporter')).toBeInTheDocument()
    expect(screen.getByText(/streamed while listening/)).toBeInTheDocument()
    expect(screen.getByText('2 HBD + 120 sats in total')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Boost' }))
    expect(onBoost).toHaveBeenCalled()
  })

  it('an empty wall invites the first boost; no button on your own post', async () => {
    vi.spyOn(axios, 'get').mockResolvedValueOnce({ data: { success: true, count: 0, items: [] } })
    renderWithProviders(<BoostWall author="badadib" permlink="vid" />)
    expect(await screen.findByText(/No boosts yet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Boost' })).not.toBeInTheDocument()
  })
})
