import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Link } from 'react-router-dom';
import Card3 from '../Cards/Card3';
import { MY_VIDEOS_URL } from '../../utils/config';
import { fetchAllEndpoints } from '../../utils/hangoutsEndpoints';
import { useTranslation } from 'react-i18next';
import './ProfileStreams.scss';

/** Live/standby OpenPods rooms hosted by this user, on every configured
 *  hangouts deployment (a stream from OBS lives on the one with templates). */
async function fetchHostStreams(username) {
  if (!username) return [];
  try {
    const rooms = await fetchAllEndpoints('/streams');
    return (Array.isArray(rooms) ? rooms : []).filter(
      (r) => String(r.host || '').toLowerCase() === String(username).toLowerCase(),
    );
  } catch {
    return [];
  }
}

/** Past sessions whose recording was published as a VOD. */
async function fetchStreamVods(username) {
  const url = `${MY_VIDEOS_URL}/api/my-videos?username=${encodeURIComponent(username)}&limit=50&status=published&sort=newest&openpod=1`;
  const res = await axios.get(url);
  return res.data?.data?.videos || [];
}

/** This host's open rooms, shared (one query key) by the Streams tab and the
 *  live block on top of the Videos tab. */
function useHostRooms(user) {
  return useQuery({
    queryKey: ['profile-streams-live', user],
    queryFn: () => fetchHostStreams(user),
    enabled: !!user,
    refetchInterval: 30000, // live status changes minute to minute
    staleTime: 15000,
  });
}

/** The room cards, live or on standby. */
function RoomCards({ rooms }) {
  const { t } = useTranslation();
  return (
    <div className="profile-streams__live">
      {rooms.map((room) => (
        <Link key={room.name} to={`/watch/${room.name}`} className="profile-streams__room">
          <div
            className="profile-streams__room-thumb"
            style={room.thumbnail ? { backgroundImage: `url(${room.thumbnail})` } : undefined}
          >
            <span className={`profile-streams__badge${room.live ? '' : ' profile-streams__badge--off'}`}>
              {room.live ? `● ${t('profile.streams.live')}` : `○ ${t('profile.streams.standby')}`}
            </span>
          </div>
          <span className="profile-streams__room-title">{room.title || room.name}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * Top of the Videos tab: the stream this user is broadcasting right now, ahead
 * of their videos. Only rooms that are actually live (not standby); renders
 * nothing otherwise, so the tab looks exactly as before when nobody streams.
 */
export function ProfileLiveNow({ user }) {
  const { t } = useTranslation();
  const { data: rooms = [] } = useHostRooms(user);
  const live = rooms.filter((r) => r.live);
  if (!live.length) return null;
  return (
    <div className="profile-streams profile-streams--now">
      <h3 className="profile-streams__heading">{t('profile.streams.liveNow')}</h3>
      <RoomCards rooms={live} />
    </div>
  );
}

/**
 * "Streams" profile tab: currently-running OpenPods sessions plus the VODs of
 * finished ones. The VODs deliberately ALSO stay in the Videos tab — this is a
 * filtered view, not a move.
 */
export default function ProfileStreams({ user, getViewCount }) {
  const { t } = useTranslation();
  const { data: liveRooms = [] } = useHostRooms(user);

  const { data: vods = [], isLoading } = useQuery({
    queryKey: ['profile-streams-vods', user],
    queryFn: () => fetchStreamVods(user),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading && !liveRooms.length) {
    return <div className="profile-streams__empty">{t('profile.streams.loading')}</div>;
  }

  if (!liveRooms.length && !vods.length) {
    return <div className="profile-streams__empty">{t('profile.streams.empty')}</div>;
  }

  return (
    <div className="profile-streams">
      {liveRooms.length > 0 && (
        <>
          <h3 className="profile-streams__heading">
            {liveRooms.some((r) => r.live) ? t('profile.streams.liveNow') : t('profile.streams.upcoming')}
          </h3>
          <RoomCards rooms={liveRooms} />
        </>
      )}

      {vods.length > 0 && (
        <>
          <h3 className="profile-streams__heading">{t('profile.streams.past')}</h3>
          <Card3 videos={vods} getViewCount={getViewCount} />
        </>
      )}
    </div>
  );
}
