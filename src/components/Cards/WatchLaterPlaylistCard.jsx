import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { MdWatchLater, MdLock } from 'react-icons/md';
import './WatchLaterPlaylistCard.scss';
import { useTranslation } from 'react-i18next';

function WatchLaterPlaylistCard({ playlist, username }) {
  const { t } = useTranslation();
  const count = playlist?.items?.length || 0;

  return (
    <div className="watch-later-playlist-card-container">
      <Link to={`/playlist/${playlist.id}`} className="watch-later-playlist-card">
        <div className="img-wrap">
          <div className="watch-later-icon-bg">
            <MdWatchLater className="watch-later-icon" />
          </div>
          <div className="playlist-overlay">
            <span className="video-count">{count}</span>
          </div>
          <div className="privacy-badge private">
            <MdLock />
          </div>
        </div>

        <h2>{t('cards.watchLater.title')}</h2>

        <div className="playlist-meta">
          <span className="owner">@{username}</span>
          <span className="separator">-</span>
          <span className="item-count">
            {t('common.units.videos', { count })}
          </span>
        </div>

        <div className="bottom-info">
          <p>{t('cards.watchLater.subtitle')}</p>
        </div>
      </Link>
    </div>
  );
}

WatchLaterPlaylistCard.propTypes = {
  playlist: PropTypes.object.isRequired,
  username: PropTypes.string.isRequired,
};

export default WatchLaterPlaylistCard;
