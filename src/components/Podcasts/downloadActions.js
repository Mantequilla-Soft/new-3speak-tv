import { toastIn } from '../../utils/toast';
import { downloadTrack, removeDownload } from '../../lib/podcastDownloads';

// Saving and forgetting an episode for offline listening, with the toasts
// that go with it (the download button and Mine → Downloads).

/** The message for a failed download (lib/podcastDownloads.js error codes). */
export function downloadErrorText(err, t) {
  const key = {
    too_large: 'tooLarge', rate_limited: 'rateLimited', storage: 'storage', no_source: 'noSource',
  }[err?.code] || 'failed';
  return t(`audio.podcasts.downloads.errors.${key}`);
}

export async function startDownload(track, t) {
  try {
    await downloadTrack(track);
    toastIn('Podcasts').success(t('audio.podcasts.downloads.done'));
  } catch (err) {
    if (err?.code !== 'cancelled') toastIn('Podcasts').error(downloadErrorText(err, t));
  }
}

export async function forgetDownload(id, t) {
  await removeDownload(id);
  toastIn('Podcasts').success(t('audio.podcasts.downloads.removed'));
}
