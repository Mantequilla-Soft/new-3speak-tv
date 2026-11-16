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

  it('sits beside "Maintained by Mantequilla-Soft" in the shell, the Hive link unchanged', () => {
    const html = source('index.html')
    expect(html).toMatch(/>Powered by Hive<\/a><span class="site-hive-footer__sep" aria-hidden="true">·<\/span><a class="site-hive-footer__maintainer" href="https:\/\/mantequilla-soft\.com"[^>]*>Maintained by Mantequilla-Soft<\/a>/)
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
