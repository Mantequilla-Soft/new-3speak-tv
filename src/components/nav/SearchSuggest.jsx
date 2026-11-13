import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import { CHECKER_URL } from "../../utils/config";
import { useAppStore } from "../../lib/store";
import { formatNumber } from "../../i18n";
import { fixVideoThumbnail, fallbackImg } from "../../utils/fixThumbnails";
import { watchPath } from "../../utils/urls";
import AccountImg from "../HiveAvatar/AccountImg";
import { useFollowerCount, useRecentSearches } from "./searchHelpers";
import "./SearchSuggest.scss";

// The search dropdown (design 28c), shared by the top bar's field (NavSearch)
// and the big field on the search page (Discover). Left: what to search for
// (title and tag suggestions, the typed part in bold) and the viewer's recent
// searches. Right: quick results by type (creator, community, video, short),
// and "All results for …" as the way forward.

const fetchSuggest = async (query, nsfw) => {
  const params = { q: query };
  if (nsfw) params.nsfw = 'true';
  const res = await axios.get(`${CHECKER_URL}/search/suggest`, { params });
  return res.data?.suggestions || [];
};

// One video and one short for the quick results: the suggest endpoint carries
// titles but no thumbnails, so the media rows come from /search itself.
const fetchQuickMedia = async (query, nsfw) => {
  const params = { q: query, type: 'video,short', limit: 12 };
  if (nsfw) params.nsfw = 'true';
  const res = await axios.get(`${CHECKER_URL}/search`, { params });
  return res.data?.results || [];
};

const MAX_LEFT = 6;

/** The text with the first match of `term` in bold (the part that was typed). */
function Highlight({ text, term }) {
  const s = String(text || '');
  const q = String(term || '').trim();
  const at = q ? s.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (at < 0) return s;
  return (<>{s.slice(0, at)}<b>{s.slice(at, at + q.length)}</b>{s.slice(at + q.length)}</>);
}

export default function SearchSuggest({ term, onSearch, onNavigate, className = '' }) {
  const { t } = useTranslation();
  const showNsfw = useAppStore((s) => s.showNsfw);
  const [recent, removeRecent] = useRecentSearches();
  const typed = term.length >= 2;

  const { data: suggestions = [] } = useQuery({
    queryKey: ['nav-suggest', term, showNsfw],
    queryFn: () => fetchSuggest(term, showNsfw),
    enabled: typed,
    staleTime: 15000,
  });
  const { data: media = [] } = useQuery({
    queryKey: ['nav-quick-media', term, showNsfw],
    queryFn: () => fetchQuickMedia(term, showNsfw),
    enabled: typed,
    staleTime: 15000,
  });

  const of = (type) => suggestions.filter((s) => s.type === type);
  const titles = of('title');
  const tags = of('tag');
  const left = [
    ...titles.slice(0, 4).map((s) => ({ ...s, icon: 'search' })),
    ...tags.map((s) => ({ ...s, icon: 'tag' })),
  ].slice(0, MAX_LEFT);

  const creator = of('user')[0];
  const community = of('community')[0];
  const video = media.find((m) => m.type === 'video');
  const short = media.find((m) => m.type === 'short');
  const playlist = of('playlist')[0];
  const quick = [
    creator && { key: 'creator', kind: t('nav.search.kinds.creator'), tone: 'cyan', item: creator },
    community && { key: 'community', kind: t('nav.search.kinds.community'), tone: 'cyan', item: community },
    video && { key: 'video', kind: t('nav.search.kinds.video'), tone: 'accent', item: video },
    short && { key: 'short', kind: t('nav.search.kinds.short'), tone: 'accent', item: short },
  ].filter(Boolean);
  if (playlist && quick.length < 4) quick.push({ key: 'playlist', kind: t('nav.search.kinds.playlist'), tone: 'cyan', item: playlist });

  const followers = useFollowerCount(creator?.username);

  if (!typed && !recent.length) return null;

  const pickLeft = (s) => {
    // A title is a video: open it. A tag is something to search for.
    if (s.type === 'title' && s.author && s.permlink) {
      onNavigate(s.content_type === 'short' ? `/shorts?v=${s.author}/${s.permlink}` : watchPath(s.author, s.permlink));
    } else {
      onSearch(s.text);
    }
  };
  const openQuick = (q) => {
    const it = q.item;
    if (q.key === 'creator') onNavigate(`/@${it.username}`);
    else if (q.key === 'community') onNavigate(`/community/${it.name}`);
    else if (q.key === 'playlist') onNavigate(`/playlist/${it.id}`);
    else if (q.key === 'short') onNavigate(`/shorts?v=${it.author}/${it.permlink}`);
    else onNavigate(watchPath(it.author, it.permlink));
  };
  // mousedown, not click: the field loses focus on mousedown and would close
  // the dropdown before a click could land.
  const press = (fn) => ({ onMouseDown: (e) => { e.preventDefault(); fn(); } });

  const hasRight = typed;
  return (
    <div className={`search-suggest${hasRight ? ' is-two' : ''} ${className}`} role="group" aria-label={t('common.actions.search')}>
      <div className="search-suggest__col">
        {left.map((s, i) => (
          <button key={`${s.type}-${i}`} type="button" className="search-suggest__row" {...press(() => pickLeft(s))}>
            <Icon name={s.icon} size={20} className="search-suggest__icon" />
            <span className="search-suggest__text"><Highlight text={s.text} term={term} /></span>
            <Icon name="north_west" size={16} className="search-suggest__go" />
          </button>
        ))}
        {recent.length > 0 && (
          <>
            <div className="search-suggest__eyebrow">{t('nav.search.recent')}</div>
            <div className="search-suggest__recent">
              {recent.map((r) => (
                <span key={r} className="search-suggest__chip">
                  <button type="button" className="search-suggest__chip-term" {...press(() => onSearch(r))}>{r}</button>
                  <button type="button" className="search-suggest__chip-x" aria-label={t('common.actions.remove')} {...press(() => removeRecent(r))}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {hasRight && (
        <div className="search-suggest__col is-quick">
          {quick.map((q) => {
            const it = q.item;
            let media;
            let title;
            if (q.key === 'creator') {
              media = (
                <span className="search-suggest__media is-square">
                  {it.profile_image ? <img src={it.profile_image} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : null}
                  <span className="search-suggest__initial" aria-hidden="true">{String(it.username || '?').slice(0, 1).toUpperCase()}</span>
                </span>
              );
              title = followers != null
                ? `${it.display_name || it.username} · ${t('profile.creators.followers', { count: followers, num: formatNumber(followers) })}`
                : (it.display_name || it.username);
            } else if (q.key === 'community') {
              media = (
                <span className="search-suggest__media is-square is-cyan">
                  <span className="search-suggest__initial" aria-hidden="true">{String(it.title || it.name || '?').slice(0, 1).toUpperCase()}</span>
                  <AccountImg account={it.name} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </span>
              );
              title = it.title || it.name;
            } else if (q.key === 'playlist') {
              media = <span className="search-suggest__media is-square is-icon"><Icon name="playlist_play" size={20} /></span>;
              title = it.name;
            } else {
              media = (
                <span className={`search-suggest__media is-thumb${q.key === 'short' ? ' is-square' : ''}`}>
                  {(it.images?.thumbnail || it.images?.poster) && (
                    <img src={fixVideoThumbnail(it)} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
                  )}
                </span>
              );
              title = it.title;
            }
            return (
              <button key={q.key} type="button" className="search-suggest__quick" {...press(() => openQuick(q))}>
                {media}
                <span className="search-suggest__quick-text">
                  <span className={`search-suggest__kind is-${q.tone}`}>{q.kind}</span>
                  <b>{title}</b>
                </span>
              </button>
            );
          })}
          <button type="button" className="search-suggest__all" {...press(() => onSearch(term))}>
            <span>{t('nav.search.allResultsFor', { term })}</span>
            <Icon name="arrow_forward" size={18} />
          </button>
        </div>
      )}
    </div>
  );
}
