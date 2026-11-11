import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL, CHECKER_API_KEY, selfPromoEnabledFor } from '../../utils/config';
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { fetchBalances } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import AdWizardModal from './AdWizardModal';
import { Button, Segmented, Banner } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import DialogShell, { SheetContext } from '../modal/DialogShell';
import usePostThumb from '../modal/usePostThumb';
import './PromoteModal.scss';

// Every toast from this module is headed "Promotion"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Promotion');

// The run-length tiles of 17c (1 day, 3 days, the longest allowed).
const DAY_TILES = [1, 3, 7];

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
  const [days, setDays] = useState(1);
  const [currency, setCurrency] = useState('HBD');
  const [busy, setBusy] = useState(false);
  const [freshUntil, setFreshUntil] = useState(promotedUntil || null);
  const [balances, setBalances] = useState(null); // { hbd, hive }

  const { user: me } = useAppStore();
  const post = usePostThumb(author, permlink, open);

  const activeUntil = freshUntil ? new Date(freshUntil).getTime() : 0;
  const isActive = activeUntil > Date.now();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // With one thing to buy there is nothing to choose: straight to the boost.
    setMode(selfPromoEnabledFor(me) ? null : 'boost');
    setFreshUntil(promotedUntil || null);
    setBalances(null);
    axios.get(`${CHECKER_URL}/promote/quote`)
      .then(res => { if (!cancelled && res.data?.success) setQuote(res.data); })
      .catch(() => { if (!cancelled) toast.error(t('ads.promote.pricingFailed')); });
    // Authoritative current status (blocks promoting while still active everywhere).
    if (author && permlink) {
      axios.get(`${CHECKER_URL}/promote/status/${author}/${permlink}`)
        .then(res => { if (!cancelled && res.data?.success) setFreshUntil(res.data.promotedUntil || null); })
        .catch(() => {});
    }
    // Wallet balance of the logged-in payer.
    if (me) {
      fetchBalances(me)
        .then(b => { if (!cancelled && b) setBalances({ hbd: b.hbd, hive: b.hive }); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [open, author, permlink, promotedUntil, me, t]);

  const maxDays = quote?.maxDays || 7;
  const costHbd = useMemo(() => (quote ? days * quote.costPer24hHbd : 0), [quote, days]);
  const costHive = useMemo(() => (quote?.hbdPerHive ? costHbd / quote.hbdPerHive : 0), [costHbd, quote]);
  const amount = currency === 'HBD' ? costHbd : costHive;

  const walletBalance = balances ? (currency === 'HBD' ? balances.hbd : balances.hive) : null;
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

  const showChoices = selfPromoEnabledFor(me);
  const money = (n) => (n ? n.toFixed(3) : '…');
  const dayTiles = [...new Set(DAY_TILES.map((d) => Math.min(d, maxDays)))];

  return (
    <DialogShell
      open
      onClose={onClose}
      side
      tone="accent"
      title={t('watch.actions.promote')}
      width={420}
      className="promote-v2"
      footer={mode === 'boost' && !isActive ? (
        <>
          <div className={cx('dlg-note promote-v2__balance', insufficient && 'is-low')}>
            <span>{t('ads.promote.yourBalance')}: <span className="num">{walletBalance != null ? `${walletBalance.toFixed(3)} ${currency}` : '…'}</span></span>
            {currency === 'HBD' && costHive > 0 && <span className="num">≈ {costHive.toFixed(3)} HIVE</span>}
            {currency === 'HIVE' && costHbd > 0 && <span className="num">≈ {costHbd.toFixed(3)} HBD</span>}
          </div>
          <Button
            variant="primary"
            size={48}
            block
            className="dlg-main"
            trailing="campaign"
            onClick={handlePromote}
            disabled={busy || !quote || insufficient}
            loading={busy}
          >
            {busy ? t('common.status.processing') : insufficient ? t('ads.promote.notEnough', { currency }) : t('ads.promote.promoteFor', { amount: amount ? amount.toFixed(3) : '', currency })}
          </Button>
        </>
      ) : null}
    >
      <SheetContext thumb={post.thumbnail} title={post.title || permlink} meta={author ? `@${author}` : undefined} />

      {showChoices && (
        <div className="promote-v2__modes" role="radiogroup" aria-label={t('ads.promote.title')}>
          {[
            { id: 'boost', icon: 'trending_up', title: t('ads.promote.boostTitle'), sub: t('ads.promote.boostDesc') },
            // Beta testers only (selfPromoEnabledFor), even with ads public: it
            // sells at a testing price while in beta. Where those ads may SHOW is a
            // separate, server-side limit (AD_SELFPROMO_ALLOWED_OWNERS on the checker).
            { id: 'ad', icon: 'campaign', title: t('ads.promote.adTitle'), sub: t('ads.promote.adDesc') },
          ].map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={mode === o.id} className={cx('promote-v2__tile', mode === o.id && 'is-on')} onClick={() => setMode(o.id)}>
              <Icon name={o.icon} size={24} />
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

      {mode === 'boost' && !isActive && (
        <div className="promote-v2__form">
          <p className="v2-meta">
            {t('ads.promote.intro', { cost: quote ? quote.costPer24hHbd : '…' })}
          </p>

          <div className="promote-v2__days" role="group" aria-label={t('ads.promote.duration', { count: days }).replace(/<\/?b>/g, '')}>
            {dayTiles.map((d) => {
              const cost = quote ? d * quote.costPer24hHbd : 0;
              const shown = currency === 'HBD' ? cost : (quote?.hbdPerHive ? cost / quote.hbdPerHive : 0);
              return (
                <button key={d} type="button" className={cx('promote-v2__day', days === d && 'is-on')} aria-pressed={days === d} disabled={busy} onClick={() => setDays(d)}>
                  <b className="num">{money(shown)}</b>
                  <span>{t('ads.promote.days', { count: d })} · {currency}</span>
                </button>
              );
            })}
          </div>

          <div className="v2-slider">
            <div className="v2-slider__head">
              <span><Trans i18nKey="ads.promote.duration" count={days} components={{ b: <b /> }} /></span>
              <span className="num">{days} / {maxDays}</span>
            </div>
            <input
              type="range" min={1} max={maxDays} step={1}
              value={days} onChange={e => setDays(Number(e.target.value))}
              disabled={busy}
              aria-label={t('ads.promote.duration', { count: days }).replace(/<\/?b>/g, '')}
            />
          </div>

          <div className="promote-v2__total">
            <div className="promote-v2__total-head">
              <span>{t('ads.promote.total')}</span>
              <Segmented
                block={false}
                size={28}
                value={currency}
                onChange={(c) => !busy && setCurrency(c)}
                label={t('ads.promote.payWith')}
                options={[{ value: 'HBD', label: 'HBD' }, { value: 'HIVE', label: 'HIVE' }]}
              />
            </div>
            <b className="money">{money(amount)} <span>{currency}</span></b>
            <p className="v2-meta-sm">{t('ads.promote.signNote', { account: quote?.account || 'threespeakfund' })}</p>
          </div>
        </div>
      )}
    </DialogShell>
  );
}
