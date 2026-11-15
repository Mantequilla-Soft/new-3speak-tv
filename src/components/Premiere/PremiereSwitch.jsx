import { useTranslation } from 'react-i18next';
import { SettingRow, Toggle } from '../v2/ui';

/**
 * "List as a premiere", in the schedule sheets (upload and the scheduled-post
 * editor). Off unless the creator switches it on: a premiere gets a public
 * countdown page with Notify me, then starts for everyone at once with a chat.
 */
export default function PremiereSwitch({ checked, onChange, disabled = false }) {
  const { t } = useTranslation();
  return (
    <SettingRow
      className="premiere-switch"
      icon="theaters"
      title={t('premieres.switch.title')}
      sub={t('premieres.switch.sub')}
      control={<Toggle checked={!!checked} onChange={onChange} label={t('premieres.switch.title')} disabled={disabled} tone="cyan" />}
    />
  );
}
