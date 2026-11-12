// The icon font is a subset (src/styles/material-symbols.css, built by
// scripts/icons/subset.py). An icon that is used in src/ but missing from the
// subset would render as its raw name ("play_arrow") instead of the glyph.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { findUsedIcons, missingFromSubset, SUBSET_NAMES_FILE, ALL_NAMES_FILE, EXTRA_ICONS } from '../../scripts/icons/scan.mjs'

describe('icon font subset', () => {
  it('contains every icon the app uses (run `npm run icons:subset` if this fails)', () => {
    expect(missingFromSubset()).toEqual([])
  })

  it('finds icons from props, plain spans and runtime names', () => {
    const used = findUsedIcons()
    // <Icon name="close" />, Icon.of("share"), and the runtime `replay_${SKIP_BACK}`
    for (const name of ['close', 'share', ...EXTRA_ICONS]) expect(used).toContain(name)
  })

  it('only lists real Material Symbols names', () => {
    const all = new Set(JSON.parse(fs.readFileSync(ALL_NAMES_FILE, 'utf8')))
    const subset = JSON.parse(fs.readFileSync(SUBSET_NAMES_FILE, 'utf8'))
    expect(subset.filter((n) => !all.has(n))).toEqual([])
  })
})
