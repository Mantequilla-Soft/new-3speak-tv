import { useEffect, useRef, useState } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import { PrivateKey } from '@hiveio/dhive';
import { KeyTypes, Providers } from '@aioha/aioha';
import { useTranslation, Trans } from 'react-i18next';
import aioha, { setActiveAuthHandler } from '../../hive-api/aioha';
import { Dialog, Button, ChoiceCard, Field, Banner, Icon } from '../v2/ui';
import './ActiveAuthModal.scss';

// §11 "Sign with": each wallet as a choice card with its Material Symbol.
const WALLET_ICONS = {
  [Providers.Keychain]: 'extension',
  [Providers.PeakVault]: 'account_balance_wallet',
  [Providers.HiveAuth]: 'qr_code_2',
  [Providers.Ledger]: 'usb',
  [Providers.HiveSigner]: 'open_in_new',
};

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
  const [method, setMethod] = useState(null); // null = "Sign with" list | 'key'
  // The wallet being connected right now (its card shows as chosen).
  const [pendingProvider, setPendingProvider] = useState(null);
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
        setPendingProvider(null);
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
  // one. Without one, the "Sign with" list of wallets is already on screen and
  // logs in with the known username (skips aioha's "connect / enter account"
  // step entirely).
  function startWalletSign() {
    setError('');
    if (aioha.isLoggedIn()) {
      signWithAioha();
    } else {
      setMethod(null);
    }
  }

  async function loginWithProvider(provider) {
    setError('');
    if (!username) { setError(t('auth.activeAuth.errors.noUsername')); return; }
    setBusy(true);
    setPendingProvider(provider);
    // A Butter Auth login parks the user's wallet session in aioha's other
    // logins, and aioha.login() refuses a parked username ("Already logged
    // in"). Same wallet: switch back to it. Other wallet: drop the parked
    // entry so the fresh login can replace it (restored if that fails).
    let parked = null;
    try {
      const parkedProvider = aioha.getOtherLogins()[username];
      if (parkedProvider === provider && aioha.switchUser(username)) {
        await signWithAioha();
        return;
      }
      if (parkedProvider) parked = aioha.removeOtherLogin(username, false);
    } catch { /* fall through to a fresh login */ }
    try {
      const res = await aioha.login(provider, username, {
        msg: 'Authorize active transaction',
        keyType: KeyTypes.Active,
      });
      if (!res?.success) throw new Error(res?.error || t('auth.activeAuth.errors.connectFailed'));
      parked = null;
      await signWithAioha();
    } catch (e) {
      if (parked) {
        try { aioha.addOtherLogin(username, parked); } catch { /* ignore */ }
      }
      setError(e.message || t('auth.activeAuth.errors.connectFailed'));
      setBusy(false);
      setPendingProvider(null);
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

  // "← Choose another method": the arrow is drawn as an icon, not a character.
  const backLabel = t('auth.activeAuth.chooseAnother').replace(/^\s*[←<]\s*/, '');
  const walletSession = aioha.isLoggedIn();

  const footer = method === 'key' ? (
    <>
      <Button variant="ghost" icon="arrow_back" disabled={busy} onClick={() => { setError(''); setMethod(null); }}>
        {backLabel}
      </Button>
      <Button variant="primary" size={40} disabled={busy || !activeKey.trim()} loading={busy} onClick={signWithKey}>
        {busy ? t('auth.activeAuth.broadcasting') : t('auth.activeAuth.signBroadcast')}
      </Button>
    </>
  ) : null;

  return (
    <Dialog
      open
      onClose={close}
      dismissible={!busy}
      title={t('auth.activeAuth.title')}
      width={460}
      className="aauth-dialog"
      footer={footer}
    >
      <p className="aauth-desc">
        <Trans i18nKey="auth.activeAuth.desc" components={{ b: <strong /> }} />
      </p>

      <div className="v2-well aauth-ops">
        {describeOps(ops, t).map((line, i) => (
          <div key={i} className="aauth-op">{line}</div>
        ))}
      </div>

      {error && method !== 'key' && <Banner tone="warn">{error}</Banner>}

      {!method && (
        <>
          {walletSession ? (
            // A wallet is already connected: sign with it straight away.
            <Button variant="primary" size={48} block next loading={busy} disabled={busy} onClick={startWalletSign}>
              {t('auth.activeAuth.signWithWallet')}
            </Button>
          ) : (
            <>
              <p className="aauth-hint">
                <Trans i18nKey="auth.activeAuth.connectingAs" values={{ username }} components={{ b: <strong /> }} />
              </p>
              <div className="v2-choices is-grid aauth-wallets">
                {wallets.map((p) => (
                  <ChoiceCard
                    key={p}
                    role="button"
                    icon={WALLET_ICONS[p] || 'account_balance_wallet'}
                    title={WALLET_LABELS[p]}
                    selected={pendingProvider === p}
                    disabled={busy}
                    onClick={() => loginWithProvider(p)}
                  />
                ))}
              </div>
            </>
          )}
          {busy && (
            <div className="aauth-status" role="status">
              <Icon name="progress_activity" size={18} className="v2-spin" />
              <span>{t('auth.activeAuth.waitingWallet')}</span>
            </div>
          )}
          <ChoiceCard
            role="button"
            icon="key"
            title={t('auth.activeAuth.signWithKey')}
            disabled={busy}
            onClick={() => { setError(''); setMethod('key'); }}
          />
        </>
      )}

      {method === 'key' && (
        <>
          <p className="aauth-hint">
            <Trans i18nKey="auth.activeAuth.pasteKey" values={{ username }} components={{ b: <strong /> }} />
          </p>
          <Field
            type="password"
            className="aauth-key"
            autoComplete="off"
            spellCheck={false}
            aria-label={t('auth.activeAuth.keyPlaceholder')}
            placeholder={t('auth.activeAuth.keyPlaceholder')}
            value={activeKey}
            error={error || undefined}
            onChange={(e) => setActiveKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && activeKey.trim() && !busy) signWithKey(); }}
          />
        </>
      )}
    </Dialog>
  );
}
