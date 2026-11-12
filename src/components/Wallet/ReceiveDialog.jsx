import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { Dialog, Field } from '../v2/ui';
import { cx } from '../v2/helpers';
import { formatNumber } from '../../i18n';
import { receiveCode } from '../../lib/scannedRecipient';

const COINS = ['HIVE', 'HBD'];

/**
 * Receive (the wallet page): a QR code of the account, and optionally an
 * amount, a coin and a memo to ask for (owner 2026-11-12). With none of them
 * the code is the plain account name, which every Hive wallet reads; with any,
 * it is a Hive transfer request (lib/scannedRecipient receiveCode) that 3Speak's
 * Scan and Hive wallets that read payment codes fill in.
 */
export default function ReceiveDialog({ open, onClose, user }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState('');
  const [coin, setCoin] = useState('HBD');
  const [memo, setMemo] = useState('');

  const n = Number(amount);
  const asksAmount = n > 0;
  const asksMemo = memo.trim() !== '';
  const code = receiveCode(user || '', amount, coin, memo);
  const close = () => { setAmount(''); setMemo(''); onClose(); };

  const sub = asksAmount
    ? t('wallet.receive.subRequest', { amount: formatNumber(n, { minimumFractionDigits: 3, maximumFractionDigits: 3 }), coin })
    : asksMemo ? t('wallet.receive.subMemo') : t('wallet.receive.sub');

  return (
    <Dialog open={open} onClose={close} title={t('wallet.receive.title')} closeLabel={t('common.actions.close')} width={400}>
      <div className="wallet-v2__receive">
        <div className="wallet-v2__qr"><QRCodeSVG value={code} size={168} bgColor="white" fgColor="black" includeMargin /></div>
        <div className="v2-well wallet-v2__receive-name num">@{user}</div>
        <p className="v2-meta">{sub}</p>

        <div className="wallet-v2__receive-ask">
          <label className="v2-eyebrow" htmlFor="receive-amount">{t('wallet.receive.amountLabel')}</label>
          <div className="wallet-v2__receive-row">
            <input
              id="receive-amount"
              className="v2-input num"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              placeholder="0.000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <div className="wallet-v2__receive-coins" role="radiogroup" aria-label={t('engagement.tip.currencyLabel').replace(/:\s*$/, '')}>
              {COINS.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={coin === c} className={cx('v2-chip', coin === c && 'is-on')} onClick={() => setCoin(c)}>
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Field
          className="wallet-v2__receive-memo"
          label={t('wallet.receive.memoLabel')}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder={t('wallet.receive.memoPlaceholder')}
          maxLength={200}
        />
      </div>
    </Dialog>
  );
}
