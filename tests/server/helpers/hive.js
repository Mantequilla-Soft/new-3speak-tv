// Throwaway Hive keys and fixture accounts for the API tests. The keys come from
// fixed seeds, exist only here, and never touch a real Hive node: the server under
// test answers chain calls from the fixture file (see preload.cjs).
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

const require = createRequire(new URL('../../../server/', import.meta.url))
export const { PrivateKey, Signature, cryptoUtils } = require('@hiveio/dhive')

export const SERVICE_ACCOUNT = 'threespeak'
export const serviceKey = PrivateKey.fromSeed('3speak-api-tests:service-posting')

export function userKey(name) {
  return PrivateKey.fromSeed(`3speak-api-tests:${name}:posting`)
}

// A condenser_api account. `grant` gives @threespeak posting authority over it.
export function hiveAccount(name, { grant = true, threshold = 1, accountAuths = [], key = userKey(name) } = {}) {
  const auths = [...accountAuths]
  if (grant) auths.push([SERVICE_ACCOUNT, threshold])
  return {
    name,
    posting: {
      weight_threshold: threshold,
      account_auths: auths.sort(([a], [b]) => a.localeCompare(b)),
      key_auths: [[key.createPublic().toString(), threshold]],
    },
    posting_json_metadata: '',
    json_metadata: '',
  }
}

export function accounts(...list) {
  return Object.fromEntries(list.map((a) => [a.name, a]))
}

// The server's own wallet session token, "v1:<user>:<expMs>:<hmac>".
export function walletSession(secret, user, expMs = Date.now() + 60 * 60 * 1000) {
  const mac = crypto.createHmac('sha256', secret).update(`${user}:${expMs}`).digest('hex')
  return `v1:${user}:${expMs}:${mac}`
}

// What a wallet does for "Sign in with Hive": sign sha256(challenge) with the posting key.
export function signChallenge(key, challenge) {
  return key.sign(cryptoUtils.sha256(challenge)).toString()
}

// The public key that signed `message` (sha256 of its UTF-8 bytes).
export function signerOf(signature, message) {
  return Signature.fromString(signature).recover(cryptoUtils.sha256(Buffer.from(message, 'utf8'))).toString()
}
