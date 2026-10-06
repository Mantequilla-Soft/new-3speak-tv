import React, { useState, useEffect, useRef } from "react";
import "./Community_modal.scss";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { Users, PenLine, ChevronDown, Loader2 } from "lucide-react";
import { CHECKER_URL } from "../../utils/config";
import { getSubscriptions } from "../../hive-api/hiveApi";
import { getHiveUrl } from "../../utils/hiveNode";
import { useAppStore } from "../../lib/store";
import { useTranslation } from "react-i18next";
import { getHiveRenderer } from '../../lib/hiveRenderer';
import AccountImg from '../HiveAvatar/AccountImg';

// Debounce hook
const useDebounce = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
};

// 8071 -> "8.1K", 1200000 -> "1.2M"
const formatCount = (n) => {
  if (n == null) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString();
};

// Rules come as one rule per line — turn each non-empty line into a markdown
// bullet (stripping any existing bullet/number marker so we don't double up).
const toBulletList = (text) =>
  String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `- ${l.replace(/^[-*•]\s*/, "").replace(/^\d+[.)]\s*/, "")}`)
    .join("\n");

function MarkdownText({ text }) {
  const [html, setHtml] = useState("");
  useEffect(() => {
    let alive = true;
    if (!text) { setHtml(""); return; }
    getHiveRenderer()
      .then((render) => { if (alive) { try { setHtml(render(text)); } catch { setHtml(""); } } })
      .catch(() => { if (alive) setHtml(""); });
    return () => { alive = false; };
  }, [text]);
  if (!html) return text ? <p className="community-card-text">{text}</p> : null;
  return <div className="community-card-text markdown-view" dangerouslySetInnerHTML={{ __html: html }} />;
}

function CommunityCard({ community, onSelect }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef(null);
  // Only load this card's full metadata once it scrolls into view, so a long
  // list (e.g. the user's subscriptions) doesn't fire a request per card up front.
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = cardRef.current;
    if (!el || inView) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { rootMargin: "200px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView]);

  // Full metadata (bio + description + rules) comes from the checker's
  // /community/:name endpoint. The bio shown on the card can't be trusted from
  // search (the shared community collection gets its `about` wiped by another
  // service) — this endpoint is the reliable source.
  const { data: detail, isFetching } = useQuery({
    queryKey: ["community-detail", community.name],
    enabled: inView && !!community.name,
    queryFn: async () => {
      const res = await axios.get(`${CHECKER_URL}/community/${encodeURIComponent(community.name)}`);
      return res.data?.community || null;
    },
    staleTime: 5 * 60_000,
  });

  const subs = community.subscribers ?? detail?.subscribers;
  const authors = community.num_authors ?? detail?.num_authors;
  const bio = community.about || detail?.about;

  return (
    <div ref={cardRef} className={`community-card${expanded ? " expanded" : ""}`}>
      <div className="community-card-main" onClick={() => onSelect(community)}>
        <AccountImg
          className="community-card-avatar"
          account={community.name}
          alt=""
          loading="lazy"
          onError={(e) => { e.currentTarget.style.visibility = "hidden"; }}
        />
        <div className="community-card-info">
          <span className="community-card-title">{community.title || community.name}</span>
          <span className="community-card-stats">
            {subs != null && (
              <span className="community-card-stat"><Users size={13} /> {formatCount(subs)}</span>
            )}
            {authors != null && (
              <span className="community-card-stat"><PenLine size={13} /> {formatCount(authors)}</span>
            )}
          </span>
          {bio && <span className="community-card-bio">{bio}</span>}
        </div>
        <button
          type="button"
          className="community-card-toggle"
          aria-label={expanded ? t('communities.picker.hideDetails') : t('communities.picker.showDetails')}
          aria-expanded={expanded}
          onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        >
          <ChevronDown size={18} className={expanded ? "rot" : ""} />
        </button>
      </div>

      {expanded && (
        <div className="community-card-detail">
          {isFetching && (
            <div className="community-card-loading"><Loader2 size={15} className="spin" /> {t('common.status.loading')}</div>
          )}
          {detail?.description && (
            <div className="community-card-section">
              <h4>{t('communities.picker.about')}</h4>
              <MarkdownText text={detail.description} />
            </div>
          )}
          {detail?.rules && (
            <div className="community-card-section">
              <h4>{t('communities.picker.rules')}</h4>
              <MarkdownText text={toBulletList(detail.rules)} />
            </div>
          )}
          {!isFetching && !detail?.description && !detail?.rules && (
            <div className="community-card-loading">{t('communities.picker.noExtraInfo')}</div>
          )}
          <button type="button" className="community-card-select" onClick={() => onSelect(community)}>
            {t('communities.picker.selectThis')}
          </button>
        </div>
      )}
    </div>
  );
}

function CommunitieModal({ isOpen, data, close, setCommunity, selected }) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");

  const debouncedQuery = useDebounce(searchQuery, 400);

  // Search communities via checker suggest endpoint
  const {
    data: searchResults = [],
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["checker-community-suggest", debouncedQuery],
    enabled: isOpen && debouncedQuery.trim().length >= 2,
    queryFn: async () => {
      const res = await axios.get(`${CHECKER_URL}/search/suggest`, {
        params: { q: debouncedQuery.trim() },
      });
      return (res.data?.suggestions || [])
        .filter(s => s.type === 'community')
        .map(s => ({ name: s.name, title: s.title, about: s.about || '', subscribers: s.subscribers || 0, num_authors: s.num_authors || 0 }));
    },
    staleTime: 60_000,
  });

  // The current user's subscribed communities, shown in the default (no-search)
  // list alongside the 3Speak / selected community.
  //
  // The store's `user` is briefly null on a fresh load until initializeAuth()
  // runs, and it stays null for the whole render pass on the cookie-based
  // (ButrAuth/ManteAuth) path if the picker is opened first. `user_id` is the
  // same username written by every login and removed by LogOut and by the
  // expired-session branch of initializeAuth, so falling back to it never
  // resurrects a logged-out account — it only closes that gap.
  const storeUser = useAppStore((s) => s.user);
  let user = storeUser;
  if (!user) {
    try { user = localStorage.getItem("user_id") || null; } catch { user = null; }
  }

  const {
    data: subscriptions = [],
    isPending: subsPending,
    isError: subsError,
  } = useQuery({
    queryKey: ["community-subscriptions", user],
    enabled: isOpen && !!user,
    queryFn: async () => {
      // bridge.list_all_subscriptions → [[name, title, role, role_title], ...]
      const res = await getSubscriptions(user);
      return (res || []).map((s) => ({ name: s[0], title: s[1] || s[0] }));
    },
    staleTime: 5 * 60_000,
  });

  // Fallback list for an account that is subscribed to nothing. Callers that
  // already hold a community list pass it in as `data` (the embed studio's
  // details route does not — that page never runs the studio's own fetch), so
  // only ask Hive when we have neither subscriptions nor a passed-in list.
  const hasPassedList = (data || []).length > 0;
  const noSubs = !subsPending && subscriptions.length === 0;
  const { data: popularFetched = [] } = useQuery({
    queryKey: ["community-popular"],
    enabled: isOpen && noSubs && !hasPassedList,
    queryFn: async () => {
      const res = await axios.post(getHiveUrl(), {
        jsonrpc: "2.0",
        method: "bridge.list_communities",
        params: { last: "", limit: 20 },
        id: 1,
      });
      return res.data?.result || [];
    },
    staleTime: 30 * 60_000,
  });

  // Lock the page behind the modal so touch-scrolling moves the modal (the
  // mobile bottom sheet), not the page underneath it.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Default (no search) shows a single card: the already-selected community if
  // there is one, otherwise the 3Speak community. The rest appear on search.
  const DEFAULT_COMMUNITY = "hive-181335";
  const searching = debouncedQuery.trim().length >= 2;

  let selectedCommunity = null;
  if (selected) {
    if (typeof selected === "string") {
      selectedCommunity =
        (data || []).find((c) => c.name === selected) ||
        { name: selected, title: selected === DEFAULT_COMMUNITY ? "3Speak" : selected };
    } else if (selected.name) {
      selectedCommunity = selected;
    }
  }

  const defaultCommunity =
    selectedCommunity ||
    (data || []).find((c) => c.name === DEFAULT_COMMUNITY) ||
    { name: DEFAULT_COMMUNITY, title: "3Speak" };

  // Enrich subscriptions with subscriber counts from the loaded community list
  // (bridge.list_communities) and sort them biggest-first.
  const dataByName = new Map((data || []).map((c) => [c.name, c]));
  const sortedSubs = subscriptions
    .map((s) => {
      const d = dataByName.get(s.name);
      return d ? { ...s, subscribers: d.subscribers, num_authors: d.num_authors, about: d.about } : s;
    })
    .sort((a, b) => (b.subscribers || 0) - (a.subscribers || 0));

  // Default list: the selected/3Speak community pinned first, then the user's
  // subscribed communities (sorted by size), deduped against the pinned one.
  const seenNames = new Set([defaultCommunity?.name]);
  const mySubs = sortedSubs.filter(
    (c) => c && c.name && !seenNames.has(c.name) && seenNames.add(c.name)
  );

  // A brand-new account is subscribed to nothing, which would leave the picker
  // as a single 3Speak card and a search box. Fall back to the biggest
  // communities (the caller's list when it has one, otherwise the small
  // bridge.list_communities fetch above) so there is always something to pick
  // without typing.
  const POPULAR_LIMIT = 12;
  const popular = (hasPassedList ? data : popularFetched)
    .filter((c) => c && c.name && !seenNames.has(c.name))
    .slice(0, POPULAR_LIMIT);
  const showPopular = noSubs && popular.length > 0;

  if (!isOpen) return null;

  const onSelect = (community) => {
    setCommunity(community);
    close();
  };

  return (
    <div className={`modal ${isOpen ? "open" : ""}`}>
      <div className="overlay" onClick={close}></div>

      <div className={`modal-content community-modal ${isOpen ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('communities.picker.title')}</h2>
          <button type="button" className="close-btn" onClick={close}>×</button>
        </div>

        <div className="modal-body">

          {/* SEARCH INPUT */}
          <div className="search-container">
            <input
              type="text"
              placeholder={t('communities.picker.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          {/* LOADING */}
          {(isLoading || isFetching) && debouncedQuery.trim().length >= 2 && (
            <div className="loading-message">{t('communities.picker.searching')}</div>
          )}

          {/* LIST */}
          <div className="community-list-wrap">
            {searching ? (
              searchResults.length > 0 ? (
                searchResults.map((community, index) => (
                  <CommunityCard
                    key={community.name || index}
                    community={community}
                    onSelect={onSelect}
                  />
                ))
              ) : (
                !isLoading && <p>{t('communities.picker.noneFound')}</p>
              )
            ) : (
              <>
                {/* Pinned: whatever is already selected, else 3Speak. */}
                <CommunityCard
                  key={defaultCommunity.name}
                  community={defaultCommunity}
                  onSelect={onSelect}
                />

                {/* The user's own subscriptions, listed up front so posting to
                    one never requires guessing its name in the search box. */}
                {user && (subsPending || mySubs.length > 0) && (
                  <span className="community-group-label">{t('communities.picker.yours')}</span>
                )}
                {user && subsPending && (
                  <div className="community-card-loading">
                    <Loader2 size={15} className="spin" /> {t('communities.picker.loadingYours')}
                  </div>
                )}
                {mySubs.map((community, index) => (
                  <CommunityCard
                    key={community.name || index}
                    community={community}
                    onSelect={onSelect}
                  />
                ))}
                {user && !subsPending && subsError && (
                  <div className="community-card-loading">
                    {t('communities.picker.loadYoursFailed')}
                  </div>
                )}

                {showPopular && (
                  <>
                    <span className="community-group-label">{t('communities.picker.popular')}</span>
                    {popular.map((community, index) => (
                      <CommunityCard
                        key={community.name || index}
                        community={community}
                        onSelect={onSelect}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>

          {!searching && (
            <p className="community-search-hint">{t('communities.picker.searchHint')}</p>
          )}

        </div>
      </div>
    </div>
  );
}

export default CommunitieModal;
