import React, { useEffect, useState } from 'react';
import Success from './Success';
import { useTranslation } from 'react-i18next';
import './TipModal.scss';
import { fetchBalances, isAccountValid } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { LineSpinner } from 'ldrs/react'
import 'ldrs/react/LineSpinner.css'
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';

// Every toast from this module is headed "Tip"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Tip');

const TipModal = ({ recipient, isOpen, onClose, onSendTip }) => {
    const { t } = useTranslation();
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

    try {
      await transferWithAioha(recipient, parseFloat(amount), currency, memo || '');
      setStep(2);
    } catch (error) {
      toast.error(t('engagement.tip.errors.transferFailed', { message: error.message }));
      console.error(error);
    }
  };
  


  return (
    <div className={`tip-modal ${step === 2 ? "add" : ""}`}>
        <div className={`modal-content-trx ${step === 2 ? "add" : ""}`}>
      
        {step === 1 && <div className="tip-modal-in">
          <div className="header">
            <h2>{t('engagement.tip.heading', { recipient })}</h2>
          </div>
          
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