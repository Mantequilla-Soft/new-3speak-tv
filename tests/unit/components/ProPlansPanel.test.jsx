// @vitest-environment jsdom
// The wallet's 3Speak Pro panel (components/Wallet/ProPlansPanel): the SDK's
// perk tabs, plus live captions under Live streaming (Pro on 3Speak).
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
  it('lists live captions under Live streaming and keeps every SDK perk', () => {
    useAppStore.setState({ user: 'badadib' })
    render(<ProPlansPanel />)
    const groups = m.props.benefitGroups
    expect(groups.map((g) => g.id)).toEqual(PRO_PERK_GROUPS.map((g) => g.id))
    const streaming = groups.find((g) => g.id === 'streaming')
    const sdk = PRO_PERK_GROUPS.find((g) => g.id === 'streaming')
    expect(streaming.perks.slice(0, -1)).toEqual(sdk.perks)
    expect(streaming.perks.at(-1)).toMatchObject({ title: 'Live captions' })
    expect(groups.find((g) => g.id === 'general')).toBe(PRO_PERK_GROUPS.find((g) => g.id === 'general'))
  })
})
