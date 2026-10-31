import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MdCloudOff } from 'react-icons/md';
import useOnline from '../../hooks/useOnline';
import { useDownloads } from '../../lib/podcastDownloads';
import { useAppStore } from '../../lib/store';
import './OfflineBanner.scss';

/**
 * Offline, the app still opens (the service worker keeps it, src/sw.js) and
 * downloaded episodes still play (lib/podcastDownloads.js); the rest needs the
 * network. Says so, and leads to the downloads when there are any.
 *
 * Out of the way once it has done its job: after "Open downloads" (until the
 * connection is back and lost again) and while something plays.
 */
export default function OfflineBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const online = useOnline();
  const { items } = useDownloads();
  const playing = useAppStore((s) => s.audioIsPlaying);
  const [dismissed, setDismissed] = useState(false);
  // A new time offline, a new notice.
  useEffect(() => { if (online) setDismissed(false); }, [online]);
  if (online || dismissed || playing) return null;
  // Already on Mine (where offline sends the audio page): no link to it.
  const onDownloads = pathname === '/audio' && !/[?&](view=(discover|trends)|podcast=|episode=|play=)/.test(search);
  return (
    <div className="offline-banner" role="status">
      <MdCloudOff size={18} aria-hidden />
      <span className="offline-banner-text">{items.length ? t('audio.offline.notice') : t('audio.offline.noticeNoDownloads')}</span>
      {items.length > 0 && !onDownloads && (
        <button
          type="button"
          className="offline-banner-link"
          onClick={() => { setDismissed(true); navigate('/audio?view=mine'); }}
        >
          {t('audio.offline.open')}
        </button>
      )}
    </div>
  );
}
