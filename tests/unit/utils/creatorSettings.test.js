// A creator's moderation flags from the checker; blocks only on an explicit flag
// and fails open (src/utils/creatorSettings.js).
import { describe, it, expect, beforeEach, vi } from 'vitest'

const get = vi.hoisted(() => vi.fn())
vi.mock('axios', () => ({ default: { get } }))

import { creatorKey, getCreatorSettings, isBanned, isUploadBlocked } from '../../../src/utils/creatorSettings.js'

beforeEach(() => get.mockReset())

describe('getCreatorSettings', () => {
  it('reads /check/:username with a timeout', async () => {
    get.mockResolvedValue({ data: { canUpload: true } })
    expect(await getCreatorSettings('a b')).toEqual({ canUpload: true })
    expect(get).toHaveBeenCalledWith('https://checker.3speak.tv/check/a%20b', { timeout: 8000 })
  })

  it('returns null without a username, on an empty body, or on error', async () => {
    expect(await getCreatorSettings('')).toBeNull()
    expect(get).not.toHaveBeenCalled()
    get.mockResolvedValueOnce({ data: '' })
    expect(await getCreatorSettings('alice')).toBeNull()
    get.mockRejectedValueOnce(new Error('down'))
    expect(await getCreatorSettings('alice')).toBeNull()
  })
})

describe('isBanned / isUploadBlocked', () => {
  it('block only when the flag is literally set', () => {
    expect(isBanned({ banned: true })).toBe(true)
    expect(isBanned({ banned: 'true' })).toBe(false)
    expect(isBanned({})).toBe(false)
    expect(isBanned(null)).toBe(false)
    expect(isUploadBlocked({ canUpload: false })).toBe(true)
    expect(isUploadBlocked({ canUpload: 0 })).toBe(false)
    expect(isUploadBlocked({})).toBe(false)
    expect(isUploadBlocked(null)).toBe(false)
  })
})

describe('creatorKey', () => {
  it('is the Hive name, or ~<handle> for a warm-up user, never a bare handle', () => {
    expect(creatorKey('alice', null)).toBe('alice')
    expect(creatorKey('alice', 'newbie')).toBe('alice')
    expect(creatorKey(null, 'Newbie')).toBe('~newbie')
    expect(creatorKey(null, null)).toBeNull()
  })

  it('~ survives the /check URL as is', async () => {
    get.mockResolvedValue({ data: { canUpload: false } })
    await getCreatorSettings(creatorKey(null, 'newbie'))
    expect(get).toHaveBeenCalledWith('https://checker.3speak.tv/check/~newbie', { timeout: 8000 })
  })
})
