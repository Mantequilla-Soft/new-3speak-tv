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
import { MdMusicNote, MdVideoLibrary, MdGroup, MdCheck, MdPerson, MdClose, MdCalendarToday, MdLabel, MdSearch, MdPlaylistPlay, MdExpandMore, MdExpandLess } from "react-icons/md";
import { RiMovieLine } from "react-icons/ri";
import { fixVideoThumbnail, fallbackImg } from "../utils/fixThumbnails";
import TimeAgo from "../components/TimeAgo/TimeAgo";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../i18n";

const LIMIT = 50;

const SEARCH_TYPES = [
  { key: 'user', labelKey: 'feeds.discover.types.user', icon: <MdPerson size={16} /> },
  { key: 'community', labelKey: 'feeds.discover.types.community', icon: <MdGroup size={16} /> },
  { key: 'video', labelKey: 'feeds.discover.types.video', icon: <MdVideoLibrary size={16} /> },
  { key: 'short', labelKey: 'feeds.discover.types.short', icon: <RiMovieLine size={16} /> },
  { key: 'audio', labelKey: 'feeds.discover.types.audio', icon: <MdMusicNote size={16} /> },
  { key: 'playlist', labelKey: 'feeds.discover.types.playlist', icon: <MdPlaylistPlay size={16} /> },
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
  } catch {}
  return null;
}

function saveState(state) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
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
        : `/watch?v=${suggestion.author}/${suggestion.permlink}`;
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

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="discover-container">
      <div className="discover-sticky-header">
        <div className="discover-search-wrapper" ref={suggestWrapRef}>
          <svg xmlns="http://www.w3.org/2000/svg" className="discover-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m16 16 4 4"></path>
          </svg>
          <input
            ref={searchInputRef}
            value={searchTerm}
            onChange={(e) => { setSearchTerm(e.target.value); setShowSuggestions(true); }}
            onFocus={() => setShowSuggestions(true)}
            type="text"
            placeholder={t('feeds.discover.searchPlaceholder')}
            className="discover-search-input"
          />
          {searchTerm && (
            <button
              type="button"
              className="discover-search-clear"
              onClick={() => { setSearchTerm(''); searchInputRef.current?.focus(); }}
              aria-label={t('feeds.discover.clearSearch')}
            >
              <MdClose size={18} />
            </button>
          )}

          {showSuggestions && debouncedTerm.length >= 2 && (
            <div className="discover-suggest-dropdown">
              <button className="discover-suggest-item discover-suggest-search-term" onMouseDown={() => setShowSuggestions(false)}>
                <MdSearch size={16} className="discover-suggest-icon" />
                <span className="discover-suggest-primary">{t('feeds.discover.searchFor', { term: debouncedTerm })}</span>
              </button>

              {groupedSuggestions.user?.length > 0 && (
                <div className="discover-suggest-group">
                  <span className="discover-suggest-group-label">{t('feeds.discover.types.user')}</span>
                  <div className="discover-suggest-badges">
                    {groupedSuggestions.user.map((s, i) => (
                      <button key={i} className="discover-suggest-badge" onMouseDown={() => selectSuggestion(s)}>
                        <div className="discover-suggest-badge-avatar">
                          {s.profile_image ? <img src={s.profile_image} alt="" onError={(e) => { e.target.style.display = 'none'; }} /> : <MdPerson size={12} />}
                        </div>
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
                      <button key={i} className="discover-suggest-badge" onMouseDown={() => selectSuggestion(s)}>
                        <MdLabel size={12} />
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
                      <button key={i} className="discover-suggest-badge" onMouseDown={() => selectSuggestion(s)}>
                        <div className="discover-suggest-badge-avatar">
                          <img src={`https://images.hive.blog/u/${s.name}/avatar/small`} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                        </div>
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
                      <button key={i} className="discover-suggest-badge" onMouseDown={() => selectSuggestion(s)}>
                        <MdPlaylistPlay size={12} />
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
                    <button key={i} className="discover-suggest-item" onMouseDown={() => selectSuggestion(s)}>
                      <MdSearch size={16} className="discover-suggest-icon" />
                      <span className="discover-suggest-primary">{s.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isSearching && (
          <div className="discover-filters">
            {SEARCH_TYPES.filter(type => !communityFilter || (type.key !== 'user' && type.key !== 'community')).map(type => (
              <label key={type.key} className={`discover-filter-chip${excludedFilters[type.key] ? ' excluded' : ''}`}>
                <input
                  type="checkbox"
                  checked={!excludedFilters[type.key]}
                  onChange={() => toggleFilter(type.key)}
                />
                {type.icon}
                <span>{t(type.labelKey)}</span>
              </label>
            ))}
            <label className={`discover-filter-chip boost${boostRecent ? ' active' : ''}`}>
              <input
                type="checkbox"
                checked={boostRecent}
                onChange={() => setBoostRecent(prev => !prev)}
              />
              <MdCheck size={14} className="discover-filter-check" />
              <span>{t('feeds.discover.boostRecent')}</span>
            </label>
            <button
              type="button"
              className={`discover-filter-chip${showAdvanced ? ' active' : ''}${hasAdvancedFilters ? ' has-filters' : ''}`}
              onClick={() => setShowAdvanced(prev => !prev)}
            >
              <MdCalendarToday size={14} />
              <span>{t('feeds.discover.filters')}{hasAdvancedFilters ? ' *' : ''}</span>
            </button>
          </div>
        )}

        {isSearching && showAdvanced && (
          <div className="discover-advanced-filters">
            <div className="discover-advanced-row">
              <label className="discover-advanced-label">
                <MdCalendarToday size={14} />
                <span>{t('feeds.discover.date')}</span>
              </label>
              <div className="discover-date-presets">
                {DATE_PRESETS.map(p => (
                  <button
                    key={p.days}
                    type="button"
                    className={`discover-date-btn${datePreset === p.days ? ' active' : ''}`}
                    onClick={() => setDatePreset(prev => prev === p.days ? null : p.days)}
                  >
                    {t(p.labelKey)}
                  </button>
                ))}
              </div>
            </div>

            <div className="discover-advanced-row">
              <label className="discover-advanced-label">
                <MdLabel size={14} />
                <span>{t('feeds.discover.tag')}</span>
              </label>
              <input
                type="text"
                className="discover-advanced-input"
                placeholder={t('feeds.discover.tagPlaceholder')}
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value.trim().toLowerCase())}
              />
              {tagFilter && (
                <button type="button" className="discover-advanced-clear" onClick={() => setTagFilter('')}>
                  <MdClose size={14} />
                </button>
              )}
            </div>

            <div className="discover-advanced-row">
              <label className="discover-advanced-label">
                <MdGroup size={14} />
                <span>{t('feeds.discover.community')}</span>
              </label>
              <div className="discover-community-search" ref={communityWrapRef}>
                {communityFilter ? (
                  <div className="discover-community-selected">
                    <div className="discover-community-selected-avatar">
                      <img src={`https://images.hive.blog/u/${communityFilter}/avatar/small`} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                    </div>
                    <span>{communityLabel || communityFilter}</span>
                    <button type="button" className="discover-advanced-clear" onClick={() => { setCommunityFilter(''); setCommunityLabel(''); setCommunitySearch(''); }}>
                      <MdClose size={14} />
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      type="text"
                      className="discover-advanced-input"
                      placeholder={t('feeds.discover.communityPlaceholder')}
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
                            <div className="discover-suggest-avatar">
                              <img src={`https://images.hive.blog/u/${c.name}/avatar/small`} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                            </div>
                            <div className="discover-suggest-text">
                              <span className="discover-suggest-primary">{c.title || c.name}</span>
                              <span className="discover-suggest-secondary">{t('feeds.discover.subscribers', { count: c.subscribers })}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {hasAdvancedFilters && (
              <button type="button" className="discover-clear-advanced" onClick={clearAdvancedFilters}>
                <MdClose size={14} />
                {t('feeds.discover.clearAllFilters')}
              </button>
            )}
          </div>
        )}
      </div>

      {isSearching && (
        <div className="discover-search-area">
          <div className="discover-results">
            {searchLoading && (
              <div className="discover-skeleton">
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
              <p className="discover-no-results">
                {t('feeds.discover.allHidden')}{' '}
                <button className="discover-reset-filters" onClick={() => setExcludedFilters(defaultExcluded)}>
                  {t('feeds.discover.reenableFilters')}
                </button>
              </p>
            )}

            {!searchLoading && !allExcluded && !hasResults && (
              <p className="discover-no-results">{t('feeds.discover.noResultsFor', { term: debouncedTerm })}</p>
            )}

            {SEARCH_TYPES.filter(type => !communityFilter || (type.key !== 'user' && type.key !== 'community')).map(type => {
              const items = grouped[type.key];
              if (!items || items.length === 0) return null;
              const isCollapsed = !!collapsedGroups[type.key];
              return (
                <div key={type.key} className="discover-result-group">
                  <h3 className="discover-group-title" onClick={() => toggleGroup(type.key)}>
                    {type.icon} {t('feeds.discover.groupTitle', { label: t(type.labelKey), count: items.length })}
                    {isCollapsed ? <MdExpandMore size={18} className="discover-group-toggle" /> : <MdExpandLess size={18} className="discover-group-toggle" />}
                  </h3>
                  {!isCollapsed && (type.key === 'community' ? (
                    <div className="discover-community-list">
                      {items.map(c => (
                        <Link to={`/community/${c.name}`} key={c.name} className="discover-community-card">
                          <div className="discover-community-avatar">
                            <img src={`https://images.hive.blog/u/${c.name}/avatar/small`} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                          </div>
                          <div className="discover-community-info">
                            <span className="discover-community-name">{c.title || c.name}</span>
                            <span className="discover-community-about">{c.about}</span>
                          </div>
                          <div className="discover-community-stats">
                            <span>{t('feeds.discover.subscribers', { count: c.subscribers })}</span>
                            <span>{t('feeds.discover.authors', { count: c.num_authors })}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : type.key === 'user' ? (
                    <div className="discover-user-list">
                      {items.map(u => (
                        <Link to={`/p/${u.username}`} key={u.username} className="discover-user-card">
                          <div className="discover-user-avatar">
                            {u.profile_image ? (
                              <img src={u.profile_image} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                            ) : (
                              <MdPerson size={24} />
                            )}
                          </div>
                          <div className="discover-user-info">
                            <span className="discover-user-name">{u.display_name || u.username}</span>
                            <span className="discover-user-handle">@{u.username}</span>
                            {u.about && <span className="discover-user-about">{u.about}</span>}
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : type.key === 'playlist' ? (
                    <div className="discover-playlist-list">
                      {items.map(p => (
                        <Link to={`/playlist/${p.id}`} key={p.id} className="discover-playlist-card">
                          <div className="discover-playlist-icon-wrap">
                            <MdPlaylistPlay size={24} />
                          </div>
                          <div className="discover-playlist-info">
                            <span className="discover-playlist-name">{p.name}</span>
                            <span className="discover-playlist-meta">@{p.owner} &middot; {t('common.units.videos', { count: p.video_count })}</span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="discover-media-list">
                      {items.map((item, i) => (
                        <Link
                          to={type.key === 'short' ? `/shorts?v=${item.author}/${item.permlink}` : `/watch?v=${item.author}/${item.permlink}`}
                          key={`${item.author}-${item.permlink}-${i}`}
                          className="discover-media-card"
                        >
                          {(item.images?.thumbnail || item.images?.poster) && (
                            <div className="discover-media-thumb">
                              <img src={fixVideoThumbnail(item)} onError={(e) => { e.target.src = fallbackImg; }} alt="" loading="lazy" />
                              {item.duration > 0 && (
                                <span className="discover-media-duration">{formatDuration(item.duration)}</span>
                              )}
                            </div>
                          )}
                          <div className="discover-media-info">
                            <span className="discover-media-title">{item.title}</span>
                            <span className="discover-media-author">@{item.author || item.owner}</span>
                            <span className="discover-media-meta">
                              {item.views > 0 && <span>{t('feeds.discover.views', { count: item.views, views: formatNumber(item.views) })}</span>}
                              {item.created_at && <TimeAgo date={item.created_at} short />}
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!isSearching && (
        <>
          {/* Standalone row: trending creators the viewer doesn't follow yet. */}
          <PopularCreators />
          {isLoading ? (
            <CardSkeleton />
          ) : (
            <Card3 videos={[...liveStreams, ...videos]} loading={isFetchingNextPage} getContentForVideo={getContentForVideo} isWatched={isWatched} getViewCount={getViewCount} />
          )}
          {isError && <p>{t('feeds.errors.fetchVideos')}</p>}
          {isFetchingNextPage && (
            <p style={{ textAlign: "center" }}>{t('feeds.loadingMore')}</p>
          )}
        </>
      )}
    </div>
    </PullToRefresh>
  );
};

export default Discover;
