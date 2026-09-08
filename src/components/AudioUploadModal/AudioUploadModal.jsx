import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MdClose, MdCloudUpload, MdMic, MdStop, MdDelete,
  MdArrowBack, MdArrowForward, MdPlaylistAdd, MdPlaylistAddCheck,
  MdPublic, MdLock, MdCheck, MdAdd,
} from 'react-icons/md';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { KeyTypes } from '@aioha/aioha';
import { useMyPlaylists } from '../../hooks/useMyPlaylists';
import { uploadAudioTo3Speak, getSnapsContainer } from '../../utils/audioUpload';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { broadcastWithAioha, broadcastViaThreespeak, getCurrentProvider, Providers } from '../../hive-api/aioha';
import { hasThreespeakPostingAuth, addThreespeakToPostingAuth } from '../../utils/postingAuthority';
import { checkPostingRc } from '../../utils/rcCheck';
import { oaEnvelope, threespeakAudio, OA_ARTICLE, OA_MICROPOST, OA_COMMENT } from '../../utils/openAttribute';
import RcInsufficientModal from '../embed-studio/RcInsufficientModal';
import CommunityModal from '../modal/Community_modal';
import Beneficiary_modal from '../modal/Beneficiary_modal';
import { useAppStore } from '../../lib/store';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { enforceLockedBeneficiaries } from '../../utils/beneficiaries';
import { PPL_BENEFICIARY, ENABLE_PPL, CHECKER_URL, CHECKER_API_KEY } from '../../utils/config';
import './AudioUploadModal.scss';

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

// Hive post conventions: mirror snapie — comments under the latest peak.snaps container.
const HIVE_APP_NAME = 'new-3speak-tv';
const HIVE_DEFAULT_TAGS = ['audio', 'three-speak', 'mantequilla'];

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function generatePermlink(title) {
  const slug = slugify(title) || 'audio';
  return `${slug}-${Date.now().toString(36)}`;
}

// The wizard's step sequence depends on the publish mode. `step` is an
// index into the active flow (not a fixed number) so the same Back/Next
// machinery works for every mode.
const STEP_LABELS = {
  source: 'Source',
  mode: 'Mode',
  playlist: 'Playlist',
  post: 'Post',
  mainpost: 'Main post',
  tracks: 'Tracks',
  review: 'Review',
};
const FLOWS = {
  // each audio → a reply under the latest peak.snaps container
  snaps: ['source', 'mode', 'playlist', 'tracks', 'review'],
  // exactly one audio → its own top-level Hive post (audio embedded)
  single: ['source', 'mode', 'playlist', 'post', 'review'],
  // 2+ audios → one main post (no audio) + each track as a comment reply
  album: ['source', 'mode', 'playlist', 'mainpost', 'tracks', 'review'],
};

const MAX_RECORD_SEC = 300;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|webm|m4a|flac|aac)$/i;

// Spacing between sequential broadcasts so the Hive RPC + audio service
// don't see a burst from a single user (avoids rate-limit / dupe-window issues).
const PUBLISH_DELAY_MS = 3500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// All audio broadcasts (playlist create/update, posts, comments) go out as
// @threespeak for every aioha login — the user granted @threespeak posting
// authority via the gate, so nothing is signed client-side. ButrAuth
// (getCurrentProvider() === null) keeps its own cookie path through
// broadcastWithAioha → broadcastViaManteAuth. All these ops are posting-level
// (comment / comment_options / 3speak_playlist_* custom_json), which the server
// allows on the app-key path.
function broadcastAudioOps(ops) {
  return getCurrentProvider()
    ? broadcastViaThreespeak(ops)
    : broadcastWithAioha(ops, KeyTypes.Posting);
}

// Content type per track (matches the existing 3speak audio categories)
const TRACK_TYPES = [
  { value: 'voice_message', label: 'Voice / Snap' },
  { value: 'song',          label: 'Music' },
  { value: 'podcast',       label: 'Podcast' },
  { value: 'audiobook',     label: 'Audiobook' },
  { value: 'interview',     label: 'Interview' },
];

// Hardcoded suggestions; users can still type any genre into the field.
const MUSIC_GENRES = [
  'Electronic', 'Hip-Hop', 'Rock', 'Pop', 'Jazz', 'Classical', 'Folk',
  'Country', 'Reggae', 'R&B', 'Metal', 'Ambient', 'Funk', 'Soul', 'Blues',
  'Indie', 'Latin', 'World', 'House', 'Techno', 'Drum & Bass', 'Lo-Fi',
];

// Build a `comment_options` op for one permlink, or null if nothing needs
// setting. PPL routes 100% to @threespeak-audio; otherwise /studio-parity
// payout + beneficiaries (non-premium carries the locked threespeakfund split).
function buildCommentOptions(user, permlink, { payout, beneStr, isPremium, ppl }) {
  if (ENABLE_PPL && ppl) {
    return ['comment_options', {
      author: user,
      permlink,
      max_accepted_payout: '1000000.000 HBD',
      percent_hbd: 10000,
      allow_votes: true,
      allow_curation_rewards: true,
      extensions: [[0, { beneficiaries: [{ account: PPL_BENEFICIARY, weight: 10000 }] }]],
    }];
  }
  const beneMap = new Map();
  try {
    for (const b of (JSON.parse(beneStr || '[]') || [])) {
      if (b && b.account && b.weight > 0) beneMap.set(String(b.account), Math.round(b.weight));
    }
  } catch { /* ignore bad json */ }
  enforceLockedBeneficiaries(beneMap, { isPremium });
  const bene = [...beneMap.entries()]
    .map(([account, weight]) => ({ account, weight }))
    .sort((a, b) => a.account.localeCompare(b.account)); // Hive requires sorted
  const decline = payout === 'decline';
  const powerup = payout === 'powerup';
  if (!decline && !powerup && !bene.length) return null;
  return ['comment_options', {
    author: user,
    permlink,
    max_accepted_payout: decline ? '0.000 HBD' : '1000000.000 HBD',
    percent_hbd: powerup ? 0 : 10000,
    allow_votes: true,
    allow_curation_rewards: true,
    extensions: bene.length ? [[0, { beneficiaries: bene }]] : [],
  }];
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function defaultTitleFromFile(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '--:--';
  const s = Math.max(0, Math.floor(sec));
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function probeDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('audio');
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      const d = Number.isFinite(a.duration) ? a.duration : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    a.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    a.src = url;
  });
}

function AudioUploadModal({ isOpen, onClose, initialTrack }) {
  const [step, setStep] = useState(0); // index into the active flow
  const [tracks, setTracks] = useState([]);
  const [playlistChoice, setPlaylistChoice] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  // publishStatus: { [trackId]: { state: 'pending'|'uploading'|'posting'|'success'|'error', message?: string, playUrl?: string } }
  const [publishStatus, setPublishStatus] = useState({});
  const [isPublishing, setIsPublishing] = useState(false);
  // @threespeak posting gate — audio is broadcast by @threespeak, so the user
  // must have granted @threespeak posting authority first (every aioha login;
  // ButrAuth → getCurrentProvider() null → keeps its cookie path, no gate).
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [authorizing, setAuthorizing] = useState(false);
  // RC gate — a Hive post costs Resource Credits, which a low-Hive-Power account
  // may not have. Audio is broadcast by @threespeak, but Hive charges RC to the
  // post author (the user), so we check the user's RC before they do any work.
  const [rcStatus, setRcStatus] = useState(null);
  const [rcChecking, setRcChecking] = useState(true);
  const [rcModalOpen, setRcModalOpen] = useState(false);
  const rcInsufficient = rcStatus ? rcStatus.ok === false : false;
  // 'post'  → keep the normal one-time Hive author payout.
  // 'ppl'   → assign 100% beneficiaries to @threespeak-audio; a separate
  //           program pays the author per listen for the track's lifetime.
  const [rewardMode, setRewardMode] = useState('post');
  // Publish mode:
  //   'snaps'  → each audio = a comment under the latest peak.snaps container
  //   'single' → 1 audio embedded in a standalone Hive post (1 track only)
  //   'album'  → a main post (no audio) + each audio as a comment reply
  const [mode, setMode] = useState('snaps');
  // Keep mode valid for the current track count.
  useEffect(() => {
    setMode((m) => {
      if (tracks.length <= 1) return m === 'album' ? 'single' : m;
      return m === 'single' ? 'album' : m;
    });
  }, [tracks.length]);

  // Main/single-post composer (the standalone post, or the album's parent
  // post). post* fields = this composer; tracks carry their own per-track
  // desc/thumb/payout/beneStr.
  const [community, setCommunity] = useState({ name: 'hive-181335', title: 'Threespeak' });
  const [communityOpen, setCommunityOpen] = useState(false);
  const [mainTitle, setMainTitle] = useState('');
  const [postDescription, setPostDescription] = useState('');
  const [postTagsInput, setPostTagsInput] = useState('');
  const [postThumb, setPostThumb] = useState('');
  const [postPayout, setPostPayout] = useState('default');
  const [postBeneStr, setPostBeneStr] = useState('[]');
  // Shared Beneficiary_modal — `beneTarget` is 'main' or a track id.
  const [beneList, setBeneList] = useState([]);
  const [beneListCount, setBeneListCount] = useState(0);
  const [beneRemaining, setBeneRemaining] = useState(100);
  const [beneOpen, setBeneOpen] = useState(false);
  const [beneTarget, setBeneTarget] = useState('main');
  // 'main' | track id currently uploading a thumbnail, else null.
  const [thumbUploadingId, setThumbUploadingId] = useState(null);
  const thumbInputRef = useRef(null);

  // Hoisted here (above the useCallbacks below) — putting them later would
  // put `isPremium`/`user` in the TDZ when openBeneFor's deps array is built.
  const { user } = useAppStore();
  const isPremium = !!usePremiumStatus(user)?.premium;

  const patchTrack = useCallback((id, patch) => {
    setTracks(prev => prev.map(t => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  // Upload a cover for a target ('main' or a track id) and store the URL.
  const uploadCoverFor = useCallback(async (target, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Pick an image file'); return; }
    setThumbUploadingId(target);
    try {
      const url = await uploadThumbnail(file);
      if (target === 'main') setPostThumb(url);
      else setTracks(prev => prev.map(t => (t.id === target ? { ...t, thumb: url } : t)));
    } catch (err) {
      toast.error(`Thumbnail upload failed: ${err?.message || 'unknown'}`);
    } finally {
      setThumbUploadingId(null);
      if (thumbInputRef.current) thumbInputRef.current.value = '';
    }
  }, []);

  // Apply the main composer's desc/payout/beneficiaries to every track.
  const applyToAllTracks = useCallback(() => {
    setTracks(prev => prev.map(t => ({
      ...t,
      desc: postDescription,
      thumb: postThumb || t.thumb,
      payout: postPayout,
      beneStr: postBeneStr,
    })));
    toast.success('Applied to all tracks');
  }, [postDescription, postThumb, postPayout, postBeneStr]);

  // Open the beneficiary modal for a target; seed its list from that
  // target's stored JSON.
  const openBeneFor = useCallback((target) => {
    const json = target === 'main'
      ? postBeneStr
      : (tracks.find(t => t.id === target)?.beneStr || '[]');
    let list = [];
    try { list = (JSON.parse(json || '[]') || []).map(b => ({ account: b.account, percent: (b.weight || 0) / 100 })); } catch { list = []; }
    const used = list.reduce((s, b) => s + (b.percent || 0), 0);
    setBeneList(list);
    setBeneListCount(list.length);
    setBeneRemaining(Math.max(0, (isPremium ? 100 : 90) - used));
    setBeneTarget(target);
    setBeneOpen(true);
  }, [postBeneStr, tracks, isPremium]);

  // Write the modal's beneficiary JSON back to its target.
  const writeBeneToTarget = useCallback((json) => {
    if (beneTarget === 'main') setPostBeneStr(json);
    else setTracks(prev => prev.map(t => (t.id === beneTarget ? { ...t, beneStr: json } : t)));
  }, [beneTarget]);

  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const recordTimerRef = useRef(null);
  const recordChunksRef = useRef([]);
  const recordStreamRef = useRef(null);
  const objectUrlsRef = useRef(new Set());

  const { data: playlists = [], isLoading: playlistsLoading, refetch: refetchPlaylists } = useMyPlaylists({ limit: 50 });
  const queryClient = useQueryClient();
  // Non-premium standalone posts reserve 10% for the locked threespeakfund
  // split, so the user can only allocate up to 90% to others.
  useEffect(() => {
    if (beneList.length === 0) setBeneRemaining(isPremium ? 100 : 90);
  }, [isPremium, beneList.length]);
  const [pendingPlaylist, setPendingPlaylist] = useState(null); // { id, name, access } shown while waiting for indexer

  const addBlobAsTrack = useCallback(async (blob, filename, source = 'file', overrideType = null) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    const dur = await probeDuration(blob);
    setTracks(prev => [...prev, {
      id: newId(),
      blob,
      filename,
      title: defaultTitleFromFile(filename),
      durationSec: dur,
      objectUrl: url,
      source,
      // Optional metadata captured in the Titles step. Caller may
      // override the auto-derived type — e.g. an OpenPods recording
      // hand-off pre-fills 'podcast'.
      type: overrideType ?? (source === 'record' ? 'voice_message' : 'podcast'),
      genre: '',
      bpm: '',
      // Per-track publish config (snaps + album-post comments).
      desc: '',
      thumb: '',
      payout: 'default',      // default | powerup | decline
      beneStr: '[]',          // JSON beneficiary list
    }]);
  }, []);

  // When an initialTrack lands (e.g. an OpenPods recording handed off
  // from the Hangouts SDK), seed it as the first track on open. The
  // ref guard ensures one initial blob per open cycle even if the
  // parent re-renders mid-flight or the user dismisses then reopens.
  const consumedInitialRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      consumedInitialRef.current = false;
      return;
    }
    if (consumedInitialRef.current) return;
    if (!initialTrack || !initialTrack.blob) return;
    consumedInitialRef.current = true;
    addBlobAsTrack(
      initialTrack.blob,
      initialTrack.filename || 'openpod-recording.ogg',
      'record',
      initialTrack.type ?? null,
    );
  }, [isOpen, initialTrack, addBlobAsTrack]);

  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('audio/') || AUDIO_EXT_RE.test(f.name));
    if (files.length === 0) return;
    for (const f of files) await addBlobAsTrack(f, f.name, 'file');
  }, [addBlobAsTrack]);

  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer?.files);
  };
  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  const removeTrack = (id) => {
    setTracks(prev => {
      const t = prev.find(x => x.id === id);
      if (t?.objectUrl) {
        URL.revokeObjectURL(t.objectUrl);
        objectUrlsRef.current.delete(t.objectUrl);
      }
      return prev.filter(x => x.id !== id);
    });
  };

  const setTitle = (id, title) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, title } : t));
  };

  const stopRecordTimer = () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordStreamRef.current = stream;
      recordChunksRef.current = [];
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data?.size > 0) recordChunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(recordChunksRef.current, { type: 'audio/webm' });
        recordStreamRef.current?.getTracks().forEach(t => t.stop());
        recordStreamRef.current = null;
        const idx = newId().slice(0, 4);
        await addBlobAsTrack(blob, `recording-${idx}.webm`, 'record');
        setIsRecording(false);
        setRecordSec(0);
        stopRecordTimer();
      };
      mr.start();
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordSec(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSec(s => {
          const next = s + 1;
          if (next >= MAX_RECORD_SEC) {
            try { mr.stop(); } catch {}
          }
          return next;
        });
      }, 1000);
    } catch {
      toast.error('Microphone access denied');
    }
  };

  const stopRecording = () => {
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') {
      try { mr.stop(); } catch {}
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecordTimer();
      const mr = mediaRecorderRef.current;
      if (mr && mr.state === 'recording') {
        try { mr.stop(); } catch {}
      }
      recordStreamRef.current?.getTracks().forEach(t => t.stop());
      objectUrlsRef.current.forEach(u => URL.revokeObjectURL(u));
      objectUrlsRef.current.clear();
    };
  }, []);

  // Clear pending placeholder once the new playlist is indexed and visible
  useEffect(() => {
    if (pendingPlaylist && playlists.some(p => p.id === pendingPlaylist.id)) {
      setPendingPlaylist(null);
    }
  }, [pendingPlaylist, playlists]);

  const handleCreatePlaylist = useCallback(async ({ name, access, credits, musicStyle, year, label, description, thumbnail }) => {
    if (!user) { toast.error('Sign in first'); return; }
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Enter a playlist name'); return; }
    const playlistId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    try {
      toast.info(`Creating playlist "${trimmed}"…`);
      // Build the album payload — only include fields with values.
      const album = {};
      if (credits && credits.trim()) album.credits = credits.trim();
      if (musicStyle && musicStyle.trim()) album.musicStyle = musicStyle.trim();
      const yearNum = parseInt(year, 10);
      if (!isNaN(yearNum) && yearNum > 0) album.year = yearNum;
      if (label && label.trim()) album.label = label.trim();
      if (description && description.trim()) album.description = description.trim();
      if (thumbnail && thumbnail.trim()) album.thumbnail = thumbnail.trim();
      const hasAlbumMeta = Object.keys(album).length > 0;
      const extraMeta = hasAlbumMeta ? { album } : null;

      // Build operations for a single broadcast: create, then (if any album
      // metadata was provided) an update that puts thumbnail + metadata on the
      // playlist doc. The indexer's _create handler ignores json_metadata, but
      // its _update handler stores `metadata` and `thumbnail` so they surface
      // through the playlists API.
      const createPayload = {
        name: trimmed,
        access,
        playlist_id: playlistId,
      };
      if (extraMeta) createPayload.json_metadata = JSON.stringify({ type: 'audio', ...extraMeta });

      const ops = [
        ['custom_json', {
          required_auths: [],
          required_posting_auths: [user],
          id: '3speak_playlist_create',
          json: JSON.stringify(createPayload),
        }],
      ];

      if (hasAlbumMeta) {
        const updatePayload = { playlist_id: playlistId };
        if (album.thumbnail) updatePayload.thumbnail = album.thumbnail;
        // Persist the whole album object as `metadata` (indexer stores it as
        // a sub-document and the API surfaces it).
        updatePayload.metadata = { album };
        ops.push(['custom_json', {
          required_auths: [],
          required_posting_auths: [user],
          id: '3speak_playlist_update',
          json: JSON.stringify(updatePayload),
        }]);
      }

      await broadcastAudioOps(ops);
      toast.success('Playlist created');
      setPlaylistChoice(playlistId);
      setPendingPlaylist({ id: playlistId, name: trimmed, access });
      setTimeout(() => {
        refetchPlaylists();
        queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
      }, 3000);
      return true;
    } catch (err) {
      toast.error(`Failed: ${err?.message || 'unknown error'}`);
      return false;
    }
  }, [user, queryClient, refetchPlaylists]);

  const hasUnsavedWork = tracks.length > 0 || isRecording;

  const attemptClose = useCallback(() => {
    if (hasUnsavedWork) {
      setShowCloseConfirm(true);
    } else {
      onClose();
    }
  }, [hasUnsavedWork, onClose]);

  // Esc to close (with confirm guard)
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (showCloseConfirm) setShowCloseConfirm(false);
      else attemptClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, attemptClose, showCloseConfirm]);

  // Check the @threespeak posting-auth grant when the modal opens (aioha logins
  // only; ButrAuth → getCurrentProvider() null → keeps its own cookie path).
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setAuthChecking(true);
    (async () => {
      if (!getCurrentProvider() || !user) {
        if (!cancelled) { setNeedsAuth(false); setAuthChecking(false); }
        return;
      }
      try {
        const ok = await hasThreespeakPostingAuth(user);
        if (!cancelled) setNeedsAuth(!ok);
      } catch {
        if (!cancelled) setNeedsAuth(true); // fail closed — require authorization
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, user]);

  const handleAuthorize = useCallback(async () => {
    setAuthorizing(true);
    // Open the popup synchronously within the click so it isn't blocked; for
    // HiveSigner the account_update2 is signed in this window.
    const signWindow = getCurrentProvider() === Providers.HiveSigner ? window.open('', '_blank') : null;
    try {
      await addThreespeakToPostingAuth(user, { signWindow });
      setNeedsAuth(false);
      toast.success('@threespeak authorized — you can now publish');
    } catch (e) {
      try { signWindow?.close(); } catch { /* ignore */ }
      toast.error(e?.message || 'Authorization failed. Please try again.');
    } finally {
      setAuthorizing(false);
    }
  }, [user]);

  // Check the user's Resource Credits when the modal opens. Runs for every login
  // (including ButrAuth — they're the post author too). Fails OPEN: if RC can't
  // be read we don't block. Auto-opens the explainer modal when too low.
  useEffect(() => {
    if (!isOpen) return undefined;
    let cancelled = false;
    setRcChecking(true);
    (async () => {
      if (!user) {
        if (!cancelled) { setRcStatus({ ok: true, unknown: true }); setRcChecking(false); }
        return;
      }
      try {
        const result = await checkPostingRc(user);
        if (cancelled) return;
        setRcStatus(result);
        if (result.ok === false) setRcModalOpen(true);
      } catch {
        if (!cancelled) setRcStatus({ ok: true, unknown: true }); // fail open
      } finally {
        if (!cancelled) setRcChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isOpen, user]);

  const recheckRc = useCallback(async () => {
    if (!user) return;
    setRcChecking(true);
    try {
      const result = await checkPostingRc(user);
      setRcStatus(result);
      if (result.ok === false) setRcModalOpen(true);
      else setRcModalOpen(false);
    } catch {
      setRcStatus({ ok: true, unknown: true });
    } finally {
      setRcChecking(false);
    }
  }, [user]);

  // ─── Publish helpers (must run on every render — keep above the early return) ───
  // setTrackStatus is referentially stable via setState; we keep it as a plain
  // function (no hook) since it's only used inside other callbacks below.
  const setTrackStatus = (trackId, patch) => {
    setPublishStatus(prev => ({ ...prev, [trackId]: { ...(prev[trackId] || {}), ...patch } }));
  };

  // Cached snap container for the whole modal session — re-used on retry.
  const containerRef = useRef(null);
  const ensureContainer = useCallback(async () => {
    if (containerRef.current) return containerRef.current;
    const c = await getSnapsContainer();
    containerRef.current = c;
    return c;
  }, []);

  // Best-effort: push a chosen cover to the embed-audio Mongo row (the
  // 3Speak audio API takes no thumbnail, so tiles fall back to the avatar).
  const pushAudioThumb = useCallback(async (audioPermlink, thumb) => {
    if (!thumb || !CHECKER_API_KEY) return;
    try {
      await axios.put(
        `${CHECKER_URL}/video/thumbnail`,
        { owner: user, permlink: audioPermlink, thumbnail: thumb },
        { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
      );
    } catch (thumbErr) {
      console.warn('Audio thumbnail Mongo update failed (non-fatal):', thumbErr?.message);
    }
  }, [user]);

  const audioMetaFor = (track) => {
    const audioMeta = { type: track.type || undefined };
    if (track.type === 'song') {
      if (track.genre) audioMeta.genre = String(track.genre).trim();
      const bpmNum = parseInt(track.bpm, 10);
      if (!isNaN(bpmNum) && bpmNum > 0) audioMeta.bpm = bpmNum;
    }
    return audioMeta;
  };

  const playlistAddOp = (permlink) => ([
    'custom_json',
    {
      required_auths: [],
      required_posting_auths: [user],
      id: '3speak_playlist_add',
      json: JSON.stringify({ playlist_id: playlistChoice, author: user, permlink, position: 0 }),
    },
  ]);

  // ── single (standalone post, audio embedded — uses the main composer) ──
  const publishSinglePost = useCallback(async (track) => {
    setTrackStatus(track.id, { state: 'uploading', stage: 'Uploading audio file', message: undefined });
    const { permlink: audioPermlink, playUrl } = await uploadAudioTo3Speak({
      blob: track.blob, durationSec: track.durationSec, username: user, title: track.title,
    });
    setTrackStatus(track.id, { state: 'posting', stage: 'Posting to Hive', playUrl });
    const hivePermlink = generatePermlink(mainTitle || track.title) || audioPermlink;
    const userTags = postTagsInput.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    const tags = userTags.length ? Array.from(new Set(userTags)) : Array.from(new Set(HIVE_DEFAULT_TAGS));
    const desc = (postDescription || '').trim() || (track.title || '').trim();
    const cover = postThumb ? `![${(track.title || 'cover').replace(/[[\]]/g, '')}](${postThumb})\n\n` : '';
    const body = `${cover}${playUrl}\n\n${desc}`.trim();
    // A standalone track is a top-level titled post, so an Article carrying one
    // audio attribute. `threespeak.audio` mirrors the bare `audio` key above it:
    // the bare one is what our own readers already parse, the namespaced one is
    // the version other frontends can look up.
    const audioMeta = audioMetaFor(track);
    const metaObj = {
      app: HIVE_APP_NAME,
      tags,
      audio: audioMeta,
      ...oaEnvelope(OA_ARTICLE),
      ...threespeakAudio({ ...audioMeta, duration: track.durationSec }),
    };
    if (postThumb) metaObj.image = [postThumb];

    const ops = [[
      'comment',
      {
        parent_author: '',
        parent_permlink: (community && community.name) || tags[0],
        author: user,
        permlink: hivePermlink,
        title: (mainTitle || track.title || '').trim() || 'Audio',
        body,
        json_metadata: JSON.stringify(metaObj),
      },
    ]];
    const co = buildCommentOptions(user, hivePermlink, {
      payout: postPayout, beneStr: postBeneStr, isPremium, ppl: rewardMode === 'ppl',
    });
    if (co) ops.push(co);
    if (playlistChoice) ops.push(playlistAddOp(hivePermlink));

    await broadcastAudioOps(ops);
    await pushAudioThumb(audioPermlink, postThumb);
    setTrackStatus(track.id, { state: 'success', stage: undefined });
  }, [user, mainTitle, community, postDescription, postTagsInput, postThumb, postPayout, postBeneStr, isPremium, rewardMode, playlistChoice, pushAudioThumb]);

  // ── album main post (no audio — pure composer landing page) ──
  // Cached so a per-track retry doesn't re-broadcast the parent.
  const albumMainRef = useRef(null);
  const ensureAlbumMain = useCallback(async () => {
    if (albumMainRef.current) return albumMainRef.current;
    const userTags = postTagsInput.split(/[\s,]+/).map(t => t.trim().toLowerCase()).filter(Boolean);
    const tags = userTags.length ? Array.from(new Set(userTags)) : Array.from(new Set(HIVE_DEFAULT_TAGS));
    const hivePermlink = generatePermlink(mainTitle) || `audio-album-${Date.now().toString(36)}`;
    const cover = postThumb ? `![cover](${postThumb})\n\n` : '';
    const body = `${cover}${(postDescription || '').trim()}`.trim() || (mainTitle || 'Audio album');
    // The album's own post carries no audio — the tracks hang off it as replies
    // — so it gets the envelope and no audio attribute.
    const metaObj = { app: HIVE_APP_NAME, tags, ...oaEnvelope(OA_ARTICLE) };
    if (postThumb) metaObj.image = [postThumb];
    const ops = [[
      'comment',
      {
        parent_author: '',
        parent_permlink: (community && community.name) || tags[0],
        author: user,
        permlink: hivePermlink,
        title: (mainTitle || '').trim() || 'Audio album',
        body,
        json_metadata: JSON.stringify(metaObj),
      },
    ]];
    const co = buildCommentOptions(user, hivePermlink, {
      payout: postPayout, beneStr: postBeneStr, isPremium, ppl: false,
    });
    if (co) ops.push(co);
    if (playlistChoice) ops.push(playlistAddOp(hivePermlink));
    await broadcastAudioOps(ops);
    albumMainRef.current = { author: user, permlink: hivePermlink };
    return albumMainRef.current;
  }, [user, mainTitle, community, postDescription, postTagsInput, postThumb, postPayout, postBeneStr, isPremium, playlistChoice]);

  // ── one audio as a comment under `parent` (snaps container OR album main) ──
  // Uses the track's own desc/thumb/payout/beneficiaries.
  const publishTrackComment = useCallback(async (track, parent) => {
    setTrackStatus(track.id, { state: 'uploading', stage: 'Uploading audio file', message: undefined });
    const { permlink: audioPermlink, playUrl } = await uploadAudioTo3Speak({
      blob: track.blob, durationSec: track.durationSec, username: user, title: track.title,
    });
    setTrackStatus(track.id, { state: 'posting', stage: 'Posting to Hive', playUrl });
    const hivePermlink = generatePermlink(track.title) || audioPermlink;
    const tags = Array.from(new Set(HIVE_DEFAULT_TAGS));
    const desc = (track.desc || '').trim() || (track.title || '').trim();
    // Fall back to the main composer cover so a thumbnail set in the main step
    // also lands on snap/voice track comments (json_metadata.image + body + Mongo).
    const tThumb = track.thumb || postThumb || '';
    const cover = tThumb ? `![${(track.title || 'cover').replace(/[[\]]/g, '')}](${tThumb})\n\n` : '';
    const body = `${cover}${playUrl}\n\n${desc}`.trim();
    // Both modes post the track as a reply, but to different parents, and the
    // object follows the parent: an album track replies to our own album post,
    // so it is a Comment; a snap replies to the peak.snaps container, which
    // makes it a MicroPost and keeps it readable in other apps' snap feeds.
    const audioMeta = audioMetaFor(track);
    const metaObj = {
      app: HIVE_APP_NAME,
      tags,
      audio: audioMeta,
      ...oaEnvelope(mode === 'album' ? OA_COMMENT : OA_MICROPOST),
      ...threespeakAudio({ ...audioMeta, duration: track.durationSec }),
    };
    if (tThumb) metaObj.image = [tThumb];

    const ops = [[
      'comment',
      {
        parent_author: parent.author,
        parent_permlink: parent.permlink,
        author: user,
        permlink: hivePermlink,
        // Album track replies keep a title (the album lists them); snap
        // replies stay titleless like the rest of the snaps feed.
        title: mode === 'album' ? ((track.title || '').trim() || 'Track') : '',
        body,
        json_metadata: JSON.stringify(metaObj),
      },
    ]];
    const co = buildCommentOptions(user, hivePermlink, {
      payout: track.payout, beneStr: track.beneStr, isPremium, ppl: rewardMode === 'ppl',
    });
    if (co) ops.push(co);
    if (playlistChoice) ops.push(playlistAddOp(hivePermlink));

    await broadcastAudioOps(ops);
    await pushAudioThumb(audioPermlink, tThumb);
    setTrackStatus(track.id, { state: 'success', stage: undefined });
  }, [user, mode, isPremium, rewardMode, playlistChoice, postThumb, pushAudioThumb]);

  // Resolve the parent a track comment hangs off, per mode.
  const resolveParent = useCallback(async () => {
    if (mode === 'album') return ensureAlbumMain();
    return ensureContainer(); // snaps
  }, [mode, ensureAlbumMain, ensureContainer]);

  // Publish one track honoring the active mode (also used by retry).
  const publishOneTrack = useCallback(async (track, parent) => {
    if (mode === 'single') return publishSinglePost(track);
    return publishTrackComment(track, parent);
  }, [mode, publishSinglePost, publishTrackComment]);

  const retryTrack = useCallback(async (trackId) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    setIsPublishing(true);
    try {
      const parent = mode === 'single' ? null : await resolveParent();
      await publishOneTrack(track, parent);
      if (playlistChoice) queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
    } catch (err) {
      const message = err?.message || (typeof err === 'string' ? err : 'Failed');
      setTrackStatus(trackId, { state: 'error', stage: undefined, message });
    } finally {
      setIsPublishing(false);
    }
  }, [tracks, mode, resolveParent, publishOneTrack, playlistChoice, queryClient, user]);

  const retryAllFailed = useCallback(async () => {
    const failed = tracks.filter((t) => publishStatus[t.id]?.state === 'error');
    if (failed.length === 0) return;
    for (let i = 0; i < failed.length; i++) {
      if (i > 0) await sleep(PUBLISH_DELAY_MS); // throttle between tracks
      // eslint-disable-next-line no-await-in-loop
      await retryTrack(failed[i].id);
    }
  }, [tracks, publishStatus, retryTrack]);

  if (!isOpen) return null;

  const allPublished = tracks.length > 0 && tracks.every(t => publishStatus[t.id]?.state === 'success');

  const flow = FLOWS[mode] || FLOWS.snaps;
  const stepKey = flow[Math.min(step, flow.length - 1)];
  const isLastStep = step >= flow.length - 1;
  const canNext = (() => {
    if (stepKey === 'source') return tracks.length > 0 && !isRecording;
    if (stepKey === 'post') return (tracks[0]?.title || mainTitle || '').trim().length > 0;
    if (stepKey === 'mainpost') return (mainTitle || '').trim().length > 0;
    // Album posts must live inside a playlist so the main post + track
    // comments stay grouped as a single album.
    if (stepKey === 'playlist' && mode === 'album') return !!playlistChoice;
    return true; // mode / playlist (snaps/single) / tracks — defaults are valid
  })();

  const goNext = () => setStep(s => Math.min(s + 1, flow.length - 1));
  const goBack = () => setStep(s => Math.max(s - 1, 0));

  const onPublish = async () => {
    if (!user) { toast.error('Sign in first'); return; }
    if (tracks.length === 0) return;
    setIsPublishing(true);

    const initial = {};
    for (const t of tracks) initial[t.id] = { state: 'pending' };
    setPublishStatus(initial);

    // Resolve the shared parent up front (snap container, or broadcast the
    // album's main post first). Single posts are top-level — no parent.
    let parent = null;
    if (mode !== 'single') {
      try {
        parent = await resolveParent();
      } catch (err) {
        setIsPublishing(false);
        const what = mode === 'album' ? 'publish the main post' : 'resolve peak.snaps container';
        toast.error(`Couldn't ${what}: ${err?.message || 'unknown'}`);
        return;
      }
    }

    let allOk = true;
    for (let i = 0; i < tracks.length; i++) {
      if (i > 0) await sleep(PUBLISH_DELAY_MS); // throttle between tracks
      const track = tracks[i];
      try {
        await publishOneTrack(track, parent);
      } catch (err) {
        allOk = false;
        const message = err?.message || (typeof err === 'string' ? err : 'Failed');
        setTrackStatus(track.id, { state: 'error', stage: undefined, message });
      }
    }

    setIsPublishing(false);

    if (allOk) {
      toast.success(`Published ${tracks.length} track${tracks.length !== 1 ? 's' : ''}`);
      queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
      setTimeout(() => onClose(), 1200);
    } else {
      toast.error('Some tracks failed — open the failed track to retry');
    }
  };

  return (
    <div className="audio-upload-overlay" onClick={attemptClose}>
      {/* Shared genre suggestions for both per-track inputs and the album form */}
      <datalist id="audio-upload-genre-options">
        {MUSIC_GENRES.map((g) => <option key={g} value={g} />)}
      </datalist>
      <div className="audio-upload-modal audio-upload-modal-wizard" onClick={e => e.stopPropagation()}>
        <div className="audio-upload-header">
          <h3><MdCloudUpload /> Upload audio</h3>
          <button className="audio-upload-close" onClick={attemptClose} aria-label="Close"><MdClose size={20} /></button>
        </div>

        {(authChecking || rcChecking || needsAuth || rcInsufficient) ? (
          <div className="audio-upload-body">
            <div className="audio-upload-auth-gate">
              {(authChecking || rcChecking) ? (
                <p>Checking…</p>
              ) : needsAuth ? (
                <>
                  <p>To publish audio, allow <strong>@threespeak</strong> to post on your behalf.</p>
                  <button className="audio-upload-btn-primary" onClick={handleAuthorize} disabled={authorizing}>
                    {authorizing ? 'Authorizing…' : 'Authorize @threespeak'}
                  </button>
                </>
              ) : (
                <>
                  <p>Your account doesn&apos;t have enough <strong>Resource Credits</strong> to publish a post right now.</p>
                  <button className="audio-upload-btn-primary" onClick={() => setRcModalOpen(true)}>
                    Why can&apos;t I upload?
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (<>
        <ol className="audio-upload-steps">
          {flow.map((key, i) => (
            <li
              key={key}
              className={`audio-upload-step${step === i ? ' active' : ''}${step > i ? ' done' : ''}`}
            >
              <span className="audio-upload-step-num">{step > i ? <MdCheck size={14} /> : i + 1}</span>
              <span className="audio-upload-step-label">{STEP_LABELS[key]}</span>
            </li>
          ))}
        </ol>

        <div className="audio-upload-body">
          {stepKey === 'source' && (
            <SourceStep
              tracks={tracks}
              isRecording={isRecording}
              recordSec={recordSec}
              isDragging={isDragging}
              fileInputRef={fileInputRef}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onPickFiles={() => fileInputRef.current?.click()}
              onFilesSelected={(e) => { handleFiles(e.target.files); e.target.value = ''; }}
              onStart={startRecording}
              onStop={stopRecording}
              onRemove={removeTrack}
            />
          )}
          {stepKey === 'mode' && (
            <ModeStep
              tracks={tracks}
              mode={mode}
              setMode={setMode}
              rewardMode={rewardMode}
              setRewardMode={setRewardMode}
              isPublishing={isPublishing}
              publishStatus={publishStatus}
            />
          )}
          {stepKey === 'playlist' && (
            <PlaylistStep
              playlists={playlists}
              loading={playlistsLoading}
              choice={playlistChoice}
              onChoose={setPlaylistChoice}
              pendingPlaylist={pendingPlaylist}
              onCreate={handleCreatePlaylist}
              required={mode === 'album'}
            />
          )}
          {(stepKey === 'post' || stepKey === 'mainpost') && (
            <MainPostStep
              variant={stepKey === 'post' ? 'single' : 'album'}
              singleTrack={stepKey === 'post' ? tracks[0] : null}
              patchTrack={patchTrack}
              title={mainTitle}
              setTitle={setMainTitle}
              description={postDescription}
              setDescription={setPostDescription}
              community={community}
              setCommunityOpen={setCommunityOpen}
              tagsInput={postTagsInput}
              setTagsInput={setPostTagsInput}
              thumb={postThumb}
              setThumb={setPostThumb}
              thumbUploading={thumbUploadingId === 'main'}
              thumbRef={thumbInputRef}
              onPickThumb={(file) => uploadCoverFor('main', file)}
              payout={postPayout}
              setPayout={setPostPayout}
              beneCount={beneList.length}
              onOpenBene={() => openBeneFor('main')}
            />
          )}
          {stepKey === 'tracks' && (
            <TracksStep
              tracks={tracks}
              mode={mode}
              patchTrack={patchTrack}
              postDescription={postDescription}
              setPostDescription={setPostDescription}
              postThumb={postThumb}
              setPostThumb={setPostThumb}
              postPayout={postPayout}
              setPostPayout={setPostPayout}
              postBeneCount={beneList.length}
              applyToAllTracks={applyToAllTracks}
              onOpenBene={openBeneFor}
              uploadCoverFor={uploadCoverFor}
              thumbUploadingId={thumbUploadingId}
              thumbRef={thumbInputRef}
            />
          )}
          {stepKey === 'review' && (
            <ReviewStep
              tracks={tracks}
              playlists={playlists}
              playlistChoice={playlistChoice}
              pendingPlaylist={pendingPlaylist}
              publishStatus={publishStatus}
              onRetry={retryTrack}
              onRetryAll={retryAllFailed}
              isPublishing={isPublishing}
              mode={mode}
              rewardMode={rewardMode}
              community={community}
            />
          )}
          {communityOpen && (
            <CommunityModal
              isOpen={communityOpen}
              data={[]}
              close={() => setCommunityOpen(false)}
              setCommunity={setCommunity}
            />
          )}
          {beneOpen && (
            <Beneficiary_modal
              isOpen={beneOpen}
              close={() => setBeneOpen(false)}
              setBeneficiaries={writeBeneToTarget}
              setBeneficiaryList={setBeneListCount}
              setList={setBeneList}
              list={beneList}
              remaingPercent={beneRemaining}
              setRemaingPercent={setBeneRemaining}
              variant="audio"
            />
          )}
        </div>

        <div className="audio-upload-footer">
          {step > 0 ? (
            <button className="audio-upload-btn-secondary" onClick={goBack} disabled={isPublishing}>
              <MdArrowBack size={16} /> Back
            </button>
          ) : <span />}
          {!isLastStep ? (
            <button className="audio-upload-btn-primary" onClick={goNext} disabled={!canNext}>
              Next <MdArrowForward size={16} />
            </button>
          ) : allPublished ? (
            <button
              className="audio-upload-btn-primary"
              onClick={onClose}
            >
              <MdCheck size={16} /> Close
            </button>
          ) : (
            <button
              className="audio-upload-btn-primary"
              onClick={onPublish}
              disabled={isPublishing}
            >
              {isPublishing ? 'Publishing…' : 'Publish'}
            </button>
          )}
        </div>
        </>)}

        {showCloseConfirm && (
          <div className="audio-upload-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="audio-upload-confirm-card">
              <h4>Discard upload?</h4>
              <p>
                You have {tracks.length} track{tracks.length !== 1 ? 's' : ''} added
                {isRecording ? ' and a recording in progress' : ''}. Closing will discard them.
              </p>
              <div className="audio-upload-confirm-actions">
                <button
                  className="audio-upload-btn-secondary"
                  onClick={() => setShowCloseConfirm(false)}
                  autoFocus
                >
                  Keep editing
                </button>
                <button
                  className="audio-upload-btn-primary audio-upload-btn-danger"
                  onClick={() => { setShowCloseConfirm(false); onClose(); }}
                >
                  Discard
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <RcInsufficientModal
        isOpen={rcModalOpen}
        status={rcStatus}
        rechecking={rcChecking}
        onClose={() => setRcModalOpen(false)}
        onRecheck={recheckRc}
      />
    </div>
  );
}

function SourceStep({
  tracks, isRecording, recordSec, isDragging, fileInputRef,
  onDrop, onDragOver, onDragLeave, onPickFiles, onFilesSelected,
  onStart, onStop, onRemove,
}) {
  return (
    <>
      <div className="audio-upload-source-row">
        <div
          className={`audio-upload-dropzone${isDragging ? ' dragging' : ''}`}
          onClick={onPickFiles}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          role="button"
          tabIndex={0}
        >
          <MdCloudUpload size={32} />
          <p>Drop audio files here, or click to browse</p>
          <small>MP3, WAV, OGG, WEBM, M4A, FLAC, AAC — multiple allowed</small>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={onFilesSelected}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className={`audio-upload-recorder${isRecording ? ' recording' : ''}`}>
          {isRecording ? (
            <>
              <div className="audio-upload-rec-dot" />
              <div className="audio-upload-rec-time">{fmtTime(recordSec)}</div>
              <button className="audio-upload-btn-secondary" onClick={onStop}>
                <MdStop size={16} /> Stop
              </button>
            </>
          ) : (
            <>
              <MdMic size={32} />
              <p>Or record live</p>
              <small>Up to {Math.round(MAX_RECORD_SEC / 60)} min per recording</small>
              <button className="audio-upload-btn-primary" onClick={onStart}>
                <MdMic size={16} /> Record
              </button>
            </>
          )}
        </div>
      </div>
      {tracks.length > 0 && (
        <div className="audio-upload-track-list">
          <h4>Added ({tracks.length})</h4>
          {tracks.map(t => (
            <div key={t.id} className="audio-upload-track-row">
              <span className="audio-upload-track-source" title={t.source === 'record' ? 'Recorded' : 'Uploaded'}>
                {t.source === 'record' ? <MdMic size={14} /> : <MdCloudUpload size={14} />}
              </span>
              <span className="audio-upload-track-name">{t.filename}</span>
              <span className="audio-upload-track-meta">{fmtTime(t.durationSec)}</span>
              <button className="audio-upload-track-remove" onClick={() => onRemove(t.id)} aria-label="Remove">
                <MdDelete size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function TitlesStep({ tracks, setTitle, patchTrack, onRemove }) {
  return (
    <div className="audio-upload-titles">
      <p className="audio-upload-step-help">Title each track and pick a type. Music tracks get genre + BPM fields.</p>
      {tracks.map((t, i) => (
        <div key={t.id} className="audio-upload-title-card">
          <div className="audio-upload-title-row">
            <span className="audio-upload-title-num">{i + 1}.</span>
            <input
              type="text"
              className="audio-upload-title-input"
              value={t.title}
              onChange={(e) => setTitle(t.id, e.target.value)}
              placeholder="Track title"
              maxLength={120}
            />
            <select
              className="audio-upload-type-select"
              value={t.type || 'voice_message'}
              onChange={(e) => patchTrack(t.id, { type: e.target.value })}
            >
              {TRACK_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button className="audio-upload-track-remove" onClick={() => onRemove(t.id)} aria-label="Remove">
              <MdDelete size={14} />
            </button>
          </div>
          {t.type === 'song' && (
            <div className="audio-upload-music-row">
              <input
                type="text"
                className="audio-upload-genre-input"
                value={t.genre || ''}
                onChange={(e) => patchTrack(t.id, { genre: e.target.value })}
                placeholder="Genre"
                list="audio-upload-genre-options"
                maxLength={60}
              />
              <input
                type="number"
                className="audio-upload-bpm-input"
                value={t.bpm || ''}
                onChange={(e) => patchTrack(t.id, { bpm: e.target.value })}
                placeholder="BPM"
                min="20"
                max="400"
              />
            </div>
          )}
          <div className="audio-upload-title-meta-line">
            <span>{fmtTime(t.durationSec)} · {t.source === 'record' ? 'Recorded' : t.filename}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaylistStep({ playlists, loading, choice, onChoose, pendingPlaylist, onCreate, required = false }) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAccess, setNewAccess] = useState('public');
  const [newCredits, setNewCredits] = useState('');
  const [newMusicStyle, setNewMusicStyle] = useState('');
  const [newYear, setNewYear] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [thumbnailUploading, setThumbnailUploading] = useState(false);
  const [thumbDragging, setThumbDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const thumbInputRef = useRef(null);

  const showPending = pendingPlaylist && !playlists.some(p => p.id === pendingPlaylist.id);

  const resetForm = () => {
    setShowCreateForm(false);
    setNewName('');
    setNewAccess('public');
    setNewCredits('');
    setNewMusicStyle('');
    setNewYear('');
    setNewLabel('');
    setNewDescription('');
    setThumbnailUrl('');
  };

  const processThumbnailFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Pick an image file');
      return;
    }
    setThumbnailUploading(true);
    try {
      const url = await uploadThumbnail(file);
      setThumbnailUrl(url);
    } catch (err) {
      toast.error(`Thumbnail upload failed: ${err?.message || 'unknown'}`);
    } finally {
      setThumbnailUploading(false);
      if (thumbInputRef.current) thumbInputRef.current.value = '';
    }
  };
  const onThumbnailFile = (e) => processThumbnailFile(e.target.files?.[0]);

  const onThumbnailDrop = (e) => {
    e.preventDefault();
    setThumbDragging(false);
    if (thumbnailUploading) return;
    processThumbnailFile(e.dataTransfer?.files?.[0]);
  };

  const submit = async () => {
    setSubmitting(true);
    const ok = await onCreate({
      name: newName,
      access: newAccess,
      credits: newCredits,
      musicStyle: newMusicStyle,
      year: newYear,
      label: newLabel,
      description: newDescription,
      thumbnail: thumbnailUrl,
    });
    setSubmitting(false);
    if (ok) resetForm();
  };

  return (
    <div className="audio-upload-playlist-step">
      <p className="audio-upload-step-help">
        {required
          ? 'Required — pick or create a playlist. Album posts live inside a playlist so its tracks stay grouped inside of a 3Speak album. This helps exposure and more prominent placement on the audio page.'
          : 'Optional — add all tracks to a playlist.'}
      </p>

      {!required && (
        <button
          className={`audio-upload-playlist-item${choice === null ? ' selected' : ''}`}
          onClick={() => onChoose(null)}
        >
          <span className="audio-upload-playlist-icon"><MdPlaylistAdd size={18} /></span>
          <span className="audio-upload-playlist-name">
            <span>No playlist</span>
            <small>Tracks won't be grouped</small>
          </span>
          {choice === null && <MdCheck size={16} />}
        </button>
      )}

      {showPending && (
        <button
          className={`audio-upload-playlist-item audio-upload-playlist-pending${choice === pendingPlaylist.id ? ' selected' : ''}`}
          onClick={() => onChoose(pendingPlaylist.id)}
        >
          <span className="audio-upload-playlist-icon"><MdPlaylistAddCheck size={18} /></span>
          <span className="audio-upload-playlist-name">
            <span>{pendingPlaylist.name}</span>
            <small>
              {pendingPlaylist.access === 'private' ? <MdLock size={11} /> : <MdPublic size={11} />}{' '}
              creating… (waiting for indexer)
            </small>
          </span>
          {choice === pendingPlaylist.id && <MdCheck size={16} />}
        </button>
      )}

      {loading ? (
        <div className="audio-upload-playlist-loading">Loading playlists…</div>
      ) : playlists.length === 0 && !showPending ? (
        <div className="audio-upload-playlist-empty">You don't have any playlists yet.</div>
      ) : (
        playlists.map(p => (
          <button
            key={p.id}
            className={`audio-upload-playlist-item${choice === p.id ? ' selected' : ''}`}
            onClick={() => onChoose(p.id)}
          >
            <span className="audio-upload-playlist-icon">
              {choice === p.id ? <MdPlaylistAddCheck size={18} /> : <MdPlaylistAdd size={18} />}
            </span>
            <span className="audio-upload-playlist-name">
              <span>{p.name}</span>
              <small>
                {p.access === 'private' ? <MdLock size={11} /> : <MdPublic size={11} />}{' '}
                {p.items?.length || 0} items
              </small>
            </span>
            {choice === p.id && <MdCheck size={16} />}
          </button>
        ))
      )}

      {!showCreateForm ? (
        <button
          type="button"
          className="audio-upload-playlist-create-btn"
          onClick={() => setShowCreateForm(true)}
        >
          <MdAdd size={16} /> New audio playlist
        </button>
      ) : (
        <div className="audio-upload-playlist-form">
          <input
            type="text"
            className="audio-upload-title-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Playlist name"
            maxLength={80}
            autoFocus
          />
          <div className="audio-upload-playlist-privacy">
            <button
              type="button"
              className={`audio-upload-playlist-privacy-btn${newAccess === 'public' ? ' active' : ''}`}
              onClick={() => setNewAccess('public')}
            >
              <MdPublic size={14} /> Public
            </button>
            <button
              type="button"
              className={`audio-upload-playlist-privacy-btn${newAccess === 'private' ? ' active' : ''}`}
              onClick={() => setNewAccess('private')}
            >
              <MdLock size={14} /> Private
            </button>
          </div>
          <input
            type="text"
            className="audio-upload-title-input"
            value={newMusicStyle}
            onChange={(e) => setNewMusicStyle(e.target.value)}
            placeholder="Music style / genre (optional, e.g. Electronic)"
            list="audio-upload-genre-options"
            maxLength={60}
          />

          <div className="audio-upload-album-grid">
            <input
              type="text"
              className="audio-upload-title-input"
              value={newCredits}
              onChange={(e) => setNewCredits(e.target.value)}
              placeholder="Credits (optional)"
              maxLength={200}
            />
            <input
              type="number"
              className="audio-upload-title-input"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              placeholder="Year"
              min="1900"
              max="2100"
            />
            <input
              type="text"
              className="audio-upload-title-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label (optional)"
              maxLength={120}
            />
          </div>

          <textarea
            className="audio-upload-title-input audio-upload-credits-input"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            rows={3}
            maxLength={1000}
          />

          <div
            className={`audio-upload-album-thumb${thumbnailUrl ? ' has-image' : ''}${thumbDragging ? ' dragging' : ''}`}
            onClick={() => !thumbnailUploading && thumbInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); if (!thumbnailUploading) setThumbDragging(true); }}
            onDragLeave={(e) => { e.preventDefault(); setThumbDragging(false); }}
            onDrop={onThumbnailDrop}
          >
            {thumbnailUrl ? (
              <>
                <img src={thumbnailUrl} alt="Album thumbnail" />
                <button
                  type="button"
                  className="audio-upload-album-thumb-remove"
                  onClick={(e) => { e.stopPropagation(); setThumbnailUrl(''); }}
                  aria-label="Remove thumbnail"
                ><MdClose size={14} /></button>
              </>
            ) : (
              <>
                <MdCloudUpload size={28} />
                <span>{thumbnailUploading ? 'Uploading…' : 'Add cover image'}</span>
                <small>Click or drag &amp; drop — JPG / PNG / WebP</small>
              </>
            )}
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={onThumbnailFile}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div className="audio-upload-playlist-form-actions">
            <button
              type="button"
              className="audio-upload-btn-secondary"
              onClick={resetForm}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="audio-upload-btn-primary"
              onClick={submit}
              disabled={submitting || !newName.trim()}
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable cover picker — owns its own file input so many can coexist.
function ThumbPicker({ value, uploading, onPick, onClear, label = 'Add cover image' }) {
  const ref = useRef(null);
  const [dragging, setDragging] = useState(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (uploading) return;
    const f = e.dataTransfer?.files?.[0];
    if (f && f.type.startsWith('image/')) onPick(f);
  };
  return (
    <div
      className={`audio-upload-album-thumb${value ? ' has-image' : ''}${dragging ? ' dragging' : ''}`}
      onClick={() => !uploading && ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); if (!uploading) setDragging(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
      onDrop={handleDrop}
    >
      {value ? (
        <>
          <img src={value} alt="cover" />
          <button
            type="button"
            className="audio-upload-album-thumb-remove"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            aria-label="Remove cover"
          ><MdClose size={14} /></button>
        </>
      ) : (
        <>
          <MdCloudUpload size={26} />
          <span>{uploading ? 'Uploading…' : label}</span>
          <small>Click or drag &amp; drop — JPG / PNG / WebP</small>
        </>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

// Per-track content-type + music fields (shared by Mode/MainPost/Tracks).
function TrackTypeFields({ track, patchTrack, disabled }) {
  return (
    <>
      <div className="audio-upload-title-row">
        <select
          className="audio-upload-type-select"
          value={track.type || 'voice_message'}
          onChange={(e) => patchTrack(track.id, { type: e.target.value })}
          disabled={disabled}
        >
          {TRACK_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
      {track.type === 'song' && (
        <div className="audio-upload-music-row">
          <input
            type="text"
            className="audio-upload-genre-input"
            value={track.genre || ''}
            onChange={(e) => patchTrack(track.id, { genre: e.target.value })}
            placeholder="Genre"
            list="audio-upload-genre-options"
            maxLength={60}
            disabled={disabled}
          />
          <input
            type="number"
            className="audio-upload-bpm-input"
            value={track.bpm || ''}
            onChange={(e) => patchTrack(track.id, { bpm: e.target.value })}
            placeholder="BPM"
            min="20"
            max="400"
            disabled={disabled}
          />
        </div>
      )}
    </>
  );
}

// ─── Step: Mode (how the audio is published + how it earns) ───
function ModeStep({ tracks, mode, setMode, rewardMode, setRewardMode, isPublishing, publishStatus = {} }) {
  const locked = isPublishing || tracks.some(t => publishStatus[t.id]?.state);
  const count = tracks.length;
  const opt = (id, enabled, title, desc) => (
    <button
      type="button"
      className={`audio-upload-reward-opt${mode === id ? ' is-active' : ''}`}
      onClick={() => enabled && setMode(id)}
      disabled={locked || !enabled}
    >
      <strong>{title}</strong>
      <small>{desc}</small>
    </button>
  );
  return (
    <div className="audio-upload-review">
      <p className="audio-upload-step-help">
        {count} track{count !== 1 ? 's' : ''} added. Choose how they go out.
      </p>

      <div className="audio-upload-reward">
        <span className="audio-upload-reward-label">How should this be published?</span>
        {opt('snaps', true, 'Snap comments',
          'Each audio posts as a reply under the latest peak.snaps container — shows in the Snaps feed (default).')}
        {opt('single', count === 1, `Standalone post${count !== 1 ? ' (single file only)' : ''}`,
          'One audio in its own top-level Hive post, with a title, community, tags & cover.')}
        {opt('album', count >= 2, `Album post${count < 2 ? ' (needs 2+ files)' : ''}`,
          'One main post (no audio) acting as a landing page; every track is published as a comment reply with its own cover, description, payout & beneficiaries.')}
      </div>

      {ENABLE_PPL && (
        <div className="audio-upload-reward">
          <span className="audio-upload-reward-label">How should this audio earn?</span>
          <button
            type="button"
            className={`audio-upload-reward-opt${rewardMode === 'post' ? ' is-active' : ''}`}
            onClick={() => setRewardMode('post')}
            disabled={locked}
          >
            <strong>Post rewards (one-time)</strong>
            <small>You receive the normal Hive author payout — paid out once, ~7 days after publishing.</small>
          </button>
          <button
            type="button"
            className={`audio-upload-reward-opt${rewardMode === 'ppl' ? ' is-active' : ''}`}
            onClick={() => setRewardMode('ppl')}
            disabled={locked}
          >
            <strong>Pay-per-listen (lifetime)</strong>
            <small>
              All audio-post rewards go to @{PPL_BENEFICIARY}. Instead of a single payout,
              a 3Speak program pays you per listen for the lifetime of the track.
            </small>
          </button>
        </div>
      )}
    </div>
  );
}

// Shared payout + beneficiaries control row.
function RewardRow({ payout, setPayout, beneCount, onOpenBene }) {
  return (
    <div className="audio-upload-post-reward-row">
      <label>
        <span>Rewards distribution</span>
        <select value={payout} onChange={(e) => setPayout(e.target.value)}>
          <option value="default">Default (50% HBD / 50% HP)</option>
          <option value="powerup">Power up 100%</option>
          <option value="decline">Decline payout</option>
        </select>
      </label>
      <button type="button" className="audio-upload-community-btn" onClick={onOpenBene}>
        {beneCount > 0 ? `Beneficiaries (${beneCount})` : 'Beneficiaries'}
        <span className="audio-upload-community-change">Edit</span>
      </button>
    </div>
  );
}

// ─── Step: Main post composer (single post, or the album's parent post) ───
function MainPostStep({
  variant, singleTrack, patchTrack,
  title, setTitle, description, setDescription,
  community, setCommunityOpen, tagsInput, setTagsInput,
  thumb, setThumb, thumbUploading, onPickThumb,
  payout, setPayout, beneCount, onOpenBene,
}) {
  const isAlbum = variant === 'album';
  return (
    <div className="audio-upload-review audio-upload-post-form">
      <p className="audio-upload-step-help">
        {isAlbum
          ? 'Details for the main post — the album landing page. It carries no audio; each track is a comment reply you configure next.'
          : 'Details for your standalone post.'}
      </p>

      <input
        type="text"
        className="audio-upload-post-tags"
        placeholder="Title (required)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <button
        type="button"
        className="audio-upload-community-btn"
        onClick={() => setCommunityOpen(true)}
      >
        {community
          ? <><img src={`https://images.hive.blog/u/${community.name}/avatar/small`} alt="" />{community.title || community.name}</>
          : <>Select community</>}
        <span className="audio-upload-community-change">Change</span>
      </button>

      <input
        type="text"
        className="audio-upload-post-tags"
        placeholder="Tags — space or comma separated (optional)"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
      />

      <textarea
        className="audio-upload-post-desc"
        placeholder="Description (optional)"
        rows={4}
        maxLength={5000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <ThumbPicker
        value={thumb}
        uploading={thumbUploading}
        onPick={onPickThumb}
        onClear={() => setThumb('')}
      />

      {!isAlbum && singleTrack && (
        <div className="audio-upload-title-card">
          <span className="audio-upload-reward-label">What kind of audio is this?</span>
          <TrackTypeFields track={singleTrack} patchTrack={patchTrack} />
        </div>
      )}

      <RewardRow payout={payout} setPayout={setPayout} beneCount={beneCount} onOpenBene={onOpenBene} />
    </div>
  );
}

// ─── Step: Tracks (snaps / album) — apply-to-all panel + per-track accordion ───
function TracksStep({
  tracks, mode, patchTrack,
  postDescription, setPostDescription, postThumb, setPostThumb,
  postPayout, setPostPayout, postBeneCount,
  applyToAllTracks, onOpenBene, uploadCoverFor, thumbUploadingId,
}) {
  const [openId, setOpenId] = useState(null);
  return (
    <div className="audio-upload-review audio-upload-post-form">
      <p className="audio-upload-step-help">
        {mode === 'album'
          ? 'Each track is published as a comment under the main post. Set shared values once and apply them to all, then override per track.'
          : 'Each track is published as its own snap. Set shared values once and apply them to all, then override per track.'}
      </p>

      <div className="audio-upload-title-card">
        <span className="audio-upload-reward-label">Apply to all tracks</span>
        <textarea
          className="audio-upload-post-desc"
          placeholder="Shared description (optional)"
          rows={3}
          maxLength={5000}
          value={postDescription}
          onChange={(e) => setPostDescription(e.target.value)}
        />
        <ThumbPicker
          value={postThumb}
          uploading={thumbUploadingId === 'main'}
          onPick={(f) => uploadCoverFor('main', f)}
          onClear={() => setPostThumb('')}
          label="Shared cover image"
        />
        <RewardRow
          payout={postPayout}
          setPayout={setPostPayout}
          beneCount={postBeneCount}
          onOpenBene={() => onOpenBene('main')}
        />
        <button
          type="button"
          className="audio-upload-btn-secondary"
          onClick={applyToAllTracks}
          style={{ marginTop: 8 }}
        >
          Apply to all {tracks.length} tracks
        </button>
      </div>

      {tracks.map((t, i) => {
        const expanded = openId === t.id;
        let beneCount = 0;
        try { beneCount = (JSON.parse(t.beneStr || '[]') || []).length; } catch { beneCount = 0; }
        return (
          <div key={t.id} className="audio-upload-title-card">
            <div
              className="audio-upload-title-row"
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(expanded ? null : t.id)}
              style={{ cursor: 'pointer' }}
            >
              <span className="audio-upload-title-num">{i + 1}.</span>
              <span
                className="audio-upload-title-input"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {t.title || t.filename}
              </span>
              <span className="audio-upload-community-change">{expanded ? 'Hide' : 'Edit'}</span>
            </div>

            {expanded && (
              <>
                <input
                  type="text"
                  className="audio-upload-post-tags"
                  placeholder="Track title"
                  value={t.title}
                  onChange={(e) => patchTrack(t.id, { title: e.target.value })}
                  maxLength={120}
                />
                <TrackTypeFields track={t} patchTrack={patchTrack} />
                <textarea
                  className="audio-upload-post-desc"
                  placeholder="Description (optional)"
                  rows={3}
                  maxLength={5000}
                  value={t.desc || ''}
                  onChange={(e) => patchTrack(t.id, { desc: e.target.value })}
                />
                <ThumbPicker
                  value={t.thumb || ''}
                  uploading={thumbUploadingId === t.id}
                  onPick={(f) => uploadCoverFor(t.id, f)}
                  onClear={() => patchTrack(t.id, { thumb: '' })}
                />
                <RewardRow
                  payout={t.payout || 'default'}
                  setPayout={(v) => patchTrack(t.id, { payout: v })}
                  beneCount={beneCount}
                  onOpenBene={() => onOpenBene(t.id)}
                />
              </>
            )}

            <div className="audio-upload-title-meta-line">
              <span>{fmtTime(t.durationSec)} · {t.source === 'record' ? 'Recorded' : t.filename}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 5: Review (summary + publish) ───
function ReviewStep({ tracks, playlists, playlistChoice, pendingPlaylist, publishStatus = {}, onRetry, onRetryAll, isPublishing, mode, rewardMode, community }) {
  const chosen = playlists.find(p => p.id === playlistChoice)
    || (pendingPlaylist && pendingPlaylist.id === playlistChoice ? pendingPlaylist : null);
  const failedCount = tracks.filter((t) => publishStatus[t.id]?.state === 'error').length;
  const inCommunity = community ? ` in ${community.title || community.name}` : '';
  const publishAsLabel = mode === 'single'
    ? `Standalone post${inCommunity}`
    : mode === 'album'
      ? `Album — 1 main post${inCommunity} + ${tracks.length} track comments`
      : `${tracks.length} snap comment${tracks.length !== 1 ? 's' : ''}`;
  return (
    <div className="audio-upload-review">
      <p className="audio-upload-step-help">
        Ready to publish {tracks.length} track{tracks.length !== 1 ? 's' : ''}
        {chosen ? ` to playlist "${chosen.name}"` : ''}.
      </p>

      <div className="audio-upload-review-summary">
        <div><strong>Publish as:</strong> {publishAsLabel}</div>
        <div><strong>Earnings:</strong> {rewardMode === 'ppl' ? `Pay-per-listen (@${PPL_BENEFICIARY})` : 'Normal post rewards'}</div>
        {chosen && <div><strong>Playlist:</strong> {chosen.name}</div>}
      </div>

      {failedCount > 0 && (
        <div className="audio-upload-review-failed-banner">
          <span>{failedCount} track{failedCount !== 1 ? 's' : ''} failed.</span>
          <button
            type="button"
            className="audio-upload-btn-secondary"
            onClick={onRetryAll}
            disabled={isPublishing}
          >
            Retry all failed
          </button>
        </div>
      )}

      {tracks.map((t, i) => {
        const status = publishStatus[t.id];
        return (
          <div key={t.id} className={`audio-upload-review-row${status?.state ? ` is-${status.state}` : ''}`}>
            <div className="audio-upload-review-info">
              <span className="audio-upload-review-num">{i + 1}.</span>
              <strong className="audio-upload-review-title">{t.title}</strong>
              <small className="audio-upload-review-meta">
                {fmtTime(t.durationSec)} · {t.source === 'record' ? 'Recorded' : t.filename}
              </small>
              {status && <PublishBadge status={status} />}
            </div>

            {status?.state === 'error' && (
              <div className="audio-upload-review-error">
                <p className="audio-upload-review-error-msg">
                  {status.stage ? `Failed during ${status.stage.toLowerCase()}: ` : 'Failed: '}
                  {status.message || 'unknown error'}
                </p>
                <button
                  type="button"
                  className="audio-upload-btn-primary"
                  onClick={() => onRetry?.(t.id)}
                  disabled={isPublishing}
                >
                  Retry
                </button>
              </div>
            )}

            <audio controls preload="metadata" src={t.objectUrl} className="audio-upload-review-player" />
          </div>
        );
      })}
    </div>
  );
}

function PublishBadge({ status }) {
  if (!status?.state || status.state === 'pending') return null;
  if (status.state === 'uploading') return <span className="audio-upload-review-badge uploading">{status.stage || 'Uploading'}…</span>;
  if (status.state === 'posting') return <span className="audio-upload-review-badge posting">{status.stage || 'Posting to Hive'}…</span>;
  if (status.state === 'success') return <span className="audio-upload-review-badge success"><MdCheck size={12} /> Published</span>;
  if (status.state === 'error') return <span className="audio-upload-review-badge error">Failed</span>;
  return null;
}

export default AudioUploadModal;
