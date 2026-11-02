// What the stories row's hover card shows about a creator. The count queries are
// the SAME ones (key + URL) the profile page uses, so a card and a profile share
// one cached request and can never disagree.
import axios from 'axios';
import { CHECKER_URL } from '../utils/config';
import { getHiveClient } from '../utils/hiveNode';

const FIVE_MIN = 5 * 60 * 1000;

// Videos / shorts / views (checker `/user/:username/counts`).
export const profileCountsQuery = (username) => ({
  queryKey: ['profile-counts', username],
  enabled: !!username,
  staleTime: FIVE_MIN,
  retry: 1,
  queryFn: async () => (await axios.get(`${CHECKER_URL}/user/${encodeURIComponent(username)}/counts`)).data,
});

// Audio count: `total` of the profile's Audio tab query.
export const audioCountQuery = (username) => ({
  queryKey: ['audio-count', username],
  enabled: !!username,
  staleTime: FIVE_MIN,
  retry: 1,
  queryFn: async () => (await axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(username)}&limit=1`)).data,
});

// Name, bio, reputation and followers in one call. bridge, because the raw
// account's `reputation` is 0 since it left consensus.
export const hiveProfileQuery = (username) => ({
  queryKey: ['creator-card-profile', username],
  enabled: !!username,
  staleTime: FIVE_MIN,
  retry: 1,
  queryFn: async () => {
    const p = await getHiveClient().call('bridge', 'get_profile', { account: username });
    const meta = p?.metadata?.profile || {};
    const rep = Number(p?.reputation);
    return {
      name: String(meta.name || '').trim(),
      about: String(meta.about || '').trim(),
      reputation: Number.isFinite(rep) && rep !== 0 ? Math.floor(rep) : null,
      followers: Number(p?.stats?.followers) || 0,
    };
  },
});

// When their newest short went up (the row's plain shorts creators carry no date).
export const newestShortQuery = (username) => ({
  queryKey: ['creator-card-newest-short', username],
  enabled: !!username,
  staleTime: FIVE_MIN,
  retry: 1,
  queryFn: async () => {
    const { data } = await axios.get(`${CHECKER_URL}/shorts/${encodeURIComponent(username)}`, { params: { limit: 1 } });
    return data?.shorts?.[0]?.createdAt || null;
  },
});

export const creatorCardQueries = (username, { story = false } = {}) => [
  hiveProfileQuery(username),
  profileCountsQuery(username),
  audioCountQuery(username),
  ...(story ? [] : [newestShortQuery(username)]),
];
