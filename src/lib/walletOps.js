/**
 * The Hive wallet operations behind Wallet > Power, Savings, Convert and Delegate
 * (components/Wallet/WalletOpModal.jsx). Pure builders: each returns one
 * operation `[name, payload]` exactly as the chain wants it, ready for
 * broadcastWithAioha(ops, KeyTypes.Active). Every one of them needs the ACTIVE key.
 *
 * Assets: HIVE and HBD carry 3 decimals, VESTS 6. Hive Power is never sent as
 * such: powering down and delegating name VESTS, converted from the HP the person
 * typed with the chain's current HIVE per VESTS (dynamic global properties).
 */

export const POWER_DOWN_WEEKS = 13;
// HBD to HIVE takes 3.5 days at the median price over that time; HIVE to HBD
// pays HBD at once from half the HIVE (the rest is collateral, returned after
// 3.5 days) minus a 5% fee.
export const CONVERT_HOURS = 84;
export const COLLATERAL_FEE = 0.05;
export const SAVINGS_DAYS = 3;

const ACCOUNT_RE = /^[a-z][a-z0-9.-]{2,15}$/;
export const isAccountName = (s) => ACCOUNT_RE.test(String(s || ''));

// Rounded DOWN to the asset's precision, so a "Max" never asks for a fraction more
// than the balance holds.
function fixed(amount, digits) {
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error('bad_amount');
  const f = 10 ** digits;
  return (Math.floor(n * f + 1e-7) / f).toFixed(digits);
}

export const asset = (amount, symbol) => `${fixed(amount, symbol === 'VESTS' ? 6 : 3)} ${symbol}`;

function coin(symbol) {
  if (symbol !== 'HIVE' && symbol !== 'HBD') throw new Error('bad_currency');
  return symbol;
}

/** "12.345 HIVE" → { amount: 12.345, symbol: 'HIVE' }. */
export function parseAsset(s) {
  const [a, sym] = String(s || '').trim().split(/\s+/);
  return { amount: parseFloat(a) || 0, symbol: (sym || '').toUpperCase() };
}

/* ---------- HP and VESTS ---------- */

/** HIVE per VESTS from get_dynamic_global_properties. */
export function hivePerVests(dgp) {
  const fund = parseAsset(dgp?.total_vesting_fund_hive).amount;
  const shares = parseAsset(dgp?.total_vesting_shares).amount;
  return fund > 0 && shares > 0 ? fund / shares : 0;
}

export const vestsToHp = (vests, dgp) => Number(vests || 0) * hivePerVests(dgp);

export function hpToVests(hp, dgp) {
  const rate = hivePerVests(dgp);
  return rate > 0 ? Number(hp || 0) / rate : 0;
}

/**
 * A VESTS amount as a person reads it, for the signing summary (ActiveAuthModal):
 * "13.000 HP (26000.000000 VESTS)" at `rate` (hivePerVests), or the asset as it
 * is without a rate.
 */
export function vestsWithHp(vestsAsset, rate) {
  const { amount, symbol } = parseAsset(vestsAsset);
  if (symbol !== 'VESTS' || !(rate > 0)) return String(vestsAsset || '');
  return `${(amount * rate).toFixed(3)} HP (${vestsAsset})`;
}

/* ---------- Builders ---------- */

/** Power up: HIVE into Hive Power, for yourself or for another account. */
export function powerUpOp({ from, to, amount }) {
  return ['transfer_to_vesting', { from, to: to || from, amount: asset(amount, 'HIVE') }];
}

/** Power down `vests` over 13 weeks. 0 stops a running power down. */
export function powerDownOp({ account, vests }) {
  return ['withdraw_vesting', { account, vesting_shares: asset(vests, 'VESTS') }];
}

export const cancelPowerDownOp = ({ account }) => powerDownOp({ account, vests: 0 });

export function toSavingsOp({ from, to, amount, currency, memo = '' }) {
  return ['transfer_to_savings', { from, to: to || from, amount: asset(amount, coin(currency)), memo }];
}

/** Ask for savings back: arrives after 3 days. `requestId` names it for a cancel. */
export function fromSavingsOp({ from, to, amount, currency, memo = '', requestId }) {
  return ['transfer_from_savings', { from, request_id: requestId, to: to || from, amount: asset(amount, coin(currency)), memo }];
}

export function cancelSavingsWithdrawOp({ from, requestId }) {
  return ['cancel_transfer_from_savings', { from, request_id: requestId }];
}

/** HBD to HIVE, paid 3.5 days later at the median price of those days. */
export function convertOp({ owner, amount, requestId }) {
  return ['convert', { owner, requestid: requestId, amount: asset(amount, 'HBD') }];
}

/** HIVE to HBD at once (half the HIVE is collateral, returned after 3.5 days). */
export function collateralizedConvertOp({ owner, amount, requestId }) {
  return ['collateralized_convert', { owner, requestid: requestId, amount: asset(amount, 'HIVE') }];
}

/** Delegate `vests` to `delegatee`; it REPLACES any delegation between the two. 0 removes it. */
export function delegateOp({ delegator, delegatee, vests }) {
  return ['delegate_vesting_shares', { delegator, delegatee, vesting_shares: asset(vests, 'VESTS') }];
}

export const removeDelegationOp = ({ delegator, delegatee }) => delegateOp({ delegator, delegatee, vests: 0 });

/**
 * A request id (uint32) not used by any of `taken` (the ids of the account's
 * pending savings withdrawals, or of its conversions). Seconds since 1970 keep
 * it unique between tabs; a clash just counts up.
 */
export function newRequestId(taken = [], now = Date.now()) {
  const used = new Set(taken.map(Number));
  let id = Math.floor(now / 1000) >>> 0;
  while (used.has(id)) id = (id + 1) >>> 0;
  return id;
}

/* ---------- Estimates ---------- */

/** HBD a HIVE to HBD conversion of `hive` pays right away, at `hbdPerHive`. */
export function collateralizedEstimate(hive, hbdPerHive) {
  const n = Number(hive) || 0;
  return Math.max(0, (n / 2) * (Number(hbdPerHive) || 0) * (1 - COLLATERAL_FEE));
}

/** HIVE an HBD to HIVE conversion of `hbd` would pay at today's median. */
export const convertEstimate = (hbd, hbdPerHive) => (hbdPerHive > 0 ? (Number(hbd) || 0) / hbdPerHive : 0);

/* ---------- Reading the account ---------- */

const NEVER = Date.parse('1970-01-02T00:00:00Z');
const chainDate = (s) => (s ? new Date(/Z$/.test(s) ? s : `${s}Z`) : null);

/**
 * The running power down of an account (get_accounts row), or null: how much
 * HP each week pays, when the next payment comes, and what is left.
 */
export function powerDownOf(account, dgp) {
  if (!account) return null;
  const rate = parseAsset(account.vesting_withdraw_rate).amount;
  const next = chainDate(account.next_vesting_withdrawal);
  if (!(rate > 0) || !next || next.getTime() <= NEVER) return null;
  // to_withdraw and withdrawn are raw VESTS (6 implied decimals).
  const left = Math.max(0, (Number(account.to_withdraw) - Number(account.withdrawn)) / 1e6);
  return {
    weeklyHp: vestsToHp(Math.min(rate, left || rate), dgp),
    leftHp: vestsToHp(left, dgp),
    weeksLeft: Math.max(1, Math.ceil(left / rate - 1e-9)),
    next,
  };
}

/** Vesting the account owns and can still power down or delegate. */
export function freeVests(account) {
  if (!account) return 0;
  const own = parseAsset(account.vesting_shares).amount;
  const delegated = parseAsset(account.delegated_vesting_shares).amount;
  return Math.max(0, own - delegated);
}

/**
 * Vesting the account can delegate: the free VESTS minus what a running power
 * down still has to pay out, which Hive keeps back from a delegation.
 * to_withdraw and withdrawn are raw VESTS (6 implied decimals).
 */
export function delegatableVests(account) {
  if (!account) return 0;
  const poweringDown = Math.max(0, (Number(account.to_withdraw) || 0) - (Number(account.withdrawn) || 0)) / 1e6;
  return Math.max(0, freeVests(account) - poweringDown);
}

/** Pending savings withdrawals (get_savings_withdraw_from) in a plain shape. */
export const savingsWithdrawalsOf = (rows) => (rows || []).map((r) => ({
  requestId: r.request_id,
  to: r.to,
  ...parseAsset(r.amount),
  complete: chainDate(r.complete),
}));

/** Both kinds of conversion, soonest first. */
export function conversionsOf(hbdToHive, hiveToHbd) {
  return [
    ...(hbdToHive || []).map((r) => ({ kind: 'hbd', requestId: r.requestid, ...parseAsset(r.amount), date: chainDate(r.conversion_date) })),
    ...(hiveToHbd || []).map((r) => ({ kind: 'hive', requestId: r.requestid, ...parseAsset(r.collateral_amount), hbd: parseAsset(r.converted_amount).amount, date: chainDate(r.conversion_date) })),
  ].sort((a, b) => (a.date?.getTime() || 0) - (b.date?.getTime() || 0));
}

/** Outgoing delegations (get_vesting_delegations) with their HP. */
export const delegationsOf = (rows, dgp) => (rows || []).map((r) => {
  const vests = parseAsset(r.vesting_shares).amount;
  return { delegatee: r.delegatee, vests, hp: vestsToHp(vests, dgp), since: chainDate(r.min_delegation_time) };
});

/* ---------- Loading ---------- */

/**
 * Everything the wallet's Power / Savings / Convert / Delegate panels show, in
 * one round of reads: the account, the chain's HIVE per VESTS, the median price,
 * and the pending savings withdrawals, conversions and outgoing delegations.
 * `call(api, method, params)` is a dhive client's call (getHiveClient().call).
 */
export async function loadWalletState(call, account) {
  const safe = (p, fallback) => p.catch(() => fallback);
  const [accounts, dgp, median, savings, convHbd, convHive, delegations] = await Promise.all([
    call('condenser_api', 'get_accounts', [[account]]),
    call('condenser_api', 'get_dynamic_global_properties', []),
    safe(call('condenser_api', 'get_current_median_history_price', []), null),
    safe(call('condenser_api', 'get_savings_withdraw_from', [account]), []),
    safe(call('condenser_api', 'get_conversion_requests', [account]), []),
    safe(call('condenser_api', 'get_collateralized_conversion_requests', [account]), []),
    safe(call('condenser_api', 'get_vesting_delegations', [account, '', 100]), []),
  ]);
  const acct = accounts?.[0] || null;
  const base = parseAsset(median?.base).amount;
  const quote = parseAsset(median?.quote).amount;
  return {
    account: acct,
    dgp,
    hbdPerHive: base > 0 && quote > 0 ? base / quote : 0,
    hive: parseAsset(acct?.balance).amount,
    hbd: parseAsset(acct?.hbd_balance).amount,
    savingsHive: parseAsset(acct?.savings_balance).amount,
    savingsHbd: parseAsset(acct?.savings_hbd_balance).amount,
    hp: vestsToHp(parseAsset(acct?.vesting_shares).amount, dgp),
    freeHp: vestsToHp(freeVests(acct), dgp),
    freeVests: freeVests(acct),
    delegatableHp: vestsToHp(delegatableVests(acct), dgp),
    delegatableVests: delegatableVests(acct),
    delegatedHp: vestsToHp(parseAsset(acct?.delegated_vesting_shares).amount, dgp),
    receivedHp: vestsToHp(parseAsset(acct?.received_vesting_shares).amount, dgp),
    powerDown: powerDownOf(acct, dgp),
    withdrawals: savingsWithdrawalsOf(savings),
    conversions: conversionsOf(convHbd, convHive),
    delegations: delegationsOf(delegations, dgp),
  };
}
