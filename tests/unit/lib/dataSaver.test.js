// @vitest-environment jsdom
// Data saver (lib/dataSaver.js): the viewer's choice wins, else the connection
// decides; and the quality a video starts at, capped at 360p with it on.
import { describe, it, expect, afterEach } from 'vitest'
import { connectionWantsSaving, isDataSaverOn, pickStartLevel } from '../../../src/lib/dataSaver.js'

const setConnection = (c) => Object.defineProperty(navigator, 'connection', { value: c, configurable: true })
afterEach(() => setConnection(undefined))

describe('connectionWantsSaving', () => {
  it('is on for Save-Data and 2G, off otherwise or without the API', () => {
    setConnection({ saveData: true, effectiveType: '4g' })
    expect(connectionWantsSaving()).toBe(true)
    setConnection({ saveData: false, effectiveType: 'slow-2g' })
    expect(connectionWantsSaving()).toBe(true)
    setConnection({ saveData: false, effectiveType: '2g' })
    expect(connectionWantsSaving()).toBe(true)
    setConnection({ saveData: false, effectiveType: '3g' })
    expect(connectionWantsSaving()).toBe(false)
    setConnection(undefined)
    expect(connectionWantsSaving()).toBe(false)
  })
})

describe('isDataSaverOn', () => {
  it("follows the viewer's choice, and the connection without one", () => {
    setConnection({ saveData: true })
    expect(isDataSaverOn(false)).toBe(false)
    expect(isDataSaverOn(null)).toBe(true)
    setConnection({ saveData: false, effectiveType: '4g' })
    expect(isDataSaverOn(true)).toBe(true)
    expect(isDataSaverOn(null)).toBe(false)
  })
})

describe('pickStartLevel', () => {
  const levels = [{ index: 0, height: 1080 }, { index: 1, height: 720 }, { index: 2, height: 480 }, { index: 3, height: 240 }]

  it('is automatic with no stored quality and no data saver', () => {
    expect(pickStartLevel(levels, null)).toBeNull()
    expect(pickStartLevel(levels, 'auto')).toBeNull()
    expect(pickStartLevel([], '720', true)).toBeNull()
  })

  it('takes the stored height, or the nearest below, or the lowest', () => {
    expect(pickStartLevel(levels, '720').index).toBe(1)
    expect(pickStartLevel(levels, '600').index).toBe(2)
    expect(pickStartLevel(levels, '144').index).toBe(3)
  })

  it('caps at 360p with data saver, also over a higher stored choice', () => {
    expect(pickStartLevel(levels, null, true).height).toBe(240)
    expect(pickStartLevel(levels, '1080', true).height).toBe(240)
    expect(pickStartLevel([{ index: 0, height: 720 }, { index: 1, height: 360 }], 'auto', true).index).toBe(1)
    expect(pickStartLevel(levels, '240', true).height).toBe(240)
  })
})
