import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { usePostClipAsShort } from '../../hooks/usePostClipAsShort';
import { clipShareFor, downloadClip, shortUrlFor } from '../../lib/streamClips';
import { Button, Dialog } from '../v2/ui';
import './StreamClips.scss';

const toast = toastIn('Live');

/**
 * A viewer's (or the host's) fresh clip of a live stream (H13): a preview, Post
 * as Short (the Shorts upload, the other side gets a locked share) and Download.
 * `clip` is the kept record (host, clipper); without one only Download is offered.
 */
export default function ClipReadyModal({ open, onClose, url, clip, room, api = null, token = null }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const { post, busy } = usePostClipAsShort();
  if (!open || !url) return null;
  const share = clip ? clipShareFor({ poster: user, host: clip.host, clipper: clip.clipper }) : null;

  const postShort = async () => {
    try {
      // A Shorts-ready 9:16 copy when the host had the phone crop on.
      const shortUrl = api ? await shortUrlFor(api, clip, token) : url;
      await post({ url: shortUrl, room: clip.room || room, host: clip.host, clipper: clip.clipper, offsetSec: clip.offsetSec });
      onClose();
    } catch {
      toast.error(t('streamClips.postFailed'));
    }
  };
  const download = async () => {
    try { await downloadClip(url); toast.success(t('live.clip.saved')); }
    catch { toast.error(t('live.clip.failed')); }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('streamClips.readyTitle')}
      sub={t('streamClips.readySub')}
      className="clip-ready"
      dismissible={!busy}
      footer={(
        <div className="clip-ready__actions">
          {clip && user ? (
            <Button variant="primary" size={48} block icon="movie" onClick={postShort} loading={busy} disabled={busy}>
              {t('streamClips.postShort')}
            </Button>
          ) : null}
          <Button variant="secondary" size={48} block icon="download" onClick={download} disabled={busy}>
            {t('streamClips.download')}
          </Button>
        </div>
      )}
    >
      <video className="clip-ready__video" src={url} controls playsInline preload="metadata" />
      {clip && user && share && (
        <p className="clip-ready__note">
          {share.role === 'host'
            ? t('streamClips.shareHost', { host: share.account, percent: share.percent })
            : t('streamClips.shareClipper', { clipper: share.account, percent: share.percent })}
        </p>
      )}
      {clip && !user && <p className="clip-ready__note">{t('streamClips.loginToPost')}</p>}
      {clip && user && (
        <p className="clip-ready__note">
          <Link to={`/live/clips/${encodeURIComponent(clip.room || room)}`} onClick={onClose}>{t('streamClips.allClips')}</Link>
        </p>
      )}
    </Dialog>
  );
}
