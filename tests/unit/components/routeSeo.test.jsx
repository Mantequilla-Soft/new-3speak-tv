// What RouteTitle tells search engines about each route (src/components/RouteTitle.jsx):
// one canonical address on 3speak.tv per page, and noindex on pages that only
// mean something to the signed-in person.
import { describe, it, expect } from 'vitest'
import { resolveCanonical, isPrivateRoute, resolveDocumentTitle } from '../../../src/components/RouteTitle.jsx'

describe('resolveCanonical', () => {
  it('names the live site, without the query string', () => {
    expect(resolveCanonical('/trend', '?utm_source=x')).toBe('https://3speak.tv/trend')
    expect(resolveCanonical('/', '')).toBe('https://3speak.tv/')
    expect(resolveCanonical('/leaderboard/', '')).toBe('https://3speak.tv/leaderboard')
  })

  it('folds the profile aliases into /user/<name>, lowercased', () => {
    expect(resolveCanonical('/p/Alice')).toBe('https://3speak.tv/user/alice')
    expect(resolveCanonical('/user/alice')).toBe('https://3speak.tv/user/alice')
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
