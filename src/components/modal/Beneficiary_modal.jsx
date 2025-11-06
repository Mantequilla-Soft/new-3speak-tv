import React, { useEffect, useState } from 'react';
import './Beneficiary_modal.scss';
import { MdDeleteForever } from 'react-icons/md';

import { Client } from '@hiveio/dhive';
import { useAppStore } from '../../lib/store';


const client = new Client('https://api.hive.blog');

function Beneficiary_modal({ isOpen, close, setBeneficiaries, setBeneficiaryList, setList, list, remaingPercent, setRemaingPercent }) {
  const {user} = useAppStore();
  const [account, setAccount] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');


  useEffect(() => {
  setBeneficiaryList(prev => prev + list.length);
}, [list]);

  console.log('list', list.length);



  async function isAccountValid(username) {
    try {
      const accounts = await client.database.getAccounts([username]);
      return accounts.length > 0;
    } catch (error) {
      console.error('Error fetching account:', error);
      return false;
    }
  }

  const handleBeneficairy = async () => {

    

    if (account.trim() === '') {
        setError('Username cannot be empty.');
        return;
      }
      if (account ===  user){
        setError("Beneficiary can't be set to same user" )
        return;
      }
    
      if (percent <= 0) {
        setError('Reward percentage must be greater than 0.');
        return;
      }
    
      if (percent > remaingPercent) {
        setError(`Reward percentage exceeds remaining allocation of ${remaingPercent}%.`);
        return;
      }

    setError('');

    


    // Check if the account already exists in the list
    const isDuplicate = list.some((item) => item.account === account.trim());
    if (isDuplicate) {
      setError('This account is already added to the list.');
      return;
    }

    // Validate account
    const isValid = await isAccountValid(account);
    if (!isValid) {
      setError('Invalid username or community ID.');
      return;
    }

    setError('');

    const total = remaingPercent- percent
    setRemaingPercent(total)

    if (percent > remaingPercent) {
      setError(`Reward percentage exceeds remaining allocation of ${remaingPercent}%.`);
      return;
    }

  setError('');

    // Add new beneficiary
    const newItem = { account, percent: parseFloat(percent) };
    setList([...list, newItem]);

    // Clear inputs
    setAccount('');
    setPercent(0);
  };

  const handleDelete = (index) => {
  const deletedPercent = list[index].percent; // get the percent of the item being deleted
  const updatedList = list.filter((_, i) => i !== index); // remove the item
  setList(updatedList);
  setRemaingPercent((prev) => prev + deletedPercent); // add back the deleted percent
};

  const handleSave = () => {
    // Map the list to the required format
    const beneficiaries = list.map((item) => ({
      account: item.account,
      weight: Math.round(item.percent * 100), // Convert percent to weight
    }));

    // Convert to the required string format
    const beneficiariesString = JSON.stringify(beneficiaries);

    console.log(beneficiariesString); // For debugging
    setBeneficiaries(beneficiariesString); // Set the formatted string to the parent component
    close(); // Close the modal after saving
  };

  return (
    <div className={`modal ${isOpen ? 'open' : ''}`}>
      <div className="overlay" onClick={close}></div>
      <div
        className={`modal-content video-upload-moadal-size bene ${
          isOpen ? 'open' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Beneficiaries</h2>
          <button className="close-btn" onClick={close}>
            &times;
          </button>
        </div>

        <p className="bene-text">
          Add a user you want to automatically receive a portion of the rewards
          for this post.
        </p>

        {error && <span className="error">{error}</span>}

        <div className="bene-content-wrap">
          <div className="list-top-wrap">
            <span>Username</span> <span>Reward</span>
          </div>
          <div className="user-wrap">
            <span>{user}</span> <span>{remaingPercent}%</span>
          </div>

          <div className="reward-main">
            <div className="wrap">
              <label>@</label>
              <input
                type="text"
                value={account}
                onChange={(e) => setAccount(e.target.value.toLowerCase())}
              />
            </div>
            <div className="num-wrap">
              <label>Reward</label>
              <input
                type="number"
                value={percent}
                onChange={(e) => setPercent(parseFloat(e.target.value))}
              />
              <span>%</span>
              <button onClick={handleBeneficairy} className='green'>+</button>
            </div>
          </div>

          {/* Render the beneficiary list */}
          <div className="beneficiary-list">
            {list.map((item, index) => (
              <div className="wrap" key={index}>
                <span>@{item.account}</span>
                <span>{item.percent}%</span>
                <MdDeleteForever
                  className="delete-icon"
                  onClick={() => handleDelete(index)}
                />
              </div>
            ))}
          </div>

          <div className="last-btn-wrap">
            <button onClick={close}>Cancel</button>
            <button onClick={handleSave}>Save</button>
          </div>

          <div className="default-bene-wrap">
            <p>Default Beneficiaries (2)</p>
            <div className="wrap">
              <span>spk.beneficiary</span> <span>10% === Infrastructure</span>
            </div>
            <div className="wrap">
               <span> Video Encoding === 1%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Beneficiary_modal;
