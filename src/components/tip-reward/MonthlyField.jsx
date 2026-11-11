import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { MONTH_CHOICES, lastPaymentDate, formatMonth, isMonthly } from '../../lib/recurringTip';

// "How often" in both HIVE / HBD forms (TipModal, WalletTip). `months` 0 = once,
// else Hive's recurring transfer for that many months (lib/recurringTip.js).
// `existing`: the monthly support this viewer already sends the creator, which a
// new one replaces.
export default function MonthlyField({ months, onChange, existing, recipient }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const now = Date.now();
  return (
    <div className="v2-field">
      <label htmlFor={id} className="v2-eyebrow">{t('engagement.tip.monthly.label')}</label>
      <select id={id} className="v2-input is-select" value={months} onChange={(e) => onChange(Number(e.target.value))}>
        <option value={0}>{t('engagement.tip.monthly.once')}</option>
        {MONTH_CHOICES.map((m) => (
          <option key={m} value={m}>
            {t('engagement.tip.monthly.until', { date: formatMonth(lastPaymentDate(now, m), i18n.language) })}
          </option>
        ))}
      </select>
      {months > 0 && <div className="v2-field__hint">{t('engagement.tip.monthly.note')}</div>}
      {months > 0 && existing && (
        <div className="v2-field__hint">{t(isMonthly(existing) ? 'engagement.tip.monthly.replaces' : 'engagement.tip.monthly.replacesOther', { recipient })}</div>
      )}
    </div>
  );
}
