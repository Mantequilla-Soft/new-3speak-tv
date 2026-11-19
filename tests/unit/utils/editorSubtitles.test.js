// The shorts editor's auto captions (src/utils/editorSubtitles.js): checked
// before they become a Short's subtitles, and kept out of CC's own choice when
// they are burnt into the picture.
import { describe, it, expect } from 'vitest'
import { sanitizeEditorSubtitles, autoCaptionLanguages } from '../../../src/utils/editorSubtitles.js'

const CUES = [{ start: 0, end: 1.2, text: 'Hello badadib fans' }, { start: 1.2, end: 2.5, text: 'Here we go' }]

describe('sanitizeEditorSubtitles', () => {
  it('keeps the language, the lines and whether they are burnt in', () => {
    expect(sanitizeEditorSubtitles({ language: 'DE', vttUrl: 'https://e/x.vtt', srtUrl: 'https://e/x.srt', cues: CUES, burnedIn: true }))
      .toEqual({ language: 'de', cues: CUES, burnedIn: true })
    expect(sanitizeEditorSubtitles({ language: 'pt-br', cues: CUES }).burnedIn).toBe(false)
    expect(sanitizeEditorSubtitles({ language: 'en', cues: CUES, burnedIn: 'yes' }).burnedIn).toBe(false)
  })

  it('no real language (whisper "auto", nonsense) is English', () => {
    expect(sanitizeEditorSubtitles({ language: 'auto', cues: CUES }).language).toBe('en')
    expect(sanitizeEditorSubtitles({ language: '$set', cues: CUES }).language).toBe('en')
    expect(sanitizeEditorSubtitles({ cues: CUES }).language).toBe('en')
  })

  it('drops lines with bad times or no text, and nothing usable is null', () => {
    const out = sanitizeEditorSubtitles({ language: 'en', cues: [
      ...CUES, null, { start: 'x', end: 1, text: 'a' }, { start: 5, end: 4, text: 'b' }, { start: -1, end: 1, text: 'c' },
      { start: 0, end: 1, text: '   ' }, { start: 0, end: 1, text: { toString: 1 } }, { start: 0, end: 90000, text: 'd' },
    ] })
    expect(out.cues).toEqual(CUES)
    expect(sanitizeEditorSubtitles({ language: 'en', cues: [] })).toBeNull()
    expect(sanitizeEditorSubtitles({ language: 'en', cues: 'many' })).toBeNull()
    expect(sanitizeEditorSubtitles(null)).toBeNull()
    expect(sanitizeEditorSubtitles('subs')).toBeNull()
  })

  it('at most 6000 lines', () => {
    const many = Array.from({ length: 7000 }, (_, i) => ({ start: i, end: i + 1, text: `l${i}` }))
    expect(sanitizeEditorSubtitles({ language: 'en', cues: many }).cues).toHaveLength(6000)
  })
})

describe('autoCaptionLanguages', () => {
  it('leaves out the burnt-in languages', () => {
    expect(autoCaptionLanguages([{ lang: 'en', cid: 'a', burnedIn: true }, { lang: 'de', cid: 'b' }])).toEqual([{ lang: 'de', cid: 'b' }])
    expect(autoCaptionLanguages(null)).toEqual([])
  })
})
