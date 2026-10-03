import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { MdPlaylistPlay, MdLock, MdPublic } from 'react-icons/md';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { getPlaylistThumbnail } from '../../hooks/useUserPlaylists';
import img from '../../assets/image/speak.jpg';
import './PlaylistCard.scss';
import { useTranslation } from 'react-i18next';

dayjs.extend(relativeTime);

function PlaylistCard({ playlists = [], loading = false, error = null, showPrivacyBadge = false }) {
  const { t } = useTranslation();
  if (loading && playlists.length === 0) return <div>{t('cards.playlist.loading')}</div>;
  if (error) return <div>{t('cards.error', { error })}</div>;
  if (playlists.length === 0) return null;

  return (
    <div className="playlist-card-container">
      {playlists.map((playlist) => {
        const itemCount = playlist.items?.length || 0;
        const thumbnailUrl = getPlaylistThumbnail(playlist);
        const isPrivate = playlist.access === 'private';

        return (
          <Link
            to={`/playlist/${playlist.id}`}
            className="playlist-card"
            key={playlist.id}
          >
            {/* Thumbnail */}
            <div className="img-wrap">
              <img
                src={thumbnailUrl}
                alt={playlist.name}
                onError={(e) => (e.currentTarget.src = img)}
                loading="lazy"
              />
              <div className="playlist-overlay">
                <span className="video-count">{itemCount}</span>
                <MdPlaylistPlay className="playlist-icon" />
              </div>
              {showPrivacyBadge && (
                <div className={`privacy-badge ${isPrivate ? 'private' : 'public'}`}>
                  {isPrivate ? <MdLock /> : <MdPublic />}
                </div>
              )}
            </div>

            {/* Title */}
            <h2>{playlist.name}</h2>

            {/* Metadata */}
            <div className="playlist-meta">
              <span className="owner">@{playlist.owner}</span>
              <span className="separator">•</span>
              <span className="item-count">
                {t('cards.playlist.items', { count: itemCount })}
              </span>
            </div>

            {/* Bottom info */}
            <div className="bottom-info">
              <p>{dayjs.unix(playlist.created_at).fromNow()}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

PlaylistCard.propTypes = {
  playlists: PropTypes.array.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
  showPrivacyBadge: PropTypes.bool,
};

export default PlaylistCard;
