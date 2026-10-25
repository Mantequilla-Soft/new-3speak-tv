import { describe, it, expect } from 'vitest'
import { profilePath, watchPath, parseHivePath, isWatchPath, isProfilePath } from '../../../src/utils/urls'

describe('building addresses', () => {
  it('a profile is /@user, with an optional query', () => {
    expect(profilePath('alice')).toBe('/@alice')
    expect(profilePath('alice', 'tab=shorts')).toBe('/@alice?tab=shorts')
    expect(profilePath('alice', '?tab=audio')).toBe('/@alice?tab=audio')
    expect(profilePath('alice', '')).toBe('/@alice')
  })

  it('a video is /@author/permlink, whatever the query starts with', () => {
    expect(watchPath('alice', 'my-vid')).toBe('/@alice/my-vid')
    expect(watchPath('alice', 'my-vid', 't=65')).toBe('/@alice/my-vid?t=65')
    expect(watchPath('alice', 'my-vid', '&playlist=x&pos=2')).toBe('/@alice/my-vid?playlist=x&pos=2')
    expect(watchPath('alice', 'my-vid', '?t=1')).toBe('/@alice/my-vid?t=1')
  })
})

describe('reading addresses', () => {
  it('tells profiles, shorts tabs and posts apart', () => {
    expect(parseHivePath('/@alice')).toEqual({ kind: 'profile', user: 'alice' })
    expect(parseHivePath('/@alice/')).toEqual({ kind: 'profile', user: 'alice' })
    expect(parseHivePath('/@alice/shorts')).toEqual({ kind: 'shorts', user: 'alice' })
    expect(parseHivePath('/@alice/my-vid')).toEqual({ kind: 'post', author: 'alice', permlink: 'my-vid' })
  })

  it('leaves /@user/links to Spotlight and other paths alone', () => {
    expect(parseHivePath('/@alice/links')).toBeNull()
    expect(parseHivePath('/p/alice')).toBeNull()
    expect(parseHivePath('/watch')).toBeNull()
  })

  it('knows the watch page and the profile page under both addresses', () => {
    expect(isWatchPath('/watch')).toBe(true)
    expect(isWatchPath('/@alice/my-vid')).toBe(true)
    expect(isWatchPath('/@alice')).toBe(false)
    expect(isWatchPath('/watch/room1')).toBe(false)
    expect(isProfilePath('/@alice')).toBe(true)
    expect(isProfilePath('/@alice/shorts')).toBe(true)
    expect(isProfilePath('/p/alice')).toBe(true)
    expect(isProfilePath('/user/alice')).toBe(true)
    expect(isProfilePath('/@alice/my-vid')).toBe(false)
  })
})
