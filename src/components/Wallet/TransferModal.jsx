import React, { useState } from 'react'
import "./TransferModal.scss"
import {isAccountValid} from "../../hive-api/api"
import { transferWithAioha, isLoggedIn } from "../../hive-api/aioha"
import { toastIn } from '../../utils/toast';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n';
import { Dialog, Button, Field, Icon, Avatar } from '../v2/ui';
import { cx } from '../v2/helpers';

// Every toast from this module is headed "Wallet"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Wallet');

const COINS = ['HBD', 'HIVE'];

/**
 * Send HIVE or HBD (design 17f): recent recipients, a big amount, the coin,
 * the memo, and one button that says exactly what will be sent to whom.
 * `recent` (optional) is a list of account names this wallet sent to lately,
 * `prices` (optional) the USD price per coin ({ HIVE, HBD }).
 */
function TransferModal({showModal, selectedCoin, balances, recent = [], prices}) {
    const { t } = useTranslation();
    const [amount, setAmount] = useState('');
    const [recipient, setRecipient] = useState('');
    const [memo, setMemo] = useState('');
    const [coin, setCoin] = useState(selectedCoin?.name === 'HBD' ? 'HBD' : 'HIVE');
    const [error, setError] = useState("")
    const [balErr, setBalErr] = useState("")
    const [sending, setSending] = useState(false)

    const balance = coin === "HIVE" ? balances.hive : balances.hbd;
    const usdPrice = prices?.[coin] ?? (coin === selectedCoin?.name ? selectedCoin?.usdPrice : (coin === 'HBD' ? 1 : null));

    const handleSubmitTransfer = async (coinType) => {
        if (!amount || !recipient || !coinType) return;

        if (!isLoggedIn()) {
            toast.error(t('wallet.transferModal.loginRequired'));
            return;
        }

        if (parseFloat(amount) > balance) {
            setBalErr(t('wallet.transferModal.insufficient'));
            return;
        } else {
            setBalErr("");
        }

        const valid = await isAccountValid(recipient);
        if (!valid) {
            setError(t('wallet.transferModal.invalidUsername'));
            return;
        } else {
            setError("");
        }

        try {
            setSending(true);
            await transferWithAioha(recipient, parseFloat(amount), coinType, memo || '');
            toast.success(t('wallet.transferModal.success'));
            showModal(false);
        } catch (error) {
            console.error('Transfer failed:', error);
            toast.error(t('wallet.transferModal.failed', { error: error.message }));
        } finally {
            setSending(false);
        }
    };

    const fmt = (n) => formatNumber(n || 0, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    const shownAmount = amount && parseFloat(amount) > 0 ? formatNumber(parseFloat(amount), { maximumFractionDigits: 3 }) : null;
    const to = recipient.replace(/^@/, '').trim();
    const label = shownAmount
      ? (to ? t('wallet.transferModal.sendTo', { amount: shownAmount, coin, to }) : t('wallet.transferModal.sendAmount', { amount: shownAmount, coin }))
      : t('wallet.transferModal.confirm');
    const recents = [...new Set(recent.filter(Boolean))].slice(0, 5);

  return (
    <Dialog
      open
      onClose={() => showModal(false)}
      title={t('common.actions.send')}
      closeLabel={t('common.actions.close')}
      width={480}
      className="transfer-v2"
      footer={(
        <div className="transfer-v2__foot">
          <div className="transfer-v2__key"><Icon name="key" size={18} />{t('wallet.transferModal.activeKey')}</div>
          <Button
            variant="primary"
            size={48}
            block
            className="is-next"
            trailing="send"
            loading={sending}
            disabled={sending || !amount || !to}
            onClick={() => handleSubmitTransfer(coin)}
          >
            {label}
          </Button>
        </div>
      )}
    >
      {recents.length > 0 && (
        <div className="transfer-v2__recent">
          <div className="v2-eyebrow">{t('wallet.transferModal.recent')}</div>
          <div className="transfer-v2__people">
            {recents.map((name) => (
              <button key={name} type="button" className={cx('transfer-v2__person', to === name && 'is-on')} onClick={() => { setRecipient(name); setError(''); }}>
                <Avatar src={`/img/u/${name}/avatar/small`} name={name} size={52} />
                <span>{name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Field
        label={t('wallet.transferModal.recipientLabel')}
        error={error || undefined}
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder={t('wallet.transferModal.recipientPlaceholder')}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />

      <div className={cx('transfer-v2__amount', balErr && 'is-error')}>
        <label className="v2-eyebrow" htmlFor="transfer-amount">{t('wallet.transferModal.amountLabel', { coin })}</label>
        <input
          id="transfer-amount"
          type="number"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.000"
          step="0.001"
          min="0"
          aria-invalid={!!balErr}
        />
      </div>

      <div className="transfer-v2__coins" role="radiogroup" aria-label={t('wallet.transferModal.amountLabel', { coin })}>
        {COINS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={coin === c} className={cx('v2-chip', coin === c && 'is-on')} onClick={() => { setCoin(c); setBalErr(''); }}>
            {c}
          </button>
        ))}
      </div>

      <div className="transfer-v2__meta">
        {usdPrice && shownAmount ? <span>≈ {formatNumber(parseFloat(amount) * usdPrice, { style: 'currency', currency: 'USD' })} · </span> : null}
        <span>{t('wallet.transferModal.available', { balance: `${fmt(balance)} ${coin}` })}</span>
        <button type="button" className="transfer-v2__max" onClick={() => setAmount(balance)}>{t('wallet.transferModal.max')}</button>
      </div>
      {balErr && <div className="v2-field__err" role="alert">{balErr}</div>}

      <Field
        label={t('wallet.transferModal.memoLabel')}
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        placeholder={t('wallet.transferModal.memoPlaceholder')}
      />
    </Dialog>
  )
}

export default TransferModal
