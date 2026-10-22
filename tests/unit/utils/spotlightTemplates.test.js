// Spotlight design templates (src/utils/spotlightTemplates.js): every template
// must only use fonts, icons, motions and block shapes the editor knows about.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/hive-api/hiveApi', () => ({ getAccounts: vi.fn() }))
vi.mock('../../../src/hive-api/aioha', () => ({ broadcastWithAioha: vi.fn(), KeyTypes: { Posting: 'posting' } }))
vi.mock('../../../src/i18n', () => ({ t: (k) => k }))

import { TEMPLATES } from '../../../src/utils/spotlightTemplates.js'
import { SPOTLIGHT_ICONS, FONT_OPTIONS, ANIM_TYPES, SECTION_TYPES, withIds } from '../../../src/utils/spotlight.js'
import spotlightEn from '../../../src/locales/en/spotlight.json'

const lookup = (key) => key.split('.').slice(1).reduce((o, k) => o?.[k], spotlightEn)
const ICONS = new Set(SPOTLIGHT_ICONS.map((i) => i.slug))
const FONTS = new Set(FONT_OPTIONS.map((f) => f.value))
const ANIMS = new Set(ANIM_TYPES.map((a) => a.value))
const TYPES = new Set(SECTION_TYPES.map((s) => s.type))

describe('spotlight templates', () => {
  it('have unique ids', () => {
    const ids = TEMPLATES.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('name and niche keys exist in the English strings', () => {
    for (const t of TEMPLATES) {
      expect(typeof lookup(t.nameKey), t.nameKey).toBe('string')
      expect(typeof lookup(t.nicheKey), t.nicheKey).toBe('string')
    }
  })

  it('use only fonts and avatar motions the editor offers', () => {
    for (const t of TEMPLATES) {
      expect(FONTS.has(t.theme.font), `${t.id} font ${t.theme.font}`).toBe(true)
      if (t.theme.avatarAnimType) expect(ANIMS.has(t.theme.avatarAnimType), t.id).toBe(true)
    }
  })

  it('image backgrounds point at an https image, gradients have both colours', () => {
    for (const t of TEMPLATES) {
      const bg = t.theme.bg
      if (bg.type === 'image') expect(bg.image, t.id).toMatch(/^https:\/\//)
      else {
        expect(bg.type, t.id).toBe('gradient')
        expect(bg.color && bg.color2, t.id).toBeTruthy()
      }
    }
  })

  it('sample blocks are known types with known icons and valid widths', () => {
    for (const t of TEMPLATES) {
      for (const s of t.sections) {
        expect(TYPES.has(s.type), `${t.id} ${s.type}`).toBe(true)
        if (s.type === 'link') expect(ICONS.has(s.icon), `${t.id} icon ${s.icon}`).toBe(true)
        if (s.width) expect(['full', 'half', 'third']).toContain(s.width)
        expect(s.id, 'templates carry no ids').toBeUndefined()
      }
    }
  })

  it('"latest posts" blocks stay within the editor limits', () => {
    for (const t of TEMPLATES) {
      for (const s of t.sections.filter((x) => x.type === 'embed')) {
        expect(s.source).toBe('hive-recent')
        expect(s.perRow).toBeGreaterThanOrEqual(1)
        expect(s.perRow).toBeLessThanOrEqual(3)
        expect(s.imgSize).toBeGreaterThanOrEqual(0)
        expect(s.imgSize).toBeLessThanOrEqual(100)
      }
    }
  })

  it('applying a template through withIds gives every block an id', () => {
    const out = withIds(TEMPLATES[0])
    expect(out.sections).toHaveLength(TEMPLATES[0].sections.length)
    for (const s of out.sections) expect(s.id).toBeTruthy()
  })
})
