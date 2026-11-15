// @vitest-environment jsdom
// The viewer boost pieces get the site's text: the Send a Boost dialog through
// StreamBoostButton, and the phone view's own goal bar (StreamBoostGoalBar),
// which like <StreamVideo>'s shows only while the stream is live.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '../../../src/i18n'

const m = vi.hoisted(() => ({ live: true, dialogProps: null, goalProps: null }))
vi.mock('@snapie/hangouts-react', () => ({
  useStreamContext: () => ({ roomName: 'badadib-live', boostConfig: { enabled: true, minBoostUsd: 1 }, isGuest: false, hostIdentity: 'badadib' }),
  useStreamLive: () => m.live,
  SendBoostDialog: (props) => { m.dialogProps = props; return <div role="dialog">{props.labels.dialogTitle}</div> },
  StreamBoostGoal: (props) => { m.goalProps = props; return <div data-testid="goal" className={props.className} /> },
}))
vi.mock('../../../src/lib/store', () => ({
  useAppStore: (sel) => sel({ authenticated: true, user: 'fan' }),
}))
vi.mock('../../../src/hive-api/aioha', () => ({ withHiveAuthWaiting: (fn) => fn }))

const { default: StreamBoostButton } = await import('../../../src/components/openpods/StreamBoostButton.jsx')
const { default: StreamBoostGoalBar } = await import('../../../src/components/openpods/StreamBoostGoalBar.jsx')

describe('boost labels on the stream pages', () => {
  beforeEach(async () => { m.live = true; m.dialogProps = null; m.goalProps = null; await i18n.changeLanguage('en') })

  it('opens the Send a Boost dialog with the translated labels', async () => {
    render(<StreamBoostButton />)
    await userEvent.click(screen.getByRole('button', { name: /boost/i }))
    expect(screen.getByRole('dialog')).toHaveTextContent('Send a Boost')
    expect(m.dialogProps.labels.minimumHint).toBe('Minimum ${min} USD to appear on screen')
    expect(m.dialogProps.labels.goalProgress).toBe('{progress} / {target} HBD')
  })

  it('puts the goal bar where the page asks, in the site language', () => {
    render(<StreamBoostGoalBar className="ws-shorts__goal" />)
    expect(screen.getByTestId('goal')).toHaveClass('ws-shorts__goal')
    expect(m.goalProps.variant).toBe('overlay')
    expect(m.goalProps.labels.goalReached).toBe('Goal reached!')
  })

  it('shows no goal bar while the stream is not live', () => {
    m.live = false
    render(<StreamBoostGoalBar />)
    expect(screen.queryByTestId('goal')).not.toBeInTheDocument()
  })
})
