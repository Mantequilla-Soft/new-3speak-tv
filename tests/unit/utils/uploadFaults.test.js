// Upload fault injection (src/utils/uploadFaults.js): the switch that keeps it off,
// the stored flags, and the XHR patch that only ever touches upload requests.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

// The patch wraps whatever send() is on the prototype at install time, so the real
// one is swapped for a recorder first (a plain function: vi.spyOn would be restored
// after each test and take the patch with it).
const sent = []
let uf
beforeAll(async () => {
  XMLHttpRequest.prototype.send = function recordSend(body) { sent.push({ url: this.__fault?.url, body }) }
  uf = await import('../../../src/utils/uploadFaults.js')
  uf.installUploadFaults()
})

beforeEach(() => {
  sessionStorage.clear()
  sent.length = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers() })

const arm = (flags) => sessionStorage.setItem('3speak_upload_faults', JSON.stringify(flags))
const request = (method, url) => {
  const xhr = new XMLHttpRequest()
  xhr.open(method, url)
  xhr.send('body')
  return xhr
}

describe('switch and stored flags', () => {
  it('is off for everyone while the feature switch is off, badadib included', () => {
    expect(uf.canUseUploadFaults('badadib')).toBe(false)
    expect(uf.canUseUploadFaults('BADADIB')).toBe(false)
    expect(uf.canUseUploadFaults('someone')).toBe(false)
  })

  it('setUploadFaults cannot arm anything while switched off', () => {
    const out = uf.setUploadFaults('badadib', { blockPatch: true })
    expect(out.blockPatch).toBe(false)
    expect(sessionStorage.getItem('3speak_upload_faults')).toBeNull()
  })

  it('a forced weak link is never reported while switched off', () => {
    arm({ forceWeakLink: true })
    expect(uf.isWeakLinkForced()).toBe(false)
  })

  it('getUploadFaults fills defaults and survives garbage', () => {
    expect(uf.getUploadFaults()).toEqual({ blockPatch: false, blackholeChunks: false, blackholeSimple: false, chunkFailRate: 0, forceWeakLink: false })
    arm({ chunkFailRate: 0.5 })
    expect(uf.getUploadFaults().chunkFailRate).toBe(0.5)
    expect(uf.getUploadFaults().blockPatch).toBe(false)
    sessionStorage.setItem('3speak_upload_faults', '{nope')
    expect(uf.getUploadFaults().chunkFailRate).toBe(0)
    uf.clearUploadFaults()
    expect(sessionStorage.getItem('3speak_upload_faults')).toBeNull()
  })
})

describe('XHR patch', () => {
  it('with nothing armed every request goes through', () => {
    request('PATCH', 'https://up.example/uploads/abc')
    request('POST', 'https://up.example/upload/chunk')
    expect(sent).toHaveLength(2)
  })

  it('black-holes a TUS PATCH but leaves other traffic alone', () => {
    arm({ blockPatch: true })
    request('PATCH', 'https://up.example/uploads/abc')
    request('PATCH', 'https://api.example/profile')
    request('POST', 'https://up.example/uploads')
    expect(sent.map((s) => s.url)).toEqual(['https://api.example/profile', 'https://up.example/uploads'])
  })

  it('a black-holed request still fires abort so the stall watchdog can cut it loose', () => {
    arm({ blockPatch: true })
    const xhr = request('PATCH', 'https://up.example/uploads/abc')
    const onAbort = vi.fn()
    xhr.addEventListener('abort', onAbort)
    xhr.abort()
    expect(onAbort).toHaveBeenCalledTimes(1)
  })

  it('black-holing chunks spares the single-request fallback, and vice versa', () => {
    arm({ blackholeChunks: true })
    request('POST', 'https://up.example/upload/chunk/data')
    request('POST', 'https://up.example/upload/simple')
    expect(sent.map((s) => s.url)).toEqual(['https://up.example/upload/simple'])
    sent.length = 0
    arm({ blackholeSimple: true })
    request('POST', 'https://up.example/upload/chunk/data')
    request('POST', 'https://up.example/upload/simple')
    expect(sent.map((s) => s.url)).toEqual(['https://up.example/upload/chunk/data'])
  })

  it('a flaky link fails chunk POSTs with a network error a moment later', () => {
    vi.useFakeTimers()
    arm({ chunkFailRate: 1 })
    const xhr = new XMLHttpRequest()
    const onError = vi.fn()
    xhr.addEventListener('error', onError)
    xhr.open('POST', 'https://up.example/upload/chunk')
    xhr.send('x')
    expect(sent).toHaveLength(0)
    expect(onError).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('forceWeakLink alone intercepts nothing', () => {
    arm({ forceWeakLink: true })
    request('PATCH', 'https://up.example/uploads/abc')
    expect(sent).toHaveLength(1)
  })
})
