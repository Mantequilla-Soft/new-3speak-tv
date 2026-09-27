// Helpers for checking and granting an "authorized poster" on a user's
// posting authority. Used by the scheduled-posts flow: the @threespeak
// account needs to be in the user's posting account_auths so the server
// cron can broadcast posts on the user's behalf (signed with @threespeak's
// posting key — accepted because that key is now authorized for the user).

import { Client } from '@hiveio/dhive';
import { getHiveUrl } from './hiveNode';
import { broadcastWithAioha, KeyTypes, getCurrentProvider, Providers } from '../hive-api/aioha';
import { sortAuths } from '../hive-api/api';
import { encodeOps } from '@aioha/aioha/build/lib/hive-uri.js';

// HiveSigner can't broadcast active-key ops with its access token, so we open the
// HiveSigner sign window for the user to approve the account_update2 with their
// own active key (same flow aioha uses internally). `preWindow` is a window the
// caller opened synchronously on the user's click to dodge popup blockers; we
// navigate it to the sign URL. Resolves with the tx id once it closes (the app's
// hivesigner.html callback stores `hivesignerTxId` on a successful sign).
function signOpInHiveSignerWindow(op, preWindow) {
  return new Promise((resolve, reject) => {
    let signUrl;
    try {
      signUrl = encodeOps([op]).replace('hive://', 'https://hivesigner.com/') +
        `?redirect_uri=${encodeURIComponent(window.location.origin + '/hivesigner.html')}`;
    } catch (e) { reject(e); return; }
    const oldTxid = localStorage.getItem('hivesignerTxId');
    const w = preWindow || window.open(signUrl, '_blank');
    if (!w) { reject(new Error('Could not open HiveSigner — please allow popups and try again.')); return; }
    try { w.location.href = signUrl; } catch { /* fresh blank window — safe to navigate */ }
    const iv = setInterval(() => {
      if (w.closed) {
        clearInterval(iv);
        const txid = localStorage.getItem('hivesignerTxId');
        if (txid && txid !== oldTxid) resolve(txid);
        else reject(new Error('Authorization was not completed in HiveSigner.'));
      }
    }, 1000);
  });
}

const THREESPEAK_AUTHORITY = 'threespeak';

let _client;
function getClient() {
  if (!_client) _client = new Client(getHiveUrl());
  return _client;
}

async function fetchAccount(username) {
  const accounts = await getClient().database.getAccounts([username]);
  const account = accounts && accounts[0];
  if (!account) throw new Error(`Hive account @${username} not found`);
  return account;
}

/**
 * @returns {Promise<boolean>} true if @threespeak is in the user's posting account_auths.
 */
export async function hasThreespeakPostingAuth(username) {
  if (!username) return false;
  const account = await fetchAccount(username);
  const auths = (account.posting && account.posting.account_auths) || [];
  return auths.some(([acc]) => acc === THREESPEAK_AUTHORITY);
}

// Broadcast an account_update2 that swaps in `accountAuths` as the posting
// account_auths, keeping key auths and weight_threshold verbatim.
//
// account_update2 so it can be signed with the user's ACTIVE key (account_update
// would require the OWNER key, much scarier UX). Only the `posting` field is set;
// omitted fields are left untouched. extensions is required (empty).
async function updatePostingAccountAuths(username, account, accountAuths, opts) {
  const posting = account.posting || { weight_threshold: 1, account_auths: [], key_auths: [] };
  // Must stay sorted: the node re-sorts account_auths before computing the signing
  // digest, so appending 'threespeak' after e.g. 'travelfeed.app' makes the
  // signature match no key and fails as "Missing active authority".
  const newPosting = {
    weight_threshold: posting.weight_threshold,
    account_auths: sortAuths(accountAuths),
    key_auths: posting.key_auths || [],
  };
  const op = [
    'account_update2',
    {
      account: username,
      posting: newPosting,
      json_metadata: account.json_metadata || '',
      posting_json_metadata: account.posting_json_metadata || '',
      extensions: [],
    },
  ];

  // HiveSigner can't broadcast an active-key op with its access token — send the
  // user to HiveSigner to sign the account_update2 themselves.
  if (getCurrentProvider() === Providers.HiveSigner) {
    const txid = await signOpInHiveSignerWindow(op, opts.signWindow);
    return { tx: txid, viaHiveSigner: true };
  }

  const result = await broadcastWithAioha([op], KeyTypes.Active);
  if (!result || !result.success) {
    const reason = result?.error?.message || (typeof result?.error === 'string' && result.error);
    throw new Error(reason || 'Failed to update posting authority');
  }
  return { tx: result.result };
}

/**
 * Re-read the chain until @threespeak's presence matches `expected`, or give up.
 * A broadcast only lands in the next block (~3s) and the RPC node can lag behind
 * that, so a single read straight after it usually still sees the old authority.
 *
 * @returns {Promise<boolean>} the last state read (may still differ on timeout).
 */
export async function waitForThreespeakPostingAuth(username, expected, { timeoutMs = 30000, intervalMs = 2000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = !expected;
  for (;;) {
    try { last = await hasThreespeakPostingAuth(username); } catch { /* node hiccup, try again */ }
    if (last === expected || Date.now() >= deadline) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Add @threespeak to the user's posting account_auths, preserving the existing
 * authority structure (other auths, key auths, weight_threshold) verbatim.
 */
export async function addThreespeakToPostingAuth(username, opts = {}) {
  const weight = opts.weight || 1;
  const account = await fetchAccount(username);
  const auths = (account.posting && account.posting.account_auths) || [];

  // No-op (and don't pop a wallet) if it's already there.
  if (auths.some(([acc]) => acc === THREESPEAK_AUTHORITY)) {
    return { alreadyAuthorized: true };
  }

  const res = await updatePostingAccountAuths(
    username, account, [...auths, [THREESPEAK_AUTHORITY, weight]], opts,
  );
  return { alreadyAuthorized: false, ...res };
}

/**
 * Remove @threespeak from the user's posting account_auths. Everything else in
 * the posting authority is kept as it is.
 *
 * Refuses when @threespeak's weight alone is what meets the threshold (no key
 * or other account could sign posting ops afterwards). Hive rejects an
 * unsatisfiable authority anyway, but this gives a readable reason first.
 */
export async function removeThreespeakFromPostingAuth(username, opts = {}) {
  const account = await fetchAccount(username);
  const posting = account.posting || { weight_threshold: 1, account_auths: [], key_auths: [] };
  const auths = posting.account_auths || [];

  if (!auths.some(([acc]) => acc === THREESPEAK_AUTHORITY)) {
    return { notAuthorized: true };
  }

  const remaining = auths.filter(([acc]) => acc !== THREESPEAK_AUTHORITY);
  const remainingWeight = [...remaining, ...(posting.key_auths || [])]
    .reduce((sum, [, w]) => sum + Number(w || 0), 0);
  if (remainingWeight < posting.weight_threshold) {
    throw new Error('Removing @threespeak would leave your posting authority unable to sign. Add a posting key first.');
  }

  const res = await updatePostingAccountAuths(username, account, remaining, opts);
  return { notAuthorized: false, ...res };
}
