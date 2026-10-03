import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../lib/store';
import { CHECKER_URL, HIVE_API_URL } from '../utils/config';
import { AUDIO_CATEGORY_ICONS } from '../utils/audioCategoryIcons';
import { MdClose, MdArrowBack } from 'react-icons/md';
import AuthorBadge from '../components/AuthorBadge/AuthorBadge';
import AudioAuthorBadge from './AudioAuthorBadge';
import CommentVoteTooltip from '../components/tooltip/CommentVoteTooltip';
import AddToPlaylistModal from '../components/AddToPlaylistModal/AddToPlaylistModal';
import { AudioShareDropdown } from '../components/GlobalAudioPlayer/GlobalAudioPlayer';
import AudioTile, { AudioTileSkeleton } from '../components/AudioTile/AudioTile';
import AudioPlaylistTile from '../components/AudioPlaylistTile/AudioPlaylistTile';
import { isLoggedIn } from '../hive-api/aioha';

import './Audio.scss';

// Service/system accounts whose audio + albums are hidden from the audio page.
// Frontend-only filter applied to every audio/album query result below.
const HIDDEN_AUDIO_OWNERS = new Set(['badadib']);
const isHiddenOwner = (owner) => HIDDEN_AUDIO_OWNERS.has(owner);

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
  popular:       { labelKey: 'audio.page.sections.popular',     icon: 'fa-solid fa-fire' },
  recent:        { labelKey: 'audio.page.sections.recent',      icon: 'fa-solid fa-clock' },
  podcast:       { labelKey: 'audio.page.sections.podcasts',    icon: 'fa-solid fa-podcast' },
  song:          { labelKey: 'audio.page.sections.songs',       icon: 'fa-solid fa-music' },
  audiobook:     { labelKey: 'audio.page.sections.audiobooks',  icon: 'fa-solid fa-book-open' },
  interview:     { labelKey: 'audio.page.sections.interviews',  icon: 'fa-solid fa-comments' },
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
  { value: 'song',          labelKey: 'audio.categories.music',      icon: AUDIO_CATEGORY_ICONS.song },
  { value: 'podcast',       labelKey: 'audio.page.sections.podcasts',   icon: AUDIO_CATEGORY_ICONS.podcast },
  { value: 'voice_message', labelKey: 'audio.categories.voice',      icon: AUDIO_CATEGORY_ICONS.voice_message },
  { value: 'audiobook',     labelKey: 'audio.page.sections.audiobooks', icon: AUDIO_CATEGORY_ICONS.audiobook },
  { value: 'interview',     labelKey: 'audio.page.sections.interviews', icon: AUDIO_CATEGORY_ICONS.interview },
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
  const { showNsfw, authenticated, user, audioCurrent, audioIsPlaying, audioPlay, audioAddToQueue } = useAppStore();
  const loggedIn = authenticated && isLoggedIn();

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
    } catch {}
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

  // Deep link
  const [deepLinkHandled, setDeepLinkHandled] = useState(false);

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
    queryKey: ['audio-grouped', groupedParams],
    queryFn: async () => {
      const { data } = await axios.get(`${CHECKER_URL}/audio/grouped?${groupedParams}`);
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
    queryKey: ['audio-playlists', typeFilter, genreFilter],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (typeFilter) p.set('category', typeFilter);
      if (typeFilter === 'song' && genreFilter) p.set('genre', genreFilter);
      const { data } = await axios.get(`${CHECKER_URL}/audio/playlists?${p}`);
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
    queryKey: ['audio-filtered', filterParams],
    queryFn: async () => {
      const { data } = await axios.get(`${CHECKER_URL}/audio?${filterParams}`);
      return (data.audio || []).filter((it) => !isHiddenOwner(it.owner));
    },
    enabled: isFiltered && !selectedCreator,
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
    queryKey: ['audio-creators', creatorsParams],
    queryFn: async () => {
      const { data } = await axios.get(`${CHECKER_URL}/audio/creators?${creatorsParams}`);
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

  // Deep-link: ?play=<owner>/<permlink> → start playback in the global player
  useEffect(() => {
    if (deepLinkHandled) return;
    const p = new URLSearchParams(window.location.search).get('play');
    if (!p) return;
    const [o, pl] = p.split('/');
    if (!o || !pl) return;
    (async () => {
      try {
        const { data } = await axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(o)}&q=${encodeURIComponent(pl)}&limit=1`);
        const item = data?.audio?.find(a => a.permlink === pl);
        if (item && !isHiddenOwner(item.owner)) audioPlay(item, [item]);
      } catch {}
      setDeepLinkHandled(true);
    })();
  }, [deepLinkHandled, audioPlay]);

  const tp = (item, items) => ({
    item,
    isPlaying: audioCurrent?._id === item._id && audioIsPlaying,
    isCurrent: audioCurrent?._id === item._id,
    onPlay: () => audioPlay(item, items),
    onAddToQueue: () => audioAddToQueue(item),
    onAddToPlaylist: () => setPlaylistTarget({ author: item.owner, permlink: item.post_permlink || item.permlink, title: item.title }),
    onVote: () => { setVoteTarget({ author: item.owner, permlink: item.post_permlink }); setShowVoteTooltip(true); },
    onShare: () => setShareTarget(shareTarget?._id === item._id ? null : item),
    onAuthorClick: () => setSelectedCreator(item.owner),
    loggedIn,
  });

  const renderGroupedSection = (k) => {
    const items = grouped?.[k];
    if (!items?.length) return null;
    const conf = SECTION_CONFIG[k];
    return (
      <section key={k} className="audio-section">
        <h2 className="audio-section-title"><i className={conf.icon} /> {t(conf.labelKey)}</h2>
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

  return (
    <div className="audio-page">
      {/* Header — only show back button when drilled into creator */}
      {selectedCreator && (
        <header className="audio-header">
          <button className="audio-back-btn" onClick={() => setSelectedCreator(null)}><MdArrowBack size={20} /> {t('common.actions.back')}</button>
        </header>
      )}

      {/* Date presets + type / genre filters */}
      {!selectedCreator && (
        <div className="audio-toolbar">
          <div className="audio-type-filter">
            <button
              className={`audio-type-chip${typeFilter === '' ? ' active' : ''}`}
              onClick={() => { setTypeFilter(''); setGenreFilter(''); }}
            >{t('audio.page.all')}</button>
            {TYPE_FILTERS.map((opt) => (
              <button
                key={opt.value}
                className={`audio-type-chip${typeFilter === opt.value ? ' active' : ''}`}
                onClick={() => {
                  setTypeFilter(opt.value);
                  if (opt.value !== 'song') setGenreFilter('');
                }}
              ><i className={`audio-type-chip-icon ${opt.icon}`} /> {t(opt.labelKey)}</button>
            ))}
          </div>
          {typeFilter === 'song' && (
            <select
              className="audio-genre-select"
              value={genreFilter}
              onChange={(e) => setGenreFilter(e.target.value)}
              aria-label={t('audio.page.musicGenre')}
            >
              <option value="">{t('audio.page.anyGenre')}</option>
              {MUSIC_GENRE_FILTERS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          )}
          <div className="audio-date-presets">
            {DATE_PRESETS.map(p => (
              <button key={p.days} className={`audio-date-btn${datePreset === p.days ? ' active' : ''}`} onClick={() => setDatePreset(prev => prev === p.days ? DEFAULT_DATE_PRESET : p.days)}>
                {t(p.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tags + duration filter row */}
      {!selectedCreator && (
        <div className="audio-filter-row">
          <div className="audio-topic-tags">
            {isFiltered && (
              <button className="audio-topic-chip audio-clear-chip" onClick={clearFilters}><MdClose size={12} /> {t('common.actions.reset')}</button>
            )}
            {autoTags?.map(tag => (
              <button key={tag.name} className={`audio-topic-chip${activeTags.includes(tag.name) ? ' active' : ''}`} onClick={() => toggleTag(tag.name)}>
                {tag.name}
              </button>
            ))}
          </div>
          <DurationFilter
            minIdx={minDurIdx}
            maxIdx={maxDurIdx}
            onChange={(mi, ma) => { setMinDurIdx(mi); setMaxDurIdx(ma); }}
          />
        </div>
      )}

      {/* ─── Creator drill-down ──────── */}
      {selectedCreator ? (
        <div className="audio-creator-view">
          <div className="audio-creator-header">
            <AuthorBadge author={selectedCreator} showFollow />
            <span className="audio-creator-stat">{t('audio.page.tracks', { count: creatorAudio?.length || 0 })}</span>
          </div>
          {creatorLoading ? (
            <div className="audio-tile-row"><AudioTileSkeleton count={5} /></div>
          ) : creatorAudio?.length > 0 ? (
            <div className="audio-tile-grid">{creatorAudio.map((item, idx) => <AudioTile key={item._id || idx} {...tp(item, creatorAudio)} />)}</div>
          ) : (
            <div className="audio-empty"><p>{t('audio.page.noTracks')}</p></div>
          )}
        </div>
      ) : (
        <>
          {/* ─── Creators section ────── */}
          {sortedCreators.length > 0 && (
            <section className="audio-section">
              <h2 className="audio-section-title"><i className="fa-solid fa-users" /> {t('audio.page.creators')}</h2>
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
            // own kind label beneath the title so the merge stays legible.
            const artist = (playlistGroups?.by_artist || []).map(p => ({ ...p, _kind: 'artist' }));
            const listeners = (playlistGroups?.by_listeners || []).map(p => ({ ...p, _kind: 'listener' }));
            const all = [...artist, ...listeners];
            if (all.length === 0) return null;
            return (
              <section className="audio-section">
                <h2 className="audio-section-title">
                  <i className="fa-solid fa-compact-disc" /> {t('audio.page.albumsPlaylists')}
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
                {activeTags.length > 0 ? activeTags.map(tag => `#${tag}`).join(' ') : ''} {datePreset ? (() => { const preset = DATE_PRESETS.find(p => p.days === datePreset); return preset ? t(preset.labelKey) : undefined; })() : ''}
                {filteredAudio && <span className="audio-section-count">{t('audio.page.tracks', { count: filteredAudio.length })}</span>}
              </h2>
              {filteredLoading ? (
                <div className="audio-tile-row"><AudioTileSkeleton count={5} /></div>
              ) : filteredAudio?.length > 0 ? (
                <div className="audio-tile-grid">{filteredAudio.map((item, idx) => <AudioTile key={item._id || idx} {...tp(item, filteredAudio)} />)}</div>
              ) : (
                <div className="audio-empty"><p>{t('audio.page.noAudioForFilters')}</p></div>
              )}
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

      {/* Tile-level share overlay (the now-playing bar's share lives in <GlobalAudioPlayer />) */}
      {shareTarget && shareTarget._id !== audioCurrent?._id && (
        <div className="audio-share-overlay" onClick={() => setShareTarget(null)}>
          <div className="audio-share-popup" onClick={e => e.stopPropagation()}>
            <AudioShareDropdown item={shareTarget} onClose={() => setShareTarget(null)} />
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
          videoTitle={playlistTarget.title}
        />
      )}

    </div>
  );
}

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
      <span className="audio-duration-value">{fmtDur(DURATION_STOPS[minIdx], t)} – {fmtDur(DURATION_STOPS[maxIdx], t)}</span>
    </div>
  );
}

export default Audio;
