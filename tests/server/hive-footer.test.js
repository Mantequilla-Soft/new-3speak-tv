import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function source(rel) {
  return readFileSync(join(root, rel), 'utf8')
}

function hiveLinks(html) {
  return [...html.matchAll(/<a\b[^>]*href="https:\/\/hive\.io"[^>]*>Powered by Hive<\/a>/g)].map((m) => m[0])
}

describe('Powered by Hive footer in server-rendered HTML', () => {
  it('is in the static SPA shell, followed (no nofollow / ugc / sponsored)', () => {
    const links = hiveLinks(source('index.html'))
    expect(links.length).toBeGreaterThanOrEqual(1)
    for (const a of links) {
      expect(a).not.toMatch(/nofollow|ugc|sponsored/)
    }
  })

  it('is in every crawler HTML template', () => {
    const files = [
      'server/og-server.cjs',
      'server/og-pages.cjs',
      'server/og-site.cjs',
      'server/og-lists.cjs',
    ]
    for (const rel of files) {
      const links = hiveLinks(source(rel))
      expect(links.length, rel).toBeGreaterThanOrEqual(1)
      for (const a of links) {
        expect(a, rel).not.toMatch(/nofollow|ugc|sponsored/)
      }
    }
  })
})
