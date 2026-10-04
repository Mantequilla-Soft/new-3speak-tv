import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaYoutube, FaTiktok, FaFileImport, FaCheck } from "react-icons/fa";
import { TailChase } from "ldrs/react";
import "ldrs/react/TailChase.css";
import { useAppStore } from "../lib/store";
import { toastIn } from "../utils/toast";
import { SHORTS_MAX_DURATION_SEC } from "../utils/config";
import {
  getImportStatus, listChannelVideos, listTikTokVideos, resolveImportUrl, startImportJob, getImportJob, cancelImportJob,
  downloadImportFile, fetchThumbnailDataUrl, handOffToStudio, youtubeStudioUrl, youtubeWatchUrl,
} from "../lib/youtubeImport";
import "./YoutubeImportPage.scss";

const toast = toastIn('Upload');

// Tab order. Each maps to one of YouTube's per-type upload playlists (server side).
const TYPES = ['videos', 'shorts', 'live'];
const PLATFORM_TABS = [{ key: 'youtube', Icon: FaYoutube }, { key: 'tiktok', Icon: FaTiktok }];
const emptyGroups = () => Object.fromEntries(
  TYPES.map((type) => [type, { items: [], next: null, total: null, loaded: false, loading: false, error: '' }]),
);

function fmtDuration(s) {
  if (!s) return '';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const mm = h ? String(m).padStart(2, '0') : String(m);
  return `${h ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

/**
 * ▶️ Import a video from the creator's own (verified) YouTube channel.
 *
 * List → pick → the server downloads it → the file comes back to the browser and
 * goes into the normal embed uploader with title/description/tags/thumbnail
 * prefilled. When the server cannot download (YouTube blocks datacenter IPs a
 * lot), the creator downloads it from YouTube Studio and picks the file here; the
 * metadata is prefilled all the same.
 */
export default function YoutubeImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // ?mode= says which uploader sent the creator here, and filters what fits it:
  //   shorts → YouTube Shorts + TikTok, always lands in the Shorts studio
  //   videos → YouTube videos + past livestreams, always a regular video
  //   (none, e.g. from the profile) → everything, the type decides.
  const [searchParams] = useSearchParams();
  const mode = ['shorts', 'videos'].includes(searchParams.get('mode')) ? searchParams.get('mode') : null;
  const types = useMemo(() => (mode === 'shorts' ? ['shorts'] : mode === 'videos' ? ['videos', 'live'] : TYPES), [mode]);
  const platformTabs = mode === 'videos' ? PLATFORM_TABS.filter((p) => p.key === 'youtube') : PLATFORM_TABS;
  const shortMinutes = Math.round(SHORTS_MAX_DURATION_SEC / 60);
  const { user, authenticated } = useAppStore();

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [channel, setChannel] = useState('');
  // One list per YouTube upload type, each with its own paging.
  const [groups, setGroups] = useState(emptyGroups);
  const [activeType, setActiveType] = useState(() => types[0]);
  // Which platform the creator imports from. TikTok has no list: they paste a link.
  const [platform, setPlatform] = useState('youtube');
  const [ttUrl, setTtUrl] = useState('');
  const [ttBusy, setTtBusy] = useState(false);
  const [ttError, setTtError] = useState('');
  // The newest TikToks (TikTok's creator embed serves 10); older ones via the paste box.
  const [ttList, setTtList] = useState({ items: [], loading: false, loaded: false, error: '' });
  const [ttTab, setTtTab] = useState('latest'); // 'latest' (grid) | 'link' (paste box)

  const [selected, setSelected] = useState(null);
  const [job, setJob] = useState(null);           // server job
  const [phase, setPhase] = useState('idle');     // idle | starting | server | transfer | handoff | failed
  const [transfer, setTransfer] = useState(0);
  const [failure, setFailure] = useState(null);   // { message, code }
  const pollRef = useRef(null);
  const fileInputRef = useRef(null);

  // ---- Linked channels --------------------------------------------------------
  useEffect(() => {
    if (!authenticated || !user) return;
    let alive = true;
    setStatusError('');
    getImportStatus()
      .then((s) => {
        if (!alive) return;
        setStatus(s);
        setChannel(s.channels?.[0] || '');
        // Only TikTok linked: start there.
        if (!s.channels?.length && s.links?.tiktok?.length && mode !== 'videos') setPlatform('tiktok');
      })
      .catch((e) => alive && setStatusError(e.status === 401 ? t('ytimport.errors.signIn') : e.message));
    return () => { alive = false; };
  }, [authenticated, user, t, mode]);

  // ---- Videos of the channel --------------------------------------------------
  const patchGroup = (type, patch) => setGroups((g) => ({ ...g, [type]: { ...g[type], ...patch } }));

  const loadGroup = useCallback(async (type, pageToken) => {
    if (!channel) return;
    patchGroup(type, { loading: true, error: '' });
    try {
      const d = await listChannelVideos({ channel, type, pageToken });
      setGroups((g) => ({
        ...g,
        [type]: {
          ...g[type],
          items: pageToken ? [...g[type].items, ...d.videos] : d.videos,
          next: d.nextPageToken,
          total: d.total,
          loaded: true,
          loading: false,
        },
      }));
    } catch (e) {
      patchGroup(type, { error: e.message, loading: false, loaded: true });
    }
  }, [channel]);

  // The first page of every shown type at once, so each tab shows its count right away.
  useEffect(() => {
    setGroups(emptyGroups());
    if (channel) types.forEach((type) => loadGroup(type));
  }, [channel, loadGroup, types]);

  // Land on the first type that has anything, in tab order.
  const allLoaded = types.every((type) => groups[type].loaded);
  useEffect(() => {
    if (!allLoaded) return;
    setActiveType((cur) => (groups[cur].total ? cur : types.find((type) => groups[type].total) || cur));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allLoaded]);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // Load the TikTok list the first time the TikTok tab is shown.
  const hasTikTok = !!status?.links?.tiktok?.length;
  useEffect(() => {
    if (platform !== 'tiktok' || !hasTikTok || ttList.loaded || ttList.loading) return;
    setTtList((l) => ({ ...l, loading: true, error: '' }));
    listTikTokVideos()
      .then((d) => setTtList({ items: d.videos || [], loading: false, loaded: true, error: '' }))
      .catch((e) => setTtList({ items: [], loading: false, loaded: true, error: e.message }));
  }, [platform, hasTikTok, ttList.loaded, ttList.loading]);

  // ---- Import flow ------------------------------------------------------------
  // `media` = what the server measured on the downloaded file (absent when the
  // creator picked their own file).
  const finish = useCallback(async (file, video, media = null) => {
    setPhase('handoff');
    // A Short becomes a 3Speak Short when it fits our length limit; a longer one
    // (YouTube Shorts go up to 3 minutes, TikToks far longer) goes in as a normal
    // video. TikTok gives no length up front, so an unmeasured portrait TikTok is
    // sent as a Short and the studio re-checks the real length.
    const portrait = media ? media.height > media.width : video.type === 'shorts';
    const duration = media?.duration || video.duration || 0;
    // Short mode: a TikTok only reveals its length once downloaded. Too long for a
    // Short means stop here rather than quietly turning it into a regular video.
    if (mode === 'shorts' && duration > SHORTS_MAX_DURATION_SEC) {
      setFailure({ message: t('ytimport.errors.tooLongForShort', { minutes: shortMinutes }), code: 'too_long_short' });
      setPhase('failed');
      return;
    }
    const asShort = mode === 'shorts' ? true
      : mode === 'videos' ? false
        : portrait && (duration > 0 ? duration <= SHORTS_MAX_DURATION_SEC : video.platform === 'tiktok');
    // Short thumbnails come as 16:9 frames (YouTube) or ship with the file; a
    // portrait Short keeps the frames the studio grabs from the file instead.
    const thumb = asShort ? null : await fetchThumbnailDataUrl(video);
    handOffToStudio(file, video, thumb, asShort ? 'shorts' : 'longform');
    navigate(asShort ? '/embed-studio?from=shorts' : '/embed-studio');
  }, [navigate, mode, shortMinutes, t]);

  const fail = (message, code) => {
    clearInterval(pollRef.current);
    setFailure({ message, code });
    setPhase('failed');
  };

  const startImport = async (video) => {
    setFailure(null);
    setTransfer(0);
    setPhase('starting');
    try {
      const j = await startImportJob(video);
      setJob(j);
      setPhase('server');
      clearInterval(pollRef.current);
      const check = async () => {
        try {
          const cur = await getImportJob(j.id);
          setJob(cur);
          if (cur.status === 'done') {
            clearInterval(pollRef.current);
            setPhase('transfer');
            try {
              const file = await downloadImportFile(cur.id, video.id.replace(':', '-'), setTransfer);
              await finish(file, video, cur.media);
            } catch (e) {
              fail(e.message, 'transfer_failed');
            }
          } else if (cur.status === 'failed' || cur.status === 'cancelled') {
            fail(cur.error || t('ytimport.errors.generic'), cur.errorCode);
          }
        } catch (e) {
          fail(e.message, 'poll_failed');
        }
      };
      if (j.status === 'done') check();
      else pollRef.current = setInterval(check, 2000);
    } catch (e) {
      fail(e.message, e.code);
    }
  };

  const cancel = async () => {
    clearInterval(pollRef.current);
    if (job?.id) await cancelImportJob(job.id);
    setJob(null);
    setPhase('idle');
  };

  const pickOwnFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selected) return;
    if (!file.type.startsWith('video/')) {
      toast.error(t('ytimport.errors.notVideo'));
      return;
    }
    finish(file, selected);
  };

  // Not pickable: over the import limit, or (Short mode) over the Short limit.
  // Returns the limit in minutes for the badge, or null.
  const blockedMinutes = (v) => {
    if (v.tooLong) return status?.limits ? Math.round(status.limits.maxDurationS / 60) : null;
    if (mode === 'shorts' && v.duration > SHORTS_MAX_DURATION_SEC) return shortMinutes;
    return null;
  };

  const findTikTok = async (e) => {
    e.preventDefault();
    if (!ttUrl.trim() || ttBusy) return;
    setTtBusy(true);
    setTtError('');
    try {
      const d = await resolveImportUrl(ttUrl.trim());
      choose(d.video);
    } catch (err) {
      setTtError(err.message);
    } finally {
      setTtBusy(false);
    }
  };

  const switchPlatform = (p) => {
    if (p === platform || ['starting', 'server', 'transfer', 'handoff'].includes(phase)) return;
    setPlatform(p);
    setSelected(null);
    setFailure(null);
    setPhase('idle');
    setJob(null);
  };

  const choose = (v) => {
    if (blockedMinutes(v)) return;
    if (phase === 'server' || phase === 'transfer' || phase === 'handoff' || phase === 'starting') return;
    setSelected(v);
    setFailure(null);
    setPhase('idle');
    setJob(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // ---- Render -------------------------------------------------------------------
  if (!authenticated || !user) {
    return (
      <div className="yt-import">
        <Header t={t} />
        <p className="yt-import__note">{t('ytimport.errors.signIn')}</p>
      </div>
    );
  }

  const busy = ['starting', 'server', 'transfer', 'handoff'].includes(phase);
  const group = groups[activeType];

  // One card in a video grid (YouTube and TikTok share it).
  const renderCard = (v) => {
    const blocked = blockedMinutes(v);
    const onSite = !!status?.imported?.[v.id];
    return (
      <button
        type="button"
        key={v.id}
        className={`yt-import__card${selected?.id === v.id ? ' yt-import__card--selected' : ''}${blocked ? ' yt-import__card--too-long' : ''}`}
        onClick={() => choose(v)}
        disabled={!!blocked || (busy && selected?.id !== v.id)}
        title={blocked ? t('ytimport.tooLong', { minutes: blocked }) : undefined}
      >
        <div className="yt-import__thumb">
          <img src={v.thumbnail} alt="" loading="lazy" />
          {v.duration > 0 && <span className="yt-import__dur">{fmtDuration(v.duration)}</span>}
          {blocked && <span className="yt-import__too-long">{t('ytimport.tooLong', { minutes: blocked })}</span>}
          {onSite && (
            <span className="yt-import__done" title={t('ytimport.onSite')} aria-label={t('ytimport.onSite')}>
              <FaCheck />
            </span>
          )}
        </div>
        <span className="yt-import__title">{v.title}</span>
        {v.publishedAt && <span className="yt-import__muted">{new Date(v.publishedAt).toLocaleDateString()}</span>}
      </button>
    );
  };
  const limitMinutes = status?.limits ? Math.round(status.limits.maxDurationS / 60) : null;
  const serverPct = Math.round(job?.progress || 0);

  return (
    <div className="yt-import">
      <Header t={t} />

      {status?.limits && (
        <p className="yt-import__limits">
          {t('ytimport.limits', { minutes: limitMinutes, height: status.limits.maxHeight })}
          {!status.premium && status.limits.premiumHeight > status.limits.maxHeight && (
            <> {t('ytimport.premiumHint', { height: status.limits.premiumHeight })}</>
          )}
        </p>
      )}
      {statusError && <p className="yt-import__error">{statusError}</p>}
      {!status && !statusError && <div className="yt-import__center"><TailChase size="30" speed="1.75" color="red" /></div>}

      {status && platformTabs.length > 1 && (
        <div className="yt-import__platforms" role="tablist">
          {platformTabs.map(({ key, Icon }) => (
            <button
              type="button"
              role="tab"
              key={key}
              aria-selected={platform === key}
              className={`yt-import__platform${platform === key ? ' yt-import__platform--active' : ''}`}
              onClick={() => switchPlatform(key)}
            >
              <Icon /> {t(`ytimport.platforms.${key}`)}
            </button>
          ))}
        </div>
      )}

      {status && platform === 'tiktok' && (
        !status.links?.tiktok?.length ? (
          <div className="yt-import__empty">
            <p>{t('ytimport.tiktok.noLink')}</p>
            <Link to="/profile" className="yt-import__btn">{t('ytimport.linkChannel')}</Link>
          </div>
        ) : (
          <>
          <div className="yt-import__tabs" role="tablist">
            {['latest', 'link'].map((key) => (
              <button
                type="button"
                role="tab"
                key={key}
                aria-selected={ttTab === key}
                className={`yt-import__tab${ttTab === key ? ' yt-import__tab--active' : ''}`}
                onClick={() => setTtTab(key)}
              >
                {t(key === 'latest' ? 'ytimport.tiktok.latest' : 'ytimport.tiktok.tabLink')}
              </button>
            ))}
          </div>
          {ttTab === 'latest' && (
            <>
              {ttList.error && <p className="yt-import__error">{ttList.error}</p>}
              {ttList.loaded && !ttList.loading && ttList.items.length === 0 && !ttList.error && (
                <p className="yt-import__note">{t('ytimport.tiktok.empty')}</p>
              )}
              <div className={`yt-import__grid${ttList.items.every((v) => v.type === 'shorts') ? ' yt-import__grid--shorts' : ''}`}>
                {ttList.items.map(renderCard)}
              </div>
              {ttList.loading && <div className="yt-import__center"><TailChase size="30" speed="1.75" color="red" /></div>}
            </>
          )}
          {ttTab === 'link' && (
          <form className="yt-import__paste" onSubmit={findTikTok}>
            <label htmlFor="yt-import-tt">{t('ytimport.tiktok.pasteLabel')}</label>
            <div className="yt-import__paste-row">
              <input
                id="yt-import-tt"
                type="url"
                inputMode="url"
                autoComplete="off"
                value={ttUrl}
                onChange={(e) => setTtUrl(e.target.value)}
                placeholder={t('ytimport.tiktok.placeholder')}
                disabled={busy || ttBusy}
              />
              <button type="submit" className="yt-import__btn" disabled={!ttUrl.trim() || busy || ttBusy}>
                {ttBusy ? t('ytimport.tiktok.finding') : t('ytimport.tiktok.find')}
              </button>
            </div>
            {ttError && <p className="yt-import__error">{ttError}</p>}
          </form>
          )}
          </>
        )
      )}

      {status && platform === 'youtube' && status.channels.length === 0 && (
        <div className="yt-import__empty">
          <p>{t('ytimport.noChannel')}</p>
          <Link to="/profile" className="yt-import__btn">{t('ytimport.linkChannel')}</Link>
        </div>
      )}

      {status && platform === 'youtube' && status.channels.length > 1 && (
        <label className="yt-import__channel">
          {t('ytimport.channel')}
          <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={busy}>
            {status.channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      )}

      {selected && (
        <div className="yt-import__panel">
          <img className="yt-import__panel-thumb" src={selected.thumbnail} alt="" />
          <div className="yt-import__panel-body">
            <h2>{selected.title}</h2>
            <p className="yt-import__muted">
              {selected.duration > 0 && <>{fmtDuration(selected.duration)} · </>}
              {selected.publishedAt && <>{new Date(selected.publishedAt).toLocaleDateString()} · </>}
              {selected.platform === 'tiktok' ? (
                <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">{t('ytimport.tiktok.openOn')}</a>
              ) : (
                <a href={youtubeWatchUrl(selected.id)} target="_blank" rel="noopener noreferrer">{t('ytimport.openOnYoutube')}</a>
              )}
            </p>
            {status?.imported?.[selected.id] && (
              <p className="yt-import__on-site">
                <FaCheck /> {t('ytimport.onSite')} ·{' '}
                <Link to={`/watch?v=${user}/${status.imported[selected.id]}`}>{t('ytimport.viewPost')}</Link>
              </p>
            )}

            {phase === 'idle' && (
              <div className="yt-import__actions">
                <button type="button" className="yt-import__btn" onClick={() => startImport(selected)}>
                  {t('ytimport.import')}
                </button>
                <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={() => fileInputRef.current?.click()}>
                  {t('ytimport.useOwnFile')}
                </button>
              </div>
            )}

            {busy && (
              <div className="yt-import__progress">
                <div className="yt-import__bar">
                  <span style={{ width: `${phase === 'transfer' ? Math.round(transfer * 100) : phase === 'handoff' ? 100 : serverPct}%` }} />
                </div>
                <p className="yt-import__muted">
                  {phase === 'starting' && t('ytimport.progress.starting')}
                  {phase === 'server' && t('ytimport.progress.server', { pct: serverPct })}
                  {phase === 'transfer' && t('ytimport.progress.transfer', { pct: Math.round(transfer * 100) })}
                  {phase === 'handoff' && t('ytimport.progress.handoff')}
                </p>
                {(phase === 'server' || phase === 'starting') && (
                  <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={cancel}>
                    {t('ytimport.cancel')}
                  </button>
                )}
              </div>
            )}

            {phase === 'failed' && (
              <div className="yt-import__fallback">
                <p className="yt-import__error">
                  {failure?.code === 'bot_check' ? t('ytimport.errors.blocked') : failure?.message}
                </p>
                <p>{t('ytimport.fallback.intro')}</p>
                {selected.platform === 'tiktok' ? (
                  <ol>
                    <li>{t('ytimport.tiktok.fallbackStep1')}</li>
                    <li>{t('ytimport.tiktok.fallbackStep2')}</li>
                    <li>{t('ytimport.fallback.step3')}</li>
                  </ol>
                ) : (
                  <ol>
                    <li>
                      {t('ytimport.fallback.step1')}{' '}
                      <a href={youtubeStudioUrl(selected.id)} target="_blank" rel="noopener noreferrer">YouTube Studio</a>
                    </li>
                    <li>{t('ytimport.fallback.step2')}</li>
                    <li>{t('ytimport.fallback.step3')}</li>
                  </ol>
                )}
                <div className="yt-import__actions">
                  <button type="button" className="yt-import__btn" onClick={() => fileInputRef.current?.click()}>
                    {t('ytimport.fallback.pickFile')}
                  </button>
                  <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={() => startImport(selected)}>
                    {t('ytimport.retry')}
                  </button>
                </div>
              </div>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={pickOwnFile} />
        </div>
      )}

      {platform === 'youtube' && channel && (
        <>
          <div className="yt-import__tabs" role="tablist">
            {types.map((type) => (
              <button
                type="button"
                role="tab"
                key={type}
                aria-selected={activeType === type}
                className={`yt-import__tab${activeType === type ? ' yt-import__tab--active' : ''}`}
                onClick={() => setActiveType(type)}
              >
                {t(`ytimport.types.${type}`)}
                {groups[type].total != null && <span className="yt-import__count">{groups[type].total}</span>}
              </button>
            ))}
          </div>

          {group.error && <p className="yt-import__error">{group.error}</p>}
          {group.loaded && !group.loading && group.items.length === 0 && !group.error && (
            <p className="yt-import__note">{t(`ytimport.empty.${activeType}`)}</p>
          )}
          <div className={`yt-import__grid${activeType === 'shorts' ? ' yt-import__grid--shorts' : ''}`}>
            {group.items.map(renderCard)}
          </div>
          {(group.loading || !group.loaded) && <div className="yt-import__center"><TailChase size="30" speed="1.75" color="red" /></div>}
          {group.next && !group.loading && (
            <div className="yt-import__center">
              <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={() => loadGroup(activeType, group.next)}>
                {t('ytimport.loadMore')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Header({ t }) {
  return (
    <div className="yt-import__header">
      <h1><FaFileImport className="yt-import__logo" /> {t('ytimport.title')}</h1>
      <p className="yt-import__muted">{t('ytimport.subtitle')}</p>
    </div>
  );
}
