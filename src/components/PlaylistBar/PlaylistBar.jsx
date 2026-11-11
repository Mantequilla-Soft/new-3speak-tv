import { useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import './PlaylistBar.scss';

function PlaylistBar({ playlist, videos, currentIndex, onClose }) {
  const { t } = useTranslation();
  const scrollContainerRef = useRef(null);
  const currentItemRef = useRef(null);
  const navigate = useNavigate();

  // Scroll to current video when component mounts or currentIndex changes
  useEffect(() => {
    if (currentItemRef.current && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const item = currentItemRef.current;

      // Calculate scroll position to center the current item
      const containerWidth = container.offsetWidth;
      const itemLeft = item.offsetLeft;
      const itemWidth = item.offsetWidth;
      const scrollPosition = itemLeft - containerWidth / 2 + itemWidth / 2;

      container.scrollTo({
        left: Math.max(0, scrollPosition),
        behavior: 'smooth',
      });
    }
  }, [currentIndex]);

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

      {/* Horizontal scrollable video list */}
      <div className="playlist-bar-videos" ref={scrollContainerRef}>
        {videos.map((video, index) => (
          <Link
            key={`${video.author}-${video.permlink}`}
            to={`/@${video.author}/${video.permlink}?playlist=${playlist.id}&pos=${index}`}
            state={{ playlist, videos, currentIndex: index }}
            className={`playlist-video-item ${index === currentIndex ? 'active' : ''}`}
            ref={index === currentIndex ? currentItemRef : null}
          >
            <div className="thumbnail-wrap">
              <img
                src={fixVideoThumbnail(video)}
                alt={video.title}
                onError={(e) => (e.currentTarget.src = fallbackImg)}
              />
              <span className="position">{index + 1}</span>
              {video.duration > 0 && (
                <span className="duration">
                  {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}
                </span>
              )}
            </div>
            <div className="video-info">
              <h4>{video.title}</h4>
              <p>@{video.author}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default PlaylistBar;
