import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MdPlayArrow, MdPause, MdAdd, MdRssFeed, MdNotificationsActive, MdNotificationsOff, MdArrowBack, MdOpenInNew,
  MdUploadFile, MdDownload, MdSearch, MdClose, MdCheck, MdPodcasts, MdTrendingUp, MdHistory, MdWhatshot, MdLink, MdExplore, MdLibraryMusic,
  MdLeaderboard, MdLock, MdLockOpen, MdQueueMusic, MdFiberNew,
} from 'react-icons/md';
import { BiDollar } from 'react-icons/bi';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import {
  usePodcastConfig, usePodcastSubscriptions, usePodcastLatest, usePodcastFeed, usePodcastDiscover, useInvalidatePodcasts,
  followFeeds, unfollowFeed, setFeedNotify, followErrorText, fetchOlderEpisodes, searchPodcasts, searchPeople,
  usePodcastTrending, usePodcastCharts, TRENDING_CATEGORIES, CHART_COUNTRIES, feedKey,
  episodeToTrack, parseOpml, downloadOpml, buildPrivateFeedUrl,
} from '../../lib/podcasts';
import PodcastTipModal from './PodcastTipModal';
import PodcastArt from './PodcastArt';
import EpisodeView from './EpisodeView';
import { fmtDuration, useDateFormat } from '../../lib/podcastFormat';
import { getLanguage } from '../../i18n';
import { LANGUAGES as UI_LANGUAGES } from '../../i18n/languages';
import { canTipEpisode } from '../../lib/podcastTips';
import { usePodcastProgress, progressOf } from '../../lib/podcastProgress';
import { isDownloaded, useDownloads } from '../../lib/podcastDownloads';
import {
  matchesListenFilter, isInboxEpisode, readMineVisit, markMineVisit, seasonsOf, trailerOf,
  readAutoQueue, setAutoQueue, markAutoQueued, pickAutoQueue, isLiveNow,
} from '../../lib/podcastLibrary';
import { EpisodeBadges, DownloadButton, PersonsRow, LiveBanner, PrivateBadge } from './PodcastBits';
import DownloadsSection from './DownloadsSection';
import './PodcastsTab.scss';

// ─── Filters: date range and listening state ──────────────────────────────────

const DAY_MS = 24 * 3600 * 1000;
const DATE_FILTERS = [
  { days: 0, labelKey: 'audio.podcasts.filters.allTime' },
  { days: 7, labelKey: 'audio.page.dates.thisWeek' },
  { days: 30, labelKey: 'audio.page.dates.thisMonth' },
  { days: 365, labelKey: 'audio.page.dates.thisYear' },
  { days: 'custom', labelKey: 'audio.podcasts.filters.custom' },
];
// Smart filters (lib/podcastLibrary.js). "New" is the inbox on Mine only.
const LISTEN_FILTERS = [
  { key: 'new', labelKey: 'audio.podcasts.filters.inbox', mineOnly: true },
  { key: 'all', labelKey: 'audio.podcasts.filters.all' },
  { key: 'unplayed', labelKey: 'audio.podcasts.filters.unplayed' },
  { key: 'inProgress', labelKey: 'audio.podcasts.filters.inProgress' },
  { key: 'downloaded', labelKey: 'audio.podcasts.filters.downloaded' },
];

/** The cut-off date for a date filter, stable within a day so queries can cache. */
const sinceFor = (days) => (days ? new Date(Math.floor((Date.now() - days * DAY_MS) / DAY_MS) * DAY_MS).toISOString() : '');

/**
 * { since, until } (ISO, '' = open) for a preset or the custom range. The custom
 * dates are the listener's local days: from the start of "from" to the end of "to".
 */
function rangeFor(days, range) {
  if (days !== 'custom') return { since: sinceFor(days), until: '' };
  const day = (v, end) => (/^\d{4}-\d{2}-\d{2}$/.test(v || '') ? new Date(`${v}T${end ? '23:59:59.999' : '00:00:00'}`).toISOString() : '');
  return { since: day(range.from, false), until: day(range.to, true) };
}

function inRange(ep, { since, until }) {
  const at = ep.published_at ? new Date(ep.published_at).getTime() : 0;
  return (!since || at >= new Date(since).getTime()) && (!until || at <= new Date(until).getTime());
}

const matchesListen = (ep, listen, lastVisit = 0) => matchesListenFilter(ep, listen, { progressOf, isDownloaded, lastVisit });

/**
 * Listening state on the left, date range on the right, the 3Speak audio filter
 * look. `inbox` (Mine) adds "New" with how many there are.
 */
function EpisodeFilters({ days, onDays, listen, onListen, range, onRange, inbox = null }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="pod-filters">
      <div className="audio-type-filter pod-filter-listen" role="group" aria-label={t('audio.podcasts.filters.listenLabel')}>
        {LISTEN_FILTERS.filter((f) => inbox != null || !f.mineOnly).map((f) => (
          <button key={f.key} type="button" className={`audio-type-chip${listen === f.key ? ' active' : ''}`} aria-pressed={listen === f.key} onClick={() => onListen(f.key)}>
            {t(f.labelKey)}
            {f.key === 'new' && inbox > 0 && <span className="pod-chip-count">{inbox}</span>}
          </button>
        ))}
      </div>
      <div className="audio-date-presets pod-filter-dates" role="group" aria-label={t('audio.podcasts.filters.dateLabel')}>
        {DATE_FILTERS.map((f) => (
          <button key={f.days} type="button" className={`audio-date-btn${days === f.days ? ' active' : ''}`} onClick={() => onDays(f.days)}>
            {t(f.labelKey)}
          </button>
        ))}
      </div>
      {days === 'custom' && (
        <div className="pod-filter-range">
          <label>
            <span>{t('audio.podcasts.filters.from')}</span>
            <input type="date" value={range.from} max={range.to || today} onChange={(e) => onRange({ ...range, from: e.target.value })} />
          </label>
          <label>
            <span>{t('audio.podcasts.filters.to')}</span>
            <input type="date" value={range.to} min={range.from || undefined} max={today} onChange={(e) => onRange({ ...range, to: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

// ─── One episode ──────────────────────────────────────────────────────────────

function EpisodeTile({ ep, feed, showShow = true, onOpenShow, onOpenEpisode }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const [tipping, setTipping] = useState(false);
  const track = useMemo(() => episodeToTrack(ep, feed), [ep, feed]);
  const isCurrent = audioCurrent?._id === ep.id;
  const playing = isCurrent && audioIsPlaying;
  const progress = progressOf(ep.id);
  const started = progress && (progress.done || progress.pct > 0);

  const play = () => {
    if (isCurrent) { audioRequestToggle(); return; }
    audioPlayQueued(track);
  };

  return (
    <li className={`pod-tile${isCurrent ? ' pod-tile--current' : ''}${progress?.done ? ' pod-tile--done' : ''}`}>
      <div className="pod-tile-top">
        <button type="button" className="pod-tile-cover" onClick={play} aria-label={playing ? t('audio.podcasts.pause') : t('audio.podcasts.play')}>
          <PodcastArt art={ep.art || feed?.art} px={128} />
          <span className={`pod-tile-play${playing ? ' pod-tile-play--on' : ''}`}>{playing ? <MdPause size={24} /> : <MdPlayArrow size={24} />}</span>
        </button>
        <div className="pod-tile-head">
          {showShow && feed && (
            <button type="button" className="pod-tile-show" onClick={() => onOpenShow?.(ep.feed_id)}>{feed.title}</button>
          )}
          <button type="button" className="pod-tile-title" title={ep.title} onClick={() => onOpenEpisode?.(ep.id)}>{ep.title || t('audio.untitled')}</button>
          <div className="pod-tile-meta">
            <EpisodeBadges ep={ep} />
            {ep.published_at && <span>{fmtDate(ep.published_at)}</span>}
            {ep.duration > 0 && <span className="pod-tile-dur">{fmtDuration(ep.duration)}</span>}
            {progress?.done && <span className="pod-tile-listened"><MdCheck size={13} /> {t('audio.podcasts.listened')}</span>}
            {started && !progress.done && <span className="pod-tile-pct">{t('audio.podcasts.listenedPct', { pct: progress.pct })}</span>}
          </div>
        </div>
      </div>
      {/* Cropped here; the whole show notes are on the episode page. */}
      {ep.summary && (
        <button type="button" className="pod-tile-summary" onClick={() => onOpenEpisode?.(ep.id)} title={t('audio.podcasts.openEpisode')}>{ep.summary}</button>
      )}
      <div className="pod-tile-actions">
        <DownloadButton track={track} />
        {canTipEpisode(track) && (
          <button type="button" className="pod-icon-btn pod-icon-btn--tip" onClick={() => setTipping(true)} title={t('audio.podcasts.tip.button')} aria-label={t('audio.podcasts.tip.button')}>
            <BiDollar size={18} />
          </button>
        )}
        {ep.link && (
          <a className="pod-icon-btn" href={ep.link} target="_blank" rel="noopener noreferrer nofollow" title={t('audio.podcasts.episodePage')} aria-label={t('audio.podcasts.episodePage')}>
            <MdOpenInNew size={16} />
          </a>
        )}
      </div>
      {started && (
        <div
          className="pod-tile-bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.pct}
          aria-label={t('audio.podcasts.listenedPct', { pct: progress.pct })}
        >
          <span style={{ width: `${progress.pct}%` }} />
        </div>
      )}
      {tipping && <PodcastTipModal track={track} onClose={() => setTipping(false)} />}
    </li>
  );
}

// ─── Show cards ───────────────────────────────────────────────────────────────

/** A show as a cover card; `rank` adds the big number of the top-10 row. */
function ShowCard({ feed, onOpen, rank, note, fallbackArt }) {
  const { t } = useTranslation();
  return (
    <button type="button" className={`pod-card${feed.status === 'error' ? ' pod-card--error' : ''}`} onClick={() => onOpen(feed.id)} title={feed.title || feed.url || undefined}>
      <span className="pod-card-art">
        <PodcastArt art={feed.art} fallback={fallbackArt} px={256} />
        {rank && <span className="pod-card-rank">{rank}</span>}
        {isLiveNow(feed) && <span className="pod-card-live">{t('audio.podcasts.live.badge')}</span>}
        {feed.private && <span className="pod-card-lock"><PrivateBadge /></span>}
      </span>
      <span className="pod-card-title">{feed.title || feed.url || t('audio.podcasts.private.badge')}</span>
      <span className="pod-card-meta">
        {note || (feed.subscribers ? t('audio.podcasts.followers', { count: feed.subscribers }) : feed.author)}
      </span>
    </button>
  );
}

function ShowRail({ icon, title, feeds, onOpen, ranked = false, noteFor, artFor }) {
  if (!feeds?.length) return null;
  return (
    <section className="pod-section">
      <h2 className="pod-section-title">{icon}{title}</h2>
      <div className="pod-rail">
        {feeds.map((f, i) => <ShowCard key={f.id} feed={f} onOpen={onOpen} rank={ranked ? i + 1 : null} note={noteFor?.(f)} fallbackArt={artFor?.(f)} />)}
      </div>
    </section>
  );
}

// ─── Following from a list (search, trending) ─────────────────────────────────

/** Follow one feed URL or a whole OPML list, with the toasts that go with it. */
function useFollowFeeds(user, onFollowed) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const follow = async (urls, titles, priv) => {
    if (!user) { toastIn('Podcasts').error(t('audio.podcasts.errors.signIn')); return false; }
    setBusy(true);
    try {
      const res = await followFeeds(user, urls, titles, priv);
      const ok = res.filter((r) => r.ok);
      const failed = res.filter((r) => !r.ok);
      if (urls.length === 1) {
        if (ok.length) {
          toastIn('Podcasts').success(ok[0].already ? t('audio.podcasts.alreadyFollowing') : t('audio.podcasts.followed'));
          onFollowed?.(ok[0].feed_id);
        } else {
          toastIn('Podcasts').error(followErrorText(failed[0]?.code, failed[0]));
        }
      } else {
        toastIn('Podcasts').success(t('audio.podcasts.opml.imported', { count: ok.length, failed: failed.length }));
        onFollowed?.(null);
      }
      return ok.length > 0;
    } catch (err) {
      toastIn('Podcasts').error(err.message || followErrorText());
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, follow };
}

/**
 * Shows from Podcast Index (search, a person search, trending): not on 3Speak
 * yet, so the action is Follow. A person search adds how many of their episodes
 * the show has, and the newest one.
 */
function PiResults({ list, followed, busy, onFollow }) {
  const { t } = useTranslation();
  return (
    <div className="pod-results">
      {list.map((r) => (
        <div key={r.url} className="pod-result">
          <span className="pod-result-cover">
            <PodcastArt art={r.art} px={256} className="pod-result-art" />
            {r.rank > 0 && <span className="pod-result-rank">{r.rank}</span>}
          </span>
          <div className="pod-result-body">
            <div className="pod-result-title" title={r.title}>{r.title}</div>
            <div className="pod-result-meta">{r.author}</div>
            {r.matches > 0 ? (
              <>
                <div className="pod-result-meta pod-result-meta--accent">{t('audio.podcasts.search.appearsIn', { count: r.matches })}</div>
                {r.sample && <div className="pod-result-meta" title={r.sample}>{t('audio.podcasts.search.latestMatch', { title: r.sample })}</div>}
              </>
            ) : r.episodes > 0 && <div className="pod-result-meta">{t('audio.podcasts.episodes', { count: r.episodes })}</div>}
          </div>
          {followed.has(feedKey(r.url))
            ? <span className="pod-following"><MdCheck size={15} /> {t('audio.podcasts.following')}</span>
            : <button type="button" className="pod-btn pod-btn--primary pod-result-follow" disabled={busy} onClick={() => onFollow([r.url])}><MdAdd size={16} /> {t('audio.podcasts.follow')}</button>}
        </div>
      ))}
    </div>
  );
}

/** The followed shows' feeds, compared the way the checker compares them. */
function useFollowedKeys(subscriptions) {
  // A private feed comes without its link (url '', keys []): it never matches a search result.
  return useMemo(() => new Set((subscriptions || []).flatMap((s) => (s.url ? [feedKey(s.url), ...(s.keys || [])] : []))), [subscriptions]);
}

// ─── Discover: Apple's charts and Podcast Index's trending ────────────────────

const DISCOVER_KEY = 'pod-discover';
const DISCOVER_SHOWN = 9;

// A language's usual Apple storefront, when the browser names no country.
const LANG_COUNTRY = {
  en: 'us', es: 'es', pt: 'br', de: 'de', fr: 'fr', it: 'it', pl: 'pl', ru: 'us', tr: 'tr', id: 'id', ko: 'kr',
  ja: 'jp', zh: 'tw', hi: 'in', bn: 'in', vi: 'vn', fil: 'ph', th: 'th', sw: 'ke', uk: 'ua', nl: 'nl',
};

/**
 * What Discover starts with: the listener's last choice, else their country (from
 * the browser's language list, e.g. de-AT) and the page's language.
 */
function discoverPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(DISCOVER_KEY) || 'null');
    if (saved && typeof saved.country === 'string') return { tab: 'charts', lang: '', cat: '', ...saved };
  } catch { /* storage off */ }
  const ui = String(getLanguage() || '').split('-')[0];
  const region = (typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [])
    .map((l) => String(l || '').split('-')[1]?.toLowerCase())
    .find((c) => c && CHART_COUNTRIES.includes(c));
  return {
    tab: 'charts',
    country: region || LANG_COUNTRY[ui] || 'us',
    lang: UI_LANGUAGES.some((l) => l.code === ui) ? ui : '',
    cat: '',
  };
}

function DiscoverSection({ user, subscriptions, onFollowed, config }) {
  const { t } = useTranslation();
  const hasTrending = !!config?.trending;
  const countries = config?.chart_countries?.length ? config.chart_countries : CHART_COUNTRIES;
  const [pick, setPick] = useState(discoverPrefs);
  const [all, setAll] = useState(false);
  const tab = pick.tab === 'trending' && hasTrending ? 'trending' : 'charts';
  const charts = usePodcastCharts(pick.country, pick.cat, tab === 'charts');
  const trending = usePodcastTrending(pick.lang, pick.cat, tab === 'trending');
  const { data: list = [], isLoading, isError } = tab === 'charts' ? charts : trending;
  const { busy, follow } = useFollowFeeds(user, onFollowed);
  const followed = useFollowedKeys(subscriptions);
  // Country and language names in the page's own language.
  let regionNames = null;
  let languageNames = null;
  try {
    regionNames = new Intl.DisplayNames([getLanguage()], { type: 'region' });
    languageNames = new Intl.DisplayNames([getLanguage()], { type: 'language' });
  } catch { /* old browser */ }
  const countryName = (c) => regionNames?.of(c.toUpperCase()) || c.toUpperCase();
  const langName = (code) => languageNames?.of(code) || UI_LANGUAGES.find((l) => l.code === code)?.native || code;
  const sortedCountries = [...countries].sort((a, b) => countryName(a).localeCompare(countryName(b)));

  const choose = (next) => {
    const value = { ...pick, ...next };
    setPick(value);
    setAll(false);
    try { localStorage.setItem(DISCOVER_KEY, JSON.stringify(value)); } catch { /* storage off */ }
  };

  const tabs = [
    { key: 'charts', icon: <MdLeaderboard size={17} />, label: t('audio.podcasts.charts.title') },
    ...(hasTrending ? [{ key: 'trending', icon: <MdWhatshot size={17} />, label: t('audio.podcasts.trending.title') }] : []),
  ];
  const shown = all ? list : list.slice(0, DISCOVER_SHOWN);
  return (
    <section className="pod-section pod-discover">
      <div className="pod-section-head pod-section-head--filters">
        <div className="pod-discover-tabs" role="tablist">
          {tabs.map((x) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={tab === x.key}
              className={`pod-discover-tab${tab === x.key ? ' active' : ''}`}
              onClick={() => choose({ tab: x.key })}
            >
              {x.icon}{x.label}
            </button>
          ))}
        </div>
        <div className="pod-trending-filters">
          {tab === 'charts' ? (
            <select className="pod-select" value={pick.country} onChange={(e) => choose({ country: e.target.value })} aria-label={t('audio.podcasts.charts.country')}>
              {sortedCountries.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
            </select>
          ) : (
            <select className="pod-select" value={pick.lang} onChange={(e) => choose({ lang: e.target.value })} aria-label={t('audio.podcasts.trending.language')}>
              <option value="">{t('audio.podcasts.trending.allLanguages')}</option>
              {UI_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{langName(l.code)}</option>)}
            </select>
          )}
          <select className="pod-select" value={pick.cat} onChange={(e) => choose({ cat: e.target.value })} aria-label={t('audio.podcasts.trending.category')}>
            <option value="">{t('audio.podcasts.trending.allCategories')}</option>
            {TRENDING_CATEGORIES.map((c) => <option key={c} value={c}>{t(`audio.podcasts.categories.${c.replace(/\s+/g, '')}`)}</option>)}
          </select>
        </div>
      </div>
      {isLoading && <p className="pod-empty">{t('common.status.loading')}</p>}
      {isError && <p className="pod-empty">{t(tab === 'charts' ? 'audio.podcasts.charts.failed' : 'audio.podcasts.trending.failed')}</p>}
      {!isLoading && !isError && list.length === 0 && (
        <p className="pod-empty">{t(tab === 'charts' ? 'audio.podcasts.charts.none' : 'audio.podcasts.trending.none')}</p>
      )}
      <PiResults list={shown} followed={followed} busy={busy} onFollow={follow} />
      {!all && list.length > DISCOVER_SHOWN && (
        <button type="button" className="pod-btn pod-more" onClick={() => setAll(true)}>{t('audio.podcasts.more')}</button>
      )}
    </section>
  );
}

// ─── The header: search, RSS, OPML ────────────────────────────────────────────

const SEARCH_MODES = [
  { key: 'shows', labelKey: 'audio.podcasts.search.modeShows', placeholderKey: 'audio.podcasts.search.placeholder' },
  { key: 'people', labelKey: 'audio.podcasts.search.modePeople', placeholderKey: 'audio.podcasts.search.placeholderPeople' },
];

function PodcastHero({ user, searchEnabled, personEnabled, subscriptions, onFollowed }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState('shows');
  const [feedUrl, setFeedUrl] = useState('');
  // A private feed (a supporters' feed, a paid show): its login goes into the link.
  const [priv, setPriv] = useState({ on: false, username: '', password: '' });
  const { busy, follow } = useFollowFeeds(user, onFollowed);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const fileRef = useRef(null);
  const followed = useFollowedKeys(subscriptions);

  const search = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      // Apple's results come from the store of the country Discover shows.
      const found = mode === 'people' && personEnabled ? await searchPeople(q) : await searchPodcasts(q, discoverPrefs().country);
      setResults({ q, list: found.results || [] });
    } catch {
      toastIn('Podcasts').error(t('audio.podcasts.search.failed'));
    } finally {
      setSearching(false);
    }
  };

  const addFeed = async (e) => {
    e.preventDefault();
    const url = feedUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { toastIn('Podcasts').error(t('audio.podcasts.errors.badUrl')); return; }
    if (priv.on) {
      if (await follow([buildPrivateFeedUrl(url, priv.username, priv.password)], [], [true])) {
        setFeedUrl('');
        setPriv({ on: false, username: '', password: '' });
      }
      return;
    }
    if (await follow([url])) setFeedUrl('');
  };

  const exportOpml = () => {
    const left = downloadOpml(subscriptions, user);
    if (left) toastIn('Podcasts').info(t('audio.podcasts.private.opmlLeftOut', { count: left }));
  };

  const importOpml = async (file) => {
    if (!file) return;
    try {
      const feeds = parseOpml(await file.text());
      if (!feeds.length) { toastIn('Podcasts').error(t('audio.podcasts.opml.empty')); return; }
      await follow(feeds.slice(0, 200).map((f) => f.url), feeds.slice(0, 200).map((f) => f.title));
    } catch (err) {
      toastIn('Podcasts').error(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <>
      <header className="pod-hero">
        <div className="pod-hero-intro">
          <span className="pod-hero-icon"><MdPodcasts size={28} /></span>
          <div>
            <h2 className="pod-hero-title">{t('audio.podcasts.introTitle')}</h2>
            <p className="pod-hero-sub">{user ? t('audio.podcasts.heroSub') : t('audio.podcasts.introSignedOut')}</p>
          </div>
        </div>

        {user && (
          <div className="pod-hero-body">
            <div className={`pod-hero-fields${searchEnabled ? '' : ' pod-hero-fields--single'}`}>
              {searchEnabled && (
                <form className="pod-field" onSubmit={search}>
                  <div className="pod-field-head">
                  <label className="pod-field-label" htmlFor="pod-search">{t('audio.podcasts.search.label')}</label>
                  {personEnabled && <div className="pod-search-modes" role="group" aria-label={t('audio.podcasts.search.label')}>
                    {SEARCH_MODES.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        className={`pod-search-mode${mode === m.key ? ' active' : ''}`}
                        aria-pressed={mode === m.key}
                        onClick={() => { setMode(m.key); setResults(null); }}
                      >
                        {t(m.labelKey)}
                      </button>
                    ))}
                  </div>}
                </div>
                  <div className="pod-field-row">
                    <MdSearch className="pod-field-icon" size={18} />
                    <input
                      id="pod-search"
                      type="search"
                      value={query}
                      onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setResults(null); }}
                      placeholder={t(SEARCH_MODES.find((m) => m.key === mode).placeholderKey)}
                      autoComplete="off"
                    />
                    <button type="submit" className="pod-btn pod-btn--primary" disabled={searching || query.trim().length < 2}>
                      {searching ? t('common.status.loading') : t('audio.podcasts.search.button')}
                    </button>
                  </div>
                </form>
              )}
              <form className="pod-field" onSubmit={addFeed}>
                <label className="pod-field-label" htmlFor="pod-rss">{t('audio.podcasts.rss.labelLink')}</label>
                <div className="pod-field-row">
                  <MdLink className="pod-field-icon" size={18} />
                  <input
                    id="pod-rss"
                    type="url"
                    inputMode="url"
                    value={feedUrl}
                    onChange={(e) => setFeedUrl(e.target.value)}
                    placeholder={t('audio.podcasts.rss.placeholderLink')}
                    autoComplete="off"
                  />
                  <button type="submit" className="pod-btn pod-btn--primary" disabled={busy || !feedUrl.trim()}>
                    <MdAdd size={16} /> {t('audio.podcasts.follow')}
                  </button>
                </div>
                <button
                  type="button"
                  className="pod-link-btn pod-private-toggle"
                  aria-expanded={priv.on}
                  aria-controls="pod-private-fields"
                  onClick={() => setPriv((p) => ({ ...p, on: !p.on }))}
                >
                  {priv.on ? <MdLock size={15} /> : <MdLockOpen size={15} />} {t('audio.podcasts.private.toggle')}
                </button>
                {priv.on && (
                  <div className="pod-private" id="pod-private-fields">
                    <div className="pod-private-fields">
                      <label className="pod-field">
                        <span className="pod-field-label">{t('audio.podcasts.private.username')}</span>
                        <input className="pod-input" type="text" autoComplete="off" value={priv.username} onChange={(e) => setPriv((p) => ({ ...p, username: e.target.value }))} />
                      </label>
                      <label className="pod-field">
                        <span className="pod-field-label">{t('audio.podcasts.private.password')}</span>
                        <input className="pod-input" type="password" autoComplete="new-password" value={priv.password} onChange={(e) => setPriv((p) => ({ ...p, password: e.target.value }))} />
                      </label>
                    </div>
                    <p className="pod-private-hint">{t('audio.podcasts.private.hint')}</p>
                  </div>
                )}
              </form>
            </div>

            <div className="pod-hero-tools">
              <button type="button" className="pod-link-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                <MdUploadFile size={15} /> {t('audio.podcasts.opml.import')}
              </button>
              {subscriptions?.length > 0 && (
                <button type="button" className="pod-link-btn" onClick={exportOpml}>
                  <MdDownload size={15} /> {t('audio.podcasts.opml.export')}
                </button>
              )}
              <input ref={fileRef} type="file" accept=".opml,.xml,text/xml,text/x-opml,application/xml" hidden onChange={(e) => importOpml(e.target.files?.[0])} />
            </div>
          </div>
        )}
      </header>

      {results && (
        <section className="pod-section">
          <div className="pod-section-head">
            <h2 className="pod-section-title"><MdSearch size={18} />{t('audio.podcasts.search.results', { count: results.list.length })}</h2>
            <button type="button" className="pod-icon-btn" onClick={() => setResults(null)} aria-label={t('common.actions.close')}><MdClose size={18} /></button>
          </div>
          {results.list.length === 0 && <p className="pod-empty">{t('audio.podcasts.search.none')}</p>}
          <PiResults list={results.list} followed={followed} busy={busy} onFollow={follow} />
        </section>
      )}
    </>
  );
}

// ─── One show ─────────────────────────────────────────────────────────────────

/** `value`, once it has stopped changing for `ms`. */
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function ShowView({ feedId, user, subscription, onBack, onOpenEpisode }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(0);
  const [range, setRange] = useState({ from: '', to: '' });
  const [listen, setListen] = useState('all');
  const [season, setSeason] = useState(0);
  const [search, setSearch] = useState('');
  // The episode search runs on the checker (?q=), once typing stops.
  const q = useDebounced(search.trim().length >= 2 ? search.trim() : '', 400);
  const bounds = useMemo(() => rangeFor(days, range), [days, range]);
  const { since, until } = bounds;
  const { data, isLoading, error } = usePodcastFeed(feedId, since, until, q, user);
  usePodcastProgress(user, { feedId });
  useDownloads();
  const audioPlayQueued = useAppStore((s) => s.audioPlayQueued);
  const invalidate = useInvalidatePodcasts();
  const [older, setOlder] = useState([]);
  const [olderState, setOlderState] = useState({ loading: false, done: false });
  const [busy, setBusy] = useState(false);
  const [autoQueue, setAutoQueueState] = useState(() => !!(user && readAutoQueue(user).feeds[feedId]));
  const feed = data?.feed;
  const episodes = useMemo(() => [...(data?.episodes || []), ...older], [data, older]);
  const list = () => episodes.map((e) => episodeToTrack(e, feed));

  const resetOlder = () => {
    setOlder([]);
    setOlderState({ loading: false, done: false });
  };
  const changeDays = (d) => { setDays(d); resetOlder(); };
  const changeRange = (r) => { setRange(r); resetOlder(); };
  // A new search is a new list: the older pages of the last one go.
  const [lastQ, setLastQ] = useState(q);
  if (lastQ !== q) { setLastQ(q); resetOlder(); }

  const loadOlder = async () => {
    setOlderState({ loading: true, done: false });
    try {
      const r = await fetchOlderEpisodes(feedId, episodes.length, since, until, q, user);
      setOlder((o) => [...o, ...r.episodes]);
      setOlderState({ loading: false, done: r.next_offset >= r.total || !r.episodes.length });
    } catch {
      toastIn('Podcasts').error(t('audio.podcasts.olderFailed'));
      setOlderState({ loading: false, done: false });
    }
  };

  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      await fn();
      if (okMsg) toastIn('Podcasts').success(okMsg);
      invalidate();
    } catch (err) {
      toastIn('Podcasts').error(err.message || followErrorText());
    } finally {
      setBusy(false);
    }
  };

  const toggleAutoQueue = () => {
    const on = !autoQueue;
    setAutoQueue(user, feedId, on);
    setAutoQueueState(on);
    toastIn('Podcasts').success(on ? t('audio.podcasts.autoQueue.onDone') : t('audio.podcasts.autoQueue.offDone'));
  };

  if (isLoading) return <div className="pod-empty">{t('common.status.loading')}</div>;
  if (error || !feed) {
    return (
      <div className="pod-show">
        <button type="button" className="pod-back" onClick={onBack}><MdArrowBack size={18} /> {t('common.actions.back')}</button>
        <p className="pod-empty">{t('audio.podcasts.showMissing')}</p>
      </div>
    );
  }

  const olderAvailable = (data.total || 0) > episodes.length && !olderState.done;
  const seasons = seasonsOf(episodes);
  // The trailer, pinned on top as "Start here" while the list is not narrowed down.
  const trailer = !q && !season && listen === 'all' && !since && !until ? trailerOf(episodes) : null;
  // The range is also applied here, so the page is right whatever the server did with it.
  const shown = episodes.filter((ep) => ep !== trailer
    && inRange(ep, bounds)
    && matchesListen(ep, listen)
    && (!season || Number(ep.season) === season));
  const episodeArt = episodes.find((e) => e.art)?.art;
  const playLatest = () => {
    const tracks = list();
    if (tracks.length) audioPlayQueued(tracks[0]);
  };

  return (
    <div className="pod-show">
      <button type="button" className="pod-back" onClick={onBack}><MdArrowBack size={18} /> {t('audio.podcasts.allPodcasts')}</button>
      <header className="pod-show-head">
        <PodcastArt art={feed.art} fallback={episodeArt} px={512} className="pod-show-cover" />
        <div className="pod-show-info">
          <span className="pod-show-kicker"><MdPodcasts size={14} /> {t('audio.podcasts.kicker')}{feed.private && <PrivateBadge withText />}</span>
          <h2 className="pod-show-title">{feed.title || feed.url}</h2>
          {feed.author && <div className="pod-show-author">{feed.author}</div>}
          <div className="pod-show-meta">
            {feed.categories?.map((c) => <span key={c} className="pod-chip">{c}</span>)}
            <span>{t('audio.podcasts.followers', { count: feed.subscribers || 0 })}</span>
            {feed.item_count > 0 && <span>{t('audio.podcasts.episodes', { count: feed.item_count })}</span>}
          </div>
          {feed.description && <p className="pod-show-desc">{feed.description}</p>}
          {feed.status === 'error' && <p className="pod-show-error">{t('audio.podcasts.feedError', { reason: followErrorText(feed.error) })}</p>}
          <div className="pod-show-actions">
            {episodes.length > 0 && (
              <button type="button" className="pod-btn pod-btn--solid" onClick={playLatest}><MdPlayArrow size={18} /> {t('audio.podcasts.playLatest')}</button>
            )}
            {user && (subscription ? (
              <>
                <button
                  type="button"
                  className={`pod-btn${subscription.notify ? ' pod-btn--on' : ''}`}
                  disabled={busy}
                  onClick={() => run(() => setFeedNotify(user, feed.id, !subscription.notify), subscription.notify ? t('audio.podcasts.notifyOffDone') : t('audio.podcasts.notifyOnDone'))}
                  title={t('audio.podcasts.notifyHint')}
                >
                  {subscription.notify ? <MdNotificationsActive size={16} /> : <MdNotificationsOff size={16} />}
                  {subscription.notify ? t('audio.podcasts.notifyOn') : t('audio.podcasts.notifyOff')}
                </button>
                <button
                  type="button"
                  className={`pod-btn${autoQueue ? ' pod-btn--on' : ''}`}
                  aria-pressed={autoQueue}
                  onClick={toggleAutoQueue}
                  title={t('audio.podcasts.autoQueue.hint')}
                >
                  <MdQueueMusic size={16} /> {t('audio.podcasts.autoQueue.label')}
                </button>
                <button type="button" className="pod-btn" disabled={busy} onClick={() => run(() => unfollowFeed(user, feed.id), t('audio.podcasts.unfollowed'))}>
                  <MdCheck size={16} /> {t('audio.podcasts.unfollow')}
                </button>
              </>
            ) : feed.url && (
              <button type="button" className="pod-btn pod-btn--primary" disabled={busy} onClick={() => run(async () => {
                const [r] = await followFeeds(user, [feed.url]);
                if (!r?.ok) throw new Error(followErrorText(r?.code, r));
              }, t('audio.podcasts.followed'))}>
                <MdAdd size={16} /> {t('audio.podcasts.follow')}
              </button>
            ))}
            {feed.link && (
              <a className="pod-btn" href={feed.link} target="_blank" rel="noopener noreferrer nofollow"><MdOpenInNew size={16} /> {t('audio.podcasts.website')}</a>
            )}
            {/* A private feed's link is never handed out (it carries the login). */}
            {feed.url && !feed.private && (
              <a className="pod-btn" href={feed.url} target="_blank" rel="noopener noreferrer nofollow"><MdRssFeed size={16} /> RSS</a>
            )}
          </div>
        </div>
      </header>

      <LiveBanner feed={feed} />
      <PersonsRow persons={feed.persons} />

      {trailer && (
        <section className="pod-section">
          <h2 className="pod-section-title"><MdFiberNew size={18} />{t('audio.podcasts.startHere')}</h2>
          <ul className="pod-tile-grid">
            <EpisodeTile ep={trailer} feed={feed} showShow={false} onOpenEpisode={onOpenEpisode} />
          </ul>
        </section>
      )}

      <section className="pod-section">
        <div className="pod-section-head pod-section-head--filters">
          <h2 className="pod-section-title">
            {t('audio.podcasts.episodesTitle')}
            {data.total > 0 && <span className="audio-section-count">{data.total}</span>}
          </h2>
          <EpisodeFilters days={days} onDays={changeDays} listen={listen} onListen={setListen} range={range} onRange={changeRange} />
        </div>
        <div className="pod-show-tools">
          <label className="pod-field-row pod-episode-search">
            <MdSearch className="pod-field-icon" size={18} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('audio.podcasts.episodeSearch.placeholder')}
              aria-label={t('audio.podcasts.episodeSearch.label')}
              autoComplete="off"
            />
          </label>
          {seasons.length > 0 && (
            <select className="pod-select" value={season} onChange={(e) => setSeason(Number(e.target.value))} aria-label={t('audio.podcasts.seasons.label')}>
              <option value={0}>{t('audio.podcasts.seasons.all')}</option>
              {seasons.map((n) => <option key={n} value={n}>{t('audio.podcasts.seasons.season', { n })}</option>)}
            </select>
          )}
        </div>
        <ul className="pod-tile-grid">
          {shown.map((ep) => <EpisodeTile key={ep.id} ep={ep} feed={feed} showShow={false} onOpenEpisode={onOpenEpisode} />)}
        </ul>
        {episodes.length === 0 && (
          <p className="pod-empty">
            {q ? t('audio.podcasts.episodeSearch.none', { q }) : since || until ? t('audio.podcasts.filters.none') : t('audio.podcasts.noEpisodes')}
          </p>
        )}
        {episodes.length > 0 && shown.length === 0 && !trailer && <p className="pod-empty">{t('audio.podcasts.filters.none')}</p>}
        {olderAvailable && (
          <button type="button" className="pod-btn pod-more" onClick={loadOlder} disabled={olderState.loading}>
            {olderState.loading ? t('common.status.loading') : t('audio.podcasts.loadOlder')}
          </button>
        )}
      </section>
    </div>
  );
}

// ─── The tab ──────────────────────────────────────────────────────────────────

// Mine | Discover | Trends, in the URL (?view=) so Back returns to it. Without one:
// the last one picked, else Mine for someone signed in and Discover for a guest.
const VIEWS = ['mine', 'discover', 'trends'];
const VIEW_KEY = 'pod-view';
function viewOf(param, user) {
  if (VIEWS.includes(param)) return param;
  try {
    const saved = localStorage.getItem(VIEW_KEY);
    if (VIEWS.includes(saved)) return saved;
  } catch { /* storage off */ }
  return user ? 'mine' : 'discover';
}

/**
 * When Mine was opened before this visit (for the "New" inbox), read once each
 * time Mine is opened; opening it records the new visit.
 */
function useMineVisit(user, active) {
  const key = active ? user || '~anon' : null;
  const [visit, setVisit] = useState(null);
  // Read while rendering, before the effect below records this visit.
  if ((visit?.key ?? null) !== key) setVisit(key ? { key, at: readMineVisit(user) } : null);
  useEffect(() => { if (active) markMineVisit(user); }, [user, active]);
  return visit ? visit.at : readMineVisit(user);
}

/**
 * Shows with "Auto-add new episodes to the queue" on: when the latest episodes
 * load, the new unplayed ones go to the end of the queue, each once
 * (lib/podcastLibrary.js pickAutoQueue). Runs while the podcasts page is open.
 */
function useAutoQueue(user, episodes, feedsById) {
  const { t } = useTranslation();
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const key = episodes.map((e) => e.id).join(',');
  useEffect(() => {
    if (!user || !episodes.length) return;
    const settings = readAutoQueue(user);
    if (!Object.keys(settings.feeds).length) return;
    const { audioQueue, audioCurrent } = useAppStore.getState();
    const picked = pickAutoQueue(episodes, settings, {
      progressOf,
      queuedIds: new Set(audioQueue.map((i) => i._id)),
      currentId: audioCurrent?._id,
    });
    if (!picked.length) return;
    picked.forEach((ep) => audioAddToQueue(episodeToTrack(ep, feedsById[ep.feed_id])));
    markAutoQueued(user, picked.map((ep) => ep.id));
    toastIn('Podcasts').success(t('audio.podcasts.autoQueue.added', { count: picked.length }));
    // The ids stand for the list; feedsById comes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, key]);
}

export default function PodcastsTab() {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const [params, setParams] = useSearchParams();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const me = authenticated ? user : null;
  const { data: config } = usePodcastConfig();
  const { data: subscriptions = [], isSuccess: subsLoaded } = usePodcastSubscriptions(me);
  const view = viewOf(params.get('view'), me);
  const { data: discover } = usePodcastDiscover();
  const latest = usePodcastLatest(me);
  const invalidate = useInvalidatePodcasts();
  const [latestDays, setLatestDays] = useState(0);
  const [latestRange, setLatestRange] = useState({ from: '', to: '' });
  const [latestListen, setLatestListen] = useState('all');
  const latestBounds = useMemo(() => rangeFor(latestDays, latestRange), [latestDays, latestRange]);
  const lastVisit = useMineVisit(me, view === 'mine' && !params.get('podcast') && !params.get('episode'));
  useDownloads();
  const latestIds = useMemo(
    () => (latest.data?.pages || []).flatMap((p) => (p.episodes || []).map((e) => e.id)).slice(0, 150),
    [latest.data],
  );
  usePodcastProgress(me, { ids: latestIds });
  const feedId = params.get('podcast');
  const episodeParam = params.get('episode');
  const pages = latest.data?.pages || [];
  const feedsById = Object.assign({}, ...pages.map((p) => p.feeds || {}));
  const episodes = pages.flatMap((p) => p.episodes || []);
  useAutoQueue(me, episodes, feedsById);

  const openShow = (id) => {
    const next = new URLSearchParams(params);
    next.set('type', 'external');
    next.delete('episode');
    // A shared timestamp belongs to the episode it came with.
    next.delete('t');
    next.delete('end');
    if (id) next.set('podcast', id); else next.delete('podcast');
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const openEpisode = (id) => {
    const next = new URLSearchParams(params);
    next.set('type', 'external');
    next.delete('podcast');
    next.delete('t');
    next.delete('end');
    next.set('episode', id);
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const showView = (v) => {
    const next = new URLSearchParams(params);
    next.set('type', 'external');
    next.set('view', v);
    setParams(next);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* storage off */ }
  };

  const subsById = useMemo(() => new Map(subscriptions.map((s) => [s.id, s])), [subscriptions]);

  // One episode (a tile's title or description, the player, the bell, a push).
  if (episodeParam) {
    return <EpisodeView key={episodeParam} episodeId={episodeParam} user={me} onOpenShow={openShow} />;
  }

  if (feedId) {
    // Keyed by show, so "load older" starts over for each one.
    return <ShowView key={feedId} feedId={feedId} user={me} subscription={subsById.get(feedId)} onBack={() => openShow(null)} onOpenEpisode={openEpisode} />;
  }

  if (config && config.enabled === false) {
    return <p className="pod-empty">{t('audio.podcasts.errors.disabled')}</p>;
  }

  const latestShown = episodes.filter((e) => inRange(e, latestBounds) && matchesListen(e, latestListen, lastVisit));
  const inboxCount = episodes.filter((e) => isInboxEpisode(e, progressOf(e.id), lastVisit)).length;
  // A show without a cover of its own borrows its newest loaded episode's art.
  const episodeArt = {};
  for (const e of episodes) if (e.art && !episodeArt[e.feed_id]) episodeArt[e.feed_id] = e.art;
  const artFor = (f) => episodeArt[f.id];
  // The shows you followed last come first.
  const mine = [...subscriptions].sort((a, b) => new Date(b.added_at) - new Date(a.added_at));

  const followed = (id) => { invalidate(); if (id) openShow(id); };
  const views = [
    { key: 'mine', icon: <MdLibraryMusic size={18} />, label: t('audio.podcasts.views.mine') },
    { key: 'discover', icon: <MdExplore size={18} />, label: t('audio.podcasts.views.discover') },
    { key: 'trends', icon: <MdWhatshot size={18} />, label: t('audio.podcasts.views.trends') },
  ];

  return (
    <div className="pod-tab">
      <nav className="pod-views" role="tablist" aria-label={t('audio.podcasts.kicker')}>
        {views.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={`pod-view${view === v.key ? ' active' : ''}`}
            onClick={() => showView(v.key)}
          >
            {v.icon}<span>{v.label}</span>
          </button>
        ))}
      </nav>

      {view === 'mine' && (
        <>
          {!me && <p className="pod-empty pod-empty--center">{t('audio.podcasts.introSignedOut')}</p>}
          {!me && <DownloadsSection onOpenEpisode={openEpisode} />}
          {me && subsLoaded && subscriptions.length === 0 && (
            <div className="pod-mine-empty">
              <MdPodcasts size={40} />
              <p>{t('audio.podcasts.views.mineEmpty')}</p>
              <div className="pod-mine-empty-actions">
                <button type="button" className="pod-btn pod-btn--primary" onClick={() => showView('discover')}><MdExplore size={16} /> {t('audio.podcasts.views.discover')}</button>
                <button type="button" className="pod-btn" onClick={() => showView('trends')}><MdWhatshot size={16} /> {t('audio.podcasts.views.trends')}</button>
              </div>
            </div>
          )}
          <ShowRail
            icon={<MdPodcasts size={18} />}
            title={t('audio.podcasts.yourPodcasts', { count: subscriptions.length })}
            feeds={mine}
            onOpen={openShow}
            artFor={artFor}
            noteFor={(f) => (f.status === 'pending' ? t('audio.podcasts.pending') : f.status === 'error' ? t('audio.podcasts.cantRead') : f.author)}
          />

          {episodes.length > 0 && (
            <section className="pod-section">
              <div className="pod-section-head pod-section-head--filters">
                <h2 className="pod-section-title"><MdPlayArrow size={18} />{t('audio.podcasts.latest')}</h2>
                <EpisodeFilters
                  days={latestDays}
                  onDays={setLatestDays}
                  listen={latestListen}
                  onListen={setLatestListen}
                  range={latestRange}
                  onRange={setLatestRange}
                  inbox={inboxCount}
                />
              </div>
              <ul className="pod-tile-grid">
                {latestShown.map((ep) => (
                  <EpisodeTile key={ep.id} ep={ep} feed={feedsById[ep.feed_id]} onOpenShow={openShow} onOpenEpisode={openEpisode} />
                ))}
              </ul>
              {latestShown.length === 0 && (
                <p className="pod-empty">{latestListen === 'new' ? t('audio.podcasts.filters.inboxEmpty') : t('audio.podcasts.filters.none')}</p>
              )}
              {latest.hasNextPage && (
                <button type="button" className="pod-btn pod-more" onClick={() => latest.fetchNextPage()} disabled={latest.isFetchingNextPage}>
                  {latest.isFetchingNextPage ? t('common.status.loading') : t('audio.podcasts.more')}
                </button>
              )}
            </section>
          )}
          {me && <DownloadsSection onOpenEpisode={openEpisode} />}
        </>
      )}

      {view === 'discover' && (
        <>
          <PodcastHero user={me} searchEnabled={!!config?.search} personEnabled={!!config?.person || config?.person === undefined && !!config?.search} subscriptions={subscriptions} onFollowed={followed} />
          <ShowRail icon={<MdTrendingUp size={18} />} title={t('audio.podcasts.topTitle')} feeds={discover?.top} onOpen={openShow} ranked artFor={artFor} />
          <ShowRail
            icon={<MdHistory size={18} />}
            title={t('audio.podcasts.recentTitle')}
            feeds={discover?.recent}
            onOpen={openShow}
            artFor={artFor}
            noteFor={(f) => (f.last_followed_at ? t('audio.podcasts.followedOn', { date: fmtDate(f.last_followed_at) }) : f.author)}
          />
        </>
      )}

      {view === 'trends' && (config?.charts || config?.trending) && (
        <DiscoverSection user={me} config={config} subscriptions={subscriptions} onFollowed={followed} />
      )}
    </div>
  );
}
