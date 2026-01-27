import React, { useEffect, useState } from 'react';
import Success from './Success';
import './TipModal.scss';
import { fetchBalances, isAccountValid } from '../../hive-api/api';
import { useAppStore } from '../../lib/store';
import { toast } from 'sonner'
import { LineSpinner } from 'ldrs/react'
import 'ldrs/react/LineSpinner.css'
import { transferWithAioha, isLoggedIn } from '../../hive-api/aioha';




const TipModal = ({ recipient, isOpen, onClose, onSendTip }) => {
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
      toast.error("All fields are required");
      return;
    }

    if (!isLoggedIn()) {
      toast.error("Please login to send a tip");
      return;
    }

    if (parseFloat(amount) > selectedBalance) {
      toast.error("Insufficient balance");
      return;
    }

    const valid = await isAccountValid(recipient);
    if (!valid) {
      toast.error("Invalid username");
      return;
    }

    try {
      await transferWithAioha(recipient, parseFloat(amount), currency, memo || '');
      setStep(2);
    } catch (error) {
      toast.error(`Transfer failed: ${error.message}`);
      console.error(error);
    }
  };
  


  return (
    <div className={`tip-modal ${step === 2 ? "add" : ""}`}>
        <div className={`modal-content-trx ${step === 2 ? "add" : ""}`}>
      
        {step === 1 && <div className="tip-modal-in">
          <div className="header">
            <h2>Send a Tip to @{recipient}</h2>
          </div>
          
          <div className="form">
            <div className="field">
              <label>Amount: </label>
              <input
                type="number"
                placeholder="e.g. 1.000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="field">
              <label>Currency:</label>
              <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="HIVE">HIVE</option>
                <option value="HBD">HBD</option>
              </select>
              <div className='balance-wrap'>
                <span>Available balance: {currency}</span>
                 {loading ? (<LineSpinner size="10" stroke="3" speed="1" color="red" /> )
                 :
                 <span>{currency === "HIVE" ? <div>{balances.hive}</div>: <div>{balances.hbd}</div>}</span>}</div>
            </div>

            
             

            <div className="field">
              <label>Memo (optional):</label>
              <input
                type="text"
                placeholder="e.g. Thanks for this amazing content!"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>

            <div className="actions">
              <button className="cancel-btn" onClick={handleClose}>
                Cancel
              </button>
              <button className="send-btn" onClick={handleSubmitTransfer}>
                Send Tip
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