import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { Rocket, X, Megaphone, ChevronRight } from 'lucide-react';
import { CHECKER_URL, CHECKER_API_KEY, selfPromoEnabledFor } from '../../utils/config';
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { fetchBalances } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import AdWizardModal from './AdWizardModal';
import './PromoteModal.scss';

// Every toast from this module is headed "Promotion"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Promotion');

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

  const activeUntil = freshUntil ? new Date(freshUntil).getTime() : 0;
  const isActive = activeUntil > Date.now();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMode(null);
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
        } catch (_) { /* keep retrying */ }
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

  return createPortal(
    <div className="promote-overlay" onClick={onClose}>
      <div className="promote-modal" onClick={e => e.stopPropagation()}>
        <button className="promote-modal__close" onClick={onClose} aria-label={t('common.actions.close')}><X size={18} /></button>
        <div className="promote-modal__head">
          <Rocket size={20} />
          <h3>{t('ads.promote.title')}</h3>
        </div>

        {mode === null ? (
          <div className="promote-choose">
            <button className="promote-choice" onClick={() => setMode('boost')}>
              <Rocket size={18} />
              <span>
                <strong>{t('ads.promote.boostTitle')}</strong>
                <em>{t('ads.promote.boostDesc')}</em>
              </span>
              <ChevronRight size={16} />
            </button>
            {/* Beta testers only (selfPromoEnabledFor), even with ads public: it
                sells at a testing price while in beta. Where those ads may SHOW is a
                separate, server-side limit (AD_SELFPROMO_ALLOWED_OWNERS on the checker). */}
            {selfPromoEnabledFor(me) && (
              <button className="promote-choice" onClick={() => setMode('ad')}>
                <Megaphone size={18} />
                <span>
                  <strong>{t('ads.promote.adTitle')}</strong>
                  <em>{t('ads.promote.adDesc')}</em>
                </span>
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        ) : isActive ? (
          <div className="promote-active">
            <p>{t('ads.promote.alreadyUntil')}</p>
            <strong>{new Date(activeUntil).toLocaleString()}</strong>
            <p className="promote-muted">{t('ads.promote.againLater')}</p>
          </div>
        ) : (
          <>
            <p className="promote-intro">
              {t('ads.promote.intro', { cost: quote ? quote.costPer24hHbd : '…' })}
            </p>

            <div className="promote-field">
              <label><Trans i18nKey="ads.promote.duration" count={days} components={{ b: <strong /> }} /></label>
              <input
                type="range" min={1} max={maxDays} step={1}
                value={days} onChange={e => setDays(Number(e.target.value))}
                disabled={busy}
              />
              <div className="promote-range-ends"><span>1d</span><span>{maxDays}d</span></div>
            </div>

            <div className="promote-field">
              <label>{t('ads.promote.payWith')}</label>
              <div className="promote-currency">
                <button className={currency === 'HBD' ? 'active' : ''} onClick={() => setCurrency('HBD')} disabled={busy}>HBD</button>
                <button className={currency === 'HIVE' ? 'active' : ''} onClick={() => setCurrency('HIVE')} disabled={busy}>HIVE</button>
              </div>
            </div>

            <div className="promote-total">
              <span>{t('ads.promote.total')}</span>
              <strong>{amount ? amount.toFixed(3) : '—'} {currency}</strong>
            </div>

            <div className="promote-balance">
              <span>{t('ads.promote.yourBalance')}</span>
              <span className={insufficient ? 'promote-balance--low' : ''}>
                {walletBalance != null ? `${walletBalance.toFixed(3)} ${currency}` : '…'}
              </span>
            </div>

            <button className="promote-cta" onClick={handlePromote} disabled={busy || !quote || insufficient}>
              {busy ? t('common.status.processing') : insufficient ? t('ads.promote.notEnough', { currency }) : t('ads.promote.promoteFor', { amount: amount ? amount.toFixed(3) : '', currency })}
            </button>
            <p className="promote-muted promote-foot">
              {t('ads.promote.signNote', { account: quote?.account || 'threespeakfund' })}
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
