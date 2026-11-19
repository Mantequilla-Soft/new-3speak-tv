import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../v2/ui';
import { broadcastWithAioha, KeyTypes } from '../../hive-api/aioha';
import { formatNumber, formatDate } from '../../i18n';
import { toastIn } from '../../utils/toast';
import { cancelPowerDownOp, cancelSavingsWithdrawOp, removeDelegationOp } from '../../lib/walletOps';

const toast = toastIn('Wallet');
const fmt = (n) => formatNumber(Number(n) || 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * Wallet side card "In progress": the running power down, savings withdrawals on
 * their way, conversions and outgoing delegations, each with its undo where Hive
 * has one (stop, cancel, remove). `state` is loadWalletState(); `own` shows the
 * buttons; `onChanged` reloads after one of them went through.
 */
export default function WalletPending({ user, state, own, onChanged }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(null);
  if (!state) return null;
  const { powerDown, withdrawals = [], conversions = [], delegations = [] } = state;
  const date = (d) => (d ? formatDate(d, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const empty = !powerDown && !withdrawals.length && !conversions.length && !delegations.length;

  const run = async (key, op, doneText) => {
    setBusy(key);
    try {
      await broadcastWithAioha([op], KeyTypes.Active);
      toast.success(doneText);
      onChanged?.();
    } catch (err) {
      toast.error(t('walletOps.common.failed', { error: err?.message || '' }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="wallet-v2__card wallet-v2__pending">
      <div className="wallet-v2__card-head"><b>{t('walletOps.pending.title')}</b></div>
      {empty && <div className="wallet-v2__card-sub">{t('walletOps.pending.empty')}</div>}
      <ul>
        {powerDown && (
          <li>
            <Icon name="trending_down" size={18} />
            <div>
              <b>{t('walletOps.pending.powerDown', { weekly: fmt(powerDown.weeklyHp), weeks: powerDown.weeksLeft })}</b>
              <span>{t('walletOps.pending.nextPayment', { date: date(powerDown.next) })}</span>
            </div>
            {own && (
              <Button variant="danger" size={32} loading={busy === 'pd'} disabled={!!busy}
                onClick={() => run('pd', cancelPowerDownOp({ account: user }), t('walletOps.powerDown.stopped'))}>
                {t('walletOps.pending.stop')}
              </Button>
            )}
          </li>
        )}
        {withdrawals.map((w) => (
          <li key={`w${w.requestId}`}>
            <Icon name="savings" size={18} />
            <div>
              <b>{t('walletOps.pending.withdrawal', { amount: `${fmt(w.amount)} ${w.symbol}` })}</b>
              <span>{t('walletOps.pending.arrives', { date: date(w.complete) })}</span>
            </div>
            {own && (
              <Button variant="secondary" size={32} loading={busy === `w${w.requestId}`} disabled={!!busy}
                onClick={() => run(`w${w.requestId}`, cancelSavingsWithdrawOp({ from: user, requestId: w.requestId }), t('walletOps.pending.cancelled'))}>
                {t('walletOps.pending.cancel')}
              </Button>
            )}
          </li>
        ))}
        {conversions.map((c) => (
          <li key={`c${c.kind}${c.requestId}`}>
            <Icon name="swap_horiz" size={18} />
            <div>
              <b>{c.kind === 'hbd'
                ? t('walletOps.pending.convertHbd', { amount: `${fmt(c.amount)} ${c.symbol}` })
                : t('walletOps.pending.convertHive', { amount: `${fmt(c.amount)} ${c.symbol}` })}</b>
              <span>{t('walletOps.pending.ready', { date: date(c.date) })}</span>
            </div>
          </li>
        ))}
        {delegations.map((d) => (
          <li key={`d${d.delegatee}`}>
            <Icon name="group_add" size={18} />
            <div><b>{t('walletOps.pending.delegation', { to: d.delegatee, hp: fmt(d.hp) })}</b></div>
            {own && (
              <Button variant="secondary" size={32} loading={busy === `d${d.delegatee}`} disabled={!!busy}
                onClick={() => run(`d${d.delegatee}`, removeDelegationOp({ delegator: user, delegatee: d.delegatee }), t('walletOps.delegate.removed'))}>
                {t('walletOps.delegate.remove')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
