import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import "./NetworkLoader.scss"

// Waiting on the network: the cyan progress glyph and one muted line.
function NetworkLoader() {
  const { t } = useTranslation();
  return (
    <div className="networkloader-container" role="status" aria-busy="true">
      <Icon name="progress_activity" size={32} className="v2-spin networkloader-icon" />
      <span className="networkloader-text">{t('app.loaders.wifi')}</span>
    </div>
  )
}

export default NetworkLoader
