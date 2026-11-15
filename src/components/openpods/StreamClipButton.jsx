import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useHangoutsContext } from '@snapie/hangouts-react';
import { toastIn } from '../../utils/toast';
import { makeClip, clipFileUrl } from '../../lib/streamClips';
import { DockTile, Icon } from '../v2/ui';
import ClipReadyModal from './ClipReadyModal';

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

// Viewer-facing "clip the last 30s" button for a live OpenPods stream. Only a
// Pro host has DVR running, so the button appears only while /dvr/status reports
// recording=true (which also hides it for non-Pro hosts). Both endpoints are
// public; /clip is rate-limited server-side. A signed-in clipper is credited
// (H13): the clip is kept two days and opens in ClipReadyModal, ready to post as
// a Short with the host as a beneficiary, or to download.
// The room's own hangouts deployment (VITE_apiUrlS): DVR runs there.
import { findRoomEndpoint } from '../../utils/hangoutsEndpoints';

export default function StreamClipButton({ roomName, variant = 'inline' }) {
  const { t } = useTranslation();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [ready, setReady] = useState(null);
  // Inside the stream's HangoutsProvider: its session credits the clipper.
  const { apiClient } = useHangoutsContext();
  useEffect(() => {
    let alive = true;
    if (roomName) findRoomEndpoint(roomName).then((ep) => { if (alive) setApiUrl((ep?.api || '').replace(/\/$/, '')); });
    return () => { alive = false; };
  }, [roomName]);

  useEffect(() => {
    if (!roomName || !apiUrl) return undefined;
    let alive = true;
    const check = () => {
      fetch(`${apiUrl}/rooms/${encodeURIComponent(roomName)}/dvr/status`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive) setAvailable(!!d?.recording); })
        .catch(() => { if (alive) setAvailable(false); });
    };
    check();
    // Poll fairly often so the button appears soon after the host goes live —
    // a viewer who opened the page during standby would otherwise wait a long
    // time (DVR only starts on Start) for the button to show.
    const timer = setInterval(check, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, [roomName, apiUrl]);

  const clip = useCallback(async () => {
    if (busy || !apiUrl) return;
    setBusy(true);
    try {
      const { path, clip: kept } = await makeClip(apiUrl, roomName, apiClient?.getSessionToken?.() || null);
      setReady({ url: clipFileUrl(apiUrl, path), clip: kept || null });
    } catch (e) {
      const msg = e?.status === 429
        ? t('live.clip.slowDown')
        : t('live.clip.failed');
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }, [busy, roomName, apiUrl, apiClient, t]);

  const modal = <ClipReadyModal open={!!ready} url={ready?.url} clip={ready?.clip} room={roomName} api={apiUrl} token={apiClient?.getSessionToken?.() || null} onClose={() => setReady(null)} />;
  if (!available) return ready ? modal : null;

  if (variant === 'sidebar') {
    return (
      <>
        <div className="actionItem" onClick={clip} role="button" title={t('live.clip.title')}>
          <div className={`actionButton${busy ? ' liked' : ''}`}><Icon name="content_cut" size={24} /></div>
          <span className="actionLabel">{busy ? '…' : t('live.clip.label')}</span>
        </div>
        {modal}
      </>
    );
  }
  return (
    <>
    <DockTile
      icon={busy ? 'progress_activity' : 'content_cut'}
      label={busy ? t('live.clip.clipping') : t('live.clip.label')}
      className={busy ? 'stream-clip is-busy' : 'stream-clip'}
      onClick={clip}
      disabled={busy}
      title={t('live.clip.title')}
    />
    {modal}
    </>
  );
}
