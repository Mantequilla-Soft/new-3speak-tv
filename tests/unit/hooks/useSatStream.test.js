// @vitest-environment jsdom
// Streaming sats while a track plays (src/hooks/useSatStream.js): only when on,
// one payment per 60 s of playing, the monthly cap, and a refusal turns it off.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

const pay = vi.fn()
vi.mock('../../../src/lib/boosts', async (importOriginal) => ({
  ...(await importOriginal()),
  canStreamSats: () => true,
  payStreamMinute: (...a) => pay(...a),
}))
const boosts = await import('../../../src/lib/boosts')
const { default: useSatStream } = await import('../../../src/hooks/useSatStream.js')

const props = { to: 'badadib', permlink: 'song', playing: true, link: 'https://3speak.tv/audio/badadib/song' }
const tick = async (s) => { for (let i = 0; i < s; i += 1) await act(async () => { vi.advanceTimersByTime(1000) }) }

beforeEach(() => {
  localStorage.clear()
  pay.mockReset()
  pay.mockImplementation(async ({ sats }) => sats)
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('useSatStream', () => {
  it('sends nothing until the listener turns it on', async () => {
    renderHook(() => useSatStream(props))
    await tick(130)
    expect(pay).not.toHaveBeenCalled()
  })

  it('pays the rate every 60 s of playing, not while paused, and stops at the cap', async () => {
    boosts.saveStreamSettings({ enabled: true, satsPerMinute: 10, monthlyCap: 15 })
    const { result, rerender } = renderHook((p) => useSatStream(p), { initialProps: props })
    await tick(60)
    expect(pay).toHaveBeenCalledWith({ to: 'badadib', sats: 10, link: props.link })
    expect(result.current.sessionSats).toBe(10)
    rerender({ ...props, playing: false })
    await tick(120)
    expect(pay).toHaveBeenCalledTimes(1)
    rerender(props)
    await tick(60)
    expect(pay).toHaveBeenLastCalledWith(expect.objectContaining({ sats: 5 }))
    await tick(60)
    expect(pay).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('capped')
    expect(boosts.streamedThisMonth()).toBe(15)
  })

  it('a wallet that does not pay turns streaming off', async () => {
    boosts.saveStreamSettings({ enabled: true, satsPerMinute: 10, monthlyCap: 1000 })
    pay.mockRejectedValueOnce(new Error('User rejected'))
    const { result } = renderHook(() => useSatStream(props))
    await tick(60)
    expect(result.current.status).toBe('stopped')
    expect(result.current.settings.enabled).toBe(false)
    expect(boosts.readStreamSettings().enabled).toBe(false)
    await tick(120)
    expect(pay).toHaveBeenCalledTimes(1)
  })
})
