import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useHangout } from '../context/HangoutContext';
import { useAppStore } from '../lib/store';
import { defaultEndpoint, findRoomEndpoint } from '../utils/hangoutsEndpoints';
import StreamHighlightsPanel from '../components/openpods/StreamHighlightsPanel';
import SEOHead from '../components/SEOHead';
import { EmptyState } from '../components/v2/ui';
import '../components/openpods/StreamClips.scss';

/**
 * /live/clips/:room: a stream's clips after it ended (H13). The host sees every
 * clip and the best moments; a viewer sees the clips they made. Clips stay two
 * days on the stream's server.
 */
export default function StreamClipsPage() {
  const { room } = useParams();
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const { sessionToken } = useHangout();
  const [api, setApi] = useState(() => defaultEndpoint().api);
  useEffect(() => {
    let alive = true;
    if (room) findRoomEndpoint(room).then((ep) => { if (alive && ep?.api) setApi(ep.api); }).catch(() => {});
    return () => { alive = false; };
  }, [room]);

  return (
    <div className="stream-clips-page">
      <SEOHead title={t('streamClips.title')} url={window.location.href} />
      {!user ? (
        <EmptyState icon="content_cut" title={t('streamClips.title')}>{t('streamClips.loginToPost')}</EmptyState>
      ) : (
        <StreamHighlightsPanel api={api} room={room} token={sessionToken || null} />
      )}
    </div>
  );
}
