// @vitest-environment jsdom
// The wallet's 3Speak Pro panel (components/Wallet/ProPlansPanel): the SDK's
// perk tabs, plus what is Pro on 3Speak only: the feed ranking boost (General),
// 1080p YouTube imports and no daily upload limits (Uploads) and live captions
// (Live streaming).
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

const m = vi.hoisted(() => ({ props: null }))
vi.mock('@snapie/hangouts-react', () => ({
  HangoutsProvider: ({ children }) => children,
  ProPlans: (props) => { m.props = props; return null },
}))
vi.mock('@snapie/hangouts-react/src/styles/hangouts.css', () => ({}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../../../src/context/HangoutContext', () => ({ useHangout: () => ({ sessionToken: null, retryLogin: vi.fn() }) }))
vi.mock('../../../src/hive-api/aioha', () => ({ default: {}, broadcastWithAioha: vi.fn(), getOperationUser: () => null }))
vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://api.test', lk: 'wss://lk.test' }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: ProPlansPanel } = await import('../../../src/components/Wallet/ProPlansPanel.jsx')
const { PRO_PERK_GROUPS } = await import('@snapie/hangouts-react/dist/lib/proBenefits.js')

describe('Pro panel perks', () => {
  it('adds the 3Speak-only perks after the SDK ones, and keeps every SDK perk', () => {
    useAppStore.setState({ user: 'badadib' })
    render(<ProPlansPanel />)
    const groups = m.props.benefitGroups
    expect(groups.map((g) => g.id)).toEqual(PRO_PERK_GROUPS.map((g) => g.id))
    const added = { general: 'Ranked higher', uploads: 'YouTube imports in 1080p', streaming: 'Live captions' }
    for (const [id, title] of Object.entries(added)) {
      const ours = groups.find((g) => g.id === id)
      const sdk = PRO_PERK_GROUPS.find((g) => g.id === id)
      expect(ours.perks.slice(0, sdk.perks.length)).toEqual(sdk.perks)
      expect(ours.perks[sdk.perks.length]).toMatchObject({ title })
    }
  })
  it('no longer promises higher upload limits (Pro has none)', () => {
    render(<ProPlansPanel />)
    const titles = m.props.benefitGroups.flatMap((g) => g.perks.map((p) => p.title))
    expect(titles).not.toContain('Higher upload limits')
  })

  it('lists no daily upload limits, long audio and the landscape editor under Uploads, after every SDK perk', () => {
    useAppStore.setState({ user: 'badadib' })
    render(<ProPlansPanel />)
    const uploads = m.props.benefitGroups.find((g) => g.id === 'uploads')
    const sdk = PRO_PERK_GROUPS.find((g) => g.id === 'uploads')
    expect(uploads.perks.slice(0, sdk.perks.length)).toEqual(sdk.perks)
    const extra = uploads.perks.slice(sdk.perks.length + 1)   // after YouTube imports in 1080p
    expect(extra.map((p) => p.title)).toEqual(['Unlimited daily uploads', 'Audio longer than 20 minutes', 'Landscape video editor'])
    expect(extra[2].body).toMatch(/Shorts and audio editors stay free/)
    expect(extra[0].body).toMatch(/videos, Shorts and audio/)
    expect(extra[0].body).toMatch(/1 video, 3 Shorts and 2 audio uploads a day/)
    expect(extra[1].body).toMatch(/20 minutes/)
    // No em dashes in the copy
    for (const p of extra) expect(`${p.title} ${p.body}`).not.toMatch(/[\u2014\u2013]/)
  })
})
