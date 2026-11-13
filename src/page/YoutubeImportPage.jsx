import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Banner, Button, Icon, Progress, Segmented } from "../components/v2/ui";
import { useAppStore } from "../lib/store";
import { toastIn } from "../utils/toast";
import { BatchForm, BatchStatus } from "./ImportBatch";
import { SHORTS_MAX_DURATION_SEC, ENABLE_SUBS } from "../utils/config";
import {
  IMPORT_MODE_PLATFORMS, getImportStatus, listChannelVideos, listTikTokVideos, listInstagramVideos, listPlatformVideos, resolveImportUrl, getImportBatches, startImportJob, getImportJob, cancelImportJob,
  downloadImportFile, fetchThumbnailDataUrl, handOffToStudio, youtubeStudioUrl, youtubeWatchUrl, fmtDuration, refreshImportLists,
} from "../lib/youtubeImport";
import "./YoutubeImportPage.scss";

const toast = toastIn('Upload');

// Tab order. Each maps to one of YouTube's per-type upload playlists (server side).
const TYPES = ['videos', 'shorts', 'live'];
// Material Symbols per platform (33c): no brand logos, one icon set.
const PLATFORM_TABS = [
  { key: 'youtube', icon: 'smart_display' },
  { key: 'tiktok', icon: 'music_note' },
  { key: 'instagram', icon: 'photo_camera' },
  { key: 'bitchute', icon: 'play_circle' },
  { key: 'rumble', icon: 'live_tv' },
];
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
  // Already on 3Speak (source id → permlink) and still waiting in a batch: the
  // server's view (Hive + batches), plus the batches on this page, which change
  // sooner than a status reload.
  const { importedMap, inBatch } = useMemo(() => {
    const imported = { ...(status?.imported || {}) };
    const waiting = { ...(status?.inBatch || {}) };
    for (const b of batchInfo?.batches || []) {
      for (const it of b.items) {
        if (it.status === 'posted' && it.permlink) { imported[it.sourceId] = it.permlink; delete waiting[it.sourceId]; }
        else if (['queued', 'downloading', 'uploading', 'scheduling', 'scheduled'].includes(it.status)) waiting[it.sourceId] = it;
      }
    }
    return { importedMap: imported, inBatch: waiting };
  }, [status, batchInfo]);

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

  // "Refresh lists" bumps this to load every list again.
  const [listsKey, setListsKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState('');

  // The first page of every shown type at once, so each tab shows its count right away.
  useEffect(() => {
    setGroups(emptyGroups());
    if (channel) types.forEach((type) => loadGroup(type));
  }, [channel, loadGroup, types, listsKey]);

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
  const platformTabs = PLATFORM_TABS.filter((p) => (!mode || IMPORT_MODE_PLATFORMS[mode].includes(p.key))
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
  // All linked channels on every platform are read again: new and newly public
  // videos show up. YouTube's tabs reload now and once more when the server has
  // gone through the whole channel (an old video keeps its old place in it); the
  // other platforms reload when their tab is shown.
  const refreshLists = async () => {
    setRefreshing(true);
    setRefreshNote('');
    try {
      await refreshImportLists();
      setLinkLists(Object.fromEntries(Object.keys(LINK_PLATFORMS).map((k) => [k, emptyLinkList])));
      setListsKey((n) => n + 1);
      if (channel) {
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          const d = await listChannelVideos({ channel, type: types[0] }).catch(() => null);
          if (!d || d.total != null) break; // total stays null while the channel is being read
        }
        setListsKey((n) => n + 1);
      }
    } catch (e) {
      setRefreshNote(e.code === 'refresh_too_soon' ? t('ytimport.refreshTooSoon') : e.message);
    } finally {
      setRefreshing(false);
    }
  };

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
        <Header t={t} sub />
        <Banner tone="info" className="yt-import__signin">{t('ytimport.errors.signIn')}</Banner>
      </div>
    );
  }

  const busy = ['starting', 'server', 'transfer', 'handoff'].includes(phase);
  const group = groups[activeType];

  // Couldn't fetch it: what went wrong, the manual-download steps and the file
  // pick (33c). Inside the opened tile, and on wide screens as its own card in
  // the side column (CSS shows one of the two).
  const renderFallback = (v, card = false) => (
    <div className={card ? 'yt-import__fallback yt-import__fallback--card' : 'yt-import__fallback'}>
      {card && <h3 className="yt-import__fallback-title">{t('ytimport.fallback.title')}</h3>}
      <p className="yt-import__error" role={card ? undefined : 'alert'}>
        {failure?.code === 'bot_check' ? t('ytimport.errors.blocked')
          : failure?.code === 'proxy_paused' ? t('ytimport.errors.proxyPaused')
            : failure?.message}
      </p>
      <p className="yt-import__muted">{t('ytimport.fallback.intro')}</p>
      {v.platform !== 'youtube' ? (
        <ol className="yt-import__steps">
          <li><span className="num">1</span><span>{t(`ytimport.${v.platform}.fallbackStep1`)}</span></li>
          <li><span className="num">2</span><span>{t(`ytimport.${v.platform}.fallbackStep2`)}</span></li>
          <li><span className="num">3</span><span>{t('ytimport.fallback.step3')}</span></li>
        </ol>
      ) : (
        <ol className="yt-import__steps">
          <li>
            <span className="num">1</span>
            <span>
              {t('ytimport.fallback.step1')}{' '}
              <a href={youtubeStudioUrl(v.id)} target="_blank" rel="noopener noreferrer">YouTube Studio</a>
            </span>
          </li>
          <li><span className="num">2</span><span>{t('ytimport.fallback.step2')}</span></li>
          <li><span className="num">3</span><span>{t('ytimport.fallback.step3')}</span></li>
        </ol>
      )}
      <div className="yt-import__actions">
        <Button variant="inverse" size={48} trailing="upload_file" className="is-next" onClick={() => fileInputRef.current?.click()}>
          {t('ytimport.fallback.pickFile')}
        </Button>
        <Button variant="secondary" size={48} icon="refresh" onClick={() => startImport(v)}>
          {t('ytimport.retry')}
        </Button>
      </div>
    </div>
  );

  // The import controls of the picked video; they live inside its tile.
  const renderPanel = (v) => (
    <div className="yt-import__card-panel">
      <p className="yt-import__muted">
        {v.duration > 0 && <><span className="num">{fmtDuration(v.duration)}</span> · </>}
        {v.publishedAt && <>{new Date(v.publishedAt).toLocaleDateString()} · </>}
        {v.platform !== 'youtube' ? (
          <a href={v.sourceUrl} target="_blank" rel="noopener noreferrer">{t(`ytimport.${v.platform}.openOn`)}</a>
        ) : (
          <a href={youtubeWatchUrl(v.id)} target="_blank" rel="noopener noreferrer">{t('ytimport.openOnYoutube')}</a>
        )}
      </p>
      {importedMap[v.id] && (
        <p className="yt-import__on-site">
          <Icon name="check_circle" size={16} /> {t('ytimport.onSite')} ·{' '}
          <Link to={`/@${user}/${importedMap[v.id]}`}>{t('ytimport.viewPost')}</Link>
        </p>
      )}
      {!importedMap[v.id] && inBatch[v.id] && (
        <p className="yt-import__on-site yt-import__on-site--waiting"><Icon name="schedule" size={16} /> {t('ytimport.inBatch')}</p>
      )}

      {phase === 'idle' && (
        <div className="yt-import__actions">
          <Button variant="primary" size={44} trailing="download" className="is-next" onClick={() => startImport(v)} disabled={v.enriching}>
            {t('ytimport.import')}
          </Button>
          <Button variant="secondary" size={44} icon="upload_file" onClick={() => fileInputRef.current?.click()}>
            {t('ytimport.useOwnFile')}
          </Button>
        </div>
      )}

      {busy && (
        <div className="yt-import__progress">
          <Progress
            tone="cyan"
            label={t('ytimport.import')}
            value={phase === 'transfer' ? Math.round(transfer * 100) : phase === 'handoff' ? 100 : serverPct}
          />
          <p className="yt-import__muted yt-import__progress-line">
            <Icon name="progress_activity" size={16} className="v2-spin" />
            {phase === 'starting' && t('ytimport.progress.starting')}
            {phase === 'server' && t('ytimport.progress.server', { pct: serverPct })}
            {phase === 'transfer' && t('ytimport.progress.transfer', { pct: Math.round(transfer * 100) })}
            {phase === 'handoff' && t('ytimport.progress.handoff')}
          </p>
          {(phase === 'server' || phase === 'starting') && (
            <div className="yt-import__actions">
              <Button variant="secondary" size={40} icon="close" onClick={cancel}>
                {t('ytimport.cancel')}
              </Button>
            </div>
          )}
        </div>
      )}

      {phase === 'failed' && renderFallback(v)}
    </div>
  );

  // One tile in a video grid (YouTube, TikTok and Instagram share it). The picked
  // tile opens across its row with the import controls next to the cover.
  const renderCard = (v) => {
    const blocked = blockedMinutes(v);
    const onSite = !!importedMap[v.id];
    // Never twice in a batch: these cannot be ticked (the server refuses them too).
    const waiting = !onSite && !!inBatch[v.id];
    const tickBlocked = onSite || waiting;
    const isSelected = selected?.id === v.id;
    const isPicked = picked.some((x) => x.id === v.id);
    // The selected copy can be fresher (details looked up after the pick).
    const shown = isSelected ? { ...v, ...selected } : v;
    // 33c: a tile that cannot go in a batch says why in a chip under its title.
    const tag = onSite ? t('ytimport.onSite')
      : blocked ? t('ytimport.tooLong', { minutes: blocked })
        : waiting ? t('ytimport.inBatch')
          : null;
    return (
      <div
        key={v.id}
        id={`yt-import-card-${v.id}`}
        className={`yt-import__card${isSelected ? ' yt-import__card--selected' : ''}${blocked ? ' yt-import__card--too-long' : ''}${isPicked ? ' yt-import__card--picked' : ''}${tag && !isSelected ? ' yt-import__card--tagged' : ''}`}
      >
        <button
          type="button"
          className="yt-import__pick"
          onClick={() => choose(v)}
          disabled={!!blocked || (busy && !isSelected)}
          title={blocked ? t('ytimport.tooLong', { minutes: blocked }) : undefined}
        >
          <div className="yt-import__thumb">
            {/* A cover that cannot be loaded leaves the striped tile, not a broken image. */}
            <img src={shown.thumbnail} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
            {shown.duration > 0 && <span className="yt-import__dur num">{fmtDuration(shown.duration)}</span>}
          </div>
          <span className="yt-import__title">{shown.title}</span>
          {tag && <span className={`yt-import__tag${onSite ? ' is-done' : ''}`}>{tag}</span>}
        </button>
        {!blocked && !tickBlocked && (
          <button
            type="button"
            className={`yt-import__tick${isPicked ? ' is-on' : ''}`}
            onClick={() => togglePick(shown)}
            disabled={!isPicked && picked.length >= batchMax}
            aria-pressed={isPicked}
            aria-label={t('ytimport.batch.select')}
            title={!isPicked && picked.length >= batchMax ? t('ytimport.batch.maxReached', { max: batchMax }) : t('ytimport.batch.select')}
          >
            {isPicked && <Icon name="check" size={16} />}
          </button>
        )}
        {isSelected && renderPanel(shown)}
      </div>
    );
  };
  const limitMinutes = status?.limits ? Math.round(status.limits.maxDurationS / 60) : null;
  const serverPct = Math.round(job?.progress || 0);
  const spinner = (
    <div className="yt-import__center" role="status" aria-label={t('common.status.loading')}>
      <Icon name="progress_activity" size={28} className="v2-spin" />
    </div>
  );
  // A failed import also shows its way out in the side column (33c).
  const fallbackAside = phase === 'failed' && !!selected;
  // A platform is "linked" when the creator has an account on it to list from.
  const isLinked = (key) => (key === 'youtube' ? !!status?.channels?.length : !!status?.links?.[key]?.length);

  return (
    <div className={`yt-import${latestBatch || fallbackAside ? ' has-batch' : ''}${fallbackAside ? ' has-fallback' : ''}`}>
      <div className="yt-import__main">
        <Header
          t={t}
          action={status && (
            <Button
              variant="secondary"
              icon="refresh"
              className={`yt-import__refresh${refreshing ? ' is-busy' : ''}`}
              onClick={refreshLists}
              disabled={refreshing || busy}
              title={t('ytimport.refreshHint')}
            >
              {refreshing ? t('ytimport.refreshing') : t('ytimport.refresh')}
            </Button>
          )}
        />

        {statusError && <p className="yt-import__error" role="alert">{statusError}</p>}
        {!status && !statusError && spinner}

        {status && platformTabs.length > 1 && (
          <div className="yt-import__platforms" role="tablist">
            {platformTabs.map(({ key, icon }) => (
              <button
                type="button"
                role="tab"
                key={key}
                aria-selected={platform === key}
                className={`yt-import__platform${platform === key ? ' yt-import__platform--active' : ''}`}
                onClick={() => switchPlatform(key)}
              >
                <span className="yt-import__platform-icon"><Icon name={icon} size={18} /></span>
                {t(`ytimport.platforms.${key}`)}
                {isLinked(key) && <Icon name="check_circle" size={16} className="yt-import__platform-linked" />}
              </button>
            ))}
          </div>
        )}
        {refreshNote && <p className="yt-import__note yt-import__refresh-note">{refreshNote}</p>}

        {status && isLinkPlatform && (
          !hasLinkAccount ? (
            <div className="yt-import__empty v2-empty">
              <Icon name="link_off" size={28} />
              <p>{t(`ytimport.${platform}.noLink`)}</p>
              <Button as={Link} to="/profile" variant="secondary" icon="add_link">{t('ytimport.linkChannel')}</Button>
            </div>
          ) : (
            <>
            <form className="yt-import__paste yt-import__paste--card" onSubmit={findTikTok}>
              <label className="v2-eyebrow" htmlFor="yt-import-tt">{t(`ytimport.${platform}.pasteLabel`)}</label>
              <div className="yt-import__paste-row">
                <div className="yt-import__paste-field">
                  <Icon name="link" size={18} />
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
                </div>
                <Button type="submit" variant="cyan" size={48} trailing="search" loading={ttBusy} disabled={!ttUrl.trim() || busy || ttBusy}>
                  {ttBusy ? t(`ytimport.${platform}.finding`) : t(`ytimport.${platform}.find`)}
                </Button>
              </div>
              <p className="v2-field__hint">{t(`ytimport.${platform}.pasteHint`)}</p>
              {ttError && <p className="yt-import__error" role="alert">{ttError}</p>}
            </form>
            <h3 className="yt-import__section">{t(`ytimport.${platform}.latest`)}</h3>
            {ttList.error && <p className="yt-import__error" role="alert">{ttList.error}</p>}
            {ttList.loaded && !ttList.loading && ttList.items.length === 0 && !ttList.error && (
              <p className="yt-import__note">{t(`ytimport.${platform}.empty`)}</p>
            )}
            <div className={`yt-import__grid${ttList.items.every((v) => v.type === 'shorts') ? ' yt-import__grid--shorts' : ''}`}>
              {ttList.items.map(renderCard)}
            </div>
            {ttList.loading && spinner}
            {ttList.hasMore && !ttList.loading && (
              <div className="yt-import__center">
                <Button variant="secondary" icon="expand_more" onClick={loadMoreLink}>{t('ytimport.loadMore')}</Button>
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

        {/* Out of proxy traffic: the server refuses YouTube downloads until a top-up. */}
        {status?.proxyPaused && platform === 'youtube' && (
          <Banner tone="warn" className="yt-import__paused">{t('ytimport.errors.proxyPaused')}</Banner>
        )}

        {status && platform === 'youtube' && status.channels.length === 0 && (
          <div className="yt-import__empty v2-empty">
            <Icon name="link_off" size={28} />
            <p>{t('ytimport.noChannel')}</p>
            <Button as={Link} to="/profile" variant="secondary" icon="add_link">{t('ytimport.linkChannel')}</Button>
          </div>
        )}

        {status && platform === 'youtube' && status.channels.length > 1 && (
          <label className="yt-import__channel v2-field">
            <span className="v2-eyebrow">{t('ytimport.channel')}</span>
            <select className="v2-input is-select" value={channel} onChange={(e) => setChannel(e.target.value)} disabled={busy}>
              {status.channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        )}

        <input ref={fileInputRef} type="file" accept="video/*" hidden onChange={pickOwnFile} />

        {platform === 'youtube' && channel && (
          <>
            <Segmented
              className="yt-import__tabs"
              block={false}
              scroll
              value={activeType}
              onChange={setActiveType}
              options={types.map((type) => ({
                value: type,
                label: t(`ytimport.types.${type}`),
                count: groups[type].total != null ? groups[type].total : undefined,
              }))}
            />

            {group.error && <p className="yt-import__error" role="alert">{group.error}</p>}
            {group.loaded && !group.loading && group.items.length === 0 && !group.error && (
              <p className="yt-import__note">{t(`ytimport.empty.${activeType}`)}</p>
            )}
            <div className={`yt-import__grid${activeType === 'shorts' ? ' yt-import__grid--shorts' : ''}`}>
              {group.items.map(renderCard)}
            </div>
            {(group.loading || !group.loaded) && spinner}
            {group.next && !group.loading && (
              <div className="yt-import__center">
                <Button variant="secondary" icon="expand_more" onClick={() => loadGroup(activeType, group.next)}>
                  {t('ytimport.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}

        {status?.limits && (
          <div className="yt-import__limits">
            <Icon name="info" size={20} />
            <span>
              {t('ytimport.limits', { minutes: limitMinutes, height: status.limits.maxHeight })}
              {!status.premium && status.limits.premiumHeight > status.limits.maxHeight && (
                <>{' '}{t('ytimport.premiumHint', { height: status.limits.premiumHeight })}</>
              )}
            </span>
            {!status.premium && status.limits.premiumHeight > status.limits.maxHeight && ENABLE_SUBS && user && (
              <Link to={`/wallet/${user}#pro`} className="yt-import__pro">
                {t('ytimport.getPro')}
              </Link>
            )}
          </div>
        )}

        {picked.length > 0 && (
          <div className="yt-batch-bar" role="region" aria-label={t('ytimport.batch.selectedCount', { count: picked.length })}>
            <span className="yt-batch-bar__count">
              <b className="num">{t('ytimport.batch.selectedCount', { count: picked.length })}</b> · {t('ytimport.batch.maxHint', { max: batchMax })}
            </span>
            <div className="yt-batch-bar__actions">
              <Button variant="ghost" size={40} onClick={() => setPicked([])}>{t('ytimport.batch.clear')}</Button>
              <Button variant="cyan" size={40} trailing="download" onClick={() => setBatchFormOpen(true)} disabled={batchRunning}
                title={batchRunning ? t('ytimport.batch.busy') : undefined}>
                {t('ytimport.batch.importSelected', { count: picked.length })}
              </Button>
            </div>
          </div>
        )}
      </div>

      {(latestBatch || fallbackAside) && (
        <aside className={`yt-import__aside${latestBatch ? '' : ' is-fallback-only'}`}>
          {latestBatch && <BatchStatus batch={latestBatch} user={user} onChange={showBatch} />}
          {fallbackAside && renderFallback(selected, true)}
        </aside>
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
    </div>
  );
}

// 33c: the title and Refresh lists; the line under the title only for the
// signed-out view, where it is all there is.
function Header({ t, action = null, sub = false }) {
  return (
    <div className="yt-import__header">
      <div className="yt-import__header-text">
        <h1>{t('ytimport.title')}</h1>
        {sub && <p className="yt-import__muted">{t('ytimport.subtitle')}</p>}
      </div>
      {action}
    </div>
  );
}
