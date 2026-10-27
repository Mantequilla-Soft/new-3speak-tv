import React, { useEffect, useState } from 'react';
import Success from './Success';
import { useTranslation } from 'react-i18next';
import ModalHeader from '../ModalHeader/ModalHeader';
import './TipModal.scss';
import { fetchBalances, isAccountValid } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { LineSpinner } from 'ldrs/react'
import 'ldrs/react/LineSpinner.css'
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { useQueryClient } from '@tanstack/react-query';
import { queueSupport, recordSupport } from '../../lib/supports';

// Every toast from this module is headed "Tip"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Tip');

// `permlink`: the video (or audio post) the tip is sent from. With it, a tip of
// any amount is reported to the checker as a support (lib/supports.js);
// a profile tip passes none and is not one.
const TipModal = ({ recipient, permlink, isOpen, onClose, onSendTip }) => {
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


  useEffect(()=>{
    getbalance()
  },[])

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
    onClose();
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

    // Saved BEFORE the broadcast: if the page reloads while the wallet is still
    // signing, the next app start reports it (lib/supports.js).
    const pending = permlink
      ? queueSupport({ tipper: activetUser, author: recipient, permlink, amount: parseFloat(amount), currency, memo })
      : null;
    try {
      await transferWithAioha(recipient, parseFloat(amount), currency, memo || '');
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
    <div className={`tip-modal ${step === 2 ? "add" : ""}`}>
        <div className={`modal-content-trx ${step === 2 ? "add" : ""}`}>
        <ModalHeader
          className="tip-modal-header"
          title={step === 2 ? t('engagement.tip.successTitle') : t('engagement.tip.heading', { recipient })}
          onClose={handleClose}
        />
      
        {step === 1 && <div className="tip-modal-in">
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