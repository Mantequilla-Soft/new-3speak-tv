import { useEffect, useRef, useState } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import { createPortal } from 'react-dom';
import { Client, PrivateKey } from '@hiveio/dhive';
import { KeyTypes, Providers } from '@aioha/aioha';
import { IoClose } from 'react-icons/io5';
import { useTranslation, Trans } from 'react-i18next';
import aioha, { setActiveAuthHandler } from '../../hive-api/aioha';
import { HIVE_API_NODES } from '../../utils/config';
import './ActiveAuthModal.scss';

const client = getHiveClient();

// Human-readable summary of what the user is about to sign.
function describeOps(operations, t) {
  try {
    return operations.map(([name, payload]) => {
      if (name === 'transfer') {
        return payload.memo
          ? t('auth.activeAuth.ops.transferMemo', { amount: payload.amount, to: payload.to, memo: payload.memo })
          : t('auth.activeAuth.ops.transfer', { amount: payload.amount, to: payload.to });
      }
      if (name === 'transfer_to_vesting') {
        return t('auth.activeAuth.ops.powerUp', { amount: payload.amount });
      }
      if (name === 'custom_json') {
        return t('auth.activeAuth.ops.customJson', { id: payload.id });
      }
      if (name === 'account_create' || name === 'create_claimed_account') {
        return t('auth.activeAuth.ops.createAccount', { name: payload.new_account_name });
      }
      return name.replace(/_/g, ' ');
    });
  } catch {
    return [t('auth.activeAuth.ops.fallback')];
  }
}

/**
 * Active-authority signing modal for Butter Auth sessions.
 *
 * A Butter Auth login only carries POSTING authority, so active-key ops
 * (transfers, tips, 3Speak Pro, power-ups…) can't be signed by the broker.
 * Instead of failing, aioha.js hands the operations here via
 * setActiveAuthHandler(). We explain the situation and let the user finish
 * the signature themselves — with a Hive wallet (the aioha picker), or a
 * pasted private active key (held in memory only for the single broadcast,
 * never stored).
 */
export default function ActiveAuthModal() {
  const { t } = useTranslation();
  // { operations, resolve, reject } while a request is in flight, else null
  const pending = useRef(null);
  const [ops, setOps] = useState(null);
  const [method, setMethod] = useState(null); // 'wallet' | 'key'
  const [activeKey, setActiveKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const username = (() => {
    try { return localStorage.getItem('user_id') || ''; } catch { return ''; }
  })();

  // Wallets the aioha instance has registered. We log in with the known
  // username so the user never has to type/confirm their account again.
  const WALLET_LABELS = {
    [Providers.Keychain]: 'Hive Keychain',
    [Providers.PeakVault]: 'PeakVault',
    [Providers.HiveAuth]: t('auth.activeAuth.hiveAuthMobile'),
    [Providers.Ledger]: 'Ledger',
    [Providers.HiveSigner]: 'HiveSigner',
  };
  const wallets = Object.keys(WALLET_LABELS).filter((p) => {
    try { return aioha.isProviderRegistered(p); } catch { return false; }
  });

  useEffect(() => {
    setActiveAuthHandler((operations) => {
      return new Promise((resolve, reject) => {
        pending.current = { operations, resolve, reject };
        setOps(operations);
        setMethod(null);
        setActiveKey('');
        setError('');
        setBusy(false);
      });
    });
    return () => setActiveAuthHandler(null);
  }, []);

  function settleResolve(result) {
    const p = pending.current;
    pending.current = null;
    setOps(null);
    if (p) p.resolve({ success: true, result });
  }

  function close() {
    const p = pending.current;
    pending.current = null;
    setOps(null);
    setActiveKey('');
    if (p) p.reject(new Error(t('auth.activeAuth.errors.cancelled')));
  }

  // Broadcast the pending ops with whatever wallet aioha is now logged into.
  async function signWithAioha() {
    setError('');
    setBusy(true);
    try {
      const res = await aioha.signAndBroadcastTx(pending.current.operations, KeyTypes.Active);
      if (res?.success) {
        settleResolve(res.result);
      } else {
        throw new Error(res?.error || t('auth.activeAuth.errors.walletRejected'));
      }
    } catch (e) {
      setError(e.message || t('auth.activeAuth.errors.walletFailed'));
      setBusy(false);
    }
  }

  // "Sign with Hive Wallet": reuse the existing aioha session if there is
  // one, otherwise show our own wallet list and log in with the known
  // username (skips aioha's "connect / enter account" step entirely).
  function startWalletSign() {
    setError('');
    if (aioha.isLoggedIn()) {
      signWithAioha();
    } else {
      setMethod('wallet');
    }
  }

  async function loginWithProvider(provider) {
    setError('');
    if (!username) { setError(t('auth.activeAuth.errors.noUsername')); return; }
    setBusy(true);
    try {
      const res = await aioha.login(provider, username, {
        msg: 'Authorize active transaction',
        keyType: KeyTypes.Active,
      });
      if (!res?.success) throw new Error(res?.error || t('auth.activeAuth.errors.connectFailed'));
      await signWithAioha();
    } catch (e) {
      setError(e.message || t('auth.activeAuth.errors.connectFailed'));
      setBusy(false);
    }
  }

  async function signWithKey() {
    setError('');
    if (!username) { setError(t('auth.activeAuth.errors.noUsername')); return; }
    let key;
    try {
      key = PrivateKey.fromString(activeKey.trim());
    } catch {
      setError(t('auth.activeAuth.errors.invalidKey'));
      return;
    }
    setBusy(true);
    try {
      const [acct] = await client.database.getAccounts([username]);
      if (!acct) throw new Error(t('auth.activeAuth.errors.accountNotFound', { username }));
      const pub = key.createPublic().toString();
      const activeKeys = (acct.active?.key_auths || []).map(([k]) => k);
      if (!activeKeys.includes(pub)) {
        throw new Error(t('auth.activeAuth.errors.notActiveKey', { username }));
      }
      const result = await client.broadcast.sendOperations(pending.current.operations, key);
      // Drop the key reference as soon as the broadcast resolves.
      key = null;
      setActiveKey('');
      settleResolve(result);
    } catch (e) {
      setError(e.message || t('auth.activeAuth.errors.broadcastFailed'));
      setBusy(false);
    }
  }

  if (!ops) return null;

  return createPortal(
    <div className="aauth-overlay" onClick={busy ? undefined : close}>
      <div className="aauth-content" onClick={(e) => e.stopPropagation()}>
        <button className="aauth-close" onClick={close} disabled={busy} aria-label={t('common.actions.cancel')}>
          <IoClose size={22} />
        </button>

        <h3 className="aauth-title">{t('auth.activeAuth.title')}</h3>
        <p className="aauth-desc">
          <Trans i18nKey="auth.activeAuth.desc" components={{ b: <strong /> }} />
        </p>

        <div className="aauth-ops">
          {describeOps(ops, t).map((line, i) => (
            <div key={i} className="aauth-op">{line}</div>
          ))}
        </div>

        {error && <div className="aauth-error">{error}</div>}

        {!method && (
          <div className="aauth-choices">
            <button className="aauth-btn primary" onClick={startWalletSign}>
              {t('auth.activeAuth.signWithWallet')}
            </button>
            <button className="aauth-btn" onClick={() => { setError(''); setMethod('key'); }}>
              {t('auth.activeAuth.signWithKey')}
            </button>
          </div>
        )}

        {method === 'wallet' && (
          <div className="aauth-panel">
            <p className="aauth-hint">
              <Trans i18nKey="auth.activeAuth.connectingAs" values={{ username }} components={{ b: <strong /> }} />
            </p>
            {wallets.map((p) => (
              <button
                key={p}
                className="aauth-btn"
                disabled={busy}
                onClick={() => loginWithProvider(p)}
              >
                {WALLET_LABELS[p]}
              </button>
            ))}
            {busy && <p className="aauth-hint">{t('auth.activeAuth.waitingWallet')}</p>}
            <button className="aauth-link" disabled={busy} onClick={() => setMethod(null)}>
              {t('auth.activeAuth.chooseAnother')}
            </button>
          </div>
        )}

        {method === 'key' && (
          <div className="aauth-panel">
            <p className="aauth-hint">
              <Trans i18nKey="auth.activeAuth.pasteKey" values={{ username }} components={{ b: <strong /> }} />
            </p>
            <input
              type="password"
              className="aauth-input"
              autoComplete="off"
              spellCheck={false}
              placeholder={t('auth.activeAuth.keyPlaceholder')}
              value={activeKey}
              onChange={(e) => setActiveKey(e.target.value)}
            />
            <button
              className="aauth-btn primary"
              disabled={busy || !activeKey.trim()}
              onClick={signWithKey}
            >
              {busy ? t('auth.activeAuth.broadcasting') : t('auth.activeAuth.signBroadcast')}
            </button>
            <button className="aauth-link" disabled={busy} onClick={() => setMethod(null)}>
              {t('auth.activeAuth.chooseAnother')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
