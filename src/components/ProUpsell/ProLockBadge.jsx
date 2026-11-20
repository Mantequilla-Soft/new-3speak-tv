import { useTranslation } from 'react-i18next';
import { StatusPill } from '../v2/ui';

/**
 * 🔒 "Pro" on an entry a free account can see but not use yet (the landscape
 * video editor): the entry stays, a tap opens the Pro upsell instead.
 */
export default function ProLockBadge({ className }) {
  const { t } = useTranslation();
  return (
    <StatusPill tone="accent" icon="workspace_premium" className={['pro-lock-badge', className].filter(Boolean).join(' ')}>
      {t('editorPro.badge')}
    </StatusPill>
  );
}
