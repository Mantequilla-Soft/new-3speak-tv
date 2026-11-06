// Wallet names and signing prompts per login provider
// (src/utils/aiohaProviderUi.js), shown while the app waits for a signature.
import { describe, it, expect } from 'vitest'
import { Providers } from '@aioha/aioha'
import { friendlyProviderName, providerSignPrompt } from '../../../src/utils/aiohaProviderUi.js'

describe('friendlyProviderName', () => {
  it.each([
    [Providers.Keychain, 'Hive Keychain'],
    [Providers.HiveSigner, 'HiveSigner'],
    [Providers.Ledger, 'Ledger'],
    ['someNewWallet', 'someNewWallet'],
    [null, null],
  ])('%s -> %s', (provider, name) => {
    expect(friendlyProviderName(provider)).toBe(name)
  })
})

describe('providerSignPrompt', () => {
  it.each([
    [Providers.Keychain, 'Confirm the signing request via Hive Keychain'],
    [Providers.HiveAuth, 'Acknowledge the signing request via HiveAuth'],
    [Providers.PeakVault, 'Approve the signing request via PeakVault'],
    [Providers.ViewOnly, 'Confirm the signing request via View-only'],
    ['someNewWallet', 'Confirm the signing request via someNewWallet'],
  ])('%s asks: %s', (provider, prompt) => {
    expect(providerSignPrompt(provider)).toBe(prompt)
  })

  it('tells HiveSigner users to switch wallets, since it cannot sign messages', () => {
    expect(providerSignPrompt(Providers.HiveSigner)).toMatch(/can't sign .* switch to another wallet/)
  })

  it('waits generically when the provider is unknown', () => {
    expect(providerSignPrompt(undefined)).toBe('Waiting for your wallet to sign…')
  })
})
