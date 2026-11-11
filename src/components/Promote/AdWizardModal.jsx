import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL } from '../../utils/config';
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { getOperationUser } from '../../hive-api/aioha';
import { fetchBalances } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import { Dialog, Button, IconButton, Segmented, Field, StepBar, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
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
  const { t } = useTranslation();
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
      .catch(() => { if (!cancelled) setOptions({ success: false, eligible: false, reason: t('ads.wizard.optionsFailed') }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    if (me) fetchBalances(me).then((b) => { if (!cancelled && b) setBalances({ hbd: b.hbd, hive: b.hive }); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open, me, author, permlink, t]);

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
  const refusal = !me ? t('ads.wizard.loginRequired') : (options?.reason || t('ads.wizard.notEligible'));
  const showLoading = loading && !!me;

  const pay = async () => {
    if (!isLoggedIn() && !me) { toast.error(t('common.status.loginRequired')); return; }
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
      if (!b?.success) throw new Error(b?.error || t('ads.wizard.bookingFailed'));

      const payAmount = currency === 'HBD' || !hbdPerHive ? b.totalHbd : b.totalHbd / hbdPerHive;
      await transferWithAioha(b.payTo, Number(payAmount.toFixed(3)), currency, b.memo);
      toast.message(t('ads.wizard.verifying'));

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
      const msg = err?.response?.data?.error || err?.message || t('ads.wizard.genericError');
      if (!/cancel|reject|denied/i.test(msg)) toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const back = () => setStep((s) => Math.max(1, s - 1));

  // "17 Nov": day and short month in the reader's locale.
  const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  // "Only on videos 2 to 30 minutes" (either end may be left empty).
  const lengthLine = minMinutes && maxMinutes ? t('ads.wizard.onlyOnVideos', { min: minMinutes, max: maxMinutes })
    : minMinutes ? t('ads.wizard.onlyOnVideosMin', { min: minMinutes })
      : maxMinutes ? t('ads.wizard.onlyOnVideosMax', { max: maxMinutes })
        : '';

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('ads.wizard.title')}
      closeLabel={t('common.actions.close')}
      width={480}
      className="adw-v2"
      leading={step > 1 && step < 4 && (
        <IconButton icon="arrow_back" size={32} variant="ghost" round label={t('common.actions.back')} onClick={back} className="adw-back" />
      )}
    >
      {step < 4 && <StepBar steps={3} current={step - 1} />}

      {showLoading && (
        <div className="adw-loading"><Icon name="progress_activity" size={20} className="v2-spin" /><span>{t('ads.wizard.checking')}</span></div>
      )}

      {!showLoading && !eligible && step < 4 && (
        <div className="v2-failure"><b>{refusal}</b></div>
      )}

      {!showLoading && eligible && step === 1 && (
        <>
          <p className="v2-meta">
            {t('ads.wizard.intro', { slogan: options.slogan || 'Content Creator on 3Speak' })}
          </p>
          <div className="v2-field">
            <span className="v2-eyebrow">{t('ads.wizard.whereRuns')}</span>
            <div className="adw-formats" role="radiogroup" aria-label={t('ads.wizard.whereRuns')}>
              {options.formats.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={format === f.key}
                  className={cx('adw-format', format === f.key && 'is-on')}
                  onClick={() => { setFormat(f.key); setSeconds(Math.min(seconds, f.maxSeconds)); }}
                >
                  <b>{f.key === 'shorts_roll' ? t('ads.wizard.shortsSpot') : t('ads.wizard.videoRoll')}</b>
                  <span>{f.key === 'shorts_roll' ? t('ads.wizard.shortsSpotDesc') : t('ads.wizard.videoRollDesc')}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="v2-slider">
            <div className="v2-slider__head">
              <span><Trans i18nKey="ads.wizard.howMuchPlays" values={{ seconds }} components={{ b: <b /> }} /></span>
            </div>
            <input
              type="range" min={1} max={fmt ? fmt.maxSeconds : 15} step={1}
              value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}
              aria-label={t('ads.wizard.spotLength')}
            />
            <span className="v2-meta-sm">{t('ads.wizard.openingSeconds', { count: seconds })}</span>
          </div>
          <Button variant="primary" size={48} block next onClick={() => setStep(2)} disabled={!format}>{t('common.actions.continue')}</Button>
        </>
      )}

      {!showLoading && eligible && step === 2 && (
        <>
          <Field
            id="adw-start"
            label={t('ads.wizard.startDate')}
            type="date"
            value={startAt}
            min={todayISO()}
            onChange={(e) => setStartAt(e.target.value)}
          />
          <div className="v2-slider">
            <div className="v2-slider__head">
              <span><Trans i18nKey="ads.wizard.runFor" count={days} components={{ b: <b /> }} /></span>
              <span className="num">{options.minDays || 1}–{options.maxDays || 90}d</span>
            </div>
            <input
              type="range" min={options.minDays || 1} max={options.maxDays || 90} step={1}
              value={days} onChange={(e) => setDays(Number(e.target.value))}
              aria-label={t('ads.wizard.runsFor')}
            />
          </div>
          <div className="v2-field">
            <span className="v2-eyebrow">{t('ads.wizard.onlyLength')} <span className="v2-field__opt">· {t('ads.wizard.optional')}</span></span>
            <div className="adw-minmax">
              <input className="v2-input" type="number" min="0" placeholder={t('ads.wizard.min')} aria-label={t('ads.wizard.min')} value={minMinutes} onChange={(e) => setMinMinutes(e.target.value)} />
              <span>{t('ads.wizard.to')}</span>
              <input className="v2-input" type="number" min="0" placeholder={t('ads.wizard.max')} aria-label={t('ads.wizard.max')} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} />
              <span className="adw-unit">{t('ads.wizard.minutes')}</span>
            </div>
            <span className="v2-field__hint">{t('ads.wizard.leaveEmpty')}</span>
          </div>
          <Button variant="primary" size={48} block next onClick={() => setStep(3)}>{t('common.actions.continue')}</Button>
        </>
      )}

      {!showLoading && eligible && step === 3 && (
        <>
          {/* One line (47d): what runs, then Start · Run for · Only on videos. */}
          <p className="adw-summary">
            <b>{format === 'shorts_roll' ? t('ads.wizard.shortsSpot') : t('ads.wizard.videoRoll')}</b>
            {' · '}<span className="num">{seconds}s</span>
            {' · '}{t('ads.wizard.starts')} {shortDate(startAt)}
            {' · '}<Trans i18nKey="ads.wizard.runFor" count={days} components={{ b: <b /> }} />
            {lengthLine ? <>{' · '}{lengthLine}</> : null}
          </p>
          <div className="adw-pay">
            <span className="v2-eyebrow">{t('ads.promote.payWith')}</span>
            <Segmented
              block={false}
              size={28}
              value={currency}
              onChange={(c) => { if (busy || (c === 'HIVE' && !hbdPerHive)) return; setCurrency(c); }}
              label={t('ads.promote.payWith')}
              options={[{ value: 'HBD', label: 'HBD' }, { value: 'HIVE', label: 'HIVE', disabled: busy || !hbdPerHive }]}
            />
            <span className={cx('adw-balance', insufficient && 'is-low')}>
              {t('ads.promote.yourBalance')}: <span className="num">{walletBalance != null ? `${walletBalance.toFixed(3)} ${currency}` : '…'}</span>
            </span>
          </div>
          <Button variant="primary" size={48} block className="is-next" trailing="payments" onClick={pay} disabled={busy || insufficient} loading={busy}>
            {busy ? t('ads.wizard.working') : insufficient ? t('ads.promote.notEnough', { currency }) : t('ads.wizard.pay', { amount: amount ? amount.toFixed(3) : '', currency })}
          </Button>
          <p className="v2-meta-sm">
            {t('ads.wizard.signNote', { account: options.payTo })}
          </p>
        </>
      )}

      {step === 4 && booked && (
        <div className="adw-done">
          <p className="adw-booked" role="status">
            <b>{t('ads.wizard.bookedTitle')}.</b>{' '}
            <span>{t('ads.wizard.withReviewers', { count: booked.days, date: shortDate(booked.startAt) })}</span>
          </p>
          {!booked.credited && (
            <p className="v2-meta-sm">
              {t('ads.wizard.paymentLag')}
            </p>
          )}
          {options?.limitedToOwners?.length > 0 && (
            <p className="v2-meta-sm">
              {t('ads.wizard.betaLimited', { owners: options.limitedToOwners.map((o) => `@${o}`).join(', ') })}
            </p>
          )}
          <Button variant="inverse" size={48} block trailing="check" onClick={onClose}>{t('common.actions.done')}</Button>
        </div>
      )}
    </Dialog>
  );
}
