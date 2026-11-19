// Curation made visible (src/lib/curation.js): the weight factor by vote age and
// the curation a new vote can expect.
import { describe, it, expect } from 'vitest'
import { curationFactor, estimateCuration, formatSmallUsd, pickLink } from '../../../src/lib/curation.js'

const H = 3600 * 1000
const now = Date.parse('2026-11-15T12:00:00Z')
const post = (agoH, extra = {}) => ({
  created: new Date(now - agoH * H).toISOString().slice(0, 19),
  cashout_time: new Date(now + (168 - agoH) * H).toISOString().slice(0, 19),
  allow_curation_rewards: true,
  max_accepted_payout: '1000000.000 HBD',
  ...extra,
})

describe('curationFactor', () => {
  it('full weight the first day, half until 72 hours, an eighth after', () => {
    expect(curationFactor(2 * H)).toBe(1)
    expect(curationFactor(30 * H)).toBe(0.5)
    expect(curationFactor(100 * H)).toBe(0.125)
  })
})

describe('estimateCuration', () => {
  it('about half of what an early vote adds', () => {
    expect(estimateCuration({ value: '0.120', post: post(3), now })).toBeCloseTo(0.06, 6)
  })
  it('less for late votes', () => {
    expect(estimateCuration({ value: 0.12, post: post(48), now })).toBeCloseTo(0.03, 6)
    expect(estimateCuration({ value: 0.12, post: post(120), now })).toBeCloseTo(0.0075, 6)
  })
  it('nothing for a changed vote, a declined payout, no curation or a paid post', () => {
    expect(estimateCuration({ value: 1, post: post(3), now, changed: true })).toBe(0)
    expect(estimateCuration({ value: 1, post: post(3, { max_accepted_payout: '0.000 HBD' }), now })).toBe(0)
    expect(estimateCuration({ value: 1, post: post(3, { allow_curation_rewards: false }), now })).toBe(0)
    expect(estimateCuration({ value: 1, post: post(200), now })).toBe(0)
    expect(estimateCuration({ value: 0, post: post(3), now })).toBe(0)
  })
})

describe('formatSmallUsd', () => {
  it('three decimals under a dollar, never a misleading zero', () => {
    expect(formatSmallUsd(0.06)).toBe('0.06')
    expect(formatSmallUsd(0.0612)).toBe('0.061')
    expect(formatSmallUsd(0.001)).toBe('<0.01')
    expect(formatSmallUsd(2.5)).toBe('2.50')
  })
})

describe('pickLink', () => {
  it('audio, shorts by asset id, videos on their watch page', () => {
    expect(pickLink({ kind: 'audio', author: 'badadib', permlink: 'song' })).toBe('/audio/badadib/song')
    expect(pickLink({ kind: 'short', author: 'badadib', permlink: 'p', asset_permlink: 'asset' })).toBe('/shorts?v=badadib/asset')
    expect(pickLink({ kind: 'video', author: 'badadib', permlink: 'vid' })).toBe('/@badadib/vid')
  })
})
