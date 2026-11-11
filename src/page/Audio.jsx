import { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../lib/store';
import { CHECKER_URL, HIVE_API_URL } from '../utils/config';
import { withViewer } from '../utils/userFilters';
import AuthorBadge from '../components/AuthorBadge/AuthorBadge';
import AudioAuthorBadge from './AudioAuthorBadge';
import CommentVoteTooltip from '../components/tooltip/CommentVoteTooltip';
import AddToPlaylistModal from '../components/AddToPlaylistModal/AddToPlaylistModal';
import { AudioShareDropdown } from '../components/GlobalAudioPlayer/GlobalAudioPlayer';
import AudioItemView from '../components/AudioItem/AudioItemView';
import { usePodcastSubscriptions } from '../lib/podcasts';
import { useDownloads } from '../lib/podcastDownloads';
import { useContinueListening } from '../components/Podcasts/ContinueListening';
import useOnline from '../hooks/useOnline';
import AudioTile, { AudioTileSkeleton } from '../components/AudioTile/AudioTile';
import { audioCategorySymbol } from '../components/AudioTile/audioSymbols';
import { Segmented, Chip, Button, EmptyState } from '../components/v2/ui';
import { Icon } from '../components/v2/Icon';
import { cx } from '../components/v2/helpers';
import AudioPlaylistTile from '../components/AudioPlaylistTile/AudioPlaylistTile';
import PodcastsTab, { VIEWS as EXPLORE_VIEWS, VIEW_KEY as EXPLORE_VIEW_KEY } from '../components/Podcasts/PodcastsTab';
import { isLoggedIn } from '../hive-api/aioha';

import './Audio.scss';

// Service/system accounts whose audio + albums are hidden from the audio page.
// Frontend-only filter applied to every audio/album query result below.
const HIDDEN_AUDIO_OWNERS = new Set(['badadib']);
const isHiddenOwner = (owner) => HIDDEN_AUDIO_OWNERS.has(owner);

// The phone and tablet layout (the bottom navigation shows up to 1024 px): there
// the page has two tabs, Player (the player as a page) and Explore (everything below).
const MOBILE_QUERY = '(max-width: 1024px)';
const subscribeMobile = (cb) => {
  const m = window.matchMedia(MOBILE_QUERY);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};
const isMobileLayout = () => window.matchMedia(MOBILE_QUERY).matches;

// Horizontal tile rail whose height adapts to how many tiles there are:
// - everything fits in one visible row  → 1 row
// - more than two rows' worth of tiles  → 3 rows
// - otherwise                           → 2 rows (the default)
// Column count is measured from the actual rendered width so it stays correct
// across breakpoints and window resizes.
function AudioTileRow({ count, children }) {
  const ref = useRef(null);
  const [rows, setRows] = useState(2);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const first = el.firstElementChild;
      if (!first) return;
      const colW = first.getBoundingClientRect().width;
      if (!colW) return;
      const gap = parseFloat(getComputedStyle(el).columnGap) || 12;
      const perRow = Math.max(1, Math.floor((el.clientWidth + gap) / (colW + gap)));
      setRows(count <= perRow ? 1 : count > perRow * 2 ? 3 : 2);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [count]);

  return (
    <div className="audio-tile-row" ref={ref} style={{ '--audio-rows': rows }}>
      {children}
    </div>
  );
}

const SECTION_CONFIG = {
  popular:       { labelKey: 'audio.page.sections.popular' },
  recent:        { labelKey: 'audio.page.sections.recent' },
  podcast:       { labelKey: 'audio.page.sections.podcasts' },
  song:          { labelKey: 'audio.page.sections.songs' },
  audiobook:     { labelKey: 'audio.page.sections.audiobooks' },
  interview:     { labelKey: 'audio.page.sections.interviews' },
};
const SECTION_ORDER = ['popular', 'recent', 'podcast', 'song', 'audiobook', 'interview'];

const DATE_PRESETS = [
  { labelKey: 'audio.page.dates.today', days: 1 },
  { labelKey: 'audio.page.dates.thisWeek', days: 7 },
  { labelKey: 'audio.page.dates.thisMonth', days: 30 },
  { labelKey: 'audio.page.dates.thisYear', days: 365 },
];

const DEFAULT_DATE_PRESET = 30;

// Logarithmic-feel snap stops from 0s (no minimum) to 4h
const DURATION_STOPS = [0, 5, 10, 15, 30, 45, 60, 120, 180, 300, 600, 900, 1800, 3600, 7200, 10800, 14400];

// Available content types for the type filter (matches the existing
// 3speak audio categories on the embed-audio docs).
const TYPE_FILTERS = [
  { value: 'song',          labelKey: 'audio.categories.music',      icon: audioCategorySymbol('song') },
  { value: 'podcast',       labelKey: 'audio.page.sections.podcasts',   icon: audioCategorySymbol('podcast') },
  { value: 'voice_message', labelKey: 'audio.categories.voice',      icon: audioCategorySymbol('voice_message') },
  { value: 'audiobook',     labelKey: 'audio.page.sections.audiobooks', icon: audioCategorySymbol('audiobook') },
  { value: 'interview',     labelKey: 'audio.page.sections.interviews', icon: audioCategorySymbol('interview') },
];

// Music genres for the dropdown when type filter = music. Same list the
// upload wizard uses, so labels stay in sync.
const MUSIC_GENRE_FILTERS = [
  'Electronic', 'Hip-Hop', 'Rock', 'Pop', 'Jazz', 'Classical', 'Folk',
  'Country', 'Reggae', 'R&B', 'Metal', 'Ambient', 'Funk', 'Soul', 'Blues',
  'Indie', 'Latin', 'World', 'House', 'Techno', 'Drum & Bass', 'Lo-Fi',
];
const DEFAULT_MIN_DUR_IDX = 2;  // 10s
const DEFAULT_MAX_DUR_IDX = 13; // 1h

function fmtDur(sec, t) {
  if (sec < 60) return t('audio.page.duration.seconds', { value: sec });
  if (sec < 3600) {
    const m = sec / 60;
    return t('audio.page.duration.minutes', { value: Number.isInteger(m) ? m : m.toFixed(1) });
  }
  const h = sec / 3600;
  return t('audio.page.duration.hours', { value: Number.isInteger(h) ? h : h.toFixed(1) });
}

const FILTER_STORAGE_KEY = 'audio-filters-v3';

const EXTERNAL_KEY = 'audio-external-selected';
const readExternal = () => { try { return localStorage.getItem(EXTERNAL_KEY) === '1'; } catch { return false; } };
const rememberExternal = (on) => { try { if (on) localStorage.setItem(EXTERNAL_KEY, '1'); else localStorage.removeItem(EXTERNAL_KEY); } catch { /* private mode */ } };

function loadFilters() {
  const fallback = {
    activeTags: [],
    datePreset: DEFAULT_DATE_PRESET,
    minDurIdx: DEFAULT_MIN_DUR_IDX,
    maxDurIdx: DEFAULT_MAX_DUR_IDX,
    type: '',
    genre: '',
  };
  try {
    const s = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!s) return fallback;
    const f = JSON.parse(s);
    const stops = DURATION_STOPS.length;
    const validIdx = (v, d) => Number.isInteger(v) && v >= 0 && v < stops ? v : d;
    const validDate = DATE_PRESETS.some(p => p.days === f.datePreset) ? f.datePreset : DEFAULT_DATE_PRESET;
    const tags = Array.isArray(f.activeTags)
      ? f.activeTags.filter(t => typeof t === 'string' && t)
      : (typeof f.activeTag === 'string' && f.activeTag ? [f.activeTag] : []);
    const validType = TYPE_FILTERS.some((t) => t.value === f.type) ? f.type : '';
    return {
      activeTags: tags,
      datePreset: validDate,
      minDurIdx: validIdx(f.minDurIdx, DEFAULT_MIN_DUR_IDX),
      maxDurIdx: validIdx(f.maxDurIdx, DEFAULT_MAX_DUR_IDX),
      type: validType,
      genre: typeof f.genre === 'string' ? f.genre : '',
    };
  } catch {
    return fallback;
  }
}


function Audio() {
  const { t } = useTranslation();
  const { showNsfw, authenticated, user, audioCurrent, audioIsPlaying, audioPlay, audioAddToQueue, audioSetDock, audioSetDockOpener } = useAppStore();
  const loggedIn = authenticated && isLoggedIn();

  // "External": podcasts from outside RSS feeds (components/Podcasts). It is the last
  // type chip, but lives in the URL rather than in the saved type filter, because
  // that filter goes to the checker's 3Speak audio queries.
  // The choice is remembered like the other chips: landing on a bare /audio after
  // leaving it on External goes back to External.
  const [params, setParams] = useSearchParams();
  const external = params.get('type') === 'external' || params.has('podcast') || params.has('episode');

  // Explore's own navigation: Mine | Discover | Trends (?view=, shared with the
  // podcasts tab). Mine is your library (followed podcasts, downloads), with no
  // chips; under Discover and Trends the type chips pick 3Speak audio or the
  // outside podcasts (External). Without one: the last one picked, else Discover.
  const online = useOnline();
  const exploreView = (() => {
    const v = params.get('view');
    if (EXPLORE_VIEWS.includes(v)) return v;
    // Offline, only what was saved here plays: open on Mine (the downloads).
    if (!online) return 'mine';
    try {
      const saved = localStorage.getItem(EXPLORE_VIEW_KEY);
      if (EXPLORE_VIEWS.includes(saved)) return saved;
    } catch { /* storage off */ }
    return 'discover';
  })();
  const showExploreView = (v) => {
    const next = new URLSearchParams(params);
    for (const k of ['podcast', 'episode', 'play', 't', 'end']) next.delete(k);
    next.set('view', v);
    setParams(next);
    setSelectedCreator(null);
    try { localStorage.setItem(EXPLORE_VIEW_KEY, v); } catch { /* storage off */ }
  };
  const onMine = exploreView === 'mine';

  // An empty Mine (no followed podcasts, nothing downloaded) has nothing to
  // show: Discover instead, in place, once both are known.
  const me = authenticated ? user : null;
  const mineSubs = usePodcastSubscriptions(me);
  const mineDownloads = useDownloads();
  const mineContinue = useContinueListening(me);
  const mineKnown = (!me || (mineSubs.isSuccess && !mineContinue.isPending)) && mineDownloads.ready;
  const mineEmpty = mineKnown && !(mineSubs.data || []).length && !mineDownloads.items.length && !(mineContinue.data || []).length;
  const insideMine = params.has('podcast') || params.has('episode') || params.has('play');
  useEffect(() => {
    if (!onMine || !mineEmpty || insideMine || !online) return;
    const next = new URLSearchParams(params);
    next.set('view', 'discover');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onMine, mineEmpty, insideMine, online]);

  // One 3Speak audio on its own page, like an outside episode: ?play=<owner>/<id>
  // (shared player links, a click on an audio card). See AudioItemView.
  const [itemOwner, itemId] = String(params.get('play') || '').replace(/^@/, '').split('/');
  const item = !external && itemOwner && itemId ? { owner: itemOwner.toLowerCase(), id: itemId } : null;
  const openItem = useCallback((it) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const k of ['type', 'podcast', 'episode', 't', 'end', 'player']) next.delete(k);
      next.set('play', `${it.owner}/${it.permlink}`);
      return next;
    });
    window.scrollTo({ top: 0 });
  }, [setParams]);
  const closeItem = () => {
    const next = new URLSearchParams(params);
    for (const k of ['play', 't', 'end']) next.delete(k);
    setParams(next);
  };

  // Player | Explore on phones and tablets, in the URL (`player=1`; the podcasts tab already uses `view`) so Back
  // returns to the tab. The Player tab hands its element to the global player,
  // which draws its controls there; the audio itself never leaves the global
  // player, so it keeps playing on Explore and on every other page.
  const mobile = useSyncExternalStore(subscribeMobile, isMobileLayout, () => false);
  const playerView = mobile && params.get('player') === '1';
  const showPlayerTab = useCallback((on) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (on) next.set('player', '1'); else next.delete('player');
      return next;
    });
  }, [setParams]);
  // The bar's open button goes to the Player tab while this page shows tabs.
  useEffect(() => {
    if (!mobile) return undefined;
    audioSetDockOpener(() => showPlayerTab(true));
    return () => audioSetDockOpener(null);
  }, [mobile, showPlayerTab, audioSetDockOpener]);
  const dockRef = useCallback((el) => audioSetDock(el), [audioSetDock]);
  // The Player tab never sits empty while there is something to play: it loads,
  // paused, what was playing when the player was closed (at that spot), or else
  // the top of the queue, which it shows unfolded under the player.
  const hasCurrent = !!audioCurrent;
  useEffect(() => {
    if (!playerView || hasCurrent) return;
    const st = useAppStore.getState();
    if (st.audioLast) st.audioResumeLast(false);
    else if (st.audioQueue.length) st.audioLoadPaused(st.audioQueue[0], 0, st.audioQueue);
  }, [playerView, hasCurrent]);
  const leaveExternal = () => {
    rememberExternal(false);
    if (!external && !item) return;
    const next = new URLSearchParams(params);
    for (const k of ['type', 'podcast', 'episode', 'play', 't', 'end']) next.delete(k);
    setParams(next);
  };
  useEffect(() => {
    if (external) { rememberExternal(true); return; }
    // A bare /audio: back on the podcasts chip if that is where the listener left
    // off, and on phones and tablets on the Player tab while something is loaded
    // in the player or waiting in the queue (Explore otherwise). One URL change
    // for both, in place.
    if ([...params.keys()].length) return;
    const next = new URLSearchParams();
    if (readExternal()) next.set('type', 'external');
    const st = useAppStore.getState();
    if (mobile && (st.audioCurrent || st.audioQueue.length)) next.set('player', '1');
    if ([...next.keys()].length) setParams(next, { replace: true });
    // Only on arrival and when the URL itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [external]);

  // Filters (persisted in localStorage)
  const [activeTags, setActiveTags] = useState(() => loadFilters().activeTags);
  const [datePreset, setDatePreset] = useState(() => loadFilters().datePreset);
  const [minDurIdx, setMinDurIdx] = useState(() => loadFilters().minDurIdx);
  const [maxDurIdx, setMaxDurIdx] = useState(() => loadFilters().maxDurIdx);
  const [typeFilter, setTypeFilter] = useState(() => loadFilters().type);
  const [genreFilter, setGenreFilter] = useState(() => loadFilters().genre);
  const [selectedCreator, setSelectedCreator] = useState(null);

  const toggleTag = useCallback((name) => {
    setActiveTags(prev => prev.includes(name) ? prev.filter(tag => tag !== name) : [...prev, name]);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
        activeTags, datePreset, minDurIdx, maxDurIdx, type: typeFilter, genre: genreFilter,
      }));
    } catch { /* storage off */ }
  }, [activeTags, datePreset, minDurIdx, maxDurIdx, typeFilter, genreFilter]);

  // Upload modal

  // Vote + playlist + share targets for the tile-level interactions
  // (the now-playing bar manages its own copies inside <GlobalAudioPlayer />)
  const [showVoteTooltip, setShowVoteTooltip] = useState(false);
  const [voteTarget, setVoteTarget] = useState(null);
  const [weight, setWeight] = useState(100);
  const [voteValue, setVoteValue] = useState(0);
  const [accountData, setAccountData] = useState(null);
  const [playlistTarget, setPlaylistTarget] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);


  const minDur = DURATION_STOPS[minDurIdx];
  const maxDur = DURATION_STOPS[maxDurIdx];
  const durationActive = minDurIdx !== DEFAULT_MIN_DUR_IDX || maxDurIdx !== DEFAULT_MAX_DUR_IDX;
  const dateActive = datePreset !== DEFAULT_DATE_PRESET;
  const typeActive = !!typeFilter;
  const genreActive = typeFilter === 'song' && !!genreFilter;
  const isFiltered = activeTags.length > 0 || dateActive || durationActive || typeActive || genreActive;

  // Build query params for filtered mode
  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '50');
    activeTags.forEach(tag => p.append('auto_tag', tag));
    if (datePreset) p.set('from', datePreset);
    p.set('min_duration', String(minDur));
    p.set('max_duration', String(maxDur));
    if (typeFilter) p.set('category', typeFilter);
    if (typeFilter === 'song' && genreFilter) p.set('genre', genreFilter);
    if (showNsfw) p.set('nsfw', 'true');
    p.set('sort', 'popular');
    return p.toString();
  }, [activeTags, datePreset, minDur, maxDur, typeFilter, genreFilter, showNsfw]);

  // ─── Data queries ──────────────────
  const groupedParams = useMemo(() => {
    const p = new URLSearchParams(); p.set('limit', '15');
    if (datePreset) p.set('from', datePreset);
    p.set('min_duration', String(minDur));
    p.set('max_duration', String(maxDur));
    if (showNsfw) p.set('nsfw', 'true');
    return p.toString();
  }, [datePreset, minDur, maxDur, showNsfw]);

  const { data: grouped, isLoading: groupedLoading } = useQuery({
    queryKey: ['audio-grouped', groupedParams, user || null],
    queryFn: async () => {
      const { data } = await axios.get(withViewer(`${CHECKER_URL}/audio/grouped?${groupedParams}`, user));
      const groups = data.groups || {};
      // Hide service-account audio frontend-side (every grouped section).
      for (const k of Object.keys(groups)) {
        if (Array.isArray(groups[k])) groups[k] = groups[k].filter((it) => !isHiddenOwner(it.owner));
      }
      return groups;
    },
    enabled: !isFiltered && !selectedCreator,
  });

  // Music playlists, split "by artist" (only the creator's tracks) vs
  // "by listeners" (contains tracks from other authors).
  const { data: playlistGroups } = useQuery({
    queryKey: ['audio-playlists', typeFilter, genreFilter, user || null],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (typeFilter) p.set('category', typeFilter);
      if (typeFilter === 'song' && genreFilter) p.set('genre', genreFilter);
      const { data } = await axios.get(withViewer(`${CHECKER_URL}/audio/playlists?${p}`, user));
      const pg = data || { by_artist: [], by_listeners: [] };
      // Hide albums/playlists owned by a service account.
      return {
        by_artist: (pg.by_artist || []).filter((a) => !isHiddenOwner(a.owner)),
        by_listeners: (pg.by_listeners || []).filter((a) => !isHiddenOwner(a.owner)),
      };
    },
    // Show albums even while filtering — the endpoint applies the same
    // category/genre filter, so a "Music" filter keeps music albums.
    enabled: !selectedCreator,
  });

  // Filtered results (when tag or date is active)
  const { data: filteredAudio, isLoading: filteredLoading } = useQuery({
    queryKey: ['audio-filtered', filterParams, user || null],
    queryFn: async () => {
      const { data } = await axios.get(withViewer(`${CHECKER_URL}/audio?${filterParams}`, user));
      return (data.audio || []).filter((it) => !isHiddenOwner(it.owner));
    },
    // Discover lists them once a filter is set; Trends always does.
    enabled: (isFiltered || exploreView === 'trends') && !selectedCreator && !external,
  });

  const creatorsParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('limit', '30');
    activeTags.forEach(tag => p.append('auto_tag', tag));
    if (datePreset) p.set('from', datePreset);
    p.set('min_duration', String(minDur));
    p.set('max_duration', String(maxDur));
    if (typeFilter) p.set('category', typeFilter);
    if (typeFilter === 'song' && genreFilter) p.set('genre', genreFilter);
    if (showNsfw) p.set('nsfw', 'true');
    return p.toString();
  }, [activeTags, datePreset, minDur, maxDur, typeFilter, genreFilter, showNsfw]);

  const { data: creators } = useQuery({
    queryKey: ['audio-creators', creatorsParams, user || null],
    queryFn: async () => {
      const { data } = await axios.get(withViewer(`${CHECKER_URL}/audio/creators?${creatorsParams}`, user));
      return (data.creators || []).filter((c) => !isHiddenOwner(c.owner));
    },
  });

  const { data: followingList } = useQuery({
    queryKey: ['hive-following', user],
    queryFn: async () => {
      if (!user) return [];
      const all = []; let start = '';
      while (true) {
        const resp = await axios.post(getHiveUrl(), { jsonrpc: '2.0', id: 1, method: 'condenser_api.get_following', params: [user, start, 'blog', 100] });
        const batch = resp.data?.result || []; if (!batch.length) break;
        all.push(...batch.map(f => f.following)); if (batch.length < 100) break;
        start = batch[batch.length - 1].following;
      }
      return all;
    },
    enabled: !!authenticated && !!user,
    staleTime: 5 * 60 * 1000,
  });

  // Sort creators: followed first, then by plays
  const sortedCreators = useMemo(() => {
    if (!creators) return [];
    const fSet = new Set(followingList || []);
    return [...creators].sort((a, b) => {
      const af = fSet.has(a.owner) ? 1 : 0;
      const bf = fSet.has(b.owner) ? 1 : 0;
      if (af !== bf) return bf - af;
      return b.totalPlays - a.totalPlays;
    });
  }, [creators, followingList]);

  const { data: creatorAudio, isLoading: creatorLoading } = useQuery({
    queryKey: ['audio-by-creator', selectedCreator],
    queryFn: async () => { const { data } = await axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(selectedCreator)}&limit=50&sort=popular`); return (data.audio || []).filter((it) => !isHiddenOwner(it.owner)); },
    enabled: !!selectedCreator,
  });

  const { data: autoTags } = useQuery({
    queryKey: ['audio-auto-tags'],
    queryFn: async () => { const { data } = await axios.get(`${CHECKER_URL}/audio/auto-tags?limit=15`); return data.tags || []; },
  });


  const tp = (item, items) => ({
    item,
    isPlaying: audioCurrent?._id === item._id && audioIsPlaying,
    isCurrent: audioCurrent?._id === item._id,
    onPlay: () => audioPlay(item, items),
    onAddToQueue: () => audioAddToQueue(item),
    onAddToPlaylist: () => setPlaylistTarget({ author: item.owner, permlink: item.post_permlink || item.permlink, title: item.title, category: item.category || '' }),
    onVote: () => { setVoteTarget({ author: item.owner, permlink: item.post_permlink }); setShowVoteTooltip(true); },
    onShare: () => setShareTarget(shareTarget?._id === item._id ? null : item),
    onAuthorClick: () => setSelectedCreator(item.owner),
    onOpen: () => openItem(item),
    loggedIn,
  });

  const renderGroupedSection = (k) => {
    const items = grouped?.[k];
    if (!items?.length) return null;
    const conf = SECTION_CONFIG[k];
    return (
      <section key={k} className="audio-section">
        <h2 className="audio-section-title">{t(conf.labelKey)}</h2>
        <AudioTileRow count={items.length}>{items.map((item, idx) => <AudioTile key={item._id || idx} {...tp(item, items)} />)}</AudioTileRow>
      </section>
    );
  };

  const clearFilters = () => {
    setActiveTags([]);
    setDatePreset(DEFAULT_DATE_PRESET);
    setMinDurIdx(DEFAULT_MIN_DUR_IDX);
    setMaxDurIdx(DEFAULT_MAX_DUR_IDX);
    setTypeFilter('');
    setGenreFilter('');
  };

  const tileGrid = (list) => (
    <div className="audio-tile-grid">{list.map((item, idx) => <AudioTile key={item._id || idx} {...tp(item, list)} />)}</div>
  );
  const noResults = (text) => <EmptyState className="audio-empty" icon="graphic_eq" title={text} />;

  return (
    <div className={cx('audio-page', playerView && 'audio-page--player')}>
      <header className="audio-page__head">
        <h1 className="audio-page__title">{t('nav.bottom.audio')}</h1>
        {mobile && (
          <Segmented
            className="audio-views"
            block={false}
            label={t('audio.page.tabsLabel')}
            value={playerView ? 'player' : 'explore'}
            onChange={(v) => showPlayerTab(v === 'player')}
            options={[
              { value: 'player', label: t('audio.page.tabPlayer') },
              { value: 'explore', label: t('audio.page.tabExplore') },
            ]}
          />
        )}
        {!playerView && (
          <Segmented
            className="audio-explore-views"
            block={false}
            label={t('audio.page.exploreViews')}
            value={exploreView}
            onChange={showExploreView}
            options={[
              { value: 'mine', label: t('audio.podcasts.views.mine') },
              { value: 'discover', label: t('audio.podcasts.views.discover') },
              { value: 'trends', label: t('audio.podcasts.views.trends') },
            ]}
          />
        )}
      </header>

      {playerView ? (
        <div className="audio-player-tab" role="tabpanel">
          {audioCurrent ? <div ref={dockRef} className="audio-player-dock" /> : (
            <EmptyState
              className="audio-empty audio-player-empty"
              icon="play_circle"
              title={t('audio.page.nothingPlaying')}
              action={<Button variant="primary" next onClick={() => showPlayerTab(false)}>{t('audio.page.goExplore')}</Button>}
            />
          )}
        </div>
      ) : (<>
      {/* Back, only when drilled into a creator */}
      {selectedCreator && (
        <Button variant="ghost" size={36} icon="arrow_back" className="audio-back-btn" onClick={() => setSelectedCreator(null)}>{t('common.actions.back')}</Button>
      )}

      {/* Type chips, genre and dates: Discover and Trends only */}
      {!selectedCreator && !onMine && (
        <div className="audio-toolbar">
          <div className="audio-type-filter v2-chips">
            <Chip
              selected={typeFilter === '' && !external}
              onClick={() => { leaveExternal(); setTypeFilter(''); setGenreFilter(''); }}
            >{t('audio.page.all')}</Chip>
            {TYPE_FILTERS.map((opt) => (
              <Chip
                key={opt.value}
                icon={opt.icon}
                selected={typeFilter === opt.value && !external}
                onClick={() => {
                  leaveExternal();
                  setTypeFilter(opt.value);
                  if (opt.value !== 'song') setGenreFilter('');
                }}
              >{t(opt.labelKey)}</Chip>
            ))}
            <Chip
              icon="rss_feed"
              tone="cyan"
              selected={external}
              onClick={() => {
                if (external) return;
                const next = new URLSearchParams(params);
                for (const k of ['play', 't', 'end']) next.delete(k);
                next.set('type', 'external');
                setParams(next);
              }}
              title={t('audio.podcasts.chipHint')}
            >{t('audio.podcasts.chip')}</Chip>
          </div>
          {typeFilter === 'song' && !external && (
            <select
              className="v2-input is-select h32 audio-genre-select"
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              aria-label={t('audio.page.musicGenre')}
            >
              <option value="">{t('audio.page.anyGenre')}</option>
              {MUSIC_GENRE_FILTERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          {!external && (
            <Segmented
              className="audio-date-presets"
              block={false}
              value={datePreset}
              onChange={(v) => setDatePreset(prev => (prev === v ? DEFAULT_DATE_PRESET : v))}
              options={DATE_PRESETS.map(p => ({ value: p.days, label: t(p.labelKey) }))}
            />
          )}
        </div>
      )}

      {/* Tags + duration */}
      {!selectedCreator && !external && !item && !onMine && (
        <div className="audio-filter-row">
          <div className="audio-topic-tags v2-chips">
            {isFiltered && (
              <Chip size={28} icon="close" className="audio-clear-chip" onClick={clearFilters}>{t('common.actions.reset')}</Chip>
            )}
            {autoTags?.map(tag => (
              <Chip key={tag.name} size={28} selected={activeTags.includes(tag.name)} onClick={() => toggleTag(tag.name)}>
                #{tag.name}
              </Chip>
            ))}
          </div>
          <DurationFilter
            minIdx={minDurIdx}
            maxIdx={maxDurIdx}
            onChange={(mi, ma) => { setMinDurIdx(mi); setMaxDurIdx(ma); }}
          />
        </div>
      )}

      {/* ─── What the chosen view shows ──────── */}
      {params.has('podcast') || params.has('episode') ? (
        <PodcastsTab view={exploreView} hideNav />
      ) : item ? (
        <AudioItemView owner={item.owner} id={item.id} onBack={closeItem} />
      ) : onMine || external ? (
        <PodcastsTab view={exploreView} hideNav />
      ) : selectedCreator ? (
        <div className="audio-creator-view">
          <div className="audio-creator-header">
            <AuthorBadge author={selectedCreator} showFollow />
            <span className="audio-creator-stat num">{t('audio.page.tracks', { count: creatorAudio?.length || 0 })}</span>
          </div>
          {creatorLoading ? (
            <div className="audio-tile-grid"><AudioTileSkeleton count={5} /></div>
          ) : creatorAudio?.length > 0 ? tileGrid(creatorAudio) : noResults(t('audio.page.noTracks'))}
        </div>
      ) : exploreView === 'trends' ? (
        /* ─── Trends: the most played for the chosen type, time and filters ─── */
        <section className="audio-section">
          <h2 className="audio-section-title">
            {t('audio.page.mostPlayed')}
            {filteredAudio && <span className="audio-section-count">{t('audio.page.tracks', { count: filteredAudio.length })}</span>}
          </h2>
          {filteredLoading ? (
            <div className="audio-tile-grid"><AudioTileSkeleton count={5} /></div>
          ) : filteredAudio?.length > 0 ? tileGrid(filteredAudio) : noResults(t('audio.page.noAudioForFilters'))}
        </section>
      ) : (
        <>
          {/* ─── Creators ────── */}
          {sortedCreators.length > 0 && (
            <section className="audio-section">
              <h2 className="audio-section-title is-cyan">{t('audio.page.creators')}</h2>
              <div className="audio-creators-row">
                {sortedCreators.slice(0, 20).map(c => (
                  <AudioAuthorBadge
                    key={c.owner}
                    author={c.owner}
                    tracks={c.tracks}
                    isFollowing={followingList?.includes(c.owner) || false}
                    onClick={() => setSelectedCreator(c.owner)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ─── Popular (above the albums) ────── */}
          {!isFiltered && renderGroupedSection('popular')}

          {/* ─── Albums & Playlists (artist-curated + listener-curated, combined) ─── */}
          {(() => {
            // Artist albums first, then listener playlists. Each tile shows its
            // own kind label so the merge stays legible.
            const artist = (playlistGroups?.by_artist || []).map(p => ({ ...p, _kind: 'artist' }));
            const listeners = (playlistGroups?.by_listeners || []).map(p => ({ ...p, _kind: 'listener' }));
            const all = [...artist, ...listeners];
            if (all.length === 0) return null;
            return (
              <section className="audio-section">
                <h2 className="audio-section-title is-cyan">
                  {t('audio.page.albumsPlaylists')}
                  <span className="audio-section-count">{all.length}</span>
                </h2>
                <AudioTileRow count={all.length}>
                  {all.map(p => <AudioPlaylistTile key={p.id} playlist={p} kind={p._kind} />)}
                </AudioTileRow>
              </section>
            );
          })()}

          {/* ─── Filtered results ────── */}
          {isFiltered ? (
            <section className="audio-section">
              <h2 className="audio-section-title">
                {[activeTags.map(tag => `#${tag}`).join(' '), datePreset ? (() => { const preset = DATE_PRESETS.find(p => p.days === datePreset); return preset ? t(preset.labelKey) : ''; })() : ''].filter(Boolean).join(' · ')}
                {filteredAudio && <span className="audio-section-count">{t('audio.page.tracks', { count: filteredAudio.length })}</span>}
              </h2>
              {filteredLoading ? (
                <div className="audio-tile-grid"><AudioTileSkeleton count={5} /></div>
              ) : filteredAudio?.length > 0 ? tileGrid(filteredAudio) : noResults(t('audio.page.noAudioForFilters'))}
            </section>
          ) : (
            /* ─── Grouped sections ──── */
            groupedLoading ? (
              SECTION_ORDER.slice(0, 3).map(k => <section key={k} className="audio-section"><div className="audio-tile-row"><AudioTileSkeleton count={5} /></div></section>)
            ) : grouped && SECTION_ORDER
              .filter(k => k !== 'popular' && grouped[k]?.length > 0) // popular is rendered above the albums
              .map(k => renderGroupedSection(k))
          )}
        </>
      )}
      </>)}

      {/* Tile-level share (the player's own share lives in <GlobalAudioPlayer />) */}
      {shareTarget && shareTarget._id !== audioCurrent?._id && (
        <div className="audio-share-overlay" onClick={() => setShareTarget(null)}>
          <div className="audio-share-popup" onClick={e => e.stopPropagation()}>
            <AudioShareDropdown item={shareTarget} onClose={() => setShareTarget(null)} title={t('common.actions.share')} />
          </div>
        </div>
      )}

      {/* Vote tooltip for tile votes */}
      {showVoteTooltip && voteTarget && (
        <CommentVoteTooltip
          author={voteTarget.author} permlink={voteTarget.permlink}
          showTooltip={showVoteTooltip} setShowTooltip={setShowVoteTooltip}
          weight={weight} setWeight={setWeight}
          voteValue={voteValue} setVoteValue={setVoteValue}
          accountData={accountData} setAccountData={setAccountData}
          compact onVoteSuccess={() => setShowVoteTooltip(false)}
        />
      )}

      {/* Tile-level playlist modal */}
      {playlistTarget && (
        <AddToPlaylistModal
          isOpen={!!playlistTarget} onClose={() => setPlaylistTarget(null)}
          author={playlistTarget.author} permlink={playlistTarget.permlink}
          videoTitle={playlistTarget.title} audioCategory={playlistTarget.category}
        />
      )}

    </div>
  );
}

// Duration (36b): a well with the range on a cyan track, the values in mono.
function DurationFilter({ minIdx, maxIdx, onChange }) {
  const { t } = useTranslation();
  const max = DURATION_STOPS.length - 1;
  const handleMin = (e) => {
    const v = Math.min(parseInt(e.target.value), maxIdx);
    onChange(v, maxIdx);
  };
  const handleMax = (e) => {
    const v = Math.max(parseInt(e.target.value), minIdx);
    onChange(minIdx, v);
  };
  const minPct = (minIdx / max) * 100;
  const maxPct = (maxIdx / max) * 100;
  return (
    <div className="audio-duration-filter">
      <Icon name="timer" size={20} className="audio-duration-icon" />
      <span className="audio-duration-label">{t('audio.page.duration.label')}</span>
      <div className="audio-duration-slider">
        <div className="audio-duration-track" />
        <div className="audio-duration-fill" style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }} />
        <input
          type="range" min={0} max={max} value={minIdx} onChange={handleMin}
          className="audio-duration-input audio-duration-input-min"
          aria-label={t('audio.page.duration.min')}
        />
        <input
          type="range" min={0} max={max} value={maxIdx} onChange={handleMax}
          className="audio-duration-input audio-duration-input-max"
          aria-label={t('audio.page.duration.max')}
        />
      </div>
      <span className="audio-duration-value num">{fmtDur(DURATION_STOPS[minIdx], t)} – {fmtDur(DURATION_STOPS[maxIdx], t)}</span>
    </div>
  );
}

export default Audio;
