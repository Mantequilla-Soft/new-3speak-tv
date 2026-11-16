// @vitest-environment jsdom
// "Pick up where you left off?" (components/StartPrompt): asks once, after the
// changelog popup and never over another dialog, whether to turn on Continue
// where I left off and, a day after the cookie banner was answered without it,
// whether to remember where you left off in each video. On preview (temporary)
// it always asks both.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, screen, fireEvent } from '@testing-library/react'
import { renderWithProviders, useFakeClock } from './_render.jsx'
import { useAppStore } from '../../../src/lib/store'
import StartPrompt from '../../../src/components/StartPrompt/StartPrompt.jsx'
import {
  startPromptItems, ANSWERED_KEY, FIRST_DELAY_MS, RETRY_MS, CONSENT_SETTLED_MS,
} from '../../../src/components/StartPrompt/startPromptGate.js'

const consent = vi.hoisted(() => ({ decidedAt: null, functional: false, set: vi.fn() }))
vi.mock('../../../src/lib/consent', () => ({
  hasDecided: () => consent.decidedAt != null,
  consentDecidedAt: () => consent.decidedAt,
  hasConsent: (c) => (c === 'functional' ? consent.functional : false),
  setConsent: (...a) => consent.set(...a),
}))
vi.mock('../../../src/lib/thirdPartyAds', () => ({ notifyAdConsentChanged: () => {} }))

const NOW = Date.parse('2026-11-16T12:00:00Z')
const DAY = 24 * 3600 * 1000

function openAfterDelay() {
  renderWithProviders(<StartPrompt />)
  act(() => { vi.advanceTimersByTime(FIRST_DELAY_MS + 10) })
}
const dialog = () => screen.queryByRole('dialog', { name: 'Pick up where you left off?' })

beforeEach(() => {
  localStorage.clear()
  consent.decidedAt = new Date(NOW - 2 * DAY).toISOString()
  consent.functional = false
  consent.set.mockClear()
  useAppStore.setState({ resumeLastPage: false, appUpdatedFrom: null })
  useFakeClock({ now: NOW })
})
afterEach(() => { vi.useRealTimers() })

describe('which questions', () => {
  const base = { resumeLastPage: false, consentDecidedAt: new Date(NOW - 2 * DAY).toISOString(), functionalConsent: false, now: NOW }
  it('asks for each setting that is off, the playback one only a day after the banner', () => {
    expect(startPromptItems(base)).toEqual(['lastPage', 'playback'])
    expect(startPromptItems({ ...base, resumeLastPage: true })).toEqual(['playback'])
    expect(startPromptItems({ ...base, functionalConsent: true })).toEqual(['lastPage'])
    expect(startPromptItems({ ...base, consentDecidedAt: new Date(NOW - CONSENT_SETTLED_MS + 1000).toISOString() })).toEqual(['lastPage'])
    expect(startPromptItems({ ...base, consentDecidedAt: null })).toEqual(['lastPage'])
  })

  it('nothing once answered or with nothing left to ask; everything on preview', () => {
    expect(startPromptItems({ ...base, answered: true })).toEqual([])
    expect(startPromptItems({ ...base, resumeLastPage: true, functionalConsent: true })).toEqual([])
    expect(startPromptItems({ ...base, resumeLastPage: true, functionalConsent: true, answered: true, always: true })).toEqual(['lastPage', 'playback'])
  })
})

describe('the popup', () => {
  it('comes after a short delay with both switches off, and Save turns on what was picked', () => {
    openAfterDelay()
    expect(dialog()).toBeInTheDocument()
    const resume = screen.getByRole('switch', { name: 'Continue where I left off' })
    const playback = screen.getByRole('switch', { name: 'Resume playback' })
    expect(resume).toHaveAttribute('aria-checked', 'false')
    expect(playback).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(resume)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(useAppStore.getState().resumeLastPage).toBe(true)
    expect(consent.set).not.toHaveBeenCalled()
    expect(localStorage.getItem(ANSWERED_KEY)).toBe('1')
    expect(dialog()).toBeNull()
  })

  it('the playback switch records consent for it', () => {
    openAfterDelay()
    fireEvent.click(screen.getByRole('switch', { name: 'Resume playback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(consent.set).toHaveBeenCalledWith({ functional: true, advertising: false })
    expect(useAppStore.getState().resumeLastPage).toBe(false)
  })

  it('Not now changes nothing and it does not come back', () => {
    openAfterDelay()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(dialog()).toBeNull()
    expect(useAppStore.getState().resumeLastPage).toBe(false)
    expect(consent.set).not.toHaveBeenCalled()
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

  it('asks only about what is still off', () => {
    useAppStore.setState({ resumeLastPage: true })
    openAfterDelay()
    expect(screen.queryByRole('switch', { name: 'Continue where I left off' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Resume playback' })).toBeInTheDocument()
  })

  it('stays away once answered', () => {
    localStorage.setItem(ANSWERED_KEY, '1')
    openAfterDelay()
    expect(dialog()).toBeNull()
  })
})
