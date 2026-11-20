// @vitest-environment jsdom
// 🔒 What a free account gets instead of the landscape video editor
// (components/ProUpsell/LandscapeEditorUpsell.jsx): the stream studio's Pro
// upsell (SDK ProUpsellDialog), with the editor's perks in the site language,
// and See plans leading to the viewer's own wallet.
import { describe, it, expect, vi } from 'vitest'
import { act, screen } from '@testing-library/react'
import { renderWithProviders } from './_render.jsx'

const m = vi.hoisted(() => ({ props: null }))
vi.mock('@snapie/hangouts-react', () => ({
  HangoutsProvider: ({ children }) => children,
  ProUpsellDialog: (props) => { m.props = props; return props.open ? <div role="dialog">{props.heading}</div> : null },
}))
vi.mock('@snapie/hangouts-react/src/styles/hangouts.css', () => ({}))
vi.mock('../../../src/context/HangoutContext', () => ({ useHangout: () => ({ sessionToken: null, retryLogin: vi.fn() }) }))
vi.mock('../../../src/hive-api/aioha', () => ({ default: {} }))
vi.mock('../../../src/utils/hangoutsEndpoints', () => ({ defaultEndpoint: () => ({ api: 'https://api.test', lk: 'wss://lk.test' }) }))

const { useAppStore } = await import('../../../src/lib/store')
const { default: LandscapeEditorUpsell } = await import('../../../src/components/ProUpsell/LandscapeEditorUpsell.jsx')

describe('LandscapeEditorUpsell', () => {
  it('offers Pro with the landscape editor first, translated labels, and See plans to the wallet', async () => {
    useAppStore.setState({ user: 'badadib' })
    const onClose = vi.fn()
    renderWithProviders(<LandscapeEditorUpsell open onClose={onClose} />)
    expect(screen.getByRole('dialog')).toHaveTextContent('The landscape video editor is part of 3Speak Pro')
    expect(m.props.perks.map((p) => p.title)).toEqual(['Landscape video editor', 'Unlimited daily uploads', 'Audio longer than 15 minutes'])
    expect(m.props.continueLabel).toBe('Not now')
    expect(m.props.labels).toMatchObject({ seePlans: 'See plans', tryFree: 'Try Pro free for {hours}h' })
    act(() => m.props.onSeePlans())
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/wallet/badadib')
  })
})
