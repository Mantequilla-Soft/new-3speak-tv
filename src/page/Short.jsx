import { SHORTS_ADS_ENABLED } from '../utils/config';

/* How long a spot may sit there without producing a frame before we give the feed back.
 *
 * Needed because the countdown now starts on PLAYBACK rather than on arrival. That is
 * what stops an 8 second spot being cut short by loading, but it also means a spot that
 * never plays would hold the surface forever, where the old on-arrival timer would at
 * least have run out. Nothing is charged for it either way: an impression is recorded
 * from the measured segments, which a spot that never played never fetches. */
const SHORTS_AD_START_TIMEOUT_MS = 8000;
import { countShortWatched, requestShortsAd } from '../lib/shortsAd';
import ShortsAdOverlay from '../components/ads/ShortsAdOverlay';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import "./Short.scss";
import {
  Heart,
  MessageSquare,
  Share2,
  Music2,
  ArrowUp,
  ArrowDown,
  X,
  SlidersHorizontal,
  Loader2,
  Play,
  Pause,
  Send,
  ChevronUp,
  ChevronDown,
  ArrowLeft,
  Bookmark,
  ExternalLink,
  Video,
  MessageSquareText,
  Camera,
  Volume2,
  VolumeX,
  Repeat,
  ChevronsUp,
  Square,
  RotateCcw,
  Repeat2,
  WandSparkles,
  Pencil,
  Moon,
  Lightbulb,
  Sun,
  Film,
  Music,
} from 'lucide-react';
import { GiTwoCoins } from 'react-icons/gi';
import { MdTranslate, MdClosedCaption, MdClosedCaptionOff, MdFlag } from 'react-icons/md';
import mantequillaLogo from '../assets/mantequilla-logo.png';
import ReportModal, { isReported } from '../components/modal/ReportModal';
import { Flag } from 'lucide-react';
import ShareChooserModal from '../components/Chat/ShareChooserModal';
import { useMyPlaylists, isVideoInPlaylist } from '../hooks/useMyPlaylists';
import { addToPlaylist, removeFromPlaylist, createPlaylistAndAdd } from '../utils/playlistOperations';
import useTranslation from '../hooks/useTranslation';
import TranslateButton from '../components/TranslateButton/TranslateButton';
import useSubtitles from '../hooks/useSubtitles';
import SubtitleOverlay from '../components/SubtitleOverlay/SubtitleOverlay';
import { SUPPORTED_LANGUAGES } from '../utils/translate';
import EmojiGifPicker from '../components/common/EmojiGifPicker/EmojiGifPicker';
import { insertAtCursor, gifMarkdown } from '../utils/composerInsert';
import { prefetchVideoTagsV2 } from '../utils/tagsV2';

// Custom Hive Icon Component
const HiveIcon = ({ size = 24, className = '' }) => (
  <svg
    role="img"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    className={className}
    fill="currentColor"
  >
    <path d="M6.076 1.637a.103.103 0 00-.09.05L.014 11.95a.102.102 0 000 .104l6.039 10.26c.04.068.14.068.18 0l5.972-10.262a.102.102 0 00-.002-.104L6.166 1.687a.103.103 0 00-.09-.05zm2.863 0c-.079 0-.13.085-.09.154l5.186 8.967a.105.105 0 00.09.053h3.117c.08 0 .13-.088.09-.157l-5.186-8.966a.104.104 0 00-.09-.051H8.94zm5.891 0a.102.102 0 00-.088.154L20.656 12l-5.914 10.209a.102.102 0 00.088.154h3.123a.1.1 0 00.088-.05l5.945-10.262a.1.1 0 000-.102L18.041 1.688a.1.1 0 00-.088-.051H14.83zm-.79 11.7a.1.1 0 00-.089.052l-5.101 8.82c-.04.069.01.154.09.154h3.117a.104.104 0 00.09-.05l5.1-8.82a.103.103 0 00-.09-.155h-3.118z" />
  </svg>
);
import hiveApi, { SHORTS_PAGE_SIZE, consumePreloadedShorts, hasShortsPreloaded, preloadShorts, fetchUserShortsWithDetails } from '../hive-api/hiveApi';
import { useAppStore } from '../lib/store';
import { recordWatch } from '../utils/watchHistory';
import { recordReshare, getResharesForVideo, deleteReshare } from '../utils/reshares';
import axios from 'axios';
import { Helmet } from 'react-helmet-async';
import { toastIn } from '../utils/toast';
import CommentVoteTooltip from '../components/tooltip/CommentVoteTooltip';
import { FEATURE_EDITOR } from '../utils/config';
import { getHiveRenderer } from '../lib/hiveRenderer';
import { getPlayerUrl } from '../utils/playerUrl';
import { Player, ThreeSpeakApi } from '@mantequilla-soft/3speak-player';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import AuthorBadge from '../components/AuthorBadge/AuthorBadge';
import ShortsIcon from '../components/icons/ShortsIcon';
import ShortsLoadingScreen from '../components/ShortsLoadingScreen/ShortsLoadingScreen';
import { markByReputation } from '../utils/reputation';
import { markByHidden } from '../utils/hiddenCreators';
import { getVotePower, getDynamicProps } from '../utils/hiveUtils';
import { commentWithAioha, isLoggedIn } from '../hive-api/aioha';
import AmbientGlow, { useAmbientGlow } from '../components/AmbientGlow/AmbientGlow';
import EditorModal from '../components/modal/EditorModal';
import EditVideoModal from '../components/playVideo/EditVideoModal';
import { notifyMediaPlay, onMediaPlay } from '../utils/mediaCoordinator';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';

// Every toast from this module is headed "Shorts"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Shorts');

// Thin wrapper: reads currentTime from a ref via polling to avoid re-rendering the whole Shorts page
// The Watch Later playlist is identified by NAME — same convention as the watch
// page and the add-to-playlist modal. Private, and created on first save.
const WATCH_LATER_NAME = 'Watch Later';
const generatePlaylistId = () =>
  (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function ShortsSubtitleOverlay({ timeRef, cues, style }) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!cues || cues.length === 0) return;
    const id = setInterval(() => setTime(timeRef.current), 250);
    return () => clearInterval(id);
  }, [timeRef, cues]);
  if (!cues || cues.length === 0) return null;
  return <SubtitleOverlay currentTime={time} cues={cues} style={style} />;
}

// Markdown collapses single newlines — turn them into hard breaks so multi-line
// comments keep their line breaks when rendered.
const hardBreakMd = (text) => String(text || '').replace(/\n/g, '  \n');

/* ---- Caption renderer: markdown links → clickable badges, strips HTML ---- */
function renderCaption(text) {
  if (!text) return null;
  // Remove <sup>...</sup> blocks (reply-to metadata)
  let cleaned = text.replace(/<sup>[\s\S]*?<\/sup>/gi, '');
  // Remove any remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  // Remove standalone URLs (not inside markdown link syntax)
  cleaned = cleaned.replace(/(?<!\()https?:\/\/\S+/g, '');
  // Remove markdown bold/italic
  cleaned = cleaned.replace(/[*_]{1,3}/g, '');
  // Remove markdown headers
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
  // Remove horizontal rules
  cleaned = cleaned.replace(/^---+$/gm, '');
  // Collapse whitespace
  cleaned = cleaned.replace(/\n{2,}/g, '\n').trim();

  // Split on markdown links: [text](url)
  const parts = cleaned.split(/(\[[^\]]*\]\([^)]*\))/g);
  const elements = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const linkMatch = part.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
    if (linkMatch) {
      const [, label, href] = linkMatch;
      if (label.trim()) {
        elements.push(
          <a key={i} href={href} className="captionBadge" target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            {label}
          </a>
        );
      }
    } else if (part.trim()) {
      elements.push(<span key={i}>{part}</span>);
    }
  }
  return elements.length > 0 ? elements : null;
}

// Track watch DURATION for a short (non-polluting — never increments the view
// counter). On first play we open a server-measured session
// NO ADS ON SHORTS, deliberately. This player never asks /m/session, so no spot is
// ever stitched into a short. The only slot that could fit is pre-roll, and putting
// a 15-second ad in front of a 12-second short is the same mistake as pre-rolling a
// video half the audience abandons inside 15 seconds — it would deliver an
// impression to someone who never wanted the content. If shorts ever carry ads it
// needs its own slot type, not the mid-roll rules borrowed.
//
// (POST /api/watch/start); the timeupdate handler heartbeats while it plays
// (/api/watch/beat). The backend records watched seconds + % with the viewer IP
// into `view-durations`. Uses the embed *asset* permlink (video.permlink) — the
// SAME id the player loads with; the Hive permlink 404s the lookup. A video
// lives in one collection, so we try 'embed' then 'legacy'. `watchRef.key`
// dedupes per short so a re-open doesn't start a second session.
async function startShortWatch(video, watchRef, duration, position) {
  const permlink = video?.permlink || video?.hivePermlink;
  if (!video?.author || video.author === 'unknown' || !permlink) return;
  const key = `${video.author}/${permlink}`;
  const W = watchRef.current;
  if (W.key === key && (W.sid || W.starting)) return; // already tracking this short
  watchRef.current = { sid: null, token: null, beatMs: 5000, lastBeatAt: 0, key, starting: true };
  for (const type of ['embed', 'legacy']) {
    try {
      const res = await fetch(`${getPlayerUrl()}/api/watch/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: video.author, permlink, type, duration: duration || undefined, position: position || 0, source: '3speak', private: !!useAppStore.getState().privateMode }),
      });
      if (!res.ok) continue;                          // 404 for the wrong collection → try next
      const data = await res.json().catch(() => null);
      if (watchRef.current.key !== key) return;       // short changed while awaiting
      if (data?.sid) {
        watchRef.current = { sid: data.sid, token: data.token, beatMs: (data.beatSeconds || 5) * 1000, lastBeatAt: Date.now(), key, starting: false };
        return;
      }
      if (data && data.tracked === false) break;      // no measurable duration
    } catch { /* try next type */ }
  }
  if (watchRef.current.key === key) watchRef.current.starting = false;
}

// Send one measured heartbeat for the active short. Best-effort.
// fetch(keepalive) — not sendBeacon: the beat is cross-origin to PLAYER_URL with
// a JSON body (not CORS-safelisted), which a beacon can drop; keepalive survives
// unload and does a proper CORS request.
function shortWatchBeat(watchRef, position) {
  const W = watchRef.current;
  if (!W.sid) return;
  W.lastBeatAt = Date.now(); // throttle before the async call
  try {
    fetch(`${getPlayerUrl()}/api/watch/beat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sid: W.sid, token: W.token, position: position || 0 }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* best-effort */ }
}

/* ================= COMPONENT ================= */
const VideoShort = () => {
  const { user, authenticated, watchHistoryEnabled } = useAppStore();
  // Shorts feed mode — 'discover' (everything, interests just boost the ranking) or
  // 'interests' (ONLY shorts whose winning topic is one of mine). Persisted in the
  // store. Never applies to a creator's feed (?user=…), which stays date-sorted.
  const shortsFeedMode = useAppStore((s) => s.shortsFeedMode);
  const setShortsFeedMode = useAppStore((s) => s.setShortsFeedMode);
  const myInterests = useAppStore((s) => s.interests);
  const hasInterests = Array.isArray(myInterests) && myInterests.length > 0;
  const interestsMode = shortsFeedMode === 'interests' && hasInterests;
  // Optional comment input under the short (Settings → "Comment bar on shorts").
  const shortsCommentBar = useAppStore((s) => s.shortsCommentBar);
  const { translate: onTranslate, getTranslation, clearTranslation, translating } = useTranslation();
  // The spot currently interrupting the feed, or null. Held here rather than in the
  // videos array on purpose: an ad is not a short, and injecting one into the feed
  // would hand it comments, votes, an author and a permlink it does not have.
  const [shortsAd, setShortsAd] = useState(null);
  const [adSecondsLeft, setAdSecondsLeft] = useState(0);
  const adBusyRef = useRef(false);
  // A spot the server has already handed over, waiting for the next swipe to play it
  // on. Held in a ref rather than state on purpose: it must not render anything until
  // it is consumed, and a re-render between arriving and being taken would be noise.
  const pendingAdRef = useRef(null);
  // While this is true the surface belongs to the ADVERTISER. The short underneath is
  // only paused, so every piece of chrome that names its creator or acts on their post
  // has to stand down — see the `.ad-playing` block in Short.scss and the guard in
  // quickUpvote(). Leaving them up attributes the spot to the creator, and a stray tap
  // would vote or comment on their post while somebody else's ad is on screen.
  const adPlaying = SHORTS_ADS_ENABLED && !!shortsAd;
  // Has the spot actually put a frame on screen yet? Until it has, the shared <video>
  // is showing black — it was handed a new source and has to fetch a playlist and a
  // segment before it can paint. That gap cannot be prefetched away (lib/shortsAd.js
  // explains why), so it is COVERED instead: the overlay draws the advertiser's card
  // over the top until this flips.
  //
  // Driven off the first timeupdate with a real currentTime rather than the `play`
  // event, because `play` fires when playback is requested, not when a frame lands —
  // covering only until `play` would uncover onto the same black.
  const [adStarted, setAdStarted] = useState(false);
  const adPlayingRef = useRef(false);
  adPlayingRef.current = adPlaying;
  const [currentIndex, setCurrentIndex] = useState(0);
  const currentIndexRef = useRef(0);
  currentIndexRef.current = currentIndex;

  const [videos, setVideos] = useState([]);
  const videosRef = useRef([]);
  videosRef.current = videos;
  // Desktop opens the comments side-panel by default; mobile keeps it closed
  // (it's a full-screen bottom sheet there).
  const [showComments, setShowComments] = useState(() => typeof window !== 'undefined' && window.innerWidth > 768);
  const [newComment, setNewComment] = useState('');
  const mainCommentRef = useRef(null);
  const bottomCommentRef = useRef(null);
  const [shareChooserOpen, setShareChooserOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [parentCardVisible, setParentCardVisible] = useState(() => {
    const stored = localStorage.getItem('3speak-chain-visible');
    return stored !== null ? stored === '1' : true;
  });
  const [expandedChainCard, setExpandedChainCard] = useState(null);
  const chainRowRef = useRef(null);
  const chainDragRef = useRef({ isDown: false, startX: 0, scrollLeft: 0 });
  const [shortNavLoading, setShortNavLoading] = useState(false);
  const [firstPlayerReady, setFirstPlayerReady] = useState(false);
  const shortHistoryRef = useRef([]); // Stack of {author, permlink} for back navigation
  const isNavigatingBackRef = useRef(false); // Prevents URL-change effect from pushing to history on back

  // Editor modal state
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [isEditShortOpen, setIsEditShortOpen] = useState(false);
  const [editorVideoUrl, setEditorVideoUrl] = useState(null);
  const [editorVideoName, setEditorVideoName] = useState(null);
  const [editorOriginalAuthor, setEditorOriginalAuthor] = useState(null);
  const [editorOriginalPermlink, setEditorOriginalPermlink] = useState(null);
  const [editorOriginalShortPermlink, setEditorOriginalShortPermlink] = useState(null);
  const [editorVideoType, setEditorVideoType] = useState('video');
  const [remixDropdownOpen, setRemixDropdownOpen] = useState(false);
  const remixDropdownRef = useRef(null);

  // Ambient glow
  const { glowMode, toggleGlow } = useAmbientGlow();

  // Player state
  const [isPlaying, setIsPlaying] = useState(false);

  // Cross-player coordination — announce play, pause when another player starts.
  useEffect(() => {
    if (isPlaying) notifyMediaPlay('short');
  }, [isPlaying]);
  useEffect(() => onMediaPlay('short', () => {
    try { playerRef.current?.pause?.(); } catch {}
  }), []);
  const [isMuted, setIsMuted] = useState(() => {
    const stored = localStorage.getItem('3speak-muted');
    if (stored !== null) return stored === '1';
    // Fallback: read legacy cookie
    const cookie = document.cookie.split('; ').find(c => c.startsWith('shorts_muted='));
    return cookie ? cookie.split('=')[1] !== '0' : false;
  });
  // Playback mode: 'auto-replay' (loop), 'auto-swipe' (next near end), 'none' (stop + replay)
  const [playbackMode, setPlaybackMode] = useState(() => {
    const cookie = document.cookie.split('; ').find(c => c.startsWith('shorts_playback_mode='));
    return cookie ? cookie.split('=')[1] : 'auto-replay';
  });
  const playbackModeRef = useRef(playbackMode);
  const [showModeIndicator, setShowModeIndicator] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const modeIndicatorTimeoutRef = useRef(null);
  const autoSwipeTriggeredRef = useRef(false);
  // currentTime/duration as refs instead of state to avoid re-renders on every timeupdate (~4x/sec)
  // Progress bar is updated directly via DOM refs
  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const progressFillRef = useRef(null);
  const progressHandleRef = useRef(null);
  const updateProgressBar = useCallback(() => {
    const pct = durationRef.current > 0 ? (currentTimeRef.current / durationRef.current) * 100 : 0;
    if (progressFillRef.current) progressFillRef.current.style.width = `${pct}%`;
    if (progressHandleRef.current) progressHandleRef.current.style.left = `${pct}%`;
  }, []);
  const [showPlayPauseIcon, setShowPlayPauseIcon] = useState(false);
  const [showMuteIcon, setShowMuteIcon] = useState(false);
  const [showHeartAnimation, setShowHeartAnimation] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [postingComment, setPostingComment] = useState(false);

  // Vote tooltip state
  const [showTooltip, setShowTooltip] = useState(false);
  const [activeTooltipPermlink, setActiveTooltipPermlink] = useState(null);
  const [selectedComment, setSelectedComment] = useState({ author: '', permlink: '' });
  const [weight, setWeight] = useState(100);
  const [voteValue, setVoteValue] = useState(0.0);
  const [accountData, setAccountData] = useState(null);
  // Pre-cached vote data (fetched once on mount, refreshed after each vote)
  const cachedDynamicPropsRef = useRef(null);
  const voteDataReady = useRef(false);

  // Rendered comment bodies (permlink -> HTML string)
  const [renderedBodies, setRenderedBodies] = useState({});

  // Reshare state
  const [reshareCount, setReshareCount] = useState(0);
  const [hasReshared, setHasReshared] = useState(false);
  const [reshareUsers, setReshareUsers] = useState([]); // [{username, reshared_at}]

  const [isReportOpen, setIsReportOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState({ type: 'video', author: '', permlink: '' });

  // Reply state
  const [activeReply, setActiveReply] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [translatedCaption, setTranslatedCaption] = useState(null);

  // Autoplay blocked fallback (iOS Low Power Mode, etc.)
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  // Touch/swipe state for mobile navigation
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState(null); // 'up' | 'down' | null
  const [swipeDragY, setSwipeDragY] = useState(0); // live drag offset in px
  const swipeAnimRef = useRef(null);
  // Wheel cooldown. A ref so it survives the effect being torn down and rebuilt, which
  // happens on every render — see the wheel handler below.
  const wheelLockRef = useRef(false);
  const touchStartYRef = useRef(null); // Synchronous mirror of touchStart for gesture detection

  const progressBarRef = useRef(null);
  const playPauseTimeoutRef = useRef(null);
  const commentsFetchedRef = useRef(new Set());
  const recordedShortsViewsRef = useRef(new Set()); // author/permlink already view-counted
  // Active short's watch-duration session (server-measured heartbeat, non-polluting).
  const shortWatchRef = useRef({ sid: null, token: null, beatMs: 5000, lastBeatAt: 0, key: null, starting: false });
  // Watch time only counts while this tab is the one in front. A short left
  // playing in a background tab used to beat exactly like a watched one. There
  // is no long-form exception here (the one in useWatchDuration covers videos
  // past 20 minutes, where background listening is the actual use case) — a
  // short playing out of sight is a forgotten tab, not an audience.
  const shortVisibleRef = useRef(typeof document === 'undefined' || document.visibilityState !== 'hidden');
  const videoContainerRef = useRef(null);
  const playerRef = useRef(null); // Single persistent SDK Player instance
  const videoElRef = useRef(null); // Single persistent <video> element ref
  const handleNextRef = useRef(null); // Ref mirror of handleNext for use in Player event handlers
  const sdkApiRef = useRef(new ThreeSpeakApi(getPlayerUrl())); // Shared API for prefetching
  const prefetchedSourcesRef = useRef(new Map()); // Cache: videoId -> VideoSource (from prefetch)
  const prefetchingRef = useRef(new Set()); // Track in-flight prefetch requests
  const keyboardRef = useRef(null); // capture keyboard events on mobile when focused
  const prevIndexRef = useRef(0); // Track previous index
  const prevVideoIdRef = useRef(null); // Track previous video id to avoid re-running play on enrichment
  const readyPlayers = useRef(new Set()); // Track which SDK players have fired 'ready'
  const [readyPlayerIds, setReadyPlayerIds] = useState(new Set()); // State mirror for render gating
  const pendingPlayRef = useRef(null); // Track video waiting to be played
  const chainPreloadDataRef = useRef(new Map()); // Chain short metadata for instant navigation
  const loadingMoreRef = useRef(false); // Prevent concurrent loadMore calls

  // Gesture detection refs
  const tapCountRef = useRef(0);
  const tapTimerRef = useRef(null);
  const longPressTimerRef = useRef(null);
  const gestureHandledRef = useRef(false); // Prevent touch + click double-fire
  const muteIconTimeoutRef = useRef(null);
  const heartAnimTimeoutRef = useRef(null);
  const isMutedRef = useRef(isMuted); // Mirror of isMuted for use inside message handler closure
  const mouseLongPressRef = useRef(null); // Timer for desktop mouse long-press
  const mouseLongPressHandledRef = useRef(false); // Tracks whether mouse long-press fired
  const recentTouchRef = useRef(false); // Guards click handler from firing after touch events
  const wasPlayingBeforePopupRef = useRef(false); // Tracks play state before vote popup opens

  const commentsDragStartY = useRef(null); // Drag handle touch start Y
  const commentsPanelRef = useRef(null); // Ref for comments panel element

  const accessToken = localStorage.getItem("access_token");
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const isStoriesMode = location.pathname.includes('/shorts/stories');

  // User-specific feed mode: when ?user=username is in the URL, load from the per-user endpoint
  const feedUser = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('user') || null;
  }, [location.search]);
  const feedUserRef = useRef(feedUser);
  feedUserRef.current = feedUser;

  // Minimum swipe distance to trigger navigation (in pixels)
  const minSwipeDistance = 50;

  // Get shared video from URL parameter
  const getSharedVideoFromUrl = useCallback(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const videoParam = urlParams.get('v');
    if (videoParam) {
      const [author, permlink] = videoParam.split('/');
      if (author && permlink) {
        return { author, permlink };
      }
    }
    return null;
  }, []);

  // Update URL when current video changes (without page reload)
  const updateUrlWithCurrentVideo = useCallback((video) => {
    if (!video) return;
    const newUrl = `${window.location.pathname}?v=${video.author}/${video.permlink}`;
    window.history.replaceState({}, '', newUrl);
  }, []);

  /* ---------- 3SPEAK SDK PLAYER API ---------- */

  // Get stable player id for a video
  // Get the persistent SDK player
  const getPlayer = useCallback(() => {
    return playerRef.current || null;
  }, []);

  // Send command to the persistent SDK player
  const sendCommandToVideo = useCallback((video, command, data = {}) => {
    if (!video) return;
    const player = playerRef.current;
    if (!player || player.destroyed) {
      console.log(`[VideoShort] No SDK player available`);
      return;
    }
    switch (command) {
      case 'play': player.play(); break;
      case 'pause': player.pause(); break;
      case 'toggle-play': player.togglePlay(); break;
      case 'mute': player.setMuted(true); break;
      case 'unmute': player.setMuted(false); break;
      case 'seek': player.seek(data.time || 0); break;
      default: console.warn(`[VideoShort] Unknown command: ${command}`);
    }
  }, []);

  // Send command to current video
  const sendCommand = useCallback((command, data = {}) => {
    const currentVid = videos[currentIndex];
    sendCommandToVideo(currentVid, command, data);
  }, [videos, currentIndex, sendCommandToVideo]);

  // Has the user interacted with the page yet? Browsers only permit autoplay while
  // MUTED until then — and, crucially, if you UN-mute a muted-autoplaying video
  // without user activation, Chrome/Safari respond by PAUSING it.
  //
  // That's exactly what broke "Open shorts on start": the app auto-navigates to
  // /shorts with no interaction yet, we'd start muted (fine), then immediately
  // restore the user's "unmuted" preference — and the browser paused the video, so
  // shorts looked like they didn't autoplay. Arriving by tapping the Shorts tab
  // worked only because that tap counted as activation.
  //
  // So: hold the unmute until there's a real gesture, then apply it.
  const userGestureRef = useRef(false);
  // True while we're autoplaying MUTED even though the user prefers sound, because
  // there's been no gesture yet. Drives the mute icon so it tells the truth (the
  // video really is muted) instead of showing "unmuted" over silent audio.
  const [unmutePending, setUnmutePending] = useState(false);
  const hasActivation = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.userActivation) {
      return navigator.userActivation.hasBeenActive;
    }
    return userGestureRef.current;
  }, []);

  // Stop crediting watch time while the tab is in the background, and flush what
  // was watched up to the moment it went away.
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState === 'hidden';
      shortVisibleRef.current = !hidden;
      if (hidden) shortWatchBeat(shortWatchRef, currentTimeRef.current);
      // Back in front: re-anchor the throttle so the next beat hands the server
      // no gap to credit for time nobody was watching.
      else shortWatchRef.current.lastBeatAt = Date.now();
    };
    const onPageHide = () => {
      shortVisibleRef.current = false;
      shortWatchBeat(shortWatchRef, currentTimeRef.current);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  useEffect(() => {
    if (hasActivation()) return undefined;
    // Sound is wanted but not yet permitted → we'll be playing muted.
    if (!isMutedRef.current) setUnmutePending(true);
    const onGesture = (e) => {
      userGestureRef.current = true;
      // If this very gesture is a tap on the mute control, the user is explicitly
      // choosing — let toggleMute own the outcome. Otherwise we'd unmute here and
      // toggleMute would immediately flip it back to muted, so tapping "unmute"
      // would mute you.
      if (e?.target?.closest?.('.muteIndicator')) return;
      setUnmutePending(false);
      // Apply the deferred unmute now that activation allows it.
      const p = playerRef.current;
      if (p && !p.destroyed && !isMutedRef.current) {
        try { p.setMuted(false); } catch { /* ignore */ }
      }
    };
    const opts = { once: true, capture: true };
    window.addEventListener('pointerdown', onGesture, opts);
    window.addEventListener('touchstart', onGesture, opts);
    window.addEventListener('keydown', onGesture, opts);
    return () => {
      window.removeEventListener('pointerdown', onGesture, opts);
      window.removeEventListener('touchstart', onGesture, opts);
      window.removeEventListener('keydown', onGesture, opts);
    };
  }, [hasActivation]);

  // Play an SDK player with correct mute state.
  // Always start muted so iOS allows the play(), then unmute after playback starts.
  const playPlayerWithMuteSync = useCallback((player) => {
    if (!player || player.destroyed) return;
    player.setMuted(true);
    player.play().then(() => {
      if (!player.destroyed) {
        // Muting is always safe. UN-muting is only safe once the user has
        // interacted — otherwise the browser pauses what we just started.
        // The gesture listener above applies the unmute retroactively.
        if (isMutedRef.current || hasActivation()) {
          player.setMuted(isMutedRef.current);
        }
      }
      setAutoplayBlocked(false);
    }).catch((err) => {
      console.warn('[VideoShort] play() rejected:', err);
      setAutoplayBlocked(true);
    });
  }, [hasActivation]);

  const togglePlayPause = useCallback(() => {
    sendCommand('toggle-play');
    setShowPlayPauseIcon(true);
    if (playPauseTimeoutRef.current) clearTimeout(playPauseTimeoutRef.current);
    playPauseTimeoutRef.current = setTimeout(() => setShowPlayPauseIcon(false), 500);
  }, [sendCommand]);

  // Toggle mute: only send to current (active) player.
  // Other players get mute synced when they become current via playPlayerWithMuteSync.
  const toggleMute = useCallback(() => {
    // While `unmutePending` the video really IS muted (we held the unmute back for
    // the autoplay policy) even though the stored pref says otherwise — so base the
    // toggle on what's actually playing, not on the pref alone.
    const currentlyMuted = isMuted || unmutePending;
    const newMuted = !currentlyMuted;
    setUnmutePending(false);
    const command = newMuted ? 'mute' : 'unmute';
    sendCommand(command);
    setIsMuted(newMuted);
    isMutedRef.current = newMuted;
    localStorage.setItem('3speak-muted', newMuted ? '1' : '0');
    document.cookie = `shorts_muted=${newMuted ? '1' : '0'}; path=/; max-age=${365 * 24 * 3600}`;
    // Show mute/unmute icon feedback
    setShowMuteIcon(true);
    if (muteIconTimeoutRef.current) clearTimeout(muteIconTimeoutRef.current);
    muteIconTimeoutRef.current = setTimeout(() => setShowMuteIcon(false), 600);
  }, [isMuted, unmutePending, sendCommand]);

  // Cycle playback mode: auto-replay → auto-swipe → none → auto-replay
  const cyclePlaybackMode = useCallback(() => {
    const modes = ['auto-replay', 'auto-swipe', 'none'];
    const nextMode = modes[(modes.indexOf(playbackMode) + 1) % modes.length];
    setPlaybackMode(nextMode);
    playbackModeRef.current = nextMode;
    document.cookie = `shorts_playback_mode=${nextMode}; path=/; max-age=${365 * 24 * 3600}`;
    // Update loop setting on the persistent SDK player
    const shouldLoop = nextMode === 'auto-replay';
    const player = playerRef.current;
    if (player && !player.destroyed) player.setLoop(shouldLoop);
    // Reset ended state when switching modes
    setVideoEnded(false);
    autoSwipeTriggeredRef.current = false;
    // Show mode indicator
    setShowModeIndicator(true);
    if (modeIndicatorTimeoutRef.current) clearTimeout(modeIndicatorTimeoutRef.current);
    modeIndicatorTimeoutRef.current = setTimeout(() => setShowModeIndicator(false), 1500);
  }, [playbackMode, videos, currentIndex]);

  // Pause video while vote popup is open, resume when it closes (only if was playing)
  useEffect(() => {
    if (showTooltip) {
      wasPlayingBeforePopupRef.current = isPlaying;
      if (isPlaying) sendCommand('pause');
    } else {
      if (wasPlayingBeforePopupRef.current) {
        sendCommand('play');
        wasPlayingBeforePopupRef.current = false;
      }
    }
  }, [showTooltip]); // eslint-disable-line react-hooks/exhaustive-deps

  // Quick upvote via double-tap — opens vote popup (same as sidebar heart button)
  const quickUpvote = useCallback(() => {
    // The sidebar heart is disabled by CSS during a spot, but double-tap reaches this
    // through the gesture overlay instead, which the ad chrome deliberately lets taps
    // pass through (it is `pointer-events: none` so the player keeps play/pause). So
    // the guard belongs here — the one place both the mouse and touch paths funnel to.
    if (adPlaying) return;
    const video = videos[currentIndex];
    if (!video) return;
    if (video.hivePostMissing) {
      toast.error("Voting isn't available for this post");
      return;
    }
    // Open the vote tooltip (same as clicking the heart in the sidebar)
    if (!authenticated) {
      toast.error('Login to vote');
      return;
    }
    setSelectedComment({ author: video.author, permlink: video.hivePermlink });
    setShowTooltip(true);
    setActiveTooltipPermlink(video.hivePermlink);
  }, [videos, currentIndex, authenticated, adPlaying]);

  // Desktop mouse handlers: mouseDown starts a long-press timer (mute/unmute), mouseUp cancels it,
  // click fires the single/double-click gesture (play/pause or upvote).
  // Touch devices suppress click via e.preventDefault() in onTouchEnd, so no double-fire.
  const handleOverlayMouseDown = useCallback((e) => {
    if (showComments) return;
    mouseLongPressHandledRef.current = false;
    mouseLongPressRef.current = setTimeout(() => {
      mouseLongPressHandledRef.current = true;
      toggleMute();
    }, 700); // Longer threshold for mouse (700ms vs 500ms touch)
  }, [showComments, toggleMute]);

  const handleOverlayMouseUp = useCallback(() => {
    if (mouseLongPressRef.current) {
      clearTimeout(mouseLongPressRef.current);
      mouseLongPressRef.current = null;
    }
  }, []);

  const handleOverlayClick = useCallback((e) => {
    e.stopPropagation();
    // Skip click if it was synthesized from a recent touch (touch handler already processed it)
    if (recentTouchRef.current) return;
    if (mouseLongPressHandledRef.current) return;

    // When comments panel is open, allow simple play/pause but skip double-tap gestures
    if (showComments) {
      togglePlayPause();
      return;
    }

    tapCountRef.current += 1;
    if (tapCountRef.current === 1) {
      tapTimerRef.current = setTimeout(() => {
        if (tapCountRef.current === 1) {
          togglePlayPause();
        }
        tapCountRef.current = 0;
      }, 300);
    } else if (tapCountRef.current >= 2) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapCountRef.current = 0;
      quickUpvote();
    }
  }, [showComments, togglePlayPause, quickUpvote]);

  /* Seeking is the viewer's control over THEIR short, and during a spot the player is
   * showing the advertiser's. Guarded here rather than at each caller because there are
   * several — two keyboard handlers and the progress bar — and the arrow keys were still
   * scrubbing through an ad after the bar itself was hidden.
   *
   * Ref, not state: these handlers are bound once and would otherwise close over the
   * value as it was when they were attached. */
  const seekTo = useCallback((time) => {
    if (adPlayingRef.current) return;
    sendCommand('seek', { time });
  }, [sendCommand]);

  const handleProgressBarInteraction = useCallback((e) => {
    if (!progressBarRef.current || durationRef.current === 0) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * durationRef.current;

    seekTo(newTime);
    currentTimeRef.current = newTime;
    updateProgressBar();
  }, [seekTo, updateProgressBar]);

  const handleProgressMouseDown = useCallback((e) => {
    e.stopPropagation();
    setIsScrubbing(true);
    isScrubbingRef.current = true;
    handleProgressBarInteraction(e);
  }, [handleProgressBarInteraction]);

  const handleProgressMouseMove = useCallback((e) => {
    if (!isScrubbingRef.current) return;
    handleProgressBarInteraction(e);
  }, [handleProgressBarInteraction]);

  const handleProgressMouseUp = useCallback(() => {
    setIsScrubbing(false);
    isScrubbingRef.current = false;
  }, []);

  // Global mouse listeners for scrubbing
  useEffect(() => {
    if (isScrubbing) {
      window.addEventListener('mouseup', handleProgressMouseUp);
      window.addEventListener('mousemove', handleProgressMouseMove);
      return () => {
        window.removeEventListener('mouseup', handleProgressMouseUp);
        window.removeEventListener('mousemove', handleProgressMouseMove);
      };
    }
  }, [isScrubbing, handleProgressMouseUp, handleProgressMouseMove]);

  // SDK event subscriptions are set up once in the setupVideoElement callback.
  // No global postMessage listener needed — the SDK communicates directly via native events.

  // Pre-fetch vote data once when user is logged in
  const fetchVoteData = useCallback(async () => {
    if (!user) return;
    try {
      const [acctResult, dynProps] = await Promise.all([
        getVotePower(user),
        getDynamicProps(),
      ]);
      const acct = acctResult?.account;
      if (acct) setAccountData(acct);
      if (dynProps) cachedDynamicPropsRef.current = dynProps;
      voteDataReady.current = !!(acct && dynProps);
    } catch (err) {
      console.error('Error pre-fetching vote data:', err);
    }
  }, [user]);

  useEffect(() => {
    fetchVoteData();
  }, [fetchVoteData]);

  // Handle video change - pause previous, play current
  // Only react to actual index changes (not videos enrichment re-renders)
  useEffect(() => {
    const currentVid = videos[currentIndex];
    if (!currentVid) return;

    // Skip if index hasn't actually changed (e.g. videos array updated by enrichment)
    if (prevIndexRef.current === currentIndex && currentVid.id === prevVideoIdRef.current) return;

    const prevIndex = prevIndexRef.current;

    console.log(`[VideoShort] Index changed: ${prevIndex} -> ${currentIndex}, video: ${currentVid.id}`);

    // Always clear pending play from previous navigation
    pendingPlayRef.current = null;

    // Update URL with current video (without page reload)
    updateUrlWithCurrentVideo(currentVid);

    // Record watch history — use hivePermlink so WatchedView can look it up via Hive API
    if (user && watchHistoryEnabled !== false && currentVid.author && (currentVid.hivePermlink || currentVid.permlink)) {
      recordWatch(user, currentVid.author, currentVid.hivePermlink || currentVid.permlink, { short: true });
    }

    // Decrement unseen_count for the current creator in the stories bar cache
    if (isStoriesMode && feedUser) {
      queryClient.setQueryData(['shorts-stories', user], (old) => {
        if (!old?.creators) return old;
        return {
          ...old,
          creators: old.creators.map(c =>
            c.username === feedUser && c.unseen_count > 0
              ? { ...c, unseen_count: c.unseen_count - 1 }
              : c
          ),
        };
      });
    }

    // Reset player state
    setIsPlaying(false);
    setVideoEnded(false);
    autoSwipeTriggeredRef.current = false;
    currentTimeRef.current = 0;
    durationRef.current = 0;
    updateProgressBar();
    setParentCardVisible(localStorage.getItem('3speak-chain-visible') !== '0');
    setCaptionExpanded(false);
    setTranslatedCaption(null);

    // Update tracking refs
    // One short finished. Counted on ADVANCE rather than on open, so a short that was
    // scrolled past without watching does not pay into the cadence.
    let takingSpot = false;
    if (SHORTS_ADS_ENABLED && prevIndex !== currentIndex && prevIndex >= 0) {
      countShortWatched();
      // A spot bought at the PREVIOUS boundary and held until now. Consumed before
      // anything else, and it suppresses this advance's own request — we are about to
      // play an ad, so asking for a second one is pointless.
      if (pendingAdRef.current) {
        const spot = pendingAdRef.current;
        pendingAdRef.current = null;
        takingSpot = true;
        setShortsAd(spot);
        setAdStarted(false);
        setAdSecondsLeft(Math.round(Number(spot.durationSeconds) || 0));
      } else {
        const finished = videos[prevIndex];
        if (!adBusyRef.current && finished) {
          adBusyRef.current = true;
          requestShortsAd({
            owner: finished.author,
            permlink: finished.permlink || finished.hivePermlink,
            viewer: (useAppStore.getState().user || '').toLowerCase() || null,
          }).then((spot) => {
            // 🚨 HELD for the next swipe rather than shown now. The request goes out
            // when a short STARTS, so by the time it answers that short is already
            // playing — and showing the spot here yanked it away mid-play, which is
            // the one thing a feed must not do. Buffered, it lands on the following
            // boundary instead, where an interruption is expected and costs nothing.
            //
            // Holding it owes nobody anything: an impression is recorded when a
            // segment is FETCHED (recordDelivery, checker adServe.js), so a spot that
            // is never reached simply expires with its session.
            //
            // No currentIndex check any more. It used to matter because the spot
            // interrupted a specific short; now it waits for whichever boundary comes
            // next, and the feed having moved on is exactly the case it is for.
            // Held only. Nothing is fetched ahead of time — see the note at the foot
            // of lib/shortsAd.js for why prefetching a spot bills for it.
            if (spot) pendingAdRef.current = spot;
          }).finally(() => { adBusyRef.current = false; });
        }
      }
    }

    prevIndexRef.current = currentIndex;
    prevVideoIdRef.current = currentVid.id;

    // Reset ready state for the new video
    readyPlayers.current.clear();
    setReadyPlayerIds(new Set());

    // The spot taken above is already loading into the shared player. Loading this
    // short on top of it would race two sources through one <video> and the ad would
    // lose — which is the bug where a short flashed up before the ad, seen from the
    // other side. endShortsAd() loads this short when the spot finishes.
    if (takingSpot) {
      return undefined;
    }

    // Load new video into the persistent player (reuses same <video> element + Player instance)
    const player = playerRef.current;
    if (player && !player.destroyed) {
      pendingPlayRef.current = currentVid.id;
      console.log(`[VideoShort] Loading new source into persistent player: ${currentVid.id}`);

      // Use prefetched source if available, otherwise fetch from API
      const cachedSource = prefetchedSourcesRef.current.get(currentVid.id);
      if (cachedSource) {
        console.log(`[VideoShort] Using prefetched source for ${currentVid.id}`);
        player.load(cachedSource).catch(err => {
          console.error(`[VideoShort] Failed to load ${currentVid.id}:`, err);
        });
      } else {
        player.load(`${currentVid.author}/${currentVid.permlink}`).catch(err => {
          console.error(`[VideoShort] Failed to load ${currentVid.id}:`, err);
        });
      }

      // Fallback retries in case ready event is delayed
      const timeouts = [];
      const playIfReady = (attempt) => {
        if (pendingPlayRef.current !== currentVid.id) return;
        if (readyPlayers.current.has(currentVid.id)) {
          console.log(`[VideoShort] Playing on retry ${attempt}: ${currentVid.id}`);
          pendingPlayRef.current = null;
          playPlayerWithMuteSync(player);
        }
      };

      [500, 1000, 1500, 2000, 3000, 4000, 5000].forEach((delay, idx) => {
        const timeout = setTimeout(() => playIfReady(idx + 1), delay);
        timeouts.push(timeout);
      });

      return () => {
        timeouts.forEach(t => clearTimeout(t));
      };
    }
  }, [currentIndex, videos, sendCommandToVideo]);

  // Play the spot through the SAME persistent player the feed uses, then give the
  // short back.
  //
  // 🚨 There is exactly one <video> on this page and there cannot be a second — iOS
  // will not play two. So the spot borrows the feed's player rather than mounting its
  // own, which is why this effect both loads it and is responsible for restoring what
  // was there.
  //
  // The countdown is driven by the SERVER-REPORTED duration rather than by a player
  // `ended` event. Not because the event is wrong, but because it is the one thing
  // here that cannot be checked on this box (no H.264 decoder in any browser), and a
  // missed `ended` would strand a viewer on a finished ad with no way forward. A
  // timer plus a Skip button cannot strand anybody.
  useEffect(() => {
    if (!SHORTS_ADS_ENABLED || !shortsAd) return undefined;
    const player = playerRef.current;
    if (player && !player.destroyed) {
      player.load({ url: shortsAd.manifestUrl }).catch((err) => {
        // A spot that will not load must never cost the viewer their feed.
        console.error('[VideoShort] shorts spot failed to load:', err);
        setShortsAd(null);
      });
    }
    return undefined;
  }, [shortsAd]);

  /* The countdown runs on PLAYBACK, not on arrival.
   *
   * It used to start in the effect above, the moment the spot was taken — so the clock
   * was already running while the manifest was still being fetched and the first
   * segment decoded. An 8 second spot could lose a second or two of that to loading and
   * be pulled off screen before it finished: the advertiser paid for 8 seconds and the
   * viewer saw six.
   *
   * `adStarted` is set from the player's own time, so this begins when a frame has
   * actually played. Deliberately a SEPARATE effect: adding adStarted to the deps above
   * would re-run player.load() and restart the spot the instant it began.
   *
   * Kept as a timer rather than moved to the player's `ended` event for the reason
   * above: a missed `ended` strands a viewer on a finished ad, and a timer plus Skip
   * cannot strand anybody. */
  useEffect(() => {
    if (!SHORTS_ADS_ENABLED || !shortsAd || !adStarted) return undefined;
    // Paused means paused. The spacebar still works during a spot, and a countdown that
    // kept running through a paused ad would just be the Skip button with extra steps:
    // hold space, watch nothing, get your feed back. Stopping the clock instead means an
    // advertiser is paid for seconds that were actually on screen, and the viewer keeps
    // an ordinary control.
    if (!isPlaying) return undefined;
    const tick = setInterval(() => setAdSecondsLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(tick);
  }, [shortsAd, adStarted, isPlaying]);

  // When the spot is done — its time is up, or the viewer skipped — put the short back.
  const endShortsAd = useCallback(() => {
    setShortsAd(null);
    setAdStarted(false);
    setAdSecondsLeft(0);
    const player = playerRef.current;
    const vid = videos[currentIndexRef.current];
    if (player && !player.destroyed && vid) {
      const cached = prefetchedSourcesRef.current.get(vid.id);
      player.load(cached || `${vid.author}/${vid.permlink}`)
        .then(() => playPlayerWithMuteSync(player))
        .catch((err) => console.error('[VideoShort] could not resume after the spot:', err));
    }
  }, [videos]);

  useEffect(() => {
    if (!shortsAd || adSecondsLeft > 0) return;
    endShortsAd();
  }, [shortsAd, adSecondsLeft, endShortsAd]);

  // The floor under the playback-driven countdown: a spot that never starts gives the
  // feed back rather than holding a viewer on a still frame with only Skip for a way out.
  useEffect(() => {
    if (!shortsAd || adStarted) return undefined;
    // Not while the viewer has paused before a frame ever played: that is a choice, not
    // the stall this exists to catch, and ending the spot would be punishing them for it.
    if (!isPlaying) return undefined;
    const bail = setTimeout(() => {
      console.warn('[VideoShort] shorts spot never started playing; returning to the feed');
      endShortsAd();
    }, SHORTS_AD_START_TIMEOUT_MS);
    return () => clearTimeout(bail);
  }, [shortsAd, adStarted, isPlaying, endShortsAd]);

  // Force-show fallback: if the player hasn't fired ready after 6s, show it anyway and try playing
  useEffect(() => {
    // Not while a spot is on. The short deliberately was NOT loaded — the ad has the
    // player — so this would always find it un-ready and start calling play() against
    // the ad. Harmless in itself, but it also marks the short ready before it has
    // loaded a frame. Dropping adPlaying re-runs this, which is exactly right: the
    // 6-second clock should start when the short actually gets the player back.
    if (adPlaying) return;
    const currentVid = videos[currentIndex];
    if (!currentVid || readyPlayers.current.has(currentVid.id)) return;

    const timer = setTimeout(() => {
      if (!readyPlayers.current.has(currentVid.id)) {
        console.log(`[VideoShort] Force-showing player after timeout: ${currentVid.id}`);
        readyPlayers.current.add(currentVid.id);
        setReadyPlayerIds(prev => {
          const next = new Set(prev);
          next.add(currentVid.id);
          return next;
        });
        setFirstPlayerReady(true);
        const player = playerRef.current;
        if (player && !player.destroyed) playPlayerWithMuteSync(player);
      }
    }, 6000);

    return () => clearTimeout(timer);
  }, [currentIndex, videos, adPlaying]);

  // Lazy enrichment: when a short becomes visible and hasn't been enriched yet,
  // fetch full Hive data (vote status, reaction chain, child reactions) in background
  useEffect(() => {
    const currentVid = videos[currentIndex];
    if (!currentVid || currentVid._enriched !== false) return;

    // Mark as enriching to prevent duplicate calls
    setVideos(prev => prev.map((v, i) => i === currentIndex ? { ...v, _enriched: 'loading' } : v));

    const videoId = currentVid.id;
    (async () => {
      try {
        // On a deep-link the short arrives without embed_url/hivePermlink, so the
        // Hive post can't be resolved (embed_url would be "@author/undefined").
        // Fetch the real embed link from the checker first.
        let embedUrl = currentVid.embedUrl;
        let hivePermlink = currentVid.hivePermlink;
        if (!embedUrl) {
          try {
            const d = await fetch(`${import.meta.env.VITE_CHECKER_URL}/videodetails/${currentVid.author}/${currentVid.permlink}`).then(r => (r.ok ? r.json() : {}));
            if (d?.embed_url) embedUrl = d.embed_url;
            if (d?.hive_permlink) hivePermlink = d.hive_permlink;
          } catch { /* ignore */ }
        }
        const shortItem = {
          owner: currentVid.author,
          permlink: currentVid.permlink,
          embed_url: embedUrl || `@${currentVid.author}/${hivePermlink}`,
          thumbnail_url: currentVid.thumbnailUrl || '',
          views: currentVid.stats?.views || currentVid.views || 0,
          createdAt: currentVid.createdAt || '',
          embed_title: currentVid.caption || '',
        };
        const enriched = await hiveApi.fetchCompleteShortData(shortItem, user);

        setVideos(prev => prev.map(v => {
          if (v.id !== videoId) return v;
          return {
            ...v,
            isLiked: enriched.isLiked || false,
            isDisliked: enriched.isDisliked || false,
            parentVideo: enriched.parentVideo || null,
            parentTimestamp: enriched.parentTimestamp || null,
            parentComment: enriched.parentComment || null,
            parentShort: enriched.parentShort || null,
            reactionChain: enriched.reactionChain || null,
            childReactions: enriched.childReactions || null,
            reusable: enriched.reusable,
            // Carry the resolved Hive permlink/embed link so the edit button and
            // its modal work on deep-linked shorts, not just from the profile.
            hivePermlink: enriched.hivePermlink || hivePermlink,
            embedUrl: enriched.embedUrl || embedUrl,
            hivePostMissing: enriched.hivePostMissing,
            _enriched: true,
          };
        }));
      } catch (err) {
        console.warn('Failed to enrich short:', err);
        setVideos(prev => prev.map(v => v.id === videoId ? { ...v, _enriched: true } : v));
      }
    })();
  }, [currentIndex, videos, user]);

  // Fetch extended video details (mantecurated etc.) from checker API
  const detailsVideoIdRef = useRef(null);
  useEffect(() => {
    const currentVid = videos[currentIndex];
    if (!currentVid) return;
    if (detailsVideoIdRef.current === currentVid.id) return;
    detailsVideoIdRef.current = currentVid.id;
    const videoId = currentVid.id;

    fetch(`${import.meta.env.VITE_CHECKER_URL}/videodetails/${currentVid.author}/${currentVid.permlink}`)
      .then(r => r.ok ? r.json() : {})
      .then(details => {
        setVideos(prev => prev.map(v =>
          v.id === videoId ? { ...v, mantecurated: details.mantecurated === true } : v
        ));
      })
      .catch(() => {});
  }, [currentIndex, videos]);

  // Fetch reshare data when current video changes
  // Use video id to avoid re-fetching on videos array enrichment (which causes avatar flashing)
  const reshareVideoIdRef = useRef(null);
  useEffect(() => {
    const currentVid = videos[currentIndex];
    if (!currentVid) return;
    // Skip if the video identity hasn't changed (e.g. enrichment updated the videos array)
    if (reshareVideoIdRef.current === currentVid.id) return;
    reshareVideoIdRef.current = currentVid.id;

    const author = currentVid.author;
    const permlink = currentVid.hivePermlink || currentVid.permlink;
    if (!author || !permlink) return;

    // Reset state for new video
    setReshareCount(0);
    setHasReshared(false);
    setReshareUsers([]);

    (async () => {
      try {
        const { reshares, count } = await getResharesForVideo(author, permlink);
        setReshareCount(count);
        setReshareUsers(reshares);
        if (user) {
          setHasReshared(reshares.some(r => r.username === user));
        }
      } catch (err) {
        console.warn('Failed to fetch reshares:', err);
      }
    })();
  }, [currentIndex, videos, user]);

  // Cleanup on unmount — destroy player and preload fresh shorts for the next visit
  useEffect(() => {
    return () => {
      if (playPauseTimeoutRef.current) {
        clearTimeout(playPauseTimeoutRef.current);
      }
      if (playerRef.current && !playerRef.current.destroyed) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
      preloadShorts(SHORTS_PAGE_SIZE, user);
    };
  }, []);

  /* ---------- FETCH SHORTS DATA ---------- */
  useEffect(() => {
    const formatShorts = (shorts) => shorts.map(short => ({
      id: short.id,
      author: short.author,
      permlink: short.permlink,
      hivePermlink: short.hivePermlink,
      embedUrl: short.embedUrl || null,
      thumbnailUrl: short.thumbnailUrl || null,
      user: {
        username: short.user.username,
        avatar: short.user.avatar,
        isSubscribed: false,
        followersCount: short.user.followersCount ?? null,
        reputation: short.user.reputation ?? null,
      },
      caption: short.caption || short.title || '',
      tags: short.tags || [],
      audio: `${short.user.username} - Original Audio`,
      albumArt: short.user.avatar,
      stats: {
        likes: short.stats.likes,
        dislikes: short.stats.dislikes,
        comments: short.stats.comments,
        shares: short.stats.shares,
        remixes: short.stats.remixes,
        views: short.views || short.stats.views || 0,
        payout: short.stats.payout
      },
      isLiked: short.isLiked || false,
      isDisliked: short.isDisliked || false,
      comments: [],
      commentsLoaded: false,
      timeAgo: short.timeAgo,
      createdAt: short.createdAt,
      parentVideo: short.parentVideo || null,
      parentTimestamp: short.parentTimestamp || null,
      parentComment: short.parentComment || null,
      parentShort: short.parentShort || null,
      reactionChain: short.reactionChain || null,
      childReactions: short.childReactions || null,
      _enriched: short._enriched != null ? short._enriched : true,
    }));

    const applySharedVideoLogic = async (formattedVideos, data) => {
      const sharedVideo = getSharedVideoFromUrl();

      if (sharedVideo) {
        // The URL `permlink` may be the embed asset id OR the Hive permlink
        // (shares / chain links use the Hive permlink). Match either.
        const sharedIndex = formattedVideos.findIndex(
          v => v.author === sharedVideo.author &&
            (v.permlink === sharedVideo.permlink || v.hivePermlink === sharedVideo.permlink)
        );

        if (sharedIndex !== -1) {
          setVideos(formattedVideos);
          setCurrentIndex(sharedIndex);
        } else {
          try {
            // Resolve by asset permlink first; if the URL carried the Hive permlink
            // (wave-/snap-/3speak-… shares), resolve via embed_url instead. Either
            // way `actualShort.permlink` is the embed asset id — what the player and
            // the /api/view endpoint need (sending the Hive permlink 404s both).
            let actualShort = await hiveApi.findShortByPermlink(sharedVideo.permlink);
            if (!actualShort) {
              actualShort = await hiveApi.findShortByEmbedUrl(sharedVideo.author, sharedVideo.permlink);
            }
            // findShort* only scans the shorts feed, so a direct-linked short that
            // isn't in the feed (or is beyond the scanned pages) isn't found and we
            // fall back to "@author/<assetId>" — which can't resolve the Hive post
            // (breaks edit/vote). The checker's /videodetails authoritatively maps
            // the asset id → embed_url + Hive permlink, so use it as a fallback.
            if (!actualShort) {
              try {
                const d = await fetch(`${import.meta.env.VITE_CHECKER_URL}/videodetails/${sharedVideo.author}/${sharedVideo.permlink}`).then(r => (r.ok ? r.json() : null));
                if (d && d.owner && d.embed_url) {
                  actualShort = {
                    owner: d.owner,
                    permlink: d.permlink,
                    embed_url: d.embed_url,
                    thumbnail_url: d.thumbnail_url || '',
                    views: d.views || 0,
                    createdAt: d.createdAt || new Date().toISOString(),
                    embed_title: d.embed_title || d.hive_title || '',
                  };
                }
              } catch { /* ignore — falls through to the minimal shortItem below */ }
            }
            const shortItem = actualShort || {
              owner: sharedVideo.author,
              permlink: sharedVideo.permlink,
              embed_url: `@${sharedVideo.author}/${sharedVideo.permlink}`,
              thumbnail_url: '',
              views: 0,
              createdAt: new Date().toISOString(),
              embed_title: ''
            };

            const sharedVideoData = await hiveApi.fetchCompleteShortData(shortItem, user);
            const formattedSharedVideo = {
              id: sharedVideoData.id,
              author: sharedVideoData.author,
              permlink: sharedVideoData.permlink,
              hivePermlink: sharedVideoData.hivePermlink,
              hivePostMissing: sharedVideoData.hivePostMissing,
              embedUrl: sharedVideoData.embedUrl,
              user: sharedVideoData.user,
              caption: sharedVideoData.caption || sharedVideoData.title || '',
              audio: `${sharedVideoData.user.username} - Original Audio`,
              albumArt: sharedVideoData.user.avatar,
              stats: sharedVideoData.stats,
              isLiked: sharedVideoData.isLiked || false,
              isDisliked: sharedVideoData.isDisliked || false,
              comments: [],
              commentsLoaded: false,
              timeAgo: sharedVideoData.timeAgo,
              createdAt: sharedVideoData.createdAt,
              parentVideo: sharedVideoData.parentVideo || null,
              parentTimestamp: sharedVideoData.parentTimestamp || null,
              parentComment: sharedVideoData.parentComment || null,
              parentShort: sharedVideoData.parentShort || null,
              reactionChain: sharedVideoData.reactionChain || null,
              childReactions: sharedVideoData.childReactions || null,
            };

            setVideos([formattedSharedVideo, ...formattedVideos]);
            setCurrentIndex(0);
          } catch (err) {
            console.warn('Could not fetch shared video, showing feed from start:', err);
            setVideos(formattedVideos);
            if (formattedVideos.length > 0) {
              updateUrlWithCurrentVideo(formattedVideos[0]);
            }
          }
        }
      } else {
        setVideos(formattedVideos);
        if (formattedVideos.length > 0) {
          updateUrlWithCurrentVideo(formattedVideos[0]);
        }
      }

      setHasMore(1 < data.totalPages);
    };

    const fetchShorts = async () => {
      try {
        setError(null);

        // User-specific feed mode: skip preloading, fetch directly from user endpoint
        if (feedUser) {
          setLoading(true);
          const data = await fetchUserShortsWithDetails(feedUser, 1, 20);
          if (data.success) {
            const formattedVideos = formatShorts(data.shorts);
            await applySharedVideoLogic(formattedVideos, data);
          }
        } else {
          // Default global feed
          // Only use preloaded data for guests — logged-in users need
          // currentuser filtering to exclude already-watched shorts. The preload is
          // always built in Discover mode, so it must never be served in "My
          // interests" mode (it isn't filtered to the user's topics).
          if (!user && !interestsMode) {
            if (!hasShortsPreloaded()) {
              setLoading(true);
            }

            const preloaded = await consumePreloadedShorts();
            if (preloaded?.success) {
              const formattedVideos = formatShorts(preloaded.shorts);
              await applySharedVideoLogic(formattedVideos, preloaded);
              setLoading(false);
              return;
            }
          } else {
            // Discard any stale preloaded data that lacks currentuser filtering
            consumePreloadedShorts();
          }

          // Fetch with currentuser parameter so watched shorts are filtered out.
          // NOTE: the seed is deliberately NOT regenerated here. It's one seed per
          // page load (utils/feedSeed), so navigating away and back keeps the same
          // order — only a real refresh reshuffles. Regenerating on mount also minted
          // a fresh sortedShortsCache entry on the checker every single visit.
          setLoading(true);
          const data = await hiveApi.fetchShortsWithDetails(1, SHORTS_PAGE_SIZE, user);

          if (data.success) {
            const formattedVideos = formatShorts(data.shorts);
            await applySharedVideoLogic(formattedVideos, data);
          }
        }
      } catch (err) {
        console.error('Error fetching shorts:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchShorts();
    // `shortsFeedMode` is a dep so flipping Discover ⇄ My interests refetches page 1.
  }, [user, feedUser, shortsFeedMode, getSharedVideoFromUrl, updateUrlWithCurrentVideo]);

  /* ---------- HANDLE IN-PAGE NAVIGATION TO A SHORT ---------- */
  // When location.search changes (e.g. clicking "View parent reaction"),
  // jump to or load the target short without re-fetching the entire feed.
  const prevSearchRef = useRef(location.search);
  useEffect(() => {
    if (location.search === prevSearchRef.current) return;
    prevSearchRef.current = location.search;

    // Only act if we already have videos loaded
    if (videos.length === 0) return;

    const params = new URLSearchParams(location.search);
    const videoParam = params.get('v');
    if (!videoParam) return;

    const [targetAuthor, targetPermlink] = videoParam.split('/');
    if (!targetAuthor || !targetPermlink) return;

    // Save current short to history stack for back navigation (skip when navigating back)
    if (isNavigatingBackRef.current) {
      isNavigatingBackRef.current = false;
    } else {
      const currentVid = videos[currentIndex];
      if (currentVid) {
        shortHistoryRef.current = [...shortHistoryRef.current, { author: currentVid.author, permlink: currentVid.permlink }];
      }
    }

    // Check if it's already in the feed
    const existingIdx = videos.findIndex(
      v => v.author === targetAuthor && v.permlink === targetPermlink
    );

    if (existingIdx !== -1) {
      setCurrentIndex(existingIdx);
      return;
    }

    // Check chain preload data for instant switch (player already warm)
    const preloadKey = `${targetAuthor}-${targetPermlink}`;
    const chainData = chainPreloadDataRef.current.get(preloadKey);

    if (chainData) {
      // Instant switch — create minimal entry, player is already loaded
      const formatted = {
        id: preloadKey,
        author: chainData.author,
        permlink: chainData.permlink,
        hivePermlink: chainData.hivePermlink,
        user: {
          username: `@${chainData.author}`,
          avatar: `https://images.hive.blog/u/${chainData.author}/avatar/small`,
          isSubscribed: false,
        },
        caption: chainData.title || '',
        audio: `@${chainData.author} - Original Audio`,
        albumArt: `https://images.hive.blog/u/${chainData.author}/avatar/small`,
        stats: { likes: 0, dislikes: 0, comments: 0, shares: 0, remixes: 0, views: 0, payout: '0.00' },
        isLiked: false,
        isDisliked: false,
        comments: [],
        commentsLoaded: false,
        timeAgo: '',
        createdAt: '',
        parentVideo: null,
        parentTimestamp: null,
        parentComment: null,
        parentShort: null,
        reactionChain: null,
        childReactions: null,
      };

      setVideos(prev => [formatted, ...prev]);
      setCurrentIndex(0);

      // Enrich with full data in background
      (async () => {
        try {
          const shortItem = {
            owner: chainData.author,
            permlink: chainData.permlink,
            embed_url: `@${chainData.author}/${chainData.hivePermlink}`,
            thumbnail_url: chainData.thumbnail || '',
            views: 0,
            createdAt: '',
            embed_title: chainData.title || '',
          };
          const shortData = await hiveApi.fetchCompleteShortData(shortItem, user);
          setVideos(prev => prev.map(v => {
            if (v.id !== preloadKey) return v;
            return {
              id: shortData.id,
              author: shortData.author,
              permlink: shortData.permlink,
              hivePermlink: shortData.hivePermlink,
              user: shortData.user,
              caption: shortData.caption || shortData.title || '',
              audio: `${shortData.user.username} - Original Audio`,
              albumArt: shortData.user.avatar,
              stats: shortData.stats,
              isLiked: shortData.isLiked || false,
              isDisliked: shortData.isDisliked || false,
              comments: v.comments,
              commentsLoaded: v.commentsLoaded,
              timeAgo: shortData.timeAgo,
              createdAt: shortData.createdAt,
              parentVideo: shortData.parentVideo || null,
              parentTimestamp: shortData.parentTimestamp || null,
              parentComment: shortData.parentComment || null,
              parentShort: shortData.parentShort || null,
              reactionChain: shortData.reactionChain || null,
              childReactions: shortData.childReactions || null,
            };
          }));
        } catch (err) {
          console.warn('Failed to enrich chain preload:', err);
        }
      })();
      return;
    }

    // Not in feed — fetch and prepend it
    setShortNavLoading(true);
    (async () => {
      try {
        const shortEntry = await hiveApi.findShortByPermlink(targetPermlink);
        const shortItem = shortEntry || {
          owner: targetAuthor,
          permlink: targetPermlink,
          embed_url: `@${targetAuthor}/${targetPermlink}`,
          thumbnail_url: '',
          views: 0,
          createdAt: new Date().toISOString(),
          embed_title: '',
        };

        const shortData = await hiveApi.fetchCompleteShortData(shortItem, user);

        const formatted = {
          id: shortData.id,
          author: shortData.author,
          permlink: shortData.permlink,
          hivePermlink: shortData.hivePermlink,
          user: shortData.user,
          caption: shortData.caption || shortData.title || '',
          audio: `${shortData.user.username} - Original Audio`,
          albumArt: shortData.user.avatar,
          stats: shortData.stats,
          isLiked: shortData.isLiked || false,
          isDisliked: shortData.isDisliked || false,
          comments: [],
          commentsLoaded: false,
          timeAgo: shortData.timeAgo,
          createdAt: shortData.createdAt,
          parentVideo: shortData.parentVideo || null,
          parentTimestamp: shortData.parentTimestamp || null,
          parentComment: shortData.parentComment || null,
          parentShort: shortData.parentShort || null,
          reactionChain: shortData.reactionChain || null,
          childReactions: shortData.childReactions || null,
        };

        setVideos(prev => [formatted, ...prev]);
        setCurrentIndex(0);
      } catch (err) {
        console.warn('Could not navigate to parent short:', err);
      } finally {
        setShortNavLoading(false);
      }
    })();
  }, [location.search, videos, user]);

  /* ---------- LOAD MORE VIDEOS ---------- */
  const loadMoreVideos = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;

    const nextPage = page + 1;
    setPage(nextPage);

    try {
      const data = feedUserRef.current
        ? await fetchUserShortsWithDetails(feedUserRef.current, nextPage, SHORTS_PAGE_SIZE)
        : await hiveApi.fetchShortsWithDetails(nextPage, SHORTS_PAGE_SIZE, user);

      if (data.success) {
        const formattedVideos = data.shorts.map(short => ({
          id: short.id,
          author: short.author,
          permlink: short.permlink,
          hivePermlink: short.hivePermlink,
          embedUrl: short.embedUrl || null,
          thumbnailUrl: short.thumbnailUrl || null,
          user: {
            username: short.user.username,
            avatar: short.user.avatar,
            isSubscribed: false,
            followersCount: short.user.followersCount ?? null,
            reputation: short.user.reputation ?? null,
          },
          caption: short.caption || short.title || '',
          tags: short.tags || [],
          audio: `${short.user.username} - Original Audio`,
          albumArt: short.user.avatar,
          stats: {
            likes: short.stats.likes,
            dislikes: short.stats.dislikes,
            comments: short.stats.comments,
            shares: short.stats.shares,
            remixes: short.stats.remixes,
            views: short.views || short.stats.views || 0,
            payout: short.stats.payout
          },
          isLiked: short.isLiked || false,
          isDisliked: short.isDisliked || false,
          comments: [],
          commentsLoaded: false,
          timeAgo: short.timeAgo,
          createdAt: short.createdAt,
          parentVideo: short.parentVideo || null,
          parentTimestamp: short.parentTimestamp || null,
          parentComment: short.parentComment || null,
          parentShort: short.parentShort || null,
          reactionChain: short.reactionChain || null,
          childReactions: short.childReactions || null,
          _enriched: short._enriched != null ? short._enriched : true,
        }));

        // Dedup on append: if the server's list ever shifts under us, a page can
        // overlap what we already hold. Appending blindly would show the same short
        // twice and throw the swipe index off.
        setVideos(prev => {
          const seen = new Set(prev.map(v => v.id));
          const fresh = formattedVideos.filter(v => !seen.has(v.id));
          return fresh.length ? [...prev, ...fresh] : prev;
        });
        setHasMore(nextPage < data.totalPages);
      }
    } catch (err) {
      console.error('Error loading more shorts:', err);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, page]);

  /* ---------- FETCH COMMENTS ---------- */
  const fetchComments = useCallback(async () => {
    const video = videos[currentIndex];
    if (!video || !video.hivePermlink || !video.author) return;

    if (commentsFetchedRef.current.has(video.id)) return;

    setCommentsLoading(true);
    commentsFetchedRef.current.add(video.id);

    try {
      const rawComments = await hiveApi.fetchPostComments(video.author, video.hivePermlink, user);
      const comments = await markByHidden(await markByReputation(rawComments));

      // Pre-render comment bodies as HTML
      try {
        const render = await getHiveRenderer();
        const rendered = {};
        const renderComment = (c) => {
          if (c?.body) {
            try { rendered[c.permlink] = render(hardBreakMd(c.body)); } catch (_) {}
          }
          if (c.children) c.children.forEach(renderComment);
        };
        comments.forEach(renderComment);
        setRenderedBodies(prev => ({ ...prev, ...rendered }));
      } catch (_) {}

      setVideos(prev =>
        prev.map((v, idx) =>
          idx === currentIndex
            ? { ...v, comments, commentsLoaded: true }
            : v
        )
      );
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setCommentsLoading(false);
    }
  }, [currentIndex, videos]);

  // Fetch comments when panel opens
  useEffect(() => {
    if (showComments && videos[currentIndex] && !videos[currentIndex].commentsLoaded) {
      fetchComments();
    }
  }, [showComments, currentIndex, videos, fetchComments]);

  const currentVideo = videos[currentIndex];

  // Warm the v2-tag lookup for the visible short so the vote dialog knows which
  // tag picker to draw the moment it opens (otherwise the wrong one flashes).
  useEffect(() => {
    prefetchVideoTagsV2(currentVideo?.author, currentVideo?.hivePermlink);
  }, [currentVideo?.author, currentVideo?.hivePermlink]);

  /* ---------- SUBTITLES ---------- */
  const {
    availableLanguages: subtitleLanguages,
    selectedLang: selectedSubtitleLang,
    selectLanguage: selectSubtitleLang,
    cues: subtitleCues,
    loading: subtitleLoading,
    subtitleStyle,
  } = useSubtitles(currentVideo?.author, currentVideo?.permlink);
  const [subtitleMenuOpen, setSubtitleMenuOpen] = useState(false);
  const [subtitleMenuPos, setSubtitleMenuPos] = useState(null);
  const subtitleMenuRef = useRef(null);
  const subtitleDropdownRef = useRef(null);

  // Close subtitle menu on outside click
  useEffect(() => {
    if (!subtitleMenuOpen) return;
    const handler = (e) => {
      if (
        subtitleMenuRef.current && !subtitleMenuRef.current.contains(e.target) &&
        (!subtitleDropdownRef.current || !subtitleDropdownRef.current.contains(e.target))
      ) {
        setSubtitleMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [subtitleMenuOpen]);

  const openSubtitleMenu = useCallback(() => {
    setSubtitleMenuOpen(prev => {
      if (!prev && subtitleMenuRef.current) {
        const rect = subtitleMenuRef.current.getBoundingClientRect();
        setSubtitleMenuPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
      }
      return !prev;
    });
  }, []);

  /* ---------- CAPTION TRANSLATE ---------- */
  const handleCaptionTranslate = useCallback(async (langCode) => {
    if (!currentVideo) return;
    const result = await onTranslate(currentVideo.permlink, currentVideo.caption, langCode);
    if (result) setTranslatedCaption(result);
  }, [currentVideo, onTranslate]);

  /* ---------- VOTE TOOLTIP ---------- */
  const toggleVoteTooltip = (author, permlink) => {
    // Require authentication before opening the vote tooltip
    if (!authenticated) {
      toast.error('Login to complete this operation');
      return;
    }

    setSelectedComment({ author, permlink });
    setShowTooltip(prev => !prev || activeTooltipPermlink !== permlink);
    setActiveTooltipPermlink(prev => (prev === permlink ? null : permlink));
  };

  /* ---------- POST COMMENT ---------- */
  const handlePostComment = async (parentAuthor, parentPermlink, commentText, isReply = false) => {
    if (!commentText.trim()) {
      toast.error('Please enter a comment');
      return;
    }

    if (!parentAuthor || !parentPermlink) {
      toast.error("Comments aren't available for this post");
      return;
    }

    if (!user || !isLoggedIn()) {
      toast.error('Please login to comment');
      return;
    }

    setPostingComment(true);
    const newPermlink = `re-${parentPermlink}-${Date.now()}`;

    const newCommentObj = {
      id: `${user}-${newPermlink}`,
      author: user,
      permlink: newPermlink,
      body: commentText,
      createdAt: new Date().toISOString(),
      timeAgo: 'Just now',
      netVotes: 0,
      children: [],
      stats: {
        num_likes: 0,
        total_hive_reward: 0
      },
      user: {
        username: `@${user}`,
        avatar: `https://images.hive.blog/u/${user}/avatar/small`
      },
      has_voted: false
    };

    // Pre-render the body (markdown + line breaks) for instant display.
    try {
      const render = await getHiveRenderer();
      const html = render(hardBreakMd(commentText));
      setRenderedBodies(prev => ({ ...prev, [newPermlink]: html }));
    } catch (_) { /* falls back to raw body */ }

    // Optimistically add the comment + bump the count NOW — signing happens in
    // the background, so the UI shouldn't wait for it (and the result shape of
    // the background broadcast must not gate the count).
    setVideos(prev =>
      prev.map((v, idx) => {
        if (idx !== currentIndex) return v;
        return {
          ...v,
          comments: isReply
            ? addReplyToComment(v.comments, parentPermlink, newCommentObj)
            : [newCommentObj, ...v.comments],
          stats: { ...v.stats, comments: (v.stats.comments || 0) + 1 }
        };
      })
    );
    if (isReply) { setReplyText(''); setActiveReply(null); } else { setNewComment(''); }

    try {
      await commentWithAioha(
        parentAuthor,
        parentPermlink,
        newPermlink,
        '', // title (empty for comments)
        commentText,
        { app: '3speak/new-version' }
      );
      toast.success('Comment posted successfully!');
    } catch (err) {
      console.error('Comment failed:', err);
      toast.error('Comment failed: ' + (err.message || 'please try again'));
      // Roll back the optimistic comment + count.
      setVideos(prev =>
        prev.map((v, idx) => {
          if (idx !== currentIndex) return v;
          return {
            ...v,
            comments: removeCommentByPermlink(v.comments, newPermlink),
            stats: { ...v.stats, comments: Math.max(0, (v.stats.comments || 1) - 1) }
          };
        })
      );
    } finally {
      setPostingComment(false);
    }
  };

  // Remove a comment (top-level or nested) by permlink — used to roll back an
  // optimistic comment if the background broadcast fails.
  const removeCommentByPermlink = (comments, permlink) =>
    comments
      .filter(c => c.permlink !== permlink)
      .map(c => (c.children && c.children.length
        ? { ...c, children: removeCommentByPermlink(c.children, permlink) }
        : c));

  // Helper to add reply to nested comments
  const addReplyToComment = (comments, parentPermlink, newComment) => {
    return comments.map(comment => {
      if (comment.permlink === parentPermlink) {
        return {
          ...comment,
          children: [...(comment.children || []), newComment]
        };
      }
      if (comment.children && comment.children.length > 0) {
        return {
          ...comment,
          children: addReplyToComment(comment.children, parentPermlink, newComment)
        };
      }
      return comment;
    });
  };

  // Update comment list after vote (passed to CommentVoteTooltip)
  const setCommentList = (updateFn) => {
    setVideos(prev =>
      prev.map((v, idx) => {
        if (idx !== currentIndex) return v;
        return {
          ...v,
          comments: typeof updateFn === 'function' ? updateFn(v.comments) : updateFn
        };
      })
    );
  };

  // Update post (video) state after a vote on the main post
  const handlePostVoteSuccess = (author, permlink, isNewVote, voteWeight) => {
    // Show heart animation on confirmed vote
    setShowHeartAnimation(true);
    if (heartAnimTimeoutRef.current) clearTimeout(heartAnimTimeoutRef.current);
    heartAnimTimeoutRef.current = setTimeout(() => setShowHeartAnimation(false), 800);

    setVideos(prev => prev.map(v => {
      if (v.author === author && v.hivePermlink === permlink) {
        const newLikes = isNewVote
          ? (v.stats?.likes || 0) + 1
          : v.stats?.likes || 0;
        return {
          ...v,
          isLiked: true,
          stats: { ...v.stats, likes: newLikes }
        };
      }
      return v;
    }));
  };

  /* ---------- BACK NAVIGATION ---------- */
  const handleShortBack = useCallback(() => {
    const history = shortHistoryRef.current;
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    shortHistoryRef.current = history.slice(0, -1);
    isNavigatingBackRef.current = true;
    navigate(`/shorts?v=${prev.author}/${prev.permlink}`, { replace: true });
  }, [navigate]);

  /* ---------- SHARE FUNCTIONALITY ---------- */
  const handleShare = async () => {
    if (!currentVideo) return;

    // Use shorts route with video parameter
    const shareUrl = `${window.location.origin}/shorts?v=${currentVideo.author}/${currentVideo.permlink}`;
    const shareData = {
      title: currentVideo.caption || '3Speak Short',
      text: `Check out this short by ${currentVideo.user.username} on 3Speak!`,
      url: shareUrl
    };

    try {
      // Check if Web Share API is supported (mainly mobile)
      if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        toast.success('Shared successfully!');
      } else {
        // Fallback: Copy to clipboard
        await navigator.clipboard.writeText(shareUrl);
        toast.success('Link copied to clipboard!');
      }
    } catch (err) {
      // User cancelled share or error occurred
      if (err.name !== 'AbortError') {
        // Try clipboard as fallback
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast.success('Link copied to clipboard!');
        } catch (clipboardErr) {
          console.error('Share failed:', err);
          toast.error('Failed to share');
        }
      }
    }
  };

  /* ---------- RESHARE FUNCTIONALITY ---------- */
  const handleReshare = async () => {
    if (!currentVideo || !user) {
      toast.error('Log in to reshare');
      return;
    }
    if (currentVideo.hivePostMissing) {
      toast.error("Reshare isn't available for this post");
      return;
    }
    if (hasReshared) return;

    const author = currentVideo.author;
    const permlink = currentVideo.hivePermlink || currentVideo.permlink;

    const result = await recordReshare(user, author, permlink);
    if (result) {
      setHasReshared(true);
      setReshareCount(prev => prev + 1);
      setReshareUsers(prev => [...prev, { username: user, reshared_at: Math.floor(Date.now() / 1000) }]);
      toast.success('Reshared!');
    } else {
      toast.error('Failed to reshare');
    }
  };

  const handleRemix = useCallback(async (mediaType = 'video') => {
    const currentVid = videos[currentIndex];
    if (!currentVid) return;

    // Pause current video
    if (playerRef.current) {
      playerRef.current.pause();
    }

    try {
      const source = await sdkApiRef.current.fetchSource(currentVid.author, currentVid.permlink);
      const directUrl = source?.url;

      if (directUrl) {
        setEditorVideoUrl(directUrl);
        setEditorVideoName(`${currentVid.author} - ${currentVid.caption || currentVid.permlink}`);
        setEditorOriginalAuthor(currentVid.author);
        setEditorOriginalPermlink(currentVid.hivePermlink || currentVid.permlink);
        setEditorOriginalShortPermlink(currentVid.permlink);
        setEditorVideoType(mediaType);
        setShowEditorModal(true);
      } else {
        toast.error('Could not resolve video URL for remix');
      }
    } catch (err) {
      console.error('[VideoShort] Remix URL resolve failed:', err);
      toast.error('Failed to load video for remix');
    }
  }, [videos, currentIndex]);

  // Close remix dropdown on click outside
  useEffect(() => {
    if (!remixDropdownOpen) return;
    const handleClickOutside = (e) => {
      if (remixDropdownRef.current && !remixDropdownRef.current.contains(e.target)) {
        setRemixDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [remixDropdownOpen]);

  /* ---------- INTERACTIONS ---------- */

  const handleToggleComments = () => setShowComments(prev => !prev);

  // Mobile comments panel drag-to-close
  const handleCommentsDragStart = useCallback((e) => {
    commentsDragStartY.current = e.touches[0].clientY;
    const panel = commentsPanelRef.current;
    if (panel) panel.style.transition = 'none';
  }, []);

  const handleCommentsDragMove = useCallback((e) => {
    if (commentsDragStartY.current == null) return;
    const dy = e.touches[0].clientY - commentsDragStartY.current;
    const offset = Math.max(0, dy); // only allow dragging down
    const panel = commentsPanelRef.current;
    if (panel) panel.style.transform = `translateY(${offset}px)`;
  }, []);

  const handleCommentsDragEnd = useCallback((e) => {
    if (commentsDragStartY.current == null) return;
    const dy = e.changedTouches[0].clientY - commentsDragStartY.current;
    commentsDragStartY.current = null;
    const panel = commentsPanelRef.current;
    if (panel) panel.style.transition = '';
    if (dy > 80) {
      // Dragged down far enough — close
      setShowComments(false);
      if (panel) panel.style.transform = '';
    } else {
      // Snap back
      if (panel) panel.style.transform = '';
    }
  }, []);

  /* ---------- NAVIGATION ---------- */

  const triggerSwipeAnimation = (direction) => {
    if (swipeAnimRef.current) clearTimeout(swipeAnimRef.current);
    setSwipeDragY(0);
    setSwipeDirection(direction);
    swipeAnimRef.current = setTimeout(() => {
      setSwipeDirection(null);
      swipeAnimRef.current = null;
    }, 350);
  };

  // ── Watch Later (bookmark button) ──
  // Same playlist the watch page uses: a private playlist literally named
  // "Watch Later", created on first use.
  const { data: myPlaylists = [], refetch: refetchPlaylists } = useMyPlaylists({ enabled: !!user });
  const watchLaterPlaylist = useMemo(
    () => myPlaylists.find((p) => p.name === WATCH_LATER_NAME),
    [myPlaylists],
  );
  const isInWatchLater = useMemo(
    () => (watchLaterPlaylist && currentVideo
      ? isVideoInPlaylist(watchLaterPlaylist, currentVideo.author, currentVideo.hivePermlink)
      : false),
    [watchLaterPlaylist, currentVideo],
  );
  const [watchLaterBusy, setWatchLaterBusy] = useState(false);

  const toggleWatchLater = useCallback(async () => {
    if (!user) { toast.error('Login to save shorts'); return; }
    if (!currentVideo || watchLaterBusy) return;
    if (currentVideo.hivePostMissing) { toast.error("This short can't be saved"); return; }
    const { author, hivePermlink } = currentVideo;
    setWatchLaterBusy(true);
    try {
      if (isInWatchLater) {
        await removeFromPlaylist(watchLaterPlaylist.id, author, hivePermlink);
        toast.success('Removed from Watch Later');
      } else if (watchLaterPlaylist) {
        await addToPlaylist(watchLaterPlaylist.id, author, hivePermlink, 0);
        toast.success('Saved to Watch Later');
      } else {
        // First ever save — create the playlist and add in one go.
        await createPlaylistAndAdd(WATCH_LATER_NAME, 'private', generatePlaylistId(), author, hivePermlink);
        toast.success('Saved to Watch Later');
      }
      // The playlist API is eventually consistent (it writes to Hive), so give it a
      // moment before refetching — same delay the watch page uses.
      setTimeout(() => {
        refetchPlaylists();
        queryClient.invalidateQueries({ queryKey: ['myPlaylists'] });
      }, 2000);
    } catch (err) {
      toast.error('Failed: ' + (err.message || 'please try again'));
    } finally {
      setWatchLaterBusy(false);
    }
  }, [user, currentVideo, watchLaterBusy, isInWatchLater, watchLaterPlaylist, refetchPlaylists, queryClient]);

  // Switch the shorts feed mode. Clears the ?v= param first: we replaceState it to
  // the short in view as you swipe, and the refetch would otherwise treat it as a
  // "shared video", prepend it and jump back to it — i.e. you'd land on the exact
  // short you just finished instead of the top of the new feed.
  const switchFeedMode = useCallback((mode) => {
    window.history.replaceState({}, '', window.location.pathname);
    setCurrentIndex(0);
    setPage(1);
    setHasMore(true);
    setShortsFeedMode(mode);
  }, [setShortsFeedMode]);

  // Find the nearest ready player index in a given direction, skipping up to `maxSkip` non-ready videos
  // 🚨 Both nav functions bail while a spot is on screen, and this is the ONLY place
  // that needs to say so: the wheel handler, the arrow keys, the on-screen arrows and
  // the touch swipe all funnel through these two. Guarding here rather than at each
  // call site is what stops the next surface that learns to navigate from quietly
  // reopening the hole.
  /* Swiping past a spot ENDS it. It does not queue behind it.
   *
   * A shorts feed is a swipe, and a card that refuses to move does not read as an ad
   * you have to watch, it reads as a broken feed: people swipe again, harder, and then
   * leave. Every other shorts product lets you flick past the ad, so anyone arriving
   * here already knows the gesture and expects it to work.
   *
   * The advertiser is not cheated by it. An impression completes only once enough of
   * the spot has actually played, so a spot swiped away after a second was never
   * billed. What they buy is attention; this only stops them buying the absence of an
   * alternative.
   */
  const endAdForNavigation = () => {
    if (!adPlaying) return;
    setShortsAd(null);
    setAdStarted(false);
    setAdSecondsLeft(0);
    // Deliberately NOT endShortsAd(): that reloads the short the spot interrupted,
    // which is the one being navigated away from. Clearing the spot lets the effect
    // that follows `currentIndex` load the short being moved TO instead.
  };

  const handlePrevious = () => {
    endAdForNavigation();
    if (currentIndex === 0) return;
    shortHistoryRef.current = [];
    triggerSwipeAnimation('down');
    setCurrentIndex(currentIndex - 1);
  };

  const handleNext = async () => {
    endAdForNavigation();
    if (currentIndex >= videos.length - 1) {
      if (hasMore && !loadingMoreRef.current) {
        await loadMoreVideos();
        triggerSwipeAnimation('up');
        setCurrentIndex(prev => prev + 1);
        return;
      }
      // End of the "My interests" feed. It's often short — a given topic just doesn't
      // have many recent shorts — so drop back to Discover instead of dead-ending on
      // the last one. Guarded on interestsMode, which flips false the moment we
      // switch, so this can't fire twice.
      if (interestsMode && !feedUser && !hasMore && !loadingMoreRef.current) {
        toast.info("That's all the shorts for your interests — showing Discover");
        switchFeedMode('discover');
      }
      return;
    }
    shortHistoryRef.current = [];
    triggerSwipeAnimation('up');
    const nextIdx = currentIndex + 1;
    setCurrentIndex(nextIdx);

    // Prefetch more items before the end of the current page
    if (nextIdx >= videos.length - 7 && hasMore) {
      loadMoreVideos();
    }
  };
  handleNextRef.current = handleNext;

  // Keyboard navigation: ArrowUp = previous, ArrowDown = next
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ignore when typing in inputs or when comments panel is open or transitioning
      const active = document.activeElement;
      const tag = active?.tagName;
      const isEditable = active?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || isEditable) return;
      // Desktop keeps the comments open as a side panel — keyboard nav still works;
      // only block while the full-screen comments overlay is up (mobile).
      if ((showComments && window.innerWidth <= 768) || isTransitioning) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleNext();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handlePrevious();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekTo(Math.max(0, currentTimeRef.current - 5));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekTo(Math.min(durationRef.current, currentTimeRef.current + 5));
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlayPause();
      } else if (e.key === 'm' || e.key === 'M') {
        toggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleNext, handlePrevious, seekTo, togglePlayPause, toggleMute, showComments, isTransitioning]);

  /* Desktop: the scroll wheel navigates shorts, exactly like the Up/Down arrows
   * (scroll down = next, scroll up = previous). Attached to the video container only,
   * so scrolling the comments side-panel still scrolls the comments.
   *
   * A cooldown stops one wheel gesture from skipping several shorts. One flick of a
   * wheel, and every moment of a trackpad swipe, is dozens of events.
   *
   * 🚨 THE COOLDOWN LIVES IN A REF, and has to.
   *
   * It was a local inside this effect, and the effect depends on handleNext and
   * handlePrevious, which are rebuilt on every render. So advancing re-rendered,
   * re-ran the effect, and the replacement started with lock = false again — the
   * cooldown was thrown away between the events it existed to swallow, and one gesture
   * walked through five or ten shorts. A ref is the same value across every re-run,
   * which is the only thing that makes a cooldown mean anything here. */
  useEffect(() => {
    if (typeof window === 'undefined' || window.innerWidth <= 768) return;
    const el = videoContainerRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) < 8) return; // ignore tiny trackpad jitter
      e.preventDefault();
      if (wheelLockRef.current || isTransitioning) return;
      wheelLockRef.current = true;
      if (e.deltaY > 0) handleNext();
      else handlePrevious();
      setTimeout(() => { wheelLockRef.current = false; }, 700);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [handleNext, handlePrevious, isTransitioning]);

  // Local handler for the hidden focusable element (helps capture on mobile)
  const handleKeyDownCapture = (e) => {
    const active = document.activeElement;
    const tag = active?.tagName;
    const isEditable = active?.isContentEditable;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || isEditable) return;
    if (showComments || isTransitioning) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      handleNext();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      handlePrevious();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekTo(Math.max(0, currentTimeRef.current - 5));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekTo(Math.min(durationRef.current, currentTimeRef.current + 5));
    } else if (e.key === ' ') {
      e.preventDefault();
      togglePlayPause();
    } else if (e.key === 'm' || e.key === 'M') {
      toggleMute();
    }
  };

  /* ---------- TOUCH/SWIPE HANDLERS FOR MOBILE ---------- */

  const onTouchStart = (e) => {
    // Don't handle swipe if comments panel is open
    if (showComments) return;
    setTouchEnd(null);
    const startY = e.targetTouches[0].clientY;
    setTouchStart(startY);
    touchStartYRef.current = startY; // Synchronous mirror for reliable gesture detection
    gestureHandledRef.current = false;
    // Start long-press timer (500ms)
    longPressTimerRef.current = setTimeout(() => {
      gestureHandledRef.current = true;
      toggleMute();
    }, 500);
    // attempt to focus the hidden keyboard capture so mobile hardware keyboards send events
    try {
      keyboardRef.current?.focus?.();
    } catch (err) {
      // ignore
    }
  };

  const onTouchMove = (e) => {
    // A spot no longer blocks the gesture, so the card tracks the finger during one
    // exactly as it does anywhere else. Only the comment sheet still swallows it,
    // because there the vertical drag belongs to the sheet.
    if (showComments) return;
    const y = e.targetTouches[0].clientY;
    setTouchEnd(y);
    // Live drag: clamp to ±120px for visual feedback
    if (touchStart != null) {
      const delta = y - touchStart;
      setSwipeDragY(Math.max(-120, Math.min(120, delta)));
    }
    // Cancel long press if finger is moving
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const onTouchEnd = async (e) => {
    // Prevent browser from synthesizing a click event after touch
    if (e?.preventDefault) e.preventDefault();
    // Guard: mark recent touch so handleOverlayClick skips any synthetic click
    recentTouchRef.current = true;
    setTimeout(() => { recentTouchRef.current = false; }, 400);
    setSwipeDragY(0);
    // Cancel long-press timer
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    // Compute swipe distance from refs/event (not state, which may be stale on fast swipes)
    const startY = touchStartYRef.current;
    const endY = e.changedTouches?.[0]?.clientY;
    const distance = startY != null && endY != null ? startY - endY : 0;
    const wasSwipe = Math.abs(distance) > minSwipeDistance;

    if (startY != null && endY != null && !showComments && !isTransitioning) {
      // `|| interestsMode` so a swipe at the END of the interests feed still reaches
      // handleNext, which is what triggers the automatic fall-back to Discover.
      if (distance > minSwipeDistance && (currentIndex < videos.length - 1 || hasMore || interestsMode)) {
        setIsTransitioning(true);
        await handleNext();
        setTimeout(() => setIsTransitioning(false), 350);
      } else if (distance < -minSwipeDistance && currentIndex > 0) {
        setIsTransitioning(true);
        handlePrevious();
        setTimeout(() => setIsTransitioning(false), 350);
      }
    }

    // Reset touch state
    setTouchStart(null);
    setTouchEnd(null);
    touchStartYRef.current = null;

    // Gesture tap detection — only if it wasn't a swipe or long press
    if (wasSwipe || gestureHandledRef.current) return;

    // When comments panel is open, allow simple play/pause but skip double-tap gestures
    if (showComments) {
      togglePlayPause();
      return;
    }

    tapCountRef.current += 1;
    if (tapCountRef.current === 1) {
      tapTimerRef.current = setTimeout(() => {
        if (tapCountRef.current === 1) {
          togglePlayPause();
        }
        tapCountRef.current = 0;
      }, 300);
    } else if (tapCountRef.current >= 2) {
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      tapCountRef.current = 0;
      quickUpvote();
    }
  };

  const formatNumber = (num) =>
    num >= 1000 ? (num / 1000).toFixed(1) + 'K' : num?.toString() || '0';

  const formatPayout = (payout) => {
    if (payout === null || payout === undefined) return '$0.00';
    const num = parseFloat(payout);
    if (isNaN(num)) return '$0.00';
    if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
    return `$${num.toFixed(2)}`;
  };

  // Calculate which videos to preload — memoized to prevent cleanup effect from running on every render
  const preloadedIndices = useMemo(() => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const preloadRange = { before: 1, after: isMobile ? 4 : 4 };
    const indices = [];
    for (let i = Math.max(0, currentIndex - preloadRange.before); i <= Math.min(videos.length - 1, currentIndex + preloadRange.after); i++) {
      indices.push(i);
    }
    return indices;
  }, [currentIndex, videos.length]);

  // Prefetch API metadata + HLS manifest for upcoming videos (lightweight fetch, no <video> needed)
  // iOS only allows one active <video> — so we prefetch to warm the browser cache instead.
  const prefetchVideo = useCallback((videoId, videoAuthor, videoPermlink) => {
    if (prefetchedSourcesRef.current.has(videoId) || prefetchingRef.current.has(videoId)) return;
    prefetchingRef.current.add(videoId);
    const api = sdkApiRef.current;
    api.fetchSource(videoAuthor, videoPermlink).then(source => {
      prefetchedSourcesRef.current.set(videoId, source);
      prefetchingRef.current.delete(videoId);
      // Also prefetch the HLS manifest itself to warm CDN + browser cache
      api.prefetchManifest(source.url).catch(() => {});
      console.log(`[VideoShort] Prefetched source for ${videoId}`);
    }).catch(err => {
      prefetchingRef.current.delete(videoId);
      console.error(`[VideoShort] Prefetch failed for ${videoId}:`, err);
    });
  }, []);

  // One-time setup: attach a persistent Player to the <video> element when it mounts.
  // The Player is reused across all videos — only load() is called on each swipe.
  const setupVideoElement = useCallback((element) => {
    if (!element || videoElRef.current === element) return;
    videoElRef.current = element;

    // Destroy old player if switching elements (shouldn't happen with stable key)
    if (playerRef.current && !playerRef.current.destroyed) {
      playerRef.current.destroy();
    }

    const player = new Player({
      apiBase: getPlayerUrl(),
      muted: true,
      loop: playbackModeRef.current === 'auto-replay',
      poster: false,
      debug: false,
    });

    player.attach(element);
    playerRef.current = player;

    // Subscribe to SDK events — these persist for the lifetime of the player.
    // All handlers use refs (videosRef, currentIndexRef) to get current state.
    player.on('ready', ({ isVertical, width, height }) => {
      const currentVid = videosRef.current[currentIndexRef.current];
      const videoId = currentVid?.id;
      console.log(`[VideoShort SDK] Player ready: ${videoId}, ${width}x${height}, vertical=${isVertical}`);

      // Apply orientation styles to the video element
      if (isVertical) {
        element.style.position = 'absolute';
        element.style.top = '0';
        element.style.left = '50%';
        element.style.transform = 'translateX(-50%)';
        element.style.width = 'auto';
        element.style.height = '100%';
        element.style.aspectRatio = '9 / 16';
      } else {
        element.style.position = 'absolute';
        element.style.top = '50%';
        element.style.left = '0';
        element.style.transform = 'translateY(-50%)';
        element.style.width = '100%';
        element.style.height = 'auto';
        element.style.aspectRatio = '16 / 9';
      }

      // Mark this player as ready
      if (videoId) {
        readyPlayers.current.add(videoId);
        setReadyPlayerIds(prev => {
          if (prev.has(videoId)) return prev;
          const next = new Set(prev);
          next.add(videoId);
          return next;
        });
      }
      setFirstPlayerReady(true);

      // If this is the pending video, play it now
      if (videoId && pendingPlayRef.current === videoId) {
        console.log(`[VideoShort SDK] Player ready - now playing: ${videoId}`);
        pendingPlayRef.current = null;
        playPlayerWithMuteSync(player);
      }
    });

    player.on('timeupdate', ({ currentTime, duration, paused }) => {
      if (isScrubbingRef.current || duration <= 0) return;

      currentTimeRef.current = currentTime || 0;
      durationRef.current = duration;
      updateProgressBar();
      setIsPlaying(!paused);

      // A spot has painted its first frame — the cover can come off. Read through a
      // ref because this listener is registered once at player setup and would
      // otherwise close over the state as it was then.
      if (adPlayingRef.current && currentTime > 0) setAdStarted(true);

      // Watch-duration heartbeat while genuinely playing (throttled to beatMs;
      // the server measures the real wall-clock gap between beats + which part
      // of the timeline was watched, for the heatmap).
      // The player keeps firing these while the tab is hidden, so visibility is
      // checked here rather than inferred from playback.
      const W = shortWatchRef.current;
      if (!paused && shortVisibleRef.current && W.sid && Date.now() - W.lastBeatAt >= W.beatMs) {
        shortWatchBeat(shortWatchRef, currentTime);
      }

      // Auto-swipe: trigger swipe when near end of video
      if (playbackModeRef.current === 'auto-swipe' && !autoSwipeTriggeredRef.current) {
        const remaining = duration - currentTime;
        if (remaining <= 0.25) {
          autoSwipeTriggeredRef.current = true;
          handleNextRef.current();
        }
      }
      // None mode: pause video near end and show replay button
      if (playbackModeRef.current === 'none' && !autoSwipeTriggeredRef.current) {
        const remaining = duration - currentTime;
        if (remaining <= 0.3 && remaining >= 0) {
          autoSwipeTriggeredRef.current = true;
          player.pause();
          setVideoEnded(true);
          setIsPlaying(false);
        }
      }
    });

    player.on('play', () => {
      setIsPlaying(true);
      setAutoplayBlocked(false);
      // Open a watch-duration session the moment the active short starts playing
      // (non-polluting — tracks duration without incrementing the view counter).
      startShortWatch(videosRef.current[currentIndexRef.current], shortWatchRef, durationRef.current, currentTimeRef.current);
    });

    player.on('pause', () => {
      setIsPlaying(false);
      // Final measured beat up to the pause point.
      shortWatchBeat(shortWatchRef, currentTimeRef.current);
    });

    player.on('ended', () => {
      // Capture the tail of the watched short.
      shortWatchBeat(shortWatchRef, currentTimeRef.current);
      if (playbackModeRef.current === 'none') {
        setVideoEnded(true);
        setIsPlaying(false);
      }
    });

    player.on('error', ({ message, fatal }) => {
      // Only log fatal errors — non-fatal ones (like bufferStalledError) are recovered automatically by hls.js
      if (fatal) {
        console.error(`[VideoShort SDK] Fatal error: ${message}`);
      }
    });

    // Load the first video
    const currentVid = videosRef.current[currentIndexRef.current];
    if (currentVid) {
      pendingPlayRef.current = currentVid.id;
      const cachedSource = prefetchedSourcesRef.current.get(currentVid.id);
      if (cachedSource) {
        player.load(cachedSource).catch(err => {
          console.error(`[VideoShort SDK] Failed to load initial video:`, err);
        });
      } else {
        player.load(`${currentVid.author}/${currentVid.permlink}`).catch(err => {
          console.error(`[VideoShort SDK] Failed to load initial video:`, err);
        });
      }
    }
  }, []);

  // (Prefetch effect is below, after chainPreloadEntries declaration)

  // Populate chain preload data for instant navigation
  useEffect(() => {
    const cv = videos[currentIndex];
    if (cv?.reactionChain) {
      for (const step of cv.reactionChain) {
        if (step.shortPermlink && !step.isRoot) {
          chainPreloadDataRef.current.set(`${step.author}-${step.shortPermlink}`, {
            author: step.author,
            permlink: step.shortPermlink,
            hivePermlink: step.permlink,
            title: step.title || '',
            thumbnail: step.thumbnail || null,
          });
        }
      }
    }
    if (cv?.childReactions) {
      for (const child of cv.childReactions) {
        if (child.shortPermlink) {
          chainPreloadDataRef.current.set(`${child.author}-${child.shortPermlink}`, {
            author: child.author,
            permlink: child.shortPermlink,
            hivePermlink: child.permlink,
            title: child.title || '',
            thumbnail: child.thumbnail || null,
          });
        }
      }
    }
  }, [videos, currentIndex]);

  // Compute chain preload entries for player pre-warming
  const chainPreloadEntries = useMemo(() => {
    const cv = videos[currentIndex];
    const entries = [];
    const seen = new Set(videos.map(v => v.id));

    if (cv?.reactionChain) {
      for (const step of cv.reactionChain) {
        if (step.shortPermlink && !step.isRoot) {
          const id = `${step.author}-${step.shortPermlink}`;
          if (!seen.has(id)) {
            seen.add(id);
            entries.push({ id, author: step.author, permlink: step.shortPermlink });
          }
        }
      }
    }
    if (cv?.childReactions) {
      for (const child of cv.childReactions) {
        if (child.shortPermlink) {
          const id = `${child.author}-${child.shortPermlink}`;
          if (!seen.has(id)) {
            seen.add(id);
            entries.push({ id, author: child.author, permlink: child.shortPermlink });
          }
        }
      }
    }

    return entries;
  }, [videos, currentIndex]);

  // Prefetch upcoming videos when currentIndex changes
  useEffect(() => {
    preloadedIndices.forEach(idx => {
      if (idx === currentIndex) return; // Current video gets a real player, not just prefetch
      const video = videos[idx];
      if (video) {
        prefetchVideo(video.id, video.author, video.permlink);
      }
    });
    // Also prefetch chain entries
    chainPreloadEntries.forEach(entry => {
      prefetchVideo(entry.id, entry.author, entry.permlink);
    });
  }, [currentIndex, preloadedIndices, videos, chainPreloadEntries, prefetchVideo]);

  // Clean up stale prefetch caches for videos far out of range
  useEffect(() => {
    const keepIds = new Set(preloadedIndices.map(idx => videos[idx]?.id).filter(Boolean));
    chainPreloadEntries.forEach(e => keepIds.add(e.id));
    for (const id of prefetchedSourcesRef.current.keys()) {
      if (!keepIds.has(id)) {
        prefetchedSourcesRef.current.delete(id);
      }
    }
  }, [preloadedIndices, videos, chainPreloadEntries]);

  const handleProfileNavigation = (username) => {
    navigate(`/p/${username}`);
  };

  /* ---------- RENDER ---------- */

  if (loading && videos.length === 0) {
    return (
      <main className="short-main no-bottom-bar">
        <ShortsLoadingScreen />
      </main>
    );
  }

  // Show "Loading shorts..." overlay until the first player is ready
  const showInitialLoadingOverlay = !firstPlayerReady && videos.length > 0;

  if (error && videos.length === 0) {
    return (
      <main className="short-main no-bottom-bar">
        <div className="errorState">
          <p>Error loading shorts: {error}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </main>
    );
  }

  if (!currentVideo) {
    // "My interests" can legitimately come back empty (nothing recent matches the
    // user's topics) — say so and offer a way back, rather than a bare dead end.
    if (interestsMode && !feedUser) {
      return (
        <main className="short-main no-bottom-bar">
          <div className="emptyState shortsInterestsEmpty">
            <p>No shorts match your interests right now.</p>
            <button type="button" onClick={() => switchFeedMode('discover')}>
              Switch to Discover
            </button>
          </div>
        </main>
      );
    }
    return (
      <main className="short-main no-bottom-bar">
        <div className="emptyState">
          <p>No shorts available</p>
        </div>
      </main>
    );
  }

  return (
    <>
    <main className={`short-main${shortsCommentBar ? '' : ' no-bottom-bar'}${adPlaying ? ' ad-playing' : ''}`}>
      <div className="landscape-block"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onTouchStart={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onTouchMove={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); }}
        onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
      >
        <RotateCcw size={48} />
        <p>Please rotate your device to portrait mode</p>
      </div>
      <AmbientGlow getVideoEl={() => videoElRef.current} glowMode={glowMode} />

      {/* Browser-tab title for the short currently in view (RouteTitle skips
          /shorts so it doesn't fight us for the <title> tag). */}
      <Helmet>
        <title>
          {currentVideo?.title
            ? `3S | ${currentVideo.title}`
            : currentVideo?.author
              ? `3S | Short by @${currentVideo.author}`
              : '3S | Shorts'}
        </title>
      </Helmet>

      <div
        tabIndex={0}
        ref={keyboardRef}
        onKeyDown={handleKeyDownCapture}
        className="keyboard-capture"
        aria-hidden="true"
      />
      <div className={`videoWrapper ${showComments ? 'with-comments' : ''}`}>

        {/* VIDEO */}
        <div
          className={`videoContainer${swipeDirection ? ` swipe-${swipeDirection}` : ''}`}
          ref={videoContainerRef}
          style={swipeDragY && !swipeDirection ? { transform: `translateY(${swipeDragY * 0.6}px)`, transition: 'none' } : undefined}
        >
          {/* Single SDK video player — only the current video gets a <video> element.
              Upcoming videos are prefetched (API + manifest) so they load fast on swipe.
              iOS only allows one active <video> at a time. */}
          {SHORTS_ADS_ENABLED && shortsAd && (
            <ShortsAdOverlay
              brand={shortsAd.brand}
              secondsLeft={adSecondsLeft}
              loading={!adStarted}
            />
          )}
          {currentVideo && (
            <video
              key="shorts-player"
              id="shorts-player"
              ref={setupVideoElement}
              autoPlay
              playsInline
              webkit-playsinline=""
              muted
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                pointerEvents: 'none',
                zIndex: 2,
                background: '#000',
              }}
            />
          )}

          {/* Tap-to-play fallback when iOS blocks autoplay (Low Power Mode, etc.) */}
          {autoplayBlocked && currentVideo && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                const player = playerRef.current;
                if (player && !player.destroyed) {
                  player.setMuted(true);
                  player.play().then(() => {
                    if (!player.destroyed) player.setMuted(isMutedRef.current);
                    setAutoplayBlocked(false);
                    setIsPlaying(true);
                  }).catch(() => {});
                }
              }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                zIndex: 10,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: 'rgba(0,0,0,0.3)',
              }}
            >
              <div style={{
                width: 72,
                height: 72,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Play size={36} fill="#000" color="#000" style={{ marginLeft: 4 }} />
              </div>
            </div>
          )}

          {/* Full "Loading shorts..." overlay for the very first video until its player is ready */}
          {showInitialLoadingOverlay && (
            <ShortsLoadingScreen overlay />
          )}

          {/* Chain preload videos are prefetched via API + manifest only (no <video> elements) */}

          {/* Transparent overlay for gestures */}
          <div
            className="videoOverlay"
            onClick={handleOverlayClick}
            onMouseDown={handleOverlayMouseDown}
            onMouseUp={handleOverlayMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {/* Play/Pause icon (long press feedback) */}
            <div className={`playPauseIcon ${showPlayPauseIcon ? 'visible' : ''}`}>
              {isPlaying ? <Pause size={48} /> : <Play size={48} />}
            </div>
            {/* Mute/Unmute icon (single tap feedback) */}
            <div className={`playPauseIcon ${showMuteIcon ? 'visible' : ''}`}>
              {(isMuted || unmutePending) ? <VolumeX size={48} /> : <Volume2 size={48} />}
            </div>
            {/* Heart animation (double tap feedback) */}
            <div className={`heartAnimation ${showHeartAnimation ? 'visible' : ''}`}>
              <Heart size={80} fill="#ff2d55" color="#ff2d55" />
            </div>

            {/* Feed switcher — sits ON the video (top-left), inside the overlay like the
                other on-video controls, so it lines up with the player instead of the
                full-width page. Main feed only: a creator's shorts (?user=…) and the
                stories view keep their own feeds, so it's hidden there.
                Touch events are stopped so tapping it never registers as a swipe. */}
            {!feedUser && !isStoriesMode && (
              <div
                className="shortsFeedSwitch"
                role="tablist"
                aria-label="Shorts feed"
                onTouchStart={(e) => e.stopPropagation()}
                onTouchMove={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={shortsFeedMode !== 'interests'}
                  className={shortsFeedMode !== 'interests' ? 'active' : ''}
                  onClick={(e) => { e.stopPropagation(); switchFeedMode('discover'); }}
                >
                  Discover
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={shortsFeedMode === 'interests'}
                  className={shortsFeedMode === 'interests' ? 'active' : ''}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!hasInterests) {
                      toast.error("You haven't picked any interests yet — choose them in Settings");
                      return;
                    }
                    switchFeedMode('interests');
                  }}
                  title={hasInterests ? 'Only shorts matching your interests' : 'Pick some interests first'}
                >
                  My interests
                </button>
              </div>
            )}
            {/* Ambient glow toggle */}
            <div className={`glowIndicator${glowMode !== 'off' ? ' active' : ''}`}
              onClick={(e) => { e.stopPropagation(); toggleGlow(); }}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); toggleGlow(); }}
              title={glowMode === 'off' ? 'Ambient light: subtle' : glowMode === 'page' ? 'Ambient light: vivid' : 'Ambient light: off'}
            >
              {glowMode === 'off' && <Moon size={16} />}
              {glowMode === 'page' && <Lightbulb size={16} />}
              {glowMode === 'vivid' && <Sun size={16} />}
            </div>
            {/* Playback mode toggle button */}
            <div className="playbackModeIndicator"
              onClick={(e) => { e.stopPropagation(); cyclePlaybackMode(); }}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); cyclePlaybackMode(); }}
            >
              {playbackMode === 'auto-replay' ? <Repeat size={16} /> :
               playbackMode === 'auto-swipe' ? <ChevronsUp size={18} /> :
               <Square size={14} />}
            </div>
            {/* Mute/unmute toggle button */}
            <div className="muteIndicator"
              onClick={(e) => { e.stopPropagation(); toggleMute(); }}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); toggleMute(); }}
            >
              {(isMuted || unmutePending) ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </div>
            {/* Playback mode fading text indicator */}
            <div className={`modeIndicatorText ${showModeIndicator ? 'visible' : ''}`}>
              {playbackMode === 'auto-replay' ? 'Auto-Replay' :
               playbackMode === 'auto-swipe' ? 'Auto-Swipe' :
               'Manual'}
            </div>
            {/* Replay button for 'none' mode when video ends */}
            {videoEnded && playbackMode === 'none' && (
              <div className="replayOverlay"
                onClick={(e) => {
                  e.stopPropagation();
                  setVideoEnded(false);
                  sendCommand('seek', { time: 0 });
                  setTimeout(() => sendCommand('play'), 100);
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  setVideoEnded(false);
                  sendCommand('seek', { time: 0 });
                  setTimeout(() => sendCommand('play'), 100);
                }}
              >
                <RotateCcw size={56} />
              </div>
            )}
          </div>

          {/* Progress bar */}
          <div
            className="videoProgressBar"
            ref={progressBarRef}
            onMouseDown={handleProgressMouseDown}
            onClick={(e) => e.stopPropagation()}
            onTouchStart={(e) => { e.stopPropagation(); setIsScrubbing(true); isScrubbingRef.current = true; handleProgressBarInteraction(e.touches[0]); }}
            onTouchMove={(e) => { e.stopPropagation(); if (isScrubbingRef.current) handleProgressBarInteraction(e.touches[0]); }}
            onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); setIsScrubbing(false); isScrubbingRef.current = false; }}
          >
            <div className="videoProgressFill" ref={progressFillRef} style={{ width: '0%' }} />
            <div className="videoProgressHandle" ref={progressHandleRef} style={{ left: '0%' }} />
          </div>

          {/* Loading overlay for short navigation */}
          {shortNavLoading && (
            <div className="shortNavLoadingOverlay" onClick={(e) => e.stopPropagation()}>
              <Loader2 size={28} className="spinner" />
            </div>
          )}

          {/* Mobile back button (left of mute button) */}
          {shortHistoryRef.current.length === 0 && (
            <button className="shortBackBtn mobileOnly" onClick={(e) => { e.stopPropagation(); navigate(-1); }}>
              <ArrowLeft size={18} />
            </button>
          )}

          {/* Stories mode button (next to back button on mobile) — only in stories mode */}
          {isStoriesMode && (
            <button className="shortStoriesBtn mobileOnly" onClick={(e) => { e.stopPropagation(); navigate('/shorts'); }}>
              <ShortsIcon size={18} />
            </button>
          )}

          {/* Subtitle/CC toggle (outside videoOverlay; dropdown via portal to escape stacking contexts) */}
          {subtitleLanguages && subtitleLanguages.length > 0 && (
            <div className={`subtitleIndicator${selectedSubtitleLang ? ' active' : ''}${isStoriesMode ? ' stories-mode' : ''}`}
              ref={subtitleMenuRef}
              onClick={(e) => { e.stopPropagation(); openSubtitleMenu(); }}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => { e.stopPropagation(); e.preventDefault(); openSubtitleMenu(); }}
            >
              {selectedSubtitleLang ? <MdClosedCaption size={18} /> : <MdClosedCaptionOff size={18} />}
            </div>
          )}
          {subtitleMenuOpen && subtitleMenuPos && createPortal(
            <div className="shortsSubtitleMenu"
              ref={subtitleDropdownRef}
              onClick={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{ position: 'fixed', top: subtitleMenuPos.top, right: subtitleMenuPos.right, zIndex: 99999 }}
            >
              <button
                className={`shortsSubtitleItem${!selectedSubtitleLang ? ' active' : ''}`}
                onClick={() => { selectSubtitleLang(null); setSubtitleMenuOpen(false); }}
              >
                Off
              </button>
              {subtitleLanguages.map((sub) => {
                const langInfo = SUPPORTED_LANGUAGES.find(l => l.code === sub.lang);
                const label = langInfo ? langInfo.native : sub.lang;
                return (
                  <button
                    key={sub.lang}
                    className={`shortsSubtitleItem${selectedSubtitleLang === sub.lang ? ' active' : ''}`}
                    onClick={() => { selectSubtitleLang(sub.lang); setSubtitleMenuOpen(false); }}
                  >
                    {label}
                    {subtitleLoading && selectedSubtitleLang === sub.lang && ' ...'}
                  </button>
                );
              })}
            </div>,
            document.body
          )}

          {/* Back button (visible after navigating to a parent short) */}
          {shortHistoryRef.current.length > 0 && (
            <button className="shortBackBtn" onClick={(e) => { e.stopPropagation(); handleShortBack(); }}>
              <ArrowLeft size={18} />
              <span>Back</span>
            </button>
          )}

          {/* Reaction chain overlay (for reactions and remixes) */}
          {((currentVideo.reactionChain && currentVideo.reactionChain.length > 0) || (currentVideo.childReactions && currentVideo.childReactions.length > 0)) && (() => {
            const chain = currentVideo.reactionChain || [];
            const rootStep = chain.find(s => s.isRoot);
            const childSteps = chain.filter(s => !s.isRoot);
            const rootUrl = rootStep ? `/watch?v=${rootStep.author}/${rootStep.permlink}${currentVideo.parentTimestamp != null ? `&t=${currentVideo.parentTimestamp}` : ''}` : null;
            return (
              <div className={`reactionChainOverlay${parentCardVisible ? '' : ' collapsed'}${shortHistoryRef.current.length > 0 ? ' has-back' : ''}`} onClick={(e) => e.stopPropagation()}>
                {parentCardVisible && (
                  <div className="reactionChainBreadcrumb">
                    {/* Root / origin card — 50% wide, thumb left + info right */}
                    {rootStep && (
                      <div className="chainRoot">
                        {rootStep.thumbnail && (
                          <img className="chainRootThumb" src={fixVideoThumbnail({ thumbnail: rootStep.thumbnail })} alt="" onError={(e) => (e.currentTarget.src = fallbackImg)} />
                        )}
                        <div className="chainRootInfo">
                          <span className="chainRootTitle">{rootStep.title || 'Original video'}</span>
                          <div className="chainRootMeta">
                            <AuthorBadge author={rootStep.author} compact noLink />
                            {currentVideo.parentTimestamp != null && (
                              <span className="chainRootTimestamp">
                                {Math.floor(currentVideo.parentTimestamp / 60)}:{(currentVideo.parentTimestamp % 60).toString().padStart(2, '0')}
                              </span>
                            )}
                          </div>
                        </div>
                        <Link to={rootUrl} className="chainActionBtn" onClick={(e) => e.stopPropagation()} title="Watch">
                          <Video size={14} />
                        </Link>
                      </div>
                    )}

                    {/* Child steps — horizontal scroll row */}
                    {(childSteps.length > 0 || currentVideo.childReactions?.length > 0) && (
                      <div
                        className="chainChildRow"
                        ref={chainRowRef}
                        onMouseDown={(e) => {
                          const el = chainRowRef.current;
                          if (!el) return;
                          chainDragRef.current = { isDown: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
                          el.style.cursor = 'grabbing';
                        }}
                        onMouseLeave={() => { chainDragRef.current.isDown = false; if (chainRowRef.current) chainRowRef.current.style.cursor = ''; }}
                        onMouseUp={() => { chainDragRef.current.isDown = false; if (chainRowRef.current) chainRowRef.current.style.cursor = ''; }}
                        onMouseMove={(e) => {
                          if (!chainDragRef.current.isDown) return;
                          e.preventDefault();
                          const el = chainRowRef.current;
                          const x = e.pageX - el.offsetLeft;
                          el.scrollLeft = chainDragRef.current.scrollLeft - (x - chainDragRef.current.startX);
                        }}
                      >
                        {childSteps.map((step, i) => {
                          const isExpanded = expandedChainCard === i;
                          return (
                            <React.Fragment key={i}>
                              {i > 0 && <span className="chainDash">&mdash;</span>}
                              <div
                                className={`chainChild${isExpanded ? ' chainChild--expanded' : ''}${step.type === 'video' ? ' chainChild--video' : ' chainChild--comment'}`}
                                onClick={() => setExpandedChainCard(isExpanded ? null : i)}
                              >
                                <div className="chainChildHeader">
                                  <AuthorBadge author={step.author} compact noLink />
                                  {step.type === 'video' && (
                                    step.shortPermlink ? (
                                      <Link to={`/shorts?v=${step.author}/${step.shortPermlink}`} className="chainActionBtn chainActionBtn--sm" onClick={(e) => e.stopPropagation()} title="Open short">
                                        <Camera size={11} />
                                      </Link>
                                    ) : (
                                      <Link to={`/watch?v=${step.author}/${step.permlink}`} className="chainActionBtn chainActionBtn--sm" onClick={(e) => e.stopPropagation()} title="Watch">
                                        <Video size={11} />
                                      </Link>
                                    )
                                  )}
                                </div>
                                <span className={`chainChildTitle${isExpanded ? ' chainChildTitle--full' : ''}`}>
                                  {step.title || (step.type === 'comment' ? 'Comment' : 'Reaction')}
                                </span>
                                {isExpanded && step.body && (
                                  <p className="chainChildText">{step.body}</p>
                                )}
                                {step.duration > 0 && (
                                  <span className="chainChildDuration">
                                    {Math.floor(step.duration / 60)}:{Math.floor(step.duration % 60).toString().padStart(2, '0')}
                                  </span>
                                )}
                              </div>
                            </React.Fragment>
                          );
                        })}
                        {childSteps.length > 0 && <span className="chainDash">&mdash;</span>}
                        {(() => {
                          const currentIdx = childSteps.length;
                          const isCurExpanded = expandedChainCard === currentIdx;
                          return (
                            <div
                              className={`chainChild chainChild--current${isCurExpanded ? ' chainChild--expanded' : ''}`}
                              onClick={() => setExpandedChainCard(isCurExpanded ? null : currentIdx)}
                            >
                              <div className="chainChildHeader">
                                <AuthorBadge author={currentVideo.author} compact noLink />
                              </div>
                              <span className={`chainChildTitle${isCurExpanded ? ' chainChildTitle--full' : ''}`}>
                                {currentVideo.caption || 'This video'}
                              </span>
                            </div>
                          );
                        })()}
                        {/* Child reactions (downstream from current short) */}
                        {currentVideo.childReactions?.map((child, ci) => (
                          <React.Fragment key={`child-${ci}`}>
                            <span className="chainDash">&mdash;</span>
                            <div className="chainChild chainChild--video chainChild--downstream">
                              <div className="chainChildHeader">
                                <AuthorBadge author={child.author} compact noLink />
                                <Link to={`/shorts?v=${child.shortAuthor || child.author}/${child.shortPermlink}`} className="chainActionBtn chainActionBtn--sm" onClick={(e) => e.stopPropagation()} title="Open short">
                                  <Camera size={11} />
                                </Link>
                              </div>
                              <span className="chainChildTitle">
                                {child.title || 'Remix'}
                              </span>
                              {child.duration > 0 && (
                                <span className="chainChildDuration">
                                  {Math.floor(child.duration / 60)}:{Math.floor(child.duration % 60).toString().padStart(2, '0')}
                                </span>
                              )}
                            </div>
                          </React.Fragment>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button className="chainToggleBtn" onClick={(e) => { e.stopPropagation(); setParentCardVisible(prev => { const next = !prev; localStorage.setItem('3speak-chain-visible', next ? '1' : '0'); return next; }); }}>
                  {!parentCardVisible && <span className="chainToggleLabel">show reaction chain</span>}
                  {parentCardVisible ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              </div>
            );
          })()}

          <div className="bottomOverlay">
            {/* Subtitle overlay — anchored above user badge, moves with bottomOverlay */}
            {subtitleCues.length > 0 && (
              <ShortsSubtitleOverlay timeRef={currentTimeRef} cues={subtitleCues} style={subtitleStyle} />
            )}
            {/* Reshare avatars — users who reshared (except ourselves) */}
            {reshareUsers.filter(r => r.username !== user).length > 0 && (
              <div className="reshareAvatars" onClick={(e) => e.stopPropagation()}>
                {reshareUsers
                  .filter(r => r.username !== user)
                  .slice(0, 5)
                  .map(r => (
                    <div
                      key={r.username}
                      className="reshareAvatarWrap"
                      title={`@${r.username}`}
                      onClick={(e) => { e.stopPropagation(); handleProfileNavigation(r.username); }}
                    >
                      <HiveAvatar
                        username={r.username}
                        size={null}
                        alt={r.username}
                        imgClassName="reshareAvatar"
                        badgeSize={9}
                      />
                      <Repeat2 size={14} className="reshareBadge" />
                    </div>
                  ))}
                {reshareUsers.filter(r => r.username !== user).length > 5 && (
                  <span className="reshareMore">+{reshareUsers.filter(r => r.username !== user).length - 5}</span>
                )}
              </div>
            )}
            <div className="userRow" onClick={(e) => e.stopPropagation()}>
              <AuthorBadge
                author={currentVideo.author}
                showFollow
                followersCount={currentVideo.user.followersCount}
                reputation={currentVideo.user.reputation}
                color="#fff"
              />
            </div>
            <div className={`caption${captionExpanded ? ' caption--expanded' : ''}`} onClick={(e) => { e.stopPropagation(); setCaptionExpanded(prev => !prev); }}>
              {!captionExpanded && !currentVideo.caption?.trim() && (
                <button
                  className={`captionReportBtn${currentVideo && isReported('short', `${currentVideo.author}/${currentVideo.permlink}`) ? ' reported' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setReportTarget({ type: 'short', author: currentVideo.author, permlink: currentVideo.permlink });
                    setIsReportOpen(true);
                  }}
                  title="Report"
                >
                  <MdFlag size={14} />
                </button>
              )}
              <p className="captionText">
                {renderCaption(translatedCaption || currentVideo.caption)}
                {!captionExpanded && currentVideo.mantecurated && (
                  <span className="shortsCuratedBadge shortsCuratedBadge--inline" title="Curated by Mantequilla" onClick={(e) => { e.stopPropagation(); navigate('/t/mantecurated'); }}>
                    <img src={mantequillaLogo} alt="" />
                    Curated
                  </span>
                )}
              </p>
              {/* Date + payout — the payout is info, not an action, so it reads better
                  here than as a button in the action rail. */}
              {((currentVideo.timeAgo && !currentVideo.timeAgo.includes('NaN')) || currentVideo.stats?.payout != null) && (
                <span className="captionDate">
                  {currentVideo.timeAgo && !currentVideo.timeAgo.includes('NaN') && currentVideo.timeAgo}
                  {currentVideo.stats?.payout != null && (
                    <span className="captionPayout">
                      <HiveIcon size={11} />
                      {formatPayout(currentVideo.stats.payout)}
                    </span>
                  )}
                </span>
              )}
              {captionExpanded && (
                <div className="captionActions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`captionReportBtn${currentVideo && isReported('short', `${currentVideo.author}/${currentVideo.permlink}`) ? ' reported' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setReportTarget({ type: 'short', author: currentVideo.author, permlink: currentVideo.permlink });
                      setIsReportOpen(true);
                    }}
                    title="Report"
                  >
                    <MdFlag size={14} />
                  </button>
                  {translatedCaption ? (
                    <button className="captionDismissTranslation" onClick={() => setTranslatedCaption(null)}>
                      <MdTranslate size={12} />
                      <span>Show original</span>
                    </button>
                  ) : (
                    <TranslateButton
                      compact
                      onTranslate={handleCaptionTranslate}
                      isTranslating={!!translating?.[currentVideo.permlink]}
                    />
                  )}
                  {currentVideo.mantecurated && (
                    <span className="shortsCuratedBadge" title="Curated by Mantequilla" onClick={(e) => { e.stopPropagation(); navigate('/t/mantecurated'); }}>
                      <img src={mantequillaLogo} alt="" />
                      Curated
                    </span>
                  )}
                </div>
              )}
              {captionExpanded && currentVideo.tags?.length > 0 && (
                <div className="captionTags">
                  {currentVideo.tags.map((tag, i) => (
                    <Link key={i} to={`/t/${tag}`} className="captionTag" onClick={(e) => e.stopPropagation()}>#{tag}</Link>
                  ))}
                </div>
              )}
              {!captionExpanded && currentVideo.caption?.length > 60 && (
                <span className="captionMore">more</span>
              )}
            </div>
            <div className="audioMarquee">
              <Music2 size={12} />
              <div className="audioText">
                <p>{currentVideo.audio}</p>
              </div>
            </div>
          </div>
        </div>

        {/* SIDEBAR */}
        <div className="actionSidebar" onClick={(e) => e.stopPropagation()}>
          <div className={`actionItem${user && currentVideo.author && user.toLowerCase() === currentVideo.author.toLowerCase() ? ' disabled' : ''}`} onClick={(e) => { e.stopPropagation(); if (user && currentVideo.author && user.toLowerCase() === currentVideo.author.toLowerCase()) return; if (currentVideo.hivePostMissing) { toast.error("Voting isn't available for this post"); return; } toggleVoteTooltip(currentVideo.author, currentVideo.hivePermlink); }}>
            <div className={`actionButton ${currentVideo.isLiked ? 'liked' : ''}`}>
              <Heart size={24} fill={currentVideo.isLiked ? '#ff2d55' : 'none'} />
            </div>
            <span className="actionLabel">{formatNumber(currentVideo.stats.likes)}</span>
            <CommentVoteTooltip
              voteKind="short"
              author={currentVideo.author}
              permlink={currentVideo.hivePermlink}
              showTooltip={showTooltip && activeTooltipPermlink === currentVideo.hivePermlink}
              setShowTooltip={setShowTooltip}
              setCommentList={setCommentList}
              setActiveTooltipPermlink={setActiveTooltipPermlink}
              weight={weight}
              setWeight={setWeight}
              voteValue={voteValue}
              setVoteValue={setVoteValue}
              accountData={accountData}
              setAccountData={setAccountData}
              onVoteSuccess={handlePostVoteSuccess}
              cachedDynamicProps={cachedDynamicPropsRef.current}
              onVoteDataRefresh={fetchVoteData}
              compact
              enableViewerTag
              postCreatedAt={currentVideo.createdAt || currentVideo.created}
            />
          </div>

          <div className="actionItem" onClick={(e) => { e.stopPropagation(); handleToggleComments(); }}>
            <div className={`actionButton ${showComments ? 'active' : ''}`}>
              <MessageSquare size={24} />
            </div>
            <span className="actionLabel">{currentVideo.stats.comments}</span>
          </div>

          <div className="actionItem" onClick={(e) => { e.stopPropagation(); handleReshare(); }}>
            <div className={`actionButton ${hasReshared ? 'reshared' : ''}`}>
              <Repeat2 size={24} />
            </div>
            <span className="actionLabel">{reshareCount || 0}</span>
          </div>

          {/* Watch Later — one tap adds/removes this short from the playlist. */}
          <div className="actionItem" onClick={(e) => { e.stopPropagation(); toggleWatchLater(); }}>
            <div className={`actionButton ${isInWatchLater ? 'saved' : ''}`}>
              <Bookmark size={24} fill={isInWatchLater ? 'currentColor' : 'none'} />
            </div>
            <span className="actionLabel">{isInWatchLater ? 'Saved' : 'Save'}</span>
          </div>

          <div className="actionItem" onClick={(e) => { e.stopPropagation(); setShareChooserOpen(true); }}>
            <div className="actionButton">
              <Share2 size={24} />
            </div>
            <span className="actionLabel">Share</span>
          </div>

          {FEATURE_EDITOR && authenticated && (() => {
            const vid = videos[currentIndex];
            return vid?.reusable === true ? (
              <div className="actionItem" onClick={(e) => { e.stopPropagation(); handleRemix('video'); }}>
                <div className="actionButton">
                  <WandSparkles size={24} />
                </div>
                <span className="actionLabel">Remix</span>
              </div>
            ) : null;
          })()}

          {/* Edit — own shorts only, and only when there's a Hive post to edit. */}
          {authenticated && user === currentVideo.author && !currentVideo.hivePostMissing && (
            <div className="actionItem" onClick={(e) => { e.stopPropagation(); try { playerRef.current?.pause?.(); } catch {} setIsEditShortOpen(true); }}>
              <div className="actionButton">
                <Pencil size={24} />
              </div>
              <span className="actionLabel">Edit</span>
            </div>
          )}

        </div>

        <ShareChooserModal
          open={shareChooserOpen}
          url={`${window.location.origin}/shorts?v=${currentVideo.author}/${currentVideo.permlink}`}
          title={currentVideo.title}
          onClose={() => setShareChooserOpen(false)}
          onGeneralShare={handleShare}
        />

        <EditVideoModal
          isOpen={isEditShortOpen}
          onClose={() => setIsEditShortOpen(false)}
          author={currentVideo.author}
          permlink={currentVideo.hivePermlink}
          isShort
          onSaved={() => setIsEditShortOpen(false)}
        />

      </div>

      {/* NAVIGATION — kept OUTSIDE .videoWrapper so its position:fixed anchors to
          the viewport. The wrapper gets a transform when comments open, which
          would otherwise become the containing block and mis-place the arrows. */}
      <div className="navigationArrows">
        <button className="navButton" onClick={handlePrevious} disabled={currentIndex === 0}>
          <ArrowUp size={24} />
        </button>
        <button className="navButton" onClick={handleNext} disabled={currentIndex === videos.length - 1 && !hasMore}>
          {loading && currentIndex === videos.length - 1 ? (
            <Loader2 size={24} className="spinner" />
          ) : (
            <ArrowDown size={24} />
          )}
        </button>
      </div>

      {/* Mobile Comments Overlay + Panel — portaled to body so it renders above nav */}
      {createPortal(
      <div className="short-main shorts-comments-portal">
      <div
        className={`commentsOverlay ${showComments ? 'visible' : ''}`}
        onClick={handleToggleComments}
      />

      {/* COMMENTS PANEL */}
      <div className={`commentsPanel ${showComments ? 'open' : ''}`} ref={commentsPanelRef}>
        {/* Mobile drag handle */}
        <div
          className="commentsPanelHandle"
          onTouchStart={handleCommentsDragStart}
          onTouchMove={handleCommentsDragMove}
          onTouchEnd={handleCommentsDragEnd}
        />

        <div className="commentsHeader">
          <span className="commentsTitle">Comments</span>
          <span className="commentsCount">{currentVideo.stats.comments}</span>
          <div className="commentsHeaderActions">
            <button className="headerBtn" onClick={handleToggleComments}>
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="commentsList">
          {commentsLoading ? (
            <div className="commentsLoading">
              <Loader2 className="spinner" size={24} />
              <span>Loading comments...</span>
            </div>
          ) : currentVideo.comments?.length === 0 ? (
            <div className="noComments">
              <p>No comments yet</p>
              <span>Be the first to comment!</span>
            </div>
          ) : (
            currentVideo.comments?.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                depth={0}
                formatNumber={formatNumber}
                toggleVoteTooltip={toggleVoteTooltip}
                showTooltip={showTooltip}
                activeTooltipPermlink={activeTooltipPermlink}
                setShowTooltip={setShowTooltip}
                setActiveTooltipPermlink={setActiveTooltipPermlink}
                setCommentList={setCommentList}
                weight={weight}
                setWeight={setWeight}
                voteValue={voteValue}
                setVoteValue={setVoteValue}
                accountData={accountData}
                setAccountData={setAccountData}
                cachedDynamicProps={cachedDynamicPropsRef.current}
                onVoteDataRefresh={fetchVoteData}
                activeReply={activeReply}
                setActiveReply={setActiveReply}
                replyText={replyText}
                setReplyText={setReplyText}
                handlePostComment={handlePostComment}
                postingComment={postingComment}
                user={user}
                renderedBodies={renderedBodies}
                onTranslate={onTranslate}
                getTranslation={getTranslation}
                clearTranslation={clearTranslation}
                translating={translating}
              />
            ))
          )}
        </div>

        {/* Comment Input */}
        <div className="commentInput">
          <div className="commentInputAvatar">
            <HiveAvatar username={user || 'guest'} size={null} alt="" badgeSize={11} />
          </div>
          <textarea
            ref={mainCommentRef}
            rows={1}
            placeholder={user ? "Add a comment..." : "Login to comment"}
            value={newComment}
            onChange={(e) => {
              setNewComment(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            disabled={!user || postingComment || currentVideo.hivePostMissing}
            // Enter always inserts a newline (multi-line comments); posting is
            // handled only by the Send button.
          />
          {user && !currentVideo.hivePostMissing && (
            <EmojiGifPicker
              align="right"
              openDirection="up"
              onPickEmoji={(em) => insertAtCursor(mainCommentRef.current, newComment, em, setNewComment)}
              onPickGif={(url) => insertAtCursor(mainCommentRef.current, newComment, gifMarkdown(url), setNewComment)}
            />
          )}
          <button
            className="sendCommentBtn"
            onClick={() => handlePostComment(currentVideo.author, currentVideo.hivePermlink, newComment, false)}
            disabled={!user || !newComment.trim() || postingComment || currentVideo.hivePostMissing}
          >
            {postingComment ? <Loader2 size={18} className="spinner" /> : <Send size={18} />}
          </button>
        </div>
      </div>
      </div>,
      document.body
      )}
      {/* Editor Modal */}
      <EditorModal
        isOpen={showEditorModal}
        onClose={() => setShowEditorModal(false)}
        videoUrl={editorVideoUrl}
        videoName={editorVideoName}
        videoType={editorVideoType}
        originalAuthor={editorOriginalAuthor}
        originalPermlink={editorOriginalPermlink}
        originalShortPermlink={editorOriginalShortPermlink}
      />

      {/* Mobile-only quick comment bar at the bottom (replaces the app nav bar
          on the shorts view). Hidden while the full comments panel is open, and
          OFF by default — enable it in Settings ("Comment bar on shorts"). */}
      {!showComments && shortsCommentBar && (
        <div className="shortsBottomComment">
          <textarea
            ref={bottomCommentRef}
            rows={1}
            placeholder={user ? 'Add a comment…' : 'Login to comment'}
            value={newComment}
            onChange={(e) => {
              setNewComment(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            disabled={!user || currentVideo.hivePostMissing}
          />
          {user && !currentVideo.hivePostMissing && (
            <EmojiGifPicker
              align="right"
              openDirection="up"
              onPickEmoji={(em) => insertAtCursor(bottomCommentRef.current, newComment, em, setNewComment)}
              onPickGif={(url) => insertAtCursor(bottomCommentRef.current, newComment, gifMarkdown(url), setNewComment)}
            />
          )}
          <button
            className="sendCommentBtn"
            onClick={() => handlePostComment(currentVideo.author, currentVideo.hivePermlink, newComment, false)}
            disabled={!user || !newComment.trim() || postingComment || currentVideo.hivePostMissing}
            aria-label="Send comment"
          >
            {postingComment ? <Loader2 size={18} className="spinner" /> : <Send size={18} />}
          </button>
        </div>
      )}
    </main>
  {isReportOpen && (
    <ReportModal
      isOpen={isReportOpen}
      onClose={() => setIsReportOpen(false)}
      type={reportTarget.type}
      target={{ author: reportTarget.author, permlink: reportTarget.permlink }}
    />
  )}
  </>
  );
};

/* ================= COMMENT ITEM COMPONENT ================= */
const CommentItem = ({
  comment,
  depth,
  formatNumber,
  toggleVoteTooltip,
  showTooltip,
  activeTooltipPermlink,
  setShowTooltip,
  setActiveTooltipPermlink,
  setCommentList,
  weight,
  setWeight,
  voteValue,
  setVoteValue,
  accountData,
  setAccountData,
  cachedDynamicProps,
  onVoteDataRefresh,
  activeReply,
  setActiveReply,
  replyText,
  setReplyText,
  handlePostComment,
  postingComment,
  user,
  renderedBodies,
  onTranslate,
  getTranslation,
  clearTranslation,
  translating,
}) => {
  const [showReplies, setShowReplies] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [translatedText, setTranslatedText] = useState(null);
  const [translateError, setTranslateError] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const replyInputRef = useRef(null);
  const maxDepth = 3;

  const handleTranslate = async (langCode) => {
    if (!comment?.body) return;
    setTranslateError(false);
    try {
      const result = await onTranslate?.(comment.permlink, comment.body, langCode);
      if (result) setTranslatedText(result);
    } catch { setTranslateError(true); }
  };

  const isReplying = activeReply === comment.permlink;

  // Use pre-rendered HTML if available, strip "replied to" metadata
  const getCommentHtml = () => {
    let html = renderedBodies?.[comment.permlink] || comment.body || '';
    return html
      .replace(/<p>\s*<sup>\s*replied to\s*<a[^>]*>.*?<\/a>\s*<\/sup>\s*<\/p>/gi, '')
      .replace(/<sup>\s*replied to\s*<a[^>]*>.*?<\/a>\s*<\/sup>/gi, '')
      .replace(/\n?<sup>replied to \[.*?\]\([^)]*\)<\/sup>/g, '');
  };

  if (comment.isLowReputation || comment.isHidden) return null;

  if (collapsed) {
    return (
      <div className="commentItem">
        <div className="comment-collapsed-bar" onClick={() => setCollapsed(false)}>
          <img className="comment-collapsed-avatar" src={comment.user?.avatar} alt="" />
          <span className="comment-collapsed-name">@{comment.user?.username}</span>
          <ChevronUp size={16} className="comment-collapsed-chevron" />
        </div>
      </div>
    );
  }

  const hasChildren = comment.children && comment.children.length > 0;

  return (
    <div className={`commentWrapper ${depth > 0 ? 'nested' : ''}`}>
      {/* Main comment row */}
      <div className="commentItem">
        <div className="commentAvatar">
          <img src={comment.user?.avatar} alt="" />
        </div>
        <div className="commentContent">
          <div className="commentMeta">
            <span className="commentUsername">{comment.user?.username}</span>
            <span className="commentTime">{comment.timeAgo}</span>
            <span className="comment-collapse-chevron" onClick={() => setCollapsed(true)}><ChevronUp size={16} /></span>
          </div>
          <div className="commentText markdown-view" dangerouslySetInnerHTML={{ __html: getCommentHtml() }} />
          {translatedText && (
            <div className="comment-translation">
              <div className="comment-translation-header">
                <MdTranslate size={12} />
                <span>Translation</span>
                <button className="comment-translation-dismiss" onClick={() => { setTranslatedText(null); clearTranslation?.(comment.permlink); }}>&times;</button>
              </div>
              <p>{translatedText}</p>
            </div>
          )}
          {translateError && <div className="comment-translation comment-translation--error"><p>Translation failed</p></div>}
          <div className="commentActions">
            <button
              className={`comment-report-btn${isReported('comment', `${comment.author}/${comment.permlink}`) ? ' reported' : ''}`}
              onClick={() => setIsReportOpen(true)}
              title="Report comment"
            >
              <MdFlag size={14} />
            </button>
            <TranslateButton onTranslate={handleTranslate} isTranslating={!!translating?.[comment.permlink]} compact />
            <button
              className={`commentActionBtn ${comment.has_voted ? 'liked' : ''}`}
              onClick={() => toggleVoteTooltip(comment.author, comment.permlink)}
            >
              <Heart size={14} fill={comment.has_voted ? '#ff2d55' : 'none'} />
              <span>{comment.stats?.num_likes ?? 0}</span>
            </button>
            <div className="commentReward">
              <GiTwoCoins size={14} />
              <span>${comment.stats?.total_hive_reward?.toFixed(2) ?? '0.00'}</span>
            </div>
            <button
              className="replyBtn"
              onClick={() => {
                setActiveReply(comment.permlink);
                setReplyText('');
              }}
            >
              Reply
            </button>
            <CommentVoteTooltip
              voteKind="comment"
              author={comment.author}
              permlink={comment.permlink}
              showTooltip={showTooltip && activeTooltipPermlink === comment.permlink}
              setShowTooltip={setShowTooltip}
              setCommentList={setCommentList}
              setActiveTooltipPermlink={setActiveTooltipPermlink}
              weight={weight}
              setWeight={setWeight}
              voteValue={voteValue}
              setVoteValue={setVoteValue}
              accountData={accountData}
              setAccountData={setAccountData}
              cachedDynamicProps={cachedDynamicProps}
              onVoteDataRefresh={onVoteDataRefresh}
              compact
            />
          </div>

          {/* Reply Input */}
          {isReplying && (
            <div className="replyInputWrapper">
              <input
                ref={replyInputRef}
                type="text"
                placeholder="Write a reply..."
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                disabled={postingComment}
                onKeyPress={(e) => {
                  if (e.key === 'Enter' && !postingComment) {
                    handlePostComment(comment.author, comment.permlink, replyText, true);
                  }
                }}
              />
              <div className="replyBottomRow">
                <EmojiGifPicker
                  align="left"
                  openDirection="up"
                  onPickEmoji={(em) => insertAtCursor(replyInputRef.current, replyText, em, setReplyText)}
                  onPickGif={(url) => insertAtCursor(replyInputRef.current, replyText, gifMarkdown(url), setReplyText)}
                />
                <div className="replyActions">
                  <button onClick={() => setActiveReply(null)}>Cancel</button>
                  <button
                    className="submitReply"
                    onClick={() => handlePostComment(comment.author, comment.permlink, replyText, true)}
                    disabled={!replyText.trim() || postingComment}
                  >
                    {postingComment ? <Loader2 size={14} className="spinner" /> : 'Reply'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Show replies toggle */}
          {hasChildren && (
            <button
              className="viewRepliesBtn"
              onClick={() => setShowReplies(!showReplies)}
            >
              {showReplies ? 'Hide' : 'View'} {comment.children.length} {comment.children.length === 1 ? 'reply' : 'replies'}
              <ArrowDown size={14} style={{ transform: showReplies ? 'rotate(180deg)' : 'none' }} />
            </button>
          )}
        </div>
      </div>

      {/* Nested replies — outside the flex row, with thread line */}
      {showReplies && hasChildren && depth < maxDepth && (
        <div className="commentThreadArea">
          <div className="nestedComments">
            {comment.children.map((child) => (
              <CommentItem
                key={child.id}
                comment={child}
                depth={depth + 1}
                formatNumber={formatNumber}
                toggleVoteTooltip={toggleVoteTooltip}
                showTooltip={showTooltip}
                activeTooltipPermlink={activeTooltipPermlink}
                setShowTooltip={setShowTooltip}
                setActiveTooltipPermlink={setActiveTooltipPermlink}
                setCommentList={setCommentList}
                weight={weight}
                setWeight={setWeight}
                voteValue={voteValue}
                setVoteValue={setVoteValue}
                accountData={accountData}
                setAccountData={setAccountData}
                cachedDynamicProps={cachedDynamicProps}
                onVoteDataRefresh={onVoteDataRefresh}
                activeReply={activeReply}
                setActiveReply={setActiveReply}
                replyText={replyText}
                setReplyText={setReplyText}
                handlePostComment={handlePostComment}
                postingComment={postingComment}
                user={user}
                renderedBodies={renderedBodies}
                onTranslate={onTranslate}
                getTranslation={getTranslation}
                clearTranslation={clearTranslation}
                translating={translating}
              />
            ))}
          </div>
        </div>
      )}
      {isReportOpen && (
        <ReportModal
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          type="comment"
          target={{ author: comment.author, permlink: comment.permlink }}
        />
      )}
    </div>
  );
};

export default VideoShort;