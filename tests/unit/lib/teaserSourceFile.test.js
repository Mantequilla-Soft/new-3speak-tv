// @vitest-environment jsdom
// "Make a Short from this video" (lib/teaserSourceFile.js): the uploaded file is
// kept for this tab, and the editor event carries the whole file plus the video
// it teases (the creator picks the moment in the editor).
import { describe, it, expect, beforeEach } from 'vitest'
import { rememberTeaserSource, teaserSourceFor, openTeaserEditor, teaserEligible, _resetTeaserSource, TEASER_MAX_BYTES } from '../../../src/lib/teaserSourceFile'

const file = () => new File(['v'], 'talk.mp4', { type: 'video/mp4' })
// A File that says it is `size` bytes, without allocating them
const sized = (size) => { const f = file(); Object.defineProperty(f, 'size', { value: size }); return f }

beforeEach(() => _resetTeaserSource())

describe('teaserSourceFile', () => {
  it('remembers only a real file with an author and a permlink', () => {
    expect(rememberTeaserSource({ file: 'blob:x', author: 'badadib', permlink: 'p' })).toBeNull()
    expect(rememberTeaserSource({ file: file(), author: '', permlink: 'p' })).toBeNull()
    expect(rememberTeaserSource({ file: file(), author: 'BadAdib', permlink: 'my-talk' })).toMatchObject({ author: 'badadib', permlink: 'my-talk' })
  })

  it('finds the source only for the video it is of', () => {
    rememberTeaserSource({ file: file(), author: 'badadib', permlink: 'my-talk' })
    expect(teaserSourceFor({ author: 'BADADIB', permlink: 'my-talk' })).not.toBeNull()
    expect(teaserSourceFor({ author: 'badadib', permlink: 'other' })).toBeNull()
    expect(teaserSourceFor(null)).toBeNull()
  })

  it('opens the Shorts editor with the whole file and the teased video, no range', () => {
    const f = file()
    const src = rememberTeaserSource({ file: f, author: 'badadib', permlink: 'my-talk' })
    const got = []
    const on = (e) => got.push(e.detail)
    window.addEventListener('open-shorts-editor', on)
    openTeaserEditor(src)
    openTeaserEditor(teaserSourceFor({ author: 'badadib', permlink: 'my-talk' }))
    window.removeEventListener('open-shorts-editor', on)
    const detail = { file: f, teaser: { author: 'badadib', permlink: 'my-talk' } }
    expect(got).toEqual([detail, detail])
    expect(openTeaserEditor(null)).toBe(false)
  })

  it('is offered for 5 to 30 minutes and at most 1 GB only (owner 2026-11-22)', () => {
    expect(teaserEligible({ file: file(), duration: 300 })).toBe(true)
    expect(teaserEligible({ file: file(), duration: 1800 })).toBe(true)
    expect(teaserEligible({ file: file(), duration: 299 })).toBe(false)
    expect(teaserEligible({ file: file(), duration: 1801 })).toBe(false)
    expect(teaserEligible({ file: sized(TEASER_MAX_BYTES), duration: 600 })).toBe(true)
    expect(teaserEligible({ file: sized(TEASER_MAX_BYTES + 1), duration: 600 })).toBe(false)
    // length unknown, or no file: no button
    expect(teaserEligible({ file: file(), duration: 0 })).toBe(false)
    expect(teaserEligible({ file: file(), duration: NaN })).toBe(false)
    expect(teaserEligible({ file: null, duration: 600 })).toBe(false)
    expect(teaserEligible()).toBe(false)
  })
})
