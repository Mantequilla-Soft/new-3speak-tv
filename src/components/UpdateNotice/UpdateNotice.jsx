import { t } from '../../i18n';
import { Icon } from '../v2/Icon';
import { IconButton } from '../v2/ui';
import { reloadForUpdate } from '../../utils/checkLatestVersion';

/**
 * "A new version is available" (designs 32g and 44a): a cyan-washed notice in
 * the island's place at the top centre, with the update icon, the title, the
 * line under it and a cyan Refresh button. It stays until Refresh or close;
 * Refresh drops the caches and reloads onto the new build.
 *
 * App.jsx raises it as a sonner custom toast (class ts-update-toast), so it
 * shares the island's stack, position and swipe-to-dismiss; its look is the
 * .ts-update block at the end of src/toast.css.
 */
export default function UpdateNotice({ version, onDismiss }) {
  return (
    <div className="ts-update" role="status">
      <Icon name="system_update" size={28} className="ts-update__icon" />
      <div className="ts-update__text">
        <b className="ts-update__title">{t('app.update.available', { version })}</b>
        <span className="ts-update__sub">{t('app.update.description')}</span>
      </div>
      <button type="button" className="v2-btn v2-btn--cyan h40 is-next ts-update__btn" onClick={() => reloadForUpdate()}>
        <span className="v2-btn__label">{t('common.actions.refresh')}</span>
        <Icon name="arrow_forward" size={16} />
      </button>
      <IconButton icon="close" label={t('common.actions.close')} size={32} variant="ghost" round className="ts-update__close" onClick={onDismiss} />
    </div>
  );
}

