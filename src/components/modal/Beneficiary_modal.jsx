import React, { useEffect, useState } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import './Beneficiary_modal.scss';
import { MdDeleteForever } from 'react-icons/md';

import { Client } from '@hiveio/dhive';
import { useAppStore } from '../../lib/store';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { HIVE_API_NODES } from '../../utils/config';
import { useTranslation, Trans } from 'react-i18next';

const client = getHiveClient();

// `variant` distinguishes the publish flow:
//   'studio' — keeps the 1% Video-Encoding split even for Pro users
//   'embed'  — no platform splits at all for Pro users
function Beneficiary_modal({ isOpen, close, setBeneficiaries, setBeneficiaryList, setList, list, remaingPercent, setRemaingPercent, variant = 'studio' }) {
  // The row handlers below mutate the parent's list as you type, so dismissing
  // the dialog used to keep half-finished edits. Snapshot on open, restore on
  // cancel, and only OK leaves the changes in place.
  const { t } = useTranslation();
  const snapshotRef = React.useRef(null);

  React.useEffect(() => {
    if (isOpen && snapshotRef.current === null) {
      snapshotRef.current = { list: [...list], remaingPercent };
    }
    if (!isOpen) snapshotRef.current = null;
  }, [isOpen]);

  const cancel = () => {
    if (snapshotRef.current) {
      setList(snapshotRef.current.list);
      setRemaingPercent(snapshotRef.current.remaingPercent);
      snapshotRef.current = null;
    }
    close();
  };
  const {user} = useAppStore();
  const isPremium = !!usePremiumStatus(user)?.premium;
  const [account, setAccount] = useState('');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState('');
  // Live check that the typed account actually exists on Hive: 'idle' (empty),
  // 'checking', 'valid', 'invalid'. Debounced so we don't hit the API on every
  // keystroke. handleBeneficairy still re-checks authoritatively on add.
  const [acctStatus, setAcctStatus] = useState('idle');


  useEffect(() => {
  setBeneficiaryList(prev => prev + list.length);
}, [list]);

  



  async function isAccountValid(username) {
    try {
      const accounts = await client.database.getAccounts([username]);
      return accounts.length > 0;
    } catch (error) {
      console.error('Error fetching account:', error);
      return false;
    }
  }

  useEffect(() => {
    const name = account.trim().toLowerCase();
    if (!name) { setAcctStatus('idle'); return undefined; }
    setAcctStatus('checking');
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const ok = await isAccountValid(name);
        if (alive) setAcctStatus(ok ? 'valid' : 'invalid');
      } catch { if (alive) setAcctStatus('idle'); }
    }, 450);
    return () => { alive = false; clearTimeout(timer); };
  }, [account]);

  // Anything typed into the row that hasn't been committed with "+" yet.
  const hasPendingRow = account.trim() !== '';

  const handleBeneficairy = async () => {

    

    if (account.trim() === '') {
        setError(t('modals.beneficiary.errors.emptyUsername'));
        return;
      }
      if (account ===  user){
        setError(t('modals.beneficiary.errors.sameUser'))
        return;
      }
    
      if (percent <= 0) {
        setError(t('modals.beneficiary.errors.greaterThanZero'));
        return;
      }
    
      if (percent > remaingPercent) {
        setError(t('modals.beneficiary.errors.exceedsRemaining', { percent: remaingPercent }));
        return;
      }
    if (percent < 1) return
    if (percent === "") {
      setError(t('modals.beneficiary.errors.validNumber'))
      return;
    }
    if (!percent || isNaN(percent)) {
      setError(t('modals.beneficiary.errors.validPercent'));
      return;
    }

    setError('');

    


    // Check if the account already exists in the list
    const isDuplicate = list.some((item) => item.account === account.trim());
    if (isDuplicate) {
      setError(t('modals.beneficiary.errors.duplicate'));
      return;
    }

    // Validate account
    const isValid = await isAccountValid(account);
    if (!isValid) {
      setError(t('modals.beneficiary.errors.invalidAccount'));
      return;
    }

    setError('');

    const total = remaingPercent- percent
    setRemaingPercent(total)

    if (percent > remaingPercent) {
      setError(t('modals.beneficiary.errors.exceedsRemaining', { percent: remaingPercent }));
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
  if (list[index].locked) return; // locked items cannot be deleted
  const deletedPercent = list[index].percent; // get the percent of the item being deleted
  const updatedList = list.filter((_, i) => i !== index); // remove the item
  setList(updatedList);
  setRemaingPercent((prev) => prev + deletedPercent); // add back the deleted percent
};

  const handleLockedPercentChange = (index, newPercent) => {
    const item = list[index];
    if (!item.locked) return;
    const minP = item.minPercent || 1;
    const value = Math.max(minP, parseFloat(newPercent) || minP);
    const diff = value - item.percent;
    if (diff > remaingPercent) {
      setError(t('modals.beneficiary.errors.cannotIncrease', { percent: remaingPercent }));
      return;
    }
    setError('');
    const updatedList = list.map((it, i) => i === index ? { ...it, percent: value } : it);
    setList(updatedList);
    setRemaingPercent(prev => prev - diff);
  };

  const handleSave = () => {
    // Don't quietly discard a half-entered beneficiary.
    if (hasPendingRow) {
      setError(t('modals.beneficiary.errors.pendingRow', { account: account.trim() }));
      return;
    }
    // Map the list to the required format
    const beneficiaries = list.map((item) => ({
      account: item.account,
      weight: Math.round(item.percent * 100), // Convert percent to weight
    }));

    // Convert to the required string format
    const beneficiariesString = JSON.stringify(beneficiaries);

    
    setBeneficiaries(beneficiariesString); // Set the formatted string to the parent component
    snapshotRef.current = null; // committed, so nothing to roll back to
    close(); // Close the modal after saving
  };

  return (
    <div className={`modal ${isOpen ? 'open' : ''}`}>
      <div className="overlay" onClick={cancel}></div>
      <div
        className={`modal-content video-upload-moadal-size bene ${
          isOpen ? 'open' : ''
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>{t('modals.beneficiary.title')}</h2>
          <button type="button" className="close-btn" onClick={cancel}>
            &times;
          </button>
        </div>

        <p className="bene-text">
          {t('modals.beneficiary.intro')}
        </p>

        {error && <span className="error">{error}</span>}

        <div className="bene-content-wrap">
          <div className="user-wrap">
            <span>{user}</span> <span>{remaingPercent}%</span>
          </div>

          {/* Render the beneficiary list */}
          <div className="beneficiary-list">
            {list.map((item, index) => (
              <div className="wrap" key={index}>
                <span>@{item.account}</span>
                {item.locked ? (
                  <>
                    <input
                      type="number"
                      value={item.percent}
                      min={item.minPercent || 1}
                      step="1"
                      style={{ width: '62px', textAlign: 'center' }}
                      onChange={(e) => handleLockedPercentChange(index, e.target.value)}
                    />
                    <span>{t('modals.beneficiary.minPercent', { percent: item.minPercent })}</span>
                  </>
                ) : (
                  <>
                    <span>{item.percent}%</span>
                    <MdDeleteForever
                      className="delete-icon"
                      onClick={() => handleDelete(index)}
                    />
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="reward-main">
            <div className="wrap">
              <label>@</label>
              <input
                type="text"
                value={account}
                placeholder={t('modals.beneficiary.usernamePlaceholder')}
                onChange={(e) => setAccount(e.target.value.toLowerCase())}
              />
            </div>
            <div className="num-wrap">
              <div className="input-tooltip-wrap">
                <input
                  type="number"
                  value={percent}
                  min="1"
                  step="1"
                  palaceholder="Enter usernmae"
                  onChange={(e) => {
                    const value = parseFloat(e.target.value);

                    if (value < 1) {
                      setPercent(value);
                      setError(t('modals.beneficiary.errors.atLeastOne'));
                    } else {
                      setError("");
                      setPercent(value);
                    }
                  }}
                />

                {percent > 0 && percent < 1 && (
                  <div className="tooltip">
                    <Trans i18nKey="modals.beneficiary.minimumReward" components={{ strong: <strong /> }} />
                  </div>
                )}
              </div>

              <span>%</span>
              <button type="button" onClick={handleBeneficairy} className="green">+</button>
            </div>

          </div>

          {/* Typed but not committed with "+" — say so, and report whether the
              account actually exists on Hive. Nothing shows while the row is
              empty. */}
          {hasPendingRow && (
            <div className={`bene-pending${acctStatus === 'invalid' ? ' bene-pending--bad' : ''}`}>
              {acctStatus === 'checking' && <Trans i18nKey="modals.beneficiary.checking" values={{ account: account.trim() }} components={{ strong: <strong /> }} />}
              {acctStatus === 'invalid' && <Trans i18nKey="modals.beneficiary.notExisting" values={{ account: account.trim() }} components={{ strong: <strong /> }} />}
              {(acctStatus === 'valid' || acctStatus === 'idle') && (
                <Trans i18nKey="modals.beneficiary.notAdded" values={{ account: account.trim() }} components={{ strong: <strong /> }} />
              )}
            </div>
          )}

          {/* Render the beneficiary list
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
          </div> */}

          <div className="last-btn-wrap">
            {/* <button onClick={close}>Cancel</button> */}
            <button type="button" onClick={handleSave}>{t('common.actions.ok')}</button>
          </div>

          {(() => {
            if (list.some(item => item.locked)) return null;
            // Pro users skip the 10% threespeakfund split entirely. The 1%
            // encoder split is kept for /studio uploads (3Speak encodes
            // them), shown for /embed non-premium, and NEVER for audio
            // (no encoding pipeline for audio posts).
            const entries = [];
            if (!isPremium) {
              entries.push(<div key="fund" className="wrap"><span>threespeakfund</span> <span>{t('modals.beneficiary.infrastructure')}</span></div>);
            }
            // 'stream' = an OpenPods session announcement: nothing goes
            // through the video encoder, so the 1% split never applies (the
            // publish path doesn't add it either — don't advertise it).
            const keepEncoder = variant === 'studio'
              ? true
              : (variant === 'audio' || variant === 'stream')
                ? false
                : !isPremium;
            if (keepEncoder) {
              entries.push(<div key="enc" className="wrap"><span> {t('modals.beneficiary.videoEncoding')}</span></div>);
            }
            if (entries.length === 0) return null;
            return (
              <div className="default-bene-wrap">
                <p>{t('modals.beneficiary.defaults', { count: entries.length })}</p>
                {entries}
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}

export default Beneficiary_modal;
