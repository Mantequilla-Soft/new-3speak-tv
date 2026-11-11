import "./Discover.scss";
import CardSkeleton from "../components/Cards/CardSkeleton";
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Card3 from "../components/Cards/Card3";
import PopularCreators from "../components/PopularCreators/PopularCreators";
import { useLiveStreams } from "../hooks/useLiveStreams";
import { TRENDING_SORTED_URL, CHECKER_URL, appendNsfw } from '../utils/config';
import { feedParams } from '../utils/feedParams';
import { useAppStore } from "../lib/store";
import { useContentBatch } from "../hooks/useContentBatch";
import { useWatchHistory } from "../hooks/useWatchHistory";
import useViewCounts from "../hooks/useViewCounts";
import PullToRefresh from "../components/PullToRefresh/PullToRefresh";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../components/v2/Icon";
import { Button, Chip, EmptyState, IconButton, Segmented, Toggle } from "../components/v2/ui";
import { fixVideoThumbnail, fallbackImg } from "../utils/fixThumbnails";
import TimeAgo from "../components/TimeAgo/TimeAgo";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../i18n";
import AccountImg from "../components/HiveAvatar/AccountImg";

const LIMIT = 50;

// Content types with their Material Symbols glyph (34b)
const SEARCH_TYPES = [
  { key: 'user', labelKey: 'feeds.discover.types.user', icon: 'person' },
  { key: 'community', labelKey: 'feeds.discover.types.community', icon: 'groups' },
  { key: 'video', labelKey: 'feeds.discover.types.video', icon: 'smart_display' },
  { key: 'short', labelKey: 'feeds.discover.types.short', icon: 'view_day' },
  { key: 'audio', labelKey: 'feeds.discover.types.audio', icon: 'graphic_eq' },
  { key: 'playlist', labelKey: 'feeds.discover.types.playlist', icon: 'playlist_play' },
];

const DATE_PRESETS = [
  { labelKey: 'feeds.discover.dates.today', days: 1 },
  { labelKey: 'feeds.discover.dates.week', days: 7 },
  { labelKey: 'feeds.discover.dates.month', days: 30 },
  { labelKey: 'feeds.discover.dates.year', days: 365 },
];

const fetchVideos = async ({ pageParam = 1 }) => {
  const url = appendNsfw(`${TRENDING_SORTED_URL}?page=${pageParam}&limit=${LIMIT}${feedParams()}`, useAppStore.getState().showNsfw);
  const res = await axios.get(url);
  return res.data;
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

const fetchSuggest = async (query) => {
  const params = { q: query };
  if (useAppStore.getState().showNsfw) params.nsfw = 'true';
  const res = await axios.get(`${CHECKER_URL}/search/suggest`, { params });
  return res.data;
};

const formatDuration = (seconds) => {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
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

const Discover = () => {
  const { t } = useTranslation();
  const showNsfw = useAppStore(s => s.showNsfw);
  const hideWatched = useAppStore(s => s.hideWatched);
  const feedUser = useAppStore(s => s.user);
  const saved = useRef(loadState());
  const [searchTerm, setSearchTerm] = useState(() => saved.current?.searchTerm || '');
  const [debouncedTerm, setDebouncedTerm] = useState(() => saved.current?.searchTerm?.trim() || '');
  const [excludedFilters, setExcludedFilters] = useState(() => saved.current?.filters || defaultExcluded);
  const [boostRecent, setBoostRecent] = useState(() => saved.current?.boostRecent ?? true);
  const [tagFilter, setTagFilter] = useState(() => saved.current?.tagFilter || '');
  const [communityFilter, setCommunityFilter] = useState(() => saved.current?.communityFilter || '');
  const [datePreset, setDatePreset] = useState(() => saved.current?.datePreset ?? null);
  const [communitySearch, setCommunitySearch] = useState('');
  const [communityLabel, setCommunityLabel] = useState(() => saved.current?.communityLabel || '');
  const [showCommunityDropdown, setShowCommunityDropdown] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const navigate = useNavigate();
  const searchInputRef = useRef(null);
  const suggestWrapRef = useRef(null);
  const communityWrapRef = useRef(null);
  const scrollRestored = useRef(false);
  const lastScrollY = useRef(0);
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

  // Save state on unmount
  useEffect(() => {
    return () => {
      saveState({
        searchTerm,
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

  // Trending grid query
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

  // Autocomplete suggestions
  const { data: suggestData } = useQuery({
    queryKey: ["discover-suggest", debouncedTerm],
    queryFn: () => fetchSuggest(debouncedTerm),
    enabled: debouncedTerm.length >= 2 && showSuggestions,
    staleTime: 15000,
  });

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
    if (scrollRestored.current || !saved.current?.scrollY) return;
    if (debouncedTerm.length < 2) {
      scrollRestored.current = true;
      return;
    }
    if (searchData && !searchLoading) {
      requestAnimationFrame(() => {
        window.scrollTo(0, saved.current.scrollY);
        scrollRestored.current = true;
      });
    }
  });

  // Infinite scroll for trending
  useEffect(() => {
    if (debouncedTerm) return;
    const handleScroll = () => {
      if (
        window.innerHeight + window.scrollY >= document.body.offsetHeight - 200 &&
        !isFetchingNextPage && hasNextPage
      ) {
        fetchNextPage();
      }
    };
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage, debouncedTerm]);

  const videos = data?.pages.flatMap(page => page.videos || []) || [];
  const liveStreams = useLiveStreams(); // live OpenPods streams as regular tiles
  const { getContentForVideo } = useContentBatch(videos);
  const { isWatched } = useWatchHistory(videos);
  const { getViewCount } = useViewCounts(videos);

  const handleRefresh = useCallback(async () => {
    if (debouncedTerm) {
      await queryClient.invalidateQueries({ queryKey: ["discover-search", debouncedTerm] });
    } else {
      await queryClient.invalidateQueries({ queryKey: ["trending"] });
    }
  }, [queryClient, debouncedTerm]);

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

  const toggleGroup = useCallback((key) => {
    setCollapsedGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const selectSuggestion = useCallback((suggestion) => {
    // Title suggestions: navigate directly to watch/shorts page
    if (suggestion.type === 'title' && suggestion.author && suggestion.permlink) {
      const path = suggestion.content_type === 'short'
        ? `/shorts?v=${suggestion.author}/${suggestion.permlink}`
        : `/@${suggestion.author}/${suggestion.permlink}`;
      setShowSuggestions(false);
      navigate(path);
      return;
    }

    if (suggestion.type === 'playlist') {
      setShowSuggestions(false);
      navigate(`/playlist/${suggestion.id}`);
      return;
    }

    if (suggestion.type === 'user') {
      setSearchTerm(suggestion.username);
    } else if (suggestion.type === 'tag') {
      setSearchTerm(suggestion.text);
    } else if (suggestion.type === 'community') {
      setCommunityFilter(suggestion.name);
      setCommunityLabel(suggestion.title || suggestion.name);
      if (!showAdvanced) setShowAdvanced(true);
    } else {
      setSearchTerm(suggestion.text);
    }
    setShowSuggestions(false);
  }, [showAdvanced, navigate]);

  const hasAdvancedFilters = tagFilter || communityFilter || datePreset;

  const clearAdvancedFilters = useCallback(() => {
    setTagFilter('');
    setCommunityFilter('');
    setCommunityLabel('');
    setCommunitySearch('');
    setDatePreset(null);
  }, []);

  // Group suggestions by type for compact rendering
  const groupedSuggestions = useMemo(() => {
    if (!suggestData?.suggestions) return {};
    const g = {};
    for (const s of suggestData.suggestions) {
      if (!g[s.type]) g[s.type] = [];
      g[s.type].push(s);
    }
    return g;
  }, [suggestData]);

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

  const isSearching = debouncedTerm.length >= 2;
  const allExcluded = activeTypes.length === 0;
  const hasResults = Object.keys(grouped).length > 0;

  const visibleTypes = SEARCH_TYPES.filter(type => !communityFilter || (type.key !== 'user' && type.key !== 'community'));
  // The date range as a segmented track: "All" plus the presets (34b)
  const dateOptions = [
    { value: 0, label: t('feeds.dateFilters.all') },
    ...DATE_PRESETS.map((p) => ({ value: p.days, label: t(p.labelKey) })),
  ];

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="discover-container">
      <h1 className="discover-title">{t('feeds.home.sections.discover')}</h1>

      <div className="discover-sticky-header">
        {/* The big search field (21a): accent ring while typing, clear and filters inside */}
        <div className="discover-search-wrapper" ref={suggestWrapRef}>
          <Icon name="search" size={28} className="discover-search-icon" />
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            onKeyDown={(e) => { if (e.key === 'Escape' || e.key === 'Enter') setShowSuggestions(false); }}
            type="text"
            placeholder={t('feeds.discover.searchPlaceholder')}
            className="discover-search-input"
            aria-label={t('feeds.discover.searchPlaceholder')}
          />
          {searchTerm && (
            <IconButton
              icon="close"
              size={44}
              label={t('feeds.discover.clearSearch')}
              className="discover-search-clear"
              onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
            />
          )}
          {isSearching && (
            <IconButton
              icon="tune"
              size={44}
              label={t('feeds.discover.filters')}
              className={`discover-search-tune${showAdvanced ? ' is-on' : ''}${hasAdvancedFilters ? ' has-filters' : ''}`}
              aria-pressed={showAdvanced}
              onClick={() => setShowAdvanced(prev => !prev)}
            />
          )}

          {showSuggestions && debouncedTerm.length >= 2 && (
            <div className="discover-suggest-dropdown">
              <button type="button" className="discover-suggest-item discover-suggest-search-term" onMouseDown={() => setShowSuggestions(false)}>
                <Icon name="search" size={18} className="discover-suggest-icon" />
                <span className="discover-suggest-primary">{t('feeds.discover.searchFor', { term: debouncedTerm })}</span>
              </button>

              {groupedSuggestions.user?.length > 0 && (
                <div className="discover-suggest-group">
                  <span className="discover-suggest-group-label">{t('feeds.discover.types.user')}</span>
                  <div className="discover-suggest-badges">
                    {groupedSuggestions.user.map((s, i) => (
                      <button type="button" key={i} className="discover-suggest-badge" onMouseDown={() => selectSuggestion(s)}>
                        <span className="discover-suggest-badge-avatar">
                          {s.profile_image ? <img src={s.profile_image} alt="" onError={(e) => { e.target.style.display = 'none'; }} /> : <Icon name="person" size={14} />}
                        </span>
                        <span>{s.display_name || s.username}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {groupedSuggestions.tag?.length > 0 && (
                <div className="discover-suggest-group">
                  <span className="discover-suggest-group-label">{t('feeds.discover.suggest.tags')}</span>
                  <div className="discover-suggest-badges">
                    {groupedSuggestions.tag.map((s, i) => (
                      <button type="button" key={i} className="discover-suggest-badge" onMouseDown={() => selectSuggestion(s)}>
                        <Icon name="tag" size={14} />
                        <span>{s.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {groupedSuggestions.community?.length > 0 && (
                <div className="discover-suggest-group">
                  <span className="discover-suggest-group-label">{t('feeds.discover.types.community')}</span>
                  <div className="discover-suggest-badges">
                    {groupedSuggestions.community.map((s, i) => (
                      <button type="button" key={i} className="discover-suggest-badge is-community" onMouseDown={() => selectSuggestion(s)}>
                        <span className="discover-suggest-badge-avatar">
                          <AccountImg account={s.name} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                        </span>
                        <span>{s.title || s.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {groupedSuggestions.playlist?.length > 0 && (
                <div className="discover-suggest-group">
                  <span className="discover-suggest-group-label">{t('feeds.discover.types.playlist')}</span>
                  <div className="discover-suggest-badges">
                    {groupedSuggestions.playlist.map((s, i) => (
                      <button type="button" key={i} className="discover-suggest-badge" onMouseDown={() => selectSuggestion(s)}>
                        <Icon name="playlist_play" size={14} />
                        <span>{s.name}</span>
                        <span className="discover-suggest-count">{s.video_count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {groupedSuggestions.title?.length > 0 && (
                <div className="discover-suggest-group">
                  <span className="discover-suggest-group-label">{t('feeds.discover.suggest.titles')}</span>
                  {groupedSuggestions.title.map((s, i) => (
                    <button type="button" key={i} className="discover-suggest-item" onMouseDown={() => selectSuggestion(s)}>
                      <Icon name="north_west" size={18} className="discover-suggest-icon" />
                      <span className="discover-suggest-primary">{s.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* What to show: one chip per content type (cyan = included) */}
        {isSearching && (
          <div className="discover-filters v2-chips is-scroll" role="group" aria-label={t('feeds.discover.filters')}>
            {visibleTypes.map(type => (
              <Chip
                key={type.key}
                tone="cyan"
                selected={!excludedFilters[type.key]}
                icon={type.icon}
                className={`discover-filter-chip${excludedFilters[type.key] ? ' excluded' : ''}`}
                onClick={() => toggleFilter(type.key)}
              >
                {t(type.labelKey)}
              </Chip>
            ))}
          </div>
        )}

      </div>

        {/* The filter panel (34b): date, tag, community, boost recent. Outside the sticky
            header so it scrolls away with the results instead of covering them. */}
        {isSearching && showAdvanced && (
          <div className="discover-advanced-filters">
            <div className="discover-advanced-head">
              <span className="discover-bar is-cyan" aria-hidden="true" />
              <b>{t('feeds.discover.filters')}</b>
              {hasAdvancedFilters && (
                <button type="button" className="discover-clear-advanced" onClick={clearAdvancedFilters}>
                  {t('feeds.discover.clearAllFilters')}
                </button>
              )}
            </div>

            <div className="discover-advanced-row">
              <span className="v2-eyebrow">{t('feeds.discover.date')}</span>
              <Segmented
                options={dateOptions}
                value={datePreset || 0}
                onChange={(v) => setDatePreset(v || null)}
                size={32}
                scroll
                label={t('feeds.discover.date')}
                className="discover-date-presets"
              />
            </div>

            <div className="discover-advanced-wells">
              <label className="discover-well">
                <span className="v2-eyebrow">{t('feeds.discover.tag')}</span>
                <span className="discover-well-input">
                  <input
                    type="text"
                    className="discover-advanced-input"
                    placeholder={t('feeds.discover.tagPlaceholder')}
                    value={tagFilter}
                    onChange={(e) => setTagFilter(e.target.value.trim().toLowerCase())}
                  />
                  {tagFilter && (
                    <button type="button" className="discover-advanced-clear" onClick={() => setTagFilter('')} aria-label={t('common.actions.remove')}>
                      <Icon name="close" size={16} />
                    </button>
                  )}
                </span>
              </label>

              <div className="discover-well discover-community-search" ref={communityWrapRef}>
                <span className="v2-eyebrow">{t('feeds.discover.community')}</span>
                {communityFilter ? (
                  <div className="discover-community-selected">
                    <span className="discover-community-selected-avatar">
                      <AccountImg account={communityFilter} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                    </span>
                    <span className="discover-community-selected-name">{communityLabel || communityFilter}</span>
                    <button type="button" className="discover-advanced-clear" aria-label={t('common.actions.remove')} onClick={() => { setCommunityFilter(''); setCommunityLabel(''); setCommunitySearch(''); }}>
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="discover-advanced-input"
                      placeholder={t('feeds.discover.communityPlaceholder')}
                      aria-label={t('feeds.discover.community')}
                      value={communitySearch}
                      onChange={(e) => { setCommunitySearch(e.target.value); setShowCommunityDropdown(true); }}
                      onFocus={() => setShowCommunityDropdown(true)}
                    />
                    {showCommunityDropdown && communityResults?.length > 0 && (
                      <div className="discover-community-dropdown">
                        {communityResults.map(c => (
                          <button
                            key={c.name}
                            type="button"
                            className="discover-suggest-item"
                            onMouseDown={() => {
                              setCommunityFilter(c.name);
                              setCommunityLabel(c.title || c.name);
                              setCommunitySearch('');
                              setShowCommunityDropdown(false);
                            }}
                          >
                            <span className="discover-suggest-avatar">
                              <AccountImg account={c.name} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                            </span>
                            <span className="discover-suggest-text">
                              <span className="discover-suggest-primary">{c.title || c.name}</span>
                              <span className="discover-suggest-secondary">{t('feeds.discover.subscribers', { count: c.subscribers })}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="discover-boost">
              <Icon name="trending_up" size={20} className="discover-boost-icon" />
              <span className="discover-boost-label">{t('feeds.discover.boostRecent')}</span>
              <Toggle checked={boostRecent} onChange={setBoostRecent} label={t('feeds.discover.boostRecent')} />
            </div>
          </div>
        )}

      {isSearching && (
        <div className="discover-search-area">
          <div className="discover-results">
            {searchLoading && (
              <div className="discover-skeleton" aria-busy="true">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="discover-skeleton-row">
                    <div className="discover-skeleton-thumb skeleton" />
                    <div className="discover-skeleton-info">
                      <div className="discover-skeleton-line skeleton" />
                      <div className="discover-skeleton-line short skeleton" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!searchLoading && allExcluded && (
              <div className="discover-all-hidden" role="status">
                <Icon name="visibility_off" size={18} />
                <span>{t('feeds.discover.allHidden')}</span>
                <button type="button" className="discover-reset-filters" onClick={() => setExcludedFilters(defaultExcluded)}>
                  {t('feeds.discover.reenableFilters')}
                </button>
              </div>
            )}

            {!searchLoading && !allExcluded && !hasResults && (
              <EmptyState
                icon="search_off"
                title={t('feeds.discover.noResultsFor', { term: debouncedTerm })}
                className="discover-no-results"
                action={<Button size={36} onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}>{t('feeds.discover.clearSearch')}</Button>}
              />
            )}

            {visibleTypes.map(type => {
              const items = grouped[type.key];
              if (!items || items.length === 0) return null;
              const isCollapsed = !!collapsedGroups[type.key];
              return (
                <section key={type.key} className="discover-result-group">
                  <h3 className="discover-group-title">
                    <button type="button" onClick={() => toggleGroup(type.key)} aria-expanded={!isCollapsed}>
                      <Icon name={type.icon} size={20} className="discover-group-icon" />
                      <span className="discover-group-label">{t(type.labelKey)}</span>
                      <span className="discover-group-count">{items.length}</span>
                      <Icon name={isCollapsed ? 'expand_more' : 'expand_less'} size={20} className="discover-group-toggle" />
                    </button>
                  </h3>
                  {!isCollapsed && (type.key === 'community' ? (
                    <div className="discover-community-list">
                      {items.map(c => (
                        <Link to={`/community/${c.name}`} key={c.name} className="discover-community-card">
                          <span className="discover-community-avatar">
                            <AccountImg account={c.name} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                          </span>
                          <span className="discover-community-info">
                            <span className="discover-community-name">{c.title || c.name}</span>
                            <span className="discover-community-about">{c.about}</span>
                            <span className="discover-community-stats">
                              <span>{t('feeds.discover.subscribers', { count: c.subscribers })}</span>
                              <span>{t('feeds.discover.authors', { count: c.num_authors })}</span>
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : type.key === 'user' ? (
                    <div className="discover-user-list">
                      {items.map(u => (
                        <Link to={`/@${u.username}`} key={u.username} className="discover-user-card">
                          <span className="discover-user-avatar">
                            {u.profile_image ? (
                              <img src={u.profile_image} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                            ) : (
                              <Icon name="person" size={24} />
                            )}
                          </span>
                          <span className="discover-user-info">
                            <span className="discover-user-name">{u.display_name || u.username}</span>
                            <span className="discover-user-handle">@{u.username}</span>
                            {u.about && <span className="discover-user-about">{u.about}</span>}
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : type.key === 'playlist' ? (
                    <div className="discover-playlist-list">
                      {items.map(p => (
                        <Link to={`/playlist/${p.id}`} key={p.id} className="discover-playlist-card">
                          <span className="discover-playlist-icon-wrap">
                            <Icon name="playlist_play" size={24} />
                          </span>
                          <span className="discover-playlist-info">
                            <span className="discover-playlist-name">{p.name}</span>
                            <span className="discover-playlist-meta">@{p.owner} &middot; {t('common.units.videos', { count: p.video_count })}</span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className={`discover-media-list discover-media-list--${type.key}`}>
                      {items.map((item, i) => (
                        <Link
                          to={type.key === 'short' ? `/shorts?v=${item.author}/${item.permlink}` : `/@${item.author}/${item.permlink}`}
                          key={`${item.author}-${item.permlink}-${i}`}
                          className="discover-media-card"
                        >
                          <span className="discover-media-thumb">
                            {(item.images?.thumbnail || item.images?.poster) && (
                              <img src={fixVideoThumbnail(item)} onError={(e) => { e.target.src = fallbackImg; }} alt="" loading="lazy" />
                            )}
                            {item.duration > 0 && (
                              <span className="discover-media-duration">{formatDuration(item.duration)}</span>
                            )}
                          </span>
                          <span className="discover-media-info">
                            <span className="discover-media-title">{item.title}</span>
                            <span className="discover-media-author">@{item.author || item.owner}</span>
                            <span className="discover-media-meta">
                              {item.views > 0 && <span>{t('feeds.discover.views', { count: item.views, views: formatNumber(item.views) })}</span>}
                              {item.created_at && <TimeAgo date={item.created_at} short />}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
        </div>
      )}

      {!isSearching && (
        <>
          {/* Standalone row: trending creators the viewer doesn't follow yet. */}
          <PopularCreators />
          <div className="discover-section-head">
            <span className="discover-bar" aria-hidden="true" />
            <h2>{t('common.nav.trending')}</h2>
          </div>
          {isLoading ? (
            <CardSkeleton />
          ) : (
            <Card3 windowed videos={[...liveStreams, ...videos]} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
          )}
          {isError && <p className="discover-error" role="alert">{t('feeds.errors.fetchVideos')}</p>}
          {isFetchingNextPage && (
            <p className="discover-loading-more">{t('feeds.loadingMore')}</p>
          )}
        </>
      )}
    </div>
    </PullToRefresh>
  );
};

export default Discover;
