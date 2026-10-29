import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MdPlayArrow, MdPause, MdAdd, MdRssFeed, MdNotificationsActive, MdNotificationsOff, MdArrowBack, MdOpenInNew,
  MdUploadFile, MdDownload, MdSearch, MdClose, MdCheck, MdPodcasts, MdTrendingUp, MdHistory,
} from 'react-icons/md';
import { BiDollar } from 'react-icons/bi';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import {
  usePodcastConfig, usePodcastSubscriptions, usePodcastLatest, usePodcastFeed, usePodcastDiscover, useInvalidatePodcasts,
  followFeeds, unfollowFeed, setFeedNotify, followErrorText, fetchOlderEpisodes, searchPodcasts,
  episodeToTrack, parseOpml, downloadOpml,
} from '../../lib/podcasts';
import PodcastTipModal from './PodcastTipModal';
import PodcastArt from './PodcastArt';
import EpisodeView from './EpisodeView';
import { fmtDuration, useDateFormat } from '../../lib/podcastFormat';
import { canTipEpisode } from '../../lib/podcastTips';
import { usePodcastProgress, progressOf } from '../../lib/podcastProgress';
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
const LISTEN_FILTERS = [
  { key: 'all', labelKey: 'audio.podcasts.filters.all' },
  { key: 'new', labelKey: 'audio.podcasts.filters.notListened' },
  { key: 'unfinished', labelKey: 'audio.podcasts.filters.notFinished' },
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

function matchesListen(ep, listen) {
  if (listen === 'all') return true;
  const p = progressOf(ep.id);
  if (listen === 'new') return !p || (!p.done && p.pos < 5);
  return !p?.done;
}

/** Listening state on the left, date range on the right, the 3Speak audio filter look. */
function EpisodeFilters({ days, onDays, listen, onListen, range, onRange }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="pod-filters">
      <div className="audio-type-filter pod-filter-listen" role="group" aria-label={t('audio.podcasts.filters.listenLabel')}>
        {LISTEN_FILTERS.map((f) => (
          <button key={f.key} type="button" className={`audio-type-chip${listen === f.key ? ' active' : ''}`} onClick={() => onListen(f.key)}>
            {t(f.labelKey)}
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

function EpisodeTile({ ep, feed, list, showShow = true, onOpenShow, onOpenEpisode }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const [tipping, setTipping] = useState(false);
  const track = useMemo(() => episodeToTrack(ep, feed), [ep, feed]);
  const isCurrent = audioCurrent?._id === ep.id;
  const playing = isCurrent && audioIsPlaying;
  const progress = progressOf(ep.id);
  const started = progress && (progress.done || progress.pct > 0);

  const play = () => {
    if (isCurrent) { audioRequestToggle(); return; }
    audioPlay(track, list ? list() : [track]);
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
      {(canTipEpisode(track) || ep.link) && (
        <div className="pod-tile-actions">
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
      )}
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
    <button type="button" className={`pod-card${feed.status === 'error' ? ' pod-card--error' : ''}`} onClick={() => onOpen(feed.id)} title={feed.title || feed.url}>
      <span className="pod-card-art">
        <PodcastArt art={feed.art} fallback={fallbackArt} px={256} />
        {rank && <span className="pod-card-rank">{rank}</span>}
      </span>
      <span className="pod-card-title">{feed.title || feed.url}</span>
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

// ─── The header: search, RSS, OPML ────────────────────────────────────────────

function PodcastHero({ user, searchEnabled, subscriptions, onFollowed }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState(null);
  const fileRef = useRef(null);
  const followed = useMemo(() => new Set((subscriptions || []).map((s) => s.url)), [subscriptions]);

  const follow = async (urls, titles) => {
    setBusy(true);
    try {
      const res = await followFeeds(user, urls, titles);
      const ok = res.filter((r) => r.ok);
      const failed = res.filter((r) => !r.ok);
      if (urls.length === 1) {
        if (ok.length) {
          toastIn('Podcasts').success(ok[0].already ? t('audio.podcasts.alreadyFollowing') : t('audio.podcasts.followed'));
          onFollowed?.(ok[0].feed_id);
        } else {
          toastIn('Podcasts').error(followErrorText(failed[0]?.code));
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

  const search = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      setResults({ q, list: (await searchPodcasts(q)).results || [] });
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
    if (await follow([url])) setFeedUrl('');
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
          <div className={`pod-hero-fields${searchEnabled ? '' : ' pod-hero-fields--single'}`}>
            {searchEnabled && (
              <form className="pod-field" onSubmit={search}>
                <label className="pod-field-label" htmlFor="pod-search">{t('audio.podcasts.search.label')}</label>
                <div className="pod-field-row">
                  <MdSearch className="pod-field-icon" size={18} />
                  <input
                    id="pod-search"
                    type="search"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); if (!e.target.value) setResults(null); }}
                    placeholder={t('audio.podcasts.search.placeholder')}
                    autoComplete="off"
                  />
                  <button type="submit" className="pod-btn pod-btn--primary" disabled={searching || query.trim().length < 2}>
                    {searching ? t('common.status.loading') : t('audio.podcasts.search.button')}
                  </button>
                </div>
              </form>
            )}
            <form className="pod-field" onSubmit={addFeed}>
              <label className="pod-field-label" htmlFor="pod-rss">{t('audio.podcasts.rss.label')}</label>
              <div className="pod-field-row">
                <MdRssFeed className="pod-field-icon" size={18} />
                <input
                  id="pod-rss"
                  type="url"
                  inputMode="url"
                  value={feedUrl}
                  onChange={(e) => setFeedUrl(e.target.value)}
                  placeholder={t('audio.podcasts.rss.placeholder')}
                  autoComplete="off"
                />
                <button type="submit" className="pod-btn pod-btn--primary" disabled={busy || !feedUrl.trim()}>
                  <MdAdd size={16} /> {t('audio.podcasts.follow')}
                </button>
              </div>
            </form>
          </div>
        )}

        {user && (
          <div className="pod-hero-tools">
            <button type="button" className="pod-link-btn" onClick={() => fileRef.current?.click()} disabled={busy}>
              <MdUploadFile size={15} /> {t('audio.podcasts.opml.import')}
            </button>
            {subscriptions?.length > 0 && (
              <button type="button" className="pod-link-btn" onClick={() => downloadOpml(subscriptions, user)}>
                <MdDownload size={15} /> {t('audio.podcasts.opml.export')}
              </button>
            )}
            <input ref={fileRef} type="file" accept=".opml,.xml,text/xml,text/x-opml,application/xml" hidden onChange={(e) => importOpml(e.target.files?.[0])} />
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
          <div className="pod-results">
            {results.list.map((r) => (
              <div key={r.url} className="pod-result">
                <PodcastArt art={r.art} px={256} className="pod-result-art" />
                <div className="pod-result-body">
                  <div className="pod-result-title" title={r.title}>{r.title}</div>
                  <div className="pod-result-meta">{r.author}</div>
                  {r.episodes > 0 && <div className="pod-result-meta">{t('audio.podcasts.episodes', { count: r.episodes })}</div>}
                </div>
                {followed.has(r.url)
                  ? <span className="pod-following"><MdCheck size={15} /> {t('audio.podcasts.following')}</span>
                  : <button type="button" className="pod-btn pod-btn--primary pod-result-follow" disabled={busy} onClick={() => follow([r.url])}><MdAdd size={16} /> {t('audio.podcasts.follow')}</button>}
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ─── One show ─────────────────────────────────────────────────────────────────

function ShowView({ feedId, user, subscription, onBack, onOpenEpisode }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(0);
  const [range, setRange] = useState({ from: '', to: '' });
  const [listen, setListen] = useState('all');
  const bounds = useMemo(() => rangeFor(days, range), [days, range]);
  const { since, until } = bounds;
  const { data, isLoading, error } = usePodcastFeed(feedId, since, until);
  usePodcastProgress(user, { feedId });
  const audioPlay = useAppStore((s) => s.audioPlay);
  const invalidate = useInvalidatePodcasts();
  const [older, setOlder] = useState([]);
  const [olderState, setOlderState] = useState({ loading: false, done: false });
  const [busy, setBusy] = useState(false);
  const feed = data?.feed;
  const episodes = useMemo(() => [...(data?.episodes || []), ...older], [data, older]);
  const list = () => episodes.map((e) => episodeToTrack(e, feed));

  const resetOlder = () => {
    setOlder([]);
    setOlderState({ loading: false, done: false });
  };
  const changeDays = (d) => { setDays(d); resetOlder(); };
  const changeRange = (r) => { setRange(r); resetOlder(); };

  const loadOlder = async () => {
    setOlderState({ loading: true, done: false });
    try {
      const r = await fetchOlderEpisodes(feedId, episodes.length, since, until);
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
  // The range is also applied here, so the page is right whatever the server did with it.
  const shown = episodes.filter((ep) => inRange(ep, bounds) && matchesListen(ep, listen));
  const episodeArt = episodes.find((e) => e.art)?.art;
  const playLatest = () => {
    const tracks = list();
    if (tracks.length) audioPlay(tracks[0], tracks);
  };

  return (
    <div className="pod-show">
      <button type="button" className="pod-back" onClick={onBack}><MdArrowBack size={18} /> {t('audio.podcasts.allPodcasts')}</button>
      <header className="pod-show-head">
        <PodcastArt art={feed.art} fallback={episodeArt} px={512} className="pod-show-cover" />
        <div className="pod-show-info">
          <span className="pod-show-kicker"><MdPodcasts size={14} /> {t('audio.podcasts.kicker')}</span>
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
                <button type="button" className="pod-btn" disabled={busy} onClick={() => run(() => unfollowFeed(user, feed.id), t('audio.podcasts.unfollowed'))}>
                  <MdCheck size={16} /> {t('audio.podcasts.unfollow')}
                </button>
              </>
            ) : (
              <button type="button" className="pod-btn pod-btn--primary" disabled={busy} onClick={() => run(async () => {
                const [r] = await followFeeds(user, [feed.url]);
                if (!r?.ok) throw new Error(followErrorText(r?.code));
              }, t('audio.podcasts.followed'))}>
                <MdAdd size={16} /> {t('audio.podcasts.follow')}
              </button>
            ))}
            {feed.link && (
              <a className="pod-btn" href={feed.link} target="_blank" rel="noopener noreferrer nofollow"><MdOpenInNew size={16} /> {t('audio.podcasts.website')}</a>
            )}
            <a className="pod-btn" href={feed.url} target="_blank" rel="noopener noreferrer nofollow"><MdRssFeed size={16} /> RSS</a>
          </div>
        </div>
      </header>

      <section className="pod-section">
        <div className="pod-section-head pod-section-head--filters">
          <h2 className="pod-section-title">
            {t('audio.podcasts.episodesTitle')}
            {data.total > 0 && <span className="audio-section-count">{data.total}</span>}
          </h2>
          <EpisodeFilters days={days} onDays={changeDays} listen={listen} onListen={setListen} range={range} onRange={changeRange} />
        </div>
        <ul className="pod-tile-grid">
          {shown.map((ep) => <EpisodeTile key={ep.id} ep={ep} feed={feed} list={list} showShow={false} onOpenEpisode={onOpenEpisode} />)}
        </ul>
        {episodes.length === 0 && <p className="pod-empty">{since || until ? t('audio.podcasts.filters.none') : t('audio.podcasts.noEpisodes')}</p>}
        {episodes.length > 0 && shown.length === 0 && <p className="pod-empty">{t('audio.podcasts.filters.none')}</p>}
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

export default function PodcastsTab() {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  const [params, setParams] = useSearchParams();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const me = authenticated ? user : null;
  const { data: config } = usePodcastConfig();
  const { data: subscriptions = [] } = usePodcastSubscriptions(me);
  const { data: discover } = usePodcastDiscover();
  const latest = usePodcastLatest(me);
  const invalidate = useInvalidatePodcasts();
  const [latestDays, setLatestDays] = useState(0);
  const [latestRange, setLatestRange] = useState({ from: '', to: '' });
  const [latestListen, setLatestListen] = useState('all');
  const latestBounds = useMemo(() => rangeFor(latestDays, latestRange), [latestDays, latestRange]);
  const latestIds = useMemo(
    () => (latest.data?.pages || []).flatMap((p) => (p.episodes || []).map((e) => e.id)).slice(0, 150),
    [latest.data],
  );
  usePodcastProgress(me, { ids: latestIds });
  const feedId = params.get('podcast');
  const episodeParam = params.get('episode');

  const openShow = (id) => {
    const next = new URLSearchParams(params);
    next.set('type', 'external');
    next.delete('episode');
    if (id) next.set('podcast', id); else next.delete('podcast');
    setParams(next);
    window.scrollTo({ top: 0 });
  };

  const openEpisode = (id) => {
    const next = new URLSearchParams(params);
    next.set('type', 'external');
    next.delete('podcast');
    next.set('episode', id);
    setParams(next);
    window.scrollTo({ top: 0 });
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

  const pages = latest.data?.pages || [];
  const feedsById = Object.assign({}, ...pages.map((p) => p.feeds || {}));
  const episodes = pages.flatMap((p) => p.episodes || []);
  const latestShown = episodes.filter((e) => inRange(e, latestBounds) && matchesListen(e, latestListen));
  const latestList = () => latestShown.map((e) => episodeToTrack(e, feedsById[e.feed_id]));
  // A show without a cover of its own borrows its newest loaded episode's art.
  const episodeArt = {};
  for (const e of episodes) if (e.art && !episodeArt[e.feed_id]) episodeArt[e.feed_id] = e.art;
  const artFor = (f) => episodeArt[f.id];
  // The shows you followed last come first.
  const mine = [...subscriptions].sort((a, b) => new Date(b.added_at) - new Date(a.added_at));

  return (
    <div className="pod-tab">
      <PodcastHero user={me} searchEnabled={!!config?.search} subscriptions={subscriptions} onFollowed={(id) => { invalidate(); if (id) openShow(id); }} />

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
            <EpisodeFilters days={latestDays} onDays={setLatestDays} listen={latestListen} onListen={setLatestListen} range={latestRange} onRange={setLatestRange} />
          </div>
          <ul className="pod-tile-grid">
            {latestShown.map((ep) => (
              <EpisodeTile key={ep.id} ep={ep} feed={feedsById[ep.feed_id]} list={latestList} onOpenShow={openShow} onOpenEpisode={openEpisode} />
            ))}
          </ul>
          {latestShown.length === 0 && <p className="pod-empty">{t('audio.podcasts.filters.none')}</p>}
          {latest.hasNextPage && (
            <button type="button" className="pod-btn pod-more" onClick={() => latest.fetchNextPage()} disabled={latest.isFetchingNextPage}>
              {latest.isFetchingNextPage ? t('common.status.loading') : t('audio.podcasts.more')}
            </button>
          )}
        </section>
      )}

      <ShowRail icon={<MdTrendingUp size={18} />} title={t('audio.podcasts.topTitle')} feeds={discover?.top} onOpen={openShow} ranked artFor={artFor} />
      <ShowRail
        icon={<MdHistory size={18} />}
        title={t('audio.podcasts.recentTitle')}
        feeds={discover?.recent}
        onOpen={openShow}
        artFor={artFor}
        noteFor={(f) => (f.last_followed_at ? t('audio.podcasts.followedOn', { date: fmtDate(f.last_followed_at) }) : f.author)}
      />

      {me && subscriptions.length === 0 && !discover?.top?.length && (
        <p className="pod-empty pod-empty--center">{config?.search ? t('audio.podcasts.introSearch') : t('audio.podcasts.intro')}</p>
      )}
    </div>
  );
}
