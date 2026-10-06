import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { FaYoutube, FaTiktok, FaInstagram, FaFileImport, FaCheck, FaPlayCircle } from "react-icons/fa";
import { SiRumble } from "react-icons/si";
import { TailChase } from "ldrs/react";
import "ldrs/react/TailChase.css";
import { useAppStore } from "../lib/store";
import { toastIn } from "../utils/toast";
import { BatchForm, BatchStatus } from "./ImportBatch";
import { SHORTS_MAX_DURATION_SEC } from "../utils/config";
import {
  getImportStatus, listChannelVideos, listTikTokVideos, listInstagramVideos, listPlatformVideos, resolveImportUrl, getImportBatches, startImportJob, getImportJob, cancelImportJob,
  downloadImportFile, fetchThumbnailDataUrl, handOffToStudio, youtubeStudioUrl, youtubeWatchUrl,
} from "../lib/youtubeImport";
import "./YoutubeImportPage.scss";

const toast = toastIn('Upload');

// Tab order. Each maps to one of YouTube's per-type upload playlists (server side).
const TYPES = ['videos', 'shorts', 'live'];
const PLATFORM_TABS = [
  { key: 'youtube', Icon: FaYoutube },
  { key: 'tiktok', Icon: FaTiktok },
  { key: 'instagram', Icon: FaInstagram },
  { key: 'rumble', Icon: SiRumble },
  { key: 'bitchute', Icon: FaPlayCircle },
];
// Which platforms fit which uploader: TikTok / Instagram are short-form only,
// BitChute long-form only, YouTube and Rumble have both.
const MODE_PLATFORMS = {
  shorts: ['youtube', 'tiktok', 'instagram', 'rumble'],
  videos: ['youtube', 'rumble', 'bitchute'],
};
// Everything but YouTube: a grid plus a paste-a-link box. TikTok / Instagram list
// only their newest few; BitChute / Rumble page through the whole channel.
// Each loader takes the page number and answers { videos, hasMore? }.
const LINK_PLATFORMS = {
  tiktok: () => listTikTokVideos(),
  instagram: () => listInstagramVideos(),
  bitchute: (page) => listPlatformVideos('bitchute', page),
  rumble: (page) => listPlatformVideos('rumble', page),
};
const emptyLinkList = { items: [], loading: false, loaded: false, error: '', page: 0, hasMore: false };
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
  //   shorts → YouTube Shorts + TikTok + Instagram, always lands in the Shorts studio
  //   videos → YouTube videos + past livestreams, always a regular video
  //   (none, e.g. from the profile) → everything, the type decides.
  const [searchParams] = useSearchParams();
  const mode = ['shorts', 'videos'].includes(searchParams.get('mode')) ? searchParams.get('mode') : null;
  const types = useMemo(() => (mode === 'shorts' ? ['shorts'] : mode === 'videos' ? ['videos', 'live'] : TYPES), [mode]);
  const shortMinutes = Math.round(SHORTS_MAX_DURATION_SEC / 60);
  const { user, authenticated } = useAppStore();

  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [channel, setChannel] = useState('');
  // One list per YouTube upload type, each with its own paging.
  const [groups, setGroups] = useState(emptyGroups);
  const [activeType, setActiveType] = useState(() => types[0]);
  // Which platform the creator imports from. TikTok and Instagram only list the
  // newest few (10 / the 12 newest posts); anything older goes through the paste box.
  const [platform, setPlatform] = useState('youtube');
  const [ttUrl, setTtUrl] = useState('');
  const [ttBusy, setTtBusy] = useState(false);
  const [ttError, setTtError] = useState('');
  const [linkLists, setLinkLists] = useState(() => Object.fromEntries(Object.keys(LINK_PLATFORMS).map((k) => [k, emptyLinkList])));
  const ttList = linkLists[platform] || emptyLinkList;
  // ▶️ Batch import: up to `batchInfo.max` picked videos, imported server side.
  const [picked, setPicked] = useState([]);
  const [batchInfo, setBatchInfo] = useState(null); // { max, spacingMin, granted, batches }
  const [batchFormOpen, setBatchFormOpen] = useState(false);

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
        // No YouTube channel linked: start on whichever other account is.
        if (!s.channels?.length && mode !== 'videos') {
          if (s.links?.tiktok?.length) setPlatform('tiktok');
          else if (s.links?.instagram?.length && s.instagramReady) setPlatform('instagram');
          else if (s.links?.rumble?.length) setPlatform('rumble');
          else if (s.links?.bitchute?.length) setPlatform('bitchute');
        }
      })
      .catch((e) => alive && setStatusError(e.status === 401 ? t('ytimport.errors.signIn') : e.message));
    return () => { alive = false; };
  }, [authenticated, user, t, mode]);

  // Batches: load once, then poll while the newest one is still working.
  const latestBatch = batchInfo?.batches?.[0] || null;
  // Still downloading / uploading: no second batch yet. Waiting to publish: keep
  // polling so the rows turn into "Published", but a new batch may start.
  const batchRunning = !!latestBatch && latestBatch.items.some((it) => ['queued', 'downloading', 'uploading', 'scheduling'].includes(it.status));
  const batchPending = batchRunning || (!!latestBatch && latestBatch.items.some((it) => it.status === 'scheduled'));
  useEffect(() => {
    if (!authenticated || !user) return;
    let alive = true;
    const load = () => getImportBatches().then((d) => alive && setBatchInfo(d)).catch(() => {});
    load();
    // Fast while working; once only waiting for publish slots, once a minute.
    const iv = batchPending ? setInterval(load, batchRunning ? 5000 : 60000) : null;
    return () => { alive = false; if (iv) clearInterval(iv); };
  }, [authenticated, user, batchRunning, batchPending]);
  const showBatch = (b) => setBatchInfo((info) => ({ ...(info || {}), batches: [b, ...((info?.batches || []).filter((x) => x.id !== b.id))] }));
  const batchMax = batchInfo?.max || 5;
  const togglePick = (v) => setPicked((list) => (list.some((x) => x.id === v.id)
    ? list.filter((x) => x.id !== v.id)
    : list.length >= batchMax ? list : [...list, v]));

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

  // Load a platform's list the first time its tab is shown.
  const isLinkPlatform = Object.hasOwn(LINK_PLATFORMS, platform);
  const hasLinkAccount = isLinkPlatform && !!status?.links?.[platform]?.length;
  // Only the platforms that fit the uploader's mode; Instagram shows once the
  // server has its session.
  const platformTabs = PLATFORM_TABS.filter((p) => (!mode || MODE_PLATFORMS[mode].includes(p.key))
    && (!status?.sources || status.sources.includes(p.key))
    && (p.key !== 'instagram' || status?.instagramReady));
  useEffect(() => {
    if (!hasLinkAccount || ttList.loaded || ttList.loading) return;
    const p = platform;
    const set = (v) => setLinkLists((all) => ({ ...all, [p]: v }));
    set({ ...emptyLinkList, loading: true });
    LINK_PLATFORMS[p](0)
      .then((d) => set({ items: d.videos || [], loading: false, loaded: true, error: '', page: 0, hasMore: !!d.hasMore }))
      .catch((e) => set({ ...emptyLinkList, loaded: true, error: e.message }));
  }, [platform, hasLinkAccount, ttList.loaded, ttList.loading]);
  const loadMoreLink = () => {
    const p = platform;
    const cur = linkLists[p];
    if (!cur?.hasMore || cur.loading) return;
    const next = cur.page + 1;
    setLinkLists((all) => ({ ...all, [p]: { ...all[p], loading: true } }));
    LINK_PLATFORMS[p](next)
      .then((d) => setLinkLists((all) => {
        const seen = new Set(all[p].items.map((x) => x.id));
        const more = (d.videos || []).filter((x) => !seen.has(x.id));
        return { ...all, [p]: { ...all[p], items: [...all[p].items, ...more], loading: false, page: next, hasMore: !!d.hasMore } };
      }))
      .catch((e) => setLinkLists((all) => ({ ...all, [p]: { ...all[p], loading: false, error: e.message } })));
  };

  // Instagram's reels tab carries little more than the cover, so each reel's
  // caption, date and length come from its own page: looked up one at a time
  // (the server reads Instagram slowly on purpose), filling the tiles as they come.
  const enrichedRef = useRef(new Set());
  const replaceLinkItem = useCallback((p, v) => {
    setLinkLists((all) => ({ ...all, [p]: { ...all[p], items: all[p].items.map((x) => (x.id === v.id ? v : x)) } }));
    setSelected((cur) => (cur?.id === v.id ? { ...v, enriching: false } : cur));
  }, []);
  const enrichOne = useCallback(async (v) => {
    if (enrichedRef.current.has(v.id)) return null;
    enrichedRef.current.add(v.id);
    try {
      const d = await resolveImportUrl(v.sourceUrl);
      if (d?.video) replaceLinkItem(v.platform, d.video);
      return d?.video || null;
    } catch {
      return null;
    }
  }, [replaceLinkItem]);
  const igItems = linkLists.instagram.items;
  const igLoaded = linkLists.instagram.loaded;
  useEffect(() => {
    if (!igLoaded) return;
    let alive = true;
    (async () => {
      for (const v of igItems) {
        if (!alive) return;
        if (v.publishedAt || enrichedRef.current.has(v.id)) continue;
        await enrichOne(v);
      }
    })();
    return () => { alive = false; };
    // Runs once per loaded list; replacing items must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [igLoaded, enrichOne]);

  // ---- Import flow ------------------------------------------------------------
  // `media` = what the server measured on the downloaded file (absent when the
  // creator picked their own file).
  const finish = useCallback(async (file, video, media = null) => {
    setPhase('handoff');
    // A Short becomes a 3Speak Short when it fits our length limit; a longer one
    // (YouTube Shorts go up to 3 minutes, TikToks far longer) goes in as a normal
    // video. TikTok gives no length up front, so an unmeasured portrait TikTok (or
    // Instagram reel) is sent as a Short and the studio re-checks the real length.
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
        : portrait && (duration > 0 ? duration <= SHORTS_MAX_DURATION_SEC : video.platform !== 'youtube');
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
    setTtUrl('');
    setTtError('');
    setSelected(null);
    setFailure(null);
    setPhase('idle');
    setJob(null);
  };

  const choose = (v) => {
    if (blockedMinutes(v)) return;
    if (phase === 'server' || phase === 'transfer' || phase === 'handoff' || phase === 'starting') return;
    // Instagram's reels tab has no caption/date: look the pick up first. (Rumble
    // lists have everything but the description, which the server fills in later.)
    const bare = v.platform === 'instagram' && !v.publishedAt && !enrichedRef.current.has(v.id);
    setSelected(bare ? { ...v, enriching: true } : v);
    setFailure(null);
    setPhase('idle');
    setJob(null);
    if (bare) enrichOne(v).then((full) => { if (!full) setSelected((cur) => (cur?.id === v.id ? { ...cur, enriching: false } : cur)); });
    // The picked tile opens across its row; keep it in view.
    requestAnimationFrame(() => document.getElementById(`yt-import-card-${v.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
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

  // The import controls of the picked video; they live inside its tile.
  const renderPanel = (v) => (
    <div className="yt-import__card-panel">
      <p className="yt-import__muted">
        {v.duration > 0 && <>{fmtDuration(v.duration)} · </>}
        {v.publishedAt && <>{new Date(v.publishedAt).toLocaleDateString()} · </>}
        {v.platform !== 'youtube' ? (
          <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer">{t(`ytimport.${v.platform}.openOn`)}</a>
        ) : (
          <a href={youtubeWatchUrl(v.id)} target="_blank" rel="noopener noreferrer">{t('ytimport.openOnYoutube')}</a>
        )}
      </p>
      {status?.imported?.[v.id] && (
        <p className="yt-import__on-site">
          <FaCheck /> {t('ytimport.onSite')} ·{' '}
          <Link to={`/watch?v=${user}/${status.imported[v.id]}`}>{t('ytimport.viewPost')}</Link>
        </p>
      )}

      {phase === 'idle' && (
        <div className="yt-import__actions">
          <button type="button" className="yt-import__btn" onClick={() => startImport(v)} disabled={v.enriching}>
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
          {v.platform !== 'youtube' ? (
            <ol>
              <li>{t(`ytimport.${v.platform}.fallbackStep1`)}</li>
              <li>{t(`ytimport.${v.platform}.fallbackStep2`)}</li>
              <li>{t('ytimport.fallback.step3')}</li>
            </ol>
          ) : (
            <ol>
              <li>
                {t('ytimport.fallback.step1')}{' '}
                <a href={youtubeStudioUrl(v.id)} target="_blank" rel="noopener noreferrer">YouTube Studio</a>
              </li>
              <li>{t('ytimport.fallback.step2')}</li>
              <li>{t('ytimport.fallback.step3')}</li>
            </ol>
          )}
          <div className="yt-import__actions">
            <button type="button" className="yt-import__btn" onClick={() => fileInputRef.current?.click()}>
              {t('ytimport.fallback.pickFile')}
            </button>
            <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={() => startImport(v)}>
              {t('ytimport.retry')}
            </button>
          </div>
        </div>
      )}
    </div>
  );

  // One tile in a video grid (YouTube, TikTok and Instagram share it). The picked
  // tile opens across its row with the import controls next to the cover.
  const renderCard = (v) => {
    const blocked = blockedMinutes(v);
    const onSite = !!status?.imported?.[v.id];
    const isSelected = selected?.id === v.id;
    const isPicked = picked.some((x) => x.id === v.id);
    // The selected copy can be fresher (details looked up after the pick).
    const shown = isSelected ? { ...v, ...selected } : v;
    return (
      <div
        key={v.id}
        id={`yt-import-card-${v.id}`}
        className={`yt-import__card${isSelected ? ' yt-import__card--selected' : ''}${blocked ? ' yt-import__card--too-long' : ''}${isPicked ? ' yt-import__card--picked' : ''}`}
      >
        <button
          type="button"
          className="yt-import__pick"
          onClick={() => choose(v)}
          disabled={!!blocked || (busy && !isSelected)}
          title={blocked ? t('ytimport.tooLong', { minutes: blocked }) : undefined}
        >
          <div className="yt-import__thumb">
            <img src={shown.thumbnail} alt="" loading="lazy" />
            {shown.duration > 0 && <span className="yt-import__dur">{fmtDuration(shown.duration)}</span>}
            {blocked && <span className="yt-import__too-long">{t('ytimport.tooLong', { minutes: blocked })}</span>}
            {onSite && (
              <span className="yt-import__done" title={t('ytimport.onSite')} aria-label={t('ytimport.onSite')}>
                <FaCheck />
              </span>
            )}
          </div>
          <span className="yt-import__title">{shown.title}</span>
          {shown.publishedAt && <span className="yt-import__muted">{new Date(shown.publishedAt).toLocaleDateString()}</span>}
        </button>
        {!blocked && (
          <button
            type="button"
            className={`yt-import__tick${isPicked ? ' is-on' : ''}`}
            onClick={() => togglePick(shown)}
            disabled={!isPicked && picked.length >= batchMax}
            aria-pressed={isPicked}
            aria-label={t('ytimport.batch.select')}
            title={!isPicked && picked.length >= batchMax ? t('ytimport.batch.maxReached', { max: batchMax }) : t('ytimport.batch.select')}
          >
            {isPicked && <FaCheck />}
          </button>
        )}
        {isSelected && renderPanel(shown)}
      </div>
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
      {latestBatch && <BatchStatus batch={latestBatch} user={user} onChange={showBatch} />}
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

      {status && isLinkPlatform && (
        !hasLinkAccount ? (
          <div className="yt-import__empty">
            <p>{t(`ytimport.${platform}.noLink`)}</p>
            <Link to="/profile" className="yt-import__btn">{t('ytimport.linkChannel')}</Link>
          </div>
        ) : (
          <>
          <form className="yt-import__paste yt-import__paste--card" onSubmit={findTikTok}>
            <label htmlFor="yt-import-tt">{t(`ytimport.${platform}.pasteLabel`)}</label>
            <p className="yt-import__note">{t(`ytimport.${platform}.pasteHint`)}</p>
            <div className="yt-import__paste-row">
              <input
                id="yt-import-tt"
                type="url"
                inputMode="url"
                autoComplete="off"
                value={ttUrl}
                onChange={(e) => setTtUrl(e.target.value)}
                placeholder={t(`ytimport.${platform}.placeholder`)}
                disabled={busy || ttBusy}
              />
              <button type="submit" className="yt-import__btn" disabled={!ttUrl.trim() || busy || ttBusy}>
                {ttBusy ? t(`ytimport.${platform}.finding`) : t(`ytimport.${platform}.find`)}
              </button>
            </div>
            {ttError && <p className="yt-import__error">{ttError}</p>}
          </form>
          <h3 className="yt-import__section">{t(`ytimport.${platform}.latest`)}</h3>
          {ttList.error && <p className="yt-import__error">{ttList.error}</p>}
          {ttList.loaded && !ttList.loading && ttList.items.length === 0 && !ttList.error && (
            <p className="yt-import__note">{t(`ytimport.${platform}.empty`)}</p>
          )}
          <div className={`yt-import__grid${ttList.items.every((v) => v.type === 'shorts') ? ' yt-import__grid--shorts' : ''}`}>
            {ttList.items.map(renderCard)}
          </div>
          {ttList.loading && <div className="yt-import__center"><TailChase size="30" speed="1.75" color="red" /></div>}
          {ttList.hasMore && !ttList.loading && (
            <div className="yt-import__center">
              <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={loadMoreLink}>{t('ytimport.loadMore')}</button>
            </div>
          )}
          {ttList.items.length > 0 && (
            <p className="yt-import__note yt-import__more-hint">
              {t(`ytimport.${platform}.olderHint`)}{' '}
              <button type="button" className="yt-import__linkbtn" onClick={() => document.getElementById('yt-import-tt')?.focus()}>
                {t(`ytimport.${platform}.olderHintAction`)}
              </button>
            </p>
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

      <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={pickOwnFile} />

      {picked.length > 0 && (
        <div className="yt-batch-bar" role="region" aria-label={t('ytimport.batch.selectedCount', { count: picked.length })}>
          <span>{t('ytimport.batch.selectedCount', { count: picked.length })} · {t('ytimport.batch.maxHint', { max: batchMax })}</span>
          <div className="yt-batch-bar__actions">
            <button type="button" className="yt-import__btn yt-import__btn--outline" onClick={() => setPicked([])}>{t('ytimport.batch.clear')}</button>
            <button type="button" className="yt-import__btn" onClick={() => setBatchFormOpen(true)} disabled={batchRunning}
              title={batchRunning ? t('ytimport.batch.busy') : undefined}>
              {t('ytimport.batch.importSelected', { count: picked.length })}
            </button>
          </div>
        </div>
      )}
      {batchFormOpen && (
        <BatchForm
          user={user}
          videos={picked}
          spacingMin={batchInfo?.spacingMin || 30}
          granted={batchInfo?.granted !== false}
          onGranted={(ok = true) => setBatchInfo((info) => ({ ...(info || {}), granted: ok }))}
          onClose={() => setBatchFormOpen(false)}
          onStarted={(b) => { showBatch(b); setPicked([]); setBatchFormOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
        />
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
