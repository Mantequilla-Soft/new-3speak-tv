// The strings of the audio editor hand-off and the cover designer: in every
// language, really translated (not the English text copied over, apart from the
// few that are the same word there), with their placeholders, and no em dashes.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'src/locales')
const LANGS = readdirSync(DIR).filter((l) => !l.startsWith('.')).sort()

const KEYS = [
  'misc.uploadLinks.audioEditor',
  'misc.uploadLinks.subtitles.audioEditor',
  'modals.editor.audioNotSupported',
  'modals.editor.iframeTitleAudio',
  'modals.editor.preparingAudio',
  'modals.editor.postErrorAudio',
  'audio.upload.editAudio',
  'audio.upload.editAudioHint',
  'audio.upload.edited',
  'audio.upload.editedHint',
  'audio.upload.toasts.editedApplied',
  'audio.upload.thumb.fromPlaylist',
  'audio.upload.thumb.designCover',
  'audio.upload.thumb.editCover',
  'audio.upload.thumb.designHint',
  'audio.upload.thumb.designerTitle',
  'audio.upload.thumb.designUnavailable',
]

// The same in English: the product words Filipino keeps as they are
const SAME_AS_ENGLISH = new Set([
  'fil:misc.uploadLinks.audioEditor',
  'fil:modals.editor.iframeTitleAudio',
  'fil:audio.upload.thumb.designerTitle',
])

const cache = new Map()
function lookup(lang, key) {
  const [file, ...path] = key.split('.')
  const p = join(DIR, lang, `${file}.json`)
  if (!cache.has(p)) cache.set(p, JSON.parse(readFileSync(p, 'utf8')))
  return path.reduce((o, k) => (o == null ? undefined : o[k]), cache.get(p))
}

const placeholders = (s) => (String(s).match(/{{\s*\w+\s*}}/g) || []).sort()

describe('audio editor strings', () => {
  it('cover all 21 languages', () => {
    expect(LANGS).toHaveLength(21)
  })

  for (const key of KEYS) {
    it(`${key} is translated everywhere`, () => {
      const en = lookup('en', key)
      expect(typeof en).toBe('string')
      for (const lang of LANGS) {
        const text = lookup(lang, key)
        expect(typeof text, `${lang} ${key}`).toBe('string')
        expect(text.trim().length, `${lang} ${key}`).toBeGreaterThan(0)
        expect(placeholders(text), `${lang} ${key}`).toEqual(placeholders(en))
        expect(text, `${lang} ${key}`).not.toMatch(/[–—]/)
        if (lang !== 'en' && !SAME_AS_ENGLISH.has(`${lang}:${key}`)) {
          expect(text, `${lang} ${key} is the English text`).not.toBe(en)
        }
      }
    })
  }
})
