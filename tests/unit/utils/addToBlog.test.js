// @vitest-environment jsdom
// "Add to my blog" after publishing (src/utils/addToBlog.js): on by default,
// the last choice kept per browser, and the reblog operation it adds.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readAddToBlog, writeAddToBlog, reblogOp } from '../../../src/utils/addToBlog.js'

beforeEach(() => localStorage.clear())

describe('the remembered choice', () => {
  it('is on by default and remembers off and on', () => {
    expect(readAddToBlog()).toBe(true)
    writeAddToBlog(false)
    expect(readAddToBlog()).toBe(false)
    writeAddToBlog(true)
    expect(readAddToBlog()).toBe(true)
  })

  it('stays on, quietly, with storage blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readAddToBlog()).toBe(true)
    expect(() => writeAddToBlog(false)).not.toThrow()
  })
})

describe('reblogOp', () => {
  it('is a follow custom_json reblog signed with the posting key of the account', () => {
    expect(reblogOp('alice', 'alice', 'my-video')).toEqual(['custom_json', {
      required_auths: [],
      required_posting_auths: ['alice'],
      id: 'follow',
      json: '["reblog",{"account":"alice","author":"alice","permlink":"my-video"}]',
    }])
  })
})
