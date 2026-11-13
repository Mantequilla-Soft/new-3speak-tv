import { useEffect, useCallback, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { usePlayer } from '@mantequilla-soft/3speak-player/react';
import { Icon } from '../v2/Icon';
import { useAppStore } from '../../lib/store';
import { hasConsent } from '../../lib/consent';
import { getPlayerUrl } from '../../utils/playerUrl';
import { withGatewayFallback } from '../../lib/hlsGatewayFallback.js';
import './MiniPlayer.scss';
import { isProfilePath, isWatchPath } from '../../utils/urls';

const MiniPlayer = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const miniPlayer = useAppStore((s) => s.miniPlayer);
  const clearMiniPlayer = useAppStore((s) => s.clearMiniPlayer);
  const [, setLoaded] = useState(false);

  // Hide mini player on the watch page, shorts, upload, and profile pages
  const hiddenPaths = ['/shorts', '/upload', '/upload-video', '/studio'];
  const pathname = location.pathname;
  const shouldHide = hiddenPaths.includes(pathname) || isWatchPath(pathname) || isProfilePath(pathname);

  const {
    ref: videoRef,
    state: playerState,
    player,
    load: loadVideo,
    togglePlay,
    seek,
  } = usePlayer({
    apiBase: getPlayerUrl(),
    muted: false,
    loop: false,
    poster: false,
    resume: hasConsent('functional'),
    hlsConfig: withGatewayFallback(),
  });

  // Load video when mini player data changes
  useEffect(() => {
    if (!miniPlayer || !player || shouldHide) return;
    setLoaded(false);
    loadVideo(`${miniPlayer.author}/${miniPlayer.permlink}`)
      .then(() => {
        if (miniPlayer.currentTime > 0) {
          seek(miniPlayer.currentTime);
        }
        setLoaded(true);
      })
      .catch(() => {});
  }, [miniPlayer?.author, miniPlayer?.permlink, player, shouldHide]);

  const handleNavigateToWatch = useCallback(() => {
    if (!miniPlayer) return;
    const seconds = Math.floor(playerState.currentTime || 0);
    clearMiniPlayer();
    navigate(`/@${miniPlayer.author}/${miniPlayer.permlink}${seconds > 0 ? `?t=${seconds}` : ''}`);
  }, [miniPlayer, playerState.currentTime, navigate, clearMiniPlayer]);

  const handleClose = useCallback((e) => {
    e.stopPropagation();
    clearMiniPlayer();
  }, [clearMiniPlayer]);

  const handleTogglePlay = useCallback((e) => {
    e.stopPropagation();
    togglePlay();
  }, [togglePlay]);

  // Don't show on watch page or if no data
  if (!miniPlayer || shouldHide) return null;

  const progress = playerState.duration > 0 ? (playerState.currentTime / playerState.duration) * 100 : 0;

  return createPortal(
    <div className="mini-player" onClick={handleNavigateToWatch}>
      <div className="mini-player-video">
        <video ref={videoRef} playsInline muted={false} />
      </div>
      <div className="mini-player-info">
        <span className="mini-player-title">{miniPlayer.title || t('player.mini.untitled')}</span>
        <span className="mini-player-author">@{miniPlayer.author}</span>
      </div>
      <div className="mini-player-controls">
        <button type="button" className="mini-player-btn" onClick={handleTogglePlay} aria-label={playerState.paused ? t('common.actions.play') : t('common.actions.pause')}>
          <Icon name={playerState.paused ? 'play_arrow' : 'pause'} size={24} fill />
        </button>
        <button type="button" className="mini-player-btn" onClick={handleClose} aria-label={t('common.actions.close')}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <div className="mini-player-progress">
        <div className="mini-player-progress-bar" style={{ width: `${progress}%` }} />
      </div>
    </div>,
    document.body
  );
};

export default MiniPlayer;
