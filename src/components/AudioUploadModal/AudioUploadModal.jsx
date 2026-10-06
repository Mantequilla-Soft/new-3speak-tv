import { useState, useRef, useEffect, useCallback } from 'react';
import {
  MdClose, MdCloudUpload, MdMic, MdStop, MdDelete,
  MdArrowBack, MdArrowForward, MdPlaylistAdd, MdPlaylistAddCheck,
  MdPublic, MdLock, MdCheck, MdAdd,
} from 'react-icons/md';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
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
import AccountImg from '../HiveAvatar/AccountImg';

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
// i18n keys, translated at render.
const STEP_LABEL_KEYS = {
  source: 'audio.upload.steps.source',
  mode: 'audio.upload.steps.mode',
  playlist: 'audio.upload.steps.playlist',
  post: 'audio.upload.steps.post',
  mainpost: 'audio.upload.steps.mainpost',
  tracks: 'audio.upload.steps.tracks',
  review: 'audio.upload.steps.review',
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
  { value: 'voice_message', labelKey: 'audio.upload.trackTypes.voiceSnap' },
  { value: 'song',          labelKey: 'audio.categories.music' },
  { value: 'podcast',       labelKey: 'audio.categories.podcast' },
  { value: 'audiobook',     labelKey: 'audio.categories.audiobook' },
  { value: 'interview',     labelKey: 'audio.categories.interview' },
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
  const { t } = useTranslation();
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
    setTracks(prev => prev.map(tr => (tr.id === id ? { ...tr, ...patch } : tr)));
  }, []);

  // Upload a cover for a target ('main' or a track id) and store the URL.
  const uploadCoverFor = useCallback(async (target, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('audio.upload.toasts.pickImage')); return; }
    setThumbUploadingId(target);
    try {
      const url = await uploadThumbnail(file);
      if (target === 'main') setPostThumb(url);
      else setTracks(prev => prev.map(tr => (tr.id === target ? { ...tr, thumb: url } : tr)));
    } catch (err) {
      toast.error(t('audio.upload.toasts.thumbFailed', { error: err?.message || t('audio.upload.unknown') }));
    } finally {
      setThumbUploadingId(null);
      if (thumbInputRef.current) thumbInputRef.current.value = '';
    }
  }, [t]);

  // Apply the main composer's desc/payout/beneficiaries to every track.
  const applyToAllTracks = useCallback(() => {
    setTracks(prev => prev.map(tr => ({
      ...tr,
      desc: postDescription,
      thumb: postThumb || tr.thumb,
      payout: postPayout,
      beneStr: postBeneStr,
    })));
    toast.success(t('audio.upload.toasts.appliedToAll'));
  }, [postDescription, postThumb, postPayout, postBeneStr, t]);

  // Open the beneficiary modal for a target; seed its list from that
  // target's stored JSON.
  const openBeneFor = useCallback((target) => {
    const json = target === 'main'
      ? postBeneStr
      : (tracks.find(tr => tr.id === target)?.beneStr || '[]');
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
    else setTracks(prev => prev.map(tr => (tr.id === beneTarget ? { ...tr, beneStr: json } : tr)));
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
      const tr = prev.find(x => x.id === id);
      if (tr?.objectUrl) {
        URL.revokeObjectURL(tr.objectUrl);
        objectUrlsRef.current.delete(tr.objectUrl);
      }
      return prev.filter(x => x.id !== id);
    });
  };

  const setTitle = (id, title) => {
    setTracks(prev => prev.map(tr => tr.id === id ? { ...tr, title } : tr));
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
        recordStreamRef.current?.getTracks().forEach(tr => tr.stop());
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
      toast.error(t('audio.upload.toasts.micDenied'));
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
      recordStreamRef.current?.getTracks().forEach(tr => tr.stop());
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
    if (!user) { toast.error(t('audio.upload.toasts.signInFirst')); return; }
    const trimmed = name.trim();
    if (!trimmed) { toast.error(t('audio.upload.toasts.enterPlaylistName')); return; }
    const playlistId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    try {
      toast.info(t('audio.upload.toasts.creatingPlaylist', { name: trimmed }));
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
      toast.success(t('audio.upload.toasts.playlistCreated'));
      setPlaylistChoice(playlistId);
      setPendingPlaylist({ id: playlistId, name: trimmed, access });
      setTimeout(() => {
        refetchPlaylists();
        queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
      }, 3000);
      return true;
    } catch (err) {
      toast.error(t('audio.upload.toasts.failedWithError', { error: err?.message || t('audio.upload.unknownError') }));
      return false;
    }
  }, [user, queryClient, refetchPlaylists, t]);

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
      toast.success(t('audio.upload.toasts.authorized'));
    } catch (e) {
      try { signWindow?.close(); } catch { /* ignore */ }
      toast.error(e?.message || t('audio.upload.toasts.authFailed'));
    } finally {
      setAuthorizing(false);
    }
  }, [user, t]);

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
    setTrackStatus(track.id, { state: 'uploading', stage: 'upload', message: undefined });
    const { permlink: audioPermlink, playUrl } = await uploadAudioTo3Speak({
      blob: track.blob, durationSec: track.durationSec, username: user, title: track.title,
    });
    setTrackStatus(track.id, { state: 'posting', stage: 'post', playUrl });
    const hivePermlink = generatePermlink(mainTitle || track.title) || audioPermlink;
    const userTags = postTagsInput.split(/[\s,]+/).map(tr => tr.trim().toLowerCase()).filter(Boolean);
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
    const userTags = postTagsInput.split(/[\s,]+/).map(tr => tr.trim().toLowerCase()).filter(Boolean);
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
    setTrackStatus(track.id, { state: 'uploading', stage: 'upload', message: undefined });
    const { permlink: audioPermlink, playUrl } = await uploadAudioTo3Speak({
      blob: track.blob, durationSec: track.durationSec, username: user, title: track.title,
    });
    setTrackStatus(track.id, { state: 'posting', stage: 'post', playUrl });
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
    const track = tracks.find((tr) => tr.id === trackId);
    if (!track) return;
    setIsPublishing(true);
    try {
      const parent = mode === 'single' ? null : await resolveParent();
      await publishOneTrack(track, parent);
      if (playlistChoice) queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
    } catch (err) {
      const message = err?.message || (typeof err === 'string' ? err : t('audio.upload.failed'));
      setTrackStatus(trackId, { state: 'error', stage: undefined, message });
    } finally {
      setIsPublishing(false);
    }
  }, [tracks, mode, resolveParent, publishOneTrack, playlistChoice, queryClient, user, t]);

  const retryAllFailed = useCallback(async () => {
    const failed = tracks.filter((tr) => publishStatus[tr.id]?.state === 'error');
    if (failed.length === 0) return;
    for (let i = 0; i < failed.length; i++) {
      if (i > 0) await sleep(PUBLISH_DELAY_MS); // throttle between tracks
      // eslint-disable-next-line no-await-in-loop
      await retryTrack(failed[i].id);
    }
  }, [tracks, publishStatus, retryTrack]);

  if (!isOpen) return null;

  const allPublished = tracks.length > 0 && tracks.every(tr => publishStatus[tr.id]?.state === 'success');

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
    if (!user) { toast.error(t('audio.upload.toasts.signInFirst')); return; }
    if (tracks.length === 0) return;
    setIsPublishing(true);

    const initial = {};
    for (const tr of tracks) initial[tr.id] = { state: 'pending' };
    setPublishStatus(initial);

    // Resolve the shared parent up front (snap container, or broadcast the
    // album's main post first). Single posts are top-level — no parent.
    let parent = null;
    if (mode !== 'single') {
      try {
        parent = await resolveParent();
      } catch (err) {
        setIsPublishing(false);
        const errorText = err?.message || t('audio.upload.unknown');
        toast.error(mode === 'album'
          ? t('audio.upload.toasts.couldntPublishMain', { error: errorText })
          : t('audio.upload.toasts.couldntResolveContainer', { error: errorText }));
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
        const message = err?.message || (typeof err === 'string' ? err : t('audio.upload.failed'));
        setTrackStatus(track.id, { state: 'error', stage: undefined, message });
      }
    }

    setIsPublishing(false);

    if (allOk) {
      toast.success(t('audio.upload.toasts.published', { count: tracks.length }));
      queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
      setTimeout(() => onClose(), 1200);
    } else {
      toast.error(t('audio.upload.toasts.someFailed'));
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
          <h3><MdCloudUpload /> {t('audio.upload.title')}</h3>
          <button className="audio-upload-close" onClick={attemptClose} aria-label={t('common.actions.close')}><MdClose size={20} /></button>
        </div>

        {(authChecking || rcChecking || needsAuth || rcInsufficient) ? (
          <div className="audio-upload-body">
            <div className="audio-upload-auth-gate">
              {(authChecking || rcChecking) ? (
                <p>{t('audio.upload.gate.checking')}</p>
              ) : needsAuth ? (
                <>
                  <p><Trans i18nKey="audio.upload.gate.allowThreespeak" components={{ b: <strong /> }} /></p>
                  <button className="audio-upload-btn-primary" onClick={handleAuthorize} disabled={authorizing}>
                    {authorizing ? t('audio.upload.gate.authorizing') : t('audio.upload.gate.authorize')}
                  </button>
                </>
              ) : (
                <>
                  <p><Trans i18nKey="audio.upload.gate.notEnoughRc" components={{ b: <strong /> }} /></p>
                  <button className="audio-upload-btn-primary" onClick={() => setRcModalOpen(true)}>
                    {t('audio.upload.gate.whyCantUpload')}
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
              <span className="audio-upload-step-label">{t(STEP_LABEL_KEYS[key])}</span>
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
              <MdArrowBack size={16} /> {t('common.actions.back')}
            </button>
          ) : <span />}
          {!isLastStep ? (
            <button className="audio-upload-btn-primary" onClick={goNext} disabled={!canNext}>
              {t('common.actions.next')} <MdArrowForward size={16} />
            </button>
          ) : allPublished ? (
            <button
              className="audio-upload-btn-primary"
              onClick={onClose}
            >
              <MdCheck size={16} /> {t('common.actions.close')}
            </button>
          ) : (
            <button
              className="audio-upload-btn-primary"
              onClick={onPublish}
              disabled={isPublishing}
            >
              {isPublishing ? t('audio.upload.publishing') : t('common.actions.publish')}
            </button>
          )}
        </div>
        </>)}

        {showCloseConfirm && (
          <div className="audio-upload-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="audio-upload-confirm-card">
              <h4>{t('audio.upload.discard.title')}</h4>
              <p>
                {isRecording
                  ? t('audio.upload.discard.bodyRecording', { count: tracks.length })
                  : t('audio.upload.discard.body', { count: tracks.length })}
              </p>
              <div className="audio-upload-confirm-actions">
                <button
                  className="audio-upload-btn-secondary"
                  onClick={() => setShowCloseConfirm(false)}
                  autoFocus
                >
                  {t('audio.upload.discard.keepEditing')}
                </button>
                <button
                  className="audio-upload-btn-primary audio-upload-btn-danger"
                  onClick={() => { setShowCloseConfirm(false); onClose(); }}
                >
                  {t('audio.upload.discard.discard')}
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
  const { t } = useTranslation();
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
          <p>{t('audio.upload.source.dropHere')}</p>
          <small>{t('audio.upload.source.formats')}</small>
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
                <MdStop size={16} /> {t('audio.upload.source.stop')}
              </button>
            </>
          ) : (
            <>
              <MdMic size={32} />
              <p>{t('audio.upload.source.orRecord')}</p>
              <small>{t('audio.upload.source.recordLimit', { minutes: Math.round(MAX_RECORD_SEC / 60) })}</small>
              <button className="audio-upload-btn-primary" onClick={onStart}>
                <MdMic size={16} /> {t('audio.upload.source.record')}
              </button>
            </>
          )}
        </div>
      </div>
      {tracks.length > 0 && (
        <div className="audio-upload-track-list">
          <h4>{t('audio.upload.source.added', { count: tracks.length })}</h4>
          {tracks.map(tr => (
            <div key={tr.id} className="audio-upload-track-row">
              <span className="audio-upload-track-source" title={tr.source === 'record' ? t('audio.upload.recorded') : t('audio.upload.uploaded')}>
                {tr.source === 'record' ? <MdMic size={14} /> : <MdCloudUpload size={14} />}
              </span>
              <span className="audio-upload-track-name">{tr.filename}</span>
              <span className="audio-upload-track-meta">{fmtTime(tr.durationSec)}</span>
              <button className="audio-upload-track-remove" onClick={() => onRemove(tr.id)} aria-label={t('common.actions.remove')}>
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
  const { t } = useTranslation();
  return (
    <div className="audio-upload-titles">
      <p className="audio-upload-step-help">{t('audio.upload.titles.help')}</p>
      {tracks.map((tr, i) => (
        <div key={tr.id} className="audio-upload-title-card">
          <div className="audio-upload-title-row">
            <span className="audio-upload-title-num">{i + 1}.</span>
            <input
              type="text"
              className="audio-upload-title-input"
              value={tr.title}
              onChange={(e) => setTitle(tr.id, e.target.value)}
              placeholder={t('audio.upload.fields.trackTitle')}
              maxLength={120}
            />
            <select
              className="audio-upload-type-select"
              value={tr.type || 'voice_message'}
              onChange={(e) => patchTrack(tr.id, { type: e.target.value })}
            >
              {TRACK_TYPES.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
              ))}
            </select>
            <button className="audio-upload-track-remove" onClick={() => onRemove(tr.id)} aria-label={t('common.actions.remove')}>
              <MdDelete size={14} />
            </button>
          </div>
          {tr.type === 'song' && (
            <div className="audio-upload-music-row">
              <input
                type="text"
                className="audio-upload-genre-input"
                value={tr.genre || ''}
                onChange={(e) => patchTrack(tr.id, { genre: e.target.value })}
                placeholder={t('audio.upload.fields.genre')}
                list="audio-upload-genre-options"
                maxLength={60}
              />
              <input
                type="number"
                className="audio-upload-bpm-input"
                value={tr.bpm || ''}
                onChange={(e) => patchTrack(tr.id, { bpm: e.target.value })}
                placeholder={t('audio.upload.fields.bpm')}
                min="20"
                max="400"
              />
            </div>
          )}
          <div className="audio-upload-title-meta-line">
            <span>{fmtTime(tr.durationSec)} · {tr.source === 'record' ? t('audio.upload.recorded') : tr.filename}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaylistStep({ playlists, loading, choice, onChoose, pendingPlaylist, onCreate, required = false }) {
  const { t } = useTranslation();
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
      toast.error(t('audio.upload.toasts.pickImage'));
      return;
    }
    setThumbnailUploading(true);
    try {
      const url = await uploadThumbnail(file);
      setThumbnailUrl(url);
    } catch (err) {
      toast.error(t('audio.upload.toasts.thumbFailed', { error: err?.message || t('audio.upload.unknown') }));
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
          ? t('audio.upload.playlist.helpRequired')
          : t('audio.upload.playlist.helpOptional')}
      </p>

      {!required && (
        <button
          className={`audio-upload-playlist-item${choice === null ? ' selected' : ''}`}
          onClick={() => onChoose(null)}
        >
          <span className="audio-upload-playlist-icon"><MdPlaylistAdd size={18} /></span>
          <span className="audio-upload-playlist-name">
            <span>{t('audio.upload.playlist.none')}</span>
            <small>{t('audio.upload.playlist.noneHint')}</small>
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
              {t('audio.upload.playlist.creatingPending')}
            </small>
          </span>
          {choice === pendingPlaylist.id && <MdCheck size={16} />}
        </button>
      )}

      {loading ? (
        <div className="audio-upload-playlist-loading">{t('audio.upload.playlist.loading')}</div>
      ) : playlists.length === 0 && !showPending ? (
        <div className="audio-upload-playlist-empty">{t('audio.upload.playlist.empty')}</div>
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
                {t('audio.upload.playlist.items', { count: p.items?.length || 0 })}
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
          <MdAdd size={16} /> {t('audio.upload.playlist.newPlaylist')}
        </button>
      ) : (
        <div className="audio-upload-playlist-form">
          <input
            type="text"
            className="audio-upload-title-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('audio.upload.playlist.namePlaceholder')}
            maxLength={80}
            autoFocus
          />
          <div className="audio-upload-playlist-privacy">
            <button
              type="button"
              className={`audio-upload-playlist-privacy-btn${newAccess === 'public' ? ' active' : ''}`}
              onClick={() => setNewAccess('public')}
            >
              <MdPublic size={14} /> {t('audio.upload.playlist.public')}
            </button>
            <button
              type="button"
              className={`audio-upload-playlist-privacy-btn${newAccess === 'private' ? ' active' : ''}`}
              onClick={() => setNewAccess('private')}
            >
              <MdLock size={14} /> {t('audio.upload.playlist.private')}
            </button>
          </div>
          <input
            type="text"
            className="audio-upload-title-input"
            value={newMusicStyle}
            onChange={(e) => setNewMusicStyle(e.target.value)}
            placeholder={t('audio.upload.playlist.musicStylePlaceholder')}
            list="audio-upload-genre-options"
            maxLength={60}
          />

          <div className="audio-upload-album-grid">
            <input
              type="text"
              className="audio-upload-title-input"
              value={newCredits}
              onChange={(e) => setNewCredits(e.target.value)}
              placeholder={t('audio.upload.playlist.creditsPlaceholder')}
              maxLength={200}
            />
            <input
              type="number"
              className="audio-upload-title-input"
              value={newYear}
              onChange={(e) => setNewYear(e.target.value)}
              placeholder={t('audio.upload.playlist.yearPlaceholder')}
              min="1900"
              max="2100"
            />
            <input
              type="text"
              className="audio-upload-title-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t('audio.upload.playlist.labelPlaceholder')}
              maxLength={120}
            />
          </div>

          <textarea
            className="audio-upload-title-input audio-upload-credits-input"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder={t('audio.upload.fields.descriptionOptional')}
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
                <img src={thumbnailUrl} alt={t('audio.upload.playlist.thumbAlt')} />
                <button
                  type="button"
                  className="audio-upload-album-thumb-remove"
                  onClick={(e) => { e.stopPropagation(); setThumbnailUrl(''); }}
                  aria-label={t('audio.upload.playlist.removeThumb')}
                ><MdClose size={14} /></button>
              </>
            ) : (
              <>
                <MdCloudUpload size={28} />
                <span>{thumbnailUploading ? t('audio.upload.thumb.uploading') : t('audio.upload.thumb.addCover')}</span>
                <small>{t('audio.upload.thumb.hint')}</small>
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
              {t('common.actions.cancel')}
            </button>
            <button
              type="button"
              className="audio-upload-btn-primary"
              onClick={submit}
              disabled={submitting || !newName.trim()}
            >
              {submitting ? t('audio.upload.playlist.creating') : t('audio.upload.playlist.create')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable cover picker — owns its own file input so many can coexist.
function ThumbPicker({ value, uploading, onPick, onClear, label }) {
  const { t } = useTranslation();
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
          <img src={value} alt={t('audio.upload.thumb.coverAlt')} />
          <button
            type="button"
            className="audio-upload-album-thumb-remove"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            aria-label={t('audio.upload.thumb.removeCover')}
          ><MdClose size={14} /></button>
        </>
      ) : (
        <>
          <MdCloudUpload size={26} />
          <span>{uploading ? t('audio.upload.thumb.uploading') : (label === undefined ? t('audio.upload.thumb.addCover') : label)}</span>
          <small>{t('audio.upload.thumb.hint')}</small>
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
  const { t } = useTranslation();
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
            <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
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
            placeholder={t('audio.upload.fields.genre')}
            list="audio-upload-genre-options"
            maxLength={60}
            disabled={disabled}
          />
          <input
            type="number"
            className="audio-upload-bpm-input"
            value={track.bpm || ''}
            onChange={(e) => patchTrack(track.id, { bpm: e.target.value })}
            placeholder={t('audio.upload.fields.bpm')}
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
  const { t } = useTranslation();
  const locked = isPublishing || tracks.some(tr => publishStatus[tr.id]?.state);
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
        {t('audio.upload.mode.help', { count })}
      </p>

      <div className="audio-upload-reward">
        <span className="audio-upload-reward-label">{t('audio.upload.mode.howPublished')}</span>
        {opt('snaps', true, t('audio.upload.mode.snapsTitle'),
          t('audio.upload.mode.snapsDesc'))}
        {opt('single', count === 1, count !== 1 ? t('audio.upload.mode.singleTitleSingleOnly') : t('audio.upload.mode.singleTitle'),
          t('audio.upload.mode.singleDesc'))}
        {opt('album', count >= 2, count < 2 ? t('audio.upload.mode.albumTitleNeeds2') : t('audio.upload.mode.albumTitle'),
          t('audio.upload.mode.albumDesc'))}
      </div>

      {ENABLE_PPL && (
        <div className="audio-upload-reward">
          <span className="audio-upload-reward-label">{t('audio.upload.mode.howEarn')}</span>
          <button
            type="button"
            className={`audio-upload-reward-opt${rewardMode === 'post' ? ' is-active' : ''}`}
            onClick={() => setRewardMode('post')}
            disabled={locked}
          >
            <strong>{t('audio.upload.mode.postRewardsTitle')}</strong>
            <small>{t('audio.upload.mode.postRewardsDesc')}</small>
          </button>
          <button
            type="button"
            className={`audio-upload-reward-opt${rewardMode === 'ppl' ? ' is-active' : ''}`}
            onClick={() => setRewardMode('ppl')}
            disabled={locked}
          >
            <strong>{t('audio.upload.mode.pplTitle')}</strong>
            <small>
              {t('audio.upload.mode.pplDesc', { account: PPL_BENEFICIARY })}
            </small>
          </button>
        </div>
      )}
    </div>
  );
}

// Shared payout + beneficiaries control row.
function RewardRow({ payout, setPayout, beneCount, onOpenBene }) {
  const { t } = useTranslation();
  return (
    <div className="audio-upload-post-reward-row">
      <label>
        <span>{t('audio.upload.reward.distribution')}</span>
        <select value={payout} onChange={(e) => setPayout(e.target.value)}>
          <option value="default">{t('audio.upload.reward.default')}</option>
          <option value="powerup">{t('audio.upload.reward.powerup')}</option>
          <option value="decline">{t('audio.upload.reward.decline')}</option>
        </select>
      </label>
      <button type="button" className="audio-upload-community-btn" onClick={onOpenBene}>
        {beneCount > 0 ? t('audio.upload.reward.beneficiariesCount', { count: beneCount }) : t('audio.upload.reward.beneficiaries')}
        <span className="audio-upload-community-change">{t('common.actions.edit')}</span>
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
  const { t } = useTranslation();
  const isAlbum = variant === 'album';
  return (
    <div className="audio-upload-review audio-upload-post-form">
      <p className="audio-upload-step-help">
        {isAlbum
          ? t('audio.upload.mainPost.helpAlbum')
          : t('audio.upload.mainPost.helpSingle')}
      </p>

      <input
        type="text"
        className="audio-upload-post-tags"
        placeholder={t('audio.upload.mainPost.titlePlaceholder')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      <button
        type="button"
        className="audio-upload-community-btn"
        onClick={() => setCommunityOpen(true)}
      >
        {community
          ? <><AccountImg account={community.name} alt="" />{community.title || community.name}</>
          : <>{t('audio.upload.mainPost.selectCommunity')}</>}
        <span className="audio-upload-community-change">{t('audio.upload.mainPost.change')}</span>
      </button>

      <input
        type="text"
        className="audio-upload-post-tags"
        placeholder={t('audio.upload.mainPost.tagsPlaceholder')}
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
      />

      <textarea
        className="audio-upload-post-desc"
        placeholder={t('audio.upload.fields.descriptionOptional')}
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
          <span className="audio-upload-reward-label">{t('audio.upload.mainPost.whatKind')}</span>
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
  const { t } = useTranslation();
  const [openId, setOpenId] = useState(null);
  return (
    <div className="audio-upload-review audio-upload-post-form">
      <p className="audio-upload-step-help">
        {mode === 'album'
          ? t('audio.upload.tracks.helpAlbum')
          : t('audio.upload.tracks.helpSnaps')}
      </p>

      <div className="audio-upload-title-card">
        <span className="audio-upload-reward-label">{t('audio.upload.tracks.applyToAllHeading')}</span>
        <textarea
          className="audio-upload-post-desc"
          placeholder={t('audio.upload.tracks.sharedDescription')}
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
          label={t('audio.upload.tracks.sharedCover')}
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
          {t('audio.upload.tracks.applyToAll', { count: tracks.length })}
        </button>
      </div>

      {tracks.map((tr, i) => {
        const expanded = openId === tr.id;
        let beneCount = 0;
        try { beneCount = (JSON.parse(tr.beneStr || '[]') || []).length; } catch { beneCount = 0; }
        return (
          <div key={tr.id} className="audio-upload-title-card">
            <div
              className="audio-upload-title-row"
              role="button"
              tabIndex={0}
              onClick={() => setOpenId(expanded ? null : tr.id)}
              style={{ cursor: 'pointer' }}
            >
              <span className="audio-upload-title-num">{i + 1}.</span>
              <span
                className="audio-upload-title-input"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {tr.title || tr.filename}
              </span>
              <span className="audio-upload-community-change">{expanded ? t('audio.upload.tracks.hide') : t('common.actions.edit')}</span>
            </div>

            {expanded && (
              <>
                <input
                  type="text"
                  className="audio-upload-post-tags"
                  placeholder={t('audio.upload.fields.trackTitle')}
                  value={tr.title}
                  onChange={(e) => patchTrack(tr.id, { title: e.target.value })}
                  maxLength={120}
                />
                <TrackTypeFields track={tr} patchTrack={patchTrack} />
                <textarea
                  className="audio-upload-post-desc"
                  placeholder={t('audio.upload.fields.descriptionOptional')}
                  rows={3}
                  maxLength={5000}
                  value={tr.desc || ''}
                  onChange={(e) => patchTrack(tr.id, { desc: e.target.value })}
                />
                <ThumbPicker
                  value={tr.thumb || ''}
                  uploading={thumbUploadingId === tr.id}
                  onPick={(f) => uploadCoverFor(tr.id, f)}
                  onClear={() => patchTrack(tr.id, { thumb: '' })}
                />
                <RewardRow
                  payout={tr.payout || 'default'}
                  setPayout={(v) => patchTrack(tr.id, { payout: v })}
                  beneCount={beneCount}
                  onOpenBene={() => onOpenBene(tr.id)}
                />
              </>
            )}

            <div className="audio-upload-title-meta-line">
              <span>{fmtTime(tr.durationSec)} · {tr.source === 'record' ? t('audio.upload.recorded') : tr.filename}</span>
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
  const failedCount = tracks.filter((tr) => publishStatus[tr.id]?.state === 'error').length;
  const { t } = useTranslation();
  const communityName = community ? (community.title || community.name) : '';
  const publishAsLabel = mode === 'single'
    ? (community ? t('audio.upload.review.standaloneIn', { community: communityName }) : t('audio.upload.review.standalone'))
    : mode === 'album'
      ? (community
        ? t('audio.upload.review.albumIn', { community: communityName, count: tracks.length })
        : t('audio.upload.review.album', { count: tracks.length }))
      : t('audio.upload.review.snapComments', { count: tracks.length });
  return (
    <div className="audio-upload-review">
      <p className="audio-upload-step-help">
        {chosen
          ? t('audio.upload.review.readyToPlaylist', { count: tracks.length, name: chosen.name })
          : t('audio.upload.review.ready', { count: tracks.length })}
      </p>

      <div className="audio-upload-review-summary">
        <div><strong>{t('audio.upload.review.publishAs')}</strong> {publishAsLabel}</div>
        <div><strong>{t('audio.upload.review.earnings')}</strong> {rewardMode === 'ppl' ? t('audio.upload.review.earningsPpl', { account: PPL_BENEFICIARY }) : t('audio.upload.review.earningsNormal')}</div>
        {chosen && <div><strong>{t('audio.upload.review.playlist')}</strong> {chosen.name}</div>}
      </div>

      {failedCount > 0 && (
        <div className="audio-upload-review-failed-banner">
          <span>{t('audio.upload.review.failedCount', { count: failedCount })}</span>
          <button
            type="button"
            className="audio-upload-btn-secondary"
            onClick={onRetryAll}
            disabled={isPublishing}
          >
            {t('audio.upload.review.retryAllFailed')}
          </button>
        </div>
      )}

      {tracks.map((tr, i) => {
        const status = publishStatus[tr.id];
        return (
          <div key={tr.id} className={`audio-upload-review-row${status?.state ? ` is-${status.state}` : ''}`}>
            <div className="audio-upload-review-info">
              <span className="audio-upload-review-num">{i + 1}.</span>
              <strong className="audio-upload-review-title">{tr.title}</strong>
              <small className="audio-upload-review-meta">
                {fmtTime(tr.durationSec)} · {tr.source === 'record' ? t('audio.upload.recorded') : tr.filename}
              </small>
              {status && <PublishBadge status={status} />}
            </div>

            {status?.state === 'error' && (
              <div className="audio-upload-review-error">
                <p className="audio-upload-review-error-msg">
                  {t(status.stage === 'upload'
                    ? 'audio.upload.review.failedDuringUpload'
                    : status.stage === 'post'
                      ? 'audio.upload.review.failedDuringPost'
                      : 'audio.upload.review.failedWithMessage',
                  { message: status.message || t('audio.upload.unknownError') })}
                </p>
                <button
                  type="button"
                  className="audio-upload-btn-primary"
                  onClick={() => onRetry?.(tr.id)}
                  disabled={isPublishing}
                >
                  {t('common.actions.retry')}
                </button>
              </div>
            )}

            <audio controls preload="metadata" src={tr.objectUrl} className="audio-upload-review-player" />
          </div>
        );
      })}
    </div>
  );
}

// `status.stage` is a code ('upload' | 'post'), translated here.
const STAGE_LABEL_KEYS = {
  upload: 'audio.upload.stage.upload',
  post: 'audio.upload.stage.post',
};

function PublishBadge({ status }) {
  const { t } = useTranslation();
  if (!status?.state || status.state === 'pending') return null;
  const stageLabel = STAGE_LABEL_KEYS[status.stage] ? t(STAGE_LABEL_KEYS[status.stage]) : '';
  if (status.state === 'uploading') return <span className="audio-upload-review-badge uploading">{stageLabel || t('audio.upload.stage.uploadingFallback')}…</span>;
  if (status.state === 'posting') return <span className="audio-upload-review-badge posting">{stageLabel || t('audio.upload.stage.post')}…</span>;
  if (status.state === 'success') return <span className="audio-upload-review-badge success"><MdCheck size={12} /> {t('audio.upload.stage.published')}</span>;
  if (status.state === 'error') return <span className="audio-upload-review-badge error">{t('audio.upload.failed')}</span>;
  return null;
}

export default AudioUploadModal;
