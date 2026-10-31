import { useEffect, useRef, useState, useCallback } from 'react';
import { getHiveUrl } from '../../utils/hiveNode';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  MdPlayArrow, MdPause, MdSkipNext, MdSkipPrevious,
  MdQueueMusic, MdPlaylistPlay, MdClose, MdDragIndicator, MdDelete,
  MdSubtitles, MdShare, MdContentCopy, MdOpenInNew,
  MdKeyboardArrowUp, MdKeyboardArrowDown,
  MdVolumeUp, MdVolumeOff,
  MdBedtime, MdGraphicEq, MdCast, MdAirplay, MdDownload, MdDownloadDone,
  MdListAlt, MdCheck, MdLink,
} from 'react-icons/md';
import { TbRewindBackward15, TbRewindForward15 } from 'react-icons/tb';
import { useAppStore } from '../../lib/store';
import { persistAudioPosition } from '../../lib/slices/createAudioPlayerSlice';
import { CHECKER_URL, LISTEN_BEAT_KEY } from '../../utils/config';
import { isLoggedIn } from '../../hive-api/aioha';
import { getUersContent } from '../../utils/hiveUtils';
import PayoutAmount from '../PayoutAmount/PayoutAmount';
import UpvoteCount from '../UpvoteCount/UpvoteCount';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import AddToPlaylistModal from '../AddToPlaylistModal/AddToPlaylistModal';
import TipModal from '../tip-reward/TipModal';
import { BiDollar } from 'react-icons/bi';
import BlogContent from '../playVideo/BlogContent';
import Waveform from './Waveform';
import ModalHeader from '../ModalHeader/ModalHeader';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import PodcastTipModal from '../Podcasts/PodcastTipModal';
import { canTipEpisode } from '../../lib/podcastTips';
import { recordProgress, flushProgress, resumePosition } from '../../lib/podcastProgress';
import { podcastPath, episodePath, artUrl, PODCAST_PLACEHOLDER } from '../../lib/podcasts';
// The namespace too, for privateAudioUrl: the podcast library adds it, and a
// build without it must still load (the player then plays track.src).
import * as podcastsLib from '../../lib/podcasts';
import { fetchChapters, fetchTranscript, chapterAt } from '../../lib/podcastMedia';
import { isDownloaded, localAudioUrl, downloadTrack, useDownloads } from '../../lib/podcastDownloads';
import { toastIn } from '../../utils/toast';
import {
  fmt, SPEEDS, SPEED_KEY, normalizeSpeed, formatSpeed, SKIP_BACK, SKIP_FORWARD, skipTarget,
  SLEEP_OPTIONS, startSleepTimer, sleepRemainingMs, sleepFadeFactor,
  chapterMarkers, chapterJumps, corsKnown, isHlsTrack,
  createSilenceDetector, skipRate, levelDb, savedMs, fmtSaved,
} from './playerMath';
import { attach, detach, canRoute, markNoCors, webAudioSupported, warmUp } from './audioEffects';
import PlayerMenu from './PlayerMenu';
import { ClipForm, CopyAtOption, EpisodeShareOptions } from './PlayerShare';
import { notifyMediaPlay, onMediaPlay } from '../../utils/mediaCoordinator';
import { trackArtist } from '../../utils/audioTrack';
import useListenTime from '../../hooks/useListenTime';
import { audioItemPath } from '../AudioItem/AudioItemView';
import mantequillaLogo from '../../assets/mantequilla-logo.png';
import '../../page/Audio.scss';
import './GlobalAudioPlayer.scss';

const TRANSCRIPT_ON_KEY = '3speak-audio-transcript';
const TRANSCRIPT_LANG_KEY = '3speak-audio-transcript-lang';
// Voice boost and skip silence, as last chosen: { boost, skip }.
const EFFECTS_KEY = '3speak-audio-effects';

const toast = toastIn('Podcasts');

// <audio> elements the player has swapped out (plain vs routed through Web
// Audio). Their late events (the pause from being taken out of the page) are
// ignored, so they can't touch the state of the element that took over.
const retiredEls = new WeakSet();

function readEffects() {
  try {
    const v = JSON.parse(localStorage.getItem(EFFECTS_KEY) || '{}');
    return { boost: !!v?.boost, skip: !!v?.skip };
  } catch { return { boost: false, skip: false }; }
}
function readSpeed() {
  try { return normalizeSpeed(localStorage.getItem(SPEED_KEY) ?? 1); } catch { return 1; }
}
const lsStorage = () => { try { return window.localStorage; } catch { return null; } };
// downloadTrack's err.code → its message under audio.podcasts.downloads.errors.
const DOWNLOAD_ERRORS = { too_large: 'tooLarge', rate_limited: 'rateLimited', storage: 'storage', failed: 'failed', no_source: 'noSource' };
// Safari: AirPlay through its own picker instead of the Remote Playback API.
const HAS_AIRPLAY = typeof window !== 'undefined' && typeof window.WebKitPlaybackTargetAvailabilityEvent !== 'undefined';

// ipfs-audio serves every embed-audio CID with CORS + Range. The hotipfs zone
// can't pull from its origin (500 "block was not found locally") and took the
// whole audio tab down; the main Bunny zone is the fallback on a media error.
const AUDIO_GATEWAYS = ['https://ipfs-audio.3speak.tv/ipfs', 'https://ipfs-3speak.b-cdn.net/ipfs'];
const AUDIO_CDN = AUDIO_GATEWAYS[0];

// Optional heartbeat obfuscation — AES-256-GCM with a key derived from the
// shared LISTEN_BEAT_KEY (must match the checker's). Output is
// base64(iv|ciphertext|tag), the layout the backend expects. Best-effort:
// any failure → null so the caller falls back to a plaintext beat.
let _beatKeyPromise = null;
function getBeatKey() {
  if (!LISTEN_BEAT_KEY || !globalThis.crypto?.subtle) return null;
  if (!_beatKeyPromise) {
    _beatKeyPromise = (async () => {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(LISTEN_BEAT_KEY));
      return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']);
    })().catch(() => null);
  }
  return _beatKeyPromise;
}
async function encryptBeat(obj) {
  try {
    const key = await getBeatKey();
    if (!key) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)))
    );
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv); out.set(ct, iv.length);
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return btoa(bin);
  } catch { return null; }
}

// The page a track's title opens: an outside episode's page, or a 3Speak audio's
// own page on the audio page (AudioItemView). None for a live stream.
function pageOf(track) {
  if (!track || track.live) return '';
  if (track.external) return episodePath(track._id);
  return track.owner && track.permlink ? audioItemPath(track) : '';
}

function audioThumb(item) {
  if (!item) return fallbackImg;
  // An outside podcast episode (components/Podcasts): the show's or episode's art.
  if (item.external) return item.art ? artUrl(item.art, 128) : PODCAST_PLACEHOLDER;
  const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
  if (!fixed || fixed === fallbackImg || fixed === '/images/speak.jpg') {
    return `/img/u/${item.owner}/avatar/small`;
  }
  return fixed;
}

// The cover the phone's media notification and lock screen show (Media
// Session): larger than the player's own thumbnail, and absolute so the system
// can fetch it.
function sessionArtwork(item) {
  let src;
  if (item.external) src = item.art ? artUrl(item.art, 512) : '';
  else {
    const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
    src = !fixed || fixed === fallbackImg || fixed === '/images/speak.jpg' ? `/img/u/${item.owner}/avatar/large` : fixed;
  }
  if (!src) return [];
  try { return [{ src: new URL(src, window.location.href).href }]; } catch { return []; }
}

function parseSRT(srt) {
  if (!srt || typeof srt !== 'string') return [];
  const cues = [];
  for (const b of srt.trim().split(/\n\s*\n/)) {
    const l = b.trim().split('\n');
    const t = l.find(x => x.includes('-->'));
    if (!t) continue;
    const [s, e] = t.split('-->').map(x => x.trim());
    const st = srtT(s), en = srtT(e);
    const tx = l.slice(l.indexOf(t) + 1).join(' ').trim();
    if (tx) cues.push({ start: st, end: en, text: tx });
  }
  return cues;
}
function srtT(t) {
  const m = t.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0;
}

function GlobalAudioPlayer() {
  const { t } = useTranslation();
  const {
    audioCurrent, audioQueue, audioAutoplayList,
    audioIsPlaying, audioCurrentTime, audioDuration,
    audioExpanded, audioShowQueue, audioPlayNonce,
    audioDock, audioDockOpener, audioLast, audioResumeLast,
    audioToggleNonce, audioSeekNonce, audioPendingSeek,
    audioClipEnd, audioClearClip,
    audioPlay, audioStop,
    audioSetIsPlaying, audioSetCurrentTime, audioSetDuration,
    audioSetExpanded, audioSetShowQueue,
    audioRemoveFromQueue, audioMoveInQueue, audioClearQueue,
    authenticated, user,
  } = useAppStore();
  const loggedIn = authenticated && isLoggedIn();
  const navigate = useNavigate();
  const isLive = !!audioCurrent?.live;

  const audioRef = useRef(null);

  // Two kinds of <audio> element: a plain one, and one routed through Web Audio
  // for voice boost and skip silence (audioEffects.js). Only a source that
  // allows CORS can be routed, and an element can never be un-routed, so the
  // player swaps the element itself (its React key) and hands over the position.
  // Every effect below that binds to audioRef.current re-runs on elKey.
  const [routed, setRouted] = useState(false);
  const elKey = routed ? 'fx' : 'plain';
  const routedRef = useRef(false);
  // What the element is playing: { id, src, local } (local = a saved copy).
  const srcRef = useRef({ id: null, src: null, local: false });
  // The saved copy's object URL for the current track, kept across a swap.
  const localUrlRef = useRef({ id: null, url: null });
  // Position and play state carried over to the next element.
  const handoverRef = useRef(null);
  // A seek waiting for the metadata (the element can't seek before it).
  const pendingStartRef = useRef(null);
  // hls.js for a live HLS stream in a browser that can't play HLS itself.
  const hlsRef = useRef(null);
  const dropHls = () => { if (hlsRef.current) { try { hlsRef.current.destroy(); } catch { /* gone */ } hlsRef.current = null; } };
  const [playingLocal, setPlayingLocal] = useState(false);
  // The source last loaded, so the effects can look at it once it's known.
  const [loadedSrc, setLoadedSrc] = useState(null);

  // Listening time for every track, 3Speak audio and outside episodes alike
  // (anonymous, like video watch time). Separate from pay-per-listen below.
  useListenTime(audioRef, audioCurrent, elKey);

  const switchElement = useCallback((toRouted) => {
    if (routedRef.current === toRouted) return;
    const el = audioRef.current;
    const id = srcRef.current.id;
    if (el && id) {
      const pos = el.readyState >= 1 ? el.currentTime : (pendingStartRef.current ?? el.currentTime);
      handoverRef.current = { id, t: pos || 0, playing: !el.paused };
    }
    if (el) {
      retiredEls.add(el);
      try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* already gone */ }
    }
    routedRef.current = toRouted;
    setRouted(toRouted);
  }, []);

  // Pay-per-listen accounting. The server measures real elapsed playback:
  // we open a session on track start (only when logged in — anonymous plays
  // never earn) and send a heartbeat while the audio is actually advancing.
  // The backend credits the wall-clock time it observes between beats, so a
  // listen can't be forged with a single request.
  const listenRef = useRef({ permlink: null, sid: null, token: null, beatMs: 10000, lastBeatAt: 0, credited: false, encrypted: false });
  const beatOnce = useCallback(async () => {
    const L = listenRef.current;
    if (!L.sid || L.credited) return;
    L.lastBeatAt = Date.now();
    try {
      let body = { sid: L.sid, token: L.token };
      if (L.encrypted) {
        const enc = await encryptBeat(body);
        if (!enc) return; // server requires encryption but we couldn't — skip
        body = { enc };
      }
      const { data } = await axios.post(`${CHECKER_URL}/audio/play-beat`, body);
      if (data?.done || data?.credited) L.credited = true;
    } catch { /* best-effort — never disrupt playback */ }
  }, []);

  // Vote / share / playlist for the now-playing track
  const [showVoteTooltip, setShowVoteTooltip] = useState(false);
  const [voteTarget, setVoteTarget] = useState(null);
  const [weight, setWeight] = useState(100);
  const [voteValue, setVoteValue] = useState(0);
  const [accountData, setAccountData] = useState(null);
  const [playlistTarget, setPlaylistTarget] = useState(null);
  const [shareTarget, setShareTarget] = useState(null);
  const [tipTarget, setTipTarget] = useState(null);
  const [podcastTip, setPodcastTip] = useState(null);
  // Closing the player stops the track, never the queue: while the queue holds
  // something, a small "Up next" bar stays (hidden on request until the next play).
  const [idleHidden, setIdleHidden] = useState(false);
  useEffect(() => { if (audioCurrent) setIdleHidden(false); }, [audioCurrent]);
  const idleBar = !audioCurrent && audioQueue.length > 0 && !idleHidden;

  // Post enrichment
  const [npIsVoted, setNpIsVoted] = useState(false);
  const [npVoteCount, setNpVoteCount] = useState(0);
  const [npPayout, setNpPayout] = useState(0);
  const [npBody, setNpBody] = useState('');
  const [npTags, setNpTags] = useState([]);
  const [npMantecurated, setNpMantecurated] = useState(false);

  // Volume (persisted across sessions; player is a singleton so local state is fine)
  const [volume, setVolume] = useState(() => {
    const v = parseFloat(localStorage.getItem('audio-volume'));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
  });
  const [muted, setMuted] = useState(() => localStorage.getItem('audio-muted') === '1');
  const volumeRef = useRef(volume);
  const [volOpen, setVolOpen] = useState(false);
  const [volRect, setVolRect] = useState(null); // button rect for the portal popover
  const volPopRef = useRef(null);

  // Two volume buttons (the bar's, and the expanded area's on narrow screens):
  // the popover opens over whichever was pressed.
  const openVol = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r) setVolRect({ cx: r.left + r.width / 2, top: r.top });
    setVolOpen(o => !o);
  };

  // The player's small menus (speed, sleep timer, effects, share): { name, anchor }.
  const [menu, setMenu] = useState(null);
  const toggleMenu = (name) => (e) => {
    const anchor = e.currentTarget.getBoundingClientRect();
    setMenu(m => (m?.name === name ? null : { name, anchor }));
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  // Playback speed, kept for every track and the next visit.
  const [speed, setSpeed] = useState(readSpeed);
  const speedRef = useRef(speed);

  // Voice boost / skip silence.
  const [fx, setFx] = useState(readEffects);
  const fxOn = fx.boost || fx.skip;
  const fxRef = useRef(fx);
  // Whether the current source can go through Web Audio: true, false, or null
  // while that's being found out.
  const [routeOk, setRouteOk] = useState(null);
  // The browser wouldn't start Web Audio (no gesture yet): effects wait for the next click.
  const [fxBlocked, setFxBlocked] = useState(false);
  const fxBlockedRef = useRef(false);
  const graphRef = useRef(null);
  const skippingRef = useRef(false);
  const [timeSaved, setTimeSaved] = useState(0);

  // Sleep timer: null, { mode: 'minutes', endsAt } or { mode: 'end' }.
  const [sleep, setSleep] = useState(null);
  const sleepRef = useRef(null);
  const [sleepLeft, setSleepLeft] = useState(null); // whole seconds, for the button

  // Chapters of an outside episode.
  const [chapters, setChapters] = useState([]);

  // Casting (Remote Playback API, AirPlay on Safari).
  const [castAvailable, setCastAvailable] = useState(false);

  // Saving for offline.
  const downloads = useDownloads();
  const [dlStarting, setDlStarting] = useState(null);

  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { fxRef.current = fx; }, [fx]);
  useEffect(() => { fxBlockedRef.current = fxBlocked; }, [fxBlocked]);
  useEffect(() => { sleepRef.current = sleep; }, [sleep]);

  // Subtitles
  // Transcript on/off and its language, as last chosen. Kept apart from the watch
  // page's caption language on purpose: that key also switches captions ON there.
  const readTranscriptOn = () => { try { return localStorage.getItem(TRANSCRIPT_ON_KEY) === '1'; } catch { return false; } };
  const readTranscriptLang = () => { try { return localStorage.getItem(TRANSCRIPT_LANG_KEY); } catch { return null; } };
  const [showSubtitles, setShowSubtitlesState] = useState(readTranscriptOn);
  const setShowSubtitles = (on) => {
    setShowSubtitlesState(on);
    try { localStorage.setItem(TRANSCRIPT_ON_KEY, on ? '1' : '0'); } catch { /* storage off */ }
  };
  const [subtitleData, setSubtitleData] = useState(null);
  const [selectedLang, setSelectedLangState] = useState(() => readTranscriptLang() || 'en');
  const setSelectedLang = (lang) => {
    setSelectedLangState(lang);
    try { localStorage.setItem(TRANSCRIPT_LANG_KEY, lang); } catch { /* storage off */ }
  };
  const [subtitleCues, setSubtitleCues] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  // Languages an outside episode's transcript comes in, as the checker reports them.
  const [extTranscriptLangs, setExtTranscriptLangs] = useState(null);
  const activeCueRef = useRef(null);

  // Apply + persist volume/mute. Re-applied on track change since a new src
  // is loaded on the same element (volume sticks, but stay safe), and on a new element.
  useEffect(() => {
    const el = audioRef.current;
    if (el) { el.volume = volume; el.muted = muted; }
    try {
      localStorage.setItem('audio-volume', String(volume));
      localStorage.setItem('audio-muted', muted ? '1' : '0');
    } catch { /* storage may be unavailable */ }
  }, [volume, muted, audioCurrent?._id, audioPlayNonce, elKey]);

  // Close the volume popover on outside click / Escape
  useEffect(() => {
    if (!volOpen) return;
    const onDown = (e) => {
      if (!e.target.closest?.('.audio-np-vol-btn') && !volPopRef.current?.contains(e.target)) setVolOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setVolOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [volOpen]);

  // Ends the sleep timer: the volume the fade took down comes back.
  const endSleep = useCallback(() => {
    const el = audioRef.current;
    if (el) el.volume = volumeRef.current;
    sleepRef.current = null;
    setSleep(null);
    setSleepLeft(null);
  }, []);

  // Wire <audio> element events to slice
  useEffect(() => {
    const el = audioRef.current; if (!el) return;
    // Duration is sourced from the embed-audio Mongo doc (set in the slice
    // when the track is selected) — we deliberately ignore <audio>.duration
    // because VBR MP3s without Xing headers report it incorrectly.
    // Outside podcast episodes remember how far the listener got (lib/podcastProgress.js).
    const live = !!audioCurrent?.live;
    const saveExternal = (pos) => {
      if (!audioCurrent?.external || live) return;
      recordProgress(useAppStore.getState().user, audioCurrent._id, pos, audioCurrent.duration || el.duration);
    };
    // Remembers the spot for the next visit (slice: audioRestoredAt). Not before
    // the metadata is in, or a fresh load at 0 would overwrite the saved spot.
    let posSavedAt = 0;
    const savePosition = (t = el.currentTime) => {
      if (el.readyState < 1 || live) return;
      posSavedAt = Date.now();
      persistAudioPosition(audioCurrent?._id, t);
    };
    const onPageHide = () => savePosition();
    window.addEventListener('pagehide', onPageHide);
    const h = {
      timeupdate: () => {
        audioSetCurrentTime(el.currentTime);
        saveExternal(el.currentTime);
        if (Date.now() - posSavedAt >= 5000) savePosition();
        // A clip (audioPlayAt with an end) stops where it ends.
        const clipEnd = useAppStore.getState().audioClipEnd;
        if (clipEnd != null && el.currentTime >= clipEnd) {
          el.pause();
          useAppStore.getState().audioClearClip();
        }
        // timeupdate only fires while audio is genuinely advancing (not when
        // paused), so it doubles as our "still listening" signal. Beat at
        // most once per interval; the server measures the real gap.
        const L = listenRef.current;
        if (L.sid && !L.credited && Date.now() - L.lastBeatAt >= L.beatMs) {
          beatOnce();
        }
      },
      play: () => {
        audioSetIsPlaying(true);
        notifyMediaPlay('audio');
        if (useAppStore.getState().audioRestoredAt != null) useAppStore.getState().audioClearRestored();
      },
      pause: () => { audioSetIsPlaying(false); savePosition(); if (audioCurrent?.external) flushProgress(); },
      seeked: () => {
        savePosition();
        // Jumping past the end of a clip means listening on: the clip is over.
        const clipEnd = useAppStore.getState().audioClipEnd;
        if (clipEnd != null && el.currentTime > clipEnd + 0.5) useAppStore.getState().audioClearClip();
      },
      ended: () => {
        savePosition(0);
        if (audioCurrent?.external) { saveExternal(audioCurrent.duration || el.duration); flushProgress(); }
        audioSetIsPlaying(false);
        // "Sleep at the end of this episode": stop here, don't start the next one.
        if (sleepRef.current?.mode === 'end') { endSleep(); return; }
        playNext();
      },
      // Outside podcast feeds don't always say how long an episode is; only then
      // does the element's own figure stand in for the stored one.
      loadedmetadata: () => {
        if (audioCurrent?.external && !live && !audioCurrent.duration && Number.isFinite(el.duration) && el.duration > 0) audioSetDuration(el.duration);
      },
    };
    // A swapped-out element's last events are not ours any more.
    const wrapped = Object.fromEntries(Object.entries(h).map(([e, fn]) => [e, (ev) => { if (!retiredEls.has(el)) fn(ev); }]));
    for (const [e, fn] of Object.entries(wrapped)) el.addEventListener(e, fn);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      for (const [e, fn] of Object.entries(wrapped)) el.removeEventListener(e, fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, audioQueue, audioAutoplayList, elKey]);

  // Pause when another media player (video/short) takes over
  useEffect(() => {
    return onMediaPlay('audio', () => {
      const el = audioRef.current;
      if (el && !el.paused) el.pause();
    });
  }, []);

  // External toggle requests (e.g. AudioPost detail page)
  useEffect(() => {
    if (audioToggleNonce === 0) return;
    const el = audioRef.current; if (!el) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
  }, [audioToggleNonce]);

  // External seek requests
  useEffect(() => {
    if (audioSeekNonce === 0) return;
    const el = audioRef.current; if (!el || !Number.isFinite(audioPendingSeek)) return;
    el.currentTime = audioPendingSeek;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSeekNonce]);

  // The chosen speed on the element. defaultPlaybackRate too, because loading a
  // new src resets the rate to it. A live stream always plays at 1×.
  useEffect(() => {
    const el = audioRef.current;
    const r = isLive ? 1 : speed;
    if (el) {
      el.defaultPlaybackRate = r;
      if (!skippingRef.current) el.playbackRate = r;
    }
    try { localStorage.setItem(SPEED_KEY, String(speed)); } catch { /* storage off */ }
  }, [speed, isLive, elKey, audioCurrent?._id]);

  // A live HLS stream through hls.js. A browser that can't do either gets a
  // short note instead of a player that silently does nothing.
  const attachHls = (el, src, id, play) => {
    const unsupported = () => toast.error(t('audio.player.liveUnsupported'));
    import('hls.js').then(({ default: Hls }) => {
      if (audioRef.current !== el || srcRef.current.id !== id) return;
      if (!Hls?.isSupported?.()) { unsupported(); return; }
      const hls = new Hls({ lowLatencyMode: true });
      hlsRef.current = hls;
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data?.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else { dropHls(); unsupported(); }
      });
      hls.loadSource(src);
      hls.attachMedia(el);
      if (play) el.play().catch(() => {});
    }).catch(unsupported);
  };

  // Load src and play when current track changes (or play nonce bumps), and
  // into a new element after a swap. A saved copy plays instead of the network
  // when there is one, which takes a moment to open: the track may change meanwhile.
  useEffect(() => {
    const el = audioRef.current;
    const track = audioCurrent;
    if (!track) { srcRef.current = { id: null, src: null, local: false }; dropHls(); return undefined; }
    if (!el || !(track.audio_cid || track.external)) return undefined;
    let cancelled = false;
    // Outside podcast episodes play straight from the podcast's own host.
    const networkSrc = track.external ? track.src : `${AUDIO_CDN}/${track.audio_cid}`;
    const fresh = srcRef.current.id !== track._id;

    // A saved copy of an episode no longer playing: let its memory go.
    const lu = localUrlRef.current;
    if (lu.url && lu.id !== track._id) {
      try { URL.revokeObjectURL(lu.url); } catch { /* not ours */ }
      localUrlRef.current = { id: null, url: null };
    }

    const run = (src, local) => {
      if (cancelled || audioRef.current !== el) return;
      // A new track: decide first whether it goes through Web Audio, and swap the
      // element before anything loads (the next run, on the new element, loads it).
      if (fresh) {
        const f = fxRef.current;
        const wantFx = (f.boost || f.skip) && !track.live && !fxBlockedRef.current && webAudioSupported();
        const want = wantFx && corsKnown(src, { storage: lsStorage(), origin: window.location.origin }) === true;
        if (want !== routedRef.current) {
          handoverRef.current = null;
          retiredEls.add(el);
          try { el.pause(); } catch { /* gone */ }
          routedRef.current = want;
          setRouted(want);
          return;
        }
      }
      // Back from the last visit: load it paused at the saved spot, the listener
      // presses play. The flag stays until real playback starts (play handler), so
      // a second run of this effect (StrictMode, re-render) can't start it either.
      const { audioRestoredAt, audioStartAt } = useAppStore.getState();
      const restoring = audioRestoredAt != null;
      let play = !restoring;
      if (fresh || !el.getAttribute('src')) {
        const ho = handoverRef.current;
        handoverRef.current = null;
        let startAt = 0;
        if (!fresh && ho && ho.id === track._id) {
          // The same track on a new element: on from where the old one was.
          startAt = ho.t;
          play = ho.playing;
        } else {
          // A link to a moment (audioPlayAt), else back from the last visit, else an
          // outside episode started before picks up where it was left.
          startAt = audioStartAt != null ? audioStartAt
            : restoring && audioRestoredAt > 0 ? audioRestoredAt
              : track.external && !track.live ? resumePosition(useAppStore.getState().user, track._id) : 0;
        }
        if (fresh) {
          // The next track opens the way the viewer left the transcript. It only shows
          // once that track's subtitles have loaded, so a track without any is unaffected.
          setShowSubtitlesState(readTranscriptOn());
          setSubtitleData(null);
          setSubtitleCues([]);
          setExtTranscriptLangs(null);
        }
        srcRef.current = { id: track._id, src, local };
        setPlayingLocal(local);
        setLoadedSrc(src);
        dropHls();
        if (track.live && isHlsTrack(track) && !el.canPlayType('application/vnd.apple.mpegurl')) {
          // Safari plays HLS in <audio> natively; elsewhere hls.js does (the app
          // already ships it for the video players), loaded only when needed.
          attachHls(el, src, track._id, play);
          return;
        }
        el.src = src;
        el.defaultPlaybackRate = track.live ? 1 : speedRef.current;
        el.playbackRate = el.defaultPlaybackRate;
        pendingStartRef.current = startAt || null;
        if (startAt) {
          el.addEventListener('loadedmetadata', () => {
            el.currentTime = startAt;
            pendingStartRef.current = null;
          }, { once: true });
        }
      } else if (audioStartAt != null) {
        // Already loaded (a link to a moment of the track that's playing): just go there.
        if (el.readyState >= 1) el.currentTime = audioStartAt;
        else el.addEventListener('loadedmetadata', () => { el.currentTime = audioStartAt; }, { once: true });
      }
      if (audioStartAt != null) useAppStore.setState({ audioStartAt: null });
      if (play) el.play().catch(() => {});
    };

    // A private feed's episode comes through the checker, which holds its password.
    const privateUrl = track.external && track.private && !track.live && typeof podcastsLib.privateAudioUrl === 'function'
      ? () => Promise.resolve().then(() => podcastsLib.privateAudioUrl(track._id)).catch(() => null)
      : null;
    const stillCurrent = () => !cancelled && useAppStore.getState().audioCurrent?._id === track._id;

    const lu2 = localUrlRef.current;
    if (lu2.id === track._id && lu2.url) run(lu2.url, true);
    else if (!fresh && srcRef.current.id === track._id && srcRef.current.src && privateUrl) {
      // Same private episode on a new element: the URL already fetched still works.
      run(srcRef.current.src, false);
    }
    else if (!track.live && isDownloaded(track._id)) {
      localAudioUrl(track._id)
        .catch(() => null)
        .then((url) => {
          if (cancelled || useAppStore.getState().audioCurrent?._id !== track._id) {
            if (url && localUrlRef.current.url !== url) { try { URL.revokeObjectURL(url); } catch { /* not ours */ } }
            return;
          }
          if (url) { localUrlRef.current = { id: track._id, url }; run(url, true); return; }
          if (privateUrl) privateUrl().then((u) => { if (stillCurrent()) run(u || networkSrc, false); });
          else run(networkSrc, false);
        });
    } else if (privateUrl) {
      privateUrl().then((u) => { if (stillCurrent()) run(u || networkSrc, false); });
    } else run(networkSrc, false);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, audioPlayNonce, elKey]);

  // Gateway failover: on a media error, retry the same CID on the next host.
  // A saved copy that won't play falls back to the network, and an outside
  // host that broke on the routed element goes back to a plain one.
  useEffect(() => {
    const el = audioRef.current; const track = audioCurrent;
    if (!el || !track) return;
    const cid = track.audio_cid;
    const onError = () => {
      if (retiredEls.has(el)) return;
      const pos = el.currentTime;
      const wasPlaying = !el.paused;
      const cur = srcRef.current;
      if (cur.id === track._id && cur.local) {
        const net = track.external ? track.src : `${AUDIO_GATEWAYS[0]}/${cid}`;
        srcRef.current = { id: track._id, src: net, local: false };
        try { URL.revokeObjectURL(cur.src); } catch { /* not ours */ }
        localUrlRef.current = { id: null, url: null };
        setPlayingLocal(false);
        el.src = net;
        if (pos) el.addEventListener('loadedmetadata', () => { el.currentTime = pos; }, { once: true });
        el.play().catch(() => {});
        return;
      }
      if (track.external && routedRef.current) {
        markNoCors(cur.src || track.src);
        setRouteOk(false);
        handoverRef.current = { id: track._id, t: pos || pendingStartRef.current || 0, playing: wasPlaying };
        retiredEls.add(el);
        routedRef.current = false;
        setRouted(false);
        return;
      }
      if (!cid) return;
      const i = AUDIO_GATEWAYS.findIndex(g => el.src === `${g}/${cid}`);
      if (i < 0 || i + 1 >= AUDIO_GATEWAYS.length) return;
      el.src = `${AUDIO_GATEWAYS[i + 1]}/${cid}`;
      if (pos) el.currentTime = pos;
      if (wasPlaying) el.play().catch(() => {});
    };
    el.addEventListener('error', onError);
    return () => el.removeEventListener('error', onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, audioCurrent?.audio_cid, elKey]);

  // Effects switched on (or a new track) while the plain element plays: find
  // out whether the source allows CORS, and swap to a routed element if so.
  useEffect(() => {
    const track = audioCurrent;
    if (!fxOn || !track) { setRouteOk(null); return undefined; }
    if (track.live || fxBlocked || !webAudioSupported()) { setRouteOk(false); return undefined; }
    if (routed) { setRouteOk(true); return undefined; }
    const src = srcRef.current.id === track._id ? srcRef.current.src : null;
    if (!src) return undefined; // the load effect hasn't picked the source yet
    const known = corsKnown(src, { storage: lsStorage(), origin: window.location.origin });
    setRouteOk(known);
    if (known === true) { switchElement(true); return undefined; }
    if (known === false) return undefined;
    let gone = false;
    canRoute(src).then((ok) => {
      if (gone || srcRef.current.src !== src) return;
      setRouteOk(ok);
      if (ok && (fxRef.current.boost || fxRef.current.skip)) switchElement(true);
    });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fxOn, fxBlocked, routed, audioCurrent?._id, loadedSrc]);

  // The routed element joins the Web Audio graph. The browser only lets audio
  // start after a click: if the context still isn't running shortly after play,
  // the routed element would be silent, so playback goes back to a plain one.
  useEffect(() => {
    if (!routed) { graphRef.current = null; return undefined; }
    const el = audioRef.current;
    if (!el) return undefined;
    const g = attach(el);
    graphRef.current = g;
    if (!g) { setFxBlocked(true); return undefined; }
    g.setBoost(fxRef.current.boost);
    let check = null;
    const onPlay = () => {
      g.resume();
      clearTimeout(check);
      check = setTimeout(() => {
        if (audioRef.current === el && !el.paused && g.state !== 'running') {
          fxBlockedRef.current = true;
          setFxBlocked(true);
          switchElement(false);
        }
      }, 1500);
    };
    el.addEventListener('play', onPlay);
    if (!el.paused) onPlay();
    return () => {
      el.removeEventListener('play', onPlay);
      clearTimeout(check);
      detach(el);
      if (graphRef.current === g) graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routed, elKey]);

  useEffect(() => { graphRef.current?.setBoost(fx.boost); }, [fx.boost, elKey]);

  // Skip silence: the analyser watches the level; through a pause the element
  // runs faster (playerMath.js createSilenceDetector), then back to the chosen speed.
  useEffect(() => {
    if (!fx.skip || !routed || !audioIsPlaying || isLive) return undefined;
    const g = graphRef.current;
    const el = audioRef.current;
    if (!g || !el) return undefined;
    const det = createSilenceDetector();
    let last = performance.now();
    let saved = 0;
    let shownAt = last;
    const flush = () => { if (saved) { const add = saved; saved = 0; setTimeSaved(v => v + add); } };
    const setRushing = (on) => {
      skippingRef.current = on;
      el.playbackRate = on ? skipRate(speedRef.current) : speedRef.current;
    };
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (el.paused || retiredEls.has(el)) return;
      if (skippingRef.current) saved += savedMs(dt, el.playbackRate, speedRef.current);
      // Too quiet to tell (muted, or the sleep timer fading out): play normally.
      const vol = el.muted ? 0 : el.volume;
      const rush = vol < 0.05 ? false : det.update(levelDb(g.samples(), vol), now);
      if (rush !== skippingRef.current) { setRushing(rush); if (!rush) flush(); }
      if (now - shownAt > 1000) { shownAt = now; flush(); }
    }, 50);
    return () => {
      clearInterval(id);
      if (skippingRef.current) setRushing(false);
      flush();
    };
  }, [fx.skip, routed, audioIsPlaying, isLive, elKey]);

  // Sleep timer: counts down, fades the volume out over the last seconds, then
  // pauses and gives the volume back. "End of episode" ends in the ended handler.
  useEffect(() => {
    if (!sleep) return undefined;
    const tick = () => {
      const el = audioRef.current;
      if (!el) return;
      const left = sleepRemainingMs(sleep, {
        now: Date.now(),
        currentTime: el.currentTime,
        duration: useAppStore.getState().audioDuration || el.duration,
        rate: el.playbackRate,
      });
      setSleepLeft(left == null ? null : Math.ceil(left / 1000));
      if (left == null) return;
      if (!el.paused) el.volume = volumeRef.current * sleepFadeFactor(left);
      if (sleep.mode === 'minutes' && left <= 0) { el.pause(); endSleep(); }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [sleep, endSleep, elKey]);

  // Chapters of an outside episode (the checker reads the feed's chapters file).
  useEffect(() => {
    setChapters([]);
    if (!audioCurrent?.external || audioCurrent.live || audioCurrent.chapters !== true) return undefined;
    let cancelled = false;
    fetchChapters(audioCurrent._id, { private: !!audioCurrent.private }).then((list) => { if (!cancelled) setChapters(list); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, audioCurrent?.chapters, audioCurrent?.external, audioCurrent?.live]);

  // Casting: a button only while the browser sees a device. Safari has its own
  // AirPlay picker; the others the Remote Playback API.
  useEffect(() => {
    const el = audioRef.current;
    setCastAvailable(false);
    if (!el) return undefined;
    if (HAS_AIRPLAY && el.webkitShowPlaybackTargetPicker) {
      const on = (e) => setCastAvailable(e.availability === 'available');
      el.addEventListener('webkitplaybacktargetavailabilitychanged', on);
      return () => el.removeEventListener('webkitplaybacktargetavailabilitychanged', on);
    }
    if (!el.remote?.watchAvailability) return undefined;
    let watchId = null;
    let gone = false;
    try {
      el.remote.watchAvailability((a) => { if (!gone) setCastAvailable(!!a); })
        .then((wid) => { if (gone) el.remote.cancelWatchAvailability(wid).catch(() => {}); else watchId = wid; })
        .catch(() => setCastAvailable(false));
    } catch { /* not supported here */ }
    return () => {
      gone = true;
      if (watchId != null) el.remote.cancelWatchAvailability(watchId).catch(() => {});
    };
  }, [elKey, audioCurrent?._id]);

  const castNow = () => {
    const el = audioRef.current; if (!el) return;
    if (el.webkitShowPlaybackTargetPicker) { try { el.webkitShowPlaybackTargetPicker(); } catch { /* closed */ } return; }
    el.remote?.prompt?.().catch(() => {});
  };

  // Open a measured listen session on track change/replay. Only logged-in
  // listeners earn the author a pay-per-listen credit; anonymous playback
  // still works, it just doesn't open a session.
  useEffect(() => {
    const perm = audioCurrent?.permlink;
    listenRef.current = { permlink: perm || null, sid: null, token: null, beatMs: 10000, lastBeatAt: 0, credited: false, encrypted: false };
    // Only pay-per-listen tracks need a session — skip the call entirely
    // for everything else (no play-start, no heartbeats).
    if (!perm || !loggedIn || !user || audioCurrent?.ppl !== true) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.post(`${CHECKER_URL}/audio/play-start`, { permlink: perm, username: user });
        const L = listenRef.current;
        if (cancelled || !data?.sid || !data?.payable || L.permlink !== perm) return;
        L.sid = data.sid;
        L.token = data.token;
        L.encrypted = !!data.encrypted;
        L.beatMs = (data.beatSeconds || 10) * 1000;
        L.lastBeatAt = Date.now(); // first beat one interval from now
      } catch { /* best-effort — never disrupt playback */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?.permlink, audioPlayNonce, loggedIn, user]);

  // Fetch Hive post enrichment
  useEffect(() => {
    if (!audioCurrent?.post_permlink) {
      setNpIsVoted(false); setNpVoteCount(0); setNpPayout(0);
      setNpBody(''); setNpTags([]); setNpMantecurated(false);
      return;
    }
    let cancelled = false;
    getUersContent(audioCurrent.owner, audioCurrent.post_permlink).then(data => {
      if (cancelled || !data) return;
      setNpVoteCount(data.active_votes?.length || 0);
      setNpIsVoted(data.active_votes?.some(v => v.voter === user) || false);
      const payout = parseFloat(data.pending_payout_value || 0) > 0
        ? parseFloat(data.pending_payout_value)
        : parseFloat(data.total_payout_value || 0) + parseFloat(data.curator_payout_value || 0);
      setNpPayout(payout);

      let body = data.body || '';
      body = body.replace(/https?:\/\/audio\.3speak\.tv\/play\?a=[^\s)]+/g, '').trim();
      body = body.replace(/\[Play on 3Speak\]\([^)]*\)/g, '').trim();
      body = body.replace(/<center>\[3Speak\].*<\/center>/gs, '').trim();
      body = body.replace(/---\s*$/gm, '').trim();
      setNpBody(body);

      try {
        const meta = JSON.parse(data.json_metadata || '{}');
        setNpTags(Array.isArray(meta.tags) ? meta.tags.filter(tag => tag && typeof tag === 'string') : []);
        setNpMantecurated(meta.tags?.includes('mantecurated') || false);
      } catch {
        setNpTags([]); setNpMantecurated(false);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [audioCurrent?.post_permlink, audioCurrent?.owner, user]);

  // Subtitles fetch
  useEffect(() => {
    if (!audioCurrent?.permlink) { setSubtitleData(null); setSubtitleCues([]); return; }
    if (audioCurrent.subtitle_languages?.length > 0) {
      axios.get(`${CHECKER_URL}/audio/${audioCurrent.permlink}/subtitles`)
        .then(({ data }) => {
          if (data?.found) {
            setSubtitleData(data.subtitles);
            // The language last picked, if this track has it; otherwise as before. Not
            // saved from here: falling back is not the viewer choosing.
            const langs = Object.keys(data.subtitles?.subtitles || {});
            const want = readTranscriptLang();
            setSelectedLangState((p) => (want && langs.includes(want)
              ? want
              : (langs.includes(p) ? p : langs[0] || 'en')));
          } else setSubtitleData(null);
        })
        .catch(() => setSubtitleData(null));
    } else setSubtitleData(null);
  }, [audioCurrent?.permlink, audioCurrent?.subtitle_languages]);

  useEffect(() => {
    if (!showSubtitles || !subtitleData?.subtitles) return;
    const cid = subtitleData.subtitles[selectedLang];
    if (!cid) { setSubtitleCues([]); return; }
    setLoadingSubs(true);
    axios.get(`${AUDIO_CDN}/${cid}`, { responseType: 'text' })
      .then(({ data }) => setSubtitleCues(parseSRT(data)))
      .catch(() => setSubtitleCues([]))
      .finally(() => setLoadingSubs(false));
  }, [showSubtitles, subtitleData, selectedLang]);

  // Outside episodes: the transcript the feed links, through the checker, in
  // the language picked last when the episode has it.
  const hasExtTranscript = !!audioCurrent?.external && !isLive
    && Array.isArray(audioCurrent.transcripts) && audioCurrent.transcripts.length > 0;
  const extLangsFromTrack = hasExtTranscript
    ? [...new Set(audioCurrent.transcripts.map(x => x?.lang).filter(Boolean))] : [];
  const transcriptLangs = subtitleData?.subtitles ? Object.keys(subtitleData.subtitles)
    : hasExtTranscript ? (extTranscriptLangs?.length ? extTranscriptLangs : extLangsFromTrack) : [];
  const extLang = hasExtTranscript
    ? (transcriptLangs.includes(selectedLang) ? selectedLang : transcriptLangs[0] || '') : '';
  const shownLang = subtitleData?.subtitles ? selectedLang : extLang;
  const hasTranscript = !!subtitleData || hasExtTranscript;

  useEffect(() => {
    if (!showSubtitles || !hasExtTranscript) return undefined;
    let cancelled = false;
    setLoadingSubs(true);
    fetchTranscript(audioCurrent._id, extLang || undefined, { private: !!audioCurrent.private })
      .then((data) => {
        if (cancelled) return;
        setSubtitleCues(Array.isArray(data?.cues) ? data.cues : []);
        if (Array.isArray(data?.languages) && data.languages.length) setExtTranscriptLangs(data.languages);
      })
      .catch(() => { if (!cancelled) setSubtitleCues([]); })
      .finally(() => { if (!cancelled) setLoadingSubs(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSubtitles, hasExtTranscript, audioCurrent?._id, extLang]);

  // Cues of a plain-text transcript (start and end 0) are paragraphs: never the active one.
  const activeCueIdx = subtitleCues.findIndex(c => audioCurrentTime >= c.start && audioCurrentTime < c.end);
  useEffect(() => {
    if (activeCueIdx >= 0 && activeCueRef.current) {
      activeCueRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCueIdx]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current; if (!el) return;
    // From the click itself: some browsers only start Web Audio inside one.
    if (el.paused) graphRef.current?.resume();
    el.paused ? el.play().catch(() => {}) : el.pause();
  }, []);

  const seekTo = useCallback((sec) => {
    const el = audioRef.current;
    if (el && Number.isFinite(sec)) el.currentTime = Math.max(0, sec);
  }, []);

  const skipBy = useCallback((delta) => {
    const el = audioRef.current; if (!el) return;
    const d = useAppStore.getState().audioDuration || el.duration;
    el.currentTime = skipTarget(el.currentTime, delta, d);
  }, []);

  const handleSeek = useCallback((e) => {
    const el = audioRef.current;
    if (!el || !audioDuration || isLive) return;
    el.currentTime = ((e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width) * audioDuration;
  }, [audioDuration, isLive]);

  const playNext = useCallback(() => {
    if (!audioCurrent) return;
    if (audioQueue.length > 0) {
      const i = audioQueue.findIndex(x => x._id === audioCurrent._id);
      if (i >= 0 && i < audioQueue.length - 1) { audioPlay(audioQueue[i + 1]); return; }
      if (i === -1) { audioPlay(audioQueue[0]); return; }
    }
    const i = audioAutoplayList.findIndex(x => x._id === audioCurrent._id);
    if (i >= 0 && i < audioAutoplayList.length - 1) audioPlay(audioAutoplayList[i + 1]);
  }, [audioCurrent, audioQueue, audioAutoplayList, audioPlay]);

  const playPrev = useCallback(() => {
    const el = audioRef.current;
    if (el && el.currentTime > 3 && !audioCurrent?.live) { el.currentTime = 0; return; }
    if (!audioCurrent) return;
    const list = audioQueue.length > 0 ? audioQueue : audioAutoplayList;
    const i = list.findIndex(x => x._id === audioCurrent._id);
    if (i > 0) audioPlay(list[i - 1]);
  }, [audioCurrent, audioQueue, audioAutoplayList, audioPlay]);

  // What the phone's media notification, lock screen, headphones and car show
  // and control (Media Session). Without it Android shows the tab's title and
  // the site icon instead of the track.
  const sessionTitle = audioCurrent ? audioCurrent.title || t('audio.untitled') : '';
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms || typeof window.MediaMetadata !== 'function') return;
    if (!audioCurrent) { ms.metadata = null; return; }
    ms.metadata = new window.MediaMetadata({
      title: sessionTitle,
      artist: trackArtist(audioCurrent),
      album: audioCurrent.external ? '' : '3Speak',
      artwork: sessionArtwork(audioCurrent),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, sessionTitle]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (ms) ms.playbackState = audioIsPlaying ? 'playing' : 'paused';
  }, [audioIsPlaying]);

  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!ms?.setActionHandler) return undefined;
    const el = () => audioRef.current;
    // An action a browser does not know throws; it just goes without that button.
    const set = (action, fn) => { try { ms.setActionHandler(action, fn); } catch { /* unsupported */ } };
    // The same 15 s back / 15 s forward as the player's own buttons. A live
    // stream can't be skipped through.
    const handlers = {
      play: () => { el()?.play().catch(() => {}); },
      pause: () => { el()?.pause(); },
      previoustrack: playPrev,
      nexttrack: playNext,
      seekto: isLive ? null : (d) => { const a = el(); if (a && Number.isFinite(d.seekTime)) a.currentTime = d.seekTime; },
      seekbackward: isLive ? null : () => skipBy(-SKIP_BACK),
      seekforward: isLive ? null : () => skipBy(SKIP_FORWARD),
    };
    for (const [action, fn] of Object.entries(handlers)) set(action, fn);
    return () => { for (const action of Object.keys(handlers)) set(action, null); };
  }, [playNext, playPrev, skipBy, isLive]);

  // The lock screen's timeline: duration, position and the real rate, told
  // again whenever one of them jumps (the system runs the clock in between).
  useEffect(() => {
    const ms = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    const el = audioRef.current;
    if (!ms?.setPositionState || !el || !audioCurrent) return undefined;
    if (isLive) { try { ms.setPositionState(); } catch { /* unsupported */ } return undefined; }
    const update = () => {
      const d = useAppStore.getState().audioDuration || el.duration;
      if (!(Number.isFinite(d) && d > 0)) return;
      try {
        ms.setPositionState({ duration: d, position: Math.min(d, Math.max(0, el.currentTime || 0)), playbackRate: el.playbackRate || 1 });
      } catch { /* a value the browser didn't like */ }
    };
    const events = ['loadedmetadata', 'durationchange', 'ratechange', 'seeked', 'play', 'pause'];
    for (const e of events) el.addEventListener(e, update);
    update();
    return () => { for (const e of events) el.removeEventListener(e, update); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, audioDuration, isLive, elKey]);

  // Publish how far the player's top edge sits above the viewport bottom as
  // --audio-np-clearance, so fixed elements (Feedback FAB) can stay above it.
  // ResizeObserver catches expand/collapse; the var is removed when it closes.
  const npRef = useRef(null);
  const hasNowPlaying = !!audioCurrent || idleBar;
  // On a phone's audio page the player can sit in its own tab (page/Audio.jsx,
  // the Player tab hands us `audioDock`): the same controls, drawn into the page
  // instead of the bar. Only the controls move; the <audio> element stays here,
  // so playback carries on when the tab or the page changes.
  const docked = !!audioDock;
  useEffect(() => {
    const el = npRef.current;
    const root = document.documentElement;
    // Docked, nothing floats over the page, so there is nothing to clear.
    if (!hasNowPlaying || !el || docked) return;
    const update = () => {
      const top = el.getBoundingClientRect().top;
      root.style.setProperty('--audio-np-clearance', `${Math.max(0, Math.round(window.innerHeight - top))}px`);
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--audio-np-clearance');
    };
  }, [hasNowPlaying, docked]);

  // Same for the open queue, which on desktop sits above the player: its top
  // edge goes into --audio-queue-clearance so the Feedback FAB clears it too.
  // offsetHeight, not the rect, so the pop-up animation's offset isn't counted.
  const queuePanelRef = useRef(null);
  useEffect(() => {
    const panel = queuePanelRef.current;
    const root = document.documentElement;
    if (!audioShowQueue || !panel) return;
    const update = () => {
      const below = parseFloat(getComputedStyle(panel).bottom) || 0;
      root.style.setProperty('--audio-queue-clearance', `${Math.round(below + panel.offsetHeight)}px`);
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(panel);
    if (npRef.current) ro?.observe(npRef.current);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--audio-queue-clearance');
    };
  }, [audioShowQueue, hasNowPlaying, docked]);

  const audioEl = (
    <audio
      key={elKey}
      ref={audioRef}
      preload="metadata"
      // Only the routed element asks for CORS: a host without it then still plays on the plain one.
      crossOrigin={routed ? 'anonymous' : undefined}
      style={audioCurrent ? undefined : { display: 'none' }}
    />
  );

  // The queue's list: in the queue window, and unfolded on the Player tab.
  const queueList = audioQueue.length === 0 ? (
              <p className="audio-queue-empty">{t('audio.player.queueEmpty')}</p>
            ) : (
              <ul className="audio-queue-list">{audioQueue.map((item, idx) => (
                <li key={item._id} className={`audio-queue-item${audioCurrent?._id === item._id ? ' current' : ''}`}>
                  <span className="audio-queue-drag"><MdDragIndicator size={16} /></span>
                  <img className="audio-queue-thumb" src={audioThumb(item)} alt="" onError={e => { e.currentTarget.src = item.external ? PODCAST_PLACEHOLDER : fallbackImg; }} />
                  <div className="audio-queue-info" onClick={() => audioPlay(item)}>
                    <span className="audio-queue-title">{item.title || t('audio.untitled')}</span>
                    <span className="audio-queue-author">{item.external ? item.show : `@${item.owner}`} · {item.live ? t('audio.player.live') : fmt(item.duration)}</span>
                  </div>
                  <div className="audio-queue-actions">
                    {idx > 0 && <button onClick={() => audioMoveInQueue(idx, idx - 1)}>↑</button>}
                    {idx < audioQueue.length - 1 && <button onClick={() => audioMoveInQueue(idx, idx + 1)}>↓</button>}
                    <button onClick={() => audioRemoveFromQueue(item._id)}><MdDelete size={16} /></button>
                  </div>
                </li>
              ))}</ul>
            );
  const queueClear = audioQueue.length > 0 && (
    <button className="audio-queue-clear" onClick={audioClearQueue} title={t('audio.player.clearQueue')}>
      <MdDelete size={16} /> {t('audio.player.clearAll')}
    </button>
  );

  const queueOverlay = audioShowQueue && !docked ? (
        <div className="audio-queue-overlay" onClick={() => audioSetShowQueue(false)}>
          <div ref={queuePanelRef} className="audio-queue-panel" onClick={e => e.stopPropagation()}>
            <ModalHeader title={t('audio.player.queue')} onClose={() => audioSetShowQueue(false)}>
              <span className="audio-queue-count">{audioQueue.length}</span>
              {queueClear}
            </ModalHeader>
            {queueList}
          </div>
        </div>
  ) : null;

  if (!audioCurrent) {
    if (!idleBar) return <>{audioEl}{queueOverlay}</>;
    // What was playing when the player was closed comes first, at its spot;
    // without it, the top of the queue.
    const next = audioLast?.track || audioQueue[0];
    const playIdle = () => (audioLast ? audioResumeLast(true) : audioPlay(next, audioQueue));
    const idleLabel = audioLast ? t('audio.player.continueAt', { time: fmt(audioLast.t) }) : t('audio.player.upNext');
    return (
      <>
        {audioEl}
        <div ref={npRef} className="audio-now-playing audio-np-idle">
          <div className="audio-np-content">
            <div className="audio-np-art" onClick={() => audioSetShowQueue(true)}>
              <img className="audio-np-thumb" src={audioThumb(next)} alt="" onError={e => { e.currentTarget.src = next.external ? PODCAST_PLACEHOLDER : fallbackImg; }} />
            </div>
            <div className="audio-np-info" onClick={() => audioSetShowQueue(true)}>
              <span className="audio-np-title"><span className="audio-np-title-text">{next.title || t('audio.untitled')}</span></span>
              <span className="audio-np-subline"><span className="audio-np-author">{idleLabel}</span></span>
            </div>
            <div className="audio-np-controls">
              <button className="audio-np-play-btn" onClick={playIdle} aria-label={idleLabel} title={idleLabel}><MdPlayArrow size={26} /></button>
            </div>
            <button className="audio-np-queue-btn" onClick={() => audioSetShowQueue(v => !v)} title={t('audio.player.queue')} aria-label={t('audio.player.queue')}>
              <MdQueueMusic size={20} />
              <span className="audio-np-queue-badge">{audioQueue.length}</span>
            </button>
            <button className="audio-np-close-btn" onClick={() => { setIdleHidden(true); audioSetShowQueue(false); }} title={t('audio.player.hideIdle')} aria-label={t('audio.player.hideIdle')}><MdClose size={18} /></button>
          </div>
        </div>
        {queueOverlay}
      </>
    );
  }

  const nowPlaying = audioCurrent;
  const portalIfDocked = (node) => (docked ? createPortal(node, audioDock) : node);

  // Only 3Speak audio has a real waveform. Outside podcast episodes (and live
  // streams) get the plain progress bar instead of a made-up one.
  const npWave = isLive || nowPlaying?.external ? null : nowPlaying?.waveform?.[0]?.length ? nowPlaying.waveform[0] : null;

  const markers = chapterMarkers(chapters, audioDuration);
  const curChapter = chapters.length ? chapterAt(chapters, audioCurrentTime) : null;
  const jumps = chapterJumps(chapters, audioCurrentTime);

  // Offline copy.
  const dlId = nowPlaying._id;
  const dlProgress = downloads?.progress?.[dlId];
  const dlSaved = !!(downloads?.items?.some(i => i.id === dlId) || isDownloaded(dlId));
  const dlBusy = !dlSaved && (dlStarting === dlId || Number.isFinite(dlProgress));
  const startDownload = () => {
    if (dlSaved || dlBusy) return;
    const track = nowPlaying;
    setDlStarting(track._id);
    downloadTrack(track)
      .then(() => toast.success(t('audio.player.downloadDone')))
      .catch((err) => {
        // The library's own reasons (lib/podcastDownloads.js err.code); a cancel says nothing.
        if (err?.code === 'cancelled') return;
        const key = DOWNLOAD_ERRORS[err?.code];
        toast.error(key ? t(`audio.podcasts.downloads.errors.${key}`, { defaultValue: t('audio.player.downloadFailed') }) : t('audio.player.downloadFailed'));
      })
      .finally(() => setDlStarting(s => (s === track._id ? null : s)));
  };

  const setEffect = (name, on) => {
    // From the click itself, so the browser lets the audio graph start.
    if (on) warmUp();
    if (on && fxBlocked) { fxBlockedRef.current = false; setFxBlocked(false); }
    setFx((prev) => {
      const next = { ...prev, [name]: on };
      try { localStorage.setItem(EFFECTS_KEY, JSON.stringify(next)); } catch { /* storage off */ }
      return next;
    });
  };
  const fxUnavailable = fxOn && (isLive || fxBlocked || !webAudioSupported() || (!routed && routeOk === false));
  const fxChecking = fxOn && !fxUnavailable && !routed && routeOk == null;

  const sleepLabel = sleep && sleepLeft != null ? fmt(sleepLeft) : null;
  const canShare = !isLive && (nowPlaying.external || nowPlaying.permlink);
  const shareOpen = menu?.name === 'share';

  const shareButton = (size) => canShare && (
    <button
      className={`audio-np-share-btn${shareOpen ? ' active' : ''}`}
      onClick={toggleMenu('share')}
      title={t('common.actions.share')}
      aria-label={t('common.actions.share')}
      aria-haspopup="dialog"
      aria-expanded={shareOpen}
    ><MdShare size={size} /></button>
  );

  const volumeButton = (extraClass = '') => (
    <button
      className={`audio-np-btn audio-np-vol-btn ${extraClass}`.trim()}
      onClick={openVol}
      onDoubleClick={() => setMuted(m => !m)}
      title={t('audio.player.volume')}
      aria-label={t('audio.player.volume')}
    >
      {muted || volume === 0 ? <MdVolumeOff size={20} /> : <MdVolumeUp size={20} />}
    </button>
  );

  // Opening the player on a phone's audio page goes to its Player tab instead of
  // the sheet over the bar.
  const toggleExpanded = () => {
    if (!audioExpanded && audioDockOpener) audioDockOpener();
    else audioSetExpanded(v => !v);
  };
  const showExpanded = audioExpanded || docked;

  const timeOrLive = isLive
    ? <span className="audio-np-live-badge">{t('audio.player.live')}</span>
    : <span className="audio-np-time">{fmt(audioCurrentTime)} / {fmt(audioDuration)}</span>;

  return (
    <>
      {audioEl}

      {portalIfDocked(<div ref={npRef} className={`audio-now-playing${showExpanded ? ' audio-np-expanded' : ''}${docked ? ' audio-np-docked' : ''}${isLive ? ' is-live' : ''}`}>
        <div className={`audio-np-progress${isLive ? ' is-live' : ''}`} onClick={isLive ? undefined : handleSeek}>
          {!isLive && <div className="audio-np-progress-fill" style={{ width: audioDuration ? `${(audioCurrentTime / audioDuration) * 100}%` : '0%' }} />}
          {markers.map((f, i) => <span key={i} className="audio-np-progress-marker" style={{ left: `${f * 100}%` }} aria-hidden="true" />)}
        </div>

        <div className="audio-np-content">
          {/* The cover is a record sleeve: while playing, the record slides out
              from behind it and spins, labelled with the same cover. */}
          <div className={`audio-np-art${audioIsPlaying ? ' is-playing' : ''}`} onClick={toggleExpanded}>
            <span className="audio-np-record" aria-hidden="true">
              <span className="audio-np-record-disc">
                <img className="audio-np-record-label" src={audioThumb(nowPlaying)} alt="" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />
              </span>
            </span>
            <img className="audio-np-thumb" src={audioThumb(nowPlaying)} alt="" onError={e => { e.currentTarget.src = nowPlaying.external ? PODCAST_PLACEHOLDER : fallbackImg; }} />
          </div>
          <div className="audio-np-info" onClick={toggleExpanded}>
            <span
              className={`audio-np-title${pageOf(nowPlaying) ? ' has-post' : ''}`}
              onClick={(e) => {
                if (!pageOf(nowPlaying)) return;
                e.stopPropagation();
                navigate(pageOf(nowPlaying));
                audioSetExpanded(false);
              }}
              title={pageOf(nowPlaying) ? (nowPlaying.external ? t('audio.podcasts.openEpisode') : t('audio.player.openPost')) : ''}
            >
              <span className="audio-np-title-text">{nowPlaying.title || t('audio.untitled')}</span>
              {pageOf(nowPlaying) && (
                <MdOpenInNew className="audio-np-title-icon" size={12} aria-hidden />
              )}
            </span>
            <span className="audio-np-subline">
              {isLive && <span className="audio-np-live-badge">{t('audio.player.live')}</span>}
              {nowPlaying.external
                ? <span className="audio-np-author" onClick={(e) => { e.stopPropagation(); navigate(podcastPath(nowPlaying.show_id)); audioSetExpanded(false); }}>{nowPlaying.show}</span>
                : <span className="audio-np-author" onClick={(e) => { e.stopPropagation(); navigate(`/@${nowPlaying.owner}?tab=audio`); audioSetExpanded(false); }}>@{nowPlaying.owner}</span>}
              {curChapter?.title && <span className="audio-np-chapter-now" title={curChapter.title}>{curChapter.title}</span>}
            </span>
            {audioClipEnd != null && (
              <button
                type="button"
                className="audio-np-clip-chip"
                onClick={(e) => { e.stopPropagation(); audioClearClip(); }}
                title={t('audio.player.clipClear')}
                aria-label={`${t('audio.player.clipEnds', { time: fmt(audioClipEnd) })}. ${t('audio.player.clipClear')}`}
              >
                <span>{t('audio.player.clipEnds', { time: fmt(audioClipEnd) })}</span>
                <MdClose size={12} aria-hidden />
              </button>
            )}
          </div>

          <div className="audio-np-desktop-meta">
            {nowPlaying.post_permlink && <PayoutAmount amount={npPayout} size={11} />}
            {nowPlaying.post_permlink && (
              <UpvoteCount count={npVoteCount} voted={npIsVoted} onClick={() => { if (!loggedIn) return; setVoteTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink }); setShowVoteTooltip(!showVoteTooltip); }} size={11} />
            )}
          </div>

          <div className="audio-np-extras">
            {loggedIn && !nowPlaying.external && <button className="audio-np-playlist-btn" onClick={() => setPlaylistTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink || nowPlaying.permlink, title: nowPlaying.title })} title={t('audio.player.playlist')}><MdPlaylistPlay size={20} /></button>}
            {/* Signed out, the tip window opens on Lightning: no Hive account needed. */}
            {nowPlaying.post_permlink && user !== nowPlaying.owner && <button className="audio-np-tip-btn" onClick={() => setTipTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink })} title={t('audio.post.tip')}><BiDollar size={18} /></button>}
            {nowPlaying.external && canTipEpisode(nowPlaying) && <button className="audio-np-tip-btn" onClick={() => setPodcastTip(nowPlaying)} title={t('audio.podcasts.tip.button')}><BiDollar size={18} /></button>}
            {shareButton(16)}
            {hasTranscript && <button className={`audio-np-sub-btn${showSubtitles ? ' active' : ''}`} onClick={() => setShowSubtitles(!showSubtitles)} title={t('audio.player.transcript')} aria-pressed={showSubtitles}><MdSubtitles size={18} /></button>}
            {timeOrLive}
          </div>

          <div className={`audio-np-controls${isLive ? '' : ' has-skip'}`}>
            <button className="audio-np-btn audio-np-track-btn" onClick={playPrev} aria-label={t('audio.player.previous')} title={t('audio.player.previous')}><MdSkipPrevious size={22} /></button>
            {!isLive && (
              <button className="audio-np-btn audio-np-skip-btn" onClick={() => skipBy(-SKIP_BACK)} aria-label={t('audio.player.skipBack', { seconds: SKIP_BACK })} title={t('audio.player.skipBack', { seconds: SKIP_BACK })}>
                <TbRewindBackward15 size={21} />
              </button>
            )}
            <button className="audio-np-play-btn" onClick={togglePlay} aria-label={audioIsPlaying ? t('common.actions.pause') : t('common.actions.play')}>{audioIsPlaying ? <MdPause size={26} /> : <MdPlayArrow size={26} />}</button>
            {!isLive && (
              <button className="audio-np-btn audio-np-skip-btn" onClick={() => skipBy(SKIP_FORWARD)} aria-label={t('audio.player.skipForward', { seconds: SKIP_FORWARD })} title={t('audio.player.skipForward', { seconds: SKIP_FORWARD })}>
                <TbRewindForward15 size={21} />
              </button>
            )}
            <button className="audio-np-btn audio-np-track-btn" onClick={playNext} aria-label={t('audio.player.next')} title={t('audio.player.next')}><MdSkipNext size={22} /></button>
          </div>
          <div className={`audio-np-volume${volOpen ? ' open' : ''}`}>
            {volumeButton()}
          </div>
          <button className="audio-np-queue-btn" onClick={() => audioSetShowQueue(v => !v)} title={t('audio.player.queue')} aria-label={t('audio.player.queue')}>
            <MdQueueMusic size={20} />
            {audioQueue.length > 0 && <span className="audio-np-queue-badge">{audioQueue.length}</span>}
          </button>
          <button
            className="audio-np-expand-btn"
            onClick={toggleExpanded}
            aria-label={audioExpanded ? t('audio.player.collapse') : t('audio.player.expand')}
            aria-expanded={audioExpanded}
          >
            {audioExpanded ? <MdKeyboardArrowDown size={22} /> : <MdKeyboardArrowUp size={22} />}
          </button>
          <button
            className="audio-np-close-btn"
            onClick={() => {
              const el = audioRef.current;
              if (el) {
                try { el.pause(); el.removeAttribute('src'); el.load(); } catch { /* already empty */ }
              }
              if (sleepRef.current) endSleep();
              audioStop();
            }}
            title={t('audio.player.closePlayer')}
            aria-label={t('audio.player.closePlayer')}
          ><MdClose size={18} /></button>
        </div>

        {showExpanded && (
          <div className="audio-np-expanded-area">
            <div className="audio-np-mobile-extras">
              {nowPlaying.post_permlink && <PayoutAmount amount={npPayout} size={12} />}
              {nowPlaying.post_permlink && (
                <UpvoteCount count={npVoteCount} voted={npIsVoted} onClick={() => { if (!loggedIn) return; setVoteTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink }); setShowVoteTooltip(!showVoteTooltip); }} size={12} />
              )}
              {loggedIn && !nowPlaying.external && <button className="audio-np-playlist-btn" onClick={() => setPlaylistTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink || nowPlaying.permlink, title: nowPlaying.title })} title={t('audio.player.playlist')}><MdPlaylistPlay size={18} /></button>}
              {/* Signed out, the tip window opens on Lightning: no Hive account needed. */}
              {nowPlaying.post_permlink && user !== nowPlaying.owner && <button className="audio-np-tip-btn" onClick={() => setTipTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink })} title={t('audio.post.tip')}><BiDollar size={16} /></button>}
              {nowPlaying.external && canTipEpisode(nowPlaying) && <button className="audio-np-tip-btn" onClick={() => setPodcastTip(nowPlaying)} title={t('audio.podcasts.tip.button')}><BiDollar size={16} /></button>}
              {shareButton(16)}
              {hasTranscript && <button className={`audio-np-sub-btn${showSubtitles ? ' active' : ''}`} onClick={() => setShowSubtitles(!showSubtitles)} title={t('audio.player.transcript')} aria-pressed={showSubtitles}><MdSubtitles size={16} /></button>}
              {timeOrLive}
            </div>

            {/* Playback tools. On a narrow player the previous/next and volume
                buttons that no longer fit in the bar move in here too. */}
            <div className="audio-np-tools">
              <button className="audio-np-tool audio-np-track-btn" onClick={playPrev} aria-label={t('audio.player.previous')} title={t('audio.player.previous')}><MdSkipPrevious size={18} /></button>
              <button className="audio-np-tool audio-np-track-btn" onClick={playNext} aria-label={t('audio.player.next')} title={t('audio.player.next')}><MdSkipNext size={18} /></button>
              {volumeButton('audio-np-tool audio-np-tools-vol')}
              {!isLive && (
                <button
                  className={`audio-np-tool audio-np-speed-btn${speed !== 1 ? ' active' : ''}`}
                  onClick={toggleMenu('speed')}
                  aria-label={t('audio.player.speedValue', { speed: formatSpeed(speed) })}
                  title={t('audio.player.speed')}
                  aria-haspopup="dialog"
                  aria-expanded={menu?.name === 'speed'}
                >{formatSpeed(speed)}</button>
              )}
              <button
                className={`audio-np-tool${sleep ? ' active' : ''}`}
                onClick={toggleMenu('sleep')}
                aria-label={sleepLabel ? t('audio.player.sleepLeft', { time: sleepLabel }) : t('audio.player.sleep')}
                title={t('audio.player.sleep')}
                aria-haspopup="dialog"
                aria-expanded={menu?.name === 'sleep'}
              >
                <MdBedtime size={17} />
                {sleep && <span className="audio-np-tool-label">{sleepLabel || t('audio.player.sleepEndShort')}</span>}
              </button>
              {!isLive && (
                <button
                  className={`audio-np-tool${fxOn ? ' active' : ''}`}
                  onClick={toggleMenu('effects')}
                  aria-label={t('audio.player.effects')}
                  title={t('audio.player.effects')}
                  aria-haspopup="dialog"
                  aria-expanded={menu?.name === 'effects'}
                ><MdGraphicEq size={18} /></button>
              )}
              {castAvailable && !playingLocal && (
                <button className="audio-np-tool" onClick={castNow} aria-label={t('audio.player.cast')} title={t('audio.player.cast')}>
                  {HAS_AIRPLAY ? <MdAirplay size={18} /> : <MdCast size={18} />}
                </button>
              )}
              {!isLive && (
                <button
                  className={`audio-np-tool${dlSaved ? ' active' : ''}`}
                  onClick={startDownload}
                  disabled={dlBusy}
                  aria-label={dlSaved ? t('audio.player.downloaded') : dlBusy ? t('audio.player.downloading', { pct: Math.round((dlProgress || 0) * 100) }) : t('audio.player.download')}
                  title={dlSaved ? t('audio.player.downloaded') : t('audio.player.download')}
                >
                  {dlSaved ? <MdDownloadDone size={18} /> : <MdDownload size={18} />}
                  {dlBusy && <span className="audio-np-tool-label">{Math.round((dlProgress || 0) * 100)}%</span>}
                </button>
              )}
            </div>

            {npWave && (
              <Waveform
                samples={npWave}
                audioRef={audioRef}
                duration={audioDuration}
                markers={markers}
                onSeek={(f) => {
                  const el = audioRef.current;
                  if (el && audioDuration > 0) el.currentTime = f * audioDuration;
                }}
              />
            )}

            {/* On the Player tab the queue is part of the page, unfolded. */}
            {docked && audioQueue.length > 0 && (
              <section className="audio-np-queue-inline" aria-label={t('audio.player.queue')}>
                <div className="audio-np-chapters-head">
                  <span className="audio-transcript-label"><MdQueueMusic size={14} /> {t('audio.player.queue')} <span className="audio-queue-count">{audioQueue.length}</span></span>
                  {queueClear}
                </div>
                {queueList}
              </section>
            )}

            {chapters.length > 0 && (
              <section className="audio-np-chapters" aria-label={t('audio.player.chapters')}>
                <div className="audio-np-chapters-head">
                  <span className="audio-transcript-label"><MdListAlt size={14} /> {t('audio.player.chapters')}</span>
                  <div className="audio-np-chapters-jump">
                    <button className="audio-np-tool" disabled={jumps.prev == null} onClick={() => seekTo(jumps.prev)} aria-label={t('audio.player.prevChapter')} title={t('audio.player.prevChapter')}><MdSkipPrevious size={18} /></button>
                    <button className="audio-np-tool" disabled={jumps.next == null} onClick={() => seekTo(jumps.next)} aria-label={t('audio.player.nextChapter')} title={t('audio.player.nextChapter')}><MdSkipNext size={18} /></button>
                  </div>
                </div>
                {curChapter?.img && (
                  <img
                    key={curChapter.img}
                    className="audio-np-chapter-art"
                    src={curChapter.img}
                    alt={curChapter.title || ''}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={e => { e.currentTarget.style.display = 'none'; }}
                  />
                )}
                {curChapter?.url && /^https?:\/\//i.test(curChapter.url) && (
                  <a className="audio-np-chapter-link" href={curChapter.url} target="_blank" rel="noopener noreferrer nofollow">
                    <MdLink size={14} aria-hidden /> {t('audio.player.chapterLink')}
                  </a>
                )}
                <div className="audio-np-chapter-list">
                  {chapters.map((c, i) => (
                    <button
                      key={`${c.start}-${i}`}
                      type="button"
                      className={`audio-cue${curChapter && i === jumps.index ? ' audio-cue-active' : ''}`}
                      onClick={() => seekTo(c.start)}
                      aria-current={curChapter && i === jumps.index ? 'true' : undefined}
                    >
                      <span className="audio-cue-time">{fmt(c.start)}</span>
                      <span className="audio-cue-text">{c.title}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {!showSubtitles && (
              <>
                {(npTags.length > 0 || npMantecurated) && (
                  <div className="audio-np-tags">
                    {npMantecurated && <span className="audio-np-curated-badge"><img src={mantequillaLogo} alt="" /> {t('audio.player.curated')}</span>}
                    {npTags.filter(tag => tag !== 'mantecurated').slice(0, 8).map(tag => (
                      <span key={tag} className="audio-np-tag" onClick={() => { navigate(`/audio?tag=${encodeURIComponent(tag)}`); audioSetExpanded(false); }}>#{tag}</span>
                    ))}
                  </div>
                )}
                {nowPlaying.post_permlink && (
                  <div className="audio-np-body">
                    <BlogContent author={nowPlaying.owner} permlink={nowPlaying.post_permlink} defaultExpanded />
                  </div>
                )}
                {!nowPlaying.post_permlink && npBody && <div className="audio-np-body">{npBody}</div>}
                {/* The full show notes are on the episode page. */}
                {nowPlaying.external && !isLive && nowPlaying.summary && (
                  <button
                    type="button"
                    className="audio-np-body audio-np-body--link"
                    onClick={() => { navigate(episodePath(nowPlaying._id)); audioSetExpanded(false); }}
                    title={t('audio.podcasts.openEpisode')}
                  >
                    {nowPlaying.summary} <span className="audio-np-more">{t('audio.podcasts.showNotes')} →</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {showSubtitles && (subtitleData?.subtitles || hasExtTranscript) && (
          <div className="audio-transcript-panel">
            <div className="audio-transcript-header">
              <span className="audio-transcript-label"><MdSubtitles size={14} /> {t('audio.player.transcript')}</span>
              <div className="audio-transcript-langs">
                {transcriptLangs.map(l => (
                  <button key={l} className={`audio-lang-btn${shownLang === l ? ' active' : ''}`} onClick={() => setSelectedLang(l)} aria-pressed={shownLang === l}>{l.toUpperCase()}</button>
                ))}
              </div>
            </div>
            {loadingSubs ? (
              <div className="audio-transcript-loading">{t('common.status.loading')}</div>
            ) : subtitleCues.length > 0 ? (
              <div className="audio-transcript-cues">
                {subtitleCues.map((cue, idx) => {
                  // A plain-text transcript has no times: a paragraph, not a seek target.
                  if (!cue.start && !cue.end) {
                    return (
                      <p key={idx} className="audio-cue audio-cue--plain">
                        <span className="audio-cue-text">
                          {cue.speaker && <strong className="audio-cue-speaker">{cue.speaker}: </strong>}
                          {cue.text}
                        </span>
                      </p>
                    );
                  }
                  return (
                    <div key={idx} ref={idx === activeCueIdx ? activeCueRef : null}
                      className={`audio-cue${idx === activeCueIdx ? ' audio-cue-active' : ''}`}
                      onClick={() => { const el = audioRef.current; if (el) { el.currentTime = cue.start; if (el.paused) el.play().catch(() => {}); } }}>
                      <span className="audio-cue-time">{fmt(cue.start)}</span>
                      <span className="audio-cue-text">
                        {cue.speaker && <strong className="audio-cue-speaker">{cue.speaker}: </strong>}
                        {cue.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : <div className="audio-transcript-loading">{t('audio.player.noCues')}</div>}
          </div>
        )}
      </div>)}

      {menu?.name === 'speed' && (
        <PlayerMenu anchor={menu.anchor} title={t('audio.player.speed')} onClose={closeMenu}>
          <div className="audio-pm-options" role="radiogroup" aria-label={t('audio.player.speed')}>
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={speed === s}
                className={`audio-share-option${speed === s ? ' is-active' : ''}`}
                onClick={() => { setSpeed(s); closeMenu(); }}
              >
                <span className="audio-pm-check">{speed === s && <MdCheck size={14} />}</span>
                <span>{formatSpeed(s)}</span>
              </button>
            ))}
          </div>
        </PlayerMenu>
      )}

      {menu?.name === 'sleep' && (
        <PlayerMenu anchor={menu.anchor} title={t('audio.player.sleep')} onClose={closeMenu}>
          {sleepLabel && <p className="audio-pm-note">{t('audio.player.sleepLeft', { time: sleepLabel })}</p>}
          <div className="audio-pm-options" role="radiogroup" aria-label={t('audio.player.sleep')}>
            {SLEEP_OPTIONS.filter(o => !(o === 'end' && isLive)).map((o) => {
              const active = o === 0 ? !sleep : o === 'end' ? sleep?.mode === 'end' : sleep?.mode === 'minutes' && sleep.minutes === o;
              const label = o === 0 ? t('audio.player.sleepOff') : o === 'end' ? t('audio.player.sleepEnd') : t('audio.player.sleepMinutes', { minutes: o });
              return (
                <button
                  key={String(o)}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={`audio-share-option${active ? ' is-active' : ''}`}
                  onClick={() => {
                    if (sleepRef.current) endSleep();
                    const next = startSleepTimer(o, Date.now());
                    sleepRef.current = next;
                    setSleep(next);
                    closeMenu();
                  }}
                >
                  <span className="audio-pm-check">{active && <MdCheck size={14} />}</span>
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </PlayerMenu>
      )}

      {menu?.name === 'effects' && (
        <PlayerMenu anchor={menu.anchor} title={t('audio.player.effects')} onClose={closeMenu}>
          <div className="audio-pm-options">
            {[
              { name: 'boost', label: t('audio.player.voiceBoost'), hint: t('audio.player.voiceBoostHint') },
              { name: 'skip', label: t('audio.player.skipSilence'), hint: t('audio.player.skipSilenceHint') },
            ].map(({ name, label, hint }) => (
              <button
                key={name}
                type="button"
                role="switch"
                aria-checked={fx[name]}
                className={`audio-share-option audio-pm-switch${fx[name] ? ' is-active' : ''}`}
                onClick={() => setEffect(name, !fx[name])}
              >
                <span className="audio-pm-switch-text">
                  <span>{label}</span>
                  <small>{hint}</small>
                </span>
                <span className={`audio-pm-toggle${fx[name] ? ' on' : ''}`} aria-hidden="true" />
              </button>
            ))}
          </div>
          {fxUnavailable && <p className="audio-pm-note">{t('audio.player.effectsUnavailable')}</p>}
          {fxChecking && <p className="audio-pm-note">{t('audio.player.effectsChecking')}</p>}
          {timeSaved >= 1000 && <p className="audio-pm-note">{t('audio.player.timeSaved', { time: fmtSaved(timeSaved) })}</p>}
        </PlayerMenu>
      )}

      {shareOpen && canShare && (
        <PlayerMenu anchor={menu.anchor} title={t('common.actions.share')} onClose={closeMenu}>
          {nowPlaying.external
            ? <EpisodeShareOptions track={nowPlaying} at={audioCurrentTime} duration={audioDuration} onClose={closeMenu} />
            : <AudioShareDropdown item={nowPlaying} onClose={closeMenu} at={audioCurrentTime} duration={audioDuration} bare />}
        </PlayerMenu>
      )}

      {queueOverlay}

      {shareTarget && shareTarget._id !== audioCurrent?._id && (
        <div className="audio-share-overlay" onClick={() => setShareTarget(null)}>
          <div className="audio-share-popup" onClick={e => e.stopPropagation()}>
            <AudioShareDropdown item={shareTarget} onClose={() => setShareTarget(null)} title={t('common.actions.share')} />
          </div>
        </div>
      )}

      {showVoteTooltip && voteTarget && (
        <CommentVoteTooltip
          author={voteTarget.author} permlink={voteTarget.permlink}
          showTooltip={showVoteTooltip} setShowTooltip={setShowVoteTooltip}
          weight={weight} setWeight={setWeight}
          voteValue={voteValue} setVoteValue={setVoteValue}
          accountData={accountData} setAccountData={setAccountData}
          compact onVoteSuccess={() => { setShowVoteTooltip(false); setNpIsVoted(true); setNpVoteCount(c => c + 1); }}
        />
      )}

      {podcastTip && <PodcastTipModal track={podcastTip} onClose={() => setPodcastTip(null)} />}

      {tipTarget && (
        <TipModal
          recipient={tipTarget.author}
          permlink={tipTarget.permlink}
          memoLink={`https://3speak.tv/audio/${tipTarget.author}/${tipTarget.permlink}`}
          isOpen={!!tipTarget}
          onClose={() => setTipTarget(null)}
        />
      )}

      {playlistTarget && (
        <AddToPlaylistModal
          isOpen={!!playlistTarget} onClose={() => setPlaylistTarget(null)}
          author={playlistTarget.author} permlink={playlistTarget.permlink}
          videoTitle={playlistTarget.title}
        />
      )}

      {volOpen && volRect && createPortal(
        <div
          ref={volPopRef}
          className="audio-np-vol-pop"
          style={{ left: volRect.cx, top: volRect.top }}
        >
          <input
            className="audio-np-vol-slider"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              setVolume(v);
              if (v > 0 && muted) setMuted(false);
              if (v === 0) setMuted(true);
            }}
            aria-label={t('audio.player.volume')}
          />
        </div>,
        document.body
      )}
    </>
  );
}

/**
 * Share a 3Speak audio. In the player (`bare`, inside its share menu) it also
 * offers the link at the current time (`at`) and a clip from there.
 */
export function AudioShareDropdown({ item, onClose, title, at, duration, bare }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  const author = item?.owner;
  const threeSpeakUrl = `${window.location.origin}/audio?play=${author}/${item?.permlink}`;
  const audioPlayerUrl = `https://audio.3speak.tv/play?a=${item?.permlink}`;
  const [hivePermlink, setHivePermlink] = useState(item?.post_permlink || null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (hivePermlink || !author || !item?.permlink) return;
    let c = false; setSearching(true);
    axios.post(getHiveUrl(), {
      jsonrpc: '2.0', method: 'bridge.get_account_posts',
      params: { sort: 'posts', account: author, limit: 20 }, id: 1
    }).then(({ data }) => {
      if (c) return;
      const m = data?.result?.find(p => p.body?.includes(item.permlink));
      if (m) setHivePermlink(m.permlink);
    }).catch(() => {}).finally(() => { if (!c) setSearching(false); });
    return () => { c = true; };
  }, [author, item?.permlink, hivePermlink]);

  // Inside the player's menu, that menu handles closing.
  useEffect(() => {
    if (bare) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose, bare]);

  const copy = (text, successMsg) => {
    navigator.clipboard.writeText(text).then(() => {
      import('sonner').then(({ toast }) => toast.success(successMsg));
    }).catch(() => import('sonner').then(({ toast }) => toast.error(t('audio.share.failed'))));
    onClose();
  };

  return (
    <div className={`audio-share-dropdown${bare ? ' is-bare' : ''}`} ref={ref}>
      {title && <ModalHeader className="audio-share-header" title={title} onClose={onClose} />}
      {hivePermlink && <button className="audio-share-option" onClick={() => copy(`https://peakd.com/@${author}/${hivePermlink}`, t('audio.share.copiedPeakd'))}><MdContentCopy size={14} /><span>{t('audio.share.copyPeakd')}</span></button>}
      {searching && !hivePermlink && <span className="audio-share-loading">{t('audio.share.searchingHive')}</span>}
      <button className="audio-share-option" onClick={() => copy(threeSpeakUrl, t('audio.share.copied3speak'))}><MdContentCopy size={14} /><span>{t('audio.share.copy3speak')}</span></button>
      {at != null && <CopyAtOption url={threeSpeakUrl} at={at} onDone={onClose} />}
      <button className="audio-share-option" onClick={() => copy(audioPlayerUrl, t('audio.share.copiedAudioPlayer'))}><MdContentCopy size={14} /><span>{t('audio.share.copyAudioPlayer')}</span></button>
      {at != null && <ClipForm url={threeSpeakUrl} start={Math.floor(at || 0)} duration={duration} onDone={onClose} />}
    </div>
  );
}

export default GlobalAudioPlayer;
