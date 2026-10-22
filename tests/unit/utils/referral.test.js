// Referral (?ref=) and invite-code capture: first touch wins, 30 day expiry,
// and the referrer riding along on the Butter Auth URL (src/utils/referral.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  captureReferralFromUrl,
  getStoredReferral,
  clearStoredReferral,
  withReferrer,
  rememberInvite,
  getStoredInvite,
  clearStoredInvite,
  queueInvitePopup,
  takeQueuedInvitePopup,
} from '../../../src/utils/referral.js'

const DAY = 24 * 60 * 60 * 1000

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  vi.useFakeTimers()
  vi.setSystemTime(Date.UTC(2026, 9, 1))
})
afterEach(() => vi.useRealTimers())

describe('referral capture', () => {
  it('stores a normalised name from ?ref=', () => {
    expect(captureReferralFromUrl('?ref=%40Alice ')).toBe('alice')
    expect(getStoredReferral()).toBe('alice')
  })

  it('first touch wins: a later link never overwrites the referrer', () => {
    captureReferralFromUrl('?ref=alice')
    expect(captureReferralFromUrl('?ref=mallory')).toBe('alice')
    expect(getStoredReferral()).toBe('alice')
  })

  it('ignores junk names and keeps whatever was stored', () => {
    expect(captureReferralFromUrl('?ref=a')).toBeNull()
    expect(captureReferralFromUrl('?ref=<script>')).toBeNull()
    expect(captureReferralFromUrl('?ref=waytoolongaccountname')).toBeNull()
    expect(captureReferralFromUrl('?foo=bar')).toBeNull()
    expect(localStorage.length).toBe(0)
    captureReferralFromUrl('?ref=bob')
    expect(captureReferralFromUrl('?ref=!!')).toBe('bob')
  })

  it('reads window.location.search by default', () => {
    window.history.replaceState(null, '', '/?ref=carol')
    expect(captureReferralFromUrl()).toBe('carol')
    window.history.replaceState(null, '', '/')
  })

  it('expires after 30 days, then a new link can take over', () => {
    captureReferralFromUrl('?ref=alice')
    vi.setSystemTime(Date.now() + 30 * DAY)
    expect(getStoredReferral()).toBe('alice')
    vi.setSystemTime(Date.now() + 1)
    expect(getStoredReferral()).toBeNull()
    expect(localStorage.getItem('threespeak_referral')).toBeNull()
    expect(captureReferralFromUrl('?ref=bob')).toBe('bob')
  })

  it('discards corrupt or tampered storage', () => {
    localStorage.setItem('threespeak_referral', '{not json')
    expect(getStoredReferral()).toBeNull()
    localStorage.setItem('threespeak_referral', JSON.stringify({ name: 'alice' }))
    expect(getStoredReferral()).toBeNull()
    localStorage.setItem('threespeak_referral', JSON.stringify({ name: 'Bad Name!', at: Date.now() }))
    expect(getStoredReferral()).toBeNull()
  })

  it('clearStoredReferral forgets it', () => {
    captureReferralFromUrl('?ref=alice')
    clearStoredReferral()
    expect(getStoredReferral()).toBeNull()
  })
})

describe('withReferrer', () => {
  it('leaves the URL alone when there is no referral', () => {
    expect(withReferrer('https://butrauth.com/authorize?x=1')).toBe('https://butrauth.com/authorize?x=1')
  })

  it('adds the stored referrer to the authorize URL', () => {
    captureReferralFromUrl('?ref=alice')
    const u = new URL(withReferrer('https://butrauth.com/authorize?client_id=3speak'))
    expect(u.searchParams.get('referrer')).toBe('alice')
    expect(u.searchParams.get('client_id')).toBe('3speak')
  })

  it('never clobbers a referrer already on the URL', () => {
    captureReferralFromUrl('?ref=alice')
    expect(new URL(withReferrer('https://butrauth.com/a?referrer=bob')).searchParams.get('referrer')).toBe('bob')
  })

  it('passes non-URLs and non-strings through', () => {
    captureReferralFromUrl('?ref=alice')
    expect(withReferrer('/relative')).toBe('/relative')
    expect(withReferrer(null)).toBeNull()
  })
})

describe('invite codes', () => {
  it('stores a 10 character lowercase code, first touch wins', () => {
    expect(rememberInvite(' ABCDE12345 ')).toBe('abcde12345')
    expect(rememberInvite('zzzzz99999')).toBe('abcde12345')
    expect(getStoredInvite()).toBe('abcde12345')
  })

  it('rejects malformed codes', () => {
    expect(rememberInvite('short')).toBeNull()
    expect(rememberInvite('abcde-1234')).toBeNull()
    expect(rememberInvite(undefined)).toBeNull()
    expect(getStoredInvite()).toBeNull()
  })

  it('expires after 30 days and drops a tampered stored code', () => {
    rememberInvite('abcde12345')
    vi.setSystemTime(Date.now() + 30 * DAY + 1)
    expect(getStoredInvite()).toBeNull()
    localStorage.setItem('threespeak_invite', JSON.stringify({ code: 'NOT-VALID!', at: Date.now() }))
    expect(getStoredInvite()).toBeNull()
    expect(localStorage.getItem('threespeak_invite')).toBeNull()
  })

  it('clearStoredInvite forgets it', () => {
    rememberInvite('abcde12345')
    clearStoredInvite()
    expect(getStoredInvite()).toBeNull()
  })
})

describe('invite popup queue', () => {
  it('hands the queued code out once', () => {
    queueInvitePopup('ABCDE12345')
    expect(takeQueuedInvitePopup()).toBe('abcde12345')
    expect(takeQueuedInvitePopup()).toBeNull()
  })

  it('drops a malformed queued code', () => {
    queueInvitePopup('nope')
    expect(takeQueuedInvitePopup()).toBeNull()
  })
})
