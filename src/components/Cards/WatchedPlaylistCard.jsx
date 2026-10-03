import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { MdHistory } from 'react-icons/md';
import './WatchedPlaylistCard.scss';
import { useTranslation } from 'react-i18next';

function WatchedPlaylistCard({ count, username }) {
  const { t } = useTranslation();
  return (
    <div className="watched-playlist-card-container">
      <Link to={`/watched/${username}`} className="watched-playlist-card">
        <div className="img-wrap">
          <div className="watched-icon-bg">
            <MdHistory className="watched-icon" />
          </div>
          <div className="playlist-overlay">
            <span className="video-count">{count}</span>
          </div>
        </div>

        <h2>{t('cards.watched.title')}</h2>

        <div className="playlist-meta">
          <span className="owner">@{username}</span>
          <span className="separator">-</span>
          <span className="item-count">
            {t('common.units.videos', { count })}
          </span>
        </div>

        <div className="bottom-info">
          <p>{t('cards.watched.subtitle')}</p>
        </div>
      </Link>
    </div>
  );
}

WatchedPlaylistCard.propTypes = {
  count: PropTypes.number.isRequired,
  username: PropTypes.string.isRequired,
};

export default WatchedPlaylistCard;
