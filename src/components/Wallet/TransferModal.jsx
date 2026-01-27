import React, { useEffect, useState } from 'react'
import "./TransferModal.scss"
import {useAppStore } from "../../lib/store"
import {isAccountValid} from "../../hive-api/api"
import { transferWithAioha, isLoggedIn } from "../../hive-api/aioha"
import { toast } from 'sonner';

function TransferModal({showModal, selectedCoin, balances, fetchBalances}) {
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
            toast.error("Please login to transfer");
            return;
        }

        if (parseFloat(amount) > balance) {
            setBalErr("Insufficient balance");
            return;
        } else {
            setBalErr("");
        }

        const valid = await isAccountValid(recipient);
        console.log(valid);
        if (!valid) {
            setError("Invalid username");
            return;
        } else {
            setError("");
        }

        try {
            await transferWithAioha(recipient, parseFloat(amount), coinType, memo || '');
            toast.success('Transfer successful!');
            showModal(false);
        } catch (error) {
            console.error('Transfer failed:', error);
            toast.error(`Transfer failed: ${error.message}`);
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
              <h3>Transfer {selectedCoin.name}</h3>
              <div className="input-group">
                <label>Amount ({selectedCoin.name})</label> <span className='error'>{balErr}</span>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.000"
                  step="0.001"
                />
                <div className="wrap">
                    <span>Balance {balance}</span>
                    <span onClick={()=> setAmount(balance)}>Max</span>
                </div>
              </div>
              <div className="input-group">
                <label>Recipient Username</label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="Enter Hive username"
                />
                <span className='error'>{error}</span>
              </div>
              <div className="input-group">
                <label>Memo</label>
                <input
                  type="text"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="Enter Memo"
                />
              </div>
              <div className="button-group">
                <button
                  className="cancel-btn"
                  onClick={() => showModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="confirm-btn"
                  onClick={()=>handleSubmitTransfer(selectedCoin.name)}
                >
                  Confirm Transfer
                </button>
              </div>
            </div>
          </div>
  )
}

export default TransferModal
