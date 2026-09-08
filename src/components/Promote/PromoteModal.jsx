import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { Rocket, X } from 'lucide-react';
import { CHECKER_URL, CHECKER_API_KEY } from '../../utils/config';
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { fetchBalances } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
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
    setFreshUntil(promotedUntil || null);
    setBalances(null);
    axios.get(`${CHECKER_URL}/promote/quote`)
      .then(res => { if (!cancelled && res.data?.success) setQuote(res.data); })
      .catch(() => { if (!cancelled) toast.error('Could not load promotion pricing.'); });
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
  }, [open, author, permlink, promotedUntil, me]);

  const maxDays = quote?.maxDays || 7;
  const costHbd = useMemo(() => (quote ? days * quote.costPer24hHbd : 0), [quote, days]);
  const costHive = useMemo(() => (quote?.hbdPerHive ? costHbd / quote.hbdPerHive : 0), [costHbd, quote]);
  const amount = currency === 'HBD' ? costHbd : costHive;

  const walletBalance = balances ? (currency === 'HBD' ? balances.hbd : balances.hive) : null;
  const insufficient = walletBalance != null && amount > 0 && amount > walletBalance;

  if (!open) return null;

  const handlePromote = async () => {
    if (!isLoggedIn()) { toast.error('Please log in to promote.'); return; }
    if (!quote) return;
    if (insufficient) { toast.error(`Not enough ${currency} — your balance is ${walletBalance.toFixed(3)} ${currency}.`); return; }
    setBusy(true);
    try {
      const memo = `promote:${author}/${permlink}`;
      await transferWithAioha(quote.account, Number(amount.toFixed(3)), currency, memo);
      toast.message('Payment sent — verifying on-chain…');

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
        toast.success(`Promoted until ${new Date(credited.promotedUntil).toLocaleString()}`);
        onPromoted?.(credited.promotedUntil);
        onClose?.();
      } else {
        toast.info('Payment sent. It can take a moment to verify — your promotion will activate shortly.');
        onClose?.();
      }
    } catch (err) {
      const msg = err?.message || 'Promotion failed';
      if (!/cancel|reject|denied/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="promote-overlay" onClick={onClose}>
      <div className="promote-modal" onClick={e => e.stopPropagation()}>
        <button className="promote-modal__close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="promote-modal__head">
          <Rocket size={20} />
          <h3>Promote this video</h3>
        </div>

        {isActive ? (
          <div className="promote-active">
            <p>This video is already promoted until</p>
            <strong>{new Date(activeUntil).toLocaleString()}</strong>
            <p className="promote-muted">You can promote it again once the current promotion ends.</p>
          </div>
        ) : (
          <>
            <p className="promote-intro">
              A promoted video appears first in recommendations and in the home Promoted section.
              Pay with your own wallet — {quote ? quote.costPer24hHbd : '…'} HBD buys 24h.
            </p>

            <div className="promote-field">
              <label>Duration: <strong>{days} {days === 1 ? 'day' : 'days'}</strong></label>
              <input
                type="range" min={1} max={maxDays} step={1}
                value={days} onChange={e => setDays(Number(e.target.value))}
                disabled={busy}
              />
              <div className="promote-range-ends"><span>1d</span><span>{maxDays}d</span></div>
            </div>

            <div className="promote-field">
              <label>Pay with</label>
              <div className="promote-currency">
                <button className={currency === 'HBD' ? 'active' : ''} onClick={() => setCurrency('HBD')} disabled={busy}>HBD</button>
                <button className={currency === 'HIVE' ? 'active' : ''} onClick={() => setCurrency('HIVE')} disabled={busy}>HIVE</button>
              </div>
            </div>

            <div className="promote-total">
              <span>Total</span>
              <strong>{amount ? amount.toFixed(3) : '—'} {currency}</strong>
            </div>

            <div className="promote-balance">
              <span>Your balance</span>
              <span className={insufficient ? 'promote-balance--low' : ''}>
                {walletBalance != null ? `${walletBalance.toFixed(3)} ${currency}` : '…'}
              </span>
            </div>

            <button className="promote-cta" onClick={handlePromote} disabled={busy || !quote || insufficient}>
              {busy ? 'Processing…' : insufficient ? `Not enough ${currency}` : `Promote for ${amount ? amount.toFixed(3) : ''} ${currency}`}
            </button>
            <p className="promote-muted promote-foot">
              You'll sign a transfer to @{quote?.account || 'threespeakfund'} with your wallet (active key).
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
