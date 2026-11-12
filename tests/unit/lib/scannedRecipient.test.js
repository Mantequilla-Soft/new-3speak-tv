// A QR code scanned in the wallet's Send window (src/lib/scannedRecipient.js).
import { describe, it, expect } from 'vitest'
import { parseScannedRecipient, isAccountName } from '../../../src/lib/scannedRecipient.js'

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('parseScannedRecipient', () => {
  it('a plain account name, as 3Speak\'s Receive code holds it', () => {
    expect(parseScannedRecipient('badadib')).toEqual({ to: 'badadib' })
    expect(parseScannedRecipient('  @BadAdib ')).toEqual({ to: 'badadib' })
    expect(parseScannedRecipient('hive-116692')).toEqual({ to: 'hive-116692' })
    expect(parseScannedRecipient('some.name')).toEqual({ to: 'some.name' })
  })

  it('a profile or wallet link on 3Speak or another Hive front end', () => {
    expect(parseScannedRecipient('https://3speak.tv/@badadib')).toEqual({ to: 'badadib' })
    expect(parseScannedRecipient('https://3speak.tv/wallet/badadib')).toEqual({ to: 'badadib' })
    expect(parseScannedRecipient('https://peakd.com/@badadib/wallet')).toEqual({ to: 'badadib' })
    expect(parseScannedRecipient('https://hive.blog/@badadib')).toEqual({ to: 'badadib' })
    expect(parseScannedRecipient('https://3speak.tv/user/badadib')).toEqual({ to: 'badadib' })
  })

  it('a Hive transfer request: recipient, amount, coin and memo', () => {
    const op = ['transfer', { from: '__signer', to: 'badadib', amount: '1.500 HBD', memo: 'coffee' }]
    expect(parseScannedRecipient(`hive://sign/op/${b64url(op)}`)).toEqual({ to: 'badadib', amount: '1.500', coin: 'HBD', memo: 'coffee' })
  })

  it('a transfer request as a whole transaction, without an amount', () => {
    const tx = { operations: [['transfer', { from: '__signer', to: 'badadib', amount: '0.000 HIVE', memo: '' }]] }
    expect(parseScannedRecipient(`hive://sign/tx/${b64url(tx)}`)).toEqual({ to: 'badadib' })
  })

  it('anything that names no Hive account is null', () => {
    expect(parseScannedRecipient('')).toBe(null)
    expect(parseScannedRecipient('WIFI:S:home;T:WPA;P:secret;;')).toBe(null)
    expect(parseScannedRecipient('https://example.com/about')).toBe(null)
    expect(parseScannedRecipient('ab')).toBe(null) // too short
    expect(parseScannedRecipient('1badname')).toBe(null)
    expect(parseScannedRecipient('hive://sign/op/not-json')).toBe(null)
    expect(parseScannedRecipient(`hive://sign/op/${b64url(['vote', { voter: 'x' }])}`)).toBe(null)
    expect(parseScannedRecipient('ftp://3speak.tv/@badadib')).toBe(null)
  })

  it('account names follow Hive\'s rules', () => {
    expect(isAccountName('abc')).toBe(true)
    expect(isAccountName('a-very-long-name-x')).toBe(false) // 18 characters
    expect(isAccountName('ok.no')).toBe(false) // "no" is too short a part
  })
})
