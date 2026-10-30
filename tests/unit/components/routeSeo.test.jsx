// What RouteTitle tells search engines about each route (src/components/RouteTitle.jsx):
// one canonical address on 3speak.tv per page, and noindex on pages that only
// mean something to the signed-in person.
import { describe, it, expect, vi } from 'vitest'
import { resolveCanonical, isPrivateRoute, resolveDocumentTitle } from '../../../src/components/RouteTitle.jsx'
import { nowPlayingLabel } from '../../../src/utils/audioTrack.js'

// RouteTitle reads the playing track from the store, which signs people in on
// import; none of that is needed for the plain functions tested here.
vi.mock('../../../src/lib/store', () => ({ useAppStore: () => null }))

describe('resolveCanonical', () => {
  it('names the live site, without the query string', () => {
    expect(resolveCanonical('/trend', '?utm_source=x')).toBe('https://3speak.tv/trend')
    expect(resolveCanonical('/', '')).toBe('https://3speak.tv/')
    expect(resolveCanonical('/leaderboard/', '')).toBe('https://3speak.tv/leaderboard')
  })

  it('folds the profile aliases into /@<name>, lowercased', () => {
    expect(resolveCanonical('/p/Alice')).toBe('https://3speak.tv/@alice')
    expect(resolveCanonical('/user/alice')).toBe('https://3speak.tv/@alice')
    expect(resolveCanonical('/@Alice')).toBe('https://3speak.tv/@alice')
    expect(resolveCanonical('/@alice/shorts')).toBe('https://3speak.tv/@alice')
  })

  it('lowercases tags and sends the old communities address to /groups', () => {
    expect(resolveCanonical('/t/Gaming')).toBe('https://3speak.tv/t/gaming')
    expect(resolveCanonical('/communities')).toBe('https://3speak.tv/groups')
  })

  it('keeps the /groups tab, which is a different list', () => {
    expect(resolveCanonical('/groups', '?tab=badges')).toBe('https://3speak.tv/groups?tab=badges')
    expect(resolveCanonical('/groups', '?tab=communities')).toBe('https://3speak.tv/groups')
  })

  it('names a badge by its /b/ address', () => {
    expect(resolveCanonical('/badge/Threespeak')).toBe('https://3speak.tv/b/threespeak')
  })
})

describe('isPrivateRoute', () => {
  it('flags flows and personal pages, subpaths included', () => {
    for (const p of ['/upload', '/embed-studio/details', '/draft', '/notifications', '/profile', '/wallet/alice', '/watched/alice', '/auth/login', '/chat']) {
      expect(isPrivateRoute(p), p).toBe(true)
    }
  })

  it('leaves public pages indexable', () => {
    for (const p of ['/', '/trend', '/new', '/t/hive', '/user/alice', '/playlist/abc12345', '/community/hive-1', '/groups', '/about', '/invitesomething']) {
      expect(isPrivateRoute(p), p).toBe(false)
    }
  })
})

describe('resolveDocumentTitle', () => {
  it('gives sub-pages the 3S prefix and an unknown route the brand title', () => {
    expect(resolveDocumentTitle('/t/hive')).toBe('3S | #hive')
    expect(resolveDocumentTitle('/no/such/route')).toBeTruthy()
  })
})

describe('nowPlayingLabel (the tab title on the audio pages)', () => {
  it('names the track and who it is by', () => {
    expect(nowPlayingLabel({ title: 'Hot Rod Juice', owner: 'seckorama' })).toBe('Hot Rod Juice · @seckorama')
    expect(nowPlayingLabel({ title: 'Episode 12', external: true, show: 'The Show' })).toBe('Episode 12 · The Show')
  })

  it('is empty when nothing is loaded, and the title alone without an artist', () => {
    expect(nowPlayingLabel(null)).toBe('')
    expect(nowPlayingLabel({ title: 'Episode 12', external: true })).toBe('Episode 12')
  })
})
