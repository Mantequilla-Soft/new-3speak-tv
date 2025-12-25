import React, { useEffect, useState } from 'react'
// import "./TransferModal.scss"
import "./TransferModal.scss"
import {useAppStore } from "../../lib/store"
import { Client } from '@hiveio/dhive';
import {isAccountValid} from "../../hive-api/api"

const client = new Client([
  'https://api.hive.blog',
  'https://api.hivekings.com',
  'https://anyx.io',
  'https://api.openhive.network'
]);

function TransferModal({showModal, selectedCoin, balances, fetchBalances}) {
    const { user } = useAppStore();
    const [amount, setAmount] = useState('');
    const [recipient, setRecipient] = useState('');
    const [memo, setMemo] = useState('');
    const [balance, setBalance] = useState()
    const [error, setError] = useState("")
    const [balErr, setBalErr] = useState("")

    const handleSubmitTransfer = async (coinType) => {
        if (!amount || !recipient || !selectedCoin || !amount || !coinType ) return;

        if (amount > balance){
            setBalErr("insuficent balance")
            return
        }else{
            setBalErr("")
        }

        const valid = await isAccountValid(recipient)
        console.log(valid)
        if(!valid){
            setError("Invalid username")
            return
        }else{
            setError("")
        }
        try {
            const currency = coinType
        
            // Prepare transfer operation
            const transferOp = [
              'transfer',
              {
                from: user,
                to: recipient,
                amount: `${parseFloat(amount).toFixed(3)} ${currency}`,
                memo: memo || ''
              }
            ];
        
            // Call Keychain to broadcast transaction
            window.hive_keychain.requestBroadcast(
              user,
              [transferOp],
              'Active', // Requires active key
              async (response) => {
                if (response.success) {
                  console.log('Transfer successful:', response);
                //   await fetchBalances();
                showModal(false)
                } else {
                  console.error('Transfer failed:', response.message);
                }
              }
            );
        
          } catch (error) {
            console.error('Error processing transfer:', error);
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
                  placeholder="Enter Hive username"
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