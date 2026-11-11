import "./Discover.scss";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { TRENDING_SORTED_URL, INTERESTS_FEED_URL, CHECKER_URL, appendNsfw } from '../utils/config';
import { feedParams } from '../utils/feedParams';
import { useAppStore } from "../lib/store";
import { useWatchHistory } from "../hooks/useWatchHistory";
import useViewCounts from "../hooks/useViewCounts";
import { useLiveStreams } from "../hooks/useLiveStreams";
import PullToRefresh from "../components/PullToRefresh/PullToRefresh";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Icon } from "../components/v2/Icon";
import { Button, Dialog, EmptyState, IconButton, Toggle } from "../components/v2/ui";
import { cx } from "../components/v2/helpers";
import { fixVideoThumbnail, fallbackImg } from "../utils/fixThumbnails";
import { watchPath } from "../utils/urls";
import TimeAgo from "../components/TimeAgo/TimeAgo";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../i18n";
import AccountImg from "../components/HiveAvatar/AccountImg";
import SearchSuggest from "../components/nav/SearchSuggest";
import { addRecentSearch, useFollowerCount } from "../components/nav/searchHelpers";
import AddToPlaylistModal from "../components/AddToPlaylistModal/AddToPlaylistModal";
import { followWithAioha, isLoggedIn } from "../hive-api/aioha";
import { getFollowing } from "../utils/hiveUtils";
import { canSubscribe, setCommunitySubscription } from "../components/Communities/communitySubscribe";
import useJoinedCommunities from "../components/Groups/useJoinedCommunities";
import { fetchLeaderboard, formatMetric } from "../lib/leaderboardData";
import { aiKey, isAiFlagged, useAiFlags } from "../utils/aiFlags";
import { toastIn } from "../utils/toast";

// Discover (design 21b) and the search page (21a), one route: /discover shows
// the browse view, /discover?q=… the results. The top bar's search field and
// its dropdown (28c) send people here; the filters open as a sheet (34b).

const LIMIT = 50;
const TOPIC_LIMIT = 30;

const followToast = toastIn('Following');
const playlistToast = toastIn('Playlist');
const communityToast = toastIn('Community');

// Content types with their Material Symbols glyph (34b)
const SEARCH_TYPES = [
  { key: 'user', labelKey: 'feeds.discover.types.user', icon: 'person' },
  { key: 'community', labelKey: 'feeds.discover.types.community', icon: 'groups' },
  { key: 'video', labelKey: 'feeds.discover.types.video', icon: 'smart_display' },
  { key: 'short', labelKey: 'feeds.discover.types.short', icon: 'view_day' },
  { key: 'audio', labelKey: 'feeds.discover.types.audio', icon: 'graphic_eq' },
  { key: 'playlist', labelKey: 'feeds.discover.types.playlist', icon: 'playlist_play' },
];

// The result tabs (21a): All, then one per type that has results.
const RESULT_TABS = [
  { key: 'video', labelKey: 'feeds.discover.types.video' },
  { key: 'short', labelKey: 'feeds.discover.types.short' },
  { key: 'audio', labelKey: 'feeds.discover.types.audio' },
  { key: 'user', labelKey: 'feeds.discover.creators' },
  { key: 'community', labelKey: 'nav.bottom.groups' },
  { key: 'playlist', labelKey: 'feeds.discover.types.playlist' },
];
const MEDIA_TYPES = new Set(['video', 'short', 'audio']);
const KIND_KEYS = { video: 'nav.search.kinds.video', short: 'nav.search.kinds.short', audio: 'nav.search.kinds.audio' };

const DATE_PRESETS = [
  { labelKey: 'feeds.discover.dates.today', days: 1 },
  { labelKey: 'feeds.discover.dates.week', days: 7 },
  { labelKey: 'feeds.discover.dates.month', days: 30 },
  { labelKey: 'feeds.discover.dates.year', days: 365 },
];

// The topic tiles (21b): topics the auto-tagger assigns, so each one can
// filter the trending list through the interests feed.
const CATEGORIES = [
  { slug: 'gaming', icon: 'sports_esports' },
  { slug: 'nature', icon: 'forest' },
  { slug: 'technology', icon: 'memory' },
  { slug: 'food', icon: 'restaurant' },
  { slug: 'travel', icon: 'flight' },
  { slug: 'music', icon: 'music_note' },
  { slug: 'cryptocurrency', icon: 'currency_bitcoin' },
  { slug: 'education', icon: 'school' },
  { slug: 'sports', icon: 'sports_soccer' },
  { slug: 'art', icon: 'palette' },
  { slug: 'comedy', icon: 'mood' },
  { slug: 'news', icon: 'newspaper' },
];

// The trending pool covers the last seven days, so "This week" is all of it
// and "Today" keeps the last 24 hours.
const RANGES = [
  { value: 'today', labelKey: 'feeds.discover.dates.today', ms: 24 * 60 * 60 * 1000 },
  { value: 'week', labelKey: 'feeds.discover.dates.week', ms: 0 },
];

// Tags every 3Speak upload carries: they say nothing about the video.
const PLATFORM_TAGS = new Set(['3speak', 'threespeak', 'video']);

const fetchVideos = async ({ pageParam = 1 }) => {
  const url = appendNsfw(`${TRENDING_SORTED_URL}?page=${pageParam}&limit=${LIMIT}${feedParams()}`, useAppStore.getState().showNsfw);
  const res = await axios.get(url);
  return res.data;
};

// One topic: the interests feed, which keeps only videos whose winning topic is it.
const fetchTopic = async (topic, page) => {
  const st = useAppStore.getState();
  let p = `&interests=${encodeURIComponent(topic)}`;
  if (st.user) p += `&currentuser=${encodeURIComponent(st.user)}&hidewatched=${st.hideWatched ? '1' : '0'}`;
  const res = await axios.get(appendNsfw(`${INTERESTS_FEED_URL}?page=${page}&limit=${TOPIC_LIMIT}${p}`, st.showNsfw));
  return res.data?.videos || [];
};

const fetchSearch = async (query, boostRecent, activeTypes, { tag, dateFrom, community } = {}) => {
  const params = { q: query, limit: activeTypes.length * LIMIT };
  if (boostRecent) params.sort = 'date';
  if (activeTypes.length < SEARCH_TYPES.length) {
    params.type = activeTypes.join(',');
  }
  if (tag) params.tag = tag;
  if (dateFrom) params.from = dateFrom;
  if (community) params.community = community;
  if (useAppStore.getState().showNsfw) params.nsfw = 'true';
  const res = await axios.get(`${CHECKER_URL}/search`, { params });
  return res.data;
};

const formatDuration = (seconds) => {
  const n = Number(seconds) || 0;
  if (!n) return '';
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const authorOf = (v) => v.author?.username || v.author || v.owner;
const compact = (n) => formatNumber(n, { compact: true });

// A video's tags arrive as a list, sometimes with spaces or a leading '#'.
const cleanTags = (tags) => (Array.isArray(tags) ? tags : [])
  .map((x) => String(x || '').trim().replace(/^#/, '').toLowerCase())
  .filter((x) => x && !PLATFORM_TAGS.has(x) && !/^hive-\d+$/.test(x));

const topTags = (videos, n) => {
  const counts = new Map();
  for (const v of videos) for (const tag of new Set(cleanTags(v.tags))) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
};

const STORAGE_KEY = 'discover-search-state';
const defaultExcluded = SEARCH_TYPES.reduce((acc, type) => ({ ...acc, [type.key]: false }), {});

function loadState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage off */ }
  return null;
}

function saveState(state) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage off */ }
}

/* ---------- Search results (21a) ---------- */

// The save button on a result: the existing "save to playlist" dialog.
function SaveButton({ item }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        icon="bookmark"
        size={56}
        label={t('playlists.addToPlaylist')}
        className="discover-row__save"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!isLoggedIn()) { playlistToast.error(t('playlists.loginToAdd')); return; }
          setOpen(true);
        }}
      />
      {open && (
        <AddToPlaylistModal isOpen onClose={() => setOpen(false)} author={item.author} permlink={item.permlink} videoTitle={item.title} />
      )}
    </>
  );
}

function ResultRow({ item }) {
  const { t } = useTranslation();
  const to = item.type === 'short' ? `/shorts?v=${item.author}/${item.permlink}` : `/@${item.author}/${item.permlink}`;
  const hasThumb = item.images?.thumbnail || item.images?.poster;
  return (
    <div className="discover-row discover-result">
      <Link to={to} className="discover-row__link" aria-label={item.title} />
      <span className="discover-row__thumb">
        {hasThumb && <img src={fixVideoThumbnail(item)} onError={(e) => { e.currentTarget.src = fallbackImg; }} alt="" loading="lazy" />}
        {KIND_KEYS[item.type] && <span className="discover-row__kind">{t(KIND_KEYS[item.type])}</span>}
        {Number(item.duration) > 0 && <span className="discover-row__dur">{formatDuration(item.duration)}</span>}
      </span>
      <span className="discover-row__body">
        <span className="discover-row__title">{item.title}</span>
        <span className="discover-row__meta">
          <span>{item.author || item.owner}</span>
          {Number(item.views) > 0 && <span>{compact(item.views)}</span>}
          {item.created_at && <TimeAgo date={item.created_at} short />}
        </span>
      </span>
      {item.author && item.permlink ? <SaveButton item={item} /> : <span />}
    </div>
  );
}

function PlaylistRow({ p }) {
  const { t } = useTranslation();
  return (
    <div className="discover-row discover-result is-playlist">
      <Link to={`/playlist/${p.id}`} className="discover-row__link" aria-label={p.name} />
      <span className="discover-row__thumb is-icon">
        <Icon name="playlist_play" size={32} />
        <span className="discover-row__kind">{t('nav.search.kinds.playlist')}</span>
      </span>
      <span className="discover-row__body">
        <span className="discover-row__title">{p.name}</span>
        <span className="discover-row__meta">
          <span>{p.owner}</span>
          <span>{t('common.units.videos', { count: p.video_count })}</span>
        </span>
      </span>
      <span />
    </div>
  );
}

// A creator (21a): the picture ringed in cyan, the name, followers, Follow.
function CreatorCard({ u, top }) {
  const { t } = useTranslation();
  const viewer = useAppStore((s) => s.user);
  const followers = useFollowerCount(u.username);
  const [following, setFollowing] = useState(false);
  const [pending, setPending] = useState(false);
  const self = viewer && viewer === u.username;

  // Keyed by the creator (see the callers), so a new one starts from false.
  useEffect(() => {
    let alive = true;
    if (!viewer || self) return undefined;
    getFollowing(viewer, u.username, 1)
      .then((list) => { if (alive) setFollowing(list?.[0] === u.username); })
      .catch(() => { /* unknown: offer Follow */ });
    return () => { alive = false; };
  }, [viewer, u.username, self]);

  const follow = async () => {
    if (!isLoggedIn() || !viewer) { followToast.error(t('profile.creators.loginRequired')); return; }
    setPending(true);
    try {
      await followWithAioha(u.username, true);
      setFollowing(true);
      followToast.success(t('profile.creators.following', { user: u.username }));
    } catch (err) {
      followToast.error(t('profile.creators.followFailed', { user: u.username, error: err?.message || t('profile.creators.pleaseTryAgain') }));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className={cx('discover-creator', top && 'is-top')}>
      <Link to={`/@${u.username}`} className="discover-creator__pic" aria-label={u.display_name || u.username}>
        <span className="discover-creator__inner">
          <span aria-hidden="true">{String(u.username || '?').slice(0, 1).toUpperCase()}</span>
          {u.profile_image && <img src={u.profile_image} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
        </span>
      </Link>
      <div className="discover-creator__body">
        {top && <div className="discover-creator__eyebrow">{t('feeds.discover.topCreator')}</div>}
        <Link to={`/@${u.username}`} className="discover-creator__name">{u.display_name || u.username}</Link>
        <div className="discover-creator__meta">
          {followers != null ? t('profile.creators.followers', { count: followers, num: formatNumber(followers) }) : `@${u.username}`}
        </div>
      </div>
      {!self && (
        <Button
          variant={following ? 'secondary' : 'primary'}
          size={top ? 56 : 44}
          trailing={following ? 'check' : 'person_add'}
          className="discover-creator__follow"
          loading={pending}
          disabled={following || pending}
          onClick={follow}
        >
          {following ? t('common.actions.following') : t('common.actions.follow')}
        </Button>
      )}
    </div>
  );
}

function CommunityRow({ c, joined, joining, onJoin }) {
  const { t } = useTranslation();
  const label = c.title || c.name;
  return (
    <div className="discover-community">
      <Link to={`/community/${c.name}`} className="discover-community__pic" aria-label={label}>
        <span aria-hidden="true">{String(label).slice(0, 1).toUpperCase()}</span>
        <AccountImg account={c.name} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </Link>
      <div className="discover-community__body">
        <Link to={`/community/${c.name}`} className="discover-community__name">{label}</Link>
        {typeof c.subscribers === 'number' && (
          <div className="discover-community__meta">{t('feeds.discover.subscribers', { count: c.subscribers })}</div>
        )}
      </div>
      {joined ? (
        <span className="v2-pill is-cyan">{t('communities.directory.joined')}</span>
      ) : (
        <Button variant="cyan" size={40} loading={joining} disabled={joining} onClick={() => onJoin(c)}>
          {t('communities.directory.join')}
        </Button>
      )}
    </div>
  );
}

// The filters (34b) as a sheet: what to show, the date, a tag and a community,
// boost recent, and the cyan "Show N results" that closes it.
function FiltersSheet({
  open, onClose, visibleTypes, excludedFilters, toggleFilter, resetTypes, allExcluded,
  datePreset, setDatePreset, tagFilter, setTagFilter,
  communityFilter, communityLabel, clearCommunity, communitySearch, setCommunitySearch,
  communityResults, showCommunityDropdown, setShowCommunityDropdown, pickCommunity, communityWrapRef,
  boostRecent, setBoostRecent, hasAdvancedFilters, clearAll, total, loading,
}) {
  const { t } = useTranslation();
  const dateOptions = [
    { value: 0, label: t('feeds.tabs.all') },
    ...DATE_PRESETS.map((p) => ({ value: p.days, label: t(p.labelKey) })),
  ];
  return (
    <Dialog
      open={open}
      onClose={onClose}
      head={false}
      width={460}
      title={t('feeds.discover.filters')}
      closeLabel={t('common.actions.close')}
      className="discover-sheet"
      footer={(
        <Button variant="cyan" size={48} block next loading={loading} onClick={onClose}>
          {t('feeds.discover.showResults', { count: total })}
        </Button>
      )}
    >
      <div className="discover-sheet__head">
        <span className="discover-bar is-cyan" aria-hidden="true" />
        <h2>{t('feeds.discover.filters')}</h2>
        {(hasAdvancedFilters || allExcluded) && (
          <button type="button" className="discover-sheet__clear" onClick={clearAll}>{t('feeds.discover.clearAllFilters')}</button>
        )}
        <IconButton icon="close" size={32} variant="ghost" round label={t('common.actions.close')} onClick={onClose} />
      </div>

      <div className="discover-sheet__eyebrow">{t('feeds.discover.show')}</div>
      <div className="discover-types" role="group" aria-label={t('feeds.discover.show')}>
        {visibleTypes.map((type) => {
          const on = !excludedFilters[type.key];
          return (
            <button key={type.key} type="button" aria-pressed={on} className={cx('discover-type', on && 'is-on')} onClick={() => toggleFilter(type.key)}>
              <Icon name={type.icon} size={16} />
              <span>{t(type.labelKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="discover-sheet__eyebrow">{t('feeds.discover.date')}</div>
      <div className="discover-track is-fill" role="tablist" aria-label={t('feeds.discover.date')}>
        {dateOptions.map((o) => (
          <button key={o.value} type="button" role="tab" aria-selected={(datePreset || 0) === o.value}
            className={cx('discover-track__opt', (datePreset || 0) === o.value && 'is-on')}
            onClick={() => setDatePreset(o.value || null)}>
            {o.label}
          </button>
        ))}
      </div>

      <div className="discover-wells">
        <label className="discover-well">
          <span className="discover-well__label">{t('feeds.discover.tag')}</span>
          <span className="discover-well__input">
            <input
              type="text"
              placeholder={t('feeds.discover.tagPlaceholder')}
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value.trim().toLowerCase())}
            />
            {tagFilter && (
              <button type="button" className="discover-well__clear" onClick={() => setTagFilter('')} aria-label={t('common.actions.remove')}>
                <Icon name="close" size={14} />
              </button>
            )}
          </span>
        </label>

        <div className="discover-well" ref={communityWrapRef}>
          <span className="discover-well__label">{t('feeds.discover.community')}</span>
          {communityFilter ? (
            <span className="discover-well__input">
              <span className="discover-well__value">{communityLabel || communityFilter}</span>
              <button type="button" className="discover-well__clear" aria-label={t('common.actions.remove')} onClick={clearCommunity}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ) : (
            <span className="discover-well__input">
              <input
                type="text"
                placeholder={t('feeds.discover.communityPlaceholder')}
                aria-label={t('feeds.discover.community')}
                value={communitySearch}
                onChange={(e) => { setCommunitySearch(e.target.value); setShowCommunityDropdown(true); }}
                onFocus={() => setShowCommunityDropdown(true)}
              />
            </span>
          )}
          {!communityFilter && showCommunityDropdown && communityResults?.length > 0 && (
            <div className="discover-well__menu v2-menu">
              {communityResults.map((c) => (
                <button key={c.name} type="button" className="v2-menu__row discover-well__option" onMouseDown={(e) => { e.preventDefault(); pickCommunity(c); }}>
                  <span className="discover-well__option-pic">
                    <AccountImg account={c.name} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  </span>
                  <span className="discover-well__option-text">
                    <b>{c.title || c.name}</b>
                    <span>{t('feeds.discover.subscribers', { count: c.subscribers })}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="discover-boost">
        <Icon name="trending_up" size={20} className="discover-boost__icon" />
        <span className="discover-boost__text">
          <b>{t('feeds.discover.boostRecent')}</b>
          <span>{t('feeds.discover.boostRecentHint')}</span>
        </span>
        <Toggle checked={boostRecent} onChange={setBoostRecent} label={t('feeds.discover.boostRecent')} />
      </div>

      {allExcluded && (
        <div className="discover-hidden" role="status">
          <Icon name="visibility_off" size={18} />
          <span>{t('feeds.discover.allHidden')}</span>
          <button type="button" onClick={resetTypes}>{t('feeds.discover.reenableFilters')}</button>
        </div>
      )}
    </Dialog>
  );
}

/* ---------- Browse (21b) ---------- */

function rankTone(i) {
  if (i === 0) return 'is-first';
  if (i < 3) return 'is-podium';
  return '';
}

function TrendRow({ v, index, views, watched }) {
  const { t } = useTranslation();
  const live = !!v._liveStream;
  const author = authorOf(v);
  const to = live ? (v._openpodRoom ? `/openpods/${v.roomName}` : `/watch/${v.roomName}`) : watchPath(author, v.permlink);
  const thumb = live ? v.thumbnail : fixVideoThumbnail(v);
  return (
    <Link to={to} className="discover-row discover-trend">
      <span className={cx('discover-trend__rank', live ? 'is-live' : rankTone(index))}>
        {live ? <Icon name="sensors" size={28} /> : index + 1}
      </span>
      <span className="discover-row__thumb">
        {thumb && <img src={thumb} onError={(e) => { e.currentTarget.src = fallbackImg; }} alt="" loading="lazy" />}
        {live && <span className="discover-row__kind is-live">{v._openpodRoom ? t('cards.badges.liveChat') : t('cards.badges.live')}</span>}
        {watched && !live && <span className="discover-row__kind">{t('cards.watched.title')}</span>}
      </span>
      <span className="discover-row__body">
        <span className="discover-row__title is-trend">{v.title}</span>
        <span className="discover-row__meta">
          <span>{author}</span>
          {live
            ? <span>{t('cards.watchingNow', { count: Number(v.views) || 0 })}</span>
            : Number(views) > 0 && <span>{compact(views)}</span>}
          {!live && (v.created || v.created_at) && <TimeAgo date={v.created || v.created_at} short />}
        </span>
      </span>
    </Link>
  );
}

function TopCreators() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['discover-top-creators'],
    queryFn: () => fetchLeaderboard({ window: '7d', metric: 'video_watch_secs', limit: 3 }),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
  const entries = data?.entries || [];
  if (!entries.length) return null;
  return (
    <section className="discover-panel">
      <div className="discover-panel__head">
        <h2>{t('feeds.discover.topCreators')}</h2>
        <Link to="/leaderboard" className="discover-panel__link">{t('app.routes.rankings')}</Link>
      </div>
      {entries.map((e, i) => (
        <Link key={e.user} to={`/@${e.user}`} className="discover-panel__row">
          <span className={cx('discover-panel__n', rankTone(i))}>{e.rank || i + 1}</span>
          <span className="discover-panel__pic">
            <span aria-hidden="true">{String(e.user).slice(0, 1).toUpperCase()}</span>
            <img src={`/img/u/${e.user}/avatar/small`} alt="" loading="lazy" onError={(ev) => { ev.currentTarget.style.display = 'none'; }} />
          </span>
          <b className="discover-panel__name">{e.user}</b>
          <span className="discover-panel__value">{formatMetric(e.video_watch_secs, 'duration')}</span>
        </Link>
      ))}
    </section>
  );
}

const Discover = () => {
  const { t } = useTranslation();
  const showNsfw = useAppStore(s => s.showNsfw);
  const hideWatched = useAppStore(s => s.hideWatched);
  const hideAi = useAppStore(s => s.hideAi);
  const feedUser = useAppStore(s => s.user);
  const authenticated = useAppStore(s => s.authenticated);
  const incubationHandle = useAppStore(s => s.incubationHandle);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlQ = (searchParams.get('q') || '').trim();
  const [saved] = useState(loadState);
  // The URL is where the search lives (the top bar sends people to ?q=); the
  // filters come back from this tab's session.
  const [searchTerm, setSearchTerm] = useState(urlQ);
  const [debouncedTerm, setDebouncedTerm] = useState(urlQ);
  const [excludedFilters, setExcludedFilters] = useState(() => saved?.filters || defaultExcluded);
  const [boostRecent, setBoostRecent] = useState(() => saved?.boostRecent ?? true);
  const [tagFilter, setTagFilter] = useState(() => saved?.tagFilter || '');
  const [communityFilter, setCommunityFilter] = useState(() => saved?.communityFilter || '');
  const [datePreset, setDatePreset] = useState(() => saved?.datePreset ?? null);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityLabel, setCommunityLabel] = useState(() => saved?.communityLabel || '');
  const [showCommunityDropdown, setShowCommunityDropdown] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  // The result tab belongs to one search: a new term starts on All.
  const [tabState, setTabState] = useState({ term: urlQ, tab: 'all' });
  const [topic, setTopic] = useState(null);
  const [range, setRange] = useState('week');
  const [rangeSince, setRangeSince] = useState(0);
  const navigate = useNavigate();
  const searchInputRef = useRef(null);
  const suggestWrapRef = useRef(null);
  const communityWrapRef = useRef(null);
  const scrollRestored = useRef(false);
  const lastScrollY = useRef(0);
  const writtenQ = useRef(urlQ);
  const queryClient = useQueryClient();

  // Track scroll position continuously so we have it before ScrollToTop zeroes it
  useEffect(() => {
    const onScroll = () => { lastScrollY.current = window.scrollY; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // The URL follows what was typed (replace, so typing is not a history entry
  // per word), and a new ?q= from outside (the top bar) replaces the field.
  useEffect(() => {
    if (debouncedTerm === urlQ) return;
    writtenQ.current = debouncedTerm;
    setSearchParams(debouncedTerm ? { q: debouncedTerm } : {}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedTerm]);
  useEffect(() => {
    if (urlQ === writtenQ.current) return;
    writtenQ.current = urlQ;
    setSearchTerm(urlQ);
    setDebouncedTerm(urlQ);
    setShowSuggestions(false);
  }, [urlQ]);

  // Save state on unmount
  useEffect(() => {
    return () => {
      saveState({
        // ScrollToTop reads this: a search to come back to keeps its scroll.
        searchTerm: debouncedTerm,
        filters: excludedFilters,
        boostRecent,
        tagFilter,
        communityFilter,
        communityLabel,
        datePreset,
        scrollY: lastScrollY.current,
      });
    };
  });

  // Trending list query
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ["trending", showNsfw, hideWatched, feedUser],
    queryFn: fetchVideos,
    getNextPageParam: (lastPage) => {
      if (!lastPage || lastPage.page >= lastPage.totalPages) return undefined;
      return lastPage.page + 1;
    },
  });

  // One topic picked from the tiles: its own list.
  const topicQ = useInfiniteQuery({
    queryKey: ["discover-topic", topic, showNsfw, hideWatched, feedUser],
    queryFn: ({ pageParam = 1 }) => fetchTopic(topic, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => ((last?.length || 0) > 0 ? all.length + 1 : undefined),
    enabled: !!topic,
    staleTime: 5 * 60 * 1000,
  });

  // Active type keys (non-excluded)
  const activeTypes = useMemo(
    () => SEARCH_TYPES.filter(type => !excludedFilters[type.key]).map(type => type.key),
    [excludedFilters]
  );

  // Compute dateFrom from preset
  const dateFrom = useMemo(() => {
    if (!datePreset) return '';
    const d = new Date();
    d.setDate(d.getDate() - datePreset);
    return d.toISOString().split('T')[0];
  }, [datePreset]);

  // Extra filters object
  const extraFilters = useMemo(
    () => ({ tag: tagFilter, dateFrom, community: communityFilter }),
    [tagFilter, dateFrom, communityFilter]
  );

  // Close dropdowns on outside click
  useEffect(() => {
    const handle = (e) => {
      if (suggestWrapRef.current && !suggestWrapRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
      if (communityWrapRef.current && !communityWrapRef.current.contains(e.target)) {
        setShowCommunityDropdown(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Community search query
  const { data: communityResults } = useQuery({
    queryKey: ["community-suggest", communitySearch],
    queryFn: async () => {
      const params = { q: communitySearch, type: 'community', limit: 8 };
      if (useAppStore.getState().showNsfw) params.nsfw = 'true';
      const res = await axios.get(`${CHECKER_URL}/search`, { params });
      return res.data?.results || [];
    },
    enabled: communitySearch.length >= 2 && showCommunityDropdown,
    staleTime: 15000,
  });

  // Search query
  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ["discover-search", debouncedTerm, boostRecent, activeTypes, extraFilters],
    queryFn: () => fetchSearch(debouncedTerm, boostRecent, activeTypes, extraFilters),
    enabled: debouncedTerm.length >= 2 && activeTypes.length > 0,
    staleTime: 30000,
  });

  // Restore scroll position after search results load
  useEffect(() => {
    if (scrollRestored.current || !saved?.scrollY) return;
    if (debouncedTerm.length < 2) {
      scrollRestored.current = true;
      // ScrollToTop skipped this visit for a saved search that is not in the URL.
      if (saved?.searchTerm) window.scrollTo(0, 0);
      return;
    }
    if (searchData && !searchLoading) {
      requestAnimationFrame(() => {
        window.scrollTo(0, saved.scrollY);
        scrollRestored.current = true;
      });
    }
  });

  // Infinite scroll for the trending list (or the picked topic's)
  const listQ = topic
    ? { fetchNextPage: topicQ.fetchNextPage, hasNextPage: topicQ.hasNextPage, isFetchingNextPage: topicQ.isFetchingNextPage }
    : { fetchNextPage, hasNextPage, isFetchingNextPage };
  useEffect(() => {
    if (debouncedTerm) return undefined;
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 200 &&
        !listQ.isFetchingNextPage && listQ.hasNextPage
      ) {
        listQ.fetchNextPage();
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [listQ.isFetchingNextPage, listQ.hasNextPage, listQ.fetchNextPage, debouncedTerm]); // eslint-disable-line react-hooks/exhaustive-deps

  const videos = useMemo(() => data?.pages.flatMap(page => page.videos || []) || [], [data]);
  const topicVideos = useMemo(() => (topicQ.data?.pages || []).flat(), [topicQ.data]);
  const liveStreams = useLiveStreams(); // live OpenPods streams lead the list

  // "Hide AI-generated": drop flagged videos, the same as the card grids do.
  const pool = topic ? topicVideos : videos;
  const aiKeys = useMemo(() => pool.flatMap((v) => [aiKey(authorOf(v), v.permlink), v.owner ? aiKey(v.owner, v.permlink) : null].filter(Boolean)), [pool]);
  const aiVersion = useAiFlags(aiKeys);
  const listVideos = useMemo(() => {
    return pool
      .filter((v) => !rangeSince || new Date(v.created || v.created_at).getTime() >= rangeSince)
      .filter((v) => !(hideAi && (isAiFlagged(authorOf(v), v.permlink) || (v.owner && isAiFlagged(v.owner, v.permlink)))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, rangeSince, hideAi, aiVersion]);
  const { isWatched } = useWatchHistory(listVideos);
  const { getViewCount } = useViewCounts(listVideos);
  const trendingTags = useMemo(() => topTags(videos, 5), [videos]);

  const handleRefresh = useCallback(async () => {
    if (debouncedTerm) {
      await queryClient.invalidateQueries({ queryKey: ["discover-search", debouncedTerm] });
    } else {
      await queryClient.invalidateQueries({ queryKey: topic ? ["discover-topic", topic] : ["trending"] });
    }
  }, [queryClient, debouncedTerm, topic]);

  const toggleFilter = useCallback((key) => {
    setExcludedFilters(prev => {
      const wasActive = !prev[key];
      const activeCount = SEARCH_TYPES.filter(type => !prev[type.key]).length;

      // If all are active (default state), solo-select this one
      if (activeCount === SEARCH_TYPES.length) {
        const next = {};
        for (const type of SEARCH_TYPES) next[type.key] = type.key !== key;
        return next;
      }

      // If this is the only active one and we're clicking it, reset to all
      if (wasActive && activeCount === 1) {
        return defaultExcluded;
      }

      // Otherwise toggle this one
      return { ...prev, [key]: !prev[key] };
    });
  }, []);

  const runSearch = useCallback((value) => {
    const q = String(value || '').trim();
    setSearchTerm(q);
    setDebouncedTerm(q);
    setShowSuggestions(false);
    if (q.length >= 2) addRecentSearch(q);
    searchInputRef.current?.blur();
  }, []);

  const hasAdvancedFilters = !!(tagFilter || communityFilter || datePreset);

  const clearAdvancedFilters = useCallback(() => {
    setTagFilter('');
    setCommunityFilter('');
    setCommunityLabel('');
    setCommunitySearch('');
    setDatePreset(null);
    setExcludedFilters(defaultExcluded);
  }, []);

  // Group search results by type
  const grouped = useMemo(() => {
    if (!searchData?.results) return {};
    const groups = {};
    for (const item of searchData.results) {
      if (!groups[item.type]) groups[item.type] = [];
      groups[item.type].push(item);
    }
    return groups;
  }, [searchData]);

  // Communities joined, for the Join buttons on community results.
  const hasCommunities = (grouped.community?.length || 0) > 0;
  const [mine, setMine] = useJoinedCommunities({ enabled: hasCommunities });
  const [joining, setJoining] = useState('');
  const handleJoin = async (community) => {
    if (joining) return;
    if (!canSubscribe({ authenticated, incubationHandle })) {
      communityToast.error(t('communities.page.loginToSubscribe'));
      return;
    }
    const label = community.title || community.name;
    setJoining(community.name);
    try {
      await setCommunitySubscription({ id: community.name, next: true, incubationHandle, prompt: t('communities.page.subscribeTo', { label }) });
      setMine((prev) => new Set([...prev, community.name]));
      communityToast.success(t('communities.page.subscribedTo', { label }));
    } catch (err) {
      communityToast.error(t('communities.page.subscriptionFailed', { error: err?.message || t('communities.page.unknownError') }));
    } finally {
      setJoining('');
    }
  };

  const isSearching = debouncedTerm.length >= 2;
  const allExcluded = activeTypes.length === 0;
  const hasResults = Object.keys(grouped).length > 0;
  const visibleTypes = SEARCH_TYPES.filter(type => !communityFilter || (type.key !== 'user' && type.key !== 'community'));
  const shownTypes = new Set(visibleTypes.map((x) => x.key));
  const tabs = RESULT_TABS.filter((x) => shownTypes.has(x.key) && grouped[x.key]?.length);
  const tab = tabState.term === debouncedTerm ? tabState.tab : 'all';
  const setTab = (key) => setTabState({ term: debouncedTerm, tab: key });
  const activeTab = tab === 'all' || tabs.some((x) => x.key === tab) ? tab : 'all';
  const mediaRows = (searchData?.results || []).filter((r) => MEDIA_TYPES.has(r.type) && shownTypes.has(r.type));
  const relatedTags = topTags(mediaRows, 8);
  const total = Number(searchData?.total) || (searchData?.results?.length ?? 0);
  const topCreator = shownTypes.has('user') ? grouped.user?.[0] : null;

  const renderMain = () => {
    if (activeTab === 'user') return (grouped.user || []).map((u) => <CreatorCard key={u.username} u={u} />);
    if (activeTab === 'community') {
      return (
        <div className="discover-panel is-list">
          {(grouped.community || []).map((c) => (
            <CommunityRow key={c.name} c={c} joined={mine.has(c.name)} joining={joining === c.name} onJoin={handleJoin} />
          ))}
        </div>
      );
    }
    if (activeTab === 'playlist') return (grouped.playlist || []).map((p) => <PlaylistRow key={p.id} p={p} />);
    if (MEDIA_TYPES.has(activeTab)) {
      return (grouped[activeTab] || []).map((item, i) => <ResultRow key={`${item.author}-${item.permlink}-${i}`} item={item} />);
    }
    return (
      <>
        {topCreator && <CreatorCard key={topCreator.username} u={topCreator} top />}
        {mediaRows.map((item, i) => <ResultRow key={`${item.author}-${item.permlink}-${i}`} item={item} />)}
        {shownTypes.has('playlist') && (grouped.playlist || []).map((p) => <PlaylistRow key={p.id} p={p} />)}
      </>
    );
  };

  const communities = shownTypes.has('community') ? (grouped.community || []).slice(0, 3) : [];

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className={cx('discover-container', isSearching ? 'is-search' : 'is-browse')}>
      {!isSearching && <h1 className="discover-title">{t('feeds.home.sections.discover')}</h1>}

      {/* The big search field (21a). On desktop the browse view leaves it to
          the top bar's field; phones and tablets, which have no field up
          there, keep it here. */}
      <div className={cx('discover-search', !isSearching && 'is-idle')} ref={suggestWrapRef}>
        <div className="discover-search__field">
          <Icon name="search" size={28} className="discover-search__icon" />
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch(searchTerm);
              if (e.key === 'Escape') setShowSuggestions(false);
            }}
            type="search"
            enterKeyHint="search"
            placeholder={t('feeds.discover.searchPlaceholder')}
            className="discover-search__input"
            aria-label={t('feeds.discover.searchPlaceholder')}
          />
          {searchTerm && (
            <IconButton
              icon="close"
              size={44}
              label={t('feeds.discover.clearSearch')}
              className="discover-search__btn"
              onClick={() => { setSearchTerm(''); setDebouncedTerm(''); searchInputRef.current?.focus(); }}
            />
          )}
          {isSearching && (
            <IconButton
              icon="tune"
              size={44}
              label={t('feeds.discover.filters')}
              className={cx('discover-search__btn', (hasAdvancedFilters || allExcluded) && 'has-filters')}
              aria-pressed={showAdvanced}
              onClick={() => setShowAdvanced(true)}
            />
          )}
        </div>
        {showSuggestions && (
          <SearchSuggest
            className="discover-search__suggest"
            term={debouncedTerm}
            onSearch={runSearch}
            onNavigate={(path) => { setShowSuggestions(false); navigate(path); }}
          />
        )}
      </div>

      {isSearching ? (
        <>
          {tabs.length > 0 && !allExcluded && (
            <div className="discover-track is-tabs" role="tablist" aria-label={t('feeds.discover.resultTypes')}>
              <button type="button" role="tab" aria-selected={activeTab === 'all'} className={cx('discover-track__opt', activeTab === 'all' && 'is-on')} onClick={() => setTab('all')}>
                {t('feeds.tabs.all')}
              </button>
              {tabs.map((x) => (
                <button key={x.key} type="button" role="tab" aria-selected={activeTab === x.key} className={cx('discover-track__opt', activeTab === x.key && 'is-on')} onClick={() => setTab(x.key)}>
                  {t(x.labelKey)}<span className="discover-track__n">{grouped[x.key].length}</span>
                </button>
              ))}
            </div>
          )}

          <div className="discover-grid is-search">
            <div className="discover-main">
              {searchLoading && (
                <div className="discover-skeleton" aria-busy="true">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="discover-row is-skeleton">
                      <span className="discover-row__thumb" />
                      <span className="discover-row__body">
                        <span className="v2-skeleton is-line" />
                        <span className="v2-skeleton is-line is-short" />
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {!searchLoading && allExcluded && (
                <div className="discover-hidden" role="status">
                  <Icon name="visibility_off" size={18} />
                  <span>{t('feeds.discover.allHidden')}</span>
                  <button type="button" onClick={() => setExcludedFilters(defaultExcluded)}>{t('feeds.discover.reenableFilters')}</button>
                </div>
              )}

              {!searchLoading && !allExcluded && !hasResults && (
                <EmptyState
                  icon="search_off"
                  title={t('feeds.discover.noResultsFor', { term: debouncedTerm })}
                  className="discover-empty"
                  action={<Button size={36} onClick={() => { setSearchTerm(''); setDebouncedTerm(''); searchInputRef.current?.focus(); }}>{t('feeds.discover.clearSearch')}</Button>}
                />
              )}

              {!searchLoading && !allExcluded && hasResults && renderMain()}
            </div>

            {!searchLoading && !allExcluded && (communities.length > 0 || relatedTags.length > 0) && (
              <aside className="discover-aside">
                {communities.length > 0 && activeTab !== 'community' && (
                  <section className="discover-panel">
                    <div className="discover-panel__head"><h2>{t('feeds.discover.types.community')}</h2></div>
                    {communities.map((c) => (
                      <CommunityRow key={c.name} c={c} joined={mine.has(c.name)} joining={joining === c.name} onJoin={handleJoin} />
                    ))}
                  </section>
                )}
                {relatedTags.length > 0 && (
                  <section className="discover-panel">
                    <div className="discover-panel__head"><h2>{t('feeds.discover.relatedTags')}</h2></div>
                    <div className="discover-tags">
                      {relatedTags.map(([tag]) => (
                        <Link key={tag} to={`/t/${encodeURIComponent(tag)}`} className="discover-tag">#{tag}</Link>
                      ))}
                    </div>
                  </section>
                )}
              </aside>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="discover-cats" role="group" aria-label={t('feeds.discover.categories')}>
            {CATEGORIES.map((c) => (
              <button
                key={c.slug}
                type="button"
                aria-pressed={topic === c.slug}
                className={cx('discover-cat', topic === c.slug && 'is-on')}
                onClick={() => setTopic((cur) => (cur === c.slug ? null : c.slug))}
              >
                <Icon name={c.icon} size={28} />
                <b>{t(`tags.labels.${c.slug}`)}</b>
              </button>
            ))}
          </div>

          <div className="discover-grid">
            <div className="discover-main">
              <div className="discover-main__head">
                <h2>{topic ? t(`tags.labels.${topic}`) : t('common.nav.trending')}</h2>
                <div className="discover-track is-small" role="tablist" aria-label={t('common.nav.trending')}>
                  {RANGES.map((r) => (
                    <button key={r.value} type="button" role="tab" aria-selected={range === r.value} className={cx('discover-track__opt', range === r.value && 'is-on')} onClick={() => { setRange(r.value); setRangeSince(r.ms ? Date.now() - r.ms : 0); }}>
                      {t(r.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {(topic ? topicQ.isLoading : isLoading) ? (
                <div className="discover-skeleton" aria-busy="true">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="discover-row discover-trend is-skeleton">
                      <span className="discover-trend__rank" />
                      <span className="discover-row__thumb" />
                      <span className="discover-row__body">
                        <span className="v2-skeleton is-line" />
                        <span className="v2-skeleton is-line is-short" />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="discover-list">
                  {!topic && liveStreams.map((v) => <TrendRow key={`live-${v.roomName}`} v={v} index={0} />)}
                  {listVideos.map((v, i) => {
                    const author = authorOf(v);
                    const views = v.views ?? v.stats?.num_views ?? getViewCount?.(author, v.permlink);
                    return <TrendRow key={`${author}/${v.permlink}`} v={v} index={i} views={views} watched={isWatched?.(author, v.permlink) === true} />;
                  })}
                  {!listVideos.length && !(topic ? topicQ.hasNextPage : hasNextPage) && (
                    <EmptyState icon="video_library" title={t('feeds.home.empty')} className="discover-empty" />
                  )}
                </div>
              )}
              {(topic ? topicQ.isError : isError) && <p className="discover-error" role="alert">{t('feeds.errors.fetchVideos')}</p>}
              {listQ.isFetchingNextPage && (
                <p className="discover-loading-more">{t('feeds.loadingMore')}</p>
              )}
            </div>

            <aside className="discover-aside">
              {trendingTags.length > 0 && (
                <section className="discover-panel">
                  <div className="discover-panel__head"><h2>{t('feeds.discover.trendingTags')}</h2></div>
                  {trendingTags.map(([tag, count], i) => (
                    <Link key={tag} to={`/t/${encodeURIComponent(tag)}`} className="discover-panel__row">
                      <span className="discover-panel__n">{i + 1}</span>
                      <b className="discover-panel__name">#{tag}</b>
                      <span className="discover-panel__value is-cyan">{formatNumber(count)}</span>
                    </Link>
                  ))}
                </section>
              )}
              <TopCreators />
            </aside>
          </div>
        </>
      )}

      <FiltersSheet
        open={isSearching && showAdvanced}
        onClose={() => setShowAdvanced(false)}
        visibleTypes={visibleTypes}
        excludedFilters={excludedFilters}
        toggleFilter={toggleFilter}
        resetTypes={() => setExcludedFilters(defaultExcluded)}
        allExcluded={allExcluded}
        datePreset={datePreset}
        setDatePreset={setDatePreset}
        tagFilter={tagFilter}
        setTagFilter={setTagFilter}
        communityFilter={communityFilter}
        communityLabel={communityLabel}
        clearCommunity={() => { setCommunityFilter(''); setCommunityLabel(''); setCommunitySearch(''); }}
        communitySearch={communitySearch}
        setCommunitySearch={setCommunitySearch}
        communityResults={communityResults}
        showCommunityDropdown={showCommunityDropdown}
        setShowCommunityDropdown={setShowCommunityDropdown}
        pickCommunity={(c) => {
          setCommunityFilter(c.name);
          setCommunityLabel(c.title || c.name);
          setCommunitySearch('');
          setShowCommunityDropdown(false);
        }}
        communityWrapRef={communityWrapRef}
        boostRecent={boostRecent}
        setBoostRecent={setBoostRecent}
        hasAdvancedFilters={hasAdvancedFilters}
        clearAll={clearAdvancedFilters}
        total={allExcluded ? 0 : total}
        loading={searchLoading && !allExcluded}
      />
    </div>
    </PullToRefresh>
  );
};

export default Discover;
