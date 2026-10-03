import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { MdMusicNote, MdVideoLibrary, MdGroup, MdCheck, MdPerson, MdClose, MdCalendarToday, MdLabel, MdSearch, MdPlaylistPlay, MdExpandMore, MdExpandLess } from "react-icons/md";
import { RiMovieLine } from "react-icons/ri";
import { CHECKER_URL } from "../../utils/config";
import { useAppStore } from "../../lib/store";
import { fixVideoThumbnail, fallbackImg } from "../../utils/fixThumbnails";
import TimeAgo from "../TimeAgo/TimeAgo";
import "./NavSearch.scss";

const LIMIT = 50;

const SEARCH_TYPES = [
  { key: 'user', label: 'Users', icon: <MdPerson size={16} /> },
  { key: 'community', label: 'Communities', icon: <MdGroup size={16} /> },
  { key: 'video', label: 'Videos', icon: <MdVideoLibrary size={16} /> },
  { key: 'short', label: 'Shorts', icon: <RiMovieLine size={16} /> },
  { key: 'audio', label: 'Audio', icon: <MdMusicNote size={16} /> },
  { key: 'playlist', label: 'Playlists', icon: <MdPlaylistPlay size={16} /> },
];

const DATE_PRESETS = [
  { label: 'Today', days: 1 },
  { label: 'This week', days: 7 },
  { label: 'This month', days: 30 },
  { label: 'This year', days: 365 },
];

const defaultExcluded = SEARCH_TYPES.reduce((acc, t) => ({ ...acc, [t.key]: false }), {});

const fetchSearch = async (query, boostRecent, activeTypes, { tag, dateFrom, community } = {}, nsfw = false) => {
  const params = { q: query, limit: activeTypes.length * LIMIT };
  if (boostRecent) params.sort = 'date';
  if (activeTypes.length < SEARCH_TYPES.length) params.type = activeTypes.join(',');
  if (tag) params.tag = tag;
  if (dateFrom) params.from = dateFrom;
  if (community) params.community = community;
  if (nsfw) params.nsfw = 'true';
  const res = await axios.get(`${CHECKER_URL}/search`, { params });
  return res.data;
};

const fetchSuggest = async (query, nsfw = false) => {
  const params = { q: query };
  if (nsfw) params.nsfw = 'true';
  const res = await axios.get(`${CHECKER_URL}/search/suggest`, { params });
  return res.data;
};

const formatDuration = (seconds) => {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};

function NavSearch() {
  const showNsfw = useAppStore(s => s.showNsfw);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [excludedFilters, setExcludedFilters] = useState(defaultExcluded);
  const [boostRecent, setBoostRecent] = useState(true);
  const [tagFilter, setTagFilter] = useState('');
  const [communityFilter, setCommunityFilter] = useState('');
  const [communityLabel, setCommunityLabel] = useState('');
  const [communitySearch, setCommunitySearch] = useState('');
  const [datePreset, setDatePreset] = useState(null);
  const [showCommunityDropdown, setShowCommunityDropdown] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState({});

  const navigate = useNavigate();
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  const suggestWrapRef = useRef(null);
  const communityWrapRef = useRef(null);

  // Debounce search term (500ms for suggestions)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedTerm(searchTerm.trim()), 500);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const openPanel = useCallback(() => {
    const term = searchTerm.trim();
    if (term.length >= 2) {
      setDebouncedTerm(term);
      setPanelOpen(true);
      setShowSuggestions(false);
    }
  }, [searchTerm]);

  // "/" hotkey
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = document.activeElement?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && panelOpen) {
        setPanelOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panelOpen]);

  // Close panel on outside click
  useEffect(() => {
    const handle = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setPanelOpen(false);
        setShowSuggestions(false);
      }
      if (communityWrapRef.current && !communityWrapRef.current.contains(e.target)) {
        setShowCommunityDropdown(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const activeTypes = useMemo(
    () => SEARCH_TYPES.filter(t => !excludedFilters[t.key]).map(t => t.key),
    [excludedFilters]
  );

  const dateFrom = useMemo(() => {
    if (!datePreset) return '';
    const d = new Date();
    d.setDate(d.getDate() - datePreset);
    return d.toISOString().split('T')[0];
  }, [datePreset]);

  const extraFilters = useMemo(
    () => ({ tag: tagFilter, dateFrom, community: communityFilter }),
    [tagFilter, dateFrom, communityFilter]
  );

  // Autocomplete
  const { data: suggestData } = useQuery({
    queryKey: ["nav-suggest", debouncedTerm, showNsfw],
    queryFn: () => fetchSuggest(debouncedTerm, showNsfw),
    enabled: debouncedTerm.length >= 2 && showSuggestions,
    staleTime: 15000,
  });

  // Community search
  const { data: communityResults } = useQuery({
    queryKey: ["nav-community-suggest", communitySearch, showNsfw],
    queryFn: async () => {
      const params = { q: communitySearch, type: 'community', limit: 8 };
      if (showNsfw) params.nsfw = 'true';
      const res = await axios.get(`${CHECKER_URL}/search`, { params });
      return res.data?.results || [];
    },
    enabled: communitySearch.length >= 2 && showCommunityDropdown,
    staleTime: 15000,
  });

  // Search results
  const { data: searchData, isLoading: searchLoading } = useQuery({
    queryKey: ["nav-search", debouncedTerm, boostRecent, activeTypes, extraFilters, showNsfw],
    queryFn: () => fetchSearch(debouncedTerm, boostRecent, activeTypes, extraFilters, showNsfw),
    enabled: debouncedTerm.length >= 2 && activeTypes.length > 0 && panelOpen,
    staleTime: 30000,
  });

  const toggleFilter = useCallback((key) => {
    setExcludedFilters(prev => {
      const wasActive = !prev[key];
      const activeCount = SEARCH_TYPES.filter(t => !prev[t.key]).length;

      // If all are active (default state), solo-select this one
      if (activeCount === SEARCH_TYPES.length) {
        const next = {};
        for (const t of SEARCH_TYPES) next[t.key] = t.key !== key;
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
      setSearchTerm('');
      setDebouncedTerm('');
      inputRef.current?.blur();
      navigate(path);
      return;
    }

    if (suggestion.type === 'playlist') {
      setShowSuggestions(false);
      setSearchTerm('');
      setDebouncedTerm('');
      inputRef.current?.blur();
      navigate(`/playlist/${suggestion.id}`);
      return;
    }

    let term;
    if (suggestion.type === 'user') {
      term = suggestion.username;
    } else if (suggestion.type === 'tag') {
      term = suggestion.text;
    } else if (suggestion.type === 'community') {
      term = suggestion.title || suggestion.name;
      setCommunityFilter(suggestion.name);
      setCommunityLabel(suggestion.title || suggestion.name);
    } else {
      term = suggestion.text;
    }
    setSearchTerm(term);
    setDebouncedTerm(term);
    setShowSuggestions(false);
    if (term.length >= 2) setPanelOpen(true);
  }, [navigate]);

  const hasAdvancedFilters = tagFilter || communityFilter || datePreset;

  const clearAdvancedFilters = useCallback(() => {
    setTagFilter('');
    setCommunityFilter('');
    setCommunityLabel('');
    setCommunitySearch('');
    setDatePreset(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setShowSuggestions(false);
    inputRef.current?.blur();
  }, []);

  const groupedSuggestions = useMemo(() => {
    if (!suggestData?.suggestions) return {};
    const g = {};
    for (const s of suggestData.suggestions) {
      if (!g[s.type]) g[s.type] = [];
      g[s.type].push(s);
    }
    return g;
  }, [suggestData]);

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
    <div className={`navsearch-wrap${searchTerm ? ' has-value' : ''}`} ref={panelRef}>
      <div className="navsearch-input-wrap" ref={suggestWrapRef}>
        <svg xmlns="http://www.w3.org/2000/svg" className="navsearch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m16 16 4 4" />
        </svg>
        <input
          ref={inputRef}
          value={searchTerm}
          onChange={(e) => { setSearchTerm(e.target.value); if (!panelOpen) setShowSuggestions(true); }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') openPanel(); }}
          type="text"
          placeholder="Search..."
          className="navsearch-input"
        />
        {!searchTerm && (
          <span className="navsearch-hotkey-hint">/</span>
        )}
        {searchTerm && (
          <button type="button" className="navsearch-clear" onClick={() => { setSearchTerm(''); inputRef.current?.focus(); }}>
            <MdClose size={16} />
          </button>
        )}

        {showSuggestions && debouncedTerm.length >= 2 && !panelOpen && (
          <div className="navsearch-suggest-dropdown">
            <button className="discover-suggest-item discover-suggest-search-term" onMouseDown={(e) => { e.stopPropagation(); openPanel(); }}>
              <MdSearch size={16} className="discover-suggest-icon" />
              <span className="discover-suggest-primary">Search &ldquo;{debouncedTerm}&rdquo;</span>
            </button>

            {groupedSuggestions.user?.length > 0 && (
              <div className="discover-suggest-group">
                <span className="discover-suggest-group-label">Users</span>
                <div className="discover-suggest-badges">
                  {groupedSuggestions.user.map((s, i) => (
                    <button key={i} className="discover-suggest-badge" onMouseDown={(e) => { e.stopPropagation(); selectSuggestion(s); }}>
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
                <span className="discover-suggest-group-label">Tags</span>
                <div className="discover-suggest-badges">
                  {groupedSuggestions.tag.map((s, i) => (
                    <button key={i} className="discover-suggest-badge" onMouseDown={(e) => { e.stopPropagation(); selectSuggestion(s); }}>
                      <MdLabel size={12} />
                      <span>{s.text}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {groupedSuggestions.community?.length > 0 && (
              <div className="discover-suggest-group">
                <span className="discover-suggest-group-label">Communities</span>
                <div className="discover-suggest-badges">
                  {groupedSuggestions.community.map((s, i) => (
                    <button key={i} className="discover-suggest-badge" onMouseDown={(e) => { e.stopPropagation(); selectSuggestion(s); }}>
                      <div className="discover-suggest-badge-avatar">
                        <img src={`/img/u/${s.name}/avatar/small`} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                      </div>
                      <span>{s.title || s.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {groupedSuggestions.playlist?.length > 0 && (
              <div className="discover-suggest-group">
                <span className="discover-suggest-group-label">Playlists</span>
                <div className="discover-suggest-badges">
                  {groupedSuggestions.playlist.map((s, i) => (
                    <button key={i} className="discover-suggest-badge" onMouseDown={(e) => { e.stopPropagation(); selectSuggestion(s); }}>
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
                <span className="discover-suggest-group-label">Titles</span>
                {groupedSuggestions.title.map((s, i) => (
                  <button key={i} className="discover-suggest-item" onMouseDown={(e) => { e.stopPropagation(); selectSuggestion(s); }}>
                    <MdSearch size={16} className="discover-suggest-icon" />
                    <span className="discover-suggest-primary">{s.text}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {panelOpen && (
        <>
          <div className="navsearch-backdrop" onMouseDown={closePanel} />
          <div className="navsearch-panel">
            <div className="navsearch-panel-header">
              <div className="navsearch-panel-search">
                <MdSearch size={18} className="navsearch-panel-search-icon" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search..."
                  className="navsearch-panel-search-input"
                  autoFocus
                />
                {searchTerm && (
                  <button type="button" className="navsearch-panel-search-clear" onClick={() => setSearchTerm('')}>
                    <MdClose size={16} />
                  </button>
                )}
              </div>
              <button type="button" className="navsearch-panel-close" onClick={closePanel}><MdClose size={20} /></button>
            </div>
            <div className="navsearch-panel-body">
              {/* Left sidebar: filters */}
              <div className="navsearch-sidebar">
                <div className="navsearch-sidebar-section">
                  <h4>Content type</h4>
                  <div className="navsearch-type-filters">
                    {SEARCH_TYPES.filter(t => !communityFilter || (t.key !== 'user' && t.key !== 'community')).map(t => (
                      <label key={t.key} className={`discover-filter-chip${excludedFilters[t.key] ? ' excluded' : ''}`}>
                        <input type="checkbox" checked={!excludedFilters[t.key]} onChange={() => toggleFilter(t.key)} />
                        {t.icon}
                        <span>{t.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="navsearch-sidebar-section">
                  <label className={`discover-filter-chip boost${boostRecent ? ' active' : ''}`}>
                    <input type="checkbox" checked={boostRecent} onChange={() => setBoostRecent(prev => !prev)} />
                    <MdCheck size={14} className="discover-filter-check" />
                    <span>Boost recent</span>
                  </label>
                </div>

                <div className="navsearch-sidebar-section">
                  <h4>Date range</h4>
                  <div className="navsearch-date-presets">
                    {DATE_PRESETS.map(p => (
                      <button
                        key={p.days}
                        type="button"
                        className={`discover-date-btn${datePreset === p.days ? ' active' : ''}`}
                        onClick={() => setDatePreset(prev => prev === p.days ? null : p.days)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="navsearch-sidebar-section">
                  <h4>Tag</h4>
                  <div className="navsearch-tag-row">
                    <input
                      type="text"
                      className="discover-advanced-input"
                      placeholder="e.g. crypto, gaming..."
                      value={tagFilter}
                      onChange={(e) => setTagFilter(e.target.value.trim().toLowerCase())}
                    />
                    {tagFilter && (
                      <button type="button" className="discover-advanced-clear" onClick={() => setTagFilter('')}>
                        <MdClose size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="navsearch-sidebar-section">
                  <h4>Community</h4>
                  <div className="discover-community-search" ref={communityWrapRef}>
                    {communityFilter ? (
                      <div className="discover-community-selected">
                        <div className="discover-community-selected-avatar">
                          <img src={`/img/u/${communityFilter}/avatar/small`} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
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
                          placeholder="Search communities..."
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
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  setCommunityFilter(c.name);
                                  setCommunityLabel(c.title || c.name);
                                  setCommunitySearch('');
                                  setShowCommunityDropdown(false);
                                }}
                              >
                                <div className="discover-suggest-avatar">
                                  <img src={`/img/u/${c.name}/avatar/small`} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                                </div>
                                <div className="discover-suggest-text">
                                  <span className="discover-suggest-primary">{c.title || c.name}</span>
                                  <span className="discover-suggest-secondary">{c.subscribers} subscribers</span>
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
                    Clear all filters
                  </button>
                )}
              </div>

              {/* Right: results */}
              <div className="navsearch-results">
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
                    All content types are hidden.{' '}
                    <button className="discover-reset-filters" onClick={() => setExcludedFilters(defaultExcluded)}>
                      Re-enable all filters
                    </button>
                  </p>
                )}

                {!searchLoading && !allExcluded && !hasResults && (
                  <p className="discover-no-results">No results found for &ldquo;{debouncedTerm}&rdquo;</p>
                )}

                {SEARCH_TYPES.filter(t => !communityFilter || (t.key !== 'user' && t.key !== 'community')).map(t => {
                  const items = grouped[t.key];
                  if (!items || items.length === 0) return null;
                  const isCollapsed = !!collapsedGroups[t.key];
                  return (
                    <div key={t.key} className="discover-result-group">
                      <h3 className="discover-group-title" onClick={() => toggleGroup(t.key)}>
                        {t.icon} {t.label} ({items.length})
                        {isCollapsed ? <MdExpandMore size={18} className="discover-group-toggle" /> : <MdExpandLess size={18} className="discover-group-toggle" />}
                      </h3>
                      {!isCollapsed && (t.key === 'community' ? (
                        <div className="discover-community-list">
                          {items.map(c => (
                            <Link to={`/community/${c.name}`} key={c.name} className="discover-community-card" onClick={closePanel}>
                              <div className="discover-community-avatar">
                                <img src={`/img/u/${c.name}/avatar/small`} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
                              </div>
                              <div className="discover-community-info">
                                <span className="discover-community-name">{c.title || c.name}</span>
                                <span className="discover-community-about">{c.about}</span>
                              </div>
                              <div className="discover-community-stats">
                                <span>{c.subscribers} subscribers</span>
                                <span>{c.num_authors} authors</span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : t.key === 'user' ? (
                        <div className="discover-user-list">
                          {items.map(u => (
                            <Link to={`/p/${u.username}`} key={u.username} className="discover-user-card" onClick={closePanel}>
                              <div className="discover-user-avatar">
                                {u.profile_image ? <img src={u.profile_image} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} /> : <MdPerson size={24} />}
                              </div>
                              <div className="discover-user-info">
                                <span className="discover-user-name">{u.display_name || u.username}</span>
                                <span className="discover-user-handle">@{u.username}</span>
                                {u.about && <span className="discover-user-about">{u.about}</span>}
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : t.key === 'playlist' ? (
                        <div className="discover-playlist-list">
                          {items.map(p => (
                            <Link to={`/playlist/${p.id}`} key={p.id} className="discover-playlist-card" onClick={closePanel}>
                              <div className="discover-playlist-icon-wrap">
                                <MdPlaylistPlay size={24} />
                              </div>
                              <div className="discover-playlist-info">
                                <span className="discover-playlist-name">{p.name}</span>
                                <span className="discover-playlist-meta">@{p.owner} &middot; {p.video_count} video{p.video_count !== 1 ? 's' : ''}</span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="discover-media-list">
                          {items.map((item, i) => (
                            <Link
                              to={t.key === 'short' ? `/shorts?v=${item.author}/${item.permlink}` : `/watch?v=${item.author}/${item.permlink}`}
                              key={`${item.author}-${item.permlink}-${i}`}
                              className="discover-media-card"
                              onClick={closePanel}
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
                                  {item.views > 0 && <span>{item.views.toLocaleString()} views</span>}
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
          </div>
        </>
      )}
    </div>
  );
}

export default NavSearch;
