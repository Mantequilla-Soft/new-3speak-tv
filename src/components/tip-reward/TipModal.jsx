import React, { useEffect, useId, useState } from 'react';
import Success from './Success';
import { useTranslation } from 'react-i18next';
import WalletTip from './WalletTip';
import MonthlyField from './MonthlyField';
import OtherWays, { useSupportLinks } from './OtherWays';
import './TipModal.scss';
import { fetchBalances, isAccountValid } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { formatNumber } from '../../i18n';
import { Dialog, Button, IconButton, Segmented, Chip, Field, Banner, EmptyState, Avatar, Icon } from '../v2/ui';
import { cx } from '../v2/helpers';
import logo from '../../assets/image/3S_logo.svg';
import { transferWithAioha, broadcastWithAioha, KeyTypes, isLoggedIn } from '../../hive-api/aioha';
import { useQueryClient } from '@tanstack/react-query';
import { queueSupport, recordSupport } from '../../lib/supports';
import { QRCodeSVG } from 'qrcode.react';
import { recurrentTransferOp, stopRecurrentTransferOp, findMonthlySupport, formatMonth, formatInterval, isMonthly } from '../../lib/recurringTip';
import { LIGHTNING_PRESETS, requestLightningInvoice, isLightningInvoicePaid, hasWebln, payWithWebln, fetchLightningReceiver } from '../../lib/lightningTip';

// Every toast from this module is headed "Tip"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Tip');

// `permlink`: the video (or audio post) the tip is sent from. With it, a tip of
// any amount is reported to the checker as a support (lib/supports.js);
// a profile tip passes none and is not one.
// `memoLink`: public 3speak.tv link of that video/audio post, appended to the
// memo so the recipient sees what the tip was for.
// `variant="page"`: the window is the whole page (the /tip popup), not an
// overlay on top of one.
// Callers also pass `isOpen` and `onSendTip`; neither is read: the window is
// mounted only while open, and sends by itself.
const TipModal = ({ recipient, permlink, memoLink, onClose, variant }) => {
    const { t, i18n } = useTranslation();
    const fieldId = useId();
    const queryClient = useQueryClient();
    const { user: activetUser } = useAppStore();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("HIVE");
  const [memo, setMemo] = useState("");
  // 0 = a single tip; else monthly for that many months (lib/recurringTip.js).
  const [months, setMonths] = useState(0);
  // The monthly support the signed-in viewer already sends this creator, or null.
  const [monthly, setMonthly] = useState(null);
  const [stopping, setStopping] = useState(false);
  // Set when the tip just sent was a monthly one: the thank-you says so.
  const [sentMonthly, setSentMonthly] = useState(false);
  const [step, setStep] = useState(1)
//   const [balErr, setBalErr] = useState ("")
  const [balances, setBalances] = useState({})
  const [selectedBalance, setSelectedBalance] = useState()
//   const [error, setError] = useState()
  const [loading, setLoading] = useState(false);
  // 'hive' = HIVE/HBD transfer from the viewer's Hive wallet; 'lightning' = an
  // invoice any Lightning wallet can pay (lib/lightningTip.js), no Hive account
  // needed, so it is where a signed-out viewer starts; 'more' = the creator's
  // pages on payment sites, a tab only when they set some.
  // The /tip page (variant="page") never uses the 3speak.tv session: its HIVE /
  // HBD tab asks for a username and a wallet instead (WalletTip), so it opens there.
  const isPage = variant === 'page';
  const [method, setMethod] = useState(() => (isPage || (activetUser && isLoggedIn()) ? 'hive' : 'lightning'));
  const [sats, setSats] = useState(String(LIGHTNING_PRESETS[1]));
  const [invoice, setInvoice] = useState(null);
  // Which Lightning button is fetching its invoice: 'qr', 'extension' or null.
  const [creatingInvoice, setCreatingInvoice] = useState(null);
  // Where the creator's Lightning tips go: { via: 'v4v' } or { via: 'address',
  // address } when they set their own address. Only the note under the form
  // depends on it; the server picks the route for the invoice itself.
  const [receiver, setReceiver] = useState(null);
  const supportLinks = useSupportLinks(recipient);
  useEffect(() => {
    if (method !== 'lightning' || !recipient) return undefined;
    let alive = true;
    fetchLightningReceiver(recipient).then((r) => { if (alive) setReceiver(r); });
    return () => { alive = false; };
  }, [method, recipient]);


  useEffect(()=>{
    if (activetUser && !isPage) getbalance()
  },[])

  useEffect(() => {
    if (isPage || !activetUser || !recipient || activetUser === recipient) return undefined;
    let alive = true;
    findMonthlySupport(activetUser, recipient)
      .then((m) => { if (alive) setMonthly(m); })
      .catch(() => { /* a node blip: the form works without it */ });
    return () => { alive = false; };
  }, [isPage, activetUser, recipient]);

  // While the invoice is on screen, ask every few seconds whether it was paid,
  // so the viewer sees the thank-you without pressing anything.
  useEffect(() => {
    if (!invoice?.hash || invoice.verifiable === false) return undefined;
    let stopped = false;
    let timer;
    const check = async () => {
      if (stopped) return;
      if (!document.hidden) {
        try {
          if (await isLightningInvoicePaid(invoice.hash)) {
            if (stopped) return;
            setAmount(String(invoice.sats));
            setCurrency('sats');
            setInvoice(null);
            setStep(2);
            return;
          }
        } catch { /* network blip: ask again next round */ }
      }
      timer = setTimeout(check, 3000);
    };
    timer = setTimeout(check, 3000);
    return () => { stopped = true; clearTimeout(timer); };
  }, [invoice]);

  useEffect(() => {
    if (balances && currency) {
      const value = currency === 'HIVE' ? balances.hive : balances.hbd;
      setSelectedBalance(value);
    }
  }, [balances, currency]);
  
  const getbalance = async ()=>{
    setLoading(true)
    try{
    const data = await fetchBalances(activetUser)
    setBalances(data)
    }catch{
        /* no balance shown; the send checks again */
    }finally{
        setLoading(false)
    }
  }

  
  

//   const handleSendTip = () => {
//     // onSendTip(amount, currency, memo);
//     setStep(2);
//     // onClose();
//   };

  const handleClose = () => {
    setAmount("");
    setCurrency("HIVE");
    setMemo("");
    setMonths(0);
    setInvoice(null);
    onClose();
  };

  // Same memo as a Hive tip: the typed text plus the link to the post.
  const memoWithLink = () => {
    const typed = memo.trim();
    return memoLink && !typed.includes(memoLink)
      ? (typed ? `${typed} ${memoLink}` : memoLink)
      : typed;
  };

  // `viaExtension`: pay with the browser's Lightning wallet (WebLN); without it,
  // or when the viewer backs out of the wallet, the invoice shows as a QR code.
  const handleLightning = async (viaExtension) => {
    const n = Number(sats);
    if (!Number.isInteger(n) || n < 1) {
      toast.error(t('engagement.tip.lightning.errors.amount'));
      return;
    }
    setCreatingInvoice(viaExtension ? 'extension' : 'qr');
    let inv;
    try {
      inv = await requestLightningInvoice({ to: recipient, sats: n, comment: memoWithLink() });
    } catch (err) {
      const key = err.code === 'amount_out_of_range' ? 'tooMuch'
        : err.code === 'no_account' ? 'noAccount'
        : 'invoiceFailed';
      toast.error(t(`engagement.tip.lightning.errors.${key}`, { max: err.max }));
      return;
    } finally {
      setCreatingInvoice(null);
    }
    if (viaExtension && hasWebln()) {
      try {
        await payWithWebln(inv.pr);
        setAmount(String(inv.sats));
        setCurrency('sats');
        setStep(2);
        return;
      } catch (err) {
        console.warn('[tip] WebLN payment not made:', err?.message || err);
      }
    }
    setInvoice(inv);
  };

  const copyInvoice = async () => {
    try {
      await navigator.clipboard.writeText(invoice.pr);
      toast.success(t('engagement.tip.lightning.copied'));
    } catch {
      toast.error(t('engagement.tip.lightning.errors.copyFailed'));
    }
  };

  const handleSubmitTransfer = async () => {
    if (!amount || !recipient || !currency) {
      toast.error(t('engagement.tip.errors.allRequired'));
      return;
    }

    if (!(parseFloat(amount) > 0)) {
      toast.error(t('engagement.tip.errors.amountPositive'));
      return;
    }

    if (!isLoggedIn()) {
      toast.error(t('engagement.tip.errors.loginRequired'));
      return;
    }

    if (parseFloat(amount) > selectedBalance) {
      toast.error(t('engagement.tip.errors.insufficientBalance'));
      return;
    }

    const valid = await isAccountValid(recipient);
    if (!valid) {
      toast.error(t('engagement.tip.errors.invalidUsername'));
      return;
    }

    // The checker matches the reported memo against the on-chain one, so the
    // support report carries the memo with the link too.
    const fullMemo = memoWithLink();

    // Monthly: one recurrent_transfer, the first payment right away. Not reported
    // as a support (see lib/recurringTip.js).
    if (months > 0) {
      try {
        await broadcastWithAioha([recurrentTransferOp({
          from: activetUser, to: recipient, amount: parseFloat(amount), currency, memo: fullMemo, months,
        })], KeyTypes.Active);
        setSentMonthly(true);
        setStep(2);
        findMonthlySupport(activetUser, recipient).then(setMonthly).catch(() => {});
      } catch (error) {
        toast.error(t('engagement.tip.errors.transferFailed', { message: error.message }));
        console.error(error);
      }
      return;
    }

    // Saved BEFORE the broadcast: if the page reloads while the wallet is still
    // signing, the next app start reports it (lib/supports.js).
    const pending = permlink
      ? queueSupport({ tipper: activetUser, author: recipient, permlink, amount: parseFloat(amount), currency, memo: fullMemo })
      : null;
    try {
      await transferWithAioha(recipient, parseFloat(amount), currency, fullMemo);
      setSentMonthly(false);
      setStep(2);
      if (pending) {
        recordSupport(pending)
          .then((r) => {
            if (!r?.recorded) return;
            queryClient.invalidateQueries({ queryKey: ['supporters', recipient] });
            queryClient.invalidateQueries({ queryKey: ['supports', recipient] });
            queryClient.invalidateQueries({ queryKey: ['supported', activetUser] });
            queryClient.invalidateQueries({ queryKey: ['supports-given', activetUser] });
          });
      }
    } catch (error) {
      // The queued report stays: a wallet timeout can still have broadcast the
      // transfer. If nothing was sent, the checker answers "pending" until the
      // report ages out of its window.
      toast.error(t('engagement.tip.errors.transferFailed', { message: error.message }));
      console.error(error);
    }
  };
  


  const stopMonthly = async () => {
    if (!monthly) return;
    setStopping(true);
    try {
      await broadcastWithAioha([stopRecurrentTransferOp({ from: activetUser, to: recipient, currency: monthly.currency })], KeyTypes.Active);
      setMonthly(null);
      toast.success(t('engagement.tip.monthly.stopped'));
    } catch (error) {
      toast.error(t('engagement.tip.monthly.stopFailed', { message: error.message }));
    } finally {
      setStopping(false);
    }
  };

  const amountNum = parseFloat(amount);
  const sendLabel = amountNum > 0
    ? t('engagement.tip.sendAmount', { amount: formatNumber(amountNum, { maximumFractionDigits: 3 }), currency })
    : t('engagement.tip.send');
  const signedIn = !!(activetUser && isLoggedIn());
  const lightningForm = step === 1 && method === 'lightning' && !invoice;
  const hiveForm = step === 1 && method === 'hive' && !isPage && signedIn;

  // The buttons that finish the form: the dialog's footer, or the end of the
  // card on the /tip page.
  let actions = null;
  if (hiveForm) {
    actions = (
      <>
        <Button variant="secondary" size={48} onClick={handleClose}>{t('common.actions.cancel')}</Button>
        <Button variant="primary" size={48} className="tip-v2__send is-next" trailing="send" onClick={handleSubmitTransfer}>{sendLabel}</Button>
      </>
    );
  } else if (lightningForm) {
    // The header's X closes the window, so no Cancel here: room for the QR
    // button always, and the extension button when there is one.
    actions = (
      <>
        {hasWebln() && (
          <Button variant="secondary" size={48} icon="extension" onClick={() => handleLightning(true)} disabled={!!creatingInvoice} loading={creatingInvoice === 'extension'}>
            {t('engagement.tip.lightning.payExtension')}
          </Button>
        )}
        <Button variant="primary" size={48} className="tip-v2__send" icon="qr_code_2" onClick={() => handleLightning(false)} disabled={!!creatingInvoice} loading={creatingInvoice === 'qr'}>
          {t('engagement.tip.lightning.showQr')}
        </Button>
      </>
    );
  }

  const content = (
    <>
      {step === 1 && !invoice && (
        <Segmented
          className="tip-v2__methods"
          size={36}
          value={method}
          onChange={setMethod}
          options={[
            { value: 'hive', label: t('engagement.tip.methodHive') },
            { value: 'lightning', label: t('engagement.tip.methodLightning'), icon: 'bolt' },
            ...(supportLinks.length > 0 ? [{ value: 'more', label: t('engagement.tip.methodMore') }] : []),
          ]}
        />
      )}

      <div className={cx('tip-v2__panel', step === 2 && 'is-done')}>
        {step === 1 && method === 'hive' && isPage && (
          <WalletTip
            recipient={recipient}
            permlink={permlink}
            memoLink={memoLink}
            onSent={(sentAmount, sentCurrency, sentMonths = 0) => { setAmount(sentAmount); setCurrency(sentCurrency); setSentMonthly(sentMonths > 0); setStep(2); }}
            onClose={handleClose}
          />
        )}

        {step === 1 && method === 'hive' && !isPage && !signedIn && (
          <EmptyState icon="login" title={t('engagement.tip.errors.loginRequired')} />
        )}

        {lightningForm && (
          <div className="tip-v2__form">
            <div className="v2-field">
              <label className="v2-eyebrow" htmlFor={`${fieldId}-sats`}>{t('engagement.tip.lightning.amountLabel')}</label>
              <div className="v2-chips tip-v2__presets">
                {LIGHTNING_PRESETS.map((p) => (
                  <Chip key={p} selected={String(p) === sats} onClick={() => setSats(String(p))}>
                    {p.toLocaleString()}
                  </Chip>
                ))}
              </div>
              <input
                id={`${fieldId}-sats`}
                className="v2-input h48 tip-v2__big"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={sats}
                onChange={(e) => setSats(e.target.value)}
              />
            </div>

            <Field
              id={`${fieldId}-ln-memo`}
              label={t('engagement.tip.lightning.messageLabel')}
              type="text"
              maxLength={500}
              placeholder={t('engagement.tip.memoPlaceholder')}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              hint={memoLink ? t('engagement.tip.memoLinkNote', { link: memoLink }) : undefined}
            />

            <Banner tone="info" icon="bolt">
              {receiver?.via === 'address'
                ? t('engagement.tip.lightning.noteOwn', { recipient, address: receiver.address })
                : t('engagement.tip.lightning.note', { recipient })}
            </Banner>
            <p className="v2-meta-sm">{t('engagement.tip.lightning.cashApp')}</p>
          </div>
        )}

        {step === 1 && method === 'lightning' && invoice && (
          <div className="tip-v2__invoice">
            <div className="tip-v2__invoice-title">
              <Icon name="bolt" size={20} />
              <b className="num">{invoice.sats.toLocaleString()} sats</b>
            </div>
            <p className="v2-meta">{t('engagement.tip.lightning.scan', { sats: invoice.sats.toLocaleString(), recipient })}</p>
            <a className="tip-v2__qr" href={`lightning:${invoice.pr}`} aria-label={t('engagement.tip.lightning.openWallet')}>
              <QRCodeSVG value={`lightning:${invoice.pr}`.toUpperCase()} size={200} marginSize={2} bgColor="white" fgColor="black" />
            </a>
            {/* An address without a LUD-21 verify URL never tells us it was paid:
                no spinner that would spin forever, the wallet says when it is done. */}
            {invoice.verifiable === false ? (
              <p className="tip-v2__waiting is-muted">{t('engagement.tip.lightning.waitingUnverified')}</p>
            ) : (
              <p className="tip-v2__waiting">
                <Icon name="progress_activity" size={18} className="v2-spin" />
                {t('engagement.tip.lightning.waiting')}
              </p>
            )}
            <div className="tip-v2__pair">
              <Button variant="secondary" size={44} icon="content_copy" onClick={copyInvoice}>
                {t('engagement.tip.lightning.copy')}
              </Button>
              <Button as="a" variant="secondary" size={44} icon="open_in_new" href={`lightning:${invoice.pr}`}>
                {t('engagement.tip.lightning.openWallet')}
              </Button>
            </div>
            <p className="v2-meta-sm">{t('engagement.tip.lightning.cashApp')}</p>
            {/* Back keeps the amount and the message, to change either and make a
                new invoice; this one simply expires unpaid. */}
            <div className="tip-v2__links">
              <Button variant="ghost" size={40} icon="arrow_back" onClick={() => setInvoice(null)}>
                {t('engagement.tip.lightning.back')}
              </Button>
              <Button variant="ghost" size={40} onClick={handleClose}>
                {t('engagement.tip.lightning.done')}
              </Button>
            </div>
          </div>
        )}

        {hiveForm && (
          <div className="tip-v2__form">
            {monthly && (
              <div className="tip-v2__current">
                <Icon name="event_repeat" size={18} />
                <span>{isMonthly(monthly)
                  ? t('engagement.tip.monthly.current', { recipient, amount: monthly.amount, date: formatMonth(monthly.until, i18n.language) })
                  : t('engagement.tip.monthly.currentEvery', { recipient, amount: monthly.amount, interval: formatInterval(monthly.recurrence, i18n.language), date: formatMonth(monthly.until, i18n.language) })}</span>
                <button type="button" className="tip-v2__stop" onClick={stopMonthly} disabled={stopping} aria-busy={stopping || undefined}>
                  {stopping ? <Icon name="progress_activity" size={16} className="v2-spin" /> : t('engagement.tip.monthly.stop')}
                </button>
              </div>
            )}
            <div className="tip-v2__row">
              <Field
                id={`${fieldId}-amount`}
                className="tip-v2__amount"
                label={t('engagement.tip.amountLabel')}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                placeholder={t('engagement.tip.amountPlaceholder')}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <Field label={t('engagement.tip.currencyLabel')} id={`${fieldId}-currency`} className="tip-v2__currency">
                <select id={`${fieldId}-currency`} className="v2-input is-select h48" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="HIVE">HIVE</option>
                  <option value="HBD">HBD</option>
                </select>
              </Field>
            </div>
            <div className="tip-v2__balance">
              <span>{t('engagement.tip.availableBalance', { currency })}</span>
              {loading
                ? <Icon name="progress_activity" size={14} className="v2-spin" />
                : <span className="num">{currency === "HIVE" ? balances.hive : balances.hbd}</span>}
            </div>

            <MonthlyField months={months} onChange={setMonths} existing={monthly} recipient={recipient} />

            <Field
              id={`${fieldId}-memo`}
              label={t('engagement.tip.memoLabel')}
              type="text"
              placeholder={t('engagement.tip.memoPlaceholder')}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              hint={memoLink ? t('engagement.tip.memoLinkNote', { link: memoLink }) : undefined}
            />
          </div>
        )}
        {step === 1 && method === 'more' && <OtherWays recipient={recipient} links={supportLinks} />}
        {step === 2 && <Success
          amount={amount}
          currency={currency}
          recipient={recipient}
          monthly={sentMonthly}
          onClose={handleClose}
        />}
      </div>
    </>
  );

  // The /tip popup: the page itself, no backdrop (design 19f, right).
  if (isPage) {
    return (
      <div className="tip-page">
        <header className="tip-page__bar">
          <img src={logo} alt="3Speak" height={24} />
          <span className="num">3speak.tv/tip/{recipient}</span>
        </header>
        <main className="tip-page__main">
          <div className="tip-page__card tip-v2">
            {step === 1 && (
              <div className="tip-page__head">
                <Avatar src={`/img/u/${recipient}/avatar/small`} name={recipient} size={52} ring="cyan" />
                <h2>{t('engagement.tip.heading', { recipient })}</h2>
                <IconButton icon="close" label={t('common.actions.close')} size={36} variant="ghost" round onClick={handleClose} />
              </div>
            )}
            {content}
            {actions && <div className="tip-page__actions">{actions}</div>}
          </div>
        </main>
      </div>
    );
  }

  return (
    <Dialog
      open
      onClose={handleClose}
      title={t('engagement.tip.heading', { recipient })}
      closeLabel={t('common.actions.close')}
      head={step !== 2}
      width={460}
      className={cx('tip-v2', step === 2 && 'is-success')}
      footer={actions}
    >
      {content}
    </Dialog>
  );
};

export default TipModal;
