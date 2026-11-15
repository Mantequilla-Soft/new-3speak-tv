// The SDK's viewer boost text (BoostLabels) in the site language: the key list
// the frontend reads must be the SDK's, English must match the SDK's own
// defaults, and every language must keep the SDK's single-brace placeholders.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import i18n from '../../../src/i18n'
import { DEFAULT_BOOST_LABELS } from '@snapie/hangouts-react/dist/lib/boostLabels.js'
import { BOOST_LABEL_KEYS, boostLabelsFrom } from '../../../src/components/openpods/boostLabels.js'
import { LANGUAGE_CODES } from '../../../src/i18n/languages.js'

const ROOT = path.resolve(__dirname, '../../../src/locales')
const readBoost = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, lang, 'live.json'), 'utf8')).boost
const singleBraces = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
// A t() over one language's live.json, the way i18next resolves `live.<path>`.
const tFor = (lang) => {
  const live = JSON.parse(fs.readFileSync(path.join(ROOT, lang, 'live.json'), 'utf8'))
  return (key) => key.split('.').slice(1).reduce((d, k) => (d && typeof d === 'object' ? d[k] : undefined), live) ?? key
}

describe('boost labels', () => {
  it('reads exactly the keys the SDK has', () => {
    expect([...BOOST_LABEL_KEYS].sort()).toEqual(Object.keys(DEFAULT_BOOST_LABELS).sort())
  })

  it('English is the SDK default text', () => {
    expect(readBoost('en').dialog).toEqual(DEFAULT_BOOST_LABELS)
  })

  it.each(LANGUAGE_CODES)('%s has every key with the same placeholders', (lang) => {
    const { dialog, alertSpeech } = readBoost(lang)
    for (const k of BOOST_LABEL_KEYS) {
      expect(typeof dialog[k], `${lang} ${k}`).toBe('string')
      expect(dialog[k].length, `${lang} ${k}`).toBeGreaterThan(0)
      expect(singleBraces(dialog[k]), `${lang} ${k}`).toEqual(singleBraces(DEFAULT_BOOST_LABELS[k]))
    }
    expect(singleBraces(alertSpeech)).toEqual(['amount', 'asset', 'message', 'name'])
  })

  it('builds the labels object from a language', () => {
    const de = boostLabelsFrom(tFor('de'))
    expect(Object.keys(de).sort()).toEqual([...BOOST_LABEL_KEYS].sort())
    expect(de.goalReached).toBe('Ziel erreicht!')
    expect(de.minimumHint).toContain('${min}')
  })

  it('leaves out a key whose text is missing, so the SDK keeps English for it', () => {
    const t = (key) => (key === 'live.boost.dialog.send' ? 'Envoyer' : key)
    expect(boostLabelsFrom(t)).toEqual({ send: 'Envoyer' })
  })

  it('i18next hands the single-brace placeholders to the SDK untouched', () => {
    const t = i18n.getFixedT('en')
    expect(t('live.boost.dialog.feeHint')).toBe('{fee}% platform fee, @{recipient} receives {share}%')
    expect(t('live.boost.dialog.errMinimum', { min: 5 })).toContain('${min}')
  })
})
