// The SDK's live battle meter text (BattleLabels) in the site language: the
// frontend reads the SDK's viewer keys, English matches the SDK defaults, and
// every language keeps the SDK's single-brace placeholders.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_BATTLE_LABELS } from '@snapie/hangouts-react/dist/lib/battle.js'
import { BATTLE_LABEL_KEYS, battleLabelsFrom } from '../../../src/components/openpods/battleLabels.js'
import { LANGUAGE_CODES } from '../../../src/i18n/languages.js'

const ROOT = path.resolve(__dirname, '../../../src/locales')
const readBar = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, lang, 'battles.json'), 'utf8')).bar
const singleBraces = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
const tFor = (lang) => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, lang, 'battles.json'), 'utf8'))
  return (key) => key.split('.').slice(1).reduce((d, k) => (d && typeof d === 'object' ? d[k] : undefined), file) ?? key
}

describe('battle labels', () => {
  it('reads SDK keys only (the studio-only invite outcomes stay English)', () => {
    for (const k of BATTLE_LABEL_KEYS) expect(DEFAULT_BATTLE_LABELS, k).toHaveProperty(k)
  })

  it('English is the SDK default text', () => {
    const en = readBar('en')
    for (const k of BATTLE_LABEL_KEYS) expect(en[k], k).toBe(DEFAULT_BATTLE_LABELS[k])
  })

  it.each(LANGUAGE_CODES)('%s has every key with the same placeholders', (lang) => {
    const bar = readBar(lang)
    expect(Object.keys(bar).sort()).toEqual([...BATTLE_LABEL_KEYS].sort())
    for (const k of BATTLE_LABEL_KEYS) {
      expect(bar[k].length, `${lang} ${k}`).toBeGreaterThan(0)
      expect(singleBraces(bar[k]), `${lang} ${k}`).toEqual(singleBraces(DEFAULT_BATTLE_LABELS[k]))
      expect(bar[k], `${lang} ${k}`).not.toContain(String.fromCharCode(0x2014))
    }
  })

  it('builds the labels object, leaving out missing keys', () => {
    const de = battleLabelsFrom(tFor('de'))
    expect(Object.keys(de).sort()).toEqual([...BATTLE_LABEL_KEYS].sort())
    expect(de.wins).toBe('@{name} gewinnt!')
    expect(battleLabelsFrom((key) => (key === 'battles.bar.tie' ? 'Remis' : key))).toEqual({ tie: 'Remis' })
  })
})
