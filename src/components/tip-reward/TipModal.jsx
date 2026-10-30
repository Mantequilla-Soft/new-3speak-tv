import React, { useEffect, useState } from 'react';
import Success from './Success';
import { useTranslation } from 'react-i18next';
import ModalHeader from '../ModalHeader/ModalHeader';
import WalletTip from './WalletTip';
import './TipModal.scss';
import { fetchBalances, isAccountValid } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { LineSpinner } from 'ldrs/react'
import 'ldrs/react/LineSpinner.css'
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { useQueryClient } from '@tanstack/react-query';
import { queueSupport, recordSupport } from '../../lib/supports';
import { QRCodeSVG } from 'qrcode.react';
import { LIGHTNING_PRESETS, requestLightningInvoice, isLightningInvoicePaid, hasWebln, payWithWebln } from '../../lib/lightningTip';

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
const TipModal = ({ recipient, permlink, memoLink, isOpen, onClose, onSendTip, variant }) => {
    const { t } = useTranslation();
    const queryClient = useQueryClient();
    const { user: activetUser } = useAppStore();
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("HIVE");
  const [memo, setMemo] = useState("");
  const [step, setStep] = useState(1)
//   const [balErr, setBalErr] = useState ("")
  const [balances, setBalances] = useState({})
  const [selectedBalance, setSelectedBalance] = useState()
//   const [error, setError] = useState()
  const [loading, setLoading] = useState(false);
  // 'hive' = HIVE/HBD transfer from the viewer's Hive wallet; 'lightning' = an
  // invoice any Lightning wallet can pay (lib/lightningTip.js), no Hive account
  // needed, so it is where a signed-out viewer starts.
  // The /tip page (variant="page") never uses the 3speak.tv session: its HIVE /
  // HBD tab asks for a username and a wallet instead (WalletTip), so it opens there.
  const isPage = variant === 'page';
  const [method, setMethod] = useState(() => (isPage || (activetUser && isLoggedIn()) ? 'hive' : 'lightning'));
  const [sats, setSats] = useState(String(LIGHTNING_PRESETS[1]));
  const [invoice, setInvoice] = useState(null);
  // Which Lightning button is fetching its invoice: 'qr', 'extension' or null.
  const [creatingInvoice, setCreatingInvoice] = useState(null);


  useEffect(()=>{
    if (activetUser && !isPage) getbalance()
  },[])

  // While the invoice is on screen, ask every few seconds whether it was paid,
  // so the viewer sees the thank-you without pressing anything.
  useEffect(() => {
    if (!invoice?.hash) return undefined;
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
    }catch(err){
        
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

    // Saved BEFORE the broadcast: if the page reloads while the wallet is still
    // signing, the next app start reports it (lib/supports.js).
    const pending = permlink
      ? queueSupport({ tipper: activetUser, author: recipient, permlink, amount: parseFloat(amount), currency, memo: fullMemo })
      : null;
    try {
      await transferWithAioha(recipient, parseFloat(amount), currency, fullMemo);
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
  


  return (
    <div className={`tip-modal ${step === 2 ? "add" : ""}${variant === 'page' ? ' tip-modal--page' : ''}`}>
        <div className={`modal-content-trx ${step === 2 ? "add" : ""}`}>
        <ModalHeader
          className="tip-modal-header"
          title={step === 2 ? t('engagement.tip.successTitle') : t('engagement.tip.heading', { recipient })}
          onClose={handleClose}
        />
      
        {step === 1 && !invoice && (
          <div className="tip-method-switch" role="tablist">
            <button type="button" role="tab" aria-selected={method === 'hive'} className={method === 'hive' ? 'active' : ''} onClick={() => setMethod('hive')}>
              {t('engagement.tip.methodHive')}
            </button>
            <button type="button" role="tab" aria-selected={method === 'lightning'} className={method === 'lightning' ? 'active' : ''} onClick={() => setMethod('lightning')}>
              ⚡ {t('engagement.tip.methodLightning')}
            </button>
          </div>
        )}

        {step === 1 && method === 'hive' && isPage && (
          <WalletTip
            recipient={recipient}
            permlink={permlink}
            memoLink={memoLink}
            onSent={(sentAmount, sentCurrency) => { setAmount(sentAmount); setCurrency(sentCurrency); setStep(2); }}
            onClose={handleClose}
          />
        )}

        {step === 1 && method === 'hive' && !isPage && !(activetUser && isLoggedIn()) && (
          <div className="tip-modal-in">
            <p className="tip-method-note">{t('engagement.tip.errors.loginRequired')}</p>
          </div>
        )}

        {step === 1 && method === 'lightning' && !invoice && <div className="tip-modal-in">
          <div className="form">
            <div className="field">
              <label>{t('engagement.tip.lightning.amountLabel')}</label>
              <div className="sats-presets">
                {LIGHTNING_PRESETS.map((p) => (
                  <button type="button" key={p} className={String(p) === sats ? 'active' : ''} onClick={() => setSats(String(p))}>
                    {p.toLocaleString()}
                  </button>
                ))}
              </div>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={sats}
                onChange={(e) => setSats(e.target.value)}
              />
            </div>

            <div className="field">
              <label>{t('engagement.tip.lightning.messageLabel')}</label>
              <input
                type="text"
                maxLength={500}
                placeholder={t('engagement.tip.memoPlaceholder')}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
              {memoLink && (
                <div className="memo-link-note">{t('engagement.tip.memoLinkNote', { link: memoLink })}</div>
              )}
            </div>

            <p className="tip-method-note">{t('engagement.tip.lightning.note', { recipient })}</p>

            {/* The header's X closes the window, so no Cancel here: room for the
                QR button always, and the extension button when there is one. */}
            <div className="actions lightning-actions">
              <button className="send-btn" onClick={() => handleLightning(false)} disabled={!!creatingInvoice}>
                {creatingInvoice === 'qr'
                  ? <LineSpinner size="14" stroke="2" speed="1" color="currentColor" />
                  : t('engagement.tip.lightning.showQr')}
              </button>
              {hasWebln() && (
                <button className="send-btn" onClick={() => handleLightning(true)} disabled={!!creatingInvoice}>
                  {creatingInvoice === 'extension'
                    ? <LineSpinner size="14" stroke="2" speed="1" color="currentColor" />
                    : t('engagement.tip.lightning.payExtension')}
                </button>
              )}
            </div>
          </div>
        </div>}

        {step === 1 && method === 'lightning' && invoice && <div className="tip-modal-in">
          <div className="lightning-invoice">
            <p className="tip-method-note">{t('engagement.tip.lightning.scan', { sats: invoice.sats.toLocaleString(), recipient })}</p>
            <a className="qr-wrap" href={`lightning:${invoice.pr}`} aria-label={t('engagement.tip.lightning.openWallet')}>
              <QRCodeSVG value={`lightning:${invoice.pr}`.toUpperCase()} size={220} marginSize={2} bgColor="#ffffff" fgColor="#000000" />
            </a>
            <div className="actions">
              <button className="cancel-btn" onClick={copyInvoice}>
                {t('engagement.tip.lightning.copy')}
              </button>
              <a className="send-btn" href={`lightning:${invoice.pr}`}>
                {t('engagement.tip.lightning.openWallet')}
              </a>
            </div>
            <p className="lightning-waiting">
              <LineSpinner size="12" stroke="2" speed="1" color="currentColor" />
              {t('engagement.tip.lightning.waiting')}
            </p>
            {/* Back keeps the amount and the message, to change either and make a
                new invoice; this one simply expires unpaid. */}
            <div className="lightning-links">
              <button type="button" className="lightning-done" onClick={() => setInvoice(null)}>
                {t('engagement.tip.lightning.back')}
              </button>
              <button type="button" className="lightning-done" onClick={handleClose}>
                {t('engagement.tip.lightning.done')}
              </button>
            </div>
          </div>
        </div>}

        {step === 1 && method === 'hive' && !isPage && activetUser && isLoggedIn() && <div className="tip-modal-in">
          <div className="form">
            <div className="field">
              <label>{t('engagement.tip.amountLabel')}</label>
              <input
                type="number"
                placeholder={t('engagement.tip.amountPlaceholder')}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="field">
              <label>{t('engagement.tip.currencyLabel')}</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="HIVE">HIVE</option>
                <option value="HBD">HBD</option>
              </select>
              <div className='balance-wrap'>
                <span>{t('engagement.tip.availableBalance', { currency })}</span>
                 {loading ? (<LineSpinner size="10" stroke="3" speed="1" color="red" /> )
                 :
                 <span>{currency === "HIVE" ? <div>{balances.hive}</div>: <div>{balances.hbd}</div>}</span>}</div>
            </div>

            
             

            <div className="field">
              <label>{t('engagement.tip.memoLabel')}</label>
              <input
                type="text"
                placeholder={t('engagement.tip.memoPlaceholder')}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
              {memoLink && (
                <div className="memo-link-note">{t('engagement.tip.memoLinkNote', { link: memoLink })}</div>
              )}
            </div>

            <div className="actions">
              <button className="cancel-btn" onClick={handleClose}>
                {t('common.actions.cancel')}
              </button>
              <button className="send-btn" onClick={handleSubmitTransfer}>
                {t('engagement.tip.send')}
              </button>
            </div>
          </div>
        </div>}
        {step === 2 && <Success 
        amount={amount}
        currency={currency}
        onClose={handleClose}
      />}
        </div>
        </div>
  );
};

export default TipModal;