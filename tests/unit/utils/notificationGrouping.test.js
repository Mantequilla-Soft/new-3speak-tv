// Clustering Hive notifications for the bell menu (src/utils/notificationGrouping.js).
import { describe, it, expect } from 'vitest'
import { groupNotifications } from '../../../src/utils/notificationGrouping.js'

const H = 3600 * 1000
const BASE = Date.UTC(2026, 9, 20, 12)
const at = (hours) => new Date(BASE + hours * H).toISOString()
let nextId = 1
const n = (type, hours, msg, url = 'me/post') => ({ id: nextId++, type, date: at(hours), msg, url, score: 50 })
const vote = (who, hours, value, url) => n('vote', hours, `@${who} voted on your post ($${value})`, url)

describe('groupNotifications', () => {
  it('returns [] for no notifications', () => {
    expect(groupNotifications([])).toEqual([])
    expect(groupNotifications(null)).toEqual([])
  })

  it('groups votes on the same post within 24 hours, adding up their value', () => {
    const [g] = groupNotifications([vote('alice', 0, '0.04'), vote('bob', 5, '0.10'), vote('carol', 23, '1.005')])
    expect(g.type).toBe('group')
    expect(g.notifType).toBe('vote')
    expect(g.items.map((i) => i.msg.split(' ')[0])).toEqual(['@carol', '@bob', '@alice'])
    expect(g.actors).toEqual(['carol', 'bob', 'alice'])
    expect(g.totalValue).toBe(1.145)
    expect(g.date).toBe(at(23))
    expect(g.id).toBe(g.items[0].id)
  })

  it('starts a new vote group once the window passes 24 hours', () => {
    const out = groupNotifications([vote('a', 0, '1'), vote('b', 24, '1'), vote('c', 24.5, '1'), vote('d', 30, '1')])
    expect(out).toHaveLength(2)
    expect(out[0].type).toBe('group')
    expect(out[0].actors).toEqual(['d', 'c'])
    expect(out[1].actors).toEqual(['b', 'a'])
  })

  it('keeps votes on different posts apart', () => {
    const out = groupNotifications([vote('a', 0, '1', 'me/one'), vote('b', 1, '2', 'me/two')])
    expect(out.map((g) => g.type)).toEqual(['single', 'single'])
    expect(out[0].totalValue).toBe(2)
    expect(out[0].actors).toEqual(['b'])
  })

  it('a lone vote is a single with its value and voter', () => {
    const [s] = groupNotifications([vote('alice', 0, '0.25')])
    expect(s).toMatchObject({ type: 'single', notifType: 'vote', totalValue: 0.25, actors: ['alice'] })
    expect(s.notification).toBe(s.items[0])
  })

  it('a vote without a readable value counts as zero', () => {
    const [g] = groupNotifications([n('vote', 0, '@a voted on your post'), vote('b', 1, '0.5')])
    expect(g.totalValue).toBe(0.5)
  })

  it('lists each voter once even if they voted twice', () => {
    const [g] = groupNotifications([vote('a', 0, '1'), vote('a', 1, '1'), vote('b', 2, '1')])
    expect(g.actors).toEqual(['b', 'a'])
    expect(g.items).toHaveLength(3)
  })

  it('puts every follow into one group, whatever the urls', () => {
    const out = groupNotifications([
      n('follow', 0, '@alice followed you', '@alice'),
      n('follow', 50, '@bob followed you', '@bob'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'group', notifType: 'follow', actors: ['bob', 'alice'], date: at(50) })
    expect(out[0].totalValue).toBeUndefined()
  })

  it('a single follow is a single with its actor', () => {
    const [s] = groupNotifications([n('follow', 0, '@alice followed you', '@alice')])
    expect(s).toMatchObject({ type: 'single', notifType: 'follow', actors: ['alice'] })
  })

  it('keeps replies, mentions and the rest as singles, newest first overall', () => {
    const out = groupNotifications([
      n('reply', 1, '@a replied to your post'),
      vote('v', 3, '1'),
      n('mention', 2, '@m mentioned you'),
      n('follow', 0, '@f followed you'),
    ])
    expect(out.map((g) => g.notifType)).toEqual(['vote', 'mention', 'reply', 'follow'])
    expect(out.every((g) => g.type === 'single')).toBe(true)
  })

  it('reads Hive UTC dates that carry no Z, ordering them correctly', () => {
    const out = groupNotifications([
      { id: 1, type: 'reply', date: '2026-10-20T10:00:00', msg: '@a replied' },
      { id: 2, type: 'reply', date: '2026-10-20T11:00:00', msg: '@b replied' },
    ])
    expect(out.map((g) => g.id)).toEqual([2, 1])
  })

  it('handles a large page', () => {
    const many = Array.from({ length: 2000 }, (_, i) => vote(`u${i}`, i * 0.01, '0.001', `me/p${i % 10}`))
    const out = groupNotifications(many)
    expect(out).toHaveLength(10)
    expect(out.reduce((s, g) => s + g.items.length, 0)).toBe(2000)
  })
})
