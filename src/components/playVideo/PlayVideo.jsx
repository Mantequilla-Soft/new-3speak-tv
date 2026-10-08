import PropTypes from "prop-types";
import { getHiveUrl } from '../../utils/hiveNode';
import "./PlayVideo.scss";
import VideoControls from "../VideoControls/VideoControls";
import ViewCount from "../ViewCount/ViewCount";
import { LuTimer } from "react-icons/lu";
import { MdReplay, MdPlayArrow } from "react-icons/md";
import UpvoteCount from "../UpvoteCount/UpvoteCount";
import PayoutAmount from "../PayoutAmount/PayoutAmount";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { fetchHiveProfile, fetchPlaySource } from "../../lib/videoData";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import BlogContent from "./BlogContent";
import CommentSection from "./CommentSection";
import LiveStreamPlayer from "./LiveStreamPlayer";
import VideoStats from "../CreatorStats/VideoStats";
import { fetchVideoHasStats } from "../../lib/creatorStats";
import ShareChooserModal from "../Chat/ShareChooserModal";
import { useAppStore } from '../../lib/store';
import { fetchIncubationLikes, voteIncubation } from '../../lib/incubation';
import { estimate, getUersContent, getVotePower } from "../../utils/hiveUtils";
import { getUserReputation } from "../../utils/reputation";
import ToolTip from "../tooltip/ToolTip";
import BeneficiariesTooltip from "../tooltip/BeneficiariesTooltip";
import { ImSpinner9 } from "react-icons/im";
import { useNavigate } from "react-router-dom";
import BarLoader from "../Loader/BarLoader";
import TipModal from "../../components/tip-reward/TipModal";
import { toastIn } from '../../utils/toast';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { getFollowers, getRelationshipBetweenAccounts } from "../../hive-api/api";
import CommentVoteTooltip from "../tooltip/CommentVoteTooltip";
import { prefetchVideoTagsV2 } from '../../utils/tagsV2';
import AiBadge from '../AiBadge/AiBadge';
import axios from "axios";
import { useTranslation, Trans } from "react-i18next";
import { formatTimeAgo } from "../../i18n";
import mantequillaLogo from "../../assets/mantequilla-logo.png";
import threespeakLogo from "../../assets/image/3S_logo.svg";
import threespeakLogoDark from "../../assets/image/3S_logodark.png";
import { HIVE_API_URL, CHECKER_URL, FEATURE_EDITOR } from '../../utils/config';
import { getViewerTags, getMyViewerTag } from '../../utils/viewerTag';
import { displayTag, saveInterestsToHive } from '../../utils/interests';
import { ALL_TOPIC_SLUGS } from '../../utils/tagsV2';

// Show the crowd topic consensus (viewer votes + auto/transcription tags, each
// with its % share) under the author tags. Set VITE_SHOW_TOPIC_TAGS=false to hide.
const SHOW_TOPIC_TAGS =
  String(import.meta.env.VITE_SHOW_TOPIC_TAGS).toLowerCase() !== 'false';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { isLoggedIn, followWithAioha } from "../../hive-api/aioha";
import { MdPlaylistAdd, MdWatchLater, MdKeyboardArrowDown, MdKeyboardArrowUp, MdAdd, MdClose, MdShare, MdAttachMoney, MdPersonAdd, MdInfo, MdBarChart } from "react-icons/md";
import { FaHeart, FaPlay, FaPause } from "react-icons/fa";
import { TbRewindBackward10, TbRewindForward10, TbPlayerTrackNextFilled } from "react-icons/tb";
import { IoPricetagOutline } from "react-icons/io5";
import AddToPlaylistModal from "../AddToPlaylistModal/AddToPlaylistModal";
import VideoPlaylists from "../VideoPlaylists/VideoPlaylists";
import PlaylistBar from "../PlaylistBar/PlaylistBar";
import { useMyPlaylists, isVideoInPlaylist } from "../../hooks/useMyPlaylists";
import { removeFromPlaylist } from "../../utils/playlistOperations";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import AuthorBadge from "../AuthorBadge/AuthorBadge";
import Button from "../Button/Button";
import { Repeat2, Scissors, Tornado, Film, Music, Rocket, Gift } from 'lucide-react';
import PromoteModal from '../Promote/PromoteModal';
import { recordReshare, getResharesForVideo } from '../../utils/reshares';
import EditorModal from '../modal/EditorModal';
import SubtitleOverlay from '../SubtitleOverlay/SubtitleOverlay';
import ReportModal, { isReported } from '../modal/ReportModal';
import EditVideoModal from './EditVideoModal';
import { MdFlag, MdEdit, MdAutoAwesome } from 'react-icons/md';
import useTitleMeta from '../../hooks/useTitleMeta';
import TitleTranslate from '../TitleTranslate/TitleTranslate';
import SummaryModal from '../SummaryModal/SummaryModal';
import AccountImg from '../HiveAvatar/AccountImg';

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

dayjs.extend(relativeTime);

const PlayVideo = ({ videoDetails, author, permlink, mediaUnavailable = false, mediaBlocked = false, onRetryPlayback = null, mediaLoading = false, playlistData, onClosePlaylist, videoControls, mobileReactionPanel, cinemaReactionPanel, videoRef, wrapperRef, onVideoEdited, overrideBody, scheduled = false, scheduledOn = null, onEditScheduled, v2 = false, isLive = false, streamRoom = null, liveChatSlot = null, onLiveChatSent = null, vodAssetPending = false, onStreamRoomMeta = null, belowPlayerSlot = null, sponsorLabel = null, adCountdown = null, bannerHit = null, tickerSlot = null, adSkip = null, adPlaying = false, adLocked = false }) => {
  const { t } = useTranslation();
  const { user, authenticated } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  // Actions that move value on Hive: promoting spends funds, tipping sends
  // them, and a clip/remix publishes a post that pays its original author
  // through beneficiaries. None can work without a Hive account.
  const viewerHasNoAccount = !!incubationHandle;
  // The POST itself is off-chain. Nobody can vote, tip or promote it — not even
  // a Hive user — because there is nothing on chain to act on. A different
  // situation from the viewer lacking an account, so it gets its own wording.
  const postIsOffChain = !!videoDetails?._incubation;
  const lockedForIncubation = viewerHasNoAccount || postIsOffChain;

  // VOTING is the exception to that lock. A vote on an off-chain post is stored
  // rather than broadcast — it moves no rewards and is never replayed — so it
  // works for everyone, including a Hive user, and including an incubating
  // viewer voting on anything. Only a signed-out visitor is refused.
  //
  // Deliberately NOT relabelled: it is the same gesture in the same place, and
  // a second word for it would make people wonder which one counted.
  const voteIsOffChain = postIsOffChain || viewerHasNoAccount;
  const [offChainVoted, setOffChainVoted] = useState(false);
  const [offChainVotes, setOffChainVotes] = useState(null);
  // Keyed on voteIsOffChain, NOT postIsOffChain. An incubating viewer's vote is
  // stored off-chain wherever it lands, including on an ordinary Hive video, so
  // loading the count only for off-chain POSTS meant their vote was saved and
  // then never shown: the count stayed null, the optimistic bump below leaves
  // null alone, and the label renders nothing for a falsy count. From the
  // viewer's side, voting did nothing at all.
  // `token` cancels a load whose video has since changed, so a slow response for
  // the previous post cannot land on this one.
  const loadOffChainLikes = useCallback((token) => {
    if (!voteIsOffChain || !author || !permlink) return undefined;
    return fetchIncubationLikes(author, permlink, user || incubationHandle)
      .then((d) => {
        if (token?.cancelled) return;
        setOffChainVotes(d.count ?? 0);
        setOffChainVoted(!!d.liked);
      })
      .catch(() => { /* the count is decoration; the button still works */ });
  }, [voteIsOffChain, author, permlink, user, incubationHandle]);

  useEffect(() => {
    const token = { cancelled: false };
    loadOffChainLikes(token);
    return () => { token.cancelled = true; };
  }, [loadOffChainLikes]);

  const handleOffChainVote = useCallback(async () => {
    if (!authenticated) return;
    const next = !offChainVoted;
    // Optimistic: the write is a single row and the failure path puts it back.
    setOffChainVoted(next);
    setOffChainVotes((n) => (n == null ? n : Math.max(0, n + (next ? 1 : -1))));
    try {
      await voteIncubation(author, permlink, next ? 10000 : 0);
      // Re-read rather than trust the guess: the optimistic bump cannot move a
      // count that was still unknown, and other people vote on this too.
      loadOffChainLikes();
    } catch (err) {
      setOffChainVoted(!next);
      setOffChainVotes((n) => (n == null ? n : Math.max(0, n + (next ? -1 : 1))));
      toast.error(err.message || t('watch.vote.saveFailed'));
    }
  }, [authenticated, offChainVoted, author, permlink, loadOffChainLikes]);
  // The viewer's own reason wins when both apply: it is the one they can act on.
  const LOCKED_TITLE = viewerHasNoAccount
    ? t('watch.locked.noAccount')
    : t('watch.locked.offChainPost');

  // Spread LAST onto a locked button so it overrides that button's own title
  // and onClick.
  //
  // aria-disabled rather than `disabled`: a disabled button fires no mouse
  // events in Chrome or Firefox, so its title tooltip never appears — and the
  // tooltip explaining WHY it is locked is the whole point. This keeps the
  // element interactive enough to be hovered while refusing the action, and
  // a click says the same thing for anyone on a touch screen with no hover.
  const lockProps = lockedForIncubation
    ? {
        'aria-disabled': true,
        title: LOCKED_TITLE,
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          toast.info(LOCKED_TITLE);
        },
      }
    : {};
  const interests = useAppStore((s) => s.interests);
  const setInterests = useAppStore((s) => s.setInterests);
  const theme = useAppStore((s) => s.theme);
  const isDarkTheme = theme !== 'light'; // dark is the default (matches EmergencyScreen)

  // Add a topic to the user's interests (from the topic popup), persisting to Hive.
  const addToInterests = useCallback(async (tag) => {
    if (!user) { toast.error(t('watch.interests.loginRequired')); return; }
    if (!ALL_TOPIC_SLUGS.includes(tag)) return;
    const cur = useAppStore.getState().interests || [];
    if (cur.includes(tag)) return;
    const next = [...cur, tag];
    setInterests(next); // optimistic
    try {
      const saved = await saveInterestsToHive(user, next);
      setInterests(saved);
      toast.success(t('watch.interests.added', { tag: displayTag(tag) }));
    } catch (e) {
      setInterests(cur); // revert on failure
      toast.error(e?.message || t('watch.interests.saveFailed'));
    }
  }, [user, setInterests]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const lastTouchRef = useRef(0); // prevent touch+mouse double-fire
  // Our own handle on the <video>. Watch passes `videoRef` as a CALLBACK ref (the
  // player attaches through it), so there is no `.current` to read; this ref
  // forwards the element to that callback and keeps it for the hold-to-speed-up
  // and frame-rate code here. Stable, so the player is never re-attached.
  const [videoNode, setVideoNode] = useState(null);
  const attachVideo = useCallback((el) => {
    setVideoNode(el);
    if (typeof videoRef === 'function') videoRef(el);
    else if (videoRef) videoRef.current = el;
  }, [videoRef]);
  // Press-and-hold on the video plays it fast (2x) for as long as it is held, the
  // way YouTube does; sliding left / right while holding picks another temporary
  // speed, and letting go puts the viewer's own speed back. The tap action
  // (play/pause, or show the controls on a phone) therefore runs on RELEASE, and
  // only when the hold didn't fire.
  const LONG_PRESS_MS = 500;
  // From one frame a second up to 10x. Browsers play that fast, but most go silent
  // somewhere above 4x and the stream has to arrive that much faster too, so the
  // top end is for skimming. The bottom end, FRAME_STEP, is below what any browser
  // will set as a playback rate (~0.06x), so it is done by hand: paused, one frame
  // forward every second.
  const FRAME_STEP = 'frame';
  const HOLD_SPEEDS = [FRAME_STEP, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10];
  const HOLD_START_INDEX = HOLD_SPEEDS.indexOf(2);
  const HOLD_STEP_PX = 32;   // slide this far for the next speed
  const PRESS_SLOP_PX = 12;  // moving more than this before the hold fires = not a hold
  const pressTimerRef = useRef(null);
  const pressFiredRef = useRef(false);
  const pressStartXRef = useRef(0);
  // The running hold: { base, wasPaused, startX, index, end } or null.
  const holdRef = useRef(null);
  // The speed badge on the video: { rate, holding } while held, then briefly the
  // restored speed as it fades out.
  const [speedBadge, setSpeedBadge] = useState(null);
  const speedBadgeTimerRef = useRef(null);
  // A one-second icon in the middle of the video confirming what a key, click or
  // tap on the video just did. `n` restarts the animation on a repeat press.
  const [actionFlash, setActionFlash] = useState(null);
  const flashTimerRef = useRef(null);
  const flashAction = (kind) => {
    clearTimeout(flashTimerRef.current);
    setActionFlash((f) => ({ kind, n: (f?.n || 0) + 1 }));
    flashTimerRef.current = setTimeout(() => setActionFlash(null), 1000);
  };
  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  // Mobile collapsible details
  const [mobileDetailsExpanded, setMobileDetailsExpanded] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const titleMeta = useTitleMeta(author, permlink);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [videoStatsOpen, setVideoStatsOpen] = useState(false);
  const [videoHasStats, setVideoHasStats] = useState(false);
  // Watch-page stats show to the video's owner and to admins (tibfox/badadib)...
  const STATS_ADMINS = ['tibfox', 'badadib'];
  const isStatsViewer = authenticated && !scheduled && !!author && !!permlink &&
    (user?.toLowerCase() === author?.toLowerCase() || STATS_ADMINS.includes(user?.toLowerCase()));
  // ...but only once we've confirmed the video actually has watch records.
  const canSeeVideoStats = isStatsViewer && videoHasStats;

  // Long press on the video. Not while an ad plays: the controls are down for the
  // spot, the advertiser's seconds are not ours to fast-forward, and a hold then
  // is just a slow tap.
  const videoEl = () => videoNode;

  const endHold = () => {
    const h = holdRef.current;
    if (!h) return;
    holdRef.current = null;
    h.end();
    h.stopFrames();
    const vc = controlsRef.current;
    vc?.onPlaybackRateChange?.(h.base);
    // It was paused before the hold played it: pause it again.
    if (h.wasPaused && videoEl() && !videoEl().paused) vc?.onTogglePlay?.();
    clearTimeout(speedBadgeTimerRef.current);
    setSpeedBadge({ rate: h.base, holding: false });
    speedBadgeTimerRef.current = setTimeout(() => setSpeedBadge(null), 700);
  };

  const beginHold = () => {
    const vc = controlsRef.current;
    if (!vc?.onPlaybackRateChange) return;
    const el = videoEl();
    const base = el?.playbackRate || vc.playbackRate || 1;
    const wasPaused = el ? el.paused : !vc.isPlaying;
    if (wasPaused) vc.onTogglePlay?.();
    let frameTimer = null;
    const stopFrames = () => {
      if (!frameTimer) return;
      clearInterval(frameTimer);
      frameTimer = null;
      videoEl()?.play?.()?.catch?.(() => {});
    };
    const setRate = (index) => {
      const rate = HOLD_SPEEDS[index];
      const v = videoEl();
      if (rate === FRAME_STEP) {
        if (!frameTimer && v) {
          v.pause();
          frameTimer = setInterval(() => {
            const el = videoEl();
            if (el && Number.isFinite(el.duration)) el.currentTime = Math.min(el.duration, el.currentTime + frameSecRef.current);
          }, 1000);
        }
      } else {
        stopFrames();
        // A browser that will not play this fast (or slow) throws; stay at the last speed.
        try { controlsRef.current?.onPlaybackRateChange?.(rate); } catch { /* unsupported rate */ }
      }
      clearTimeout(speedBadgeTimerRef.current);
      setSpeedBadge({ rate, holding: true });
    };
    // Tracked on the window, not the video: the pointer may slide off the frame,
    // and letting go anywhere must still end the hold.
    const onMove = (e) => {
      const h = holdRef.current;
      if (!h) return;
      const x = e.touches ? e.touches[0]?.clientX : e.clientX;
      if (x == null) return;
      const index = Math.max(0, Math.min(HOLD_SPEEDS.length - 1,
        HOLD_START_INDEX + Math.round((x - h.startX) / HOLD_STEP_PX)));
      if (index !== h.index) { h.index = index; setRate(index); }
    };
    const onEnd = () => endHold();
    const onHidden = () => { if (document.hidden) endHold(); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);
    window.addEventListener('blur', onEnd);
    document.addEventListener('visibilitychange', onHidden);
    holdRef.current = {
      base,
      wasPaused,
      startX: pressStartXRef.current,
      index: HOLD_START_INDEX,
      stopFrames,
      end: () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
        window.removeEventListener('blur', onEnd);
        document.removeEventListener('visibilitychange', onHidden);
      },
    };
    setRate(HOLD_START_INDEX);
  };

  const startPress = (clientX) => {
    pressFiredRef.current = false;
    pressStartXRef.current = clientX;
    clearTimeout(pressTimerRef.current);
    if (adPlaying || !videoControls?.onPlaybackRateChange) return;
    pressTimerRef.current = setTimeout(() => {
      pressTimerRef.current = null;
      pressFiredRef.current = true;
      try { navigator.vibrate?.(15); } catch { /* not supported */ }
      beginHold();
    }, LONG_PRESS_MS);
  };
  // Moving before the hold fires means a swipe or a drag, not a hold.
  const pressMoved = (clientX) => {
    if (pressTimerRef.current && Math.abs(clientX - pressStartXRef.current) > PRESS_SLOP_PX) cancelPress();
  };
  // True when the press was a plain tap, so the caller runs the tap action.
  const endPress = () => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
    return !pressFiredRef.current;
  };
  const cancelPress = () => {
    clearTimeout(pressTimerRef.current);
    pressTimerRef.current = null;
  };
  // Leaving the page mid-hold must not leave the video stuck fast.
  useEffect(() => () => {
    clearTimeout(pressTimerRef.current);
    clearTimeout(speedBadgeTimerRef.current);
    if (holdRef.current) { holdRef.current.end(); holdRef.current.stopFrames(); holdRef.current = null; }
  }, []);

  // Keyboard, YouTube style: ← / → skip (the same 10s and the same ad lock as the
  // on-screen buttons), space plays/pauses, "," / "." step one frame back /
  // forward (pausing first, as stepping only makes sense on a still frame).
  // Never while typing, and never with a modifier held, so browser and OS
  // shortcuts keep working.
  const controlsRef = useRef(videoControls);
  controlsRef.current = videoControls;
  const flashActionRef = useRef(flashAction);
  flashActionRef.current = flashAction;
  const adLockedRef = useRef(adLocked);
  adLockedRef.current = adLocked || adPlaying;
  // Frame length, measured from the decoder while the video plays (the smallest
  // gap between two presented frames: a dropped frame only makes a gap larger).
  const frameSecRef = useRef(1 / 30);
  // Where the last frame step went. Steps arrive faster than the player reports
  // the new time, so the next one starts from here rather than from a stale clock.
  const stepRef = useRef({ to: 0, at: 0 });
  useEffect(() => {
    const el = videoNode;
    if (!el || typeof el.requestVideoFrameCallback !== 'function') return undefined;
    let last = null; let id = 0; let best = Infinity;
    const onFrame = (_now, meta) => {
      if (last != null && !el.paused && el.playbackRate === 1) {
        const d = meta.mediaTime - last;
        if (d > 1 / 121 && d < 1 / 9 && d < best) { best = d; frameSecRef.current = d; }
      }
      last = meta.mediaTime;
      id = el.requestVideoFrameCallback(onFrame);
    };
    id = el.requestVideoFrameCallback(onFrame);
    return () => el.cancelVideoFrameCallback?.(id);
  }, [videoNode, permlink]);

  useEffect(() => {
    if (isLive) return undefined;
    const onKey = (e) => {
      const vc = controlsRef.current;
      if (!vc || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      const tgt = e.target;
      const tag = tgt?.tagName;
      if (tgt?.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // A dialog the key was pressed in, or a modal that's open, owns the
      // keyboard. Not any [role=dialog] on the page: the cookie banner is one,
      // and it would switch the shortcuts off for every new visitor.
      if (tgt?.closest?.('[role="dialog"], [aria-modal="true"]')) return;
      const modal = document.querySelector('[aria-modal="true"]');
      if (modal && modal.getClientRects().length) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          flashActionRef.current('back');
          vc.onSeekBackward?.();
          break;
        case 'ArrowRight':
          e.preventDefault();
          // Refused while an ad break holds the playhead; don't claim a skip.
          if (!adLockedRef.current) flashActionRef.current('forward');
          vc.onSeekForward?.();
          break;
        case ' ':
        case 'Spacebar': {
          // A focused button or link already acts on space; don't toggle twice.
          if (tag === 'BUTTON' || tag === 'A' || tgt?.getAttribute?.('role') === 'button') return;
          e.preventDefault(); // and don't scroll the page
          flashActionRef.current(vc.isPlaying ? 'pause' : 'play');
          vc.onTogglePlay?.();
          break;
        }
        case ',':
        case '.': {
          e.preventDefault();
          if (vc.isPlaying) vc.onTogglePlay?.();
          const now = Date.now();
          const from = now - stepRef.current.at < 1000 ? stepRef.current.to : (vc.currentTime || 0);
          const end = vc.duration || Infinity;
          const to = Math.min(end, Math.max(0, from + (e.key === '.' ? 1 : -1) * frameSecRef.current));
          stepRef.current = { to, at: now };
          vc.onSeek?.(to);
          break;
        }
        default:
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isLive]);

  // A timestamp clicked in the description or a comment. The reader is usually
  // scrolled down past the player by then, so bring it back into view, and
  // start it if it was paused: clicking "4:12" means "show me 4:12".
  const seekFromText = (tSec) => {
    if (!videoControls?.onSeek) return;
    videoControls.onSeek(tSec);
    const el = wrapperRef && typeof wrapperRef === 'object' ? wrapperRef.current : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (videoControls.isPlaying === false) videoControls.onTogglePlay?.();
  };

  useEffect(() => {
    setVideoHasStats(false);
    setVideoStatsOpen(false);
    if (!isStatsViewer) return;
    let cancelled = false;
    fetchVideoHasStats(author, permlink)
      .then((d) => { if (!cancelled) setVideoHasStats(!!d?.hasData); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isStatsViewer, author, permlink]);

  // State
  const [openTooltip, setOpenToolTip] = useState(false);
  const [pinnedTooltip, setPinnedTooltip] = useState(false);
  const [tooltipVoters, setTooltipVoters] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [payoutInfo, setPayoutInfo] = useState(null);
  const [showBeneficiaries, setShowBeneficiaries] = useState(false);
  const [pinnedBeneficiaries, setPinnedBeneficiaries] = useState(false);
  const voteCountRef = useRef(null);
  const payoutRef = useRef(null);
  const [isTipModalOpen, setIsTipModalOpen] = useState(false);
  const [tipNudgeVisible, setTipNudgeVisible] = useState(false);
  const tipNudgeShownRef = useRef(false);
  const [isVoted, setIsVoted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [followData, setFollowData] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [optimisticVoteCount, setOptimisticVoteCount] = useState(0);
  const [accountData, setAccountData] = useState(null);
  const [voteValue, setVoteValue] = useState(0.0);
  const [weight, setWeight] = useState(100);
  const [view, setView] = useState(0);
  const [isPlaylistModalOpen, setIsPlaylistModalOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [isRemovingWatchLater, setIsRemovingWatchLater] = useState(false);
  const [communityData, setCommunityData] = useState(null);
  const [authorReputation, setAuthorReputation] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);
  const [shareChooserOpen, setShareChooserOpen] = useState(false);
  const [isFollowingCreator, setIsFollowingCreator] = useState(null);
  const [followLoading, setFollowLoading] = useState(false);

  // Reshare state
  const [reshareCount, setReshareCount] = useState(0);
  const [hasReshared, setHasReshared] = useState(false);

  // Remix/clip eligibility (embed videos only, except meno)
  const [canRemixClip, setCanRemixClip] = useState(false);

  // Editor modal state
  const [showEditorModal, setShowEditorModal] = useState(false);
  const [editorVideoUrl, setEditorVideoUrl] = useState(null);
  const [editorVideoName, setEditorVideoName] = useState(null);
  const [editorClipStart, setEditorClipStart] = useState(null);
  const [editorClipEnd, setEditorClipEnd] = useState(null);
  const [editorVideoType, setEditorVideoType] = useState('video');
  const [remixDropdownOpen, setRemixDropdownOpen] = useState(false);
  const remixDropdownRef = useRef(null);

  // Clip mode state
  const [clipMode, setClipMode] = useState(false); // false | 'start' | 'end' | 'done'
  const [clipStart, setClipStart] = useState(null);
  const [clipEnd, setClipEnd] = useState(null);

  // Notify parent when clip mode changes (disables autoplay)
  useEffect(() => {
    if (videoControls?.onClipModeChange) {
      videoControls.onClipModeChange(!!clipMode);
    }
  }, [clipMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tip nudge at 90% playtime (only for logged-in viewers watching someone else's video)
  useEffect(() => {
    const duration = videoControls?.duration;
    const currentTime = videoControls?.currentTime;
    if (!duration || duration < 10 || tipNudgeShownRef.current) return;
    if (!authenticated || !isLoggedIn() || user === author) return;
    const triggerAt = duration * 0.9;
    if (currentTime >= triggerAt) {
      setTipNudgeVisible(true);
      tipNudgeShownRef.current = true;
    }
  }, [videoControls?.currentTime, videoControls?.duration, authenticated, user, author]);

  // Reset nudge state when video changes
  useEffect(() => {
    tipNudgeShownRef.current = false;
    setTipNudgeVisible(false);
  }, [author, permlink]);

  // Warm the v2-tag lookup while the page loads, so the vote dialog already knows
  // which tag picker to draw when it opens (otherwise the wrong one flashes).
  useEffect(() => {
    prefetchVideoTagsV2(author, permlink);
  }, [author, permlink]);

  // Report popup open state to parent (blocks autoplay)
  useEffect(() => {
    const isVotePopupOpen = showTooltip && authenticated && isLoggedIn();
    videoControls?.onPopupOpen?.(tipNudgeVisible || isTipModalOpen || isVotePopupOpen);
  }, [tipNudgeVisible, isTipModalOpen, showTooltip, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Watch Later detection
  const { data: myPlaylists = [], refetch: refetchPlaylists } = useMyPlaylists({ enabled: !!user });
  const watchLaterPlaylist = useMemo(() => myPlaylists.find(p => p.name === 'Watch Later'), [myPlaylists]);
  const isInWatchLater = useMemo(() => watchLaterPlaylist ? isVideoInPlaylist(watchLaterPlaylist, author, permlink) : false, [watchLaterPlaylist, author, permlink]);

  const handleRemoveFromWatchLater = useCallback(async () => {
    if (!watchLaterPlaylist || isRemovingWatchLater) return;
    setIsRemovingWatchLater(true);
    try {
      await removeFromPlaylist(watchLaterPlaylist.id, author, permlink);
      toast.success(t('watch.watchLater.removed'));
      setTimeout(() => {
        refetchPlaylists();
        queryClient.invalidateQueries({ queryKey: ['myPlaylists'] });
        queryClient.invalidateQueries({ queryKey: ['userPlaylists'] });
      }, 2000);
    } catch (error) {
      toast.error(t('watch.watchLater.removeFailed', { error: error.message }));
    } finally {
      setIsRemovingWatchLater(false);
    }
  }, [watchLaterPlaylist, author, permlink, isRemovingWatchLater, refetchPlaylists, queryClient]);

  // Memoized format function
  const formatRelativeTime = useCallback((date) => formatTimeAgo(dayjs(date).toDate(), { style: 'narrow' }), []);

  // Uploader profile — from Hive (lib/videoData), not the retired union API.
  const profileName = videoDetails?.author?.username || videoDetails?.author?.id || author;
  const { data: profile } = useQuery({
    queryKey: ['hive-profile', profileName],
    queryFn: () => fetchHiveProfile(profileName),
    enabled: !!profileName && profileName !== 'unknown',
    staleTime: 5 * 60 * 1000,
  });

  // HLS source — resolved from play.3speak.tv by author/permlink (only used by
  // the clip/remix editor; the main player resolves its own source).
  const { data: playSource } = useQuery({
    queryKey: ['play-source', author, permlink],
    queryFn: () => fetchPlaySource(author, permlink),
    enabled: !!author && !!permlink,
    staleTime: 5 * 60 * 1000,
  });
  const spkvideo = playSource || videoDetails?.spkvideo;
  
  // Fetch extended video details (mantecurated etc.) from checker API
  const [extendedDetails, setExtendedDetails] = useState({});
  useEffect(() => {
    if (!author || !permlink) return;
    const url = `${import.meta.env.VITE_CHECKER_URL}/videodetails/${author}/${permlink}`;
    fetch(url).then(r => r.json()).then(setExtendedDetails).catch(() => {});
  }, [author, permlink]);

  // ── Topic consensus: viewer votes + auto/transcription tags, each with its %.
  // Shown under the author tags. Set VITE_SHOW_TOPIC_TAGS=false to hide.
  // `topicRefreshKey` lets a successful vote-with-tag re-pull the fresh shares.
  const [topicTags, setTopicTags] = useState(null);
  const [topicRefreshKey, setTopicRefreshKey] = useState(0);
  useEffect(() => {
    if (!SHOW_TOPIC_TAGS || !author || !permlink) return undefined;
    let alive = true;
    getViewerTags(author, permlink)
      .then((d) => { if (alive) setTopicTags(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [author, permlink, topicRefreshKey]);
  const refreshTopicTags = useCallback(() => setTopicRefreshKey((k) => k + 1), []);

  // Topic-chip voters tooltip: hover previews it, click pins it (like the vote
  // counter). Each holds { tag, el } where el is the hovered/clicked chip.
  const [tagTipHover, setTagTipHover] = useState(null);
  const [tagTipPinned, setTagTipPinned] = useState(null);
  const activeTagTip = tagTipPinned || tagTipHover;

  // After the 7-day payout window the vote does nothing — the button becomes a
  // "Tag" button (the popup itself switches to tag-only, see CommentVoteTooltip).
  const votingClosed = useMemo(() => {
    const c = videoDetails?.created || videoDetails?.created_at;
    return !!c && (Date.now() - new Date(c).getTime()) > 7 * 24 * 60 * 60 * 1000;
  }, [videoDetails?.created, videoDetails?.created_at]);

  // Once voting is closed, the CTA becomes a one-shot "Tag" button — hide it
  // entirely if this user has already tagged the video. Re-checks after a tag
  // (topicRefreshKey bumps on success).
  const [alreadyTagged, setAlreadyTagged] = useState(false);
  useEffect(() => {
    if (!votingClosed || !authenticated || !user || !author || !permlink) { setAlreadyTagged(false); return undefined; }
    let alive = true;
    getMyViewerTag(user, author, permlink).then((r) => { if (alive) setAlreadyTagged(!!r?.tagged); });
    return () => { alive = false; };
  }, [votingClosed, authenticated, user, author, permlink, topicRefreshKey]);

  // Memoized values. Clean up author tags: split any comma-joined values,
  // strip a leading '#', trim, drop empties + dupes — so both the chip label
  // and the /t/:tag link use the bare tag.
  const tags = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const raw of (videoDetails?.tags || [])) {
      for (const part of String(raw).split(',')) {
        const tag = part.trim().replace(/^#+/, '').trim();
        if (tag && !seen.has(tag)) { seen.add(tag); out.push(tag); }
      }
    }
    return out.slice(0, 7);
  }, [videoDetails?.tags]);
  const comunity_name = useMemo(
    () => communityData?.title || videoDetails?.community?.title,
    [communityData?.title, videoDetails?.community?.title]
  );
  const community_id = useMemo(() => {
    const raw = videoDetails?.community?._id;
    return raw ? raw.split('/').pop() : null;
  }, [videoDetails?.community?._id]);

  // Memoized video URL
  const videoUrlSelected = useMemo(() => {
    if (!spkvideo?.play_url) return null;
    
    const url = spkvideo.play_url;
    if (url.startsWith("ipfs://")) {
      const ipfsHash = url.replace("ipfs://", "");
      return `https://hotipfs-3speak-1.b-cdn.net/ipfs/${ipfsHash}`;
    }
    return url;
  }, [spkvideo?.play_url]);

  // Memoized callbacks to prevent recreating functions
  const calculateVoteValue = useCallback(async (account, percent) => {
    try {
      const data = await estimate(account, percent);
      setVoteValue(data);
    } catch (err) {
      console.error(err);
    }
  }, []);

  const getTooltipVoters = useCallback(async () => {
    try {
      const data = await getUersContent(author, permlink);
      if (!data) return;

      // Batch state updates to prevent multiple re-renders
      const updates = {};

      if (data.active_votes) {
        updates.optimisticVoteCount = data.active_votes.length;
        updates.isVoted = data.active_votes.some(vote => vote.voter === user);

        const totalRshares = data.active_votes.reduce(
          (sum, vote) => sum + parseInt(vote.rshares),
          0
        );

        const totalPayout =
          parseFloat(data.pending_payout_value) > 0
            ? parseFloat(data.pending_payout_value)
            : parseFloat(data.total_payout_value) + parseFloat(data.curator_payout_value);

        // Keep ALL voters (sorted by weight). The tooltip shows the top 10 on
        // hover and the full list when pinned (click).
        const topVotes = data.active_votes
          .sort((a, b) => parseInt(b.rshares) - parseInt(a.rshares))
          .map(vote => {
            const reward =
              totalRshares > 0
                ? (parseInt(vote.rshares) / totalRshares) * totalPayout
                : 0;
            return {
              username: vote.voter,
              reward: +reward.toFixed(3),
            };
          });

        updates.tooltipVoters = topVotes;
      }

      // Extract beneficiaries and payout breakdown
      const isPaidOut = parseFloat(data.pending_payout_value) === 0 && parseFloat(data.total_payout_value) > 0;
      if (data.beneficiaries?.length) {
        setBeneficiaries(
          data.beneficiaries
            .map(b => ({ account: b.account, weight: b.weight / 100 }))
            .sort((a, b) => b.weight - a.weight)
        );
      } else {
        setBeneficiaries([]);
      }
      if (isPaidOut) {
        const curatorPayout = parseFloat(data.curator_payout_value);
        const authorPayout = parseFloat(data.total_payout_value);
        setPayoutInfo({ isPaidOut: true, curatorPayout, authorPayout, totalPayout: curatorPayout + authorPayout });
      } else {
        setPayoutInfo({ isPaidOut: false, pendingPayout: parseFloat(data.pending_payout_value) });
      }

      // Single state update
      setOptimisticVoteCount(updates.optimisticVoteCount || 0);
      setIsVoted(updates.isVoted || false);
      setTooltipVoters(updates.tooltipVoters || []);

      // Determine remix/clip eligibility from MongoDB via checker
      try {
        const reusableRes = await axios.get(`${CHECKER_URL}/api/video/${author}/${permlink}`);
        setCanRemixClip(reusableRes.data?.success && !!reusableRes.data.reusable);
      } catch {
        setCanRemixClip(false);
      }
    } catch (error) {
      console.error("Error fetching upvotes:", error);
    }
  }, [author, permlink, user]);

  const speakWatchData = useCallback(async () => {
    // The legacy `/apiv2/@author/permlink` call that used to lead this function is
    // gone: the endpoint is retired (it answers 401) and the only thing it fed —
    // `speakData` — was never read anywhere. So every watch page was paying for a
    // request that could only fail, to populate state nothing consumes.
    //
    // View count from the checker /views — the same source the cards use
    // (the legacy apiv2 endpoint is gone, which is why this read as 0 before).
    try {
      const vres = await axios.post(
        `${CHECKER_URL}/views`,
        { videos: [{ author, permlink }] },
        { timeout: 15000 },
      );
      const count = vres.data?.data?.[`${author}/${permlink}`];
      if (typeof count === 'number') setView(count);
    } catch (err) {
      console.error('Error fetching view count:', err.message);
    }
  }, [author, permlink]);

  const getFollowersCount = useCallback(async (authorName) => {
    try {
      const follower = await getFollowers(authorName);
      setFollowData(follower);
    } catch (err) {
      console.error(err);
    }
  }, []);


  // Effect: Fetch account data (only once when user changes)
  useEffect(() => {
    if (!user) return;
    
    const fetchAccountData = async () => {
      try {
        const result = await getVotePower(user);
        if (result?.account) {
          setAccountData(result.account);
          await calculateVoteValue(result.account, weight);
        }
      } catch (err) {
        console.error('Error fetching account:', err);
      }
    };
    
    fetchAccountData();
  }, [user, calculateVoteValue, weight]);

  // Effect: Fetch speak data, followers, reputation, and follow status (only when author/permlink changes)
  useEffect(() => {
    if (!author || !permlink) return;

    speakWatchData();
    getFollowersCount(author);
    getUserReputation(author).then(rep => setAuthorReputation(rep)).catch(() => {});

    // Check follow relationship for FAB button
    if (user && author !== user) {
      setIsFollowingCreator(null);
      getRelationshipBetweenAccounts(user, author).then((relation) => {
        if (relation?.follows != null) setIsFollowingCreator(relation.follows);
      }).catch(() => {});
    }
  }, [author, permlink, speakWatchData, getFollowersCount, user]);

  // Effect: Get tooltip voters (only when author/permlink/user changes)
  useEffect(() => {
    if (!author || !permlink) return;
    getTooltipVoters();
  }, [author, permlink, getTooltipVoters]);

  // Effect: Fetch community data (subscribers count)
  useEffect(() => {
    if (!community_id) {
      setCommunityData(null);
      return;
    }
    const fetchCommunity = async () => {
      try {
        const response = await axios.post(getHiveUrl(), {
          jsonrpc: '2.0',
          method: 'bridge.get_community',
          params: { name: community_id },
          id: 1,
        });
        const data = response.data?.result;
        if (data) {
          setCommunityData({ subscribers: data.subscribers, title: data.title });
        }
      } catch (err) {
        console.error('Error fetching community data:', err);
      }
    };
    fetchCommunity();
  }, [community_id]);

  // Effect: Recalculate vote value when weight changes
  useEffect(() => {
    if (!accountData) return;
    calculateVoteValue(accountData, weight);
  }, [weight, accountData, calculateVoteValue]);

  // Memoized handlers
  const handleSelectTag = useCallback((tag) => {
    navigate(`/t/${tag}`);
  }, [navigate]);


  // Fetch reshare data
  useEffect(() => {
    if (!author || !permlink) return;
    setReshareCount(0);
    setHasReshared(false);
    (async () => {
      try {
        const { reshares, count } = await getResharesForVideo(author, permlink);
        setReshareCount(count);
        if (user) {
          setHasReshared(reshares.some(r => r.username === (user || incubationHandle)));
        }
      } catch (err) {
        console.warn('Failed to fetch reshares:', err);
      }
    })();
  }, [author, permlink, user, incubationHandle]);

  const handleReshare = useCallback(async () => {
    // A reshare is not a chain operation: it is a row in 3Speak's own reshare
    // store, keyed by name. So an incubating user can make one under their
    // handle, and the only thing that was stopping them was this gate asking
    // for a Hive username they do not have.
    const asWho = user || incubationHandle;
    if (!authenticated || !asWho) {
      toast.error(t('watch.reshare.loginRequired'));
      return;
    }
    if (hasReshared) return;
    const result = await recordReshare(asWho, author, permlink);
    if (result) {
      setHasReshared(true);
      setReshareCount(prev => prev + 1);
      toast.success(t('watch.reshare.success'));
    } else {
      toast.error(t('watch.reshare.failed'));
    }
  }, [authenticated, user, incubationHandle, author, permlink, hasReshared]);

  const handleRemix = useCallback((mediaType = 'video') => {
    if (!videoUrlSelected) {
      toast.error(t('watch.clip.noVideoUrlRemix'));
      return;
    }
    if (videoControls?.onPause) videoControls.onPause();
    setEditorVideoUrl(videoUrlSelected);
    setEditorVideoName(`${author} - ${videoDetails?.title || permlink}`);
    setEditorClipStart(null);
    setEditorClipEnd(null);
    setEditorVideoType(mediaType);
    setShowEditorModal(true);
  }, [videoUrlSelected, author, permlink, videoDetails?.title, videoControls]);

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

  // Clip mode helpers
  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleStartClipMode = useCallback(() => {
    setClipMode('start');
    setClipStart(null);
    setClipEnd(null);
    toast.info(t('watch.clip.startHint'));
  }, []);

  const handleSetClipStart = useCallback(() => {
    const time = Math.floor(videoControls?.currentTime || 0);
    setClipStart(time);
    setClipMode('end');
    toast.info(t('watch.clip.endHint'));
  }, [videoControls?.currentTime]);

  const handleSetClipEnd = useCallback(() => {
    let time = Math.floor(videoControls?.currentTime || 0);
    if (clipStart !== null && time <= clipStart) {
      toast.error(t('watch.clip.endBeforeStart'));
      return;
    }
    if (clipStart !== null && time - clipStart > 60) {
      time = clipStart + 60;
      toast.info(t('watch.clip.trimmed'));
    }
    setClipEnd(time);
    setClipMode('done');
    toast.success(t('watch.clip.set', { start: formatTime(clipStart), end: formatTime(time) }));
  }, [videoControls?.currentTime, clipStart]);

  const handleCancelClip = useCallback(() => {
    setClipMode(false);
    setClipStart(null);
    setClipEnd(null);
  }, []);

  const handleCreateClip = useCallback(() => {
    if (!videoUrlSelected) {
      toast.error(t('watch.clip.noVideoUrl'));
      return;
    }
    if (videoControls?.onPause) videoControls.onPause();
    setEditorVideoUrl(videoUrlSelected);
    setEditorVideoName(`${author} - ${videoDetails?.title || permlink} (clip)`);
    setEditorClipStart(clipStart);
    setEditorClipEnd(clipEnd);
    setShowEditorModal(true);
    setClipMode(false);
  }, [videoUrlSelected, author, permlink, videoDetails?.title, clipStart, clipEnd, videoControls]);

  const handleProfileNavigate = useCallback((userName) => {
    navigate(`/p/${userName}`);
  }, [navigate]);

  const toggleTooltip = useCallback(() => {
    if (!authenticated || !isLoggedIn()) return;
    setShowTooltip((prev) => !prev);
  }, [authenticated]);

  const handleShare = useCallback(async () => {
    const time = Math.floor(videoControls?.currentTime || 0);
    const timeParam = time > 0 ? `&t=${time}` : '';
    const shareUrl = `${window.location.origin}/watch?v=${author}/${permlink}${timeParam}`;
    const shareData = { title: videoDetails?.title || t('watch.share.defaultTitle'), url: shareUrl };
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(t('watch.share.linkCopied'));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast.success(t('watch.share.linkCopied'));
        } catch {
          toast.error(t('watch.share.failed'));
        }
      }
    }
  }, [author, permlink, videoDetails?.title, videoControls?.currentTime]);

  const handleFabFollow = useCallback(async () => {
    if (!isLoggedIn()) { toast.error(t('watch.follow.loginRequired')); return; }
    if (followLoading) return;
    setFollowLoading(true);
    setIsFollowingCreator(true);
    try {
      await followWithAioha(author, true);
      toast.success(t('watch.follow.followed', { user: author }));
    } catch (err) {
      setIsFollowingCreator(false);
      toast.error(t('watch.follow.failed', { error: err.message }));
    } finally {
      setFollowLoading(false);
    }
  }, [author, followLoading]);

  const handleCommunityNavigate = useCallback((community) => {
    navigate(`/community/${community}`);
  }, [navigate]);

  // Loading state - show loader if essential data is missing
  if (!videoDetails) {
    return <BarLoader />;
  }

  // Views/age + payout/votes. In v2 this is rendered on the right of the title
  // (stacked); in the classic layout it sits as its own row below the buttons.
  // Defined once so the refs/tooltips only ever attach to a single instance.
  const statsRow = (
    <div className="info-stats-row">
      <div className="wrap-left">
        <ViewCount views={view} author={author} permlink={permlink} size={13} />
        <div className="wrap">
          <LuTimer />
          <span>{formatRelativeTime(videoDetails?.created_at)}</span>
        </div>
      </div>
      <div className="wrap-right-stats">
        {/* An off-chain post has no payout and no beneficiaries: there is no
            Hive post to reward. "$0.00" beside it read as "this earned
            nothing", which is a different and much worse statement. */}
        {!postIsOffChain && <span
          ref={payoutRef}
          onMouseEnter={() => setShowBeneficiaries(true)}
          onMouseLeave={() => setShowBeneficiaries(false)}
          onClick={() => setPinnedBeneficiaries(prev => !prev)}
          style={{ cursor: 'pointer' }}
        >
          <PayoutAmount amount={videoDetails?.stats?.total_hive_reward ?? 0} size={13} />
        </span>}
        {!postIsOffChain && (showBeneficiaries || pinnedBeneficiaries) && beneficiaries.length > 0 && (
          <BeneficiariesTooltip
            beneficiaries={beneficiaries}
            payoutInfo={payoutInfo}
            displayTotal={videoDetails?.stats?.total_hive_reward ?? 0}
            anchorRef={payoutRef}
            pinned={pinnedBeneficiaries}
            onClose={() => setPinnedBeneficiaries(false)}
          />
        )}
        <span className="wrap" ref={voteCountRef}>
          <UpvoteCount
            // Off-chain posts have no Hive votes to count, so the stored ones
            // are the only ones there are. A Hive post keeps its own count:
            // mixing the two would report a number that matches neither.
            count={postIsOffChain ? (offChainVotes ?? 0) : optimisticVoteCount}
            voted={postIsOffChain ? offChainVoted : isVoted}
            onClick={toggleTooltip}
            loading={isLoading}
            onCountEnter={() => setOpenToolTip(true)}
            onCountLeave={() => setOpenToolTip(false)}
            onCountClick={() => setPinnedTooltip(prev => !prev)}
            size={13}
          >
            <div className="loader-circle">
              <TailChase className="loader-circle" size="15" speed="1.5" color="red" />
            </div>
          </UpvoteCount>
          {(openTooltip || pinnedTooltip) && (
            <ToolTip
              tooltipVoters={tooltipVoters}
              anchorRef={voteCountRef}
              pinned={pinnedTooltip}
              onClose={() => setPinnedTooltip(false)}
            />
          )}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <div className="play-video">
        <div className="top-container">
          {(author && permlink) ? (
            <div className="video-iframe-wrapper" ref={wrapperRef}>
              {/* Live OpenPods stream: the WebRTC live player takes the player
                  slot in place of the (idle) VOD <video>. Everything around it —
                  title, description, voting, comments — is the real post. */}
              {isLive && streamRoom && (
                <LiveStreamPlayer
                  roomName={streamRoom}
                  chatSlot={liveChatSlot}
                  onChatSent={onLiveChatSent}
                  vodAssetPending={vodAssetPending}
                  onRoomMeta={onStreamRoomMeta}
                />
              )}
              {adCountdown != null && (
                // Bottom-right, opposite the disclosure, so the two never collide.
                // aria-live so it is announced once rather than on every tick.
                <div className="watch-ad-countdown" role="status" aria-live="polite">
                  {t('watch.ad.countdown', { seconds: adCountdown })}
                </div>
              )}
              {/* Skip, bottom-right. Its own slot rather than part of the disclosure:
                  the disclosure sits at the TOP of the frame, and a child of it can
                  only be positioned against that box, not against the video. */}
              {adSkip}
              {sponsorLabel && (
                // Disclosure while a sponsor spot is playing. Rendered inside the
                // player frame rather than as a page-level element: a filter list
                // cannot hide it without hiding the video with it.
                <div className="watch-sponsor-note watch-sponsor-slot">{sponsorLabel}</div>
              )}
              {/* Click target over a burned-in banner. Positions itself against the
                  <video> element's displayed frame, so it belongs inside the same
                  wrapper the video is in. */}
              {bannerHit}
              {/* The ticker crawl, drawn above the controls bar. */}
              {tickerSlot}
              <video
                ref={attachVideo}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  background: "#000",
                }}
                playsInline
              />
              {/* Branded preload cover — the SAME splash as the site's initial load
                  (EmergencyScreen "checking": 3Speak logo + TailChase). Opaque, so it
                  HIDES the black player until the first frame is ready (driven by the
                  onReady gate in Watch.jsx). Cleared the moment playback is ready, and
                  suppressed once a video is known unavailable so the overlays don't stack. */}
              {mediaLoading && !mediaUnavailable && (
                <div className="video-preload-overlay" aria-hidden="true">
                  <img
                    className="video-preload-logo"
                    src={isDarkTheme ? threespeakLogoDark : threespeakLogo}
                    alt="3Speak"
                  />
                  <TailChase size="42" speed="1.75" color="var(--accent-primary, #e0594b)" />
                </div>
              )}
              {/* Media gone (old upload whose IPFS content is unpinned). The player
                  exhausted every gateway; show an honest hint over the black frame
                  instead of a stuck spinner. The post itself still loads below. */}
              {mediaUnavailable && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 6, background: '#000',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', textAlign: 'center', padding: '24px', gap: '10px',
                }}>
                  <div style={{ fontSize: '2.2rem', lineHeight: 1 }}>🚫</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600, color: '#f0f0f0' }}>
                    {t('watch.media.unavailableTitle')}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#aaa', maxWidth: '440px', lineHeight: 1.5 }}>
                    {t('watch.media.unavailableBody')}
                  </div>
                </div>
              )}
              {/* Recoverable transport failure — a gateway that couldn't be read
                  (CORS), a network drop, a 5xx or a timeout. The media is very
                  likely fine, so say so and offer a retry rather than claiming
                  the video is gone. Nothing is reported to the checker. */}
              {mediaBlocked && !mediaUnavailable && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 6, background: '#000',
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', textAlign: 'center', padding: '24px', gap: '10px',
                }}>
                  <div style={{ fontSize: '2.2rem', lineHeight: 1 }}>📡</div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 600, color: '#f0f0f0' }}>
                    {t('watch.media.blockedTitle')}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#aaa', maxWidth: '440px', lineHeight: 1.5 }}>
                    {t('watch.media.blockedBody')}
                  </div>
                  {onRetryPlayback && (
                    <button
                      onClick={onRetryPlayback}
                      style={{
                        marginTop: '6px', padding: '7px 16px', fontSize: '0.85rem',
                        borderRadius: '7px', cursor: 'pointer', background: 'transparent',
                        border: '1px solid var(--accent-primary, #e0594b)',
                        color: 'var(--accent-primary, #e0594b)',
                      }}
                    >
                      {t('common.actions.tryAgain')}
                    </button>
                  )}
                </div>
              )}
              {/* Not over the spot. contentTime() clamps to the cut point while the
                  break runs, so without this the last cue before the ad would sit
                  frozen on top of somebody else's video for its whole length. */}
              {videoControls?.subtitleCues?.length > 0 && !adPlaying && (
                <SubtitleOverlay
                  currentTime={videoControls.subtitleCurrentTime}
                  cues={videoControls.subtitleCues}
                  style={videoControls.subtitleStyle}
                />
              )}
              {tipNudgeVisible && !isTipModalOpen && authenticated && isLoggedIn() && user !== author && (
                <div className="tip-nudge">
                  <FaHeart className="tip-nudge-emoji hide-mobile" style={{ color: '#e53935' }} />
                  <span className="tip-nudge-text"><Trans i18nKey="watch.tipNudge.text" values={{ author }} components={{ hide: <span className="hide-mobile" />, b: <strong /> }} /></span>
                  <button type="button" className="tip-nudge-btn" onClick={() => { setTipNudgeVisible(false); setIsTipModalOpen(true); }}>
                    {t('watch.actions.tip')}
                  </button>
                  <button type="button" className="tip-nudge-close" onClick={() => setTipNudgeVisible(false)} aria-label={t('watch.tipNudge.dismiss')}>
                    <MdClose size={14} />
                  </button>
                </div>
              )}
              {videoControls?.videoEnded && (() => {
                const suggestions = (!videoControls.autoplayNext && videoControls.endSuggestions?.length > 0) ? videoControls.endSuggestions : [];
                const renderCard = (v, i) => {
                  const vAuthor = v?.author?.username || v?.author?.id || v?.author || v?.owner;
                  return (
                    <a
                      key={`${vAuthor}-${v.permlink}-${i}`}
                      className="video-ended-card"
                      href={`/watch?v=${vAuthor}/${v.permlink}`}
                      onClick={(e) => { e.preventDefault(); navigate(`/watch?v=${vAuthor}/${v.permlink}`); }}
                    >
                      <img src={fixVideoThumbnail(v)} alt={v.title} onError={(e) => (e.currentTarget.src = fallbackImg)} />
                      <div className="video-ended-card-info">
                        <span className="video-ended-card-title">{v.title?.length > 40 ? v.title.slice(0, 40) + '...' : v.title}</span>
                        <span className="video-ended-card-author">@{vAuthor}</span>
                      </div>
                    </a>
                  );
                };
                return (
                  <div className="video-ended-overlay">
                    {/* Mobile: 1 card left of replay */}
                    {suggestions.length > 0 && (
                      <div className="video-ended-mobile-card">{renderCard(suggestions[0], 0)}</div>
                    )}
                    <button type="button" className="video-replay-btn" onClick={videoControls.onReplay} title={t('player.overlay.replay')}>
                      <MdReplay size={48} />
                    </button>
                    {/* Mobile: 1 card right of replay */}
                    {suggestions.length > 1 && (
                      <div className="video-ended-mobile-card">{renderCard(suggestions[1], 1)}</div>
                    )}
                    {/* Desktop: all cards below replay */}
                    {suggestions.length > 0 && (
                      <div className="video-ended-suggestions">
                        {suggestions.map((v, i) => renderCard(v, i))}
                      </div>
                    )}
                  </div>
                );
              })()}
              {videoControls?.autoplayBlocked && !videoControls?.videoEnded && (
                <div className="video-replay-overlay" onClick={videoControls.onAutoplayTap}>
                  <button type="button" className="video-replay-btn" title={t('common.actions.play')}>
                    <MdPlayArrow size={48} />
                  </button>
                </div>
              )}
              {videoControls && (
                <>
                  <div
                    className="video-interact-overlay"
                    style={showTooltip ? { pointerEvents: 'none' } : undefined}
                    onMouseMove={(e) => {
                      if (window.innerWidth > 767) videoControls.onMouseMove();
                      pressMoved(e.clientX);
                    }}
                    onMouseDown={(e) => {
                      if (e.button !== 0 || Date.now() - lastTouchRef.current < 500) return;
                      startPress(e.clientX);
                    }}
                    onMouseUp={(e) => {
                      if (e.button !== 0 || Date.now() - lastTouchRef.current < 500) return;
                      if (!endPress()) return;
                      // While a spot is on screen the controls are hidden, so the
                      // small-screen gesture that normally reveals them has nothing
                      // to reveal. Pause instead — a tap has to do SOMETHING, and
                      // pausing is what tapping a playing ad should do anyway.
                      if (window.innerWidth <= 767 && !adPlaying) videoControls.onToggleControls();
                      else {
                        flashAction(videoControls.isPlaying ? 'pause' : 'play');
                        videoControls.onTogglePlay();
                      }
                    }}
                    onMouseLeave={cancelPress}
                    onTouchStart={(e) => {
                      lastTouchRef.current = Date.now();
                      e.preventDefault();
                      startPress(e.touches[0]?.clientX ?? 0);
                    }}
                    onTouchMove={(e) => pressMoved(e.touches[0]?.clientX ?? 0)}
                    onTouchEnd={(e) => {
                      lastTouchRef.current = Date.now();
                      e.preventDefault();
                      if (!endPress()) return;
                      if (adPlaying) {
                        flashAction(videoControls.isPlaying ? 'pause' : 'play');
                        videoControls.onTogglePlay();
                      } else videoControls.onToggleControls();
                    }}
                    onTouchCancel={cancelPress}
                    onContextMenu={(e) => { if (pressFiredRef.current) e.preventDefault(); }}
                  />
                  {speedBadge && (
                    <div className={`video-speed-badge${speedBadge.holding ? '' : ' video-speed-badge--leaving'}`} aria-live="polite">
                      <span className="video-speed-badge__rate">{speedBadge.rate === FRAME_STEP ? '1 fps' : `${speedBadge.rate}x`}</span>
                      {speedBadge.holding && <TbPlayerTrackNextFilled className="video-speed-badge__icon" aria-hidden="true" />}
                    </div>
                  )}
                  {actionFlash && (
                    <div key={actionFlash.n} className="video-action-flash" aria-hidden="true">
                      {actionFlash.kind === 'play' && <FaPlay className="video-action-flash__icon video-action-flash__icon--play" />}
                      {actionFlash.kind === 'pause' && <FaPause className="video-action-flash__icon" />}
                      {actionFlash.kind === 'back' && <TbRewindBackward10 className="video-action-flash__icon" />}
                      {actionFlash.kind === 'forward' && <TbRewindForward10 className="video-action-flash__icon" />}
                    </div>
                  )}
                  <VideoControls
                    adPlaying={adPlaying}
                    adLocked={adLocked}
                    currentTime={videoControls.currentTime}
                    duration={videoControls.duration}
                    buffered={videoControls.buffered}
                    isPlaying={videoControls.isPlaying}
                    isMuted={videoControls.isMuted}
                    volume={videoControls.volume}
                    isFullscreen={videoControls.isFullscreen}
                    isVisible={videoControls.isVisible}
                    onTogglePlay={videoControls.onTogglePlay}
                    onToggleMute={videoControls.onToggleMute}
                    onVolumeChange={videoControls.onVolumeChange}
                    onSeekBackward={videoControls.onSeekBackward}
                    onSeekForward={videoControls.onSeekForward}
                    onSeek={videoControls.onSeek}
                    onToggleFullscreen={videoControls.onToggleFullscreen}
                    markers={videoControls.markers}
                    chapters={videoControls.chapters}
                    replayHeatmap={videoControls.replayHeatmap}
                    previewVideoId={videoControls.previewVideoId}
                    getPlaybackHeight={videoControls.getPlaybackHeight}
                    onMarkerSelect={videoControls.onMarkerSelect}
                    onReactToMoment={videoControls.onReactToMoment}
                    onCycleReactionSize={videoControls.onCycleReactionSize}
                    reactionSizeLabel={videoControls.reactionSizeLabel}
                    onTogglePip={videoControls.onTogglePip}
                    qualityLevels={videoControls.qualityLevels}
                    currentQuality={videoControls.currentQuality}
                    onQualityChange={videoControls.onQualityChange}
                    glowMode={videoControls.glowMode}
                    onToggleGlow={videoControls.onToggleGlow}
                    autoplayNext={videoControls.autoplayNext}
                    onToggleAutoplay={videoControls.onToggleAutoplay}
                    subtitleLanguages={videoControls.subtitleLanguages}
                    selectedSubtitleLang={videoControls.selectedSubtitleLang}
                    onSubtitleChange={videoControls.onSubtitleChange}
                    subtitleLoading={videoControls.subtitleLoading}
                    subtitleStyle={videoControls.subtitleStyle}
                    onSubtitleStyleChange={videoControls.onSubtitleStyleChange}
                    playbackRate={videoControls.playbackRate}
                    onPlaybackRateChange={videoControls.onPlaybackRateChange}
                    onHoldControls={videoControls.onHoldControls}
                    onReleaseControls={videoControls.onReleaseControls}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="video-loader">
              <ImSpinner9 className="spinner" />
            </div>
          )}

          {/* Notices that belong to the video rather than the page — the
              supporters-only paywall, and the creator's guest list. Between the
              player and the title on purpose: above the player they read as a
              site-wide banner and push the video down the page, when what they
              are actually commenting on is the thing just above them. */}
          {belowPlayerSlot}

          <div className={`video-title-row${!mobileDetailsExpanded ? ' title-collapsed' : ''}`}>
            <div className="video-title-col">
              <div className="video-title-line">
                <h3>{titleMeta.translatedTitle || videoDetails?.title}</h3>
                <TitleTranslate
                  languages={titleMeta.availableLangs}
                  selectedLang={titleMeta.selectedLang}
                  onSelect={titleMeta.selectLanguage}
                />
                <AiBadge key={`${author}/${permlink}`} author={author} permlink={permlink} />
              </div>
              <div className="mobile-title-meta">
                <AuthorBadge
                  author={videoDetails?.author?.id}
                  reputation={authorReputation}
                  followersCount={followData?.follower_count}
                />
                {community_id && (
                  <div className="community-title-wrap" onClick={() => handleCommunityNavigate(community_id)}>
                    <AccountImg account={community_id} alt="" />
                    <div className="community-text">
                      <span className="community-name">{comunity_name}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {v2 && <div className="pv2-title-meta">{statsRow}</div>}
            <button
              type="button"
              className="mobile-title-toggle"
              onClick={() => setMobileDetailsExpanded(prev => !prev)}
            >
              {mobileDetailsExpanded ? <MdKeyboardArrowUp size={20} /> : <MdKeyboardArrowDown size={20} />}
            </button>
          </div>

          <div className={`video-details-collapsible${mobileDetailsExpanded ? '' : ' collapsed'}`}>
          <div className="badges-row">
            <AuthorBadge
              author={videoDetails?.author?.id}
              reputation={authorReputation}
              followersCount={followData?.follower_count}
              showFollow
              // No longer locked for an author with no Hive account. A follow
              // of one is stored off-chain instead of being broadcast at an
              // account that does not exist, and they are told when it does.
              offChainAuthor={!!postIsOffChain}
              // Left to the badge for an off-chain author: it reads that state
              // from the incubation store, and the Hive lookup this holds would
              // always answer "no".
              isFollowing={postIsOffChain ? undefined : isFollowingCreator}
              onFollow={(_, willFollow) => setIsFollowingCreator(willFollow)}
            />
            {community_id && (<div className="community-title-wrap" onClick={() => handleCommunityNavigate(community_id)}>
              <AccountImg account={community_id} alt="" />
              <div className="community-text">
                <span className="community-name">{comunity_name}</span>
                {communityData?.subscribers != null && (
                  <span className="community-members">{t('watch.community.members', { count: communityData.subscribers })}</span>
                )}
              </div>
            </div>)}
          </div>

          <div className="community-tags-row">
            <div className="tag-wrapper">
              {extendedDetails?.mantecurated && (
                <span className="curated-tag" onClick={() => handleSelectTag('mantecurated')}>
                  <img src={mantequillaLogo} alt="" className="curated-tag-icon" />
                  {t('watch.tags.curated')}
                </span>
              )}
              {tags.map((tag, index) => (
                <span key={index} onClick={() => handleSelectTag(tag)}>{tag}</span>
              ))}
            </div>

            {/* Topic consensus (viewer votes + auto tags, each with its %). Siblings
                of the author tags: on desktop they share the row and wrap together
                (.topic-chips is display:contents); on mobile they drop to their own
                line. Hover shows who tagged it; click pins that list. */}
            {SHOW_TOPIC_TAGS && topicTags?.counts?.length > 0 && (
              <div className="topic-chips">
                {topicTags.counts.map((c) => (
                  <span
                    key={c.tag}
                    className={`tag--topic${c.auto ? ' tag--topic-auto' : ''}${c.count > 0 ? ' tag--topic-voted' : ''}`}
                    onMouseEnter={(e) => { if (!tagTipPinned) setTagTipHover({ tag: c.tag, el: e.currentTarget }); }}
                    onMouseLeave={() => { if (!tagTipPinned) setTagTipHover(null); }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setTagTipPinned((prev) => (prev?.tag === c.tag ? null : { tag: c.tag, el: e.currentTarget }));
                    }}
                  >
                    {displayTag(c.tag)} <b>{c.pct}%</b>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Voters list for the hovered/pinned topic chip. */}
          {activeTagTip && (() => {
            const c = topicTags?.counts?.find((x) => x.tag === activeTagTip.tag);
            const voters = (c?.voters || []).map((v) => ({ username: v.voter, weight: v.weight }));
            const label = displayTag(activeTagTip.tag);
            return (
              <ToolTip
                tooltipVoters={voters}
                anchorRef={{ current: activeTagTip.el }}
                pinned={!!tagTipPinned}
                onClose={() => { setTagTipPinned(null); setTagTipHover(null); }}
                title={t('watch.topics.taggedBy', { label, count: voters.length })}
                pinnedTitle={t('watch.topics.viewers', { label, count: voters.length })}
                emptyText={c?.auto ? t('watch.topics.autoNoVotes') : t('watch.topics.noVotes')}
                footer={(() => {
                  const isInterest = ALL_TOPIC_SLUGS.includes(activeTagTip.tag);
                  const already = (interests || []).includes(activeTagTip.tag);
                  return (
                    <>
                      {isInterest && authenticated && (
                        already ? (
                          <div className="votes-tooltip-note">{t('watch.topics.inInterests')}</div>
                        ) : (
                          <button
                            type="button"
                            className="votes-tooltip-feed-btn secondary"
                            onClick={() => addToInterests(activeTagTip.tag)}
                          >
                            {t('watch.topics.addToInterests')}
                          </button>
                        )
                      )}
                      <button
                        type="button"
                        className="votes-tooltip-feed-btn"
                        onClick={() => { setTagTipPinned(null); setTagTipHover(null); navigate(`/t/${activeTagTip.tag}`); }}
                      >
                        {t('watch.topics.openTagFeed')}
                      </button>
                    </>
                  );
                })()}
              />
            );
          })()}

          <div className="play-video-info">
            {scheduled && (
              <div className="scheduled-notice">
                <LuTimer />
                <span>
                  <Trans
                    i18nKey="watch.scheduled.notice"
                    values={{ date: scheduledOn ? new Date(scheduledOn).toLocaleString() : t('watch.scheduled.futureDate') }}
                    components={{ b: <strong /> }}
                  />
                  {(authenticated && user === author) && onEditScheduled && (
                    <>
                      {' '}
                      <button type="button" className="scheduled-notice-edit" onClick={() => onEditScheduled()}>
                        {t('watch.scheduled.edit')}
                      </button>
                    </>
                  )}
                </span>
              </div>
            )}
            {!v2 && statsRow}

            <div className="info-buttons-row">
              {FEATURE_EDITOR && canRemixClip && (
                <div className="info-buttons-left">
                  <button
                    type="button"
                    className={`pv-btn clip-btn${clipMode ? ' active' : ''}`}
                    onClick={clipMode ? handleCancelClip : handleStartClipMode}
                    title={!authenticated ? t('watch.clip.loginRequired') : clipMode ? t('watch.clip.cancel') : t('watch.clip.clipVideo')}
                    disabled={!authenticated}
                    {...lockProps}
                  >
                    <Scissors size={16} />
                    <span className="tools-row-label">{t('watch.clip.label')}</span>
                  </button>
                  {clipMode && (
                    <div className="clip-bar-inline">
                      <span className="clip-bar-inline-label">
                        {clipMode === 'start' && t('watch.clip.seekToStart')}
                        {clipMode === 'end' && `${formatTime(clipStart)} →`}
                        {clipMode === 'done' && `${formatTime(clipStart)} – ${formatTime(clipEnd)}`}
                      </span>
                      {clipMode === 'start' && (
                        <button type="button" className="clip-action-btn" onClick={handleSetClipStart}>{t('watch.clip.setStart')}</button>
                      )}
                      {clipMode === 'end' && (
                        <button type="button" className="clip-action-btn" onClick={handleSetClipEnd}>{t('watch.clip.setEnd')}</button>
                      )}
                      {clipMode === 'done' && (
                        <button type="button" className="clip-action-btn" onClick={handleCreateClip}>{t('watch.clip.createClip')}</button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="info-buttons-right">
                {/* A scheduled post isn't public yet — vote/share/reshare/tip/etc.
                    don't apply. Only the owner's edit (pen) control is shown,
                    routed to the scheduled-post editor. */}
                {scheduled ? (
                  (authenticated && user === author) && (
                    <button
                      type="button"
                      className="pv-btn edit-video-btn"
                      onClick={() => onEditScheduled?.()}
                      title={t('watch.scheduled.editTitle')}
                    >
                      <MdEdit size={16} />
                    </button>
                  )
                ) : (
                <>
                {titleMeta.hasSummary && (
                  <button
                    type="button"
                    className="pv-btn summary-btn"
                    onClick={() => setSummaryOpen(true)}
                    title={t('watch.summary.buttonTitle')}
                  >
                    <MdAutoAwesome size={15} />
                    <span>{t('watch.summary.title')}</span>
                  </button>
                )}
                {authenticated && isLoggedIn() && !isVoted && user?.toLowerCase() !== author?.toLowerCase() && !(votingClosed && alreadyTagged) && (
                  // Hidden on your own video (you can't vote for yourself).
                  // Sits to the left of the share button; opens the
                  // same vote tooltip the upvote count uses, so the
                  // existing weight-picker / submit flow still drives
                  // the actual broadcast. Hidden once the user has
                  // already voted — and, once voting is closed, once the
                  // user has already tagged (the tag is one-shot).
                  <button
                    type="button"
                    className={`pv-btn vote-btn${voteIsOffChain && offChainVoted ? ' voted' : ''}`}
                    onClick={voteIsOffChain ? handleOffChainVote : toggleTooltip}
                    title={voteIsOffChain
                      ? (authenticated
                        ? t('watch.actions.voteOffChain')
                        : t('watch.actions.signInToVote'))
                      : (votingClosed ? t('watch.actions.tagVideo') : t('watch.actions.voteVideo'))}
                    {...(voteIsOffChain ? {} : lockProps)}
                    {...(voteIsOffChain && !authenticated
                      ? { 'aria-disabled': true, onClick: (e) => { e.preventDefault(); } }
                      : {})}
                  >
                    {votingClosed && !voteIsOffChain ? <IoPricetagOutline size={14} /> : <FaHeart size={14} />}
                    <span>
                      {votingClosed && !voteIsOffChain ? t('watch.actions.tag') : t('watch.actions.vote')}
                      {voteIsOffChain && offChainVotes ? ` ${offChainVotes}` : ''}
                    </span>
                  </button>
                )}
                {canSeeVideoStats && (
                  <button
                    type="button"
                    className={`pv-btn stats-btn${videoStatsOpen ? ' active' : ''}`}
                    onClick={() => setVideoStatsOpen((o) => !o)}
                    title={t('watch.actions.analyticsTitle')}
                    aria-expanded={videoStatsOpen}
                  >
                    <MdBarChart size={16} />
                    <span>{t('watch.actions.analytics')}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="pv-btn share-btn"
                  onClick={() => setShareChooserOpen(true)}
                  title={t('common.actions.share')}
                >
                  <MdShare size={16} />
                  <span>{t('common.actions.share')}</span>
                </button>

                <button
                  type="button"
                  className={`pv-btn reshare-btn${hasReshared ? ' reshared' : ''}`}
                  onClick={handleReshare}
                  disabled={!authenticated || (!isLoggedIn() && !incubationHandle)}
                  title={!authenticated ? t('watch.reshare.loginRequired') : hasReshared ? t('watch.reshare.reshared') : t('watch.reshare.reshare')}
                >
                  <Repeat2 size={16} />
                  <span>{t('watch.reshare.reshare')}</span>
                  {reshareCount > 0 && <span className="reshare-count">{reshareCount}</span>}
                </button>

                {authenticated && isLoggedIn() && (
                  <button
                    type="button"
                    className="pv-btn promote-btn"
                    onClick={() => setPromoteOpen(true)}
                    title={t('watch.actions.promoteTitle')}
                    {...lockProps}
                  >
                    <Rocket size={15} />
                    <span>{t('watch.actions.promote')}</span>
                  </button>
                )}

                {authenticated && user === author && (
                  <button
                    type="button"
                    className="pv-btn edit-video-btn"
                    onClick={() => {
                      videoControls?.onPause?.();
                      setIsEditOpen(true);
                    }}
                    title={t('watch.actions.editTitle')}
                  >
                    <MdEdit size={16} />
                    <span>{t('common.actions.edit')}</span>
                  </button>
                )}

                <button
                  type="button"
                  className={`pv-btn report-btn${isReported('post', `${author}/${permlink}`) ? ' reported' : ''}`}
                  onClick={() => setIsReportOpen(true)}
                  title={t('watch.actions.reportTitle')}
                >
                  <MdFlag size={16} />
                  <span>{t('common.actions.report')}</span>
                </button>

                {isInWatchLater && (
                  <button
                    type="button"
                    className={`pv-btn watch-later-remove-btn ${isRemovingWatchLater ? 'loading' : ''}`}
                    onClick={handleRemoveFromWatchLater}
                    disabled={isRemovingWatchLater}
                    title={t('watch.watchLater.removeTitle')}
                  >
                    <span className="watch-later-icon-wrap">
                      <MdWatchLater />
                      <span className="x-badge">&times;</span>
                    </span>
                  </button>
                )}

                {authenticated && isLoggedIn() && (
                  <>
                    <button type="button" className="pv-btn playlist-btn" onClick={() => setIsPlaylistModalOpen(true)} title={t('watch.actions.addToPlaylist')} {...lockProps}>
                      <MdPlaylistAdd />
                      <span>{t('watch.actions.playlist')}</span>
                    </button>
                    <button type="button" className="pv-btn tip-btn" onClick={() => setIsTipModalOpen(true)} title={t('watch.actions.tipTitle')} {...lockProps}>
                      <Gift size={16} />
                      <span>{t('watch.actions.tip')}</span>
                    </button>
                  </>
                )}

                {authenticated && isLoggedIn() && (
                  <CommentVoteTooltip
                    showTooltip={showTooltip}
                    setShowTooltip={setShowTooltip}
                    author={author}
                    permlink={permlink}
                    weight={weight}
                    setWeight={setWeight}
                    voteValue={voteValue}
                    setVoteValue={setVoteValue}
                    accountData={accountData}
                    setAccountData={setAccountData}
                    compact
                    enableViewerTag
                    postCreatedAt={videoDetails?.created || videoDetails?.created_at}
                    onVoteSuccess={(a, p, isNewVote) => {
                      setIsVoted(true);
                      if (isNewVote) setOptimisticVoteCount(prev => prev + 1);
                      refreshTopicTags();
                    }}
                  />
                )}
                </>
                )}
              </div>
            </div>
          </div>

          {/* Mobile-only tools row (Clip hidden from info-buttons-left on mobile) */}
          {FEATURE_EDITOR && canRemixClip && (
            <div className="tools-row mobile-only">
              <button
                type="button"
                className={`pv-btn clip-btn${clipMode ? ' active' : ''}`}
                onClick={clipMode ? handleCancelClip : handleStartClipMode}
                title={!authenticated ? t('watch.clip.loginRequired') : clipMode ? t('watch.clip.cancel') : t('watch.clip.clipVideo')}
                disabled={!authenticated}
                {...lockProps}
              >
                <Scissors size={16} />
                <span className="tools-row-label">{t('watch.clip.label')}</span>
              </button>
            </div>
          )}

        {/* Clip mode bar */}
        {FEATURE_EDITOR && clipMode && (
          <div className="clip-bar">
            <div className="clip-bar-info">
              <Scissors size={16} />
              <span className="clip-bar-label">
                {clipMode === 'start' && t('watch.clip.barStart')}
                {clipMode === 'end' && t('watch.clip.barEnd', { start: formatTime(clipStart) })}
                {clipMode === 'done' && t('watch.clip.barDone', { start: formatTime(clipStart), end: formatTime(clipEnd) })}
              </span>
            </div>
            <div className="clip-bar-actions">
              {clipMode === 'start' && (
                <button type="button" className="clip-action-btn" onClick={handleSetClipStart}>{t('watch.clip.setStart')}</button>
              )}
              {clipMode === 'end' && (
                <button type="button" className="clip-action-btn" onClick={handleSetClipEnd}>{t('watch.clip.setEnd')}</button>
              )}
              {clipMode === 'done' && (
                <button type="button" className="clip-action-btn" onClick={handleCreateClip}>{t('watch.clip.createClip')}</button>
              )}
              <button type="button" className="clip-cancel-btn" onClick={handleCancelClip}>{t('common.actions.cancel')}</button>
            </div>
          </div>
        )}

        {/* Show PlaylistBar when watching from a playlist, otherwise show VideoPlaylists */}
        {playlistData ? (
          <PlaylistBar
            playlist={playlistData.playlist}
            videos={playlistData.videos}
            currentIndex={playlistData.currentIndex}
            onClose={onClosePlaylist}
          />
        ) : (
          <VideoPlaylists author={author} permlink={permlink} />
        )}

        {/* Video-stats panel (owner/admins) — toggled by the Stats button, full-width row between the buttons and the description */}
        {canSeeVideoStats && videoStatsOpen && (
          <div className="watch-stats-panel">
            <VideoStats username={author} permlink={permlink} compact onSeek={videoControls?.onSeek} />
          </div>
        )}

        <div className="description-wrap">
          <div className={`description-collapsible${descriptionExpanded ? '' : ' collapsed'}`}>
            <div className="blog-content">
              {/* BlogContent falls back to fetching the post from Hive, which has
                  never heard of an off-chain one — that is the "No content
                  available" it was showing. Hand it the body we already have. */}
              <BlogContent
                author={author}
                permlink={permlink}
                description={overrideBody ?? (postIsOffChain ? videoDetails?.body : undefined)}
                duration={videoControls?.duration}
                onSeek={isLive ? null : seekFromText}
              />
            </div>
          </div>
          <button
            type="button"
            className="description-toggle-btn"
            onClick={() => setDescriptionExpanded(prev => !prev)}
          >
            {descriptionExpanded ? t('watch.description.hide') : t('watch.description.show')}
          </button>
        </div>
        </div>{/* end video-details-collapsible */}
        </div>{/* end top-container */}

        {/* Mobile reactions slot — between description and comments */}
        {mobileReactionPanel && (
          <div className="mobile-reactions-slot">
            {mobileReactionPanel}
          </div>
        )}

        {/* Cinema mode reactions slot — between description and comments (desktop) */}
        {cinemaReactionPanel && (
          <div className="cinema-reactions-slot">
            {cinemaReactionPanel}
          </div>
        )}

        <ShareChooserModal
          open={shareChooserOpen}
          url={`${window.location.origin}/watch?v=${author}/${permlink}`}
          title={videoDetails?.title}
          /* Embed code is offered only for something a stranger's page can
             actually play: a scheduled post isn't public yet, and a live stream
             has no VOD asset for the player to resolve. */
          embed={!scheduled && !isLive ? { author, permlink } : null}
          onClose={() => setShareChooserOpen(false)}
          onGeneralShare={handleShare}
        />

        <CommentSection
          videoDetails={videoDetails}
          author={author}
          permlink={permlink}
          setIsVoted={setIsVoted}
          currentTime={videoControls?.currentTime}
          duration={videoControls?.duration}
          onSeek={isLive ? videoControls?.onSeek : seekFromText}
          onRefreshReactions={videoControls?.onRefreshReactions}
          onPause={videoControls?.onPause}
        />
      </div>
      
      {isTipModalOpen && (
        <TipModal
          recipient={author}
          isOpen={isTipModalOpen}
          onClose={() => setIsTipModalOpen(false)}
        />
      )}

      <AddToPlaylistModal
        isOpen={isPlaylistModalOpen}
        onClose={() => setIsPlaylistModalOpen(false)}
        author={author}
        permlink={permlink}
        videoTitle={videoDetails?.title}
      />

      <EditorModal
        isOpen={showEditorModal}
        onClose={() => setShowEditorModal(false)}
        videoUrl={editorVideoUrl}
        videoName={editorVideoName}
        videoType={editorVideoType}
        clipStart={editorClipStart}
        clipEnd={editorClipEnd}
        originalAuthor={author}
        originalPermlink={permlink}
      />

      <ReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        type="video"
        target={{ author, permlink }}
      />

      <SummaryModal
        isOpen={summaryOpen}
        onClose={() => setSummaryOpen(false)}
        summary={titleMeta.summary}
        title={titleMeta.translatedTitle || videoDetails?.title}
      />

      <EditVideoModal
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        author={author}
        permlink={permlink}
        onSaved={(changes) => onVideoEdited?.(changes)}
      />

      <PromoteModal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        author={author}
        permlink={permlink}
      />

      {/* Mobile FAB — speed-dial for quick actions */}
      {!videoControls?.isFullscreen && fabOpen && (
        <div className="fab-backdrop" onClick={() => setFabOpen(false)} />
      )}
      {!videoControls?.isFullscreen && (
        <div className={`fab-speed-dial${fabOpen ? ' open' : ''}`}>
          {fabOpen && (
            <div className="fab-actions">
              {canSeeVideoStats && (
                <div className="fab-action">
                  <span className="fab-action-label">{t('watch.actions.analytics')}</span>
                  <button
                    className={`fab-action-btn${videoStatsOpen ? ' fab-action-btn--active' : ''}`}
                    onClick={() => {
                      const nv = !videoStatsOpen;
                      setVideoStatsOpen(nv);
                      if (nv) setMobileDetailsExpanded(true); // panel lives inside the collapsible details
                      setFabOpen(false);
                    }}
                    aria-label={t('watch.actions.videoStats')}
                  >
                    <MdBarChart size={20} />
                  </button>
                </div>
              )}

              {authenticated && user === author && (
                <div className="fab-action">
                  <span className="fab-action-label">{t('common.actions.edit')}</span>
                  <button
                    className="fab-action-btn"
                    onClick={() => { videoControls?.onPause?.(); setIsEditOpen(true); setFabOpen(false); }}
                    aria-label={t('watch.actions.editTitle')}
                    title={t('watch.actions.editTitle')}
                  >
                    <MdEdit size={20} />
                  </button>
                </div>
              )}

              <div className="fab-action">
                <span className="fab-action-label">{t('common.actions.share')}</span>
                <button
                  className="fab-action-btn"
                  onClick={() => { setShareChooserOpen(true); setFabOpen(false); }}
                  aria-label={t('common.actions.share')}
                >
                  <MdShare size={20} />
                </button>
              </div>

              <div className="fab-action">
                <span className="fab-action-label">{t('watch.actions.details')}</span>
                <button
                  className={`fab-action-btn${mobileDetailsExpanded ? ' fab-action-btn--active' : ''}`}
                  onClick={() => { setMobileDetailsExpanded(prev => !prev); setFabOpen(false); }}
                  aria-label={t('watch.actions.toggleDetails')}
                >
                  <MdInfo size={20} />
                </button>
              </div>

              {authenticated && isLoggedIn() && (
                <div className="fab-action">
                  <span className="fab-action-label">{t('watch.actions.playlist')}</span>
                  <button
                    className="fab-action-btn"
                    onClick={() => { setIsPlaylistModalOpen(true); setFabOpen(false); }}
                    aria-label={t('watch.actions.addToPlaylist')}
                    title={t('watch.actions.addToPlaylist')}
                    {...lockProps}
                  >
                    <MdPlaylistAdd size={20} />
                  </button>
                </div>
              )}

              {authenticated && isLoggedIn() && !isFollowingCreator && author !== user && (
                <div className="fab-action">
                  <span className="fab-action-label">{t('common.actions.follow')}</span>
                  <button
                    className="fab-action-btn"
                    onClick={() => { handleFabFollow(); setFabOpen(false); }}
                    aria-label={t('watch.actions.followCreator')}
                    title={t('watch.actions.followCreator')}
                    {...lockProps}
                  >
                    <MdPersonAdd size={20} />
                  </button>
                </div>
              )}

              {authenticated && isLoggedIn() && author !== user && (
                <div className="fab-action">
                  <span className="fab-action-label">{t('watch.actions.tip')}</span>
                  <button
                    className="fab-action-btn"
                    onClick={() => { setIsTipModalOpen(true); setFabOpen(false); }}
                    aria-label={t('watch.actions.tip')}
                    title={t('watch.actions.tipTitle')}
                    {...lockProps}
                  >
                    <MdAttachMoney size={20} />
                  </button>
                </div>
              )}

              {authenticated && isLoggedIn() && (
                <div className="fab-action">
                  <span className="fab-action-label">{t('watch.actions.promote')}</span>
                  <button
                    className="fab-action-btn"
                    onClick={() => { setPromoteOpen(true); setFabOpen(false); }}
                    aria-label={t('watch.actions.promoteTitle')}
                    title={t('watch.actions.promoteTitle')}
                    {...lockProps}
                  >
                    <Rocket size={18} />
                  </button>
                </div>
              )}

              {FEATURE_EDITOR && canRemixClip && authenticated && isLoggedIn() && (
                <div className="fab-action">
                  <span className="fab-action-label">{t('watch.clip.label')}</span>
                  <button
                    className={`fab-action-btn${clipMode ? ' fab-action-btn--active' : ''}`}
                    onClick={() => { setMobileDetailsExpanded(true); handleStartClipMode(); setFabOpen(false); }}
                    aria-label={t('watch.clip.clip')}
                    title={t('watch.clip.clipVideo')}
                    {...lockProps}
                  >
                    <Scissors size={18} />
                  </button>
                </div>
              )}

              {authenticated && isLoggedIn() && author !== user && (
                <div className="fab-action">
                  <span className="fab-action-label">{reshareCount > 0 ? t('watch.reshare.reshareWithCount', { count: reshareCount }) : t('watch.reshare.reshare')}</span>
                  <button
                    className={`fab-action-btn${hasReshared ? ' fab-action-btn--voted' : ''}`}
                    onClick={() => { handleReshare(); setFabOpen(false); }}
                    aria-label={t('watch.reshare.reshare')}
                  >
                    <Repeat2 size={20} />
                  </button>
                </div>
              )}

              {authenticated && isLoggedIn() && author !== user && !(votingClosed && alreadyTagged) && (
                <div className="fab-action">
                  <span className="fab-action-label">{votingClosed ? t('watch.actions.tag') : t('watch.actions.vote')}</span>
                  <button
                    className={`fab-action-btn${isVoted ? ' fab-action-btn--voted' : ''}`}
                    onClick={() => { setMobileDetailsExpanded(true); setShowTooltip(true); setFabOpen(false); }}
                    aria-label={votingClosed ? t('watch.actions.tag') : t('watch.actions.vote')}
                  >
                    {votingClosed ? <IoPricetagOutline size={18} /> : <FaHeart size={18} />}
                  </button>
                </div>
              )}
            </div>
          )}

          <button
            className="fab-main"
            onClick={() => setFabOpen(prev => !prev)}
            aria-label={fabOpen ? t('watch.actions.closeMenu') : t('watch.actions.openActions')}
          >
            {fabOpen ? <MdClose size={24} /> : <MdAdd size={24} />}
          </button>
        </div>
      )}
    </>
  );
};

PlayVideo.propTypes = {
  videoDetails: PropTypes.shape({
    title: PropTypes.string.isRequired,
    description: PropTypes.string,
    thumbnail_url: PropTypes.string,
    body: PropTypes.string,
    stats: PropTypes.shape({
      num_votes: PropTypes.number,
      total_hive_reward: PropTypes.number,
      num_comments: PropTypes.number,
    }),
    author: PropTypes.shape({
      follower_count: PropTypes.number,
      id: PropTypes.string,
    }),
    community: PropTypes.shape({
      title: PropTypes.string,
      username: PropTypes.string,
    }),
    tags: PropTypes.arrayOf(PropTypes.string),
    created_at: PropTypes.string,
  }),
  author: PropTypes.string.isRequired,
  permlink: PropTypes.string.isRequired,
  mediaUnavailable: PropTypes.bool,
  mediaBlocked: PropTypes.bool,
  onRetryPlayback: PropTypes.func,
  mediaLoading: PropTypes.bool,
  playlistData: PropTypes.shape({
    playlist: PropTypes.object,
    videos: PropTypes.array,
    currentIndex: PropTypes.number,
  }),
  onClosePlaylist: PropTypes.func,
  mobileReactionPanel: PropTypes.node,
  cinemaReactionPanel: PropTypes.node,
  videoRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
  wrapperRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
};

export default PlayVideo;