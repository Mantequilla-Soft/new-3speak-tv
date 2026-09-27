// Centralised rules for the locked beneficiaries our publish flows
// inject (3Speak fund + remix attribution).
//
// Premium subscribers (3Speak Pro) skip the threespeakfund split — their
// monthly/yearly contribution covers what the 10% take normally funds.
// Non-premium uploads keep the standard 10% split.
//
// IMPORTANT: even premium users still attribute the original creator on
// remix/clip flows — that's an attribution split, not a platform fee.

export const LOCKED_FUND_ACCOUNT = 'threespeakfund';
export const LOCKED_FUND_PERCENT = 10;
export const LOCKED_FUND_WEIGHT = LOCKED_FUND_PERCENT * 100; // Hive uses 1/100ths of a percent

// Video-encoding split. Covers the cost of 3Speak's transcoding pipeline, so
// it only rides along on flows that actually encode video (embed uploads) —
// callers opt in with `includeEncoder: true`. Like the platform fund it's
// dropped for Pro subscribers, and where present it is locked (the UI renders
// it without a delete control and refuses to drop below `minPercent`).
export const LOCKED_ENCODER_ACCOUNT = 'encoder.pay';
export const LOCKED_ENCODER_PERCENT = 1;
export const LOCKED_ENCODER_WEIGHT = LOCKED_ENCODER_PERCENT * 100;

// Pro subscribers normally skip the encoder.pay split — EXCEPT this snapshot
// of the current Pro holders (pulled from the checker /premium list on
// 2026-06-13). These accounts keep paying the 1% encoder split even while
// premium. New Pro subscribers after this date are NOT here and skip it per
// the normal Pro rule. Lowercased Hive usernames.
export const ENCODER_PREMIUM_PAYERS = new Set([
  'ankalagonchik',
  'coolmole',
  'eddieespinod',
  'eddiespino',
  'eddiespinod',
  'joseamenac',
  'meno',
  'starkerz',
  'xvlad',
  'mantequilla-soft',
]);

/**
 * Whether the 1% encoder.pay split applies for this publish.
 * Only flows that actually encode video opt in (`includeEncoder`). Non-Pro
 * always pays; Pro pays only if grandfathered into ENCODER_PREMIUM_PAYERS.
 */
export function chargesEncoder({ isPremium, username, includeEncoder }) {
  if (!includeEncoder) return false;
  if (!isPremium) return true;
  return ENCODER_PREMIUM_PAYERS.has(String(username || '').toLowerCase());
}

export const REMIX_AUTHOR_PERCENT = 5;
export const REMIX_AUTHOR_WEIGHT = REMIX_AUTHOR_PERCENT * 100;
// A 3Speak creator whose sound (music library) is used in a short
export const SOUND_AUTHOR_PERCENT = 5;
export const SOUND_AUTHOR_WEIGHT = SOUND_AUTHOR_PERCENT * 100;

/**
 * Initial UI list of locked beneficiaries shown in the publish dialog.
 *
 *  - skips threespeakfund when `isPremium`
 *  - adds the 1% encoder split when `includeEncoder` and `chargesEncoder`
 *    (Pro skips it unless grandfathered — see ENCODER_PREMIUM_PAYERS)
 *  - always includes the remix-source author when `originalAuthor` is
 *    provided (remix attribution survives Pro)
 *  - and every 3Speak sound creator in `soundAuthors` (same rule)
 *
 * @returns {Array<{account, percent, locked, minPercent}>}
 */
export function getLockedBeneficiaries({ isPremium, originalAuthor, includeEncoder, username, soundAuthors = [] }) {
  const locked = [];
  if (!isPremium) {
    locked.push({
      account: LOCKED_FUND_ACCOUNT,
      percent: LOCKED_FUND_PERCENT,
      locked: true,
      minPercent: LOCKED_FUND_PERCENT,
    });
  }
  if (chargesEncoder({ isPremium, username, includeEncoder })) {
    locked.push({
      account: LOCKED_ENCODER_ACCOUNT,
      percent: LOCKED_ENCODER_PERCENT,
      locked: true,
      minPercent: LOCKED_ENCODER_PERCENT,
    });
  }
  if (originalAuthor) {
    locked.push({
      account: originalAuthor,
      percent: REMIX_AUTHOR_PERCENT,
      locked: true,
      minPercent: REMIX_AUTHOR_PERCENT,
    });
  }
  for (const account of soundAuthors) {
    const existing = locked.find(b => b.account === account);
    if (existing) {
      existing.percent = Math.max(existing.percent, SOUND_AUTHOR_PERCENT);
      existing.minPercent = Math.max(existing.minPercent, SOUND_AUTHOR_PERCENT);
      continue;
    }
    locked.push({
      account,
      percent: SOUND_AUTHOR_PERCENT,
      locked: true,
      minPercent: SOUND_AUTHOR_PERCENT,
    });
  }
  return locked;
}

/**
 * Publish-time enforcement: takes a Map<account, weight> built from the
 * user's chosen beneficiaries and ensures the locked entries are present
 * at their minimum weights — UNLESS the user is premium and the entry
 * is the platform fund (then we leave it out entirely so the user keeps
 * 100% of the rewards minus their other splits).
 *
 * Mutates `beneMap` in place and returns it for chaining.
 */
export function enforceLockedBeneficiaries(beneMap, { isPremium, originalAuthor, includeEncoder, username, soundAuthors = [] }) {
  if (!isPremium) {
    beneMap.set(
      LOCKED_FUND_ACCOUNT,
      Math.max(beneMap.get(LOCKED_FUND_ACCOUNT) || 0, LOCKED_FUND_WEIGHT),
    );
  } else {
    // Premium user — drop any inherited fund entry (e.g. from a stale
    // initial-state list that was created before their flag flipped).
    beneMap.delete(LOCKED_FUND_ACCOUNT);
  }
  // Encoder split is independent of the platform fund: non-Pro always pays,
  // and grandfathered Pro holders keep paying too.
  if (chargesEncoder({ isPremium, username, includeEncoder })) {
    beneMap.set(
      LOCKED_ENCODER_ACCOUNT,
      Math.max(beneMap.get(LOCKED_ENCODER_ACCOUNT) || 0, LOCKED_ENCODER_WEIGHT),
    );
  } else {
    beneMap.delete(LOCKED_ENCODER_ACCOUNT);
  }
  if (originalAuthor) {
    beneMap.set(
      originalAuthor,
      Math.max(beneMap.get(originalAuthor) || 0, REMIX_AUTHOR_WEIGHT),
    );
  }
  for (const account of soundAuthors) {
    beneMap.set(account, Math.max(beneMap.get(account) || 0, SOUND_AUTHOR_WEIGHT));
  }
  return beneMap;
}
