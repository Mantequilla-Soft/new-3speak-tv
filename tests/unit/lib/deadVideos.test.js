// Videos the checker confirmed dead this page load (src/lib/deadVideos.js):
// the key, the set, and the hook that re-renders grids when one dies.
// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

let m
beforeAll(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  m = await import('../../../src/lib/deadVideos.js')
})

describe('dead videos', () => {
  it('keys are author/permlink with the author lowercased', () => {
    expect(m.videoKey('Alice', 'My-Video')).toBe('alice/My-Video')
    expect(m.videoKey('', 'p')).toBeNull()
    expect(m.videoKey('a', null)).toBeNull()
  })

  it('a confirmed video reads as dead regardless of author case', () => {
    expect(m.isVideoDead('bob', 'gone')).toBe(false)
    m.markVideoDead('BOB', 'gone')
    expect(m.isVideoDead('bob', 'gone')).toBe(true)
    expect(m.isVideoDead('bob', 'GONE')).toBe(false)
    expect(m.isVideoDead(null, 'gone')).toBe(false)
  })

  it('marking without an author or permlink does nothing', () => {
    m.markVideoDead('', 'x')
    m.markVideoDead('x', '')
    expect(m.isVideoDead('', 'x')).toBe(false)
  })

  it('useDeadVideos re-renders with a new set when a video dies, and not for a repeat', async () => {
    const seen = []
    const Probe = () => { const s = m.useDeadVideos(); seen.push(s); return null }
    const root = createRoot(document.createElement('div'))
    await act(async () => { root.render(createElement(Probe)) })
    const renders = seen.length
    await act(async () => { m.markVideoDead('carol', 'p1') })
    expect(seen.length).toBe(renders + 1)
    expect(seen.at(-1).has('carol/p1')).toBe(true)
    expect(seen.at(-1)).not.toBe(seen[renders - 1])
    await act(async () => { m.markVideoDead('Carol', 'p1') })
    expect(seen.length).toBe(renders + 1)
    await act(async () => { root.unmount() })
  })
})
