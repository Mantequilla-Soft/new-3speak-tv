import { useState } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { Icon } from '../v2/Icon';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { getPlaylistThumbnail } from '../../hooks/useUserPlaylists';
import './PlaylistCard.scss';
import { useTranslation } from 'react-i18next';

dayjs.extend(relativeTime);

// The cover, or (none set, or it fails to load) a cyan tile with the
// playlist's icon, as the boards draw a playlist without art (28d).
function PlaylistArt({ src, name, audio, children }) {
  const [failed, setFailed] = useState(false);
  const bare = !src || failed;
  return (
    <div className={`img-wrap plc-art${bare ? ' plc-art--cyan' : ''}`}>
      {bare ? (
        <Icon name={audio ? 'graphic_eq' : 'playlist_play'} size={32} />
      ) : (
        <img src={src} alt={name} onError={() => setFailed(true)} loading="lazy" />
      )}
      {children}
    </div>
  );
}

// `leading`: cards drawn first in the same grid (Watch Later and Watched on
// your own Playlists tab, 28d).
function PlaylistCard({ playlists = [], loading = false, error = null, showPrivacyBadge = false, leading = null }) {
  const { t } = useTranslation();
  if (loading && playlists.length === 0) return <div>{t('cards.playlist.loading')}</div>;
  if (error) return <div>{t('cards.error', { error })}</div>;
  if (playlists.length === 0 && !leading) return null;

  return (
    <div className="playlist-card-container">
      {leading}
      {playlists.map((playlist) => {
        const itemCount = playlist.items?.length || 0;
        // Only a cover the playlist really has; no cover draws the icon tile.
        const thumbnailUrl = playlist.thumbnail ? getPlaylistThumbnail(playlist) : '';
        const isPrivate = playlist.access === 'private';
        const isAudio = playlist.type === 'audio';

        return (
          <Link
            to={`/playlist/${playlist.id}`}
            className="playlist-card plc"
            key={playlist.id}
          >
            {/* 28d: the cover on a stack, the count in a mono scrim pill. */}
            <div className="plc-stack">
              <PlaylistArt src={thumbnailUrl} name={playlist.name} audio={isAudio}>
                <span className="plc-count">{itemCount}</span>
                {showPrivacyBadge && (
                  <span className={`plc-privacy privacy-badge ${isPrivate ? 'private' : 'public'}`} title={isPrivate ? t('playlists.private') : t('playlists.public')}>
                    <Icon name={isPrivate ? 'lock' : 'public'} size={14} />
                  </span>
                )}
              </PlaylistArt>
            </div>

            <h2 className="plc-title">{playlist.name}</h2>
            {/* "14 videos · public", "8 tracks · audio" (28d) */}
            <div className="plc-sub" title={`@${playlist.owner} · ${dayjs.unix(playlist.created_at).fromNow()}`}>
              {isAudio ? t('audio.author.tracks', { count: itemCount }) : t('cards.playlist.items', { count: itemCount })}
              {' · '}
              {isAudio ? t('cards.playlist.audio') : isPrivate ? t('cards.playlist.private') : t('cards.playlist.public')}
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
  leading: PropTypes.node,
};

export default PlaylistCard;
