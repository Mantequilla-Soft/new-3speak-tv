import { useEffect, useRef, useState, useCallback } from 'react';
import { getHiveUrl } from '../../utils/hiveNode';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import {
  MdPlayArrow, MdPause, MdSkipNext, MdSkipPrevious,
  MdQueueMusic, MdPlaylistPlay, MdClose, MdDragIndicator, MdDelete,
  MdSubtitles, MdShare, MdContentCopy, MdOpenInNew,
  MdKeyboardArrowUp, MdKeyboardArrowDown,
  MdVolumeUp, MdVolumeOff,
} from 'react-icons/md';
import { useAppStore } from '../../lib/store';
import { CHECKER_URL, LISTEN_BEAT_KEY } from '../../utils/config';
import { isLoggedIn } from '../../hive-api/aioha';
import { getUersContent } from '../../utils/hiveUtils';
import PayoutAmount from '../PayoutAmount/PayoutAmount';
import UpvoteCount from '../UpvoteCount/UpvoteCount';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import AddToPlaylistModal from '../AddToPlaylistModal/AddToPlaylistModal';
import BlogContent from '../playVideo/BlogContent';
import Waveform from './Waveform';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { notifyMediaPlay, onMediaPlay } from '../../utils/mediaCoordinator';
import mantequillaLogo from '../../assets/mantequilla-logo.png';
import '../../page/Audio.scss';
import './GlobalAudioPlayer.scss';

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

function audioThumb(item) {
  if (!item) return fallbackImg;
  const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
  if (!fixed || fixed === fallbackImg || fixed === '/images/speak.jpg') {
    return `/img/u/${item.owner}/avatar/small`;
  }
  return fixed;
}

function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const s = Math.floor(sec);
  if (s >= 3600) return `${Math.floor(s/3600)}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
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
  const {
    audioCurrent, audioQueue, audioAutoplayList,
    audioIsPlaying, audioCurrentTime, audioDuration,
    audioExpanded, audioShowQueue, audioPlayNonce,
    audioToggleNonce, audioSeekNonce, audioPendingSeek,
    audioPlay, audioStop,
    audioSetIsPlaying, audioSetCurrentTime,
    audioSetExpanded, audioSetShowQueue,
    audioRemoveFromQueue, audioMoveInQueue, audioClearQueue,
    authenticated, user,
  } = useAppStore();
  const loggedIn = authenticated && isLoggedIn();
  const navigate = useNavigate();

  const audioRef = useRef(null);

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
  const [volOpen, setVolOpen] = useState(false);
  const [volRect, setVolRect] = useState(null); // button rect for the portal popover
  const volWrapRef = useRef(null);
  const volBtnRef = useRef(null);
  const volPopRef = useRef(null);

  const openVol = () => {
    const r = volBtnRef.current?.getBoundingClientRect();
    if (r) setVolRect({ cx: r.left + r.width / 2, top: r.top });
    setVolOpen(o => !o);
  };

  // Subtitles
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [subtitleData, setSubtitleData] = useState(null);
  const [selectedLang, setSelectedLang] = useState('en');
  const [subtitleCues, setSubtitleCues] = useState([]);
  const [loadingSubs, setLoadingSubs] = useState(false);
  const activeCueRef = useRef(null);

  // Apply + persist volume/mute. Re-applied on track change since a new src
  // is loaded on the same element (volume sticks, but stay safe).
  useEffect(() => {
    const el = audioRef.current;
    if (el) { el.volume = volume; el.muted = muted; }
    try {
      localStorage.setItem('audio-volume', String(volume));
      localStorage.setItem('audio-muted', muted ? '1' : '0');
    } catch { /* storage may be unavailable */ }
  }, [volume, muted, audioCurrent?._id, audioPlayNonce]);

  // Close the volume popover on outside click / Escape
  useEffect(() => {
    if (!volOpen) return;
    const onDown = (e) => {
      if (!volWrapRef.current?.contains(e.target) && !volPopRef.current?.contains(e.target)) setVolOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setVolOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [volOpen]);

  // Wire <audio> element events to slice
  useEffect(() => {
    const el = audioRef.current; if (!el) return;
    // Duration is sourced from the embed-audio Mongo doc (set in the slice
    // when the track is selected) — we deliberately ignore <audio>.duration
    // because VBR MP3s without Xing headers report it incorrectly.
    const h = {
      timeupdate: () => {
        audioSetCurrentTime(el.currentTime);
        // timeupdate only fires while audio is genuinely advancing (not when
        // paused), so it doubles as our "still listening" signal. Beat at
        // most once per interval; the server measures the real gap.
        const L = listenRef.current;
        if (L.sid && !L.credited && Date.now() - L.lastBeatAt >= L.beatMs) {
          beatOnce();
        }
      },
      play: () => { audioSetIsPlaying(true); notifyMediaPlay('audio'); },
      pause: () => audioSetIsPlaying(false),
      ended: () => { audioSetIsPlaying(false); playNext(); },
    };
    for (const [e, fn] of Object.entries(h)) el.addEventListener(e, fn);
    return () => { for (const [e, fn] of Object.entries(h)) el.removeEventListener(e, fn); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, audioQueue, audioAutoplayList]);

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

  // Load src and play when current track changes (or play nonce bumps)
  useEffect(() => {
    const el = audioRef.current; if (!el || !audioCurrent?.audio_cid) return;
    const desired = `${AUDIO_CDN}/${audioCurrent.audio_cid}`;
    if (el.src !== desired) {
      el.src = desired;
      setShowSubtitles(false);
      setSubtitleData(null);
      setSubtitleCues([]);
    }
    el.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioCurrent?._id, audioPlayNonce]);

  // Gateway failover: on a media error, retry the same CID on the next host.
  useEffect(() => {
    const el = audioRef.current; const cid = audioCurrent?.audio_cid;
    if (!el || !cid) return;
    const onError = () => {
      const i = AUDIO_GATEWAYS.findIndex(g => el.src === `${g}/${cid}`);
      if (i < 0 || i + 1 >= AUDIO_GATEWAYS.length) return;
      const t = el.currentTime;
      el.src = `${AUDIO_GATEWAYS[i + 1]}/${cid}`;
      if (t) el.currentTime = t;
      el.play().catch(() => {});
    };
    el.addEventListener('error', onError);
    return () => el.removeEventListener('error', onError);
  }, [audioCurrent?._id, audioCurrent?.audio_cid]);

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
        setNpTags(Array.isArray(meta.tags) ? meta.tags.filter(t => t && typeof t === 'string') : []);
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
            setSelectedLang(p => Object.keys(data.subtitles?.subtitles || {}).includes(p)
              ? p
              : Object.keys(data.subtitles?.subtitles || {})[0] || 'en');
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

  const activeCueIdx = subtitleCues.findIndex(c => audioCurrentTime >= c.start && audioCurrentTime < c.end);
  useEffect(() => {
    if (activeCueIdx >= 0 && activeCueRef.current) {
      activeCueRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCueIdx]);

  const togglePlay = useCallback(() => {
    const el = audioRef.current; if (!el) return;
    el.paused ? el.play().catch(() => {}) : el.pause();
  }, []);

  const handleSeek = useCallback((e) => {
    const el = audioRef.current;
    if (!el || !audioDuration) return;
    el.currentTime = ((e.clientX - e.currentTarget.getBoundingClientRect().left) / e.currentTarget.getBoundingClientRect().width) * audioDuration;
  }, [audioDuration]);

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
    if (el && el.currentTime > 3) { el.currentTime = 0; return; }
    if (!audioCurrent) return;
    const list = audioQueue.length > 0 ? audioQueue : audioAutoplayList;
    const i = list.findIndex(x => x._id === audioCurrent._id);
    if (i > 0) audioPlay(list[i - 1]);
  }, [audioCurrent, audioQueue, audioAutoplayList, audioPlay]);

  if (!audioCurrent) {
    return <audio ref={audioRef} preload="metadata" style={{ display: 'none' }} />;
  }

  const nowPlaying = audioCurrent;

  return (
    <>
      <audio ref={audioRef} preload="metadata" />

      <div className={`audio-now-playing${audioExpanded ? ' audio-np-expanded' : ''}`}>
        <div className="audio-np-progress" onClick={handleSeek}>
          <div className="audio-np-progress-fill" style={{ width: audioDuration ? `${(audioCurrentTime / audioDuration) * 100}%` : '0%' }} />
        </div>

        <div className="audio-np-content">
          <img className="audio-np-thumb" src={audioThumb(nowPlaying)} alt="" onError={e => { e.currentTarget.src = fallbackImg; }} onClick={() => audioSetExpanded(v => !v)} />
          <div className="audio-np-info" onClick={() => audioSetExpanded(v => !v)}>
            <span
              className={`audio-np-title${nowPlaying.post_permlink ? ' has-post' : ''}`}
              onClick={(e) => {
                if (!nowPlaying.post_permlink) return;
                e.stopPropagation();
                navigate(`/audio/${nowPlaying.owner}/${nowPlaying.post_permlink}`);
                audioSetExpanded(false);
              }}
              title={nowPlaying.post_permlink ? 'Open audio post' : ''}
            >
              <span className="audio-np-title-text">{nowPlaying.title || 'Untitled'}</span>
              {nowPlaying.post_permlink && (
                <MdOpenInNew className="audio-np-title-icon" size={12} aria-hidden />
              )}
            </span>
            <span className="audio-np-author" onClick={(e) => { e.stopPropagation(); navigate(`/p/${nowPlaying.owner}?tab=audio`); audioSetExpanded(false); }}>@{nowPlaying.owner}</span>
          </div>

          <div className="audio-np-desktop-meta">
            {nowPlaying.post_permlink && <PayoutAmount amount={npPayout} size={11} />}
            {nowPlaying.post_permlink && (
              <UpvoteCount count={npVoteCount} voted={npIsVoted} onClick={() => { if (!loggedIn) return; setVoteTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink }); setShowVoteTooltip(!showVoteTooltip); }} size={11} />
            )}
          </div>

          <div className="audio-np-extras">
            {loggedIn && <button className="audio-np-playlist-btn" onClick={() => setPlaylistTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink || nowPlaying.permlink, title: nowPlaying.title })} title="Playlist"><MdPlaylistPlay size={20} /></button>}
            <div className="audio-np-share-wrap">
              <button className="audio-np-share-btn" onClick={() => setShareTarget(shareTarget?._id === nowPlaying._id ? null : nowPlaying)} title="Share"><MdShare size={16} /></button>
              {shareTarget?._id === nowPlaying._id && <AudioShareDropdown item={nowPlaying} onClose={() => setShareTarget(null)} />}
            </div>
            {subtitleData && <button className={`audio-np-sub-btn${showSubtitles ? ' active' : ''}`} onClick={() => setShowSubtitles(!showSubtitles)} title="Transcript"><MdSubtitles size={18} /></button>}
            <span className="audio-np-time">{fmt(audioCurrentTime)} / {fmt(audioDuration)}</span>
          </div>

          <div className="audio-np-controls">
            <button className="audio-np-btn" onClick={playPrev}><MdSkipPrevious size={22} /></button>
            <button className="audio-np-play-btn" onClick={togglePlay}>{audioIsPlaying ? <MdPause size={26} /> : <MdPlayArrow size={26} />}</button>
            <button className="audio-np-btn" onClick={playNext}><MdSkipNext size={22} /></button>
          </div>
          <div className={`audio-np-volume${volOpen ? ' open' : ''}`} ref={volWrapRef}>
            <button
              ref={volBtnRef}
              className="audio-np-btn audio-np-vol-btn"
              onClick={openVol}
              onDoubleClick={() => setMuted(m => !m)}
              title="Volume"
            >
              {muted || volume === 0 ? <MdVolumeOff size={20} /> : <MdVolumeUp size={20} />}
            </button>
          </div>
          <button className="audio-np-queue-btn" onClick={() => audioSetShowQueue(v => !v)} title="Queue">
            <MdQueueMusic size={20} />
            {audioQueue.length > 0 && <span className="audio-np-queue-badge">{audioQueue.length}</span>}
          </button>
          <button className="audio-np-expand-btn" onClick={() => audioSetExpanded(v => !v)}>
            {audioExpanded ? <MdKeyboardArrowDown size={22} /> : <MdKeyboardArrowUp size={22} />}
          </button>
          <button
            className="audio-np-close-btn"
            onClick={() => {
              const el = audioRef.current;
              if (el) {
                try { el.pause(); el.removeAttribute('src'); el.load(); } catch {}
              }
              audioStop();
            }}
            title="Close player"
          ><MdClose size={18} /></button>
        </div>

        {audioExpanded && (
          <div className="audio-np-expanded-area">
            <div className="audio-np-mobile-extras">
              {nowPlaying.post_permlink && <PayoutAmount amount={npPayout} size={12} />}
              {nowPlaying.post_permlink && (
                <UpvoteCount count={npVoteCount} voted={npIsVoted} onClick={() => { if (!loggedIn) return; setVoteTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink }); setShowVoteTooltip(!showVoteTooltip); }} size={12} />
              )}
              {loggedIn && <button className="audio-np-playlist-btn" onClick={() => setPlaylistTarget({ author: nowPlaying.owner, permlink: nowPlaying.post_permlink || nowPlaying.permlink, title: nowPlaying.title })} title="Playlist"><MdPlaylistPlay size={18} /></button>}
              <div className="audio-np-share-wrap">
                <button className="audio-np-share-btn" onClick={() => setShareTarget(shareTarget?._id === nowPlaying._id ? null : nowPlaying)} title="Share"><MdShare size={16} /></button>
                {shareTarget?._id === nowPlaying._id && <AudioShareDropdown item={nowPlaying} onClose={() => setShareTarget(null)} />}
              </div>
              {subtitleData && <button className={`audio-np-sub-btn${showSubtitles ? ' active' : ''}`} onClick={() => setShowSubtitles(!showSubtitles)} title="Transcript"><MdSubtitles size={16} /></button>}
              <span className="audio-np-time">{fmt(audioCurrentTime)} / {fmt(audioDuration)}</span>
            </div>

            {Array.isArray(nowPlaying.waveform?.[0]) && nowPlaying.waveform[0].length > 0 && (
              <Waveform
                samples={nowPlaying.waveform[0]}
                audioRef={audioRef}
                duration={audioDuration}
                onSeek={(f) => {
                  const el = audioRef.current;
                  if (el && audioDuration > 0) el.currentTime = f * audioDuration;
                }}
              />
            )}

            {!showSubtitles && (
              <>
                {(npTags.length > 0 || npMantecurated) && (
                  <div className="audio-np-tags">
                    {npMantecurated && <span className="audio-np-curated-badge"><img src={mantequillaLogo} alt="" /> Curated</span>}
                    {npTags.filter(t => t !== 'mantecurated').slice(0, 8).map(t => (
                      <span key={t} className="audio-np-tag" onClick={() => { navigate(`/audio?tag=${encodeURIComponent(t)}`); audioSetExpanded(false); }}>#{t}</span>
                    ))}
                  </div>
                )}
                {nowPlaying.post_permlink && (
                  <div className="audio-np-body">
                    <BlogContent author={nowPlaying.owner} permlink={nowPlaying.post_permlink} defaultExpanded />
                  </div>
                )}
                {!nowPlaying.post_permlink && npBody && <div className="audio-np-body">{npBody}</div>}
              </>
            )}
          </div>
        )}

        {showSubtitles && subtitleData?.subtitles && (
          <div className="audio-transcript-panel">
            <div className="audio-transcript-header">
              <span className="audio-transcript-label"><MdSubtitles size={14} /> Transcript</span>
              <div className="audio-transcript-langs">
                {Object.keys(subtitleData.subtitles).map(l => (
                  <button key={l} className={`audio-lang-btn${selectedLang === l ? ' active' : ''}`} onClick={() => setSelectedLang(l)}>{l.toUpperCase()}</button>
                ))}
              </div>
            </div>
            {loadingSubs ? (
              <div className="audio-transcript-loading">Loading…</div>
            ) : subtitleCues.length > 0 ? (
              <div className="audio-transcript-cues">
                {subtitleCues.map((cue, idx) => (
                  <div key={idx} ref={idx === activeCueIdx ? activeCueRef : null}
                    className={`audio-cue${idx === activeCueIdx ? ' audio-cue-active' : ''}`}
                    onClick={() => { const el = audioRef.current; if (el) { el.currentTime = cue.start; if (el.paused) el.play().catch(() => {}); } }}>
                    <span className="audio-cue-time">{fmt(cue.start)}</span>
                    <span className="audio-cue-text">{cue.text}</span>
                  </div>
                ))}
              </div>
            ) : <div className="audio-transcript-loading">No cues.</div>}
          </div>
        )}
      </div>

      {audioShowQueue && (
        <div className="audio-queue-overlay" onClick={() => audioSetShowQueue(false)}>
          <div className="audio-queue-panel" onClick={e => e.stopPropagation()}>
            <div className="audio-queue-header">
              <h3>Queue <span className="audio-queue-count">{audioQueue.length}</span></h3>
              <div className="audio-queue-header-actions">
                {audioQueue.length > 0 && (
                  <button className="audio-queue-clear" onClick={audioClearQueue} title="Clear queue">
                    <MdDelete size={16} /> Clear all
                  </button>
                )}
                <button className="audio-queue-close" onClick={() => audioSetShowQueue(false)}><MdClose size={20} /></button>
              </div>
            </div>
            {audioQueue.length === 0 ? (
              <p className="audio-queue-empty">Queue is empty.</p>
            ) : (
              <ul className="audio-queue-list">{audioQueue.map((item, idx) => (
                <li key={item._id} className={`audio-queue-item${audioCurrent?._id === item._id ? ' current' : ''}`}>
                  <span className="audio-queue-drag"><MdDragIndicator size={16} /></span>
                  <img className="audio-queue-thumb" src={audioThumb(item)} alt="" onError={e => { e.currentTarget.src = fallbackImg; }} />
                  <div className="audio-queue-info" onClick={() => audioPlay(item)}>
                    <span className="audio-queue-title">{item.title || 'Untitled'}</span>
                    <span className="audio-queue-author">@{item.owner} · {fmt(item.duration)}</span>
                  </div>
                  <div className="audio-queue-actions">
                    {idx > 0 && <button onClick={() => audioMoveInQueue(idx, idx - 1)}>↑</button>}
                    {idx < audioQueue.length - 1 && <button onClick={() => audioMoveInQueue(idx, idx + 1)}>↓</button>}
                    <button onClick={() => audioRemoveFromQueue(item._id)}><MdDelete size={16} /></button>
                  </div>
                </li>
              ))}</ul>
            )}
          </div>
        </div>
      )}

      {shareTarget && shareTarget._id !== audioCurrent?._id && (
        <div className="audio-share-overlay" onClick={() => setShareTarget(null)}>
          <div className="audio-share-popup" onClick={e => e.stopPropagation()}>
            <AudioShareDropdown item={shareTarget} onClose={() => setShareTarget(null)} />
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
            aria-label="Volume"
          />
        </div>,
        document.body
      )}
    </>
  );
}

export function AudioShareDropdown({ item, onClose }) {
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

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const copy = (text, label) => {
    navigator.clipboard.writeText(text).then(() => {
      import('sonner').then(({ toast }) => toast.success(`${label} link copied!`));
    }).catch(() => import('sonner').then(({ toast }) => toast.error('Failed')));
    onClose();
  };

  return (
    <div className="audio-share-dropdown" ref={ref}>
      {hivePermlink && <button className="audio-share-option" onClick={() => copy(`https://peakd.com/@${author}/${hivePermlink}`, 'PeakD')}><MdContentCopy size={14} /><span>Copy PeakD link</span></button>}
      {searching && !hivePermlink && <span className="audio-share-loading">Searching Hive…</span>}
      <button className="audio-share-option" onClick={() => copy(threeSpeakUrl, '3Speak')}><MdContentCopy size={14} /><span>Copy 3Speak link</span></button>
      <button className="audio-share-option" onClick={() => copy(audioPlayerUrl, 'Audio player')}><MdContentCopy size={14} /><span>Copy audio player link</span></button>
    </div>
  );
}

export default GlobalAudioPlayer;
