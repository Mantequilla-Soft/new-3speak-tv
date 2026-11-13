import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '../v2/ui';
import { MONTH_CHOICES, lastPaymentDate, formatMonth, isMonthly } from '../../lib/recurringTip';

// "How often" in both HIVE / HBD forms (TipModal, WalletTip), design 17a / 40a:
// a One time | Monthly track; Monthly adds how long it runs. `months` 0 = once,
// else Hive's recurring transfer for that many months (lib/recurringTip.js).
// `existing`: the monthly support this viewer already sends the creator, which a
// new one replaces.
const DEFAULT_MONTHS = MONTH_CHOICES[2] ?? MONTH_CHOICES[0];

export default function MonthlyField({ months, onChange, existing, recipient }) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const now = Date.now();
  return (
    <div className="v2-field tip-v2__often">
      <Segmented
        size={36}
        label={t('engagement.tip.monthly.label')}
        value={months > 0 ? 'monthly' : 'once'}
        onChange={(v) => onChange(v === 'monthly' ? (months > 0 ? months : DEFAULT_MONTHS) : 0)}
        options={[
          { value: 'once', label: t('engagement.tip.monthly.oneTime') },
          { value: 'monthly', label: t('engagement.tip.monthly.monthly') },
        ]}
      />
      {months > 0 && (
        <>
          <label htmlFor={id} className="v2-eyebrow tip-v2__until-label">{t('engagement.tip.monthly.label')}</label>
          <select id={id} className="v2-input is-select" value={months} onChange={(e) => onChange(Number(e.target.value))}>
            <option value={0}>{t('engagement.tip.monthly.once')}</option>
            {MONTH_CHOICES.map((m) => (
              <option key={m} value={m}>
                {t('engagement.tip.monthly.until', { date: formatMonth(lastPaymentDate(now, m), i18n.language) })}
              </option>
            ))}
          </select>
          <div className="v2-field__hint">{t('engagement.tip.monthly.note')}</div>
          {existing && (
            <div className="v2-field__hint">{t(isMonthly(existing) ? 'engagement.tip.monthly.replaces' : 'engagement.tip.monthly.replacesOther', { recipient })}</div>
          )}
        </>
      )}
    </div>
  );
}
