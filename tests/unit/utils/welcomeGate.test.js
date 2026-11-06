// @vitest-environment jsdom
// One-prompt-at-a-time gate (src/utils/welcomeGate.js): prompts claim a keyed
// slot, every other prompt waits while it is held, and the hooks re-render
// their caller when the answer changes.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

let gate
beforeEach(async () => {
  const { vi } = await import('vitest')
  vi.resetModules()
  gate = await import('../../../src/utils/welcomeGate.js')
})

describe('claims', () => {
  it('a prompt does not wait for its own claim, only for others', () => {
    gate.setPromptActive('ads', true)
    expect(gate.isAnyPromptActive('ads')).toBe(false)
    expect(gate.isAnyPromptActive('welcome')).toBe(true)
    expect(gate.isAnyPromptActive()).toBe(true)
  })

  it('releasing frees the slot, and repeated claims or releases are harmless', () => {
    gate.setPromptActive('ads', true)
    gate.setPromptActive('ads', true)
    gate.setPromptActive('ads', false)
    gate.setPromptActive('ads', false)
    expect(gate.isAnyPromptActive()).toBe(false)
  })

  it('the welcome helpers are the "welcome" claim', () => {
    gate.setWelcomeActive(1)
    expect(gate.isWelcomeActive()).toBe(true)
    expect(gate.isAnyPromptActive('ads')).toBe(true)
    gate.setWelcomeActive(0)
    expect(gate.isWelcomeActive()).toBe(false)
  })
})

describe('hooks', () => {
  it('usePromptsActive re-renders when another prompt opens or closes, ignoring its own', () => {
    const { result } = renderHook(() => gate.usePromptsActive('ads'))
    expect(result.current).toBe(false)
    act(() => gate.setPromptActive('ads', true))
    expect(result.current).toBe(false)
    act(() => gate.setPromptActive('consent', true))
    expect(result.current).toBe(true)
    act(() => gate.setPromptActive('consent', false))
    expect(result.current).toBe(false)
  })

  it('starts with the current state and stops listening after unmount', () => {
    gate.setPromptActive('consent', true)
    const { result, unmount } = renderHook(() => gate.usePromptsActive('ads'))
    expect(result.current).toBe(true)
    unmount()
    expect(() => gate.setPromptActive('consent', false)).not.toThrow()
  })

  it('useWelcomeActive follows the welcome flow only', () => {
    const { result, unmount } = renderHook(() => gate.useWelcomeActive())
    expect(result.current).toBe(false)
    act(() => gate.setPromptActive('ads', true))
    expect(result.current).toBe(false)
    act(() => gate.setWelcomeActive(true))
    expect(result.current).toBe(true)
    unmount()
    act(() => gate.setWelcomeActive(false))
  })
})
