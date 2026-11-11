import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { Icon } from '../v2/Icon';
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
            className="playlist-card plc"
            key={playlist.id}
          >
            {/* 28d: the cover on a stack, the count in a mono scrim pill. */}
            <div className="plc-stack">
              <div className="img-wrap plc-art">
                <img
                  src={thumbnailUrl}
                  alt={playlist.name}
                  onError={(e) => (e.currentTarget.src = img)}
                  loading="lazy"
                />
                <span className="plc-count"><Icon name="playlist_play" size={14} />{itemCount}</span>
                {showPrivacyBadge && (
                  <span className={`plc-privacy privacy-badge ${isPrivate ? 'private' : 'public'}`} title={isPrivate ? t('playlists.private') : t('playlists.public')}>
                    <Icon name={isPrivate ? 'lock' : 'public'} size={14} />
                  </span>
                )}
              </div>
            </div>

            <h2 className="plc-title">{playlist.name}</h2>
            <div className="plc-sub">
              {t('cards.playlist.items', { count: itemCount })} · @{playlist.owner} · {dayjs.unix(playlist.created_at).fromNow()}
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
