/**
 * Utilities for interacting with VSC/Magi smart contracts via Aioha.
 *
 * - vscCallContract: calls a contract method (user signs via wallet)
 * - pollTxStatus: polls the VSC node until the tx is processed
 * - buildTransferIntent: creates a transfer.allow intent for pay_offer
 */

import aioha, { broadcastWithAioha, getOperationUser } from '../hive-api/aioha';
import { KeyTypes } from '@aioha/aioha';
import axios from 'axios';

// Network from env — defaults to mainnet
const VSC_NETWORK = import.meta.env.VITE_VSC_NETWORK || 'mainnet';
export const IS_VSC_TESTNET = VSC_NETWORK === 'testnet';
export const VSC_NET_ID = IS_VSC_TESTNET ? 'vsc-testnet' : 'vsc-mainnet';

// VSC GraphQL endpoints — overridable via env vars so we can point at
// staging / a different operator without a code change. Falls back to
// network-appropriate defaults when the env vars are unset.
const VSC_GRAPHQL = import.meta.env.VITE_VSC_GRAPHQL || (
  IS_VSC_TESTNET
    ? 'https://api-testnet.okinoko.io/api/v1/graphql'
    : 'https://api.okinoko.io/api/v1/graphql'
);

const HASURA_GRAPHQL = import.meta.env.VITE_VSC_HASURA_GRAPHQL || (
  IS_VSC_TESTNET
    ? 'https://api-testnet.okinoko.io/hasura/v1/graphql'
    : 'https://api.okinoko.io/hasura/v1/graphql'
);

// Hive L1 nodes — testnet uses a different RPC endpoint
export const HIVE_TESTNET_NODES = ['https://testnet.techcoderx.com'];
export const HIVE_TESTNET_URL = 'https://testnet.techcoderx.com';

// Contract ID for the Okinoko Subs contract — env-driven so the
// deployer can swap in a fresh contract address without rebuilding.
export const SUBS_CONTRACT_ID = import.meta.env.VITE_VSC_SUBS_CONTRACT_ID
  || 'vsc1BpkPNtC1pBLhxtNn4uE3QkLhudoyzAiXUi';

// Offer IDs configured on the subs contract. Numeric env values come
// in as strings; coerce with Number() and fall back to the current
// mainnet IDs so the page still loads if the env isn't set yet.
//
// Mainnet (current): two offers total —
//   - SUB_OFFER_ID = 5 — recurring subscription, monthly OR yearly
//     billing intervals are both selected against this same offer.
//   - ONETIME_OFFER_ID = 4 — single 1-day pass.
// (Older builds had a third offer slot; the contract dropped it when
// monthly/yearly were folded into a single offer with two intervals.)
export const SUB_OFFER_ID = Number(import.meta.env.VITE_VSC_SUB_OFFER_ID ?? 5);
export const ONETIME_OFFER_ID = Number(import.meta.env.VITE_VSC_ONETIME_OFFER_ID ?? 4);

// RC limit for contract calls
const DEFAULT_RC_LIMIT = 10000;

/**
 * Call a VSC contract method. The user signs via their connected wallet.
 *
 * @param {string} action - contract method name (e.g. 'pay_offer')
 * @param {string} payload - pipe-delimited payload string
 * @param {Array} intents - array of intent objects (e.g. transfer.allow)
 * @param {'posting'|'active'} keyType - key type to use
 * @returns {{ success: boolean, result: string, error?: string }}
 */
export async function callSubsContract(action, payload, intents = [], keyType = KeyTypes.Active) {
  // A Butter Auth session has no aioha user; it is the user_id login.
  const user = getOperationUser();
  if (!user) throw new Error('Not logged in');

  // Build the custom_json as a standard Hive L1 transaction
  const jsonPayload = JSON.stringify({
    net_id: VSC_NET_ID,
    contract_id: SUBS_CONTRACT_ID,
    action,
    payload,
    rc_limit: DEFAULT_RC_LIMIT,
    intents,
  });

  const op = ['custom_json', {
    required_auths: keyType === KeyTypes.Active ? [user] : [],
    required_posting_auths: keyType === KeyTypes.Posting ? [user] : [],
    id: 'vsc.call',
    json: jsonPayload,
  }];

  console.log('[vsc] callSubsContract L1 tx', { action, payload, intents, keyType, user });

  // Sign and broadcast as a normal Hive L1 transaction. broadcastWithAioha
  // hands a Butter Auth session's active op to the wallet sheet and shows
  // HiveAuth's waiting toast; it throws when the wallet refuses.
  const result = await broadcastWithAioha([op], keyType);

  if (!result?.success) {
    throw new Error(result?.error || 'Contract call failed');
  }

  return result;
}

/**
 * Build a transfer.allow intent for paying an offer.
 *
 * @param {string} amount - e.g. '5.000'
 * @param {'hive'|'hbd'} token
 * @returns {{ type: string, args: { limit: string, token: string } }}
 */
export function buildTransferIntent(amount, token = 'hive') {
  return {
    type: 'transfer.allow',
    args: {
      limit: typeof amount === 'number' ? amount.toFixed(3) : amount,
      token: token.toLowerCase(),
    },
  };
}

/**
 * Poll the VSC node for contract execution results.
 *
 * @param {string} txId - Hive transaction ID
 * @param {number} timeoutMs - max wait time (default 120s)
 * @returns {{ status: 'success'|'error'|'timeout', result: any }}
 */
export async function pollTxStatus(txId, timeoutMs = 120000, onProgress = null) {
  const query = `query FindContractOutput($filterOptions: ContractOutputFilter) {
    findContractOutput(filterOptions: $filterOptions) {
      id
      results { ok ret }
    }
  }`;

  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < timeoutMs) {
    attempt++;
    const elapsed = Math.round((Date.now() - start) / 1000);
    if (onProgress) onProgress({ attempt, elapsed });

    try {
      const resp = await axios.post(VSC_GRAPHQL, {
        query,
        variables: { filterOptions: { byInput: txId } },
      });

      const output = resp.data?.data?.findContractOutput?.[0];
      const result = output?.results?.[0];

      if (result) {
        const ok = result.ok === true || result.ok === 'true' || result.ok === 1;
        return { status: ok ? 'success' : 'error', result: result.ret };
      }
    } catch {
      // Ignore poll errors, keep trying
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  return { status: 'timeout', result: null };
}

/**
 * Query the subscription contract state via a getter method.
 * Getters are read-only and return the result in `ret`.
 *
 * @param {string} action - e.g. 'get_offer', 'get_subscription'
 * @param {string} payload - pipe-delimited args
 * @returns {string|null} the `ret` value from the contract
 */
export async function querySubsContract(action, payload) {
  aioha.vscSetNetId(VSC_NET_ID);

  const result = await aioha.vscCallContract(
    SUBS_CONTRACT_ID,
    action,
    payload,
    DEFAULT_RC_LIMIT,
    [],
    KeyTypes.Posting
  );

  if (!result?.success) {
    throw new Error(result?.error || 'Query failed');
  }

  // For getters, we need to poll for the result
  const txId = result.result;
  const pollResult = await pollTxStatus(txId);

  if (pollResult.status === 'success') {
    return pollResult.result;
  }

  throw new Error(pollResult.result || `Query ${pollResult.status}`);
}

/**
 * Parse a pipe-delimited key:value response from contract getters.
 * e.g. "id:1|provider:hive:creator|name:Pro Plan" → { id: '1', provider: 'hive:creator', name: 'Pro Plan' }
 */
export function parseContractResponse(raw) {
  if (!raw || typeof raw !== 'string') return {};
  const result = {};
  const parts = raw.split('|');
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx === -1) continue;
    const key = part.slice(0, colonIdx);
    const val = part.slice(colonIdx + 1);
    result[key] = val;
  }
  return result;
}

/**
 * Query Hasura GraphQL (testnet indexer).
 *
 * @param {string} query - GraphQL query string
 * @param {object} variables
 * @returns {object} data from the query
 */
export async function queryHasura(query, variables = {}) {
  const resp = await axios.post(HASURA_GRAPHQL, { query, variables });
  if (resp.data?.errors) {
    throw new Error(resp.data.errors[0]?.message || 'Hasura query failed');
  }
  return resp.data?.data;
}

/**
 * Fetch a user's VSC L2 balances (HIVE & HBD) from the VSC node.
 * Balances are returned in milliunits — divide by 1000 for display.
 *
 * @param {string} hiveUsername - bare username (no 'hive:' prefix)
 * @returns {{ hive: number, hbd: number }} balances in human-readable units
 */
export async function getVscBalance(hiveUsername) {
  const resp = await axios.post(VSC_GRAPHQL, {
    query: `{ getAccountBalance(account: "hive:${hiveUsername}") { hive hbd } }`,
  });
  const bal = resp.data?.data?.getAccountBalance;
  return {
    hive: (bal?.hive || 0) / 1000,
    hbd: (bal?.hbd || 0) / 1000,
  };
}

/**
 * Deposit funds from Hive L1 to VSC L2 by transferring to vsc.gateway.
 * On testnet the gateway account is also 'vsc.gateway'.
 * The memo must be "to=<hive_username>" so the VSC bridge credits the right account.
 *
 * This builds a Hive L1 transfer operation + the contract call in one transaction,
 * so the user only signs once.
 *
 * @param {string} amount - e.g. '5.000'
 * @param {'hive'|'hbd'} asset
 * @param {string} username - Hive username (the depositor)
 * @returns the deposit transfer operation (for bundling with contract calls)
 */
export function buildDepositOp(amount, asset, username) {
  // On testnet: HIVE → TESTS, HBD → TBD
  const l1Asset = IS_VSC_TESTNET
    ? (asset.toLowerCase() === 'hbd' ? 'TBD' : 'TESTS')
    : asset.toUpperCase();

  return ['transfer', {
    from: username,
    to: 'vsc.gateway',
    amount: `${amount} ${l1Asset}`,
    memo: `to=${username}`,
  }];
}

/**
 * Broadcast a combined deposit + contract call in a single Hive transaction.
 * The user signs once, and both the L1 transfer and the VSC call are included.
 *
 * @param {string} depositAmount - amount to deposit (e.g. '5.000')
 * @param {'hive'|'hbd'} depositAsset
 * @param {string} username
 * @param {string} action - contract method
 * @param {string} payload - contract payload
 * @param {Array} intents - transfer.allow intents
 * @returns {{ success: boolean, result: string }}
 */
export async function depositAndCallContract(depositAmount, depositAsset, username, action, payload, intents = []) {
  const depositOp = buildDepositOp(depositAmount, depositAsset, username);

  const contractOp = ['custom_json', {
    required_auths: [username],
    required_posting_auths: [],
    id: 'vsc.call',
    json: JSON.stringify({
      net_id: VSC_NET_ID,
      contract_id: SUBS_CONTRACT_ID,
      action,
      payload,
      rc_limit: DEFAULT_RC_LIMIT,
      intents,
    }),
  }];

  const result = await broadcastWithAioha([depositOp, contractOp], KeyTypes.Active);
  if (!result?.success) {
    throw new Error(result?.error || 'Broadcast failed');
  }
  return result;
}
