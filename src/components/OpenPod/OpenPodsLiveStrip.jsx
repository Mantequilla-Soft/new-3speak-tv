import { useQuery } from '@tanstack/react-query';
import { HangoutsApiClient } from '@snapie/hangouts-core';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation, Trans } from 'react-i18next';
import { useHangout } from '../../context/HangoutContext';
import { useAppStore } from '../../lib/store';
import { Icon, StatusPill } from '../v2/ui';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import './OpenPodsLiveStrip.scss';

const HANGOUTS_API_URL = import.meta.env.VITE_HANGOUTS_API_URL || '';
const client = HANGOUTS_API_URL
  ? new HangoutsApiClient({ baseUrl: HANGOUTS_API_URL })
  : null;

export default function OpenPodsLiveStrip() {
  const { t } = useTranslation();
  const { openRoom } = useHangout();
  const { authenticated } = useAppStore();
  const navigate = useNavigate();

  const { data: allRooms = [] } = useQuery({
    queryKey: ['openpods-live-rooms'],
    queryFn: () => client.listRooms(),
    refetchInterval: 30_000,
    staleTime: 20_000,
    enabled: !!client,
  });

  // Conferences only. A standalone stream is a broadcast, not a room you drop
  // into to talk — it already appears in the feeds as a LIVE video card that
  // opens the watch page, and listing it here too sent people into the room
  // UI instead. `mode` is absent on rooms created before the standalone split,
  // and those were all conferences.
  const rooms = allRooms.filter((r) => (r.mode ?? 'conference') === 'conference');

  if (rooms.length === 0) return null;

  const handleJoinRoom = (roomName) => {
    if (!authenticated) {
      navigate('/login');
      return;
    }
    openRoom(roomName);
  };

  return (
    <div className="openpods-live-strip">
      <div className="strip-header">
        <span className="strip-mic-icon" aria-hidden="true"><Icon name="podcasts" size={18} /></span>
        <span className="strip-label">
          <Trans i18nKey="live.strip.liveNow" count={rooms.length} components={{ n: <span className="strip-count num" /> }} />
        </span>
        <StatusPill tone="live">{t('feeds.live.badge')}</StatusPill>
        <Link to="/openpods" className="strip-view-all">{t('live.strip.viewAll')}</Link>
      </div>

      <div className="strip-cards">
        {rooms.map((room) => (
          <button
            key={room.name}
            className="strip-card"
            onClick={() => handleJoinRoom(room.name)}
            aria-label={t('live.strip.joinAria', { title: room.title })}
          >
            <HiveAvatar
              username={room.host}
              size="small"
              imgClassName="strip-card-avatar"
              alt={room.host}
              onError={(e) => { e.target.style.display = 'none'; }}
              badgeSize={10}
            />
            <div className="strip-card-info">
              <span className="strip-card-title">{room.title}</span>
              <span className="strip-card-host">@{room.host}</span>
            </div>
            {room.numParticipants > 0 && (
              <span className="strip-card-listeners"><Icon name="headphones" size={14} /><span className="num">{room.numParticipants}</span></span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
