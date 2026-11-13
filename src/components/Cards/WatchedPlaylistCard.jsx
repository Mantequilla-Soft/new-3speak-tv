import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { Icon } from '../v2/Icon';
import './PlaylistCard.scss';
import { useTranslation } from 'react-i18next';

function WatchedPlaylistCard({ count, username }) {
  const { t } = useTranslation();
  return (
    <div className="watched-playlist-card-container">
      <Link to={`/watched/${username}`} className="watched-playlist-card plc">
        <div className="plc-stack">
          <div className="img-wrap plc-art plc-art--neutral">
            <Icon name="history" size={32} />
            <span className="plc-count">{count}</span>
          </div>
        </div>
        <h2 className="plc-title">{t('cards.watched.title')}</h2>
        <div className="plc-sub" title={t('cards.watched.subtitle')}>{t('common.units.videos', { count })} · {t('cards.playlist.history')}</div>
      </Link>
    </div>
  );
}

WatchedPlaylistCard.propTypes = {
  count: PropTypes.number.isRequired,
  username: PropTypes.string.isRequired,
};

export default WatchedPlaylistCard;
