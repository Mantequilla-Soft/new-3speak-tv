import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { offlineLoaderClass, OFFLINE_PLAYLIST_URL } from '../../lib/videoDownloads';
import { notifyMediaPlay, onMediaPlay } from '../../utils/mediaCoordinator';

/**
 * A saved video, played from this browser's storage with no connection
 * (lib/videoDownloads.js). hls.js reads the rebuilt playlist and the segments
 * through a loader that answers from IndexedDB, so nothing goes to the network.
 * hls.js needs Media Source Extensions; a browser without them gets a note.
 */
export default function OfflineVideoPlayer({ entry, autoPlay = true }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || !entry) return undefined;
    let hls = null;
    let gone = false;
    setFailed(false);
    import('hls.js').then(({ default: Hls, LoadStats }) => {
      if (gone) return;
      if (!Hls?.isSupported?.()) { setFailed(true); return; }
      hls = new Hls({ loader: offlineLoaderClass(entry, LoadStats), maxBufferLength: 30, enableWorker: true });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else setFailed(true);
      });
      hls.loadSource(OFFLINE_PLAYLIST_URL);
      hls.attachMedia(el);
      if (autoPlay) el.play().catch(() => {});
    }).catch(() => { if (!gone) setFailed(true); });
    return () => {
      gone = true;
      if (hls) { try { hls.destroy(); } catch { /* gone */ } }
    };
  }, [entry, autoPlay]);

  // One thing plays at a time: the audio player stops for this one, and this one for it.
  useEffect(() => onMediaPlay('offline-video', () => ref.current?.pause()), []);

  return (
    <div className="dl-player">
      {failed
        ? <p className="dl-player__note">{t('downloads.cannotPlay')}</p>
        : (
          <video
            ref={ref}
            className="dl-player__video"
            controls
            playsInline
            onPlay={() => notifyMediaPlay('offline-video')}
            aria-label={entry?.track?.title || t('downloads.title')}
          />
        )}
    </div>
  );
}
