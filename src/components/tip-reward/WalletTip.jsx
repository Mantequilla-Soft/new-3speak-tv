import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { LineSpinner } from 'ldrs/react';
import 'ldrs/react/LineSpinner.css';
import { isAccountValid } from '../../hive-api/api';
import { queueSupport, recordSupport, dropPendingSupport } from '../../lib/supports';
import { CHECKER_URL } from '../../utils/config';
import { toastIn } from '../../utils/toast';

const toast = toastIn('Tip');

const USER_RE = /^[a-z][a-z0-9.-]{2,15}$/;
// Per-viewer convenience: the last username typed here, so a second tip skips it.
const LAST_USER_KEY = 'tip-wallet-user';
// The checker allows 30 support reports per tipper per 10 minutes.
const CONFIRM_EVERY_MS = 20000;
const CONFIRM_FOR_MS = 15 * 60 * 1000;

// Same URL-safe Base64 as hive:// links (@aioha/aioha lib/hive-uri.js).
const B64U = { '/': '_', '+': '-', '=': '.' };
const b64u = (str) => btoa(unescape(encodeURIComponent(str))).replace(/[+/=]/g, (m) => B64U[m]);

const readLastUser = () => {
  try { return localStorage.getItem(LAST_USER_KEY) || ''; } catch { return ''; }
};

/**
 * The HIVE / HBD tab of the /tip page (TipModal variant="page"). That page is
 * opened from embeds on other sites, so it never uses a 3speak.tv session: the
 * viewer types their Hive username, then signs the transfer with a wallet of
 * their choice. Keychain and PeakVault are called directly (not through aioha,
 * whose login would become the site's session in this browser); HiveSigner
 * needs no extension at all.
 *
 * A tip on a post is reported as a support like any other. Keychain and
 * PeakVault say when it is sent; for HiveSigner, which signs in its own window,
 * this asks the checker until it finds the transfer on chain.
 */
export default function WalletTip({ recipient, permlink, memoLink, onSent, onClose }) {
  const { t } = useTranslation();
  const [stage, setStage] = useState('details'); // details | wallet | hivesigner
  const [user, setUser] = useState(readLastUser);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('HIVE');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(null);
  const [pending, setPending] = useState(null);

  const tipper = user.trim().toLowerCase().replace(/^@/, '');
  const value = parseFloat(amount);
  const fullMemo = (() => {
    const typed = memo.trim();
    return memoLink && !typed.includes(memoLink) ? (typed ? `${typed} ${memoLink}` : memoLink) : typed;
  })();

  const goToWallet = async () => {
    if (!USER_RE.test(tipper)) { toast.error(t('engagement.tip.wallet.errors.noUser')); return; }
    if (tipper === recipient) { toast.error(t('engagement.tip.wallet.errors.self')); return; }
    if (!(value > 0)) { toast.error(t('engagement.tip.errors.allRequired')); return; }
    setBusy('next');
    try {
      if (!(await isAccountValid(tipper))) { toast.error(t('engagement.tip.lightning.errors.noAccount')); return; }
    } finally {
      setBusy(null);
    }
    try { localStorage.setItem(LAST_USER_KEY, tipper); } catch { /* storage blocked */ }
    setStage('wallet');
  };

  const sent = (entry) => {
    if (entry) recordSupport(entry);
    onSent(value.toFixed(3), currency);
  };

  const failed = (entry, err) => {
    if (entry) dropPendingSupport(entry.id);
    toast.error(t('engagement.tip.wallet.errors.walletFailed', { message: err?.message || String(err || '') }));
  };

  const transferOp = () => ['transfer', {
    from: tipper, to: recipient, amount: `${value.toFixed(3)} ${currency}`, memo: fullMemo,
  }];

  const payKeychain = () => {
    const entry = queueSupport({ tipper, author: recipient, permlink, amount: value, currency, memo: fullMemo });
    setBusy('keychain');
    // `true`: Keychain must sign as exactly this account.
    window.hive_keychain.requestTransfer(tipper, recipient, value.toFixed(3), fullMemo, currency, (res) => {
      setBusy(null);
      if (res && res.success) sent(entry);
      else failed(entry, { message: res?.message || res?.error });
    }, true);
  };

  const payPeakVault = async () => {
    const entry = queueSupport({ tipper, author: recipient, permlink, amount: value, currency, memo: fullMemo });
    setBusy('peakvault');
    try {
      const res = await window.peakvault.requestBroadcast(tipper, [transferOp()], 'active');
      if (res && res.success === false) throw new Error(res.error || res.message);
      sent(entry);
    } catch (err) {
      failed(entry, err);
    } finally {
      setBusy(null);
    }
  };

  const payHiveSigner = () => {
    const entry = queueSupport({ tipper, author: recipient, permlink, amount: value, currency, memo: fullMemo });
    // The same link aioha opens for a HiveSigner signature (hive://sign/ops/...).
    window.open(`https://hivesigner.com/sign/ops/${b64u(JSON.stringify([transferOp()]))}`, '_blank', 'noopener');
    setPending(entry);
    setStage('hivesigner');
  };

  // HiveSigner signs in its own window: ask the checker until the transfer is on
  // chain (a tip without a post can't be reported, so that one just waits for Done).
  useEffect(() => {
    if (stage !== 'hivesigner' || !pending) return undefined;
    let stopped = false;
    let timer;
    const started = Date.now();
    const check = async () => {
      if (stopped) return;
      try {
        const res = await axios.post(`${CHECKER_URL}/supports/record`, {
          tipper: pending.tipper, author: pending.author, permlink: pending.permlink,
          amount: pending.amount, currency: pending.currency, memo: pending.memo,
        }, { validateStatus: (s) => s === 200 || s === 202 });
        if (stopped) return;
        if (res.status === 200) {
          dropPendingSupport(pending.id);
          onSent(Number(pending.amount).toFixed(3), pending.currency);
          return;
        }
      } catch { /* a blip: ask again next round */ }
      if (Date.now() - started < CONFIRM_FOR_MS) timer = setTimeout(check, CONFIRM_EVERY_MS);
    };
    timer = setTimeout(check, CONFIRM_EVERY_MS);
    return () => { stopped = true; clearTimeout(timer); };
  }, [stage, pending]); // eslint-disable-line react-hooks/exhaustive-deps

  if (stage === 'hivesigner') {
    return (
      <div className="tip-modal-in">
        <div className="lightning-invoice">
          <p className="tip-method-note">{t('engagement.tip.wallet.waitingHiveSigner')}</p>
          {pending && (
            <p className="lightning-waiting">
              <LineSpinner size="12" stroke="2" speed="1" color="currentColor" />
              {t('engagement.tip.lightning.waiting')}
            </p>
          )}
          <div className="lightning-links">
            <button type="button" className="lightning-done" onClick={() => setStage('wallet')}>
              {t('engagement.tip.lightning.back')}
            </button>
            <button type="button" className="lightning-done" onClick={onClose}>
              {t('engagement.tip.lightning.done')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'wallet') {
    const keychain = typeof window !== 'undefined' && !!window.hive_keychain;
    const peakvault = typeof window !== 'undefined' && !!window.peakvault;
    return (
      <div className="tip-modal-in">
        <div className="form">
          <p className="tip-method-note">
            {t('engagement.tip.wallet.signWith', { amount: value.toFixed(3), currency, user: tipper, recipient })}
          </p>
          <div className="wallet-choices">
            {keychain && (
              <button type="button" className="send-btn" onClick={payKeychain} disabled={!!busy}>
                {busy === 'keychain' ? <LineSpinner size="14" stroke="2" speed="1" color="currentColor" /> : 'Hive Keychain'}
              </button>
            )}
            {peakvault && (
              <button type="button" className="send-btn" onClick={payPeakVault} disabled={!!busy}>
                {busy === 'peakvault' ? <LineSpinner size="14" stroke="2" speed="1" color="currentColor" /> : 'PeakVault'}
              </button>
            )}
            <button type="button" className="send-btn" onClick={payHiveSigner} disabled={!!busy}>HiveSigner</button>
          </div>
          {!keychain && !peakvault && <p className="tip-method-note">{t('engagement.tip.wallet.noExtension')}</p>}
          <div className="lightning-links">
            <button type="button" className="lightning-done" onClick={() => setStage('details')}>
              {t('engagement.tip.lightning.back')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tip-modal-in">
      <div className="form">
        <div className="field">
          <label>{t('engagement.tip.wallet.usernameLabel')}</label>
          <input
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t('engagement.tip.wallet.usernamePlaceholder')}
            value={user}
            onChange={(e) => setUser(e.target.value)}
          />
        </div>
        <div className="field">
          <label>{t('engagement.tip.amountLabel')}</label>
          <input
            type="number"
            min="0"
            step="0.001"
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
        </div>
        <div className="field">
          <label>{t('engagement.tip.memoLabel')}</label>
          <input
            type="text"
            placeholder={t('engagement.tip.memoPlaceholder')}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
          />
          {memoLink && <div className="memo-link-note">{t('engagement.tip.memoLinkNote', { link: memoLink })}</div>}
        </div>
        <div className="actions">
          <button className="send-btn" onClick={goToWallet} disabled={!!busy}>
            {busy === 'next' ? <LineSpinner size="14" stroke="2" speed="1" color="currentColor" /> : t('engagement.tip.wallet.next')}
          </button>
        </div>
      </div>
    </div>
  );
}
