// Resource Credit (RC) pre-flight check for uploads.
//
// Every Hive transaction burns Resource Credits. A brand-new / low-Hive-Power
// account can easily have too little RC to publish a post — and on 3Speak the
// post is the expensive part. We check this BEFORE the user uploads their video
// so they don't waste a long upload only to hit an "insufficient RC" failure at
// broadcast time.
//
// Who pays the RC? Embed posts are signed and broadcast by @threespeak via
// delegated posting authority, but Hive charges the RC to the account named in
// the operation's `required_posting_auths` — i.e. the comment *author* (the
// user), NOT the signer. So the user's own RC is exactly what we must check.
//
// "How much does a post cost?" RC prices float with chain congestion, so rather
// than hard-coding a number we estimate it live from the chain's rc_api resource
// params + pools using the same cost curve the blockchain uses, for a
// representative 3Speak post (comment + comment_options + custom_json). The
// result is cached for the session. `VITE_POST_RC_COST` pins it manually.

import { getHiveClient } from './hiveNode';
import { POST_RC_COST } from './config';
import { t, getLanguage } from '../i18n';

const client = getHiveClient();

// Hive regenerates a full RC manabar over 5 days.
const RC_REGEN_SECONDS = 5 * 24 * 60 * 60; // 432000

// Fallback if the live cost estimate can't be fetched.
//
// CALIBRATION ANCHOR: every Hive account starts with a `max_rc_creation_adjustment`
// of ~4.88B RC even with zero Hive Power, and that base grant is demonstrably
// enough to publish a post (e.g. @trappist1e — whose entire max_rc IS the 4.88B
// grant — has posted comments). So a single post costs WELL under 4.88B, and our
// required-RC threshold must sit comfortably below it or we'd wrongly block every
// low-HP / new account. Realistic resource counts put a comment at ~1.8B; with a
// small margin we require ~2.2B.
const FALLBACK_POST_RC_COST = 2.2e9;

// Representative resource counts for a single 3Speak post transaction. The
// dominant, chain-condition-sensitive part is captured by the live pool/curve
// params below; the margin absorbs the rest. (history_bytes dominates — it's the
// serialized op size; state_bytes for a comment is small. An earlier guess of
// state=2,000,000 was ~10x too high and inflated the estimate above the 4.88B
// new-account floor, falsely blocking low-HP users.)
const REPRESENTATIVE_COUNTS = {
  resource_history_bytes: 1500,   // ~serialized size of comment + comment_options
  resource_state_bytes: 200_000,  // new comment object state growth (scaled)
  resource_execution_time: 300_000,
};
const SAFETY_MARGIN = 1.2;

// The chain's cost curve for one resource:
//   num = ((rc_regen * coeff_a) >> shift) + 1; cost = (num * count) / (pool + coeff_b) + 1
function costOfResource(curve, poolVal, count, rcRegen) {
  if (count <= 0n) return 0n;
  const a = BigInt(curve.coeff_a);
  const b = BigInt(curve.coeff_b);
  const shift = BigInt(curve.shift);
  let num = (rcRegen * a) >> shift;
  num += 1n;
  num *= count;
  const den = BigInt(poolVal) + b;
  return num / den + 1n;
}

let _cachedCost = null;
let _cachedCostAt = 0;
const COST_CACHE_MS = 10 * 60 * 1000; // params drift slowly; refresh every 10 min

/**
 * Estimate the RC cost of publishing one post, live from the chain.
 * Returns a Number (raw RC units). Falls back to a constant on any error.
 */
export async function estimatePostRcCost() {
  if (POST_RC_COST && POST_RC_COST > 0) return POST_RC_COST;

  const now = Date.now();
  if (_cachedCost && now - _cachedCostAt < COST_CACHE_MS) return _cachedCost;

  try {
    const [params, pool, dgpo] = await Promise.all([
      client.call('rc_api', 'get_resource_params', {}),
      client.call('rc_api', 'get_resource_pool', {}),
      client.database.getDynamicGlobalProperties(),
    ]);

    // rc_regen = total_vesting_shares.amount / (RC_REGEN_TIME / BLOCK_INTERVAL)
    //          = total_vesting_shares.amount / (432000 / 3) = / 144000
    const tvsAmount = BigInt(dgpo.total_vesting_shares.split(' ')[0].replace('.', ''));
    const rcRegen = tvsAmount / 144000n;

    let total = 0n;
    for (const [name, count] of Object.entries(REPRESENTATIVE_COUNTS)) {
      const curve = params.resource_params[name].price_curve_params;
      const poolVal = pool.resource_pool[name].pool;
      total += costOfResource(curve, poolVal, BigInt(count), rcRegen);
    }

    const estimate = Math.ceil(Number(total) * SAFETY_MARGIN);
    if (Number.isFinite(estimate) && estimate > 0) {
      _cachedCost = estimate;
      _cachedCostAt = now;
      return estimate;
    }
  } catch (err) {
    console.warn('[rcCheck] live post-cost estimate failed; using fallback', err);
  }
  return FALLBACK_POST_RC_COST;
}

/**
 * Fetch the user's current RC, accounting for regeneration since last update.
 * Returns { currentMana, maxRc, regenPerSecond, percentage } or null on error.
 */
export async function getRcStatus(username) {
  try {
    const data = await client.call('rc_api', 'find_rc_accounts', { accounts: [username] });
    const acct = data?.rc_accounts?.[0];
    if (!acct) return null;

    const maxRc = Number(acct.max_rc);
    const lastMana = Number(acct.rc_manabar.current_mana);
    const lastUpdate = Number(acct.rc_manabar.last_update_time); // unix seconds
    const nowSec = Math.floor(Date.now() / 1000);

    const regenPerSecond = maxRc / RC_REGEN_SECONDS;
    const elapsed = Math.max(0, nowSec - lastUpdate);
    const currentMana = Math.min(maxRc, lastMana + elapsed * regenPerSecond);

    return {
      currentMana,
      maxRc,
      regenPerSecond,
      percentage: maxRc > 0 ? (currentMana / maxRc) * 100 : 0,
    };
  } catch (err) {
    console.warn('[rcCheck] getRcStatus failed', err);
    return null;
  }
}

/**
 * Check whether `username` has enough RC to publish a post right now.
 *
 * Returns:
 *   {
 *     ok: boolean,             // enough RC to post now (true if we couldn't check — fail open)
 *     unknown: boolean,        // true when the RC status couldn't be fetched
 *     currentMana, maxRc, requiredRc, percentage,
 *     secondsUntilEnough,      // seconds of regen needed to reach requiredRc (0 if ok)
 *     canEverAfford,           // false when even a full RC bar < requiredRc (needs more HP)
 *   }
 */
export async function checkPostingRc(username) {
  const [status, requiredRc] = await Promise.all([
    getRcStatus(username),
    estimatePostRcCost(),
  ]);

  // Fail OPEN: if we can't read the user's RC, don't block the upload — the
  // broadcast still has its own error handling downstream.
  if (!status) {
    return { ok: true, unknown: true, requiredRc };
  }

  const { currentMana, maxRc, regenPerSecond, percentage } = status;
  const ok = currentMana >= requiredRc;
  const canEverAfford = maxRc >= requiredRc;
  const deficit = Math.max(0, requiredRc - currentMana);
  const secondsUntilEnough = ok
    ? 0
    : regenPerSecond > 0 && canEverAfford
      ? Math.ceil(deficit / regenPerSecond)
      : Infinity;

  return {
    ok,
    unknown: false,
    currentMana,
    maxRc,
    requiredRc,
    percentage,
    secondsUntilEnough,
    canEverAfford,
  };
}

/** Human-friendly duration, e.g. "about 2 hours 15 minutes" / "about 8 minutes". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return t('misc.duration.aMoment');
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  // Intl unit formatting: "2 days 3 hours" in English, localised elsewhere.
  const lang = getLanguage();
  const unit = (u, n) => new Intl.NumberFormat(lang, { style: 'unit', unit: u, unitDisplay: 'long' }).format(n);
  const parts = [];
  if (d) parts.push(unit('day', d));
  if (h) parts.push(unit('hour', h));
  if (m && !d) parts.push(unit('minute', m));
  if (!parts.length) return t('misc.duration.lessThanMinute');
  return new Intl.ListFormat(lang, { type: 'unit', style: 'narrow' }).format(parts);
}
