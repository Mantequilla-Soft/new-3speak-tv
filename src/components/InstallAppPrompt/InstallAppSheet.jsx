import { useTranslation, Trans } from 'react-i18next';
import DialogShell from '../modal/DialogShell';
import { Button } from '../v2/ui';
import { Icon } from '../v2/Icon';
import './InstallAppPrompt.scss';

/**
 * The install sheet itself (InstallAppPrompt.jsx decides when): the 3Speak icon,
 * one line on why, then Install (the browser's own dialog) and Not now. On an
 * iPhone, where Safari has no install dialog, the two steps of the Share sheet
 * and Got it. A bottom sheet on phones (DialogShell), with the shared header.
 */
export default function InstallAppSheet({ kind, onInstall, onLater }) {
  const { t } = useTranslation();
  if (!kind) return null;
  const ios = kind === 'homeScreen';
  return (
    <DialogShell
      onClose={onLater}
      title={ios ? t('install.iosTitle') : t('install.title')}
      width={420}
      className="install-sheet"
      footer={ios ? (
        <Button variant="primary" size={44} onClick={onLater}>{t('install.gotIt')}</Button>
      ) : (
        <>
          <Button variant="secondary" size={44} onClick={onLater}>{t('install.notNow')}</Button>
          <Button variant="primary" size={44} icon="install_mobile" onClick={onInstall}>{t('install.install')}</Button>
        </>
      )}
    >
      <div className="install-sheet__body">
        <img className="install-sheet__icon" src="/pwa-192x192.png" alt="" width="56" height="56" />
        <p className="install-sheet__why">{t('install.why')}</p>
      </div>
      {ios && (
        <p className="install-sheet__ios">
          <Icon name="ios_share" size={20} className="install-sheet__share" />
          <span><Trans i18nKey="nav.iosInstallHint" components={{ b: <strong /> }} /></span>
        </p>
      )}
    </DialogShell>
  );
}
