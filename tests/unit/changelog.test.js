// The "We shipped an update" popup: src/changelog.js, src/version.js and the
// localStorage logic in src/utils/appVersion.js.
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { CHANGELOG, CHANGELOG_CATEGORIES, changelogSince, groupChangelog } from '../../src/changelog.js'
import { APP_VERSION } from '../../src/version.js'
import { readAppVersion, markVersionSeen, APP_VERSION_STORAGE_KEY } from '../../src/utils/appVersion.js'

const cmp = (a, b) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

describe('changelog entries', () => {
  // A release may raise APP_VERSION without an entry (a change with nothing to tell
  // users: "version bump, no changelog"). What must never happen is an entry newer
  // than the running build: it would announce something that is not deployed.
  it('no entry is newer than the running APP_VERSION', () => {
    expect(cmp(CHANGELOG[0].version, APP_VERSION)).toBeLessThanOrEqual(0)
  })

  it('every entry has an x.y.z version above the 1.0.0 production baseline', () => {
    for (const e of CHANGELOG) {
      expect(e.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(cmp(e.version, '1.0.0')).toBeGreaterThan(0)
    }
  })

  it('is ordered newest first with no duplicate versions', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(cmp(CHANGELOG[i - 1].version, CHANGELOG[i].version), `${CHANGELOG[i - 1].version} before ${CHANGELOG[i].version}`)
        .toBeGreaterThan(0)
    }
  })

  it('dates are YYYY-MM-DD and never go forward down the list', () => {
    for (let i = 0; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      if (i > 0) expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date, CHANGELOG[i - 1].version).toBe(true)
    }
  })

  it('every entry has a summary', () => {
    for (const e of CHANGELOG) expect(e.summary.trim().length, e.version).toBeGreaterThan(0)
  })

  // The popup groups entries by the page or part of 3Speak they change.
  it('every entry has a category from CHANGELOG_CATEGORIES', () => {
    for (const e of CHANGELOG) expect(CHANGELOG_CATEGORIES, e.version).toContain(e.category)
  })

  // House style since 1.78.69: short entries (at most ~3 sentences) and no em dashes.
  // Older entries predate the rule and are left as they are.
  const styled = CHANGELOG.filter((e) => cmp(e.version, '1.78.68') > 0)
  it('entries since 1.78.69 are at most 310 characters', () => {
    for (const e of styled) expect(e.summary.length, e.version).toBeLessThanOrEqual(310)
  })
  it('entries since 1.78.69 use no em dashes', () => {
    for (const e of styled) expect(e.summary, e.version).not.toContain('—')
  })
})

describe('changelogSince', () => {
  it('returns nothing without a version', () => {
    expect(changelogSince(null)).toEqual([])
    expect(changelogSince('')).toEqual([])
  })
  it('returns only strictly newer entries, newest first', () => {
    const since = changelogSince(CHANGELOG[3].version)
    expect(since.map((e) => e.version)).toEqual(CHANGELOG.slice(0, 3).map((e) => e.version))
  })
  it('compares numerically, not as text (1.10.0 is newer than 1.9.9)', () => {
    const since = changelogSince('1.9.9').map((e) => e.version)
    expect(since).toContain('1.10.0')
  })
  it('returns everything for a user still on the 1.0.0 baseline', () => {
    expect(changelogSince('1.0.0')).toHaveLength(CHANGELOG.length)
  })
  it('returns nothing for the current version', () => {
    expect(changelogSince(APP_VERSION)).toEqual([])
  })
})

describe('readAppVersion / markVersionSeen', () => {
  beforeEach(() => localStorage.clear())

  it('a first-time visitor is recorded and not prompted', () => {
    expect(readAppVersion()).toEqual({ previousVersion: null, shouldPrompt: false })
    expect(localStorage.getItem(APP_VERSION_STORAGE_KEY)).toBe(APP_VERSION)
  })

  it('a returning user on an older version is prompted, and keeps being prompted until marked seen', () => {
    localStorage.setItem(APP_VERSION_STORAGE_KEY, '1.0.0')
    expect(readAppVersion()).toEqual({ previousVersion: '1.0.0', shouldPrompt: true })
    expect(readAppVersion().shouldPrompt).toBe(true)
    markVersionSeen()
    expect(readAppVersion().shouldPrompt).toBe(false)
  })

  it('a user already on this version is not prompted', () => {
    localStorage.setItem(APP_VERSION_STORAGE_KEY, APP_VERSION)
    expect(readAppVersion().shouldPrompt).toBe(false)
  })
})

describe('groupChangelog', () => {
  const e = (version, category) => ({ version, category, date: '2026-10-30', summary: version })

  it('groups by category, newest change first, entries keeping their order', () => {
    const groups = groupChangelog([e('1.3.0', 'podcasts'), e('1.2.0', 'watch'), e('1.1.0', 'podcasts')])
    expect(groups.map((g) => [g.category, g.entries.map((x) => x.version)])).toEqual([
      ['podcasts', ['1.3.0', '1.1.0']],
      ['watch', ['1.2.0']],
    ])
  })

  it('puts an entry without a known category under general', () => {
    expect(groupChangelog([e('1.0.5', 'nonsense'), e('1.0.4', undefined)])[0]).toMatchObject({ category: 'general' })
  })

  it('every category has a name in the English locale', async () => {
    const app = (await import('../../src/locales/en/app.json')).default
    for (const c of CHANGELOG_CATEGORIES) expect(app.changelog.categories[c], c).toBeTruthy()
  })
})
