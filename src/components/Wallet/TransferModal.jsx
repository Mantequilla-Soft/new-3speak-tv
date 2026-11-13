import React, { useState } from 'react'
import "./TransferModal.scss"
import {isAccountValid} from "../../hive-api/api"
import { transferWithAioha, isLoggedIn } from "../../hive-api/aioha"
import { toastIn } from '../../utils/toast';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n';
import { Button, Field, Icon, IconButton, Avatar } from '../v2/ui';
import { parseScannedRecipient } from '../../lib/scannedRecipient';
import QrScanSheet from './QrScanSheet';
import { cx } from '../v2/helpers';
import DialogShell from '../modal/DialogShell';

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
    // Scan the other person's QR code (owner 2026-11-12): where the browser can
    // open a camera at all (a secure page with mediaDevices).
    const canScan = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
    const [scanning, setScanning] = useState(false);
    const [scanNote, setScanNote] = useState('');
    const onScanned = (text) => {
        const found = parseScannedRecipient(text);
        // Not an account (a link, a Wi-Fi code): say so and keep the camera on.
        if (!found) { setScanNote(t('wallet.transferModal.scanNoAccount')); return; }
        setScanning(false);
        setScanNote('');
        setRecipient(found.to);
        setError('');
        // A Hive transfer request can ask for an amount, a coin and a memo too.
        if (found.amount) setAmount(found.amount);
        if (found.coin && COINS.includes(found.coin)) setCoin(found.coin);
        if (found.memo) setMemo(found.memo);
    };

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
    <DialogShell
      open
      onClose={() => showModal(false)}
      side
      tone="text"
      title={t('common.actions.send')}
      width={420}
      className="transfer-v2"
      footer={(
        <>
          <div className="dlg-note transfer-v2__key"><span><Icon name="key" size={16} />{t('wallet.transferModal.activeKey')}</span></div>
          <Button
            variant="inverse"
            size={48}
            block
            className="dlg-main"
            trailing="send"
            loading={sending}
            disabled={sending || !amount || !to}
            onClick={() => handleSubmitTransfer(coin)}
          >
            {label}
          </Button>
        </>
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

      <Field id="transfer-recipient" label={t('wallet.transferModal.recipientLabel')} error={error || undefined}>
        <div className="transfer-v2__to">
          <input
            id="transfer-recipient"
            className="v2-input"
            aria-invalid={!!error}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder={t('wallet.transferModal.recipientPlaceholder')}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
          {canScan && (
            <IconButton icon="qr_code_scanner" label={t('wallet.transferModal.scan')} size={44} onClick={() => { setScanNote(''); setScanning(true); }} />
          )}
        </div>
      </Field>
      {scanning && <QrScanSheet onResult={onScanned} onClose={() => setScanning(false)} note={scanNote} />}

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

      <div className="transfer-v2__coins" role="radiogroup" aria-label={t('engagement.tip.currencyLabel').replace(/:\s*$/, '')}>
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
    </DialogShell>
  )
}

export default TransferModal
