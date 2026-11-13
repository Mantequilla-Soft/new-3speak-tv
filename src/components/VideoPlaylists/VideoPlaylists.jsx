import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../v2/Icon';
import { useVideoPlaylists } from '../../hooks/useVideoPlaylists';
import { useTranslation } from 'react-i18next';
import './VideoPlaylists.scss';

function VideoPlaylists({ author, permlink }) {
  const { t } = useTranslation();
  const { data: playlists = [], isLoading } = useVideoPlaylists(author, permlink);
  const [expanded, setExpanded] = useState(false);

  // Don't render anything if loading or no playlists
  if (isLoading || playlists.length === 0) return null;

  return (
    <div className={`video-playlists${expanded ? ' expanded' : ''}`}>
      {/* A button so the phone fold works from the keyboard too. */}
      <button
        type="button"
        className="playlists-header"
        aria-expanded={expanded}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="playlists-header-left">
          <Icon name="playlist_play" size={20} /> {t('playlists.includedIn', { count: playlists.length })}
        </span>
        <span className="playlists-toggle">
          <Icon name={expanded ? 'expand_less' : 'expand_more'} size={20} />
        </span>
      </button>
      <div className="playlist-chips">
        {playlists.map((playlist, index) => (
          <Link
            key={playlist.id || `playlist-${index}`}
            to={`/playlist/${playlist.id}`}
            className="playlist-chip"
          >
            <Icon name="playlist_play" size={18} className="playlist-chip-icon" />
            <span className="name">{playlist.name}</span>
            <span className="owner">@{playlist.owner}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default VideoPlaylists;
