import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { getHiveClient } from '../utils/hiveNode';
import './Watch.scss';
import './WatchV2.scss';
import PlayVideo from '../components/playVideo/PlayVideo';
import SEOHead from '../components/SEOHead';
import Card3 from '../components/Cards/Card3';
import { useContentBatch } from '../hooks/useContentBatch';
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchVideoDetails, fetchPlaySource, fetchTrendingFeed, fetchAuthorVideos, fetchRelatedFeed } from '../lib/videoData';
// BarLoader is intentionally not imported: this page renders immediately rather
// than blocking on the post-metadata query (see the note above the render return).
import { useAppStore } from '../lib/store';
import { hasConsent } from '../lib/consent';
import { recordWatch, batchCheckWatched } from '../utils/watchHistory';
import { Client } from '@hiveio/dhive';
import { HIVE_API_NODES, SHORTS_API_URL, appendNsfw } from '../utils/config';
import { getPlayerUrl } from '../utils/playerUrl';
import ShortsRow from '../components/ShortsRow/ShortsRow';
import { useGridColumns, useShortsPerRow } from '../hooks/useGridMetrics';
import { useStreamChatMirror } from '../hooks/useStreamChatMirror';
import { getFeedSeed } from '../utils/feedSeed';
import ReactionPlayer from '../components/ReactionPlayer/ReactionPlayer';
import WatchTabs from '../components/playVideo/WatchTabs';
import { MdVideocam, MdChatBubble } from 'react-icons/md';
import { batchGetReputations, LOW_REP_THRESHOLD } from '../utils/reputation';
import { batchCheckHidden, isCreatorHidden } from '../utils/hiddenCreators';
import { usePlayer } from '@mantequilla-soft/3speak-player/react';
import { createAdBreak } from '../lib/adBreak';
import AdOverlay from '../components/ads/AdOverlay';
import AdSkip from '../components/ads/AdSkip';
import BannerClick from '../components/ads/BannerClick';

// How long before a break the countdown appears. Three seconds is enough to register
// without becoming its own distraction.
const AD_COUNTDOWN_FROM = 3;
import { useGatedPlayback } from '../hooks/useGatedPlayback';
import GuestListEditor from '../components/gated/GuestListEditor';
import { ThreeSpeakApi } from '@mantequilla-soft/3speak-player';
import { resolveVideoMeta } from '../lib/videoMetaCache';
import { fixVideoThumbnail } from '../utils/fixThumbnails';
import { reportVideoUnavailable } from '../lib/reportUnavailable';
import { useDeadVideos, videoKey } from '../lib/deadVideos';
import { notifyMediaPlay, onMediaPlay } from '../utils/mediaCoordinator';
import AmbientGlow, { useAmbientGlow } from '../components/AmbientGlow/AmbientGlow';
import useSubtitles from '../hooks/useSubtitles';
import useWatchDuration from '../hooks/useWatchDuration';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { fetchScheduledPost, getScheduledEmbedRef } from '../utils/scheduledPosts';
import EditScheduledModal from '../components/modal/EditScheduledModal';
import { getHiveRenderer } from '../lib/hiveRenderer';

// Stable identity so `related?.videos || EMPTY_LIST` doesn't hand a NEW [] to the
// memo on every render.
const EMPTY_LIST = [];

// A shorts rail every N rows of recommendations. The sidebar is a ONE-column grid,
// so N here is literally "every N recommended videos" — 3 keeps the rail present
// without letting it out-number the videos it's sitting between.
const WATCH_ROWS_PER_SHORTS_RAIL = 3;
const WATCH_SHORTS_LIMIT = 30;
// Keeps the watch rail from being the same shorts, in the same order, as the home
// feed's rails within one session.
const WATCH_SHORTS_SEED_OFFSET = 4231;

// Build the videoDetails shape PlayVideo expects from a checker scheduled-post
// doc (the post isn't on Hive yet, so there are no stats/payout/votes).
function buildScheduledVideoDetails(doc) {
  if (!doc) return null;
  return {
    title: doc.title || '',
    body: doc.body || doc.description || '',
    author: {
      id: doc.owner,
      username: doc.owner,
      profile: { name: doc.owner, images: { avatar: `https://images.hive.blog/u/${doc.owner}/avatar/small` } },
    },
    stats: { num_comments: 0, num_votes: 0, total_hive_reward: 0 },
    community: doc.parentPermlink ? { _id: doc.parentPermlink, title: doc.parentPermlink } : null,
    created_at: doc.createdAt,
    tags: Array.isArray(doc.tags) ? doc.tags : (doc.jsonMetadata?.tags || []),
    parent_permlink: doc.parentPermlink,
    spkvideo: { play_url: null, thumbnail_url: doc.thumbnail || null, duration: 0 },
    _scheduled: true,
    scheduledOn: doc.scheduledOn,
  };
}

const hiveClient = getHiveClient();

// Number of author videos to show at the top of recommendations
const AUTHOR_VIDEOS_COUNT = 4;
const QUALITY_STORAGE_KEY = '3speak-quality-pref';

// Drop videos whose asset is gone. Everything here comes from the checker, and it
// returns TWO shapes: embed docs are normalised by the discover pool's hydrate()
// (`created_at` + `spkvideo.play_url`), while legacy docs are passed through raw
// (`created` + `video_v2`). This filter only understood the embed shape — a
// leftover from the retired union GraphQL API — so it silently discarded ~95% of
// the related feed (23 of 24 for a typical video). The sidebar was then left with
// too few results and fell back to TRENDING, which is what put unrelated topics
// (e.g. gaming) next to an art/music video. Accept both shapes.
//
// No date cutoff here on purpose: video age is a single policy owned by the
// checker (FEED_MAX_AGE_YEARS). A second, stricter cutoff in the frontend just
// re-created the same bug by starving the list.
function filterValidVideos(videos) {
  if (!videos || !Array.isArray(videos)) return [];
  return videos.filter((video) => {
    if (!video) return false;
    if (!(video.created_at || video.created)) return false;
    // Playable? embed → spkvideo.play_url, legacy → video_v2.
    return Boolean(video?.spkvideo?.play_url || video?.video_v2 || video?.playUrl);
  });
}

function Watch({ v2 = false }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, watchHistoryEnabled, setMiniPlayer, clearMiniPlayer, showNsfw, inlineShorts } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const v = searchParams.get('v'); // Extract the "v" query parameter
  const playlistId = searchParams.get('playlist');
  const posParam = searchParams.get('pos');
  const [author, permlink] = (v ?? 'unknown/unknown').split('/');

  // Scheduled mode: the post isn't on Hive yet, so we load it from the checker
  // and play it via its embed asset instead of the Hive/GraphQL path. Set by the
  // profile card link (`&scheduled=1`).
  const scheduled = searchParams.get('scheduled') === '1';
  const [scheduledDoc, setScheduledDoc] = useState(null);
  const [scheduledLoading, setScheduledLoading] = useState(scheduled);
  const [scheduledEditOpen, setScheduledEditOpen] = useState(false);
  // Bumped after an in-place edit so the watch page re-fetches the updated doc.
  const [scheduledRefreshKey, setScheduledRefreshKey] = useState(0);

  useEffect(() => {
    if (!scheduled || !author || !permlink || author === 'unknown') {
      setScheduledLoading(false);
      return;
    }
    let cancelled = false;
    setScheduledLoading(true);
    fetchScheduledPost(author, permlink)
      .then((doc) => { if (!cancelled) setScheduledDoc(doc); })
      .catch(() => { if (!cancelled) setScheduledDoc(null); })
      .finally(() => { if (!cancelled) setScheduledLoading(false); });
    return () => { cancelled = true; };
  }, [scheduled, author, permlink, scheduledRefreshKey]);

  // The embed asset (owner/permlink) the player should load for a scheduled post.
  const scheduledEmbedRef = useMemo(
    () => (scheduledDoc ? getScheduledEmbedRef(scheduledDoc) : null),
    [scheduledDoc],
  );
  const scheduledDetails = useMemo(
    () => buildScheduledVideoDetails(scheduledDoc),
    [scheduledDoc],
  );

  // Hidden (moderated) creator — hard-block the watch page. The checker also 404s
  // /videodetails for these, but this page loads its metadata from Hive directly,
  // so it needs its own check. Fails open (plays) on a check error.
  const [authorHidden, setAuthorHidden] = useState(false);
  useEffect(() => {
    if (!author || author === 'unknown') { setAuthorHidden(false); return undefined; }
    let alive = true;
    isCreatorHidden(author).then((h) => { if (alive) setAuthorHidden(h); });
    return () => { alive = false; };
  }, [author]);

  // Media unavailable: the player exhausted every CDN source (a FATAL error) or the
  // checker already confirmed this video's media is gone (deadVideos store). Feeds
  // already hide dead videos, but a direct link from a creator's profile can still
  // land here — show an honest hint instead of a stuck/black player. Reset per video.
  const [playbackFailed, setPlaybackFailed] = useState(false);
  useEffect(() => { setPlaybackFailed(false); }, [author, permlink]);
  // A RECOVERABLE playback failure (CORS-blocked gateway, network drop, 5xx,
  // timeout) as opposed to genuinely missing media. Kept separate so we never
  // tell someone their video is gone — or report it as dead — over a transport
  // hiccup that usually clears on a retry.
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  useEffect(() => { setPlaybackBlocked(false); }, [author, permlink]);
  // Retrying has to force a NEW gateway race, not replay the poisoned result:
  // /hls sends `max-age=300`, so the browser would otherwise hand back the same
  // unreadable manifest for five minutes. Bumping this remounts the load effect
  // and the SDK requests the source again with a cache-busting reload.
  const [playbackAttempt, setPlaybackAttempt] = useState(0);
  const retryPlayback = useCallback(() => {
    setPlaybackBlocked(false);
    setPlaybackAttempt((n) => n + 1);
  }, []);
  const deadVideos = useDeadVideos();
  const mediaUnavailable = playbackFailed
    || (!!author && !!permlink && deadVideos.has(videoKey(author, permlink)));

  // Show the branded loader OVER the player until it's actually ready to paint a
  // frame (SDK `onReady`). We can't drive this off playerState.loading: the SDK's
  // react hook never re-renders on its "loading" event, and the poster stays black
  // until the Hive metadata arrives — so without this the user just sees a black
  // box while the source loads. Reset per video.
  const [videoReady, setVideoReady] = useState(false);
  useEffect(() => { setVideoReady(false); }, [author, permlink]);
  const mediaLoading = !videoReady && !mediaUnavailable && !scheduled;

  // Track which videos we've recorded to avoid duplicate API calls
  const recordedWatchRef = useRef(new Set());

  // Track videos played in this autoplay session to avoid loops
  const playedVideosRef = useRef(new Set());

  // Watched status from backend (Map of "author/permlink" → watch data)
  const [watchedMap, setWatchedMap] = useState(new Map());
  const watchedMapRef = useRef(watchedMap);
  watchedMapRef.current = watchedMap;

  // Get playlist data from location state (passed from PlaylistView)
  const [playlistData, setPlaylistData] = useState(null);
  const [showPlaylist, setShowPlaylist] = useState(true);

  // Initialize playlist data from location state
  useEffect(() => {
    if (location.state?.playlist && location.state?.videos) {
      setPlaylistData({
        playlist: location.state.playlist,
        videos: location.state.videos,
        currentIndex: location.state.currentIndex ?? parseInt(posParam) ?? 0,
      });
      setShowPlaylist(true);
    } else if (!playlistId) {
      // Clear playlist data if not in playlist mode
      setPlaylistData(null);
    }
  }, [location.state, playlistId, posParam]);

  // Update current index when video changes
  useEffect(() => {
    if (playlistData && posParam !== null) {
      const newIndex = parseInt(posParam);
      if (!isNaN(newIndex) && newIndex !== playlistData.currentIndex) {
        setPlaylistData(prev => prev ? { ...prev, currentIndex: newIndex } : null);
      }
    }
  }, [posParam]);

  // --- SDK Player ---
  const wrapperRef = useRef(null);
  const videoIsVerticalRef = useRef(false);
  const fullscreenFromButtonRef = useRef(false);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimerRef = useRef(null);
  const [videoEnded, setVideoEnded] = useState(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);
  const clipModeActiveRef = useRef(false);
  const popupOpenRef = useRef(false);

  // Autoplay next video preference
  const AUTOPLAY_STORAGE_KEY = '3speak-autoplay';
  const [autoplayNext, setAutoplayNext] = useState(() => localStorage.getItem('3speak-autoplay') !== '0');
  const autoplayNextRef = useRef(autoplayNext);
  autoplayNextRef.current = autoplayNext;
  const toggleAutoplayNext = useCallback(() => {
    setAutoplayNext(prev => {
      const next = !prev;
      localStorage.setItem(AUTOPLAY_STORAGE_KEY, next ? '1' : '0');
      return next;
    });
  }, []);

  const { glowMode, toggleGlow } = useAmbientGlow();

  // Pro status for the logged-in viewer, from the checker rather than inferred
  // from whether an ad happened to be served. See the `premium` note below.
  const premiumStatus = usePremiumStatus(user);

  // Subtitles
  const {
    availableLanguages: subtitleLanguages,
    selectedLang: selectedSubtitleLang,
    selectLanguage: selectSubtitleLang,
    cues: subtitleCues,
    loading: subtitleLoading,
    subtitleStyle,
    updateStyle: updateSubtitleStyle,
  } = useSubtitles(author, permlink);

  // True once the loaded post is a live OpenPods stream (video.live). A ref so
  // the player's onError / load-failure callbacks read the latest value — a
  // live post has NO VOD source, so we must NOT report it "unavailable" (that
  // would flag the stream post as a dead video).
  const isLiveRef = useRef(false);

  // 🔐 Supporters-only playback, resolved by the gate. Held in a ref for the
  // same reason as isLiveRef: the player load effect is declared above the
  // query that reveals whether this post is gated.
  // `resolved` distinguishes "known not to be gated" from "we do not know yet".
  // Without it the loader reads isGated:false on first run — before the post's
  // metadata has arrived — and starts the ordinary public load for what turns
  // out to be a supporters-only video.
  const gatedRef = useRef({ isGated: false, state: 'idle', isEntitled: false, manifestUrl: null, previewUrl: null, resolved: false });
  const [gatedTick, setGatedTick] = useState(0);
  // Persist mute/volume preference across video navigations
  const MUTE_STORAGE_KEY = '3speak-muted';
  const VOLUME_STORAGE_KEY = '3speak-volume';
  const storedMuted = localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  const storedVolume = parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY)) || 1;

  // Quality levels state
  const [qualityLevels, setQualityLevels] = useState([]);
  const [currentQuality, setCurrentQuality] = useState(-1); // -1 = auto

  const {
    ref: sdkVideoRef,
    state: playerState,
    player,
    load: loadVideo,
    pause,
    togglePlay,
    seek,
    setMuted: sdkSetMuted,
    setVolume: sdkSetVolume,
    togglePip,
    setQuality: sdkSetQuality,
    setPlaybackRate,
  } = usePlayer({
    apiBase: getPlayerUrl(),
    muted: storedMuted,
    loop: false,
    poster: false, // we set an optimized poster ourselves — see posterUrl below
    // Resume playhead to the last position — but only if the user consented to the
    // optional "functional" storage (the SDK persists the position in localStorage
    // as `3speak_pos_*`). Was hardcoded `false`, which disabled resume entirely.
    // The storage guard in lib/consent.js enforces the same choice at write time.
    resume: hasConsent('functional'),
    // FATAL means the player already tried its alternate CDN sources (it emits a
    // separate `fallback` event for those) and every one of them failed — so the
    // media is a real candidate for being gone. Non-fatal errors recover; ignore them.
    // The checker re-verifies across every gateway before banning anything, so being
    // wrong here is free.
    onError: (err) => {
      // A live post has no VOD source — an error here is expected, not a dead
      // video. Never report it unavailable or show the "not available" hint.
      if (!err?.fatal || isLiveRef.current) return;

      // Distinguish "the media is gone" from "we couldn't reach it".
      //
      // Every fatal used to be treated as missing media, which meant a TRANSPORT
      // failure got a permanent-sounding message AND a reportVideoUnavailable()
      // call — so a perfectly healthy video could be reported dead because one
      // gateway had a bad moment. The live example: ipfs.3speak.tv serves
      // manifests without access-control-allow-origin, so when the /hls race
      // picks it the browser blocks the read. hls.js sees a load failure with NO
      // http status (a CORS block is opaque to JS), which is indistinguishable
      // from a network drop and nothing at all like a 404.
      //
      // The player hands us `{ message: 'HLS fatal error: <hls details>', code }`
      // where `code` is the response status when there was one.
      const status = Number(err.code) || 0;
      const details = String(err.message || '');
      // Only a definitive "not there" answer from the origin counts as missing.
      const mediaIsGone = status === 404 || status === 410;
      // Everything else — no status (CORS/network), 5xx, or a timeout — is a
      // transport problem that may well succeed on the next attempt.
      const transportProblem = !mediaIsGone
        && (status === 0 || status >= 500 || /timeout/i.test(details));

      if (mediaIsGone) {
        reportVideoUnavailable(author, permlink, videoDetails?.playUrl || null);
        setPlaybackFailed(true); // swap the player for a "not available" hint
      } else if (transportProblem) {
        setPlaybackBlocked(true); // recoverable — offer a retry, report nothing
      } else {
        // An unexpected fatal we can't classify (e.g. a decode error): show the
        // softer hint rather than accusing the video of being gone.
        setPlaybackBlocked(true);
      }
      console.warn('[Watch] fatal playback error', { status, details });
    },
    // First frame decoded — drop the branded loader and reveal the player.
    onReady: () => setVideoReady(true),
    // Tuned for 3Speak's reality: older uploads sit on COLD IPFS and a segment can
    // take 30–45s to serve the first time (then the CDN has it hot). See the HAR
    // analysis of 2026-07-15.
    hlsConfig: {
      // Buffer a sane amount ahead. The old 600s (10 min) made hls.js fire dozens of
      // fragment requests far in advance — against a slow gateway those pile up, time
      // out and retry in a storm, which also loaded segments wildly out of order. 60s
      // of runway is plenty without the flood.
      maxBufferLength: 60,
      maxMaxBufferLength: 120,
      maxBufferSize: 60 * 1000 * 1000, // 60 MB
      // Give each fragment room to FINISH instead of aborting at hls.js's 20s default
      // and re-downloading it — those aborts were the bulk of the wasted/duplicated
      // requests. Bound the retries so a genuinely dead segment still gives up.
      fragLoadingTimeOut: 60000,
      fragLoadingMaxRetry: 3,
      fragLoadingRetryDelay: 1000,
      fragLoadingMaxRetryTimeout: 60000,
      manifestLoadingTimeOut: 20000,
      levelLoadingTimeOut: 20000,
      // Don't cold-start at 1080p on a slow gateway (the first segment took ~42s). The
      // SDK's default startLevel:0 picks the first-listed variant, and 3Speak masters
      // list highest-first — so it forced 1080p. Let ABR choose from a conservative
      // bandwidth estimate instead; it ramps up within a segment or two once real
      // throughput is known.
      startLevel: -1,
      abrEwmaDefaultEstimate: 1000000, // ~1 Mbps → starts around 480p, not 1080p
    },
  });

  // The main player's CURRENT rung height in px (0 if unknown). The scrubber's low-res
  // preview reads this to skip loading when its smallest rung isn't smaller than what's
  // already playing — otherwise it re-downloads the exact segments playback needs.
  const getPlaybackHeight = useCallback(() => {
    const hls = player?.hls;
    if (!hls || hls.currentLevel == null || hls.currentLevel < 0) return 0;
    return hls.levels?.[hls.currentLevel]?.height || 0;
  }, [player]);

  // Track watch DURATION instead of incrementing a view. On first play we open a
  // server-measured session (POST /api/watch/start) and heartbeat while playing
  // (/api/watch/beat) — the backend records watched seconds + % of duration with
  // the viewer IP into `view-durations`, WITHOUT bumping the view counter. This
  // is the non-polluting path (mirrors the player's /play route), so preview
  // playback never inflates production view counts. See useWatchDuration.
  const sdkApiRef = useRef(new ThreeSpeakApi(getPlayerUrl()));
  // Server-side ad insertion. Holds the mapping from the player's (stitched)
  // timeline back to content time — see lib/adBreak.js for why that matters.
  const adBreakRef = useRef(createAdBreak());
  const [sponsorVisible, setSponsorVisible] = useState(false);
  // A burned-in banner has nothing in the page to show, so this drives only the
  // click target over it. Separate from sponsorVisible: the two placements have
  // different windows and either can run without the other.
  const [bannerVisible, setBannerVisible] = useState(false);
  // Seconds left before the break, 3 → 1, or null. A mid-roll that arrives with no
  // warning is the part people resent most; a few seconds' notice costs the
  // advertiser nothing and turns an interruption into a beat.
  const [adCountdown, setAdCountdown] = useState(null);
  // Seconds until the content resumes, while the spot is on screen. The wait is
  // the thing a viewer actually wants to know, and a number that is visibly
  // ticking down reads as shorter than the same wait with no number on it.
  const [resumeIn, setResumeIn] = useState(null);
  // Whether a Skip is being offered on the spot playing right now. The server decides
  // IF and AFTER HOW LONG; this is only whether that moment has arrived.
  const [canSkipAd, setCanSkipAd] = useState(false);
  /* A hard rule: NO ad chrome at all while the source is being swapped.
   *
   * Reloading a source resets the playhead to zero before the new manifest lands, and
   * a spot booked at the start of the video is "playing" at zero. So for a moment
   * after closing a banner, the roll's disclosure and Skip flashed up over a video
   * that was simply reloading. Rather than teach every control to recognise that
   * moment, one flag silences all of them, and it is a flag rather than more window
   * arithmetic because the timeline is exactly what cannot be trusted mid-swap. */
  const [adChromeOff, setAdChromeOff] = useState(false);
  // Seconds until the Skip becomes pressable, or null once it is. The control is on
  // screen for the whole spot either way; this only decides which state it is in.
  const [skipIn, setSkipIn] = useState(null);
  // Whether the banner may be closed yet. See adBreak.bannerClosable.
  const [bannerClosable, setBannerClosable] = useState(false);
  // Disclosure. Required by EU and US advertising rules, and driven off the same
  // clock the tracker reads so it can never disagree with what is on screen.
  useEffect(() => {
    const ab = adBreakRef.current;
    // Silenced while the source is swapping: the clock is meaningless until the new
    // manifest is parsed, so nothing derived from it may be shown.
    if (adChromeOff) {
      if (sponsorVisible) setSponsorVisible(false);
      if (bannerVisible) setBannerVisible(false);
      if (bannerClosable) setBannerClosable(false);
      if (adCountdown !== null) setAdCountdown(null);
      if (resumeIn !== null) setResumeIn(null);
      if (canSkipAd) setCanSkipAd(false);
      if (skipIn !== null) setSkipIn(null);
      return;
    }
    // `active` is the SPOT. A playback can carry a banner and no spot, so the banner
    // is cleared on its own terms rather than with the break.
    if (!ab.active && !ab.bannerInfo) {
      if (sponsorVisible) setSponsorVisible(false);
      if (bannerVisible) setBannerVisible(false);
      if (adCountdown !== null) setAdCountdown(null);
      if (resumeIn !== null) setResumeIn(null);
      if (canSkipAd) setCanSkipAd(false);
      if (skipIn !== null) setSkipIn(null);
      return;
    }
    if (!ab.active) {
      if (sponsorVisible) setSponsorVisible(false);
      if (adCountdown !== null) setAdCountdown(null);
      if (resumeIn !== null) setResumeIn(null);
      const t0 = Number(playerState?.currentTime) || 0;
      const onB = ab.isBannerVisible(t0);
      if (onB !== bannerVisible) setBannerVisible(onB);
      return;
    }
    const t = Number(playerState?.currentTime) || 0;
    const inside = ab.isInside(t);
    if (inside !== sponsorVisible) setSponsorVisible(inside);

    const onBanner = ab.isBannerVisible(t);
    if (onBanner !== bannerVisible) setBannerVisible(onBanner);

    // Only inside the last few seconds, and never while the spot is already playing.
    const left = inside ? null : ab.secondsUntil(t);
    const next = left != null && left <= AD_COUNTDOWN_FROM ? Math.max(1, Math.ceil(left)) : null;
    if (next !== adCountdown) setAdCountdown(next);

    // Whole seconds, so it ticks once a second rather than flickering per frame.
    const remain = inside ? ab.secondsRemaining(t) : null;
    const shown = remain == null ? null : Math.max(0, Math.ceil(remain));
    if (shown !== resumeIn) setResumeIn(shown);

    // Skippable, and only once the server's threshold has actually elapsed. Read off
    // the same clock as the disclosure, so a Skip can never appear over a spot that is
    // not running.
    // The banner's close button waits too, on the same server-sent threshold. The
    // click target does not: following an ad is something a viewer may do at once.
    const closable = onBanner && ab.bannerClosable(t);
    if (closable !== bannerClosable) setBannerClosable(closable);

    const skippable = inside && ab.canSkip(t);
    if (skippable !== canSkipAd) setCanSkipAd(skippable);

    // Whole seconds, so it ticks once rather than flickering per frame — the same
    // treatment the resume countdown gets, for the same reason.
    const untilSkip = inside ? ab.secondsUntilSkip(t) : null;
    const shownSkip = untilSkip == null ? null : Math.max(1, Math.ceil(untilSkip));
    if (shownSkip !== skipIn) setSkipIn(shownSkip);
  }, [playerState?.currentTime, sponsorVisible, bannerVisible, adCountdown, resumeIn, canSkipAd, skipIn, adChromeOff, bannerClosable]);

  /* The viewer closed the banner.
   *
   * 🚨 Telling the server is not enough on its own. The banner is IN the picture, so
   * every second the player has already buffered still carries it, and on a healthy
   * connection that is most of its run: closing it would appear to do nothing for
   * several seconds, which reads as a broken button rather than a slow one.
   *
   * So the buffer AHEAD of the playhead is dropped and refetched. Those segments come
   * back unburned now that the server has been told, and the ad goes in about a
   * second. It costs a moment of loading, which is the right trade for somebody who
   * has just asked to be rid of it. Only what is ahead: flushing from zero would throw
   * away what is behind too and make a scrub back re-download.
   *
   * All best-effort. hls.js is not guaranteed to be the engine, and a flush that fails
   * leaves the old behaviour, where the banner simply finishes its run. Never a reason
   * to throw inside a click handler on the watch page.
   */
  /* Skip the rest of the spot: seek to where the content resumes.
   *
   * The break is spliced INTO the playlist, so there is nothing to unload — the video
   * carries on immediately after it, and moving the playhead past the break is the
   * whole of skipping. `endOfBreak` lands a hair past the boundary, because stopping
   * exactly on it can leave the player one frame inside the spot and flash the
   * disclosure back up.
   *
   * The advertiser is not billed for what was not watched: an impression completes
   * only once enough of the spot has actually played, so a skip at five seconds of a
   * fifteen second spot was never a charge in the first place.
   */
  const skipAd = useCallback(() => {
    const to = adBreakRef.current?.endOfBreak?.();
    // Counted as watched. The button only exists after the threshold, so pressing it
    // means the spot got the seconds it was owed.
    try { adBreakRef.current?.recordSkip?.(); } catch { /* the skip still happens */ }
    setCanSkipAd(false);
    if (!Number.isFinite(to)) return;
    try { player?.seek(to); } catch { /* the spot simply plays out */ }
  }, [player]);


  const dismissBanner = useCallback(async () => {
    setBannerVisible(false);

    /* 🚨 A DRAWN BANNER IS ALREADY GONE.
     *
     * Hiding the element removes it, so none of what follows applies: there is no
     * reload, so no window where the clock reads zero and a passed spot looks live,
     * and nothing to seek back from. Everything below exists only because a burned
     * banner lives in bytes the browser has already downloaded.
     *
     * Told to the server all the same, so it stops counting the banner as on screen
     * and stops serving it for the rest of the session. */
    if (adBreakRef.current?.bannerOverlay) {
      try { await adBreakRef.current?.dismissBanner?.(); } catch { /* the hide stands */ }
      return;
    }

    // Everything ad-related goes quiet until the new manifest is parsed: a reload walks
    // the playhead through zero, and a spot booked at the start of the video is inside
    // its own window there.
    setAdChromeOff(true);

    /* HARD RULE: a spot already passed never shows its chrome again.
     *
     * Silencing only for the duration of the swap was not enough. The flag comes off
     * when the manifest parses, which is BEFORE the player has seeked back, so there
     * was still a window where the clock read zero and the pre-roll looked live.
     *
     * If the break ends at or before where the viewer is being put back, it is retired
     * outright and no clock can resurrect it. A break not yet reached is left alone:
     * that one still has to run. */
    try {
      const end = adBreakRef.current?.endOfBreak?.();
      const at0 = videoElRef.current?.currentTime;
      if (Number.isFinite(end) && Number.isFinite(at0) && end <= at0) {
        adBreakRef.current?.retireSpot?.();
      }
    } catch { /* the swap flag still covers the reload itself */ }
    try { await adBreakRef.current?.dismissBanner?.(); } catch { /* the hide still happens */ }

    /* SWAP THE SOURCE. Do not try to un-burn what is already downloaded.
     *
     * 🚨 Flushing the buffer was the wrong tool and could never have worked. The
     * covered seconds keep the SAME segment urls whether or not the banner is on them,
     * so a refetch is a refetch of the burned bytes, and the browser will happily serve
     * them from its own cache without asking anybody. Two rounds of cache headers and
     * buffer margins went into that and none of it could have.
     *
     * A dismissed session's playlist points those seconds at the CDN original instead,
     * so reloading the source genuinely changes which files play. Different urls, so
     * nothing cached under the old ones can come back.
     *
     * The position is captured first and restored once the new manifest is parsed,
     * because loading a source starts it from the beginning otherwise, and a viewer who
     * closed an ad should not be sent back to the start of the video for it.
     */
    try {
      const hls = player?.hls;
      const el = videoElRef.current;
      const at = el?.currentTime;
      const wasPlaying = el && !el.paused;
      if (!hls?.loadSource || !hls.url || !Number.isFinite(at)) { setAdChromeOff(false); return; }
      /* `startLoad(position)` rather than setting currentTime.
       *
       * Reloading a source detaches and re-attaches the MediaSource, so the element
       * starts empty at zero. Assigning currentTime against an empty buffer is ignored
       * as often as not; telling hls.js WHERE TO BEGIN LOADING is the supported way,
       * and the element lands there once the first fragment arrives. */
      hls.once('hlsManifestParsed', () => {
        try {
          hls.startLoad(at);
          if (wasPlaying) videoElRef.current?.play?.().catch(() => {});
        } catch { /* the viewer can press play */ }
        // Back on only once the playhead means something again.
        setAdChromeOff(false);
      });
      hls.loadSource(hls.url);
      // Belt and braces: a manifest that never parses must not silence the chrome for
      // the rest of the video.
      setTimeout(() => setAdChromeOff(false), 8000);
    } catch { setAdChromeOff(false); }
  }, [player]);


  useWatchDuration({
    api: sdkApiRef.current,
    author,
    permlink,
    playerState,
    enabled: !scheduled,
    // Report CONTENT time. Without this a stitched spot's seconds are credited as
    // watch time on the creator's video.
    mapPosition: (t) => adBreakRef.current.contentTime(t),
    /* 🚨 Asked of the checker directly, NOT taken from the ad response.
     *
     * `adBreak.isPremiumViewer` starts false and is only set when /m/session
     * answers, which happens AFTER this hook has already opened the watch session.
     * So every session was stamped `premium: false`, a Pro subscriber's included,
     * and services/adInventory.js — which filters `premium: {$ne: true}` precisely
     * so we never sell inventory we will not serve — was counting them as sellable.
     * Serving itself was never affected: adDecision() resolves premium server-side
     * from embed-users.
     *
     * usePremiumStatus returns null while loading, so `=== true` keeps an
     * unresolved answer out of the flag rather than guessing either way. */
    premium: premiumStatus?.premium === true,
  });

  // Also record a normal view once playback actually starts (increments the view
  // count via the player backend's /api/view). A video lives in exactly one
  // collection, so we try 'embed' (also matches hive_permlink) then 'legacy';
  // whichever owns it counts, and we stop. Deduped per author/permlink so
  // seeking/pausing never double-counts.
  const recordedViewsRef = useRef(new Set());
  useEffect(() => {
    if (scheduled) return; // unpublished post — no view to record
    if (playerState?.paused !== false) return; // only once it's really playing
    const key = `${author}/${permlink}`;
    if (recordedViewsRef.current.has(key)) return;
    recordedViewsRef.current.add(key);
    (async () => {
      // Resolve the embed ASSET id (+ owner) the same way the player does. The URL
      // permlink is often the Hive permlink, but /api/view matches the embed *asset*
      // permlink — sending the Hive permlink would 404 and never count the view.
      let owner = author;
      let viewPermlink = permlink;
      // Shared session cache — the watch-duration session resolves the same
      // /api/embed metadata; this dedupes both into one request per video.
      const meta = await resolveVideoMeta(sdkApiRef.current, author, permlink);
      if (meta?.owner) owner = meta.owner;
      if (meta?.permlink) viewPermlink = meta.permlink;
      for (const type of ['embed', 'legacy']) {
        try {
          const res = await fetch(`${getPlayerUrl()}/api/view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner, permlink: viewPermlink, type }),
          });
          const data = await res.json().catch(() => ({}));
          if (data?.counted) break;
        } catch { /* try next type */ }
      }
    })();
  }, [scheduled, author, permlink, playerState?.paused]);

  // "Most replayed" heatmap — aggregate timeline coverage from all viewers
  // (GET /api/heatmap). Fed into the scrubber to render a bar above the timeline.
  const [replayHeatmap, setReplayHeatmap] = useState(null);
  useEffect(() => {
    setReplayHeatmap(null);
    if (!author || author === 'unknown' || !permlink) return;
    let cancelled = false;
    (async () => {
      // Try embed (matches hive_permlink) then legacy; use whichever has data.
      for (const type of ['embed', 'legacy']) {
        try {
          const r = await fetch(`${getPlayerUrl()}/api/heatmap?v=${author}/${permlink}&type=${type}`);
          if (!r.ok) continue;
          const data = await r.json();
          if (!cancelled && data?.tracked && Array.isArray(data.normalized) && data.normalized.some((v) => v > 0)) {
            setReplayHeatmap(data.normalized);
            return;
          }
        } catch { /* ignore — heatmap is best-effort */ }
      }
    })();
    return () => { cancelled = true; };
  }, [author, permlink]);

  // Wrap setMuted/setVolume to persist to localStorage
  const setMuted = useCallback((muted) => {
    sdkSetMuted(muted);
    localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  }, [sdkSetMuted]);

  const setVolume = useCallback((vol) => {
    sdkSetVolume(vol);
    localStorage.setItem(VOLUME_STORAGE_KEY, String(vol));
  }, [sdkSetVolume]);

  // Cross-player coordination: announce when this video starts, and pause
  // when another player (audio / short) takes over.
  useEffect(() => {
    if (!playerState.paused) notifyMediaPlay('video');
  }, [playerState.paused]);
  useEffect(() => onMediaPlay('video', () => pause()), [pause]);

  // Track when the <video> element is mounted and attached to the Player
  const [videoAttached, setVideoAttached] = useState(false);
  const videoElRef = useRef(null); // handle on the element, so we can set our own poster
  const videoRef = useCallback((element) => {
    // React calls this with null while unmounting, by which point the player may
    // already have torn itself down — detaching from a destroyed one throws, and
    // an error from a ref callback is not contained the way a render error is:
    // it unmounts the tree, leaving a blank page. Navigating away from a watch
    // page mid-load is the usual way to hit it.
    try {
      sdkVideoRef(element); // pass to usePlayer's internal attach
    } catch {
      /* player already destroyed — nothing left to detach from */
    }
    videoElRef.current = element;
    if (element) {
      // Apply stored volume immediately after attach (SDK has no volume config option)
      const savedVol = parseFloat(localStorage.getItem('3speak-volume'));
      if (!isNaN(savedVol)) element.volume = savedVol;
    }
    setVideoAttached(!!element);
  }, [sdkVideoRef]);

  // Refs synced on every render so event handlers avoid stale closures
  const playlistDataRef = useRef(playlistData);
  playlistDataRef.current = playlistData;
  const showPlaylistRef = useRef(showPlaylist);
  showPlaylistRef.current = showPlaylist;

  // Navigate to next video in playlist
  const navigateToNextVideo = useCallback(() => {
    if (!playlistData || !playlistData.videos || playlistData.videos.length === 0) {
      return;
    }

    const { playlist, videos, currentIndex } = playlistData;
    const nextIndex = currentIndex + 1;

    // Check if there's a next video
    if (nextIndex < videos.length) {
      const nextVideo = videos[nextIndex];
      navigate(`/watch?v=${nextVideo.author}/${nextVideo.permlink}&playlist=${playlist.id}&pos=${nextIndex}`, {
        state: { playlist, videos, currentIndex: nextIndex },
      });
    }
  }, [playlistData, navigate]);

  const navigateToNextVideoRef = useRef(navigateToNextVideo);
  navigateToNextVideoRef.current = navigateToNextVideo;

  // What the SDK player should load. Normally the Hive author/permlink, but for a
  // scheduled post the Hive post doesn't exist yet — its embed asset is keyed by
  // its own (owner/embedPermlink), so we load that instead (resolved once the
  // checker doc arrives).
  const playerLoadId = scheduled
    ? (scheduledEmbedRef ? `${scheduledEmbedRef.owner}/${scheduledEmbedRef.permlink}` : null)
    : `${author}/${permlink}`;

  // Load video when the target changes (wait for video element to be attached)
  useEffect(() => {
    if (!playerLoadId || author === 'unknown' || !player || !videoAttached) return undefined;
    let active = true;
    setVideoEnded(false);
    // Record this video as played in the current session
    playedVideosRef.current.add(`${author}/${permlink}`);
    // Reset playhead to 0 immediately so the UI doesn't show the old video's position
    seek(0);
    // 🔐 Supporters-only videos never resolve through the player backend: the
    // gate hands us a per-viewer manifest whose key requests carry a session
    // token. A locked viewer gets the unencrypted preview instead, and an
    // unresolved gate state must not fall through to the normal loader, which
    // would report a perfectly healthy paid video as a dead one.
    const g = gatedRef.current;
    // Wait until we know whether this post is gated. Starting the public loader
    // first and correcting afterwards is not merely wasteful: it fetches the
    // encrypted manifest through the ordinary path, so hls.js reads the
    // #EXT-X-KEY line written for the gate and retries that key endpoint without
    // a session token, forever. The visible result is a spinning player and a
    // stream of 401s that look like an entitlement failure when the viewer is
    // perfectly entitled.
    if (!g.resolved) return () => { active = false; };
    if (g.isGated) {
      if (g.state === 'loading' || g.state === 'idle') return () => { active = false; };
      const gatedSource = g.isEntitled ? g.manifestUrl : g.previewUrl;
      if (!gatedSource) return () => { active = false; };
      loadVideo({ url: gatedSource }).catch(err => {
        console.error('[Watch] Failed to load gated video:', err);
        if (active) setPlaybackFailed(true);
        // Deliberately NOT reported to the checker: a paid video the viewer
        // cannot decrypt is not a dead video, and reporting it would shadow-ban
        // the creator's catalogue.
      });
      return () => { active = false; };
    }

    // Ask whether this playback carries a sponsor spot. The source is resolved
    // here rather than letting the SDK do it, because the stitcher needs the
    // content manifest URL to splice against. Anything short of a clear yes falls
    // through to the ordinary path — no ad is always better than no video.
    //
    // Gated (paid) videos never reach this: they load on their own branch above.
    // Someone who paid for content should no more see an ad than a Pro subscriber.
    const viewer = (useAppStore.getState().user || '').toLowerCase() || null;
    adBreakRef.current.reset();
    setSponsorVisible(false);
    setBannerVisible(false);
    (async () => {
      try {
        const source = await sdkApiRef.current.fetchSource(author, permlink);
        if (!active || !source?.url) throw new Error('no source');
        const meta = await resolveVideoMeta(sdkApiRef.current, author, permlink);
        // 🚨 NEVER ON A SHORT. The only slot that fits inside one is a pre-roll, and a
        // 15-second spot in front of a 12-second short delivers an impression to
        // someone who never wanted the content — which is why shorts have their own
        // format, played BETWEEN them rather than inside one.
        //
        // The shorts FEED honoured this by never asking; a short opened on a watch
        // page asks like any other video. The server refuses too, but not asking is
        // the better fix: it costs one condition on data already in hand.
        //
        // The FLAG, not the length: the shorts that surfaced this are 61-68s, past
        // any threshold anyone would pick, and one row in the wild is flagged short
        // at seven hours.
        const spot = meta?.short === true ? null : await adBreakRef.current.request({
          owner: meta?.owner || author,
          permlink: meta?.permlink || permlink,
          viewer,
          manifestUrl: source.url,
        });
        if (!active) return;
        if (spot) {
          // Original stays as the next fallback, so a stitcher outage degrades to
          // ordinary playback rather than a dead player.
          await loadVideo({
            url: spot.manifestUrl,
            fallbacks: [source.url, ...(source.fallbacks || [])],
            poster: source.poster,
          });
          adBreakRef.current.resolve();
          return;
        }
      } catch { /* no spot, or we could not resolve one — play it plainly */ }
      if (!active) return;

      // The ordinary path, unchanged in behaviour: let the SDK resolve and load.
      loadVideo(playerLoadId).catch(err => {
        // A live OpenPods post has no VOD source to resolve — the live player
        // handles playback separately, so a load failure here is expected. Don't
        // show "unavailable" or report the stream post as a dead video.
        if (isLiveRef.current) return;
        console.error('[Watch] Failed to load video:', err);
        // The player backend couldn't resolve ANY playable stream — e.g. /api/embed
        // and /api/watch both 404 for a very old post whose media isn't indexed. No
        // hls source is ever created, so the player's fatal onError never fires — show
        // the "no longer available" hint from here instead of leaving a blank player.
        // `active` guards against a stale load rejecting after we've moved on.
        if (active) setPlaybackFailed(true);
        // Also tell the checker (as the fatal path does): a post whose stream can't be
        // resolved is dead weight in feeds. The checker re-decides from its OWN doc — it
        // only shadow-bans a settled, published, no-stream archive video, never a
        // still-encoding one — so this sloppy client report is safe.
        reportVideoUnavailable(author, permlink, videoDetails?.playUrl || null);
      });
    })();
    return () => { active = false; };
    // `playbackAttempt` is in the deps purely so "Try again" re-runs this load.
    // `gatedTick` re-runs this load once the gate has answered. The gate state
    // lives in a ref because this effect is declared above the query that tells
    // us the post is gated at all — the same reason `isLiveRef` exists.
  }, [playerLoadId, author, permlink, player, loadVideo, videoAttached, seek, playbackAttempt, gatedTick]);

  // Subscribe to player events (stable effect — uses refs for mutable values)
  useEffect(() => {
    if (!player) return;

    let canPlayCleanup = null;

    const unsubReady = player.on('ready', ({ isVertical }) => {
      videoIsVerticalRef.current = isVertical;
      wrapperRef.current?.classList.toggle('vertical-video', isVertical);

      // Seek to timestamp if ?t= parameter is present
      const startTime = parseInt(new URLSearchParams(window.location.search).get('t'), 10);
      if (startTime > 0) {
        setTimeout(() => player.seek(startTime), 200);
      }

      // Restore persisted mute/volume preference on each video load
      const shouldMute = localStorage.getItem('3speak-muted') === '1';
      player.setMuted(shouldMute);
      const savedVol = parseFloat(localStorage.getItem('3speak-volume'));
      if (!isNaN(savedVol)) player.setVolume(savedVol);

      // Autoplay: wait for canplay (enough data buffered) instead of playing
      // immediately on metadata load, which fails on slow connections.
      const videoEl = player.element;
      const tryAutoplay = () => {
        player.play().then(() => {
          setAutoplayBlocked(false);
        }).catch((err) => {
          if (err?.name === 'NotAllowedError') {
            setAutoplayBlocked(true);
          }
        });
      };
      if (videoEl) {
        // Clean up any previous canplay listener
        if (canPlayCleanup) { canPlayCleanup(); canPlayCleanup = null; }

        if (videoEl.readyState >= 3) {
          tryAutoplay();
        } else {
          const onCanPlay = () => tryAutoplay();
          videoEl.addEventListener('canplay', onCanPlay, { once: true });
          canPlayCleanup = () => videoEl.removeEventListener('canplay', onCanPlay);
        }
      }

      // Fetch quality levels and apply stored preference
      const levels = player.getQualities();
      setQualityLevels(levels);

      const storedPref = localStorage.getItem(QUALITY_STORAGE_KEY);
      if (storedPref && storedPref !== 'auto' && levels.length > 0) {
        const preferredHeight = parseInt(storedPref, 10);
        // Find exact match or nearest available level at or below the stored height
        let best = null;
        for (const l of levels) {
          if (l.height === preferredHeight) { best = l; break; }
          if (l.height < preferredHeight && (!best || l.height > best.height)) {
            best = l;
          }
        }
        if (best) {
          player.setQuality(best.index);
          setCurrentQuality(best.index);
        } else {
          // All levels are above stored height — pick the lowest available
          const lowest = levels.reduce((a, b) => a.height < b.height ? a : b);
          player.setQuality(lowest.index);
          setCurrentQuality(lowest.index);
        }
      } else {
        setCurrentQuality(player.getCurrentQuality());
      }
    });

    const unsubQuality = player.on('qualitychange', (level) => {
      setCurrentQuality(level.index);
    });

    const unsubEnded = player.on('ended', () => {
      /* 🚨 Is this a REAL end, or did the buffer just run dry?
       *
       * `ended` is not only fired by reaching the end of a video. Anything that empties
       * the media element's buffer can produce one, and then autoplay-next carries the
       * viewer off to another video for no reason they can see. Closing a banner ad did
       * exactly that: it flushes the buffer so the ad stops sooner, the element found
       * itself with nothing, and the page moved on.
       *
       * A real end has the playhead AT the end. Anything else is the player having a
       * moment, and the right response is to ignore it rather than to navigate. */
      const el = videoElRef.current;
      if (el && Number.isFinite(el.duration) && el.duration > 0
        && el.currentTime < el.duration - 1.5) {
        return;
      }
      // Don't autoplay when user is selecting clip start/end or a popup is open
      if (clipModeActiveRef.current || popupOpenRef.current) {
        setVideoEnded(true);
        return;
      }
      if (playlistDataRef.current && showPlaylistRef.current) {
        navigateToNextVideoRef.current();
      } else if (autoplayNextRef.current && suggestedVideosRef.current?.length > 0) {
        // Find the first suggested video not already watched (backend) or played (session)
        const next = suggestedVideosRef.current.find(v => {
          const a = v?.author?.username || v?.author?.id || v?.author || v?.owner;
          if (!a || !v.permlink) return false;
          const key = `${a}/${v.permlink}`;
          return !playedVideosRef.current.has(key) && !watchedMapRef.current.has(key);
        });
        if (next) {
          const nextAuthor = next?.author?.username || next?.author?.id || next?.author || next?.owner;
          navigate(`/watch?v=${nextAuthor}/${next.permlink}`);
        } else {
          setVideoEnded(true);
        }
      } else {
        setVideoEnded(true);
      }
    });

    const unsubPlay = player.on('play', () => {
      setVideoEnded(false);
      setAutoplayBlocked(false);
    });

    return () => {
      unsubReady();
      unsubQuality();
      unsubEnded();
      unsubPlay();
      if (canPlayCleanup) canPlayCleanup();
    };
  }, [player]);

  // Handle quality change with optimistic UI update + persist preference
  const handleQualityChange = useCallback((level) => {
    setCurrentQuality(level);
    sdkSetQuality(level);
    // Persist: store the height for cross-video matching, or 'auto'
    if (level === -1) {
      localStorage.setItem(QUALITY_STORAGE_KEY, 'auto');
    } else {
      const match = qualityLevels.find(q => q.index === level);
      if (match) localStorage.setItem(QUALITY_STORAGE_KEY, String(match.height));
    }
  }, [sdkSetQuality, qualityLevels]);

  // Handle replay (when video ended)
  const handleReplay = useCallback(() => {
    if (!player) return;
    player.seek(0);
    player.play().catch(() => {});
    setVideoEnded(false);
  }, [player]);

  // Comment-based timeline markers
  const [commentMarkers, setCommentMarkers] = useState(null);
  const [markersRefreshKey, setMarkersRefreshKey] = useState(0);
  const refreshMarkers = useCallback(() => setMarkersRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (!author || !permlink || author === 'unknown') return;
    let cancelled = false;

    (async () => {
      try {
        const replies = await hiveClient.call('condenser_api', 'get_content_replies', [author, permlink]);
        if (cancelled || !replies || replies.length === 0) return;

        // Pre-render comment bodies as HTML
        let render;
        try { render = await getHiveRenderer(); } catch (e) { render = null; }

        // Only include comments that have parentTimestamp in their metadata
        const markers = [];
        for (const comment of replies) {
          let meta = {};
          try { meta = typeof comment.json_metadata === 'string' ? JSON.parse(comment.json_metadata) : (comment.json_metadata || {}); } catch (_) {}
          const parentTimestamp = typeof meta.parentTimestamp === 'number' ? meta.parentTimestamp : null;

          const replyCount = comment.children || 0;
          let bodyHtml = '';
          if (render && comment.body) {
            try { bodyHtml = render(comment.body); } catch (_) { bodyHtml = comment.body; }
          } else {
            bodyHtml = comment.body || '';
          }

          // Detect video reactions by checking for video metadata
          // Ensure the URL points to play.3speak.tv for proper iframe embedding
          let videoUrl = meta.video?.url || null;
          if (videoUrl && !videoUrl.includes('play.3speak.tv')) {
            // Try to extract video ID from embed.3speak.tv or other URL formats
            // and convert to play.3speak.tv/embed?v=user/videoId
            const match = videoUrl.match(/embed\.3speak\.tv\/(?:watch|embed|uploads)\/(.+)/);
            if (match) {
              videoUrl = `https://play.3speak.tv/embed?v=${comment.author}/${match[1]}`;
            }
          }

          markers.push({
            pct: parentTimestamp,
            pctIsSeconds: true,
            avatar: `https://images.hive.blog/u/${comment.author}/avatar/small`,
            label: comment.author,
            permlink: comment.permlink,
            replyCount,
            body: bodyHtml,
            isVideo: !!videoUrl,
            videoUrl,
          });
        }

        // Batch-fetch reputations and hidden status; mark low-rep + hidden authors.
        const authors = markers.map(m => m.label);
        const [reputations, hiddenSet] = await Promise.all([
          batchGetReputations(authors),
          batchCheckHidden(authors),
        ]);
        for (const m of markers) {
          const rep = reputations.get(m.label) ?? 25;
          m.isLowReputation = rep < LOW_REP_THRESHOLD;
          m.isHidden = hiddenSet.has(String(m.label || '').toLowerCase());
        }

        // Sort by timestamp: timestamped first (ascending), then no-timestamp at end
        markers.sort((a, b) => {
          if (a.pct === null && b.pct === null) return 0;
          if (a.pct === null) return 1;
          if (b.pct === null) return -1;
          return a.pct - b.pct;
        });

        if (!cancelled) setCommentMarkers(markers);
      } catch (err) {
        // "Invalid parameters" → post doesn't exist on Hive (social-only, deleted,
        // or bad permlink). Markers are non-essential, so log quietly.
        const benign = err?.name === 'RPCError';
        (benign ? console.warn : console.error)(
          `[markers] ${author}/${permlink}:`, err?.jse_shortmsg || err?.message || err,
        );
      }
    })();

    return () => { cancelled = true; };
  }, [author, permlink, markersRefreshKey]);

  // Resolve markers with actual time values when duration is known
  const resolvedMarkers = useMemo(() => {
    if (!commentMarkers || playerState.duration <= 0) return undefined;
    return commentMarkers
      .filter(m => m.pct !== null)
      .map(m => ({
        time: Math.round(m.pct),
        avatar: m.avatar,
        label: m.label,
        replyCount: m.replyCount,
        isVideo: m.isVideo,
      }));
  }, [commentMarkers, playerState.duration]);

  // Reaction player state
  const [selectedReactionIndex, setSelectedReactionIndex] = useState(0);
  const [isReactionPlayerVisible, setIsReactionPlayerVisible] = useState(() => {
    return localStorage.getItem('3speak-reactions-visible') !== 'false';
  });
  const [reactionSize, setReactionSize] = useState(() => {
    const stored = localStorage.getItem('3speak-reaction-size');
    // Migrate legacy 'large' → 'big'
    if (stored === 'large') return 'big';
    return stored || 'standard';
  });

  const setReactionsVisible = useCallback((visible) => {
    setIsReactionPlayerVisible(visible);
    localStorage.setItem('3speak-reactions-visible', String(visible));
  }, []);

  const handleAddReaction = useCallback(() => {
    const textarea = document.querySelector('.add-comment-wrap .textarea-box');
    if (textarea) {
      textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => textarea.focus(), 400);
    }
  }, []);

  const handleReactToMoment = useCallback(() => {
    // Exit fullscreen first if active
    const wrapper = wrapperRef.current;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else if (wrapper?.classList.contains('landscape-fullscreen')) {
      wrapper.classList.remove('landscape-fullscreen');
      setIsFullscreen(false);
    }

    // Activate the React tab in the comment section
    const reactTab = document.querySelector('.comment-tabs .comment-tab:nth-child(2)');
    if (reactTab) reactTab.click();
    // Wait for React to render the tab content, then scroll it into view
    setTimeout(() => {
      const addCommentWrap = document.querySelector('.add-comment-wrap');
      if (addCommentWrap) {
        addCommentWrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }, []);

  const REACTION_SIZES = ['medium', 'standard', 'big', 'cinema'];
  const REACTION_SIZE_LABELS = { medium: 'Medium', standard: 'Standard', big: 'Big', cinema: 'Cinema' };
  const cycleReactionSize = useCallback(() => {
    setReactionSize(prev => {
      const idx = REACTION_SIZES.indexOf(prev);
      const next = REACTION_SIZES[(idx + 1) % REACTION_SIZES.length];
      localStorage.setItem('3speak-reaction-size', next);
      return next;
    });
  }, []);

  // Desktop: show controls on mouse movement, auto-hide after 3s
  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  // Mobile: tap toggles controls on/off (with auto-hide when showing)
  const toggleControlsVisibility = useCallback(() => {
    setControlsVisible(prev => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (prev) return false;
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
      return true;
    });
  }, []);

  // Hold controls visible (e.g. while a menu is open) — cancel auto-hide
  const holdControls = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    setControlsVisible(true);
  }, []);

  // Release hold — restart auto-hide timer
  const releaseControls = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  // On opening a video, show the controls for the first 3s, then fade out
  // (instead of starting hidden). Re-runs when navigating to another video.
  useEffect(() => {
    if (!author || author === 'unknown' || !permlink) return;
    showControlsTemporarily();
  }, [author, permlink, showControlsTemporarily]);

  const handleToggleFullscreen = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // If currently in CSS landscape-fullscreen, exit that first
    if (wrapper.classList.contains('landscape-fullscreen')) {
      wrapper.classList.remove('landscape-fullscreen');
      setIsFullscreen(false);
      return;
    }

    if (!document.fullscreenElement) {
      fullscreenFromButtonRef.current = true;
      wrapper.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // Auto CSS-fullscreen when phone rotates to landscape (horizontal videos only)
  // Note: the Fullscreen API requires a user gesture, so we use a CSS class instead
  useEffect(() => {
    if (!screen.orientation) return;

    const handleOrientationChange = () => {
      // Don't interfere when real fullscreen is active (triggered by button)
      if (document.fullscreenElement) return;

      const wrapper = wrapperRef.current;
      if (!wrapper) return;

      // This immersive CSS-fullscreen is a TOUCH-device (phone/tablet) behaviour
      // for landscape rotation. A desktop monitor always reports "landscape" with
      // a large short side, so without this guard a horizontal video fills the
      // whole viewport on desktop — and it fires whenever the page renders with
      // the wrapper already mounted (e.g. warm react-query cache). Desktop uses
      // the real fullscreen button instead, so gate this to touch devices.
      const isTouch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;

      const isLandscape = screen.orientation.type.startsWith('landscape');
      const shortSide = Math.min(screen.width, screen.height);
      const isPhoneLandscape = isLandscape && shortSide <= 500;

      if (isTouch && isLandscape && !videoIsVerticalRef.current && !isPhoneLandscape) {
        wrapper.classList.add('landscape-fullscreen');
        setIsFullscreen(true);
      } else if (wrapper.classList.contains('landscape-fullscreen')) {
        wrapper.classList.remove('landscape-fullscreen');
        setIsFullscreen(false);
      }

      // Collapse reactions in phone landscape to save vertical space
      if (isPhoneLandscape) {
        setIsReactionPlayerVisible(false);
      }
    };

    // Also run on mount in case page loads in landscape
    handleOrientationChange();

    screen.orientation.addEventListener('change', handleOrientationChange);
    return () => screen.orientation.removeEventListener('change', handleOrientationChange);
  }, []);

  // Fullscreen change handler (orientation lock)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNowFullscreen = !!document.fullscreenElement;
      setIsFullscreen(isNowFullscreen);

      // Lock screen orientation only when fullscreen was triggered by the button
      if (screen.orientation?.lock && fullscreenFromButtonRef.current) {
        if (isNowFullscreen) {
          const lockType = videoIsVerticalRef.current ? 'portrait' : 'landscape';
          screen.orientation.lock(lockType).catch(() => {});
        } else {
          screen.orientation.unlock?.();
        }
      }
      fullscreenFromButtonRef.current = false;
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // PiP handler — SDK operates directly on the native <video> element
  const handleTogglePip = useCallback(() => {
    togglePip();
  }, [togglePip]);

  // Video post details — sourced from Hive (via lib/videoData), not the retired
  // union GraphQL API. The player loads its own HLS source by author/permlink,
  // so this only supplies post metadata (title/body/stats/tags/author).
  const {
    data: videoDetailsData,
    isLoading: videoLoading,
    isError: videoIsError,
    refetch: refetchVideo,
  } = useQuery({
    queryKey: ['video-details', author, permlink],
    queryFn: () => fetchVideoDetails(author, permlink),
    enabled: !scheduled && !!author && author !== 'unknown',
    retry: 1,
    staleTime: 60 * 1000,
  });

  // 🔐 Supporters-only (gated) playback. The post's json_metadata marks it and
  // names the embed asset the gate knows it by, which is not always the Hive
  // permlink (a remix reuses an existing asset).
  const gatedMeta = (() => {
    const raw = videoDetailsData?.json_metadata ?? videoDetailsData?.jsonMetadata;
    if (!raw) return null;
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return null;
    }
  })();
  const isGatedPost = gatedMeta?.gated === true;
  const gateVideoId = isGatedPost ? (gatedMeta?.gatedVideoId || permlink) : null;
  const gatedPlayback = useGatedPlayback(gateVideoId, isGatedPost);

  // Publish gate state to the ref the player load effect reads, then nudge it.
  useEffect(() => {
    gatedRef.current = {
      isGated: isGatedPost,
      state: gatedPlayback.state,
      isEntitled: gatedPlayback.isEntitled,
      manifestUrl: gatedPlayback.manifestUrl,
      previewUrl: gatedPlayback.previewUrl,
      // The post query settles before the gate is even asked, so this says only
      // "we now know whether it is gated", not "the gate has answered" — the
      // loader waits on the gate separately, via `state`. A disabled query (a
      // scheduled post, no author) reports not-loading, which correctly resolves
      // to the ordinary path rather than stalling the player forever.
      resolved: !videoLoading,
    };
    setGatedTick((n) => n + 1);
  }, [isGatedPost, gatedPlayback.state, gatedPlayback.isEntitled, gatedPlayback.manifestUrl, gatedPlayback.previewUrl, videoLoading]);

  // Optimistic override populated right after the author saves an edit.
  // The GraphQL indexer may lag a few minutes behind the Hive blockchain,
  // so we merge these values onto videoDetails immediately, then let a
  // scheduled refetch replace them with real server data.
  const [editOverride, setEditOverride] = useState(null);
  const baseVideoDetails = scheduled ? scheduledDetails : (videoDetailsData || null);
  const videoDetails = useMemo(() => {
    if (!baseVideoDetails || !editOverride) return baseVideoDetails;
    const merged = { ...baseVideoDetails, ...editOverride };
    // Update thumbnail inside nested spkvideo shape as well
    if (editOverride.thumbnail_url && baseVideoDetails.spkvideo) {
      merged.spkvideo = { ...baseVideoDetails.spkvideo, thumbnail_url: editOverride.thumbnail_url };
    }
    return merged;
  }, [baseVideoDetails, editOverride]);

  // A finished OpenPods stream publishes its recording as a VOD under the SAME
  // owner/permlink, but the Hive post keeps `video.live: true` forever (we
  // never rewrite the post). So "is this still live?" = the post says live AND
  // no published video exists yet — otherwise we'd show "Connecting to the
  // stream…" over a room that ended hours ago.
  const [liveVodReady, setLiveVodReady] = useState(false);
  // The encoder has an asset for this post but hasn't published it yet — i.e.
  // the stream is over and the recording is still being transcoded. Shown over
  // the (now dead) live player so the page says "coming back shortly" instead
  // of just "the streamer is offline".
  const [vodProcessing, setVodProcessing] = useState(false);
  useEffect(() => {
    setLiveVodReady(false);
    setVodProcessing(false);
    if (!videoDetails?.live || !author || !permlink) return undefined;
    let alive = true;
    let timer = null;
    // Poll: a viewer who sits on the page while the host wraps up should see
    // the VOD appear on its own, not have to reload to find out.
    const check = () => {
      fetchPlaySource(author, permlink)
        .then((src) => {
          if (!alive) return;
          if (src?.published) { setLiveVodReady(true); return; }   // done — stop polling
          // No asset at all means nothing was ever recorded (the host didn't
          // tick "replace the stream with a video"), and a failed encode is
          // not "processing" either — don't promise a video in either case.
          const dead = ['failed', 'error', 'deleted', 'cancelled'].includes(src?.status);
          setVodProcessing(!!src && !dead);
          timer = setTimeout(check, 20000);
        })
        .catch(() => { if (alive) timer = setTimeout(check, 20000); });
    };
    check();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [videoDetails?.live, author, permlink]);

  // Mirror the live flag into the ref the player callbacks read.
  const isLive = !!videoDetails?.live && !liveVodReady;
  useEffect(() => { isLiveRef.current = isLive; }, [isLive]);

  // Live chat takes the reaction panel's place in the right column. The panel
  // itself is rendered by <LiveStreamPlayer> and portalled in here, so it can
  // share the player's single LiveKit connection — hence a DOM element in
  // state (a plain ref wouldn't re-render the player once it's attached).
  const [liveChatSlot, setLiveChatSlot] = useState(null);
  // Reported by <LiveStreamPlayer>, which already resolves the room's endpoint.
  const [streamRoomMeta, setStreamRoomMeta] = useState(null);
  const mirrorChatToHive = useStreamChatMirror({
    author,
    permlink,
    // `liveAt` is the server's stamp of the moment the host hit Start, which is
    // also when recording began — so timecodes line up with the VOD's timeline.
    // The post's own timestamp is only a fallback: the announcement broadcast
    // lands some seconds after go-live, and older rooms have no stamp at all.
    startedAt: streamRoomMeta?.liveAt || videoDetails?.created_at,
    hasPost: true,   // we ARE on the post — an announced stream always has one
  });

  // Poster: the SDK's `poster: true` would set <video poster> straight from the
  // RAW metadata thumbnail — for legacy uploads that's the full-resolution
  // original (one is a 12MB JPEG), downloaded just to show a still frame. We turn
  // the SDK's poster off (see usePlayer config) and set the resize-proxied
  // thumbnail ourselves instead (~24KB via fixVideoThumbnail).
  const posterUrl = useMemo(
    () => (videoDetails ? fixVideoThumbnail(videoDetails) : null),
    [videoDetails],
  );
  useEffect(() => {
    const el = videoElRef.current;
    if (el && posterUrl) el.poster = posterUrl;
  }, [posterUrl, videoAttached]);

  /* 🚨 A SPOT THAT HAS RUN IS A HOLE IN THE TIMELINE.
   *
   * The ad is stitched into the manifest, so its seconds are real positions somebody
   * can drag the handle onto, and scrubbing back over your own video played the ad
   * again. Reloading onto a clean manifest would fix it and cost far more than it is
   * worth: that is the source swap the banner used to do, and it was never seamless.
   * So the seconds stay in the file and the playhead refuses to rest on them, jumping
   * to whichever side the viewer was travelling towards.
   *
   * `lastSeen` is the position BEFORE this event, which is the only way to tell a
   * scrub back from a scrub forward. Bound to `seeked` as well as `timeupdate`
   * because a quarter of a second of an ad already sat through still reads as one.
   */
  useEffect(() => {
    const el = videoElRef.current;
    if (!el) return undefined;
    let lastSeen = null;
    let boundaryRaf = 0;
    /* How far ahead of the cut to leave. Covers the gap between the frame on screen
     * and the clock, plus the seek's own latency. */
    const BOUNDARY_LEAD_S = 0.16;

    /* 🚨 WATCH THE BOUNDARY BY FRAME, not by timeupdate.
     *
     * A seek is announced, so it can be redirected before anything is drawn. Ordinary
     * playback into a spent spot is not: it just arrives, and timeupdate reports about
     * four times a second, so up to a quarter second of an ad the viewer already sat
     * through was presented before the jump. Re-watching the run-up to a mid-roll is
     * where that shows.
     *
     * Armed only within a second and a half of the cut and dropped as soon as playback
     * is past it or paused, so this is not a render loop the page carries around. */
    const boundaryTick = () => {
      boundaryRaf = 0;
      const ab = adBreakRef.current;
      const start = ab?.spotStart?.();
      const at = el.currentTime;
      if (start == null || !ab.spotConsumed || !Number.isFinite(at) || el.paused) return;
      /* 🚨 JUMP BEFORE THE CUT, not on it.
       *
       * Waiting until the playhead is inside the spot is already too late twice over:
       * the frame on screen is decoded ahead of what currentTime reports, and the seek
       * itself takes long enough that the ad frame sits there while it runs. Leaving a
       * sixth of a second early costs content at a point the viewer is about to be
       * moved away from anyway, and it is the difference between a glimpse of
       * somebody's ad and none. */
      if (at >= start - BOUNDARY_LEAD_S) {
        const to = ab.endOfBreak?.();
        if (Number.isFinite(to)) { try { el.currentTime = to; } catch { /* it plays through */ } }
        return;
      }
      if (start - at > 1.5) return;
      boundaryRaf = requestAnimationFrame(boundaryTick);
    };
    const armBoundary = () => {
      if (boundaryRaf) return;
      const ab = adBreakRef.current;
      const start = ab?.spotStart?.();
      const at = el.currentTime;
      if (start == null || !ab.spotConsumed || !Number.isFinite(at) || el.paused) return;
      if (at < start && start - at <= 1.5) boundaryRaf = requestAnimationFrame(boundaryTick);
    };

    const guard = () => {
      const ab = adBreakRef.current;
      const at = el.currentTime;
      if (!ab || !Number.isFinite(at)) return;
      ab.noteTime?.(at);
      const to = ab.skipTargetFor?.(at, lastSeen);
      if (to == null) { lastSeen = at; armBoundary(); return; }
      try { el.currentTime = to; } catch { /* it plays through, as it did before */ }
      lastSeen = to;
    };
    /* 🚨 'seeking' does the work here, not 'seeked'.
     *
     * 'seeked' fires once the media has SETTLED on the new position, by which time a
     * frame or two of the ad has been decoded and shown — the flash of ad you get
     * from clicking into its span. 'seeking' fires the moment currentTime changes,
     * before anything is presented, and setting currentTime again from inside it
     * supersedes the seek in flight. 'seeked' stays as the backstop for any path that
     * reaches a new position without announcing it first. */
    el.addEventListener('timeupdate', guard);
    el.addEventListener('seeking', guard);
    el.addEventListener('seeked', guard);
    return () => {
      if (boundaryRaf) cancelAnimationFrame(boundaryRaf);
      el.removeEventListener('timeupdate', guard);
      el.removeEventListener('seeking', guard);
      el.removeEventListener('seeked', guard);
    };
  }, [videoAttached]);

  const handleVideoEdited = useCallback((changes) => {
    if (!changes) return;
    setEditOverride({
      title: changes.title,
      body: changes.body,
      tags: changes.tags,
      thumbnail_url: changes.thumbnail || undefined,
    });
    // Re-fetch from Hive a few times — the edit may take a moment to propagate
    // across nodes.
    const timers = [8000, 20000, 45000].map((delay) =>
      setTimeout(() => { refetchVideo().catch(() => {}); }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [refetchVideo]);

  // Record watch history when video loads (if tracking is enabled)
  useEffect(() => {
    // A handle records history just as well as a Hive name: this is 3Speak's
    // own store, not the chain. Without it an incubating viewer built no
    // history, so nothing could be hidden from them later.
    const historyUser = user || incubationHandle;
    if (scheduled || !historyUser || !author || !permlink || author === 'unknown' || watchHistoryEnabled === false) {
      return;
    }

    const watchKey = `${author}/${permlink}`;
    if (recordedWatchRef.current.has(watchKey)) {
      return; // Already recorded this video in this session
    }

    // Mark as recorded and send to API
    recordedWatchRef.current.add(watchKey);
    recordWatch(historyUser, author, permlink);
  }, [scheduled, user, incubationHandle, author, permlink, watchHistoryEnabled]);

  // Save mini player state on unmount or when switching videos
  const miniPlayerDataRef = useRef(null);
  const prevVideoRef = useRef(v);
  useEffect(() => {
    miniPlayerDataRef.current = {
      author,
      permlink,
      title: videoDetails?.title || '',
      currentTime: playerState.currentTime || 0,
      duration: playerState.duration || 0,
    };
  });
  // When the video param changes (clicking another video), save previous video to mini player
  useEffect(() => {
    const prevV = prevVideoRef.current;
    prevVideoRef.current = v;

    if (prevV && prevV !== v) {
      // Save the previous video's data to mini player
      const d = miniPlayerDataRef.current;
      if (d && d.author && d.author !== 'unknown') {
        setMiniPlayer(d);
      }
    }
  }, [v]);
  useEffect(() => {
    // Clear mini player when arriving at watch page
    clearMiniPlayer();
    return () => {
      const d = miniPlayerDataRef.current;
      if (d && d.author && d.author !== 'unknown') {
        setMiniPlayer(d);
      }
    };
  }, []);

  // Suggestion feeds from the checker (items already match the Card3 shape).
  // The related feed is topic/interest/creator-aware (see /feeds/related); it's
  // keyed by the current video so it re-pulls when you navigate to a new one.
  const { data: related, isLoading: relatedLoading } = useQuery({
    queryKey: ['watch-related', author, permlink],
    queryFn: () => fetchRelatedFeed(author, permlink, 24),
    enabled: !!author && author !== 'unknown' && !!permlink,
    staleTime: 5 * 60 * 1000,
  });
  const relatedItems = related?.videos || EMPTY_LIST;
  // The topic the checker resolved for THIS video — reused by the shorts rail below.
  const currentTopic = related?.currentTopic || null;
  // Recommended SHORTS, interleaved into the recommendation list the same way the
  // home feed does it. Biased to the current video's topic via `?topic=` — a BOOST
  // on the checker, not a filter, so a narrow topic still returns a full rail
  // instead of an empty one.
  //
  // Gated on the related query so we ask ONCE, with the topic already known,
  // rather than firing a topic-less request and refetching a moment later.
  const { data: relatedShorts = EMPTY_LIST } = useQuery({
    queryKey: ['watch-related-shorts', currentTopic, showNsfw],
    queryFn: async () => {
      const topicParam = currentTopic ? `&topic=${encodeURIComponent(currentTopic)}` : '';
      const url = appendNsfw(
        `${SHORTS_API_URL}?page=1&limit=${WATCH_SHORTS_LIMIT}&seed=${getFeedSeed() + WATCH_SHORTS_SEED_OFFSET}${topicParam}`,
        showNsfw,
      );
      const r = await fetch(url);
      const j = await r.json();
      return j?.shorts || EMPTY_LIST;
    },
    // Off in Settings → never requested (not fetched-then-hidden).
    enabled: inlineShorts !== false && !relatedLoading && !!permlink,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // The desktop sidebar list and the mobile list are BOTH mounted (CSS picks one),
  // so each needs its own measurement — a hidden container measures 0 and simply
  // renders no rails, which is exactly what we want.
  const desktopRecRef = useRef(null);
  const mobileRecRef = useRef(null);
  const desktopCols = useGridColumns(desktopRecRef, relatedShorts.length);
  const desktopPerRow = useShortsPerRow(desktopRecRef, relatedShorts.length);
  const mobileCols = useGridColumns(mobileRecRef, relatedShorts.length);
  const mobilePerRow = useShortsPerRow(mobileRecRef, relatedShorts.length);

  // One rail per slot, each a fresh slice — never a PARTIAL row: the tracks are 1fr
  // and stretch to fill, so a short slice would render as a few over-wide cards.
  const renderDesktopRail = useCallback((slot) => {
    if (!desktopPerRow) return null;
    const slice = relatedShorts.slice(slot * desktopPerRow, slot * desktopPerRow + desktopPerRow);
    if (slice.length < desktopPerRow) return null;
    return <ShortsRow shorts={slice} columns={desktopPerRow} />;
  }, [relatedShorts, desktopPerRow]);

  const renderMobileRail = useCallback((slot) => {
    if (!mobilePerRow) return null;
    const slice = relatedShorts.slice(slot * mobilePerRow, slot * mobilePerRow + mobilePerRow);
    if (slice.length < mobilePerRow) return null;
    return <ShortsRow shorts={slice} columns={mobilePerRow} />;
  }, [relatedShorts, mobilePerRow]);

  // Plain trending is only a fallback when the related feed is thin — and now it
  // is only FETCHED then, too. It used to run on every watch page (a ~1.4s
  // request competing with playback) while the recommendation builder below only
  // reads it when there are fewer than 5 related videos, which is the uncommon
  // case. Waiting for `related` costs one sequential request in that rare path
  // and saves the request entirely in the common one.
  const relatedIsThin = !relatedLoading && filterValidVideos(relatedItems).length < 5;
  // NOTE the `= EMPTY_LIST` defaults, not `= []`. A DISABLED query's `data` stays
  // `undefined` indefinitely, so an inline `[]` default mints a brand-new array on
  // every render. `trendingItems` is a dependency of the `suggestedVideos` memo
  // below, which feeds `useContentBatch` — an unstable identity there re-runs its
  // effect every render and spins the page into an infinite render loop, freezing
  // the whole tab (no clicks, no navigation). Harmless while the query was always
  // enabled and its data settled into a stable array; adding `enabled` is what
  // made the default permanent. Same reasoning as EMPTY_LIST at the top of this file.
  const { data: trendingItems = EMPTY_LIST, isLoading: trendingLoading } = useQuery({
    queryKey: ['watch-trending'],
    queryFn: () => fetchTrendingFeed(24),
    enabled: relatedIsThin,
    staleTime: 5 * 60 * 1000,
  });
  const { data: authorItems = EMPTY_LIST, isLoading: authorVideosLoading } = useQuery({
    queryKey: ['watch-author-videos', author],
    queryFn: () => fetchAuthorVideos(author, 12),
    enabled: !!author && author !== 'unknown',
    staleTime: 60 * 1000,
  });
  const suggestionsLoading = relatedLoading;

  // Promoted videos — shown first in recommendations with a "Promoted" badge.
  const [promotedVideos, setPromotedVideos] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.VITE_CHECKER_URL}/feeds/promoted?limit=10`)
      .then(r => r.json())
      .then(d => { if (!cancelled && d?.success) setPromotedVideos(d.videos || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Smart recommendation logic:
  // 1. One promoted video first (badged)
  // 2. Show up to 4 videos from the same author
  // 3. Then show related/recommended videos
  // 4. Fall back to trending if not enough related videos
  // 5. Exclude the current video from all lists
  const suggestedVideos = useMemo(() => {
    // Track permlinks to avoid duplicates
    const usedPermlinks = new Set();
    usedPermlinks.add(permlink); // Exclude current video

    // 1. Get up to AUTHOR_VIDEOS_COUNT valid videos from the same author
    const authorVideos = filterValidVideos(authorItems)
      .filter(v => {
        if (usedPermlinks.has(v.permlink)) return false;
        usedPermlinks.add(v.permlink);
        return true;
      })
      .slice(0, AUTHOR_VIDEOS_COUNT);

    // 2. Get related/recommended videos (excluding author's videos and current)
    let recommendations = filterValidVideos(relatedItems)
      .filter(v => {
        if (usedPermlinks.has(v.permlink)) return false;
        usedPermlinks.add(v.permlink);
        return true;
      });

    // 3. If not enough related videos, supplement with trending
    if (recommendations.length < 5) {
      const validTrending = filterValidVideos(trendingItems);
      for (const video of validTrending) {
        if (!usedPermlinks.has(video.permlink) && recommendations.length < 16) {
          recommendations.push(video);
          usedPermlinks.add(video.permlink);
        }
      }
    }

    // 0. One promoted video first (excluding the current one + dupes)
    const promoted = (promotedVideos || [])
      .filter(v => v.permlink !== permlink && !usedPermlinks.has(v.permlink))
      .slice(0, 1)
      .map(v => ({ ...v, _promoted: true }));
    promoted.forEach(v => usedPermlinks.add(v.permlink));

    // Combine: promoted first, then author videos, then recommendations
    return [...promoted, ...authorVideos, ...recommendations];
  }, [authorItems, relatedItems, trendingItems, promotedVideos, author, permlink]);

  // Batch the Hive content for the recommended list so the tiles can show the
  // real comment count (the feed payload's num_comments is a hardcoded 0).
  const { getContentForVideo: getSuggestedContent } = useContentBatch(suggestedVideos);

  const suggestedVideosRef = useRef(suggestedVideos);
  suggestedVideosRef.current = suggestedVideos;

  // Batch-check which suggested videos the user has already watched
  useEffect(() => {
    if (!user || suggestedVideos.length === 0) {
      setWatchedMap(new Map());
      return;
    }
    let cancelled = false;
    const videos = suggestedVideos.map(v => ({
      author: v?.author?.username || v?.author?.id || v?.author || v?.owner,
      permlink: v.permlink,
    })).filter(v => v.author && v.permlink);

    batchCheckWatched(user, videos).then(result => {
      if (!cancelled) setWatchedMap(result);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [user, suggestedVideos]);

  // Build reactions from comment markers: video reactions use the embed URL from metadata
  const reactions = useMemo(() => {
    if (!commentMarkers) return [];
    return commentMarkers
      .filter(m => !m.isLowReputation && !m.isHidden)
      .map((m, i) => {
        const base = {
          id: `reaction-${i}`,
          author: m.label,
          avatar: m.avatar,
          replyCount: m.replyCount,
          pct: m.pct,
          pctIsSeconds: m.pctIsSeconds,
        };
        if (m.isVideo && m.videoUrl) {
          return {
            ...base,
            type: 'video',
            videoUrl: m.videoUrl,
            permlink: m.permlink,
            body: m.body,
          };
        }
        return {
          ...base,
          type: 'comment',
          body: m.body,
          permlink: m.permlink,
        };
      });
  }, [commentMarkers]);

  const reactionCountLabel = useMemo(() => {
    const videoCount = reactions.filter(r => r.type === 'video').length;
    const commentCount = reactions.length - videoCount;
    return (
      <>
        {videoCount > 0 && <><MdVideocam size={14} /> {videoCount}</>}
        {videoCount > 0 && commentCount > 0 && <span style={{ margin: '0 4px' }}>·</span>}
        {commentCount > 0 && <><MdChatBubble size={12} /> {commentCount}</>}
      </>
    );
  }, [reactions]);

  const handleSelectReaction = useCallback((index) => {
    if (index < 0 || index >= (reactions?.length ?? 0)) return;
    setSelectedReactionIndex(index);
    setReactionsVisible(true);
    // Seek main video to this reaction's timeline position (only if it has a timestamp)
    const reaction = reactions[index];
    if (reaction && reaction.pct !== null && playerState.duration > 0) {
      seek(reaction.pct);
    }
  }, [reactions, playerState.duration, seek]);

  // When loading with ?t= parameter and reactions are available, select the closest reaction
  const initialReactionSetRef = useRef(false);
  useEffect(() => {
    if (initialReactionSetRef.current) return;
    if (!reactions || reactions.length === 0) return;
    const startTime = parseInt(searchParams.get('t'), 10);
    if (!(startTime > 0)) return;

    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < reactions.length; i++) {
      const dist = Math.abs(reactions[i].pct - startTime);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    initialReactionSetRef.current = true;
    setSelectedReactionIndex(closestIdx);
    setReactionsVisible(true);
  }, [reactions, searchParams]);

  const isNetworkError = videoIsError && !videoDetails;
  const isLoading = scheduled ? scheduledLoading : videoLoading;

  if (authorHidden) {
    return (
      <div className="watch-error">
        <p>This video is not available.</p>
        <button className="watch-error-retry" onClick={() => navigate('/')}>Go Home</button>
      </div>
    );
  }

  // Do NOT block the whole page on `isLoading`.
  //
  // The player needs only author/permlink — both parsed from the URL with zero
  // I/O — but the <video> element lives in the JSX below and `loadVideo` waits on
  // `videoAttached`. A full-page loader here made the chain strictly serial:
  // Hive RPC (condenser_api.get_content) → render → element attaches →
  // /api/embed → playable URL. Rendering straight away lets /api/embed run
  // CONCURRENTLY with the RPC, so playback no longer waits on metadata it does
  // not need. Both this component and PlayVideo treat `videoDetails` as optional
  // (PlayVideo has zero unguarded derefs plus its own `mediaLoading` prop), so
  // title/description/stats simply fill in when the RPC lands.
  //
  // The "not found" branch must therefore wait for loading to FINISH — otherwise
  // every video flashes an error before its metadata arrives.
  if (!isLoading && !videoDetails) {
    return (
      <div className="watch-error">
        <p>{scheduled
          ? 'Scheduled post not found — it may have already been published or cancelled.'
          : (isNetworkError ? 'Network error. Please check your connection.' : 'Video not found or failed to load.')}</p>
        {scheduled
          ? <button className="watch-error-retry" onClick={() => navigate('/profile')}>Back to profile</button>
          : <button className="watch-error-retry" onClick={() => refetchVideo()}>Retry</button>}
      </div>
    );
  }

  return (
    <div className={`play-container${isReactionPlayerVisible && reactions.length > 0 ? ` reaction-${reactionSize}` : ''}${v2 ? ' watch-v2' : ''}`}>
      {/* Put the video's title in the browser tab (Helmet → <title>). SEOHead
          appends " | 3Speak"; falls back to the default title when unknown. */}
      {videoDetails?.title && (
        <SEOHead
          title={videoDetails.title}
          author={author}
          url={`https://3speak.tv/watch?v=${author}/${permlink}`}
        />
      )}
      <AmbientGlow getVideoEl={() => player?.element} glowMode={glowMode} />
      <PlayVideo
        belowPlayerSlot={(
          <>
        {/* 🔐 The creator's own guest list, shown only to them. Server re-checks
            ownership on every call, so rendering this is a convenience, not a
            permission. Keyed on the EMBED asset id, which is what the gate knows
            the video by and is not always the Hive permlink. */}
        {isGatedPost && user && author && user.toLowerCase() === String(author).toLowerCase() && (
          <GuestListEditor permlink={gateVideoId || permlink} />
        )}
        {/* 🔐 Paywall banner for supporters-only posts. Below the player rather
            than covering it: what is playing above is the free preview, and
            hiding that would remove the very thing meant to sell the
            subscription. */}
        {isGatedPost && gatedPlayback.isLocked && (
          <div className="gated-paywall" role="status">
            <div className="gated-paywall__lock" aria-hidden="true">🔒</div>
            <div className="gated-paywall__text">
              <strong>Supporters only</strong>
              <span>
                {gatedPlayback.state === 'error'
                  ? 'We could not confirm your subscription just now. Try again in a moment.'
                  : gatedPlayback.previewUrl
                    ? 'You are watching a free preview. 3Speak Pro unlocks the full video.'
                    : 'This video is available to 3Speak Pro subscribers.'}
              </span>
            </div>
            <a className="gated-paywall__cta" href="/wallet">Get 3Speak Pro</a>
          </div>
        )}
          </>
        )}
        v2={v2}
        videoDetails={videoDetails}
        author={author}
        permlink={permlink}
        isLive={isLive}
        streamRoom={videoDetails?.roomName}
        liveChatSlot={isLive ? liveChatSlot : null}
        onLiveChatSent={mirrorChatToHive}
        vodAssetPending={vodProcessing}
        onStreamRoomMeta={setStreamRoomMeta}
        mediaUnavailable={!isLive && mediaUnavailable}
        mediaBlocked={!isLive && playbackBlocked}
        onRetryPlayback={retryPlayback}
        mediaLoading={!isLive && mediaLoading}
        videoRef={videoRef}
        adPlaying={sponsorVisible}
        sponsorLabel={sponsorVisible ? (
          // A node, not a string: the disclosure now names the advertiser, their
          // product and their slogan, and draws their logo. AdOverlay is the same
          // component the /advertise preview uses, so what an advertiser was shown
          // while setting it up is what a viewer actually gets.
          <AdOverlay
            account={adBreakRef.current.info?.brand?.account || null}
            brand={adBreakRef.current.info?.brand || null}
            resumeIn={resumeIn}
          />
        ) : null}
        adCountdown={adCountdown}
        adSkip={sponsorVisible && adBreakRef.current?.skipOffered ? (
          <AdSkip secondsUntil={skipIn} onSkip={canSkipAd ? skipAd : null} />
        ) : null}
        bannerHit={(
          // Nothing is drawn for a banner — it is already in the picture. This is
          // only somewhere to click, and only while it is on screen.
          // videoElRef, NOT videoRef. `videoRef` on this page is a CALLBACK ref — a
          // function React invokes with the element — so `videoRef.current` was
          // always undefined, every measurement bailed before it measured anything,
          // and the click target rendered nothing at all. `videoElRef` is the object
          // ref that actually holds the element.
          <BannerClick
            videoRef={videoElRef}
            placement={adBreakRef.current.bannerInfo?.placement}
            overlay={adBreakRef.current.bannerOverlay}
            visible={bannerVisible}
            clickUrl={adBreakRef.current.bannerInfo?.brand?.clickUrl}
            advertiser={adBreakRef.current.bannerInfo?.advertiser}
            onDismiss={dismissBanner}
          />
        )}
        wrapperRef={wrapperRef}
        playlistData={showPlaylist ? playlistData : null}
        onClosePlaylist={() => setShowPlaylist(false)}
        onVideoEdited={handleVideoEdited}
        overrideBody={editOverride?.body}
        scheduled={scheduled}
        scheduledOn={scheduledDoc?.scheduledOn}
        onEditScheduled={() => { pause(); setScheduledEditOpen(true); }}
        videoControls={{
          /* 🚨 THE TIMELINE IS DRAWN IN CONTENT SECONDS, NOT THE FILE'S.
           *
           * The spot is stitched into the manifest, so the file is longer than the
           * creator's video by exactly the ad and every position after the cut sits
           * that much further along. A bar measured against the file therefore shows
           * a region belonging to the ad and puts every chapter marker, every heatmap
           * peak and every scrub thumbnail out by the ad's length once past it.
           *
           * VideoControls is a pure function of currentTime, duration and onSeek, so
           * mapping those three here makes the whole control content-native — the
           * progress fill, the markers, the preview and the clock — with nothing
           * inside it needing to know an ad exists.
           *
           * While the spot runs, contentTime() pins to the cut point, so the bar
           * holds still for the ad's length rather than advancing through seconds the
           * creator never made. That is also why the ad cannot be scrubbed into any
           * more: no content second maps inside it. */
          currentTime: adBreakRef.current.contentTime(playerState.currentTime),
          duration: adBreakRef.current.contentDuration(playerState.duration),
          // A fraction of the FILE, so it has to be re-expressed as a fraction of the
          // content or the buffered bar runs ahead of the fill it sits behind.
          buffered: (() => {
            const ab = adBreakRef.current;
            const d = ab.contentDuration(playerState.duration);
            if (!(d > 0) || !(playerState.duration > 0)) return playerState.buffered;
            return Math.min(1, ab.contentTime(playerState.buffered * playerState.duration) / d);
          })(),
          isPlaying: !playerState.paused,
          isMuted: playerState.muted,
          volume: playerState.volume,
          isFullscreen,
          isVisible: controlsVisible,
          onTogglePlay: togglePlay,
          onToggleMute: () => setMuted(!playerState.muted),
          onVolumeChange: (val) => {
            setVolume(val);
            if (val === 0) {
              setMuted(true);
            } else if (playerState.muted) {
              setMuted(false);
            }
          },
          /* Ten seconds of the VIDEO, not of the file. Stepping back over a spot in
             file seconds would land inside it and then be bounced out again. */
          onSeekBackward: () => {
            const ab = adBreakRef.current;
            const at = ab.contentTime(playerState.currentTime);
            seek(ab.playerTimeFor(Math.max(0, at - 10)));
          },
          onSeekForward: () => {
            const ab = adBreakRef.current;
            const at = ab.contentTime(playerState.currentTime);
            const end = ab.contentDuration(playerState.duration);
            seek(ab.playerTimeFor(Math.min(end, at + 10)));
          },
          // The bar hands back a content second; the player needs the file's.
          onSeek: (t) => seek(adBreakRef.current.playerTimeFor(t)),
          onRefreshReactions: refreshMarkers,
          onToggleFullscreen: handleToggleFullscreen,
          onMouseMove: showControlsTemporarily,
          onToggleControls: toggleControlsVisibility,
          onPause: pause,
          onReactToMoment: handleReactToMoment,
          markers: resolvedMarkers,
          replayHeatmap,
          previewVideoId: playerLoadId,
          getPlaybackHeight,
          onMarkerSelect: handleSelectReaction,
          onCycleReactionSize: isReactionPlayerVisible && reactions.length > 0 ? cycleReactionSize : null,
          reactionSizeLabel: REACTION_SIZE_LABELS[reactionSize] || reactionSize,
          onTogglePip: handleTogglePip,
          videoEnded,
          onReplay: handleReplay,
          onClipModeChange: (active) => { clipModeActiveRef.current = active; },
          onPopupOpen: (open) => { popupOpenRef.current = open; },
          autoplayBlocked,
          onAutoplayTap: togglePlay,
          autoplayNext,
          onToggleAutoplay: toggleAutoplayNext,
          endSuggestions: suggestedVideos
            .filter(v => {
              const a = v?.author?.username || v?.author?.id || v?.author || v?.owner;
              const key = `${a}/${v.permlink}`;
              return !playedVideosRef.current.has(key) && !watchedMap.has(key);
            })
            .slice(0, 5),
          qualityLevels,
          currentQuality,
          onQualityChange: handleQualityChange,
          glowMode,
          onToggleGlow: toggleGlow,
          subtitleLanguages,
          selectedSubtitleLang,
          onSubtitleChange: selectSubtitleLang,
          subtitleLoading,
          subtitleCues,
          // CONTENT time, not player time. Cues are timed against the creator's
          // video; a stitched spot pushes everything after it later in the PLAYER's
          // timeline, so raw currentTime runs every cue early by the length of the
          // spot for the whole rest of the video. Same mapping the watch tracking
          // already uses, and for the same reason.
          subtitleCurrentTime: adBreakRef.current.contentTime(playerState.currentTime),
          subtitleStyle,
          onSubtitleStyleChange: updateSubtitleStyle,
          playbackRate: playerState.playbackRate,
          onPlaybackRateChange: setPlaybackRate,
          onHoldControls: holdControls,
          onReleaseControls: releaseControls,
        }}
        mobileReactionPanel={
          <>
            {isReactionPlayerVisible && reactions.length > 0 && (
              <ReactionPlayer
                reactions={reactions}
                selectedIndex={selectedReactionIndex}
                onSelectReaction={handleSelectReaction}
                onClose={() => setReactionsVisible(false)}
                size={reactionSize}
                onCycleSize={cycleReactionSize}
                currentTime={playerState.currentTime}
                duration={playerState.duration}
                mainIsPlaying={!playerState.paused}
                onReactionPlay={pause}
                mobile
              />
            )}
            {!isReactionPlayerVisible && reactions.length > 0 && (
              <button className="show-reactions-btn" onClick={() => setReactionsVisible(true)}>
                Show Reactions ({reactionCountLabel})
              </button>
            )}
            {reactions.length === 0 && (
              <button className="show-reactions-btn" onClick={handleAddReaction}>
                Add Reaction
              </button>
            )}
          </>
        }
        cinemaReactionPanel={reactionSize === 'cinema' ? (
          <>
            {isReactionPlayerVisible && reactions.length > 0 && (
              <ReactionPlayer
                reactions={reactions}
                selectedIndex={selectedReactionIndex}
                onSelectReaction={handleSelectReaction}
                onClose={() => setReactionsVisible(false)}
                size={reactionSize}
                onCycleSize={cycleReactionSize}
                currentTime={playerState.currentTime}
                duration={playerState.duration}
                mainIsPlaying={!playerState.paused}
                onReactionPlay={pause}
              />
            )}
            {!isReactionPlayerVisible && reactions.length > 0 && (
              <button className="show-reactions-btn" onClick={() => setReactionsVisible(true)}>
                Show Reactions ({reactionCountLabel})
              </button>
            )}
            {reactions.length === 0 && (
              <button className="show-reactions-btn" onClick={handleAddReaction}>
                Add Reaction
              </button>
            )}
          </>
        ) : null}
      />

      {/* Right column: Reaction Player (or, while live, the chat) + Recommended */}
      <div className="right-column">
        {/* A live stream has nothing to react TO yet, and the chat is the whole
            point of watching one — so it takes the reaction panel's slot until
            the recording is published, at which point this reverts to reactions
            and the page becomes an ordinary watch page. Filled by a portal from
            <LiveStreamPlayer>; empty until the room connects. */}
        {isLive && (
          <div className="live-chat-column">
            <div className="live-chat-column__head">Live chat</div>
            <div className="live-chat-column__body" ref={setLiveChatSlot} />
          </div>
        )}
        {/* Reactions and the transcript share the top of this column. With no
            transcript to offer (or on a phone, where it just gets in the way)
            this renders the reaction panel alone, exactly as it did before. */}
        {!isLive && (
          <WatchTabs
            author={author}
            permlink={permlink}
            currentTime={playerState.currentTime}
            onSeek={seek}
            reactionPanel={
              <>
                {isReactionPlayerVisible && reactions.length > 0 && (
                  <ReactionPlayer
                    reactions={reactions}
                    selectedIndex={selectedReactionIndex}
                    onSelectReaction={handleSelectReaction}
                    onClose={() => setReactionsVisible(false)}
                    size={reactionSize}
                    currentTime={playerState.currentTime}
                    duration={playerState.duration}
                    mainIsPlaying={!playerState.paused}
                    onReactionPlay={pause}
                  />
                )}
                {!isReactionPlayerVisible && reactions.length > 0 && (
                  <button className="show-reactions-btn" onClick={() => setReactionsVisible(true)}>
                    Show Reactions ({reactionCountLabel})
                  </button>
                )}
                {reactions.length === 0 && (
                  <button className="show-reactions-btn" onClick={handleAddReaction}>
                    Add Reaction
                  </button>
                )}
              </>
            }
          />
        )}

        {suggestedVideos.length > 0 && (
          <div className="right-column-videos" ref={desktopRecRef}>
            <h4>More videos</h4>
            <Card3
              videos={suggestedVideos}
              loading={false}
              shortTimeAgo={false}
              getContentForVideo={getSuggestedContent}
              interleaveEvery={desktopCols > 0 && relatedShorts.length ? desktopCols * WATCH_ROWS_PER_SHORTS_RAIL : 0}
              renderInterleave={relatedShorts.length ? renderDesktopRail : null}
            />
          </div>
        )}
      </div>

      {suggestedVideos.length > 0 && (
        <div className="mobile-recommended" ref={mobileRecRef}>
          <h4>More videos</h4>
          <Card3
            videos={suggestedVideos.slice(0, 12)}
            loading={false}
            shortTimeAgo={false}
            getContentForVideo={getSuggestedContent}
            interleaveEvery={mobileCols > 0 && relatedShorts.length ? mobileCols * WATCH_ROWS_PER_SHORTS_RAIL : 0}
            renderInterleave={relatedShorts.length ? renderMobileRail : null}
          />
        </div>
      )}

      {/* Scheduled-post editor popup — opened by the pen on the watch page so the
          author stays on the video instead of being sent to /draft. */}
      <EditScheduledModal
        isOpen={scheduled && scheduledEditOpen}
        permlink={permlink}
        onClose={() => setScheduledEditOpen(false)}
        onSaved={() => { setScheduledEditOpen(false); setScheduledRefreshKey((k) => k + 1); }}
        onCancelled={() => { setScheduledEditOpen(false); navigate('/profile'); }}
      />
    </div>
  );
}

export default Watch;
