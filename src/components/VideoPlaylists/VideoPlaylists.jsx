import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MdPlaylistPlay, MdKeyboardArrowDown, MdKeyboardArrowUp } from 'react-icons/md';
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
      <h4 className="playlists-header" onClick={() => setExpanded(prev => !prev)}>
        <span className="playlists-header-left">
          <MdPlaylistPlay /> {t('playlists.includedIn', { count: playlists.length })}
        </span>
        <span className="playlists-toggle">
          {expanded ? <MdKeyboardArrowUp size={18} /> : <MdKeyboardArrowDown size={18} />}
        </span>
      </h4>
      <div className="playlist-chips">
        {playlists.map((playlist, index) => (
          <Link
            key={playlist.id || `playlist-${index}`}
            to={`/playlist/${playlist.id}`}
            className="playlist-chip"
          >
            <span className="name">{playlist.name}</span>
            <span className="owner">@{playlist.owner}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default VideoPlaylists;
