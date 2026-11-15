// The SDK's live-interaction text (LiveLabels: polls, predictions, raids) in the
// site language: the key list must be the SDK's, English must be the SDK's own
// defaults, and every language must keep the SDK's single-brace placeholders.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_LIVE_LABELS } from '@snapie/hangouts-react/dist/lib/liveLabels.js'
import { LIVE_LABEL_KEYS, liveLabelsFrom, raidPath } from '../../../src/components/openpods/liveLabels.js'
import { LANGUAGE_CODES } from '../../../src/i18n/languages.js'

const ROOT = path.resolve(__dirname, '../../../src/locales')
const read = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, lang, 'liveInteract.json'), 'utf8'))
const singleBraces = (s) => [...String(s).matchAll(/(?<!\{)\{(\w+)\}(?!\})/g)].map((m) => m[1]).sort()

describe('live labels', () => {
  it('reads exactly the keys the SDK has', () => {
    expect([...LIVE_LABEL_KEYS].sort()).toEqual(Object.keys(DEFAULT_LIVE_LABELS).sort())
  })

  it('English is the SDK default text', () => {
    expect(read('en').labels).toEqual(DEFAULT_LIVE_LABELS)
  })

  it.each(LANGUAGE_CODES)('%s has every key with the same placeholders', (lang) => {
    const labels = read(lang).labels
    for (const k of LIVE_LABEL_KEYS) {
      expect(typeof labels[k], `${lang} ${k}`).toBe('string')
      expect(singleBraces(labels[k]), `${lang} ${k}`).toEqual(singleBraces(DEFAULT_LIVE_LABELS[k]))
    }
  })

  it('builds the labels object from t, leaving out what is missing', () => {
    const t = (key) => (key.endsWith('.pollBadge') ? 'Umfrage' : key)
    expect(liveLabelsFrom(t)).toEqual({ pollBadge: 'Umfrage' })
  })

  it('a raid goes to the target stream page', () => {
    expect(raidPath({ roomName: 'badadib-ab12cd', host: 'badadib' })).toBe('/watch/badadib-ab12cd')
  })
})
