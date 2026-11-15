// The watch page's keyboard rules (lib/playerKeys.js) and the timeline slider keys
// (lib/sliderKeys.js) shared by the video scrubber and the audio waveform.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  isTypingTarget, volumeAfter, percentSeekTarget, captionToggleTarget, PLAYER_SHORTCUTS,
  readTheater, saveTheater, THEATER_STORAGE_KEY,
} from '../../../src/lib/playerKeys'
import { seekKeyTarget, clockText, timelineSliderProps } from '../../../src/lib/sliderKeys'

const el = (html) => {
  const box = document.createElement('div')
  box.innerHTML = html
  return box.firstElementChild
}

describe('player keys', () => {
  it('never fires while typing, but a checkbox or a button is not typing', () => {
    expect(isTypingTarget(el('<input type="text">'))).toBe(true)
    expect(isTypingTarget(el('<input>'))).toBe(true)
    expect(isTypingTarget(el('<input type="range">'))).toBe(true)
    expect(isTypingTarget(el('<textarea></textarea>'))).toBe(true)
    expect(isTypingTarget(el('<select></select>'))).toBe(true)
    const editable = el('<div contenteditable="true"></div>')
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isTypingTarget(editable)).toBe(true)
    expect(isTypingTarget(el('<input type="checkbox">'))).toBe(false)
    expect(isTypingTarget(el('<button></button>'))).toBe(false)
    expect(isTypingTarget(document.body)).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })

  it('arrow up and down move the volume in 5 % steps, from 0 when muted, within 0 to 1', () => {
    expect(volumeAfter(0.5, false, 1)).toBe(0.55)
    expect(volumeAfter(0.5, false, -1)).toBe(0.45)
    expect(volumeAfter(0.98, false, 1)).toBe(1)
    expect(volumeAfter(0.02, false, -1)).toBe(0)
    expect(volumeAfter(0.8, true, 1)).toBe(0.05)
    expect(volumeAfter(undefined, false, -1)).toBe(0.95)
  })

  it('0 to 9 jump to that tenth of the video; anything else is not a seek', () => {
    expect(percentSeekTarget('0', 200)).toBe(0)
    expect(percentSeekTarget('5', 200)).toBe(100)
    expect(percentSeekTarget('9', 200)).toBe(180)
    expect(percentSeekTarget('a', 200)).toBeNull()
    expect(percentSeekTarget('10', 200)).toBeNull()
    expect(percentSeekTarget('3', 0)).toBeNull()
  })

  it('C turns captions off, or on in the language picked last, the interface one, or the first', () => {
    const langs = [{ lang: 'en' }, { lang: 'de' }, { lang: 'es' }]
    expect(captionToggleTarget(langs, 'de')).toBeNull()
    expect(captionToggleTarget(langs, null, { remembered: 'es', uiLang: 'de' })).toBe('es')
    expect(captionToggleTarget(langs, null, { remembered: 'fr', uiLang: 'de-AT' })).toBe('de')
    expect(captionToggleTarget(langs, null)).toBe('en')
    expect(captionToggleTarget([], null)).toBeUndefined()
    expect(captionToggleTarget(null, null)).toBeUndefined()
  })

  it('the ? sheet lists every key once, theater marked as wide only', () => {
    const labels = PLAYER_SHORTCUTS.map((s) => s.label)
    expect(new Set(labels).size).toBe(labels.length)
    for (const k of ['k', 'j', 'l', 'm', 'c', 'f', 't', '?', '↑']) {
      expect(PLAYER_SHORTCUTS.some((s) => s.keys.includes(k))).toBe(true)
    }
    expect(PLAYER_SHORTCUTS.find((s) => s.keys.includes('t')).wideOnly).toBe(true)
  })

  describe('theater is remembered', () => {
    beforeEach(() => localStorage.clear())
    it('on and off', () => {
      expect(readTheater()).toBe(false)
      saveTheater(true)
      expect(localStorage.getItem(THEATER_STORAGE_KEY)).toBe('1')
      expect(readTheater()).toBe(true)
      saveTheater(false)
      expect(readTheater()).toBe(false)
    })
  })
})

describe('timeline slider keys', () => {
  it('arrows step 5 s, Page keys 10 %, Home and End the ends, clamped', () => {
    expect(seekKeyTarget('ArrowRight', 30, 600)).toBe(35)
    expect(seekKeyTarget('ArrowUp', 30, 600)).toBe(35)
    expect(seekKeyTarget('ArrowLeft', 30, 600)).toBe(25)
    expect(seekKeyTarget('ArrowDown', 3, 600)).toBe(0)
    expect(seekKeyTarget('PageUp', 30, 600)).toBe(90)
    expect(seekKeyTarget('PageDown', 30, 600)).toBe(0)
    expect(seekKeyTarget('Home', 30, 600)).toBe(0)
    expect(seekKeyTarget('End', 30, 600)).toBe(600)
    expect(seekKeyTarget('ArrowRight', 598, 600)).toBe(600)
    expect(seekKeyTarget('Enter', 30, 600)).toBeNull()
    expect(seekKeyTarget('ArrowRight', 30, 0)).toBeNull()
    expect(seekKeyTarget('ArrowRight', NaN, 600)).toBe(5)
  })

  it('reads the time as a clock, with hours from an hour up', () => {
    expect(clockText(65)).toBe('1:05')
    expect(clockText(3725)).toBe('1:02:05')
    expect(clockText(-3)).toBe('0:00')
  })

  it('carries the slider role and values for screen readers', () => {
    const t = (k, o) => `${o.time} of ${o.total}`
    expect(timelineSliderProps({ value: 65.4, max: 240, label: 'Seek', t })).toEqual({
      role: 'slider', tabIndex: 0, 'aria-label': 'Seek', 'aria-valuemin': 0, 'aria-valuemax': 240,
      'aria-valuenow': 65, 'aria-valuetext': '1:05 of 4:00', 'aria-disabled': undefined,
    })
    const off = timelineSliderProps({ value: 500, max: 240, label: 'Seek', t, disabled: true })
    expect(off).toMatchObject({ tabIndex: -1, 'aria-valuenow': 240, 'aria-disabled': true })
  })
})
