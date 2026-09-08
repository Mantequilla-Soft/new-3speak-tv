import { useState, useEffect, useCallback } from 'react';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { isLoggedIn } from '../../hive-api/aioha';
import {
  callSubsContract,
  buildTransferIntent,
  pollTxStatus,
  queryHasura,
  getVscBalance,
  depositAndCallContract,
  SUBS_CONTRACT_ID,
  SUB_OFFER_ID,
  ONETIME_OFFER_ID,
} from '../../utils/vscContract';
import { KeyTypes } from '@aioha/aioha';
import { useHangout } from '../../context/HangoutContext';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import SubscriberTicker from '../SubscriberTicker/SubscriberTicker';
import './ThreeSpeakPro.scss';

// Every toast from this module is headed "Wallet"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Wallet');

const INTERVAL_LABELS = {
  daily: 'Daily',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

const INTERVAL_DURATIONS = {
  daily: '24 hours',
  monthly: '30 days',
  yearly: '365 days',
};

// Public-facing pricing shown whenever the on-chain offer data isn't
// loaded yet (no offer IDs configured / contract still being deployed).
// As soon as the env-driven offer IDs return real intervals, those win
// over this static map.
const STATIC_INTERVALS = {
  daily: 1,
  monthly: 10,
  yearly: 100,
};

// Display formatter: trims trailing zeros so 5.000 HBD renders as "5
// HBD", 5.500 as "5.5 HBD", 0.123 stays "0.123". Hive amounts on the
// wire still need .toFixed(3) — DON'T use this for buildTransferIntent
// payloads or deposit ops.
const AMOUNT_FMT = new Intl.NumberFormat('en', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});
function fmtAmount(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return AMOUNT_FMT.format(Number(n));
}

// Benefits listed at the top of the plans card so users see what
// they're getting before the price comparison.
const BENEFITS = [
  '1080p encoding (free tier stays at standard resolution)',
  'Priority encoding queue',
  'Priority automatic translation into 15 languages (10 more than standard)',
  'OpenPods audio & video session recordings (free tier is live-only)',
  'Higher upload limits (free tier remains capped)',
  'No beneficiary fee on uploads — keep 100% of your post rewards. The standard 11% (3Speak platform + encoder fee) is waived for subscribers.',
  'Additional benefits will follow automatically',
];

// Trial gating env. When VITE_ENABLE_PRO_TESTING=true the panel shows a
// "Try 3Speak Pro free for 24h" button — until the user claims it (once
// in their lifetime, tracked by embed-users.testing_started on the server).
const ENABLE_PRO_TESTING = import.meta.env.VITE_ENABLE_PRO_TESTING === 'true';
const HANGOUTS_API_URL = import.meta.env.VITE_HANGOUTS_API_URL || '';

/**
 * Formats a remaining-duration in ms into a short human string:
 *   23h 14m / 47m / 32s. Returns "expired" for non-positive values
 *   so the UI can switch back to the upgrade flow.
 */
function formatRemaining(ms) {
  if (ms <= 0) return 'expired';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Live-updating "trial active for X" banner. Polls only the local
 *  clock — server-side expiry is enforced separately (and a final
 *  re-check happens implicitly the next time usePremiumStatus refreshes). */
function TrialCountdown({ expiresAt }) {
  const expiryMs = expiresAt ? Date.parse(expiresAt) : NaN;
  const [remaining, setRemaining] = useState(() =>
    Number.isFinite(expiryMs) ? Math.max(0, expiryMs - Date.now()) : 0,
  );

  useEffect(() => {
    if (!Number.isFinite(expiryMs)) return undefined;
    const tick = () => setRemaining(Math.max(0, expiryMs - Date.now()));
    tick();
    // Tick every 30s — the banner reads in hours/minutes, sub-minute
    // precision isn't useful and saves us from re-rendering each second.
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [expiryMs]);

  if (!Number.isFinite(expiryMs)) return null;
  const expired = remaining <= 0;
  return (
    <div className={`tsp-trial-active${expired ? ' tsp-trial-active--expired' : ''}`}>
      <span className="tsp-trial-active-icon" aria-hidden="true">🚀</span>
      <span className="tsp-trial-active-text">
        {expired ? (
          <>Your 3Speak Pro trial has ended — pick a plan below to keep your perks.</>
        ) : (
          <>
            <strong>3Speak Pro trial active</strong> · {formatRemaining(remaining)} remaining
          </>
        )}
      </span>
    </div>
  );
}

function ThreeSpeakPro() {
  const { user, authenticated } = useAppStore();
  const loggedIn = authenticated && isLoggedIn();

  // VSC L2 balances
  const [vscBalances, setVscBalances] = useState({ hive: 0, hbd: 0 });

  // Offer data from the contract
  const [subOffer, setSubOffer] = useState(null);
  const [onetimeOffer, setOnetimeOffer] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [onetimePurchase, setOnetimePurchase] = useState(null);
  const [loadingOffer, setLoadingOffer] = useState(true);
  const [loadingSub, setLoadingSub] = useState(false);

  // UI state — selected plan: 'onetime' or an interval name like 'monthly'/'yearly'
  const [selectedPlan, setSelectedPlan] = useState('monthly');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [txStatus, setTxStatus] = useState(null); // { state: 'broadcasting'|'polling'|'done'|'error', msg }

  // Pro trial state — needs the hangouts session JWT for the authed
  // POST /premium/start-testing call. We also use usePremiumStatus to
  // hide the button after the user already claimed (testing_started
  // stays sticky for life).
  const { sessionToken, retryLogin } = useHangout();
  const premiumStatus = usePremiumStatus(user);
  const trialAlreadyUsed = !!premiumStatus?.testingStarted || !!premiumStatus?.premium;
  const [trialPending, setTrialPending] = useState(false);
  const showTrialButton = ENABLE_PRO_TESTING && loggedIn && !trialAlreadyUsed && !!HANGOUTS_API_URL;
  // Active trial banner: source==='testing' means the premium=true flag
  // came from the trial endpoint (vs a paid sub or manual flag).
  const isOnTrial = premiumStatus?.source === 'testing' && !!premiumStatus?.expiresAt;

  const startProTrial = useCallback(async () => {
    if (trialPending) return;
    setTrialPending(true);
    try {
      // Lazy-sign into Hangouts if the user hasn't done it yet — the
      // endpoint needs a Bearer JWT. retryLogin resolves to the token.
      let token = sessionToken;
      if (!token) {
        token = await retryLogin(user);
      }
      if (!token) {
        toast.error('Sign in to Hive Keychain to start the trial');
        return;
      }
      const resp = await fetch(`${HANGOUTS_API_URL.replace(/\/$/, '')}/premium/start-testing`, {
        method: 'POST',
        // No body — Fastify's JSON parser would reject Content-Type:
        // application/json with an empty payload, so we just send the
        // Authorization header and skip Content-Type entirely.
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data.ok) {
        toast.success('3Speak Pro trial active — enjoy it for the next 24h!');
        // Premium status is cached for 60s on the public read path; we
        // could optimistically flip locally, but a quick page refresh
        // is simpler than threading state into every consumer.
        setTimeout(() => window.location.reload(), 800);
      } else if (resp.status === 409) {
        toast.error('You have already used your one-time Pro trial.');
      } else if (resp.status === 403) {
        toast.error(data.message || 'Pro trial is not currently available.');
      } else {
        toast.error(data.message || `Trial failed (${resp.status})`);
      }
    } catch (err) {
      console.error('[ThreeSpeakPro] startProTrial failed:', err);
      toast.error('Could not reach the Pro trial service — try again in a moment.');
    } finally {
      setTrialPending(false);
    }
  }, [trialPending, sessionToken, retryLogin, user]);

  // Parse offer intervals from string "monthly=5.000,yearly=50.000"
  const parseIntervals = (intervalsStr) => {
    if (!intervalsStr) return {};
    const result = {};
    const pairs = intervalsStr.split(',');
    for (const pair of pairs) {
      const [interval, price] = pair.split('=');
      if (interval && price) {
        result[interval.trim()] = parseFloat(price);
      }
    }
    return result;
  };

  // Fetch both offers from Hasura (instant, no tx needed)
  const fetchOffer = useCallback(async () => {
    setLoadingOffer(true);
    try {
      const data = await queryHasura(`
        query {
          sub: oki_subs_offer_current(where: { id: { _eq: ${SUB_OFFER_ID} } }) {
            id name type state asset one_time intervals description
            total_subscribers active_subscribers
          }
          onetime: oki_subs_offer_current(where: { id: { _eq: ${ONETIME_OFFER_ID} } }) {
            id name type state asset one_time intervals description
          }
        }
      `);

      const sub = data?.sub?.[0];
      const ot = data?.onetime?.[0];

      if (sub) {
        setSubOffer(sub);
        const intervals = parseIntervals(sub.intervals);
        const first = Object.keys(intervals)[0];
        if (first && selectedPlan !== 'onetime') setSelectedPlan(first);
      }
      if (ot) setOnetimeOffer(ot);
    } catch (err) {
      console.error('Failed to fetch offers:', err);
    } finally {
      setLoadingOffer(false);
    }
  }, []);

  // Fetch user's subscription + one-time purchase status from Hasura
  const fetchSubscription = useCallback(async () => {
    if (!user) return;
    setLoadingSub(true);
    try {
      const data = await queryHasura(`
        query {
          oki_subs_subscription_current(where: {
            subscriber: { _eq: "hive:${user}" },
            offer_id: { _eq: ${SUB_OFFER_ID} }
          }) {
            subscriber offer_id interval balance next_billing_at status asset subscriber_index
          }
          oki_subs_onetime_paid_events(
            where: {
              buyer: { _eq: "hive:${user}" },
              id: { _eq: ${ONETIME_OFFER_ID} }
            },
            order_by: { indexer_ts: desc },
            limit: 1
          ) {
            id buyer amount asset indexer_ts
          }
        }
      `);

      const sub = data?.oki_subs_subscription_current?.[0];
      setSubscription(sub || null);

      const purchase = data?.oki_subs_onetime_paid_events?.[0];
      setOnetimePurchase(purchase || null);
    } catch (err) {
      console.log('No subscription found (normal for new users)');
      setSubscription(null);
      setOnetimePurchase(null);
    } finally {
      setLoadingSub(false);
    }
  }, [user]);

  const fetchBalance = useCallback(async () => {
    if (!user) return;
    try {
      const bal = await getVscBalance(user);
      setVscBalances(bal);
    } catch (err) {
      console.error('Failed to fetch VSC balance:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchOffer();
    if (loggedIn) {
      fetchSubscription();
      fetchBalance();
    }
  }, [fetchOffer, fetchSubscription, fetchBalance, loggedIn]);

  // When the on-chain offer hasn't been published yet (no offer IDs
  // configured), fall back to the static daily/monthly/yearly pricing
  // so the page can still preview what the plans will look like.
  const contractIntervals = subOffer ? parseIntervals(subOffer.intervals) : {};
  const intervals = Object.keys(contractIntervals).length > 0
    ? contractIntervals
    : STATIC_INTERVALS;
  const subAsset = subOffer?.asset || 'hbd';
  const subAssetUpper = subAsset.toUpperCase();
  const onetimePrice = onetimeOffer ? (parseFloat(onetimeOffer.one_time) || 0) : 0;
  const onetimeAsset = onetimeOffer?.asset || 'hive';
  const onetimeAssetUpper = onetimeAsset.toUpperCase();
  const isActive = subscription?.status === 'active';
  const currentBalance = subscription ? parseFloat(subscription.balance || '0') : 0;
  const currentInterval = subscription?.interval;
  const nextBilling = subscription?.next_billing_at ? new Date(parseInt(subscription.next_billing_at) * 1000) : null;
  const hasAnyOffer = subOffer || onetimeOffer;

  // One-time purchase: active for 24h after purchase timestamp
  const ONETIME_DURATION_MS = 24 * 60 * 60 * 1000;
  const onetimePurchaseTime = onetimePurchase?.indexer_ts
    ? new Date(onetimePurchase.indexer_ts + (onetimePurchase.indexer_ts.endsWith('Z') ? '' : 'Z'))
    : null;
  const onetimeExpiresAt = onetimePurchaseTime
    ? new Date(onetimePurchaseTime.getTime() + ONETIME_DURATION_MS)
    : null;
  const onetimeIsActive = onetimeExpiresAt ? onetimeExpiresAt > new Date() : false;
  const onetimeTimeLeft = onetimeExpiresAt ? Math.max(0, onetimeExpiresAt.getTime() - Date.now()) : 0;

  // Poll helper that updates txStatus with elapsed time
  const pollWithProgress = (txId) => {
    return pollTxStatus(txId, 120000, ({ elapsed }) => {
      setTxStatus({
        state: 'polling',
        msg: `Waiting for VSC confirmation… ${elapsed}s`,
      });
    });
  };

  /**
   * Determine how much L1 deposit is needed for a given price.
   * The contract has no free-floating balance — all funds are per-offer.
   * So we just check the Magi L2 balance and deposit the gap from L1.
   */
  const calcDepositNeeded = (price, asset) => {
    const l2 = vscBalances[asset.toLowerCase()] || 0;
    const remaining = price - l2;
    if (remaining <= 0) return 0;
    return Math.ceil(remaining * 1000) / 1000; // round up to 0.001
  };

  // Purchase: handles both one-time and subscription, with auto-deposit if needed
  const handlePurchase = async () => {
    if (!loggedIn || processing) return;

    const isOnetime = selectedPlan === 'onetime';
    const offerId = isOnetime ? ONETIME_OFFER_ID : SUB_OFFER_ID;
    const price = isOnetime ? onetimePrice : intervals[selectedPlan];
    const payAsset = isOnetime ? onetimeAsset : subAsset;
    if (!price) return;

    const depositNeeded = calcDepositNeeded(price, payAsset);

    setProcessing(true);
    setTxStatus({
      state: 'broadcasting',
      msg: depositNeeded > 0
        ? `Depositing ${fmtAmount(depositNeeded)} ${payAsset.toUpperCase()} to VSC and purchasing…`
        : 'Approve the transaction in your wallet…',
    });

    try {
      const intent = buildTransferIntent(price.toFixed(3), payAsset);
      const payload = isOnetime ? `${offerId}` : `${offerId}|${selectedPlan}`;
      let result;

      if (depositNeeded > 0) {
        result = await depositAndCallContract(
          depositNeeded.toFixed(3), payAsset, user, 'pay_offer', payload, [intent]
        );
      } else {
        result = await callSubsContract('pay_offer', payload, [intent]);
      }

      const pollResult = await pollWithProgress(result.result);

      if (pollResult.status === 'success') {
        const msg = isOnetime ? 'One-time purchase complete!' : 'Subscribed to 3Speak Pro!';
        setTxStatus({ state: 'done', msg });
        toast.success(msg);
        setTimeout(() => { fetchOffer(); fetchSubscription(); fetchBalance(); }, 3000);
      } else {
        setTxStatus({ state: 'error', msg: pollResult.result || 'Transaction failed' });
        toast.error(pollResult.result || 'Purchase failed');
      }
    } catch (err) {
      setTxStatus({ state: 'error', msg: err.message });
      toast.error(err.message || 'Purchase failed');
    } finally {
      setProcessing(false);
    }
  };

  // Top up prepaid balance (with auto-deposit if needed)
  const handleTopUp = async () => {
    if (!loggedIn || !isActive || processing) return;
    const amount = parseFloat(topUpAmount);
    if (!amount || amount <= 0) {
      toast.error('Enter a valid amount');
      return;
    }

    // For top-ups the contract balance is already locked (active sub), so
    // only check L2 balance → L1 deposit for the gap.
    const l2Balance = vscBalances[subAsset.toLowerCase()] || 0;
    const depositNeeded = l2Balance < amount
      ? Math.ceil((amount - l2Balance) * 1000) / 1000
      : 0;

    setProcessing(true);
    setTxStatus({
      state: 'broadcasting',
      msg: depositNeeded > 0
        ? `Depositing ${fmtAmount(depositNeeded)} ${subAssetUpper} to VSC and topping up…`
        : 'Approve the top-up in your wallet…',
    });

    try {
      const intent = buildTransferIntent(amount.toFixed(3), subAsset);
      const payload = `${SUB_OFFER_ID}|${currentInterval}`;
      let result;

      if (depositNeeded > 0) {
        result = await depositAndCallContract(
          depositNeeded.toFixed(3), subAsset, user, 'pay_offer', payload, [intent]
        );
      } else {
        result = await callSubsContract('pay_offer', payload, [intent]);
      }

      const pollResult = await pollWithProgress(result.result);

      if (pollResult.status === 'success') {
        setTxStatus({ state: 'done', msg: 'Balance topped up!' });
        toast.success('Balance topped up!');
        setTopUpAmount('');
        setTimeout(() => { fetchOffer(); fetchSubscription(); fetchBalance(); }, 3000);
      } else {
        setTxStatus({ state: 'error', msg: pollResult.result || 'Top-up failed' });
        toast.error(pollResult.result || 'Top-up failed');
      }
    } catch (err) {
      setTxStatus({ state: 'error', msg: err.message });
      toast.error(err.message || 'Top-up failed');
    } finally {
      setProcessing(false);
    }
  };

  // Cancel subscription
  const handleCancel = async () => {
    if (!loggedIn || !isActive || processing) return;

    setProcessing(true);
    setTxStatus({ state: 'broadcasting', msg: 'Approve cancellation in your wallet…' });

    try {
      const result = await callSubsContract(
        'cancel_subscription',
        `${SUB_OFFER_ID}`,
        []
      );

      const pollResult = await pollWithProgress(result.result);

      if (pollResult.status === 'success') {
        setTxStatus({ state: 'done', msg: 'Subscription canceled. Prepaid balance refunded.' });
        toast.success('Subscription canceled. Prepaid balance refunded.');
        setTimeout(() => { fetchOffer(); fetchSubscription(); fetchBalance(); }, 3000);
      } else {
        setTxStatus({ state: 'error', msg: pollResult.result || 'Cancellation failed' });
        toast.error(pollResult.result || 'Cancellation failed');
      }
    } catch (err) {
      setTxStatus({ state: 'error', msg: err.message });
      toast.error(err.message || 'Cancellation failed');
    } finally {
      setProcessing(false);
    }
  };

  if (!loggedIn) return null;

  return (
    <div className="tsp-container">
      <div className="tsp-header">
        <div className="tsp-header-text">
          <h2 className="tsp-title">
            <i className="fa-solid fa-crown" /> 3Speak Pro
          </h2>
          <p className="tsp-subtitle">Unlock premium features with a decentralized subscription</p>
        </div>
        {isActive && <span className="tsp-active-badge"><i className="fa-solid fa-check-circle" /> Active</span>}
      </div>

      {/* Magi L2 balance display removed (the vscBalances query is kept
          intact above — still fetched/used by the purchase + top-up flow). */}

      {/* Active subscribers ticker → click for the full list */}
      <SubscriberTicker />

      {/* Perks (left) + Try / Plans / Subscribe (right) — two columns on
          desktop, stacked on mobile. */}
      <div className="tsp-main-grid">
        <div className="tsp-perks-col">
          {/* Benefits — always visible even before the on-chain offers are live. */}
          <ul className="tsp-benefits">
        {BENEFITS.map((benefit) => (
          <li key={benefit} className="tsp-benefits-item">
            <i className="fa-solid fa-check" />
            <span>{benefit}</span>
          </li>
        ))}
          </ul>
        </div>

        <div className="tsp-plans-col">
          {/* Trial state — three mutually exclusive views:
          - Active trial: live countdown banner ("X hours remaining")
          - Trial available: the start-trial CTA button
          - Otherwise: nothing (paid sub, never eligible, env disabled, …) */}
      {isOnTrial ? (
        <TrialCountdown expiresAt={premiumStatus.expiresAt} />
      ) : showTrialButton ? (
        <div className="tsp-trial">
          <button
            type="button"
            className="tsp-trial-btn"
            onClick={startProTrial}
            disabled={trialPending}
          >
            {trialPending ? 'Starting trial…' : '🚀 Try 3Speak Pro free for 24h'}
          </button>
          <span className="tsp-trial-note">
            One-time trial — once you start it, your account is on Pro for the next 24 hours.
          </span>
        </div>
      ) : null}

      {loadingOffer ? (
        <div className="tsp-loading">
          <div className="tsp-skeleton" />
          <div className="tsp-skeleton tsp-skeleton-sm" />
        </div>
      ) : (
        <>
          {/* Coming-soon banner shown until the on-chain offers are
              configured. The plans below preview the planned pricing
              but the Subscribe button is disabled. */}
          {!hasAnyOffer && (
            <div className="tsp-coming-soon">
              <i className="fa-solid fa-clock" />
              <span>Subscription service is launching soon — pricing preview below.</span>
            </div>
          )}
          {/* Active one-time purchase */}
          {onetimeIsActive && onetimePurchase && (
            <div className="tsp-onetime-active">
              <div className="tsp-onetime-header">
                <i className="fa-solid fa-bolt" />
                <span>One-Time Access Active</span>
              </div>
              <div className="tsp-onetime-details">
                <div className="tsp-onetime-timer">
                  <i className="fa-regular fa-clock" />
                  <span>
                    {onetimeTimeLeft > 3600000
                      ? `${Math.floor(onetimeTimeLeft / 3600000)}h ${Math.floor((onetimeTimeLeft % 3600000) / 60000)}m remaining`
                      : onetimeTimeLeft > 60000
                        ? `${Math.floor(onetimeTimeLeft / 60000)}m remaining`
                        : 'Expiring soon'}
                  </span>
                </div>
                <div className="tsp-onetime-expires">
                  Expires {onetimeExpiresAt.toLocaleString()}
                </div>
              </div>
            </div>
          )}

          {/* Expired one-time purchase */}
          {onetimePurchase && !onetimeIsActive && (
            <div className="tsp-onetime-expired">
              <i className="fa-solid fa-clock-rotate-left" />
              <span>Your last one-time access expired on {onetimeExpiresAt?.toLocaleString()}</span>
            </div>
          )}

          {/* Active subscription info */}
          {isActive && subscription && (
            <div className="tsp-status">
              <div className="tsp-status-grid">
                <div className="tsp-status-item">
                  <span className="tsp-status-label">Plan</span>
                  <span className="tsp-status-value">{INTERVAL_LABELS[currentInterval] || currentInterval}</span>
                </div>
                <div className="tsp-status-item">
                  <span className="tsp-status-label">Prepaid Balance</span>
                  <span className="tsp-status-value tsp-balance">{fmtAmount(currentBalance)} {subAssetUpper}</span>
                </div>
                <div className="tsp-status-item">
                  <span className="tsp-status-label">Next Billing</span>
                  <span className="tsp-status-value">{nextBilling ? nextBilling.toLocaleDateString() : '—'}</span>
                </div>
                <div className="tsp-status-item">
                  <span className="tsp-status-label">Interval Price</span>
                  <span className="tsp-status-value">{fmtAmount(intervals[currentInterval])} {subAssetUpper}</span>
                </div>
              </div>

              {/* Top up */}
              <div className="tsp-topup">
                <label className="tsp-topup-label">Add funds to your prepaid balance</label>
                <div className="tsp-topup-row">
                  <input
                    type="number"
                    className="tsp-topup-input"
                    value={topUpAmount}
                    onChange={(e) => setTopUpAmount(e.target.value)}
                    placeholder={`Amount in ${subAssetUpper}`}
                    min="0.001"
                    step="0.001"
                    disabled={processing}
                  />
                  <button
                    className="tsp-topup-btn"
                    onClick={handleTopUp}
                    disabled={processing || !topUpAmount || parseFloat(topUpAmount) <= 0}
                  >
                    {processing ? <i className="fa-solid fa-spinner fa-spin" /> : <i className="fa-solid fa-plus" />}
                    Top Up
                  </button>
                </div>
              </div>

              {/* Cancel */}
              <button
                className="tsp-cancel-btn"
                onClick={handleCancel}
                disabled={processing}
              >
                <i className="fa-solid fa-xmark" /> Cancel Subscription
              </button>
            </div>
          )}

          {/* Plan selection (disabled when any offer is active) */}
          <div className={`tsp-plans${isActive || onetimeIsActive ? ' tsp-plans-disabled' : ''}`}>
            <p className="tsp-plans-label">Choose your plan:</p>
            <div className="tsp-plan-cards">
              {/* One-time offer — shown first */}
              {onetimeOffer && onetimeOffer.state === 'active' && (
                <div
                  className={`tsp-plan-card tsp-plan-onetime${selectedPlan === 'onetime' ? ' selected' : ''}`}
                  onClick={isActive || onetimeIsActive ? undefined : () => setSelectedPlan('onetime')}
                >
                  <span className="tsp-plan-name">One Time</span>
                  <span className="tsp-plan-price">{fmtAmount(onetimePrice)} {onetimeAssetUpper}</span>
                  {onetimeOffer.description && <span className="tsp-plan-desc">{onetimeOffer.description}</span>}
                </div>
              )}

              {/* Subscription intervals */}
              {Object.entries(intervals).map(([interval, price]) => (
                <div
                  key={interval}
                  className={`tsp-plan-card${selectedPlan === interval ? ' selected' : ''}`}
                  onClick={isActive || onetimeIsActive ? undefined : () => setSelectedPlan(interval)}
                >
                  {interval === 'yearly' && <span className="tsp-plan-badge">Save 2 months</span>}
                  <span className="tsp-plan-name">{INTERVAL_LABELS[interval] || interval}</span>
                  <span className="tsp-plan-price">{fmtAmount(price)} {subAssetUpper}</span>
                  <span className="tsp-plan-desc">{INTERVAL_DURATIONS[interval] || ''}</span>
                  {subOffer?.description && <span className="tsp-plan-desc">{subOffer.description}</span>}
                </div>
              ))}
            </div>

            <button
              className="tsp-subscribe-btn"
              onClick={handlePurchase}
              disabled={processing || !selectedPlan || isActive || onetimeIsActive || !hasAnyOffer}
              title={!hasAnyOffer ? 'On-chain offer not yet configured' : undefined}
            >
              {processing ? (
                <><i className="fa-solid fa-spinner fa-spin" /> Processing…</>
              ) : !hasAnyOffer ? (
                <><i className="fa-solid fa-clock" /> Coming Soon</>
              ) : selectedPlan === 'onetime' ? (
                <><i className="fa-solid fa-bolt" /> Buy 3Speak Pro</>
              ) : (
                <><i className="fa-solid fa-crown" /> Subscribe to 3Speak Pro</>
              )}
            </button>
          </div>

          {/* Transaction status */}
          {txStatus && (
            <div className={`tsp-tx-status tsp-tx-${txStatus.state}`}>
              {txStatus.state === 'broadcasting' && <i className="fa-solid fa-wallet" />}
              {txStatus.state === 'polling' && <i className="fa-solid fa-spinner fa-spin" />}
              {txStatus.state === 'done' && <i className="fa-solid fa-check-circle" />}
              {txStatus.state === 'error' && <i className="fa-solid fa-exclamation-circle" />}
              <span>{txStatus.msg}</span>
              {(txStatus.state === 'done' || txStatus.state === 'error') && (
                <button className="tsp-tx-dismiss" onClick={() => setTxStatus(null)}>
                  <i className="fa-solid fa-xmark" />
                </button>
              )}
            </div>
          )}
        </>
      )}
        </div>
      </div>
    </div>
  );
}

export default ThreeSpeakPro;
