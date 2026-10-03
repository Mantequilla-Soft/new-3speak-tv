import React, { useEffect, useState } from 'react'
import "./TransferModal.scss"
import {useAppStore } from "../../lib/store"
import {isAccountValid} from "../../hive-api/api"
import { transferWithAioha, isLoggedIn } from "../../hive-api/aioha"
import { toastIn } from '../../utils/toast';
import { useTranslation } from 'react-i18next';

// Every toast from this module is headed "Wallet"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Wallet');

function TransferModal({showModal, selectedCoin, balances, fetchBalances}) {
    const { t } = useTranslation();
    const { user } = useAppStore();
    const [amount, setAmount] = useState('');
    const [recipient, setRecipient] = useState('');
    const [memo, setMemo] = useState('');
    const [balance, setBalance] = useState()
    const [error, setError] = useState("")
    const [balErr, setBalErr] = useState("")

    const handleSubmitTransfer = async (coinType) => {
        if (!amount || !recipient || !selectedCoin || !coinType) return;

        if (!isLoggedIn()) {
            toast.error(t('wallet.transferModal.loginRequired'));
            return;
        }

        if (parseFloat(amount) > balance) {
            setBalErr(t('wallet.transferModal.insufficient'));
            return;
        } else {
            setBalErr("");
        }

        const valid = await isAccountValid(recipient);
        console.log(valid);
        if (!valid) {
            setError(t('wallet.transferModal.invalidUsername'));
            return;
        } else {
            setError("");
        }

        try {
            await transferWithAioha(recipient, parseFloat(amount), coinType, memo || '');
            toast.success(t('wallet.transferModal.success'));
            showModal(false);
        } catch (error) {
            console.error('Transfer failed:', error);
            toast.error(t('wallet.transferModal.failed', { error: error.message }));
        }
    };

      useEffect(()=>{
        CurrentBalance()
      }, [])

      const CurrentBalance = (coinType)=>{
        if(selectedCoin.name === "HIVE"){
            setBalance(balances.hive)
        }else{
            setBalance(balances.hbd)
        }
      }

  return (
    <div className="transfer-modal">
            <div className="modal-content-tran">
              <h3>{t('wallet.transferModal.title', { coin: selectedCoin.name })}</h3>
              <div className="input-group">
                <label>{t('wallet.transferModal.amountLabel', { coin: selectedCoin.name })}</label> <span className='error'>{balErr}</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.000"
                  step="0.001"
                />
                <div className="wrap">
                    <span>{t('wallet.transferModal.balance', { balance })}</span>
                    <span onClick={()=> setAmount(balance)}>{t('wallet.transferModal.max')}</span>
                </div>
              </div>
              <div className="input-group">
                <label>{t('wallet.transferModal.recipientLabel')}</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder={t('wallet.transferModal.recipientPlaceholder')}
                />
                <span className='error'>{error}</span>
              </div>
              <div className="input-group">
                <label>{t('wallet.transferModal.memoLabel')}</label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder={t('wallet.transferModal.memoPlaceholder')}
                />
              </div>
              <div className="button-group">
                <button
                  className="cancel-btn"
                  onClick={() => showModal(false)}
                >
                  {t('common.actions.cancel')}
                </button>
                <button
                  className="confirm-btn"
                  onClick={()=>handleSubmitTransfer(selectedCoin.name)}
                >
                  {t('wallet.transferModal.confirm')}
                </button>
              </div>
            </div>
          </div>
  )
}

export default TransferModal
