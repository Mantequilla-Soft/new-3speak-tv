// The translation editor's own framework-less self-test (server/i18n-editor.test.cjs),
// run as it is meant to be run, with an empty environment.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { REPO } from './helpers/server.js'

describe('i18n editor self-test', () => {
  it('passes', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), '3speak-api-test-i18n-'))
    try {
      const r = spawnSync(process.execPath, ['server/i18n-editor.test.cjs'], {
        cwd: REPO,
        env: { PATH: process.env.PATH, HOME: home },
        encoding: 'utf8',
        timeout: 60000,
      })
      expect(r.status, r.stdout + r.stderr).toBe(0)
    } finally {
      fs.rmSync(home, { recursive: true, force: true })
    }
  })
})
