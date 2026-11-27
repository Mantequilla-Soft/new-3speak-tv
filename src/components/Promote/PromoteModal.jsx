import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL, CHECKER_API_KEY, selfPromoEnabledFor } from '../../utils/config';
import { transferWithAioha, isLoggedIn, broadcastWithAioha } from '../../hive-api/aioha';
import { fetchBalances } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import { spendPoints, walletSigner } from '../../lib/pointsSpend';
import { usePointsInfo } from '../Wallet/channelPoints';
import { useHangoutOptional } from '../../context/HangoutContext';
import { formatNumber } from '../../i18n';
import AdWizardModal from './AdWizardModal';
import { Button, Segmented, Banner } from '../v2/ui';
import { cx } from '../v2/helpers';
import DialogShell, { SheetContext } from '../modal/DialogShell';
import usePostThumb from '../modal/usePostThumb';
import './PromoteModal.scss';

// Every toast from this module is headed "Promotion"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Promotion');

// The run-length tiles of 17c (1 day, 3 days, the longest allowed).
const DAY_TILES = [1, 3, 7];

// How long the price and the balance may take before the panel says they failed.
const LOAD_TIMEOUT_MS = 12000;
const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const id = setTimeout(() => reject(new Error('timeout')), ms);
  promise.then((v) => { clearTimeout(id); resolve(v); }, (e) => { clearTimeout(id); reject(e); });
});

// 3Speak Points are spent on the live server (hangouts), the session token
// comes from HangoutContext. Read at call time, so tests can stub it.
const pointsApi = () => (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/+$/, '');
const POINTS = 'POINTS';

/** The live server's points price `{ per24h, maxDays }`, or null when it has none. */
async function fetchPointsQuote(api, signal) {
  const r = await fetch(`${api}/points/promote/quote`, { signal });
  if (!r.ok) return null;
  const q = await r.json().catch(() => null);
  const per24h = Number(q?.per24h);
  return q?.enabled && per24h > 0 ? { per24h, maxDays: Number(q.maxDays) || 7 } : null;
}

/**
 * Promote a video by transferring HBD (or the HIVE equivalent) to the promotion
 * account, signed with the user's front-facing wallet via aioha. After the
 * transfer the checker verifies it on-chain and sets `promotedUntil`.
 *
 * Any logged-in user can promote any video (the memo identifies the video, not
 * the payer). Promotion is blocked while a promotion is already active.
 */
export default function PromoteModal({ open, onClose, author, permlink, promotedUntil, onPromoted }) {
  /* Two different things can be bought here and they are NOT variations of each
   * other: a boost moves this video up 3Speak's own feeds, an ad plays it inside
   * other people's playback and is paid for per second per day. One button, one
   * choice, rather than two buttons whose difference nobody can guess.
   *
   * null = the chooser. Reset every time the modal opens, so closing on the ad
   * wizard does not reopen into it. */
  const { t } = useTranslation();
  const [mode, setMode] = useState(null);
  const [quote, setQuote] = useState(null); // { account, costPer24hHbd, maxDays, hbdPerHive }
  const [pickedDays, setDays] = useState(1);
  const [pickedCurrency, setCurrency] = useState('HBD');
  const [busy, setBusy] = useState(false);
  const [freshUntil, setFreshUntil] = useState(promotedUntil || null);
  const [balances, setBalances] = useState(null); // { hbd, hive }
  // A price or balance that never arrives must not look like one still loading
  // (issue #580: both sat at "…" for good). Each load gives up after LOAD_TIMEOUT_MS
  // and the panel says so, with a Retry that bumps `attempt`.
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [balanceFailed, setBalanceFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The points price from the live server. null = no Points option: no live
  // server, its quote route is missing or failed, or points promotion is off.
  const [pointsQuote, setPointsQuote] = useState(null);
  const [pointsSlow, setPointsSlow] = useState(false);

  const { user: me, authenticated } = useAppStore();
  const hangout = useHangoutOptional();
  const post = usePostThumb(author, permlink, open);

  // Points need a signed-in account and a way to get its live server session.
  const pointsAvailable = !!(pointsQuote && me && authenticated && hangout?.retryLogin);
  const pointsInfo = usePointsInfo(open && pointsAvailable ? me : null);
  const pointsBalance = typeof pointsInfo?.balance === 'number' ? pointsInfo.balance : null;
  // What is paid with: a Points pick falls back to HBD once points are gone.
  const currency = pickedCurrency === POINTS && !pointsAvailable ? 'HBD' : pickedCurrency;
  const isPoints = currency === POINTS;

  const activeUntil = freshUntil ? new Date(freshUntil).getTime() : 0;
  const isActive = activeUntil > Date.now();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // With one thing to buy there is nothing to choose: straight to the boost.
    setFreshUntil(promotedUntil || null);
    setBalances(null);
    setQuoteFailed(false);
    setBalanceFailed(false);
    axios.get(`${CHECKER_URL}/promote/quote`, { timeout: LOAD_TIMEOUT_MS })
      .then(res => {
        if (cancelled) return;
        if (res.data?.success) setQuote(res.data); else setQuoteFailed(true);
      })
      .catch(() => { if (!cancelled) setQuoteFailed(true); });
    // Authoritative current status (blocks promoting while still active everywhere).
    if (author && permlink) {
      axios.get(`${CHECKER_URL}/promote/status/${author}/${permlink}`, { timeout: LOAD_TIMEOUT_MS })
        .then(res => { if (!cancelled && res.data?.success) setFreshUntil(res.data.promotedUntil || null); })
        .catch(() => {});
    }
    // Wallet balance of the logged-in payer. fetchBalances() answers undefined on
    // an error and has no deadline of its own (dhive fails over node by node).
    if (me) {
      withTimeout(fetchBalances(me), LOAD_TIMEOUT_MS)
        .then(b => {
          if (cancelled) return;
          if (b) setBalances({ hbd: b.hbd, hive: b.hive }); else setBalanceFailed(true);
        })
        .catch(() => { if (!cancelled) setBalanceFailed(true); });
    }
    return () => { cancelled = true; };
  }, [open, author, permlink, promotedUntil, me, attempt]);

  // The points price. Quietly nothing when the live server cannot sell it.
  useEffect(() => {
    const api = pointsApi();
    setPointsQuote(null);
    if (!open || !me || !api) return undefined;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LOAD_TIMEOUT_MS);
    fetchPointsQuote(api, ac.signal)
      .then((q) => { if (!ac.signal.aborted) setPointsQuote(q); })
      .catch(() => {})
      .finally(() => clearTimeout(timer));
    return () => { clearTimeout(timer); ac.abort(); };
  }, [open, me]);

  // A points balance that never arrives reads "–", not "…" for good (#580).
  useEffect(() => {
    setPointsSlow(false);
    if (!isPoints || pointsBalance != null) return undefined;
    const id = setTimeout(() => setPointsSlow(true), LOAD_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [isPoints, pointsBalance]);

  // The chooser resets when the modal opens, not on a Retry.
  useEffect(() => {
    if (open) setMode(selfPromoEnabledFor(me) ? null : 'boost');
  }, [open, me]);

  const maxDays = isPoints ? Math.min(pointsQuote.maxDays, quote?.maxDays || 7) : (quote?.maxDays || 7);
  // Fewer days may fit with points: the pick stays inside what fits.
  const days = Math.min(pickedDays, maxDays);
  const costHbd = useMemo(() => (quote ? days * quote.costPer24hHbd : 0), [quote, days]);
  const costHive = useMemo(() => (quote?.hbdPerHive ? costHbd / quote.hbdPerHive : 0), [costHbd, quote]);
  const costPoints = pointsQuote ? days * pointsQuote.per24h : 0;
  const amount = isPoints ? costPoints : currency === 'HBD' ? costHbd : costHive;

  const walletBalance = isPoints ? pointsBalance : balances ? (currency === 'HBD' ? balances.hbd : balances.hive) : null;
  const insufficient = walletBalance != null && amount > 0 && amount > walletBalance;

  if (!open) return null;

  // The wizard is its own modal, so hand the whole surface over rather than nesting
  // one dialog inside another.
  // Guarded here too, not only on the button: the wizard is beta-only
  if (mode === 'ad' && selfPromoEnabledFor(me)) {
    return <AdWizardModal open onClose={onClose} author={author} permlink={permlink} />;
  }

  const handlePromote = async () => {
    if (!isLoggedIn()) { toast.error(t('ads.promote.loginRequired')); return; }
    if (!quote) return;
    if (insufficient) { toast.error(t('ads.promote.notEnoughBalance', { currency, balance: walletBalance.toFixed(3) })); return; }
    setBusy(true);
    try {
      const memo = `promote:${author}/${permlink}`;
      await transferWithAioha(quote.account, Number(amount.toFixed(3)), currency, memo);
      toast.message(t('ads.promote.verifying'));

      // Verify + credit. Retry a few times: account history can lag a second or two.
      let credited = null;
      for (let i = 0; i < 5; i++) {
        await new Promise(r => setTimeout(r, i === 0 ? 2500 : 3000));
        try {
          const res = await axios.put(
            `${CHECKER_URL}/promote/claim`,
            { author, permlink },
            { headers: CHECKER_API_KEY ? { Authorization: `Bearer ${CHECKER_API_KEY}` } : {} },
          );
          if (res.data?.success && res.data.promotedUntil) { credited = res.data; break; }
        } catch { /* keep retrying */ }
      }

      if (credited) {
        toast.success(t('ads.promote.promotedUntil', { date: new Date(credited.promotedUntil).toLocaleString() }));
        onPromoted?.(credited.promotedUntil);
        onClose?.();
      } else {
        toast.info(t('ads.promote.paymentSentPending'));
        onClose?.();
      }
    } catch (err) {
      const msg = err?.message || t('ads.promote.failed');
      if (!/cancel|reject|denied/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  // Points: the live server burns them, then the checker extends promotedUntil.
  // Sign in there silently first (the @threespeak signature), then with the
  // wallet; a 428 asks the wallet to sign the burn, a 202 is followed until done.
  const handlePointsPromote = async () => {
    if (!me || !hangout?.retryLogin) { toast.error(t('ads.promote.loginRequired')); return; }
    if (insufficient) { toast.error(t('ads.promote.notEnoughPoints')); return; }
    setBusy(true);
    try {
      const token = (await hangout.retryLogin(me, { interactive: false }))
        || (await hangout.retryLogin(me, { interactive: true }));
      if (!token) { toast.error(t('ads.promote.pointsSignInFailed')); return; }
      const api = pointsApi();
      const outcome = await spendPoints({
        apiBaseUrl: api,
        url: `${api}/points/promote`,
        body: { author, permlink, days },
        headers: () => ({ Authorization: `Bearer ${token}` }),
        sign: walletSigner((ops) => broadcastWithAioha(ops, 'posting')),
        onPending: () => toast.message(t('ads.promote.pointsPending')),
      });

      if (!outcome.ok) {
        const byCode = {
          insufficient: t('ads.promote.notEnoughPoints'),
          ineligible: t('ads.promote.pointsIneligible'),
          timeout: t('ads.promote.pointsTimeout'),
        };
        if (outcome.code === 'sign' && /cancel|reject|denied/i.test(outcome.message || '')) return;
        toast.error(byCode[outcome.code] || outcome.message || t('ads.promote.failed'));
        return;
      }

      let until = outcome.body?.promotedUntil || null;
      if (!until) {
        // An older server that does not say: ask the checker.
        const s = await axios.get(`${CHECKER_URL}/promote/status/${author}/${permlink}`, { timeout: LOAD_TIMEOUT_MS }).catch(() => null);
        until = s?.data?.promotedUntil || null;
      }
      if (until && new Date(until).getTime() > Date.now()) {
        toast.success(t('ads.promote.promotedUntil', { date: new Date(until).toLocaleString() }));
        onPromoted?.(until);
      } else {
        toast.info(t('ads.promote.paymentSentPending'));
      }
      onClose?.();
    } catch (err) {
      const msg = err?.message || t('ads.promote.failed');
      if (!/cancel|reject|denied/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const showChoices = selfPromoEnabledFor(me);
  const points = (n) => t('ads.promote.pointsAmount', { count: n, n: formatNumber(n, { maximumFractionDigits: 0 }) });
  const money = (n) => (n ? n.toFixed(3) : quoteFailed ? '–' : '…');
  const balanceText = isPoints
    ? (pointsBalance != null ? points(pointsBalance) : pointsSlow ? '–' : '…')
    : walletBalance != null ? `${walletBalance.toFixed(3)} ${currency}` : balanceFailed ? '–' : '…';
  // The HBD price and the wallet balance do not matter to a points payment.
  const loadFailed = !isPoints && (quoteFailed || (balanceFailed && !balances));
  const currencyOptions = [{ value: 'HBD', label: 'HBD' }, { value: 'HIVE', label: 'HIVE' }];
  if (pointsAvailable) currencyOptions.push({ value: POINTS, label: t('ads.promote.pointsOption') });
  const buttonText = busy ? t('common.status.processing')
    : isPoints
      ? (insufficient ? t('ads.promote.notEnoughPoints') : t('ads.promote.promoteForPoints', { amount: points(costPoints) }))
      : insufficient ? t('ads.promote.notEnough', { currency }) : t('ads.promote.promoteFor', { amount: amount ? amount.toFixed(3) : '', currency });
  const dayTiles = [...new Set(DAY_TILES.map((d) => Math.min(d, maxDays)))];

  return (
    <DialogShell
      open
      onClose={onClose}
      side
      tone="accent"
      title={t('ads.promote.title')}
      width={420}
      className="promote-v2"
      footer={mode === 'boost' && !isActive ? (
        <>
          <div className={cx('dlg-note promote-v2__balance', insufficient && 'is-low')}>
            <span>{t('ads.promote.yourBalance')}: <span className="num">{balanceText}</span></span>
            {!isPoints && currency === 'HBD' && costHive > 0 && <span className="num">≈ {costHive.toFixed(3)} HIVE</span>}
            {!isPoints && currency === 'HIVE' && costHbd > 0 && <span className="num">≈ {costHbd.toFixed(3)} HBD</span>}
          </div>
          <Button
            variant="primary"
            size={48}
            block
            className="dlg-main"
            trailing="campaign"
            onClick={isPoints ? handlePointsPromote : handlePromote}
            disabled={busy || (!isPoints && !quote) || insufficient}
            loading={busy}
          >
            {buttonText}
          </Button>
        </>
      ) : null}
    >
      <SheetContext thumb={post.thumbnail} title={post.title || permlink} meta={author ? `@${author}` : undefined} />

      {/* Boost in feeds or run it as an ad (47d): two stacked choice rows,
          the picked one in an accent border and tint. */}
      {showChoices && (
        <div className="promote-v2__modes" role="radiogroup" aria-label={t('ads.promote.title')}>
          {[
            { id: 'boost', title: t('ads.promote.boostTitle'), sub: t('ads.promote.boostDesc') },
            // Beta testers only (selfPromoEnabledFor), even with ads public: it
            // sells at a testing price while in beta. Where those ads may SHOW is a
            // separate, server-side limit (AD_SELFPROMO_ALLOWED_OWNERS on the checker).
            { id: 'ad', title: t('ads.promote.adTitle'), sub: t('ads.promote.adDesc') },
          ].map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={mode === o.id} className={cx('promote-v2__tile', mode === o.id && 'is-on')} onClick={() => setMode(o.id)}>
              <b>{o.title}</b>
              <span>{o.sub}</span>
            </button>
          ))}
        </div>
      )}

      {mode !== null && isActive && (
        <Banner tone="info" icon="schedule" title={t('ads.promote.alreadyUntil')}>
          <span className="num">{new Date(activeUntil).toLocaleString()}</span>. {t('ads.promote.againLater')}
        </Banner>
      )}

      {mode === 'boost' && !isActive && loadFailed && (
        <Banner
          tone="warn"
          title={quoteFailed ? t('ads.promote.pricingFailed') : t('ads.promote.balanceFailed')}
          action={<Button variant="secondary" size={32} onClick={() => setAttempt((n) => n + 1)}>{t('common.actions.retry')}</Button>}
        />
      )}

      {mode === 'boost' && !isActive && (
        <div className="promote-v2__form">
          <div className="promote-v2__days" role="group" aria-label={t('ads.promote.duration', { count: days }).replace(/<\/?b>/g, '')}>
            {dayTiles.map((d) => {
              const cost = quote ? d * quote.costPer24hHbd : 0;
              const shown = currency === 'HBD' ? cost : (quote?.hbdPerHive ? cost / quote.hbdPerHive : 0);
              return (
                <button key={d} type="button" className={cx('promote-v2__day', days === d && 'is-on')} aria-pressed={days === d} disabled={busy} onClick={() => setDays(d)}>
                  <b className="num">{isPoints ? formatNumber(d * pointsQuote.per24h, { maximumFractionDigits: 0 }) : money(shown)}</b>
                  <span>{t('ads.promote.days', { count: d })} · {isPoints ? t('ads.promote.pointsOption') : currency}</span>
                </button>
              );
            })}
          </div>

          <div className="v2-slider">
            <input
              type="range" min={1} max={maxDays} step={1}
              value={days} onChange={e => setDays(Number(e.target.value))}
              disabled={busy}
              aria-label={t('ads.promote.duration', { count: days }).replace(/<\/?b>/g, '')}
            />
          </div>

          {/* The summary (47d): Duration · Pay with HBD | HIVE | Points, then the total. */}
          <div className="promote-v2__summary">
            <span><Trans i18nKey="ads.promote.duration" count={days} components={{ b: <b /> }} /></span>
            <span className="promote-v2__pay">
              <span className="promote-v2__dot" aria-hidden="true">·</span>
              {t('ads.promote.payWith')}
              <Segmented
                block={false}
                size={28}
                value={currency}
                onChange={(c) => !busy && setCurrency(c)}
                label={t('ads.promote.payWith')}
                options={currencyOptions}
              />
            </span>
            {/* Its own line: with three ways to pay it wraps anyway, and a wrapped
                line must not start with the dot. */}
            <span className="promote-v2__total">{t('ads.promote.total')} <b className="num">{isPoints ? points(costPoints) : `${money(amount)} ${currency}`}</b></span>
          </div>
          <p className="v2-meta-sm">{isPoints ? t('ads.promote.pointsNote') : t('ads.promote.signNote', { account: quote?.account || 'threespeakfund' })}</p>
        </div>
      )}
    </DialogShell>
  );
}
