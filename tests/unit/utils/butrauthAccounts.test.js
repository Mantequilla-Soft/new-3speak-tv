// The Butter Auth half of the account switcher: names only, newest first, at
// most six (src/utils/butrauthAccounts.js).
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { listButrauthAccounts, rememberButrauthAccount, forgetButrauthAccount } from '../../../src/utils/butrauthAccounts.js'

beforeEach(() => localStorage.clear())

describe('butrauth account list', () => {
  it('is empty to start with', () => {
    expect(listButrauthAccounts()).toEqual([])
  })

  it('puts the latest account on top without duplicates, lowercased', () => {
    rememberButrauthAccount('alice')
    rememberButrauthAccount('Bob ')
    rememberButrauthAccount('ALICE', { incubation: true })
    expect(listButrauthAccounts()).toEqual([
      { name: 'alice', incubation: true },
      { name: 'bob', incubation: false },
    ])
  })

  it('keeps at most six', () => {
    for (let i = 0; i < 8; i++) rememberButrauthAccount(`u${i}`)
    const names = listButrauthAccounts().map((a) => a.name)
    expect(names).toEqual(['u7', 'u6', 'u5', 'u4', 'u3', 'u2'])
  })

  it('ignores an empty name', () => {
    rememberButrauthAccount('  ')
    rememberButrauthAccount(null)
    expect(listButrauthAccounts()).toEqual([])
  })

  it('forgets one account', () => {
    rememberButrauthAccount('alice')
    rememberButrauthAccount('bob')
    forgetButrauthAccount('ALICE')
    expect(listButrauthAccounts().map((a) => a.name)).toEqual(['bob'])
  })

  it('survives corrupt or foreign storage and stores no extra fields', () => {
    localStorage.setItem('butrauth_accounts', 'garbage')
    expect(listButrauthAccounts()).toEqual([])
    localStorage.setItem('butrauth_accounts', JSON.stringify({ name: 'x' }))
    expect(listButrauthAccounts()).toEqual([])
    localStorage.setItem('butrauth_accounts', JSON.stringify([null, { name: '' }, { name: 5 }, { name: 'ok', token: 'secret' }]))
    expect(listButrauthAccounts()).toEqual([{ name: 'ok', incubation: false }])
  })
})
