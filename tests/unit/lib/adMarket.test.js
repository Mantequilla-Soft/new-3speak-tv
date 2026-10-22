// Ad market pricing and format helpers: the days^K flight curve, HBD to HIVE
// conversion, day-rate savings, ticker readability and banner shapes
// (src/lib/adMarket.js).
import { describe, it, expect } from 'vitest'
import {
  flightPrice,
  hivePayable,
  hiveEquivalent,
  savingAt,
  suppliesKey,
  suppliesFor,
  youSupply,
  bannerShape,
  bannerAdvice,
  tickerMinSeconds,
  specFor,
  groupByFormat,
  SITE_ONLY_SURFACES,
  EXAMPLE_DAYS,
  LONG_EXAMPLE_DAYS,
} from '../../../src/lib/adMarket.js'

describe('flightPrice', () => {
  it('is rate x seconds x days on a straight line', () => {
    expect(flightPrice(3, 0.01, 10)).toBe(0.3)
    expect(flightPrice(3, 0.01, 10, 1)).toBe(0.3)
  })

  it('applies the server\'s day curve days^K', () => {
    expect(flightPrice(30, 0.01, 10, 0.8)).toBe(Math.round(30 ** 0.8 * 0.1 * 1000) / 1000)
    expect(flightPrice(1, 0.05, 15, 0.8)).toBe(0.75)
  })

  it('ignores a K outside (0, 1] instead of inventing a discount or a surcharge', () => {
    for (const k of [0, -1, 1.5, 'abc', null]) expect(flightPrice(4, 0.01, 10, k)).toBe(0.4)
  })

  it('rounds to 3 decimals (HBD precision)', () => {
    expect(flightPrice(1, 0.0012345, 1)).toBe(0.001)
    expect(flightPrice(7, 0.0333333, 3)).toBe(0.7)
  })

  it('accepts numeric strings', () => {
    expect(flightPrice('2', '0.5', '4')).toBe(4)
  })

  it('is null for zero, negative or non-numeric input', () => {
    expect(flightPrice(0, 0.01, 10)).toBeNull()
    expect(flightPrice(-1, 0.01, 10)).toBeNull()
    expect(flightPrice(3, 'x', 10)).toBeNull()
    expect(flightPrice(3, 0.01, undefined)).toBeNull()
  })
})

describe('HBD to HIVE', () => {
  it('hivePayable rounds UP so the payment is never short', () => {
    expect(hivePayable(1, 0.3)).toBe(3.334)
    expect(hivePayable(3, 0.3)).toBe(10)
  })

  it('hiveEquivalent rounds to nearest for display', () => {
    expect(hiveEquivalent(1, 0.3)).toBe(3.333)
  })

  it('both are null without a usable rate or amount', () => {
    for (const fn of [hivePayable, hiveEquivalent]) {
      expect(fn(1, 0)).toBeNull()
      expect(fn(1, -0.2)).toBeNull()
      expect(fn(1, 'abc')).toBeNull()
      expect(fn(0, 0.3)).toBeNull()
      expect(fn('1', 0.3)).toBeNull()
    }
  })
})

describe('savingAt', () => {
  it('is the day-rate saving of an N-day flight, in whole percent', () => {
    expect(savingAt(30, { dayCurveK: 0.8 })).toBe(Math.round((1 - 30 ** -0.2) * 100))
    expect(savingAt(30, { dayCurveK: 0.8 })).toBe(49)
  })

  it('is null without a discounting curve, for one day, beyond maxDays, or under 5%', () => {
    expect(savingAt(30, { dayCurveK: 1 })).toBeNull()
    expect(savingAt(30, {})).toBeNull()
    expect(savingAt(30, null)).toBeNull()
    expect(savingAt(1, { dayCurveK: 0.8 })).toBeNull()
    expect(savingAt(60, { dayCurveK: 0.8, maxDays: 30 })).toBeNull()
    expect(savingAt(2, { dayCurveK: 0.95 })).toBeNull()
  })

  it('example windows are 3 and 30 days', () => {
    expect(EXAMPLE_DAYS).toBe(3)
    expect(LONG_EXAMPLE_DAYS).toBe(30)
  })
})

describe('what the advertiser supplies', () => {
  it('reads the list of accepted kinds, falling back to the single kind', () => {
    expect(suppliesKey({ creativeKinds: ['image', 'video'] })).toBe('imageOrVideo')
    expect(suppliesKey({ creativeKinds: ['image'] })).toBe('image')
    expect(suppliesKey({ creativeKinds: ['text'] })).toBe('text')
    expect(suppliesKey({ creativeKind: 'video' })).toBe('video')
    expect(suppliesKey({ creativeKinds: [], creativeKind: 'image' })).toBe('image')
    expect(suppliesKey(null)).toBe('video')
  })

  it('translates into a sentence', () => {
    expect(suppliesFor({ creativeKinds: ['image', 'video'] })).toBe('An image or a video')
    expect(youSupply({ creativeKind: 'text' })).toBe('You supply a short message and a link')
  })
})

describe('bannerShape / bannerAdvice', () => {
  it('rounds a near-whole ratio and derives the smallest accepted size', () => {
    expect(bannerShape({ recommended: '1456x240', minWidth: 728 })).toEqual({ ratio: 6, smallest: '728×120' })
  })

  it('keeps one decimal for a non-whole ratio and uses the recommended width without a minimum', () => {
    expect(bannerShape({ recommended: '1000 X 400' })).toEqual({ ratio: '2.5', smallest: '1000×400' })
  })

  it('is null for anything that is not WxH', () => {
    expect(bannerShape({ recommended: 'wide' })).toBeNull()
    expect(bannerShape(null)).toBeNull()
  })

  // Minor: the `ratio > 0` guard lets Infinity through, so "100x0" yields "Infinity:1".
  it('a zero-height recommendation ("100x0") is rejected instead of giving an Infinity ratio', () => {
    expect(bannerShape({ recommended: '100x0' })).toBeNull()
  })

  it('advice uses the shape when it can and a generic line when it cannot', () => {
    expect(bannerAdvice({ recommended: '1456x240', minWidth: 728 })).toBe('Make it 1456×240, or any other size in the same 6:1 shape, such as 728×120.')
    expect(bannerAdvice({})).toBe('It needs to be a wide strip.')
  })
})

describe('tickerMinSeconds', () => {
  it('is base + perWord x words rounded up, never under the floor (defaults 4, 0.5, 5)', () => {
    expect(tickerMinSeconds(0)).toBe(5)
    expect(tickerMinSeconds(2)).toBe(5)
    expect(tickerMinSeconds(3)).toBe(6)
    expect(tickerMinSeconds(10)).toBe(9)
    expect(tickerMinSeconds(20)).toBe(14)
  })

  it('counts words in a message', () => {
    expect(tickerMinSeconds('  one two   three  ')).toBe(6)
    expect(tickerMinSeconds('')).toBe(5)
    expect(tickerMinSeconds(null)).toBe(5)
  })

  it('takes its numbers from the rate card when present', () => {
    expect(tickerMinSeconds(10, { minSeconds: { base: 2, perWord: 1, floor: 3 } })).toBe(12)
    expect(tickerMinSeconds(0, { minSeconds: { base: 2, perWord: 1, floor: 3 } })).toBe(3)
  })
})

describe('specFor', () => {
  it('a ticker lists the character limit and readable lengths', () => {
    const s = specFor({ creativeKinds: ['text'], creativeSpec: { maxChars: 120 } })
    expect(s.rows[0].value).toBe('Up to 120 characters')
    expect(s.rows[0].note).toBe('10 words need 9s, 20 words 14s')
    expect(specFor({ creativeKind: 'text' }).rows[0].value).toBe('Up to 140 characters')
  })

  it('a portrait spot recommends 9:16', () => {
    const s = specFor({ creativeKind: 'video', creativeSpec: { shape: 'portrait', recommended: '1080x1920', minWidth: 720 } })
    expect(s.rows[0]).toMatchObject({ value: '1080×1920, 9:16', note: 'upright, at least 720px wide' })
    expect(s.rows[1].value).toBe('MP4 (H.264)')
  })

  it('a banner recommends its shape and lists accepted files', () => {
    const s = specFor({ creativeKinds: ['image', 'video'], creativeSpec: { recommended: '1456x240', minWidth: 728 } })
    expect(s.rows[0]).toMatchObject({ value: '1456×240', note: 'or any 6:1 size, e.g. 728×120' })
    expect(s.rows[1].value).toBe('PNG, JPG or MP4')
  })

  it('a landscape roll with no spec gets the player shape', () => {
    expect(specFor({ creativeKind: 'video' }).rows[0].value).toBe('1920×1080, 16:9')
  })
})

describe('groupByFormat', () => {
  it('groups known formats in order and puts unknown ones in "more"', () => {
    const items = [{ k: 'video_banner' }, { k: 'brand_new' }, { k: 'shorts_roll' }, { k: 'video_roll' }]
    const groups = groupByFormat(items, (i) => i.k)
    expect(groups.map((g) => g.id)).toEqual(['screen', 'overlay', 'more'])
    expect(groups[0].items.map((i) => i.k)).toEqual(['video_roll', 'shorts_roll'])
    expect(groups[2].items).toEqual([{ k: 'brand_new' }])
  })

  it('drops empty groups', () => {
    expect(groupByFormat([], (i) => i.k)).toEqual([])
  })
})

it('shorts and upload spots are site-only, watch spots travel', () => {
  expect(SITE_ONLY_SURFACES.has('shorts')).toBe(true)
  expect(SITE_ONLY_SURFACES.has('upload')).toBe(true)
  expect(SITE_ONLY_SURFACES.has('watch')).toBe(false)
})
