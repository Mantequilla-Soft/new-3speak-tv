// @vitest-environment jsdom
// "Pick up where you left off?" (components/StartPrompt): asks someone who used
// 3Speak before, once, after the changelog popup and never over another dialog,
// whether to turn on Continue where I left off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders, useFakeClock } from './_render.jsx'
import { useAppStore } from '../../../src/lib/store'
import StartPrompt from '../../../src/components/StartPrompt/StartPrompt.jsx'
import { shouldAsk, ANSWERED_KEY, FIRST_DELAY_MS, RETRY_MS } from '../../../src/components/StartPrompt/startPromptGate.js'

vi.mock('../../../src/lib/consent', () => ({ hasDecided: () => true }))

function openAfterDelay() {
  renderWithProviders(<StartPrompt />)
  act(() => { vi.advanceTimersByTime(FIRST_DELAY_MS + 10) })
}
const dialog = () => screen.queryByRole('dialog', { name: 'Pick up where you left off?' })

beforeEach(() => {
  localStorage.clear()
  useAppStore.setState({ resumeLastPage: false, appUpdatedFrom: null })
  useFakeClock()
})
afterEach(() => { vi.useRealTimers() })

describe('when it asks', () => {
  it('while the setting is off and nobody answered', () => {
    expect(shouldAsk({ resumeLastPage: false })).toBe(true)
    expect(shouldAsk({ resumeLastPage: true })).toBe(false)
    expect(shouldAsk({ resumeLastPage: false, answered: true })).toBe(false)
  })
})

describe('the popup', () => {
  it('comes after a short delay; Turn on switches the setting on and it does not come back', () => {
    openAfterDelay()
    expect(dialog()).toBeInTheDocument()
    expect(screen.getByText(/open on the page you were last on/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(useAppStore.getState().resumeLastPage).toBe(true)
    expect(localStorage.getItem(ANSWERED_KEY)).toBe('1')
    expect(dialog()).toBeNull()
  })

  it('Not now leaves it off and it does not come back', () => {
    openAfterDelay()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(dialog()).toBeNull()
    expect(useAppStore.getState().resumeLastPage).toBe(false)
    expect(localStorage.getItem(ANSWERED_KEY)).toBe('1')
  })

  it('waits for the changelog popup and for another open dialog', () => {
    useAppStore.setState({ appUpdatedFrom: '2.0.82' })
    openAfterDelay()
    expect(dialog()).toBeNull()

    const other = document.createElement('div')
    other.setAttribute('role', 'dialog')
    document.body.appendChild(other)
    act(() => { useAppStore.setState({ appUpdatedFrom: null }) })
    expect(dialog()).toBeNull()

    other.remove()
    act(() => { vi.advanceTimersByTime(RETRY_MS + 10) })
    expect(dialog()).toBeInTheDocument()
  })

  it('stays away once answered', () => {
    localStorage.setItem(ANSWERED_KEY, '1')
    openAfterDelay()
    expect(dialog()).toBeNull()
  })

  it('a switch in Settings counts as an answer', () => {
    useAppStore.getState().setResumeLastPage(false)
    expect(localStorage.getItem(ANSWERED_KEY)).toBe('1')
  })
})
