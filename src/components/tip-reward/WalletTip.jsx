import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { Button, ChoiceCard, Field, Banner, Icon } from '../v2/ui';
import { isAccountValid } from '../../hive-api/api';
import { queueSupport, recordSupport, dropPendingSupport } from '../../lib/supports';
import { CHECKER_URL } from '../../utils/config';
import { toastIn } from '../../utils/toast';
import { recurrentTransferOp, findMonthlySupport, MONTH_HOURS, isMonthly } from '../../lib/recurringTip';
import MonthlyField from './MonthlyField';
import { TIP_PRESETS } from './tipPresets';
import { cx } from '../v2/helpers';

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
 *
 * A monthly tip (lib/recurringTip.js) is one recurrent_transfer instead, and is
 * not reported: HiveSigner then only waits for Done.
 */
export default function WalletTip({ recipient, permlink, memoLink, onSent, onClose }) {
  const { t } = useTranslation();
  const uid = useId();
  const [stage, setStage] = useState('details'); // details | wallet | hivesigner
  const [user, setUser] = useState(readLastUser);
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('HIVE');
  const [memo, setMemo] = useState('');
  const [months, setMonths] = useState(0);
  // The monthly support this tipper already sends the creator (a new one replaces it).
  const [existing, setExisting] = useState(null);
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
      setExisting(months > 0 ? await findMonthlySupport(tipper, recipient).catch(() => null) : null);
    } finally {
      setBusy(null);
    }
    try { localStorage.setItem(LAST_USER_KEY, tipper); } catch { /* storage blocked */ }
    setStage('wallet');
  };

  const sent = (entry) => {
    if (entry) recordSupport(entry);
    onSent(value.toFixed(3), currency, months);
  };

  const failed = (entry, err) => {
    if (entry) dropPendingSupport(entry.id);
    toast.error(t('engagement.tip.wallet.errors.walletFailed', { message: err?.message || String(err || '') }));
  };

  const transferOp = () => (months > 0
    ? recurrentTransferOp({ from: tipper, to: recipient, amount: value, currency, memo: fullMemo, months })
    : ['transfer', { from: tipper, to: recipient, amount: `${value.toFixed(3)} ${currency}`, memo: fullMemo }]);

  // A single tip on a post is reported as a support; a monthly one is not.
  const queue = () => (months > 0 ? null
    : queueSupport({ tipper, author: recipient, permlink, amount: value, currency, memo: fullMemo }));

  const payKeychain = () => {
    const entry = queue();
    setBusy('keychain');
    const done = (res) => {
      setBusy(null);
      if (res && res.success) sent(entry);
      else failed(entry, { message: res?.message || res?.error });
    };
    const kc = window.hive_keychain;
    if (months > 0 && typeof kc.requestRecurrentTransfer === 'function') {
      kc.requestRecurrentTransfer(tipper, recipient, value.toFixed(3), currency, fullMemo, MONTH_HOURS, months, done);
    } else if (months > 0) {
      kc.requestBroadcast(tipper, [transferOp()], 'Active', done);
    } else {
      // `true`: Keychain must sign as exactly this account.
      kc.requestTransfer(tipper, recipient, value.toFixed(3), fullMemo, currency, done, true);
    }
  };

  const payPeakVault = async () => {
    const entry = queue();
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
    const entry = queue();
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

  const spin = <Icon name="progress_activity" size={18} className="v2-spin" />;

  if (stage === 'hivesigner') {
    return (
      <div className="tip-v2__invoice">
        <p className="v2-meta">{t('engagement.tip.wallet.waitingHiveSigner')}</p>
        {pending && (
          <p className="tip-v2__waiting">
            {spin}
            {t('engagement.tip.lightning.waiting')}
          </p>
        )}
        <div className="tip-v2__links">
          <Button variant="ghost" size={40} icon="arrow_back" onClick={() => setStage('wallet')}>
            {t('engagement.tip.lightning.back')}
          </Button>
          <Button variant="ghost" size={40} onClick={onClose}>
            {t('engagement.tip.lightning.done')}
          </Button>
        </div>
      </div>
    );
  }

  if (stage === 'wallet') {
    const keychain = typeof window !== 'undefined' && !!window.hive_keychain;
    const peakvault = typeof window !== 'undefined' && !!window.peakvault;
    return (
      <div className="tip-v2__form">
        <p className="v2-meta">
          {t('engagement.tip.wallet.signWith', { amount: value.toFixed(3), currency, user: tipper, recipient })}
        </p>
        {months > 0 && <p className="v2-meta-sm">{t('engagement.tip.monthly.note')}</p>}
        {months > 0 && existing && <p className="v2-meta-sm">{t(isMonthly(existing) ? 'engagement.tip.monthly.replaces' : 'engagement.tip.monthly.replacesOther', { recipient })}</p>}
        <div className="tip-v2__wallets" role="group">
          {keychain && (
            <ChoiceCard role="button" tone="cyan" selected={busy === 'keychain'} icon={busy === 'keychain' ? spin : 'key'} disabled={!!busy} onClick={payKeychain}
              title="Hive Keychain" />
          )}
          {peakvault && (
            <ChoiceCard role="button" tone="cyan" selected={busy === 'peakvault'} icon={busy === 'peakvault' ? spin : 'account_balance_wallet'} disabled={!!busy} onClick={payPeakVault}
              title="PeakVault" />
          )}
          <ChoiceCard role="button" tone="cyan" icon="open_in_new" disabled={!!busy} onClick={payHiveSigner}
            title="HiveSigner" />
        </div>
        {!keychain && !peakvault && <Banner tone="info">{t('engagement.tip.wallet.noExtension')}</Banner>}
        <div className="tip-v2__links">
          <Button variant="ghost" size={40} icon="arrow_back" onClick={() => setStage('details')}>
            {t('engagement.tip.lightning.back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="tip-v2__form">
      <div className="tip-v2__quick" role="group" aria-label={t('engagement.tip.amountLabel')}>
        {TIP_PRESETS.map((p) => {
          const on = parseFloat(amount) === p.value;
          return (
            <button key={p.value} type="button" className={cx('tip-v2__pill', on && 'is-on')} aria-pressed={on} title={t(`engagement.tip.presets.${p.key}`)} onClick={() => setAmount(String(p.value))}>
              <span className="num">{p.value}</span>
            </button>
          );
        })}
      </div>
      <Field
        label={t('engagement.tip.wallet.usernameLabel')}
        type="text"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t('engagement.tip.wallet.usernamePlaceholder')}
        value={user}
        onChange={(e) => setUser(e.target.value)}
      />
      <div className="tip-v2__row">
        <Field
          className="tip-v2__amount"
          label={t('engagement.tip.amountLabel')}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.001"
          placeholder={t('engagement.tip.amountPlaceholder')}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Field label={t('engagement.tip.currencyLabel')} className="tip-v2__currency" id={`${uid}-currency`}>
          <select id={`${uid}-currency`} className="v2-input is-select h48" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="HIVE">HIVE</option>
            <option value="HBD">HBD</option>
          </select>
        </Field>
      </div>
      <MonthlyField months={months} onChange={setMonths} recipient={recipient} />
      <Field
        label={t('engagement.tip.memoLabel')}
        type="text"
        placeholder={t('engagement.tip.memoPlaceholder')}
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        hint={memoLink ? t('engagement.tip.memoLinkNote', { link: memoLink }) : undefined}
      />
      <Button variant="primary" size={48} block next onClick={goToWallet} disabled={!!busy} loading={busy === 'next'}>
        {t('engagement.tip.wallet.next')}
      </Button>
    </div>
  );
}
