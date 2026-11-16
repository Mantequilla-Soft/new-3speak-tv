import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DialogShell from '../modal/DialogShell';
import { Button, Field, Icon, Segmented, Banner } from '../v2/ui';
import { cx } from '../v2/helpers';
import { handleStateOnHive } from '../../hive-api/api';
import { broadcastWithAioha, KeyTypes, isLoggedIn, isManteAuthLogin } from '../../hive-api/aioha';
import { formatNumber } from '../../i18n';
import { toastIn } from '../../utils/toast';
import {
  POWER_DOWN_WEEKS, powerUpOp, powerDownOp, toSavingsOp, fromSavingsOp, convertOp, collateralizedConvertOp,
  delegateOp, removeDelegationOp, cancelPowerDownOp, hpToVests, newRequestId, collateralizedEstimate, convertEstimate,
  isAccountName,
} from '../../lib/walletOps';
import './TransferModal.scss';
import './WalletOpModal.scss';

const toast = toastIn('Wallet');
const fmt = (n, d = 3) => formatNumber(Number(n) || 0, { minimumFractionDigits: d, maximumFractionDigits: d });
const norm = (s) => String(s || '').trim().toLowerCase().replace(/^@/, '');

/**
 * Wallet > Power up / Power down / Savings / Convert / Delegate: one sheet with a
 * `mode`, the same look as Send (TransferModal). `state` is loadWalletState()
 * (lib/walletOps.js); `onDone` reloads it after a broadcast. Everything here is
 * an active-key operation through broadcastWithAioha, so a Butter Auth login is
 * asked to approve it with a Hive wallet or the active key (ActiveAuthModal).
 */
export default function WalletOpModal({ mode, user, state, onClose, onDone }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState(mode === 'delegate' ? '' : user);
  const [sub, setSub] = useState(mode === 'convert' ? 'hbd' : 'deposit');
  const [coin, setCoin] = useState('HBD');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  // One broadcast at a time: set before the first await, so a second tap while
  // the account is being checked does nothing (a re-render would come too late).
  const lock = useRef(false);

  const s = state || {};
  const target = norm(to);
  const existing = mode === 'delegate' ? (s.delegations || []).find((d) => d.delegatee === target) : null;

  // What the amount is in, and how much of it there is.
  let unit = 'HIVE';
  let available = s.hive || 0;
  if (mode === 'powerDown') { unit = 'HP'; available = s.freeHp || 0; }
  // A running power down's remaining VESTS can't be delegated (lib/walletOps.js delegatableVests).
  if (mode === 'delegate') { unit = 'HP'; available = (s.delegatableHp ?? s.freeHp ?? 0) + (existing?.hp || 0); }
  if (mode === 'savings') {
    unit = coin;
    available = sub === 'deposit' ? (coin === 'HBD' ? s.hbd : s.hive) : (coin === 'HBD' ? s.savingsHbd : s.savingsHive);
  }
  if (mode === 'convert') { unit = sub === 'hbd' ? 'HBD' : 'HIVE'; available = sub === 'hbd' ? s.hbd : s.hive; }
  available = Number(available) || 0;

  // Cut to 3 decimals here, so the button says exactly what is signed (the
  // builders round down to the asset's precision the same way).
  const n = Math.floor((parseFloat(amount) || 0) * 1000 + 1e-7) / 1000;
  const shown = n > 0 ? formatNumber(n, { maximumFractionDigits: 3 }) : null;

  // `key` names the button that shows the spinner; every button is off meanwhile.
  const once = async (key, fn) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(key);
    try {
      await fn();
    } finally {
      lock.current = false;
      setBusy(null);
    }
  };

  const run = async (ops, doneText) => {
    if (!isLoggedIn()) { toast.error(t('wallet.transferModal.loginRequired')); return; }
    try {
      await broadcastWithAioha(ops, KeyTypes.Active);
      toast.success(doneText || t('walletOps.common.done'));
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(t('walletOps.common.failed', { error: err?.message || '' }));
    }
  };

  const build = () => {
    // Never more VESTS than the account can give (Max, rounding of HP to VESTS).
    const cap = mode === 'powerDown' ? s.freeVests : (s.delegatableVests ?? s.freeVests ?? 0) + (existing?.vests || 0);
    const vests = (hp) => Math.min(hpToVests(hp, s.dgp), cap);
    // 0 VESTS would STOP the power down or REMOVE the delegation (no chain rate,
    // nothing free): never sent from here, only from the Stop and Remove buttons.
    const someVests = (hp) => { const v = vests(hp); return v >= 1e-6 ? v : null; };
    switch (mode) {
      case 'powerUp': return powerUpOp({ from: user, to: target || user, amount: n });
      case 'powerDown': { const v = someVests(n); return v ? powerDownOp({ account: user, vests: v }) : null; }
      case 'delegate': { const v = someVests(n); return v ? delegateOp({ delegator: user, delegatee: target, vests: v }) : null; }
      case 'savings': return sub === 'deposit'
        ? toSavingsOp({ from: user, to: target || user, amount: n, currency: coin })
        : fromSavingsOp({ from: user, to: user, amount: n, currency: coin, requestId: newRequestId((s.withdrawals || []).map((w) => w.requestId)) });
      case 'convert': {
        const requestId = newRequestId((s.conversions || []).map((c) => c.requestId));
        return sub === 'hbd' ? convertOp({ owner: user, amount: n, requestId }) : collateralizedConvertOp({ owner: user, amount: n, requestId });
      }
      default: return null;
    }
  };

  const submit = () => once('submit', async () => {
    setError('');
    if (!(n > 0)) { setError(t('walletOps.common.amountPositive')); return; }
    if (n > available + 1e-9) { setError(t('walletOps.common.insufficient')); return; }
    const needsTo = mode === 'delegate' || (mode === 'powerUp' && target !== user) || (mode === 'savings' && sub === 'deposit' && target !== user);
    if (mode === 'delegate' && target === user) { setError(t('walletOps.delegate.self')); return; }
    if (needsTo) {
      if (!isAccountName(target)) { setError(t('walletOps.common.invalidAccount')); return; }
      // 'unknown' = no node answered: say so, not "no such account".
      const found = await handleStateOnHive(target);
      if (found === 'unknown') { setError(t('walletOps.common.accountCheckFailed')); return; }
      if (found !== 'taken') { setError(t('walletOps.common.invalidAccount')); return; }
    }
    const op = build();
    if (!op) { setError(t('walletOps.common.amountPositive')); return; }
    await run([op]);
  });

  const stopPowerDown = () => once('stop', () => run([cancelPowerDownOp({ account: user })], t('walletOps.powerDown.stopped')));
  const removeDelegation = (delegatee) => once(`rm:${delegatee}`, () => run([removeDelegationOp({ delegator: user, delegatee })], t('walletOps.delegate.removed')));

  // The button says exactly what will happen.
  let label = t(`walletOps.${mode}.title`);
  if (shown) {
    if (mode === 'powerUp') label = target && target !== user ? t('walletOps.powerUp.submitTo', { amount: shown, to: target }) : t('walletOps.powerUp.submit', { amount: shown });
    if (mode === 'powerDown') label = t('walletOps.powerDown.submit', { amount: shown });
    if (mode === 'delegate') label = target ? t('walletOps.delegate.submit', { amount: shown, to: target }) : t('walletOps.delegate.submitNoTo', { amount: shown });
    if (mode === 'savings') label = t(sub === 'deposit' ? 'walletOps.savings.submitDeposit' : 'walletOps.savings.submitWithdraw', { amount: shown, coin });
    if (mode === 'convert') label = t('walletOps.convert.submit', { amount: shown, coin: unit });
  }

  const showTo = mode === 'powerUp' || mode === 'delegate' || (mode === 'savings' && sub === 'deposit');
  const rate = s.dgp?.hbd_interest_rate != null ? formatNumber(s.dgp.hbd_interest_rate / 100, { maximumFractionDigits: 2 }) : null;

  return (
    <DialogShell
      open
      onClose={busy ? undefined : onClose}
      side
      tone="text"
      title={t(`walletOps.${mode}.title`)}
      width={420}
      className="transfer-v2 wallet-op"
      footer={(
        <>
          <div className="dlg-note transfer-v2__key"><span><Icon name="key" size={16} />{t('walletOps.common.activeKey')}</span></div>
          <Button variant="inverse" size={48} block className="dlg-main" trailing="arrow_forward" loading={busy === 'submit'} disabled={!!busy || !state || !shown || (mode === 'delegate' && !target)} onClick={submit}>
            {label}
          </Button>
        </>
      )}
    >
      {!state && <p className="v2-meta">{t('walletOps.common.loading')}</p>}

      {mode === 'savings' && (
        <Segmented value={sub} onChange={(v) => { setSub(v); setError(''); }} options={[
          { value: 'deposit', label: t('walletOps.savings.deposit') },
          { value: 'withdraw', label: t('walletOps.savings.withdraw') },
        ]} />
      )}
      {mode === 'convert' && (
        <Segmented value={sub} onChange={(v) => { setSub(v); setError(''); }} options={[
          { value: 'hbd', label: t('walletOps.convert.hbdToHive') },
          { value: 'hive', label: t('walletOps.convert.hiveToHbd') },
        ]} />
      )}

      {showTo && (
        <Field
          id="wallet-op-to"
          label={mode === 'delegate' ? t('walletOps.delegate.toLabel') : t('walletOps.common.to')}
          hint={mode === 'delegate' ? undefined : t('walletOps.common.toHint')}
          value={to}
          onChange={(e) => { setTo(e.target.value); setError(''); }}
          placeholder={t('wallet.transferModal.recipientPlaceholder')}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
      )}

      <div className={cx('transfer-v2__amount', error && 'is-error')}>
        <label className="v2-eyebrow" htmlFor="wallet-op-amount">{t('walletOps.common.amount', { coin: unit })}</label>
        <input id="wallet-op-amount" type="number" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setError(''); }} placeholder="0.000" step="0.001" min="0" aria-invalid={!!error} />
      </div>

      {mode === 'savings' && (
        <div className="transfer-v2__coins" role="radiogroup" aria-label={t('engagement.tip.currencyLabel').replace(/:\s*$/, '')}>
          {['HBD', 'HIVE'].map((c) => (
            <button key={c} type="button" role="radio" aria-checked={coin === c} className={cx('v2-chip', coin === c && 'is-on')} onClick={() => { setCoin(c); setError(''); }}>{c}</button>
          ))}
        </div>
      )}

      <div className="transfer-v2__meta">
        <span>{t('walletOps.common.available', { balance: `${fmt(available)} ${unit}` })}</span>
        <button type="button" className="transfer-v2__max" onClick={() => setAmount((Math.floor(available * 1000) / 1000).toFixed(3))}>{t('walletOps.common.max')}</button>
      </div>
      {error && <div className="v2-field__err" role="alert">{error}</div>}

      {mode === 'powerUp' && <Banner tone="info" icon="bolt">{t('walletOps.powerUp.note')}</Banner>}

      {mode === 'powerDown' && (
        <>
          <Banner tone="info" icon="schedule">{t('walletOps.powerDown.note', { weekly: fmt((n > 0 ? n : available) / POWER_DOWN_WEEKS) })}</Banner>
          {s.powerDown && (
            <div className="wallet-op__running">
              <span>{t('walletOps.powerDown.replace', { left: fmt(s.powerDown.leftHp) })}</span>
              <Button variant="danger" size={36} onClick={stopPowerDown} loading={busy === 'stop'} disabled={!!busy}>{t('walletOps.powerDown.stop')}</Button>
            </div>
          )}
        </>
      )}

      {mode === 'savings' && (
        <Banner tone="info" icon="savings">
          {sub === 'withdraw' ? t('walletOps.savings.withdrawNote')
            : coin === 'HBD' && rate ? t('walletOps.savings.depositNote', { rate }) : t('walletOps.savings.depositNoteHive')}
        </Banner>
      )}

      {mode === 'convert' && (
        <>
          <Banner tone="info" icon="swap_horiz">
            {sub === 'hbd'
              ? t('walletOps.convert.hbdNote', { amount: fmt(convertEstimate(n > 0 ? n : 0, s.hbdPerHive)) })
              : t('walletOps.convert.hiveNote', { amount: fmt(collateralizedEstimate(n > 0 ? n : 0, s.hbdPerHive)) })}
          </Banner>
          <Banner tone="warn">{t('walletOps.convert.warning')}</Banner>
        </>
      )}

      {mode === 'delegate' && (
        <>
          {existing && <p className="v2-meta">{t('walletOps.delegate.current', { hp: fmt(existing.hp), to: existing.delegatee })}</p>}
          <Banner tone="info" icon="group_add">{t('walletOps.delegate.note')}</Banner>
          {s.delegations?.length > 0 && (
            <div className="wallet-op__list">
              <div className="v2-eyebrow">{t('walletOps.delegate.yours')}</div>
              <ul>
                {s.delegations.map((d) => (
                  <li key={d.delegatee}>
                    <button type="button" className="wallet-op__pick" onClick={() => setTo(d.delegatee)}>@{d.delegatee}</button>
                    <span className="num">{fmt(d.hp)} HP</span>
                    <Button variant="danger" size={32} onClick={() => removeDelegation(d.delegatee)} loading={busy === `rm:${d.delegatee}`} disabled={!!busy}>
                      {t('walletOps.delegate.remove')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {isManteAuthLogin() && <p className="v2-meta-sm">{t('walletOps.common.butrauth')}</p>}
    </DialogShell>
  );
}
