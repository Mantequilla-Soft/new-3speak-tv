import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { Icon } from '../v2/Icon';
import './PlaylistCard.scss';
import { useTranslation } from 'react-i18next';

function WatchLaterPlaylistCard({ playlist, username }) {
  const { t } = useTranslation();
  const count = playlist?.items?.length || 0;

  return (
    <div className="watch-later-playlist-card-container">
      <Link to={`/playlist/${playlist.id}`} className="watch-later-playlist-card plc">
        <div className="plc-stack">
          <div className="img-wrap plc-art plc-art--accent">
            <Icon name="schedule" size={32} />
            <span className="plc-count"><Icon name="playlist_play" size={14} />{count}</span>
            <span className="plc-privacy" title={t('playlists.private')}><Icon name="lock" size={14} /></span>
          </div>
        </div>
        <h2 className="plc-title">{t('cards.watchLater.title')}</h2>
        <div className="plc-sub" title={t('cards.watchLater.subtitle')}>{t('common.units.videos', { count })} · @{username}</div>
      </Link>
    </div>
  );
}

WatchLaterPlaylistCard.propTypes = {
  playlist: PropTypes.object.isRequired,
  username: PropTypes.string.isRequired,
};

export default WatchLaterPlaylistCard;
