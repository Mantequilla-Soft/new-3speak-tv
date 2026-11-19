import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { videoAudioTrack } from '../../lib/videoAsAudio';
import { downloadVideo, cancelVideoDownload, useVideoDownload } from '../../lib/videoDownloads';
import { downloadErrorText } from '../Podcasts/downloadActions';

// Further in than this, the audio carries on where the video is.
const RESUME_AFTER_S = 5;

/**
 * Two tiles for the watch page's More menu (WatchDock): "Listen" puts the video
 * in the global audio player (lib/videoAsAudio.js), from where it is playing;
 * "Download" saves it for offline (lib/videoDownloads.js), shows the progress
 * while it runs (a second press cancels) and opens Downloads once it is saved.
 * Both work signed out. Neither for a live stream or a post without media.
 */
export default function useListenAndSaveTiles({ author, permlink, videoDetails, currentTime, available = true }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { saved, progress } = useVideoDownload(author, permlink);
  if (!available || !author || !permlink) return [];
  const thumb = fixVideoThumbnail(videoDetails || {});
  const video = {
    author,
    permlink,
    title: videoDetails?.title || '',
    thumbnail: thumb && thumb !== fallbackImg ? thumb : null,
    duration: Number(videoDetails?.duration) || 0,
  };

  const listen = async () => {
    try {
      const track = await videoAudioTrack(video);
      const at = Number(currentTime) || 0;
      const store = useAppStore.getState();
      if (at > RESUME_AFTER_S) store.audioPlayAt(track, at);
      else store.audioPlay(track);
    } catch {
      toastIn('Audio').error(t('videoAudio.failed'));
    }
  };

  const busy = progress != null;
  const save = () => {
    if (saved) { navigate('/downloads'); return; }
    if (busy) { cancelVideoDownload(author, permlink); return; }
    toastIn('Video').info(t('downloads.started'));
    downloadVideo(video)
      .then(() => toastIn('Video').success(t('downloads.saved'), {
        action: { label: t('downloads.open'), onClick: () => navigate('/downloads') },
      }))
      .catch((err) => {
        if (err?.code === 'cancelled') return;
        toastIn('Video').error(downloadErrorText(err, t));
      });
  };

  return [
    { id: 'listen', icon: 'headphones', label: t('videoAudio.listen'), title: t('videoAudio.playAsAudio'), onClick: listen },
    {
      id: 'download',
      icon: saved ? 'download_done' : 'download',
      label: saved ? t('downloads.savedShort') : busy ? t('downloads.progress', { pct: Math.round(progress * 100) }) : t('downloads.download'),
      title: saved ? t('downloads.open') : busy ? t('downloads.cancel') : t('downloads.downloadTitle'),
      active: saved,
      tone: 'cyan',
      onClick: save,
    },
  ];
}
