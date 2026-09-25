import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { Megaphone, X, ArrowLeft, Check, Loader2 } from 'lucide-react';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL } from '../../utils/config';
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { getOperationUser } from '../../hive-api/aioha';
import { fetchBalances } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import './AdWizardModal.scss';

// Every toast from this module is headed "Ads"; the message becomes the line under
// it. See utils/toast.js.
const toast = toastIn('Ads');

const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Run YOUR OWN video as a 3Speak ad.
 *
 * Four screens, because that is how many decisions there actually are: what it runs
 * as, when it runs, what it costs, and whether it worked. Everything else the ads
 * platform normally asks an advertiser — product name, logo, slogan, a spot to
 * upload — is answered from the channel and from the video itself, on the server.
 *
 * The flight is created only at the moment of payment, so an abandoned wizard leaves
 * nothing behind: no campaign, no advertiser record, nothing in anyone's queue.
 */
export default function AdWizardModal({ open, onClose, author, permlink }) {
  const { user } = useAppStore();
  const me = user || getOperationUser();

  const [step, setStep] = useState(1);
  const [options, setOptions] = useState(null);     // server's answer about THIS video
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState(null);
  const [seconds, setSeconds] = useState(15);
  const [days, setDays] = useState(7);
  const [startAt, setStartAt] = useState(todayISO());
  const [minMinutes, setMinMinutes] = useState('');
  const [maxMinutes, setMaxMinutes] = useState('');
  const [currency, setCurrency] = useState('HBD');
  const [balances, setBalances] = useState(null);
  const [busy, setBusy] = useState(false);
  const [booked, setBooked] = useState(null);       // what the server agreed to

  useEffect(() => {
    if (!open) return undefined;
    // Nothing to ask the server about without an account: the video has to be
    // theirs, so a signed-out request could only ever come back refused. The screen
    // says so on its own (see `refusal` below) — derived at render rather than
    // written into state here, which is both simpler and what stops this effect
    // cascading a render for a case that never needed the server.
    if (!me) return undefined;
    let cancelled = false;
    axios.get(`${CHECKER_URL}/advertise/selfpromo/options`, {
      params: { account: me, owner: author, permlink },
    })
      .then((res) => {
        if (cancelled) return;
        setOptions(res.data || null);
        const first = res.data?.formats?.[0];
        if (first) {
          setFormat(first.key);
          // Open on the longest spot the video can fill, capped at 15s: that is what
          // most people want and it saves a drag on the common path.
          setSeconds(Math.min(15, first.maxSeconds));
        }
      })
      .catch(() => { if (!cancelled) setOptions({ success: false, eligible: false, reason: 'We could not load ad options right now.' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (me) fetchBalances(me).then((b) => { if (!cancelled && b) setBalances({ hbd: b.hbd, hive: b.hive }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, me, author, permlink]);

  const fmt = useMemo(
    () => (options?.formats || []).find((f) => f.key === format) || null,
    [options, format],
  );

  // The same curve the server bills on (days^0.85), so the total on screen is the
  // total that gets charged. A quote computed a different way here would be a lie
  // the booking then corrects.
  const totalHbd = useMemo(() => {
    if (!fmt) return 0;
    return Math.round((days ** 0.85) * fmt.ratePerSecondDayHbd * seconds * 1000) / 1000;
  }, [fmt, days, seconds]);

  const hbdPerHive = options?.hbdPerHive || null;
  const amount = currency === 'HBD' || !hbdPerHive ? totalHbd : totalHbd / hbdPerHive;
  const walletBalance = balances ? (currency === 'HBD' ? balances.hbd : balances.hive) : null;
  const insufficient = walletBalance != null && amount > 0 && amount > walletBalance;

  if (!open) return null;

  const eligible = !!me && options?.eligible === true;
  // One place that answers "why can't I do this", whether the answer came from us
  // or from the server.
  const refusal = !me ? 'Log in to run your video as an ad.' : (options?.reason || 'This video cannot run as an ad.');
  const showLoading = loading && !!me;

  const pay = async () => {
    if (!isLoggedIn() && !me) { toast.error('Please log in first.'); return; }
    setBusy(true);
    try {
      // Book first: the campaign id is what the payment memo has to name, so there
      // is nothing to pay until the server has agreed to the flight.
      const res = await axios.post(`${CHECKER_URL}/advertise/selfpromo/book`, {
        account: me,
        owner: author,
        permlink,
        format,
        days,
        startAt,
        spotSeconds: seconds,
        minVideoSeconds: minMinutes ? Math.round(Number(minMinutes) * 60) : null,
        maxVideoSeconds: maxMinutes ? Math.round(Number(maxMinutes) * 60) : null,
      });
      const b = res.data;
      if (!b?.success) throw new Error(b?.error || 'Could not create the booking.');

      const payAmount = currency === 'HBD' || !hbdPerHive ? b.totalHbd : b.totalHbd / hbdPerHive;
      await transferWithAioha(b.payTo, Number(payAmount.toFixed(3)), currency, b.memo);
      toast.message('Payment sent, verifying on chain…');

      // Same retry shape as the promotion flow: account history lags a second or two.
      let credited = null;
      for (let i = 0; i < 5; i += 1) {
        await new Promise((r) => { setTimeout(r, i === 0 ? 2500 : 3000); });
        try {
          const claim = await axios.post(`${CHECKER_URL}/advertise/campaigns/${b.campaignId}/claim`, {});
          if (claim.data?.success) { credited = claim.data; break; }
        } catch { /* keep retrying */ }
      }
      setBooked({ ...b, credited: !!credited });
      setStep(4);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Something went wrong.';
      if (!/cancel|reject|denied/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const back = () => setStep((s) => Math.max(1, s - 1));

  return createPortal(
    <div className="adw-overlay" onClick={onClose}>
      <div className="adw-modal" onClick={(e) => e.stopPropagation()}>
        <button className="adw-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="adw-head">
          {step > 1 && step < 4 && (
            <button className="adw-back" onClick={back} aria-label="Back"><ArrowLeft size={16} /></button>
          )}
          <Megaphone size={18} />
          <h3>{step === 4 ? 'Your ad is booked' : 'Run this video as an ad'}</h3>
        </div>

        {step < 4 && (
          <div className="adw-steps" aria-hidden="true">
            {[1, 2, 3].map((n) => <span key={n} className={n === step ? 'on' : (n < step ? 'done' : '')} />)}
          </div>
        )}

        {showLoading && <div className="adw-loading"><Loader2 size={20} className="adw-spin" /><span>Checking this video…</span></div>}

        {!showLoading && !eligible && step < 4 && (
          <div className="adw-note">
            <p>{refusal}</p>
          </div>
        )}

        {!showLoading && eligible && step === 1 && (
          <>
            <p className="adw-intro">
              Your video plays as a paid spot across 3Speak. We use your channel for the
              advert itself: your display name, your avatar, and “{options.slogan || 'Content Creator on 3Speak'}”.
            </p>
            <div className="adw-field">
              <label>Where it runs</label>
              <div className="adw-formats">
                {options.formats.map((f) => (
                  <button
                    key={f.key}
                    className={`adw-format${format === f.key ? ' on' : ''}`}
                    onClick={() => { setFormat(f.key); setSeconds(Math.min(seconds, f.maxSeconds)); }}
                  >
                    <strong>{f.key === 'shorts_roll' ? 'Shorts spot' : 'Video roll'}</strong>
                    <span>{f.key === 'shorts_roll' ? 'Between shorts in the feed' : 'Inside other people’s videos'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="adw-field">
              <label>How much of it plays: <strong>{seconds}s</strong></label>
              <input
                type="range" min={1} max={fmt ? fmt.maxSeconds : 15} step={1}
                value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}
              />
              <p className="adw-hint">The opening {seconds} seconds of your video become the spot.</p>
            </div>
            <button className="adw-cta" onClick={() => setStep(2)} disabled={!format}>Continue</button>
          </>
        )}

        {!showLoading && eligible && step === 2 && (
          <>
            <div className="adw-field">
              <label htmlFor="adw-start">Start date</label>
              <input
                id="adw-start" type="date" value={startAt} min={todayISO()}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="adw-field">
              <label>Run for: <strong>{days} {days === 1 ? 'day' : 'days'}</strong></label>
              <input
                type="range" min={options.minDays || 1} max={options.maxDays || 90} step={1}
                value={days} onChange={(e) => setDays(Number(e.target.value))}
              />
              <div className="adw-ends"><span>{options.minDays || 1}d</span><span>{options.maxDays || 90}d</span></div>
            </div>
            <div className="adw-field">
              <label>Only on videos this long <span className="adw-optional">(optional)</span></label>
              <div className="adw-minmax">
                <input type="number" min="0" placeholder="min" value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} />
                <span>to</span>
                <input type="number" min="0" placeholder="max" value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} />
                <span className="adw-unit">minutes</span>
              </div>
              <p className="adw-hint">Leave both empty to run on everything.</p>
            </div>
            <button className="adw-cta" onClick={() => setStep(3)}>Continue</button>
          </>
        )}

        {!showLoading && eligible && step === 3 && (
          <>
            <div className="adw-summary">
              <div><span>Format</span><strong>{format === 'shorts_roll' ? 'Shorts spot' : 'Video roll'}</strong></div>
              <div><span>Spot length</span><strong>{seconds}s</strong></div>
              <div><span>Starts</span><strong>{new Date(startAt).toLocaleDateString()}</strong></div>
              <div><span>Runs for</span><strong>{days} {days === 1 ? 'day' : 'days'}</strong></div>
            </div>
            <div className="adw-field">
              <label>Pay with</label>
              <div className="adw-currency">
                <button className={currency === 'HBD' ? 'on' : ''} onClick={() => setCurrency('HBD')} disabled={busy}>HBD</button>
                <button className={currency === 'HIVE' ? 'on' : ''} onClick={() => setCurrency('HIVE')} disabled={busy || !hbdPerHive}>HIVE</button>
              </div>
            </div>
            <div className="adw-total">
              <span>Total</span>
              <strong>{amount ? amount.toFixed(3) : '—'} {currency}</strong>
            </div>
            <div className="adw-balance">
              <span>Your balance</span>
              <span className={insufficient ? 'low' : ''}>
                {walletBalance != null ? `${walletBalance.toFixed(3)} ${currency}` : '…'}
              </span>
            </div>
            <button className="adw-cta" onClick={pay} disabled={busy || insufficient}>
              {busy ? 'Working…' : insufficient ? `Not enough ${currency}` : `Pay ${amount ? amount.toFixed(3) : ''} ${currency}`}
            </button>
            <p className="adw-hint adw-foot">
              You sign one transfer to @{options.payTo} with your own wallet. Your ad goes
              live once we have checked the video.
            </p>
          </>
        )}

        {step === 4 && booked && (
          <div className="adw-done">
            <div className="adw-tick"><Check size={22} /></div>
            <p><strong>Payment {booked.credited ? 'confirmed' : 'sent'}.</strong></p>
            <p className="adw-hint">
              Your spot is with our reviewers. Once it is approved it runs
              {' '}{booked.days} {booked.days === 1 ? 'day' : 'days'} from
              {' '}{new Date(booked.startAt).toLocaleDateString()}.
            </p>
            {!booked.credited && (
              <p className="adw-hint">
                The payment can take a minute to show up on chain. Nothing else is needed from you.
              </p>
            )}
            {options?.limitedToOwners?.length > 0 && (
              <p className="adw-hint adw-beta">
                While self-promotion is in beta, these spots only appear on
                {' '}{options.limitedToOwners.map((o) => `@${o}`).join(', ')}’s content.
              </p>
            )}
            <button className="adw-cta" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
