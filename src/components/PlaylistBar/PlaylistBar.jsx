import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import './PlaylistBar.scss';

// The playlist bar (22b): which playlist, where you are in it and the next
// title, with previous / next / close. The next videos are the "Next in" shelf
// under the page (Watch.jsx, 02).
function PlaylistBar({ playlist, videos, currentIndex, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handlePrevious = () => {
    if (currentIndex > 0) {
      const prevVideo = videos[currentIndex - 1];
      navigate(`/@${prevVideo.author}/${prevVideo.permlink}?playlist=${playlist.id}&pos=${currentIndex - 1}`, {
        state: { playlist, videos, currentIndex: currentIndex - 1 },
      });
    }
  };

  const handleNext = () => {
    if (currentIndex < videos.length - 1) {
      const nextVideo = videos[currentIndex + 1];
      navigate(`/@${nextVideo.author}/${nextVideo.permlink}?playlist=${playlist.id}&pos=${currentIndex + 1}`, {
        state: { playlist, videos, currentIndex: currentIndex + 1 },
      });
    }
  };

  if (!playlist || !videos || videos.length === 0) {
    return null;
  }

  return (
    <div className="playlist-bar">
      {/* Header */}
      <div className="playlist-bar-header">
        <div className="playlist-info">
          <span className="icon" aria-hidden="true"><Icon name="playlist_play" size={24} /></span>
          <div className="playlist-text">
            <Link to={`/playlist/${playlist.id}`} className="playlist-name">
              {playlist.name}
            </Link>
            <span className="video-count">
              {currentIndex + 1} / {videos.length}
              {videos[currentIndex + 1]?.title && <span className="next-title"> · {videos[currentIndex + 1].title}</span>}
            </span>
          </div>
        </div>
        <div className="controls">
          <button
            type="button"
            className="nav-btn"
            onClick={handlePrevious}
            disabled={currentIndex === 0}
            title={t('player.playlist.previous')}
            aria-label={t('player.playlist.previous')}
          >
            <Icon name="skip_previous" size={20} fill />
          </button>
          <button
            type="button"
            className="nav-btn"
            onClick={handleNext}
            disabled={currentIndex === videos.length - 1}
            title={t('player.playlist.next')}
            aria-label={t('player.playlist.next')}
          >
            <Icon name="skip_next" size={20} fill />
          </button>
          <button type="button" className="close-btn" onClick={onClose} title={t('player.playlist.close')} aria-label={t('player.playlist.close')}>
            <Icon name="close" size={20} />
          </button>
        </div>
      </div>

    </div>
  );
}

export default PlaylistBar;
