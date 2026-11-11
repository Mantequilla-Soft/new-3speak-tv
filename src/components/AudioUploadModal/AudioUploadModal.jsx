import { useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { useQueryClient } from '@tanstack/react-query';
import { KeyTypes } from '@aioha/aioha';
import { useMyPlaylists } from '../../hooks/useMyPlaylists';
import { uploadAudioTo3Speak, getSnapsContainer, linkAudioToPost, audioFormatFor } from '../../utils/audioUpload';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { broadcastWithAioha, broadcastViaThreespeak, getCurrentProvider, Providers, commentWithAioha } from '../../hive-api/aioha';
import { hasThreespeakPostingAuth, addThreespeakToPostingAuth } from '../../utils/postingAuthority';
import { checkPostingRc } from '../../utils/rcCheck';
import { oaEnvelope, threespeakAudio, OA_ARTICLE, OA_MICROPOST, OA_COMMENT } from '../../utils/openAttribute';
import RcInsufficientModal from '../embed-studio/RcInsufficientModal';
import CommunityModal from '../modal/Community_modal';
import Beneficiary_modal from '../modal/Beneficiary_modal';
import { useAppStore } from '../../lib/store';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { enforceLockedBeneficiaries } from '../../utils/beneficiaries';
import { PPL_BENEFICIARY, ENABLE_PPL, CHECKER_URL, CHECKER_API_KEY, FEATURE_EDITOR, adsEnabledFor } from '../../utils/config';
import { sanitizeMusicCredits, soundAuthorsOf, soundCreditsMarkdown, primarySoundMetadata } from '../../utils/soundCredits';
import { sanitizeChapters, chaptersText, withChapters } from '../../utils/audioChapters';
import { SOUND_AUTHOR_WEIGHT } from '../../utils/beneficiaries';
import CoverDesigner from './CoverDesigner';
import ShortThumbDesigner from './ShortThumbDesigner';
import AudiogramShortsSection from './AudiogramShortsSection';
import AudioTeleprompter from './AudioTeleprompter';
import TranscriptControl from './TranscriptControl';
import { useTranscriptJobs } from '../../hooks/useTranscriptJobs';
import { withTranscript, TRANSCRIPT_MAX_CHARS } from '../../utils/transcribe';
import { fetchCreatorAdPrefs, syncAudioAdChoice } from '../../lib/advertiseData';
import './AudioUploadModal.scss';
import AccountImg from '../HiveAvatar/AccountImg';
import { Banner, Button, ChoiceCard, Icon, IconButton, Segmented, SettingRow, StatusPill, Toggle } from '../v2/ui';
import { cx } from '../v2/helpers';
import { getHiveUrl } from '../../utils/hiveNode';
import UploadGate from '../ads/UploadGate';
import { fetchUploadGateAd, confirmUploadGatePost, gateSessionId } from '../../lib/uploadGate';
import { usePortalDoc } from '../../utils/portalDocument';
import { readAddToBlog, writeAddToBlog, reblogOp } from '../../utils/addToBlog';
import PlaylistTypePicker from '../PlaylistTypePicker/PlaylistTypePicker';
import MarkdownComposer from '../studio/MarkdownComposer';
import { sanitizeAudiograms, publishAudiogramShorts } from '../../utils/audiogramShorts';
import { playlistTypeFields, trackCategoryToKind, storedPlaylistType } from '../../lib/playlistType';

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
  // A warm-up account (no Hive account yet): one audio, its own post, kept by the
  // warm-up service until they graduate. Playlists work (through our server);
  // there is no mode or payout to choose.
  warmup: ['source', 'playlist', 'post', 'review'],
};

const MAX_RECORD_SEC = 300;
// A track's text with a transcript in it: room for the transcript (cut to
// TRANSCRIPT_MAX_CHARS) and what the creator wrote around it
const TRANSCRIPT_TEXT_MAX = TRANSCRIPT_MAX_CHARS + 5000;

// Upload failures with a known cause (err.code, set in utils/audioUpload.js) get
// a line in the user's language; anything else shows the service's own message.
const UPLOAD_ERROR_KEYS = {
  unreadable: 'audio.upload.errors.unreadable',
  rateLimited: 'audio.upload.errors.rateLimited',
  server: 'audio.upload.errors.server',
};
function uploadErrorText(err, t) {
  if (err?.code && UPLOAD_ERROR_KEYS[err.code]) return t(UPLOAD_ERROR_KEYS[err.code]);
  return err?.message || (typeof err === 'string' ? err : t('audio.upload.failed'));
}
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|webm|m4a|flac|aac)$/i;
// iOS greys out audio files in the Files app when the picker only says
// `audio/*` (WebKit bug 242110 reads it as video/*), so name the formats the
// hint lists, by extension and MIME type. Desktop browsers read the same list.
const AUDIO_ACCEPT = [
  '.mp3', '.wav', '.ogg', '.webm', '.m4a', '.flac', '.aac',
  'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm',
  'audio/mp4', 'audio/x-m4a', 'audio/flac', 'audio/aac',
].join(',');

// Spacing between sequential broadcasts so the Hive RPC + audio service
// don't see a burst from a single user (avoids rate-limit / dupe-window issues).
const PUBLISH_DELAY_MS = 3500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until a freshly broadcast post is readable from a Hive node. A reply
// sent before the node knows its parent fails with a missing-parent error,
// which is what made the first track of an album fail now and then. Gives up
// after `timeoutMs` and lets the caller carry on (a track that still fails can
// be retried).
async function waitForPost(author, permlink, { timeoutMs = 30000, everyMs = 2000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const { data } = await axios.post(getHiveUrl(), {
        jsonrpc: '2.0', method: 'condenser_api.get_content', params: [author, permlink], id: 1,
      }, { timeout: 8000 });
      if (data?.result?.author) return true;
    } catch {
      // node hiccup: keep polling
    }
    await sleep(everyMs);
  }
  return false;
}

// Square brackets would break the markdown link text in the album's track list.
const mdLinkText = (s) => String(s || '').replace(/[[\]]/g, '').trim();

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

// The track type a playlist's audio kind stands for. "Other sounds" has none,
// so tracks going there keep the type they have.
const TRACK_TYPE_FOR_KIND = { music: 'song', podcast: 'podcast', voice: 'voice_message' };

// Hardcoded suggestions; users can still type any genre into the field.
const MUSIC_GENRES = [
  'Electronic', 'Hip-Hop', 'Rock', 'Pop', 'Jazz', 'Classical', 'Folk',
  'Country', 'Reggae', 'R&B', 'Metal', 'Ambient', 'Funk', 'Soul', 'Blues',
  'Indie', 'Latin', 'World', 'House', 'Techno', 'Drum & Bass', 'Lo-Fi',
];

// Build a `comment_options` op for one permlink, or null if nothing needs
// setting. PPL routes 100% to @threespeak-audio; otherwise /studio-parity
// payout + beneficiaries (non-premium carries the locked threespeakfund split).
function buildCommentOptions(user, permlink, { payout, beneStr, isPremium, ppl, soundAuthors = [] }) {
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
  const chosen = new Set(beneMap.keys());
  enforceLockedBeneficiaries(beneMap, { isPremium, soundAuthors });
  // A song's 5% only where it still fits: the creator may have handed out
  // everything already, and Hive refuses more than 100% in total.
  for (const account of soundAuthors) {
    const total = [...beneMap.values()].reduce((sum, w) => sum + w, 0);
    if (total > 10000 && !chosen.has(account)) beneMap.delete(account);
  }
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

// Songs from the audio editor's music library on a track: the credit line under
// the post, `audio.sound` in its metadata, the 5% split for 3Speak sound creators.
const trackCredits = (track) => (Array.isArray(track?.musicCredits) ? track.musicCredits : []);
const withSound = (audioMeta, credits) => (credits.length ? { ...audioMeta, sound: primarySoundMetadata(credits) } : audioMeta);

function AudioUploadModal({ isOpen, onClose, initialTrack }) {
  const { t } = useTranslation();
  const titleId = useId();
  const [step, setStep] = useState(0); // index into the active flow
  const [tracks, setTracks] = useState([]);
  const tracksRef = useRef(tracks);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
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
  // Hoisted here (above the mode effect and the useCallbacks below) — putting them later would
  // put `isPremium`/`user` in the TDZ when openBeneFor's deps array is built.
  const { user } = useAppStore();
  // A warm-up account publishes under its handle (musicians and podcasters have
  // an audio goal). The post goes to the warm-up service, not to Hive:
  // commentWithAioha diverts it there.
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const warmup = !user && !!incubationHandle;
  const owner = user || incubationHandle;

  // Publish mode:
  //   'snaps'  → each audio = a comment under the latest peak.snaps container
  //   'single' → 1 audio embedded in a standalone Hive post (1 track only)
  //   'album'  → a main post (no audio) + each audio as a comment reply
  const [mode, setMode] = useState('snaps');
  // Keep mode valid for the current track count.
  useEffect(() => {
    setMode((m) => {
      if (warmup) return 'single';
      if (tracks.length <= 1) return m === 'album' ? 'single' : m;
      return m === 'single' ? 'album' : m;
    });
  }, [tracks.length, warmup]);

  // Main/single-post composer (the standalone post, or the album's parent
  // post). post* fields = this composer; tracks carry their own per-track
  // desc/thumb/payout/beneStr.
  const [community, setCommunity] = useState({ name: 'hive-181335', title: 'Threespeak' });
  const [communityOpen, setCommunityOpen] = useState(false);
  const [mainTitle, setMainTitle] = useState('');
  const [postDescription, setPostDescription] = useState('');
  const [postTagsInput, setPostTagsInput] = useState('');
  // The post cover the creator picked, designed or cleared themselves; until
  // they do (postThumbFrom null), the post cover is the playlist's (postThumb,
  // below the playlists).
  const [userPostThumb, setUserPostThumb] = useState('');
  const [postThumbFrom, setPostThumbFrom] = useState(null);
  const [postPayout, setPostPayout] = useState('default');
  const [postBeneStr, setPostBeneStr] = useState('[]');
  // The tracks step's "Apply to all tracks" panel. Its own values, starting
  // empty: they are NOT the main post's, and reach the tracks only when the
  // user clicks Apply to all.
  const [sharedDesc, setSharedDesc] = useState('');
  const [sharedThumb, setSharedThumb] = useState('');
  const [sharedPayout, setSharedPayout] = useState('default');
  const [sharedBeneStr, setSharedBeneStr] = useState('[]');
  // "Add to my blog" (utils/addToBlog.js): reblog the standalone/album post so
  // it reaches the creator's blog and followers' feeds. Snaps have no post.
  const [addToBlog, setAddToBlogState] = useState(readAddToBlog);
  const setAddToBlog = useCallback((on) => { setAddToBlogState(on); writeAddToBlog(on); }, []);
  // Where the success screen links to once everything is published.
  const [published, setPublished] = useState(null);
  // Audiograms going out as Shorts after the episode: { running, n, count, ok, errors }
  // Each Short's state in the publish list: `${trackId}|${audiogram url}` -> { state, stage?, message? }
  const [shortStatus, setShortStatus] = useState({});
  // Album post failed to publish: shown in the review step with its own retry.
  const [mainError, setMainError] = useState(null);
  // Shared Beneficiary_modal — `beneTarget` is 'main', 'shared' or a track id.
  const [beneList, setBeneList] = useState([]);
  const [beneListCount, setBeneListCount] = useState(0);
  const [beneRemaining, setBeneRemaining] = useState(100);
  const [beneOpen, setBeneOpen] = useState(false);
  const [beneTarget, setBeneTarget] = useState('main');
  // 'main' | 'shared' | track id currently uploading a thumbnail, else null.
  const [thumbUploadingId, setThumbUploadingId] = useState(null);
  const thumbInputRef = useRef(null);

  // "Ads on this audio": starts at the account's "Ads on your audio" and overrides it
  // for this upload. null = untouched (the tracks keep following the account, also
  // after a later change there); true / false = written into each track's post.
  const adsVisible = adsEnabledFor(user);
  const [accountAudioAds, setAccountAudioAds] = useState(true);
  const [audioAds, setAudioAds] = useState(null);
  useEffect(() => {
    if (!user || !adsVisible) return undefined;
    let alive = true;
    fetchCreatorAdPrefs(user)
      .then((r) => { if (alive) setAccountAudioAds(r.audioEnabled !== false); })
      .catch(() => { /* unreadable: the switch shows the default, on */ });
    return () => { alive = false; };
  }, [user, adsVisible]);
  const audioAdsOn = audioAds ?? accountAudioAds;
  const setAudioAdsOn = useCallback((on) => setAudioAds(on === accountAudioAds ? null : on), [accountAudioAds]);
  // Into a track's json_metadata, only when overridden. The checker copies it off the chain.
  const audioAdsMeta = audioAds === null ? {} : { '3speak': { audioAds } };
  const mirrorAudioAds = useCallback((hivePermlink) => {
    if (audioAds === null) return;
    // Best effort, never holds up publishing: retried by the helper until the
    // post is readable and linked to its audio.
    syncAudioAdChoice(user, hivePermlink).catch(() => {});
  }, [audioAds, user]);
  const isPremium = !!usePremiumStatus(user)?.premium;

  const patchTrack = useCallback((id, patch) => {
    setTracks(prev => prev.map(tr => (tr.id === id ? { ...tr, ...patch } : tr)));
  }, []);

  // Transcripts: a single post's goes under the post text, a track's (snaps,
  // album) under that track's own text. An earlier transcript is replaced.
  const transcriptTargetRef = useRef({});
  const postTranscriptRef = useRef('');
  const transcripts = useTranscriptJobs((trackId, text) => {
    if (transcriptTargetRef.current[trackId] === 'post') {
      const previous = postTranscriptRef.current;
      postTranscriptRef.current = text;
      setPostDescription((d) => withTranscript(d, previous, text));
      setTracks(prev => prev.map(tr => (tr.id === trackId ? { ...tr, transcriptText: text } : tr)));
    } else {
      setTracks(prev => prev.map(tr => (tr.id === trackId
        ? { ...tr, desc: withTranscript(tr.desc, tr.transcriptText, text), transcriptText: text }
        : tr)));
    }
  });
  const { cancelAll: cancelAllTranscripts } = transcripts;
  const startTranscript = (track, target, lang) => {
    transcriptTargetRef.current[track.id] = target;
    transcripts.start(track, { lang, heading: t('audio.upload.transcript.heading') });
  };
  const transcriptPropsFor = (track, target) => (track ? {
    user: owner,
    track,
    job: transcripts.jobs[track.id],
    hasTranscript: !!track.transcriptText,
    onStart: (lang) => startTranscript(track, target, lang),
    onCancel: () => transcripts.cancel(track.id),
  } : null);

  // The creator's own cover for a target ('main', 'shared' or a track id), from
  // an upload, the cover designer or a clear ('').
  const setCoverFor = useCallback((target, url) => {
    if (target === 'main') { setUserPostThumb(url); setPostThumbFrom('user'); }
    else if (target === 'shared') setSharedThumb(url);
    else setTracks(prev => prev.map(tr => (tr.id === target ? { ...tr, thumb: url } : tr)));
  }, []);

  // The cover designer (thumbnail editor): { target, src } while open.
  const [designFor, setDesignFor] = useState(null);
  // The thumbnail editor for one audiogram's Short: { trackId, url }
  const [shortThumbFor, setShortThumbFor] = useState(null);
  const setShortsOf = useCallback((trackId, audiograms) => patchTrack(trackId, { audiograms }), [patchTrack]);
  const setShortThumb = useCallback((trackId, url, thumbnailUrl) => {
    setTracks(prev => prev.map(tr => (tr.id === trackId
      ? { ...tr, audiograms: (tr.audiograms || []).map(a => (a.url === url ? { ...a, thumbnailUrl } : a)) }
      : tr)));
  }, []);
  const designOpenRef = useRef(false);
  useEffect(() => { designOpenRef.current = !!designFor; }, [designFor]);

  // Upload a cover for a target ('main', 'shared' or a track id) and store the URL.
  const uploadCoverFor = useCallback(async (target, file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error(t('audio.upload.toasts.pickImage')); return; }
    setThumbUploadingId(target);
    try {
      const url = await uploadThumbnail(file);
      setCoverFor(target, url);
    } catch (err) {
      toast.error(t('audio.upload.toasts.thumbFailed', { error: err?.message || t('audio.upload.unknown') }));
    } finally {
      setThumbUploadingId(null);
      if (thumbInputRef.current) thumbInputRef.current.value = '';
    }
  }, [t, setCoverFor]);

  // Copy the "Apply to all tracks" panel onto every track. Only on click: an
  // empty shared cover keeps each track's own.
  const applyToAllTracks = useCallback(() => {
    setTracks(prev => prev.map(tr => ({
      ...tr,
      desc: sharedDesc,
      thumb: sharedThumb || tr.thumb,
      payout: sharedPayout,
      beneStr: sharedBeneStr,
    })));
    toast.success(t('audio.upload.toasts.appliedToAll'));
  }, [sharedDesc, sharedThumb, sharedPayout, sharedBeneStr, t]);

  // Open the beneficiary modal for a target; seed its list from that
  // target's stored JSON.
  const openBeneFor = useCallback((target) => {
    const json = target === 'main'
      ? postBeneStr
      : target === 'shared'
        ? sharedBeneStr
        : (tracks.find(tr => tr.id === target)?.beneStr || '[]');
    let list = [];
    try { list = (JSON.parse(json || '[]') || []).map(b => ({ account: b.account, percent: (b.weight || 0) / 100 })); } catch { list = []; }
    const used = list.reduce((s, b) => s + (b.percent || 0), 0);
    // A track with library songs keeps 5% per 3Speak sound creator free
    const creditTrack = target === 'main' ? (mode === 'single' ? tracks[0] : null)
      : target === 'shared' ? null : tracks.find(tr => tr.id === target);
    const soundShare = soundAuthorsOf(trackCredits(creditTrack), user).length * (SOUND_AUTHOR_WEIGHT / 100);
    setBeneList(list);
    setBeneListCount(list.length);
    setBeneRemaining(Math.max(0, (isPremium ? 100 : 90) - used - soundShare));
    setBeneTarget(target);
    setBeneOpen(true);
  }, [postBeneStr, sharedBeneStr, tracks, isPremium, mode, user]);

  // Write the modal's beneficiary JSON back to its target.
  const writeBeneToTarget = useCallback((json) => {
    if (beneTarget === 'main') setPostBeneStr(json);
    else if (beneTarget === 'shared') setSharedBeneStr(json);
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
  const [pendingPlaylist, setPendingPlaylist] = useState(null); // { id, name, access, type, audio_kind } shown while waiting for indexer

  // The chosen playlist's kind decides what its tracks are (a recording into
  // a podcast playlist is a podcast, not a voice note). Only a kind the owner
  // picked counts. Choosing the playlist retypes the tracks there are; tracks
  // added afterwards start with it. The type stays editable per track.
  const playlistTrackType = useMemo(() => {
    const p = playlists.find((pl) => pl.id === playlistChoice)
      || (pendingPlaylist && pendingPlaylist.id === playlistChoice ? pendingPlaylist : null);
    return TRACK_TYPE_FOR_KIND[storedPlaylistType(p).kind] || null;
  }, [playlists, playlistChoice, pendingPlaylist]);
  // The chosen playlist's cover starts as the post's cover (album post or single
  // post). It follows a change of playlist until the creator picks, designs or
  // clears a cover themselves; then theirs stays. Track covers are left alone:
  // their tiles fall back to the playlist art by themselves.
  const playlistCover = useMemo(() => {
    const p = playlists.find((pl) => pl.id === playlistChoice)
      || (pendingPlaylist && pendingPlaylist.id === playlistChoice ? pendingPlaylist : null);
    return String(p?.thumbnail || p?.metadata?.album?.thumbnail || '').trim();
  }, [playlists, playlistChoice, pendingPlaylist]);
  const postThumb = postThumbFrom === 'user' ? userPostThumb : playlistCover;

  const playlistTrackTypeRef = useRef(null);
  useEffect(() => {
    playlistTrackTypeRef.current = playlistTrackType;
    if (playlistTrackType) setTracks((prev) => prev.map((tr) => (tr.type === playlistTrackType ? tr : { ...tr, type: playlistTrackType })));
  }, [playlistTrackType]);

  // source: 'file' | 'record' | 'editor' (made in the audio editor)
  const addBlobAsTrack = useCallback(async (blob, filename, source = 'file', overrideType = null, extra = {}) => {
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
      type: overrideType ?? playlistTrackTypeRef.current ?? (source === 'record' ? 'voice_message' : 'podcast'),
      edited: source === 'editor',
      musicCredits: sanitizeMusicCredits(extra.musicCredits),
      genre: '',
      bpm: '',
      // Per-track publish config (snaps + album-post comments). Chapters from
      // the audio editor start the description ("0:00 Intro" lines).
      desc: chaptersText(sanitizeChapters(extra.chapters)),
      chaptersText: chaptersText(sanitizeChapters(extra.chapters)),
      // Audiograms from the audio editor: posted as Shorts after this track's post
      audiograms: sanitizeAudiograms(extra.audiograms),
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
      initialTrack.source === 'editor' ? 'editor' : 'record',
      initialTrack.type ?? null,
      { musicCredits: initialTrack.musicCredits, chapters: initialTrack.chapters, audiograms: initialTrack.audiograms },
    );
  }, [isOpen, initialTrack, addBlobAsTrack]);

  const handleFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('audio/') || AUDIO_EXT_RE.test(f.name));
    if (files.length === 0) return;
    for (const f of files) await addBlobAsTrack(f, f.name, 'file');
  }, [addBlobAsTrack]);

  // "Edit audio": the track goes to the audio editor (App.jsx opens it above
  // this modal) and comes back as `audio-editor-result` with the edited MP3,
  // which takes the place of the track's audio. Title, text, cover and type stay.
  const openTrackInEditor = useCallback((track) => {
    if (!track?.blob) return;
    const file = track.blob instanceof File
      ? track.blob
      : new File([track.blob], track.filename || 'audio', { type: track.blob.type || '' });
    window.dispatchEvent(new CustomEvent('open-audio-editor', {
      detail: { file, trackId: track.id, name: track.title || track.filename },
    }));
  }, []);


  const onDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer?.files);
  };
  const onDragOver = (e) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = (e) => { e.preventDefault(); setIsDragging(false); };

  const removeTrack = (id) => {
    transcripts.cancel(id);
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
        // Safari's recorder makes audio/mp4, not webm: keep the type it reports.
        const type = mr.mimeType || recordChunksRef.current[0]?.type || 'audio/webm';
        const blob = new Blob(recordChunksRef.current, { type });
        recordStreamRef.current?.getTracks().forEach(tr => tr.stop());
        recordStreamRef.current = null;
        const idx = newId().slice(0, 4);
        await addBlobAsTrack(blob, `recording-${idx}.${audioFormatFor(blob)}`, 'record');
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

  const handleCreatePlaylist = useCallback(async ({ name, access, credits, musicStyle, year, label, description, thumbnail, audioKind }) => {
    if (!owner) { toast.error(t('audio.upload.toasts.signInFirst')); return; }
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
      // An upload's playlist is always audio, of the kind picked in the form.
      const tf = playlistTypeFields('audio', audioKind);
      const createPayload = {
        name: trimmed,
        access,
        playlist_id: playlistId,
        type: tf.type,
        audio_kind: tf.audio_kind,
        json_metadata: JSON.stringify({ ...tf.meta, ...(extraMeta || {}) }),
      };

      const ops = [
        ['custom_json', {
          required_auths: [],
          required_posting_auths: [owner],
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
          required_posting_auths: [owner],
          id: '3speak_playlist_update',
          json: JSON.stringify(updatePayload),
        }]);
      }

      // A warm-up account's ops go to the playlist service through our server
      // (aioha diverts playlist custom_json for a handle).
      await broadcastAudioOps(ops);
      toast.success(t('audio.upload.toasts.playlistCreated'));
      setPlaylistChoice(playlistId);
      setPendingPlaylist({ id: playlistId, name: trimmed, access, type: tf.type, audio_kind: tf.audio_kind, thumbnail: album.thumbnail || '' });
      setTimeout(() => {
        refetchPlaylists();
        queryClient.invalidateQueries({ queryKey: ['myPlaylists', owner] });
      }, 3000);
      return true;
    } catch (err) {
      toast.error(t('audio.upload.toasts.failedWithError', { error: err?.message || t('audio.upload.unknownError') }));
      return false;
    }
  }, [owner, queryClient, refetchPlaylists, t]);

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
    statusRef.current = { ...statusRef.current, [trackId]: { ...(statusRef.current[trackId] || {}), ...patch } };
    setPublishStatus(prev => ({ ...prev, [trackId]: { ...(prev[trackId] || {}), ...patch } }));
  };

  // trackId → the Hive post each published track became (album track list,
  // success screen).
  const trackPostsRef = useRef({});
  // Mirror of publishStatus that is current inside async loops (retries).
  const statusRef = useRef({});
  const replaceStatuses = useCallback((next) => {
    statusRef.current = next;
    setPublishStatus(next);
  }, []);

  // The edited MP3 back from the audio editor (see openTrackInEditor)
  useEffect(() => {
    if (!isOpen) return undefined;
    const onResult = async (e) => {
      const { trackId, file, durationSec, musicCredits, chapters, audiograms } = e?.detail || {};
      const marks = chaptersText(sanitizeChapters(chapters));
      if (!trackId || !(file instanceof Blob)) return;
      const current = tracksRef.current.find(tr => tr.id === trackId);
      // Gone meanwhile, or out already (the published post keeps its audio)
      if (!current || ['success', 'uploading', 'posting'].includes(statusRef.current[trackId]?.state)) return;
      const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : await probeDuration(file);
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      setTracks(prev => prev.map(tr => {
        if (tr.id !== trackId) return tr;
        if (tr.objectUrl && tr.objectUrl !== url) {
          URL.revokeObjectURL(tr.objectUrl);
          objectUrlsRef.current.delete(tr.objectUrl);
        }
        return {
          ...tr,
          blob: file,
          filename: file.name || 'edited-audio.mp3',
          durationSec: dur,
          objectUrl: url,
          edited: true,
          musicCredits: sanitizeMusicCredits(musicCredits),
          // The chapter list goes into the description (replacing the one an
          // earlier edit put there)
          desc: withChapters(tr.desc, tr.chaptersText, marks),
          chaptersText: marks,
          // the audiograms of this edit (an edit made again brings its own)
          audiograms: sanitizeAudiograms(audiograms),
        };
      }));
      const replaced = current;
      // A failed attempt with the old file starts over with the new one
      if (statusRef.current[trackId]?.state === 'error') {
        const next = { ...statusRef.current };
        delete next[trackId];
        replaceStatuses(next);
      }
      toast.success(t('audio.upload.toasts.editedApplied', { title: replaced.title || replaced.filename }));
    };
    window.addEventListener('audio-editor-result', onResult);
    return () => window.removeEventListener('audio-editor-result', onResult);
  }, [isOpen, t, replaceStatuses]);

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
        { owner, permlink: audioPermlink, thumbnail: thumb },
        { headers: { Authorization: `Bearer ${CHECKER_API_KEY}` } },
      );
    } catch (thumbErr) {
      console.warn('Audio thumbnail Mongo update failed (non-fatal):', thumbErr?.message);
    }
  }, [owner]);

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
      required_posting_auths: [owner],
      id: '3speak_playlist_add',
      json: JSON.stringify({ playlist_id: playlistChoice, author: owner, permlink, position: 0 }),
    },
  ]);

  // "Add to my blog": reblog the post right after it is out, as its own
  // broadcast (the way Ecency does it). Never fails the publish.
  const shareToBlog = useCallback(async (permlink) => {
    if (!addToBlog) return;
    try {
      await broadcastAudioOps([reblogOp(user, user, permlink)]);
    } catch (err) {
      toast.error(t('audio.upload.toasts.addToBlogFailed', { error: err?.message || t('audio.upload.unknown') }));
    }
  }, [addToBlog, user, t]);

  // ── single (standalone post, audio embedded — uses the main composer) ──
  const publishSinglePost = useCallback(async (track) => {
    setTrackStatus(track.id, { state: 'uploading', stage: 'upload', message: undefined });
    // The post's title is the audio's title too: the track title is only the
    // filename-derived default here ("recording 4702"), and audio cards and the
    // audio page read the audio row, not the post.
    const postTitle = (mainTitle || track.title || '').trim() || 'Audio';
    const { permlink: audioPermlink, playUrl } = await uploadAudioTo3Speak({
      blob: track.blob, filename: track.filename, durationSec: track.durationSec, username: owner, title: postTitle,
    });
    setTrackStatus(track.id, { state: 'posting', stage: 'post', playUrl });
    // A warm-up post takes the audio's own id as its permlink, as a warm-up video
    // does: the post replayed on Hive at graduation keeps it, and the audio row
    // already points at it.
    const hivePermlink = warmup ? audioPermlink : (generatePermlink(postTitle) || audioPermlink);
    const userTags = postTagsInput.split(/[\s,]+/).map(tr => tr.trim().toLowerCase()).filter(Boolean);
    const tags = userTags.length ? Array.from(new Set(userTags)) : Array.from(new Set(HIVE_DEFAULT_TAGS));
    // The chapters from the audio editor under the text (unless it already has them)
    const written = (postDescription || '').trim();
    const chapterList = track.chaptersText && !written.includes(track.chaptersText) ? track.chaptersText : '';
    const desc = [written || (chapterList ? '' : postTitle), chapterList].filter(Boolean).join('\n\n');
    const cover = postThumb ? `![${(postTitle || 'cover').replace(/[[\]]/g, '')}](${postThumb})\n\n` : '';
    const credits = trackCredits(track);
    const body = `${cover}${playUrl}\n\n${desc}`.trim() + soundCreditsMarkdown(credits);
    // A standalone track is a top-level titled post, so an Article carrying one
    // audio attribute. `threespeak.audio` mirrors the bare `audio` key above it:
    // the bare one is what our own readers already parse, the namespaced one is
    // the version other frontends can look up.
    const audioMeta = audioMetaFor(track);
    const metaObj = {
      app: HIVE_APP_NAME,
      tags,
      audio: withSound(audioMeta, credits),
      ...oaEnvelope(OA_ARTICLE),
      ...threespeakAudio({ ...audioMeta, duration: track.durationSec }),
      ...audioAdsMeta,
    };
    if (postThumb) metaObj.image = [postThumb];

    if (warmup) {
      // No Article envelope (`oa`): the warm-up service files an Article as a VIDEO,
      // which would tick a creator's video goal and list the audio among videos.
      // Without it this is a post; the audio keys above still mark it as audio. No
      // ad choice either (that is a creator setting of a Hive account).
      const warmMeta = { ...metaObj };
      delete warmMeta.oa;
      for (const k of Object.keys(audioAdsMeta || {})) delete warmMeta[k];
      await commentWithAioha(
        '', (community && community.name) || tags[0], hivePermlink,
        postTitle, body, warmMeta,
      );
      await linkAudioToPost({ audioPermlink, postPermlink: hivePermlink, username: owner });
      // Not in one transaction with the post as on chain: the post is out either way.
      if (playlistChoice) {
        try {
          await broadcastAudioOps([playlistAddOp(hivePermlink)]);
        } catch (err) {
          toast.error(t('audio.upload.toasts.failedWithError', { error: err?.message || t('audio.upload.unknownError') }));
        }
      }
      await pushAudioThumb(audioPermlink, postThumb);
      trackPostsRef.current[track.id] = { author: owner, permlink: hivePermlink, title: postTitle };
      setTrackStatus(track.id, { state: 'success', stage: undefined });
      return;
    }

    const ops = [[
      'comment',
      {
        parent_author: '',
        parent_permlink: (community && community.name) || tags[0],
        author: user,
        permlink: hivePermlink,
        title: postTitle,
        body,
        json_metadata: JSON.stringify(metaObj),
      },
    ]];
    const co = buildCommentOptions(user, hivePermlink, {
      payout: postPayout, beneStr: postBeneStr, isPremium, ppl: rewardMode === 'ppl',
      soundAuthors: soundAuthorsOf(credits, user),
    });
    if (co) ops.push(co);
    if (playlistChoice) ops.push(playlistAddOp(hivePermlink));

    await broadcastAudioOps(ops);
    await linkAudioToPost({ audioPermlink, postPermlink: hivePermlink, username: user });
    mirrorAudioAds(hivePermlink);
    await shareToBlog(hivePermlink);
    await pushAudioThumb(audioPermlink, postThumb);
    trackPostsRef.current[track.id] = { author: user, permlink: hivePermlink, title: postTitle };
    setTrackStatus(track.id, { state: 'success', stage: undefined });
  }, [user, owner, warmup, mainTitle, community, postDescription, postTagsInput, postThumb, postPayout, postBeneStr, isPremium, rewardMode, playlistChoice, pushAudioThumb, shareToBlog, audioAds, mirrorAudioAds]);

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
    // The album post itself is NOT added to the playlist: only the tracks are.
    // It carries no audio, so in the playlist it showed up as an empty video.
    await broadcastAudioOps(ops);
    // Kept so the post can be edited later with links to its tracks.
    albumMainRef.current = {
      author: user,
      permlink: hivePermlink,
      parentPermlink: ops[0][1].parent_permlink,
      title: ops[0][1].title,
      body,
      jsonMetadata: ops[0][1].json_metadata,
      linkedBody: null,
    };
    // Replies need their parent to exist on the node first.
    await waitForPost(user, hivePermlink);
    await shareToBlog(hivePermlink);
    return albumMainRef.current;
  }, [user, mainTitle, community, postDescription, postTagsInput, postThumb, postPayout, postBeneStr, isPremium, shareToBlog]);

  // After the tracks: edit the album post to list them with links, so they
  // stay easy to find once a long discussion pushes the replies down. Post
  // bodies go to Hive, so the heading stays English like the rest of the post.
  const linkAlbumTracks = useCallback(async () => {
    const main = albumMainRef.current;
    if (!main) return;
    const done = tracks.map((tr) => trackPostsRef.current[tr.id]).filter(Boolean);
    if (done.length === 0) return;
    const list = done
      .map((p, i) => `${i + 1}. [${mdLinkText(p.title) || 'Track'}](/@${p.author}/${p.permlink})`)
      .join('\n');
    const body = `${main.body}\n\n---\n\n**Tracks**\n\n${list}`;
    if (body === main.linkedBody) return;
    await broadcastAudioOps([[
      'comment',
      {
        parent_author: '',
        parent_permlink: main.parentPermlink,
        author: main.author,
        permlink: main.permlink,
        title: main.title,
        body,
        json_metadata: main.jsonMetadata,
      },
    ]]);
    main.linkedBody = body;
  }, [tracks]);

  // ── one audio as a comment under `parent` (snaps container OR album main) ──
  // Uses the track's own desc/thumb/payout/beneficiaries.
  const publishTrackComment = useCallback(async (track, parent) => {
    setTrackStatus(track.id, { state: 'uploading', stage: 'upload', message: undefined });
    const { permlink: audioPermlink, playUrl } = await uploadAudioTo3Speak({
      blob: track.blob, filename: track.filename, durationSec: track.durationSec, username: user, title: track.title,
    });
    setTrackStatus(track.id, { state: 'posting', stage: 'post', playUrl });
    const hivePermlink = generatePermlink(track.title) || audioPermlink;
    const tags = Array.from(new Set(HIVE_DEFAULT_TAGS));
    const desc = (track.desc || '').trim() || (track.title || '').trim();
    // Only the track's own cover. The album/post cover is not copied onto the
    // tracks unless the user applies it to all; tiles fall back to the album
    // art by themselves (checker playlist_thumbnail).
    const tThumb = track.thumb || '';
    const cover = tThumb ? `![${(track.title || 'cover').replace(/[[\]]/g, '')}](${tThumb})\n\n` : '';
    const credits = trackCredits(track);
    const body = `${cover}${playUrl}\n\n${desc}`.trim() + soundCreditsMarkdown(credits);
    // Both modes post the track as a reply, but to different parents, and the
    // object follows the parent: an album track replies to our own album post,
    // so it is a Comment; a snap replies to the peak.snaps container, which
    // makes it a MicroPost and keeps it readable in other apps' snap feeds.
    const audioMeta = audioMetaFor(track);
    const metaObj = {
      app: HIVE_APP_NAME,
      tags,
      audio: withSound(audioMeta, credits),
      ...oaEnvelope(mode === 'album' ? OA_COMMENT : OA_MICROPOST),
      ...threespeakAudio({ ...audioMeta, duration: track.durationSec }),
      ...audioAdsMeta,
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
      soundAuthors: soundAuthorsOf(credits, user),
    });
    if (co) ops.push(co);
    if (playlistChoice) ops.push(playlistAddOp(hivePermlink));

    await broadcastAudioOps(ops);
    await linkAudioToPost({ audioPermlink, postPermlink: hivePermlink, username: user });
    mirrorAudioAds(hivePermlink);
    await pushAudioThumb(audioPermlink, tThumb);
    trackPostsRef.current[track.id] = { author: user, permlink: hivePermlink, title: track.title };
    setTrackStatus(track.id, { state: 'success', stage: undefined });
  }, [user, mode, isPremium, rewardMode, playlistChoice, pushAudioThumb, audioAds, mirrorAudioAds]);

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

  // Where "Open post" / "Open playlist" go once every track is published.
  const publishedLinks = useCallback(() => {
    let post = null;
    if (mode === 'album' && albumMainRef.current) {
      post = `/post/${albumMainRef.current.author}/${albumMainRef.current.permlink}`;
    } else if (warmup) {
      // A warm-up post lives on their warm-up profile until they graduate.
      if (trackPostsRef.current[tracks[0]?.id]) post = '/profile';
    } else if (mode === 'single') {
      const p = trackPostsRef.current[tracks[0]?.id];
      if (p) post = `/audio/${p.author}/${p.permlink}`;
    }
    return {
      post,
      playlist: playlistChoice ? `/playlist/${playlistChoice}` : null,
      profileAudio: mode === 'snaps' && user ? `/@${user}?tab=audio` : null,
    };
  }, [mode, tracks, playlistChoice, user, warmup]);

  // The modal stays mounted (App.jsx), so a closed session would otherwise
  // reopen with the last upload still in it. Every close starts fresh.
  const resetSession = useCallback(() => {
    setStep(0);
    setTracks((prev) => {
      prev.forEach((tr) => {
        if (tr.objectUrl) {
          URL.revokeObjectURL(tr.objectUrl);
          objectUrlsRef.current.delete(tr.objectUrl);
        }
      });
      return [];
    });
    setPlaylistChoice(null);
    replaceStatuses({});
    setMainTitle('');
    setPostDescription('');
    cancelAllTranscripts();
    postTranscriptRef.current = '';
    transcriptTargetRef.current = {};
    setPostTagsInput('');
    setUserPostThumb('');
    setPostThumbFrom(null);
    setDesignFor(null);
    setPostPayout('default');
    setPostBeneStr('[]');
    setSharedDesc('');
    setSharedThumb('');
    setSharedPayout('default');
    setSharedBeneStr('[]');
    setBeneList([]);
    setPublished(null);
    setShortStatus({});
    setMainError(null);
    albumMainRef.current = null;
    containerRef.current = null;
    trackPostsRef.current = {};
  }, [replaceStatuses, cancelAllTranscripts]);

  const closeModal = useCallback(() => {
    resetSession();
    onClose();
  }, [resetSession, onClose]);

  // Once everything is published there is nothing left to lose.
  const hasUnsavedWork = (tracks.length > 0 || isRecording) && !published;

  const attemptClose = useCallback(() => {
    if (hasUnsavedWork) {
      setShowCloseConfirm(true);
    } else {
      closeModal();
    }
  }, [hasUnsavedWork, closeModal]);

  // Esc to close (with confirm guard)
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Esc in the cover designer closes the designer only
      if (designOpenRef.current) return;
      if (showCloseConfirm) setShowCloseConfirm(false);
      else attemptClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, attemptClose, showCloseConfirm]);

  // Once every track is out (by the first run or by retries), show where
  // everything landed. statusRef has the latest states even inside a retry loop.
  const markDoneIfComplete = useCallback(() => {
    const done = tracks.length > 0 && tracks.every((tr) => statusRef.current[tr.id]?.state === 'success');
    if (done) setPublished(publishedLinks());
  }, [tracks, publishedLinks]);

  // Album only: refresh the track list on the album post. Never fails the
  // publish; the tracks are out either way.
  const finishAlbum = useCallback(async () => {
    if (mode !== 'album') return;
    try {
      await linkAlbumTracks();
    } catch (err) {
      toast.error(t('audio.upload.toasts.trackLinksFailed', { error: err?.message || t('audio.upload.unknown') }));
    }
  }, [mode, linkAlbumTracks, t]);

  // A track's audiograms as Shorts, once the track is on Hive, linking to it
  // (its page is /audio/<author>/<permlink>, for a standalone post, a snap or an
  // album track alike); `only`: just that one (a retry). Not for a warm-up
  // account: Shorts need the Hive account. Never throws: returns the results.
  const postShortsOf = useCallback(async (track, only = null) => {
    const episode = trackPostsRef.current[track.id];
    const list = (track.audiograms || []).filter((a) => !only || a.url === only);
    if (warmup || !user || !episode || list.length === 0) return [];
    const set = (a, st) => setShortStatus((s) => ({ ...s, [`${track.id}|${a.url}`]: st }));
    list.forEach((a) => set(a, { state: 'pending' }));
    const userTags = postTagsInput.split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
    return publishAudiogramShorts({
      audiograms: list,
      user,
      isPremium,
      episode,
      tags: Array.from(new Set(userTags)),
      broadcast: broadcastAudioOps,
      onProgress: ({ index, step, ok, error }) => {
        const a = list[index];
        if (step === 'upload') set(a, { state: 'uploading', stage: 'upload' });
        else if (step === 'post') set(a, { state: 'posting', stage: 'post' });
        else if (step === 'done') set(a, ok ? { state: 'success' } : { state: 'error', message: error });
      },
    });
  }, [warmup, user, isPremium, postTagsInput]);

  const retryShort = useCallback(async (trackId, url) => {
    const track = tracks.find((tr) => tr.id === trackId);
    if (!track) return;
    setIsPublishing(true);
    const results = await postShortsOf(track, url);
    setIsPublishing(false);
    const failed = results.find((r) => !r.ok);
    if (failed) toast.error(t('audio.upload.shorts.failed', { error: failed.error }));
  }, [tracks, postShortsOf, t]);

  const retryTrack = useCallback(async (trackId) => {
    const track = tracks.find((tr) => tr.id === trackId);
    if (!track) return;
    setIsPublishing(true);
    try {
      const parent = mode === 'single' ? null : await resolveParent();
      await publishOneTrack(track, parent);
      // now on Hive: its Shorts go out with it
      await postShortsOf(track);
      await finishAlbum();
      markDoneIfComplete();
      if (playlistChoice) queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
    } catch (err) {
      const message = uploadErrorText(err, t);
      setTrackStatus(trackId, { state: 'error', stage: undefined, message });
    } finally {
      setIsPublishing(false);
    }
  }, [tracks, mode, resolveParent, publishOneTrack, postShortsOf, finishAlbum, markDoneIfComplete, playlistChoice, queryClient, user, t]);

  const retryAllFailed = useCallback(async () => {
    const failed = tracks.filter((tr) => publishStatus[tr.id]?.state === 'error');
    if (failed.length === 0) return;
    for (let i = 0; i < failed.length; i++) {
      if (i > 0) await sleep(PUBLISH_DELAY_MS); // throttle between tracks
      // eslint-disable-next-line no-await-in-loop
      await retryTrack(failed[i].id);
    }
  }, [tracks, publishStatus, retryTrack]);

  const allPublished = tracks.length > 0 && tracks.every(tr => publishStatus[tr.id]?.state === 'success');

  /* The pre-upload spot, as in the video studio (EmbedPreview): fetched when the modal
   * opens, played only when they press "Watch ad to publish", and it fails open: no ad,
   * an error or a spot that will not play all leave Publish live. Completed on the
   * checker only once the audio is out (/m/:sid/posted finds it in embed-audio). */
  const portalDoc = usePortalDoc();
  const [pendingAd, setPendingAd] = useState(null);
  const [gateAd, setGateAd] = useState(null);
  const [gateWatched, setGateWatched] = useState(false);
  const gateSidRef = useRef(null);
  useEffect(() => {
    if (!isOpen || !user) return undefined;
    let alive = true;
    fetchUploadGateAd(user)
      .then((ad) => { if (alive && ad) setPendingAd(ad); })
      .catch(() => { /* fail open */ });
    return () => { alive = false; };
  }, [isOpen, user]);
  // Only a spot that actually played is an impression; the gate unlocks either way.
  const onGateWatched = useCallback((played) => {
    if (played) gateSidRef.current = gateSessionId(gateAd);
    setGateWatched(true);
    setGateAd(null);
    setPendingAd(null);
  }, [gateAd]);
  useEffect(() => {
    if (!gateSidRef.current || !published) return;
    const first = Object.values(trackPostsRef.current)[0];
    if (!first?.permlink) return;
    confirmUploadGatePost(gateSidRef.current, first.permlink);
    gateSidRef.current = null;   // once only
  }, [published]);
  const gateSatisfied = gateWatched || !pendingAd;

  if (!isOpen) return null;

  const flow = warmup ? FLOWS.warmup : (FLOWS[mode] || FLOWS.snaps);
  const stepKey = flow[Math.min(step, flow.length - 1)];
  const isLastStep = step >= flow.length - 1;
  const canNext = (() => {
    if (stepKey === 'source') return tracks.length > 0 && !isRecording && (!warmup || tracks.length === 1);
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
    if (!owner) { toast.error(t('audio.upload.toasts.signInFirst')); return; }
    // The button is swapped while a spot is outstanding; this is the publish path itself.
    if (!gateSatisfied) return;
    if (tracks.length === 0) return;
    if (transcripts.running) { toast.error(t('audio.upload.transcript.waitPublish')); return; }
    setIsPublishing(true);
    setMainError(null);
    setPublished(null);

    const initial = {};
    for (const tr of tracks) initial[tr.id] = { state: 'pending' };
    replaceStatuses(initial);

    // Resolve the shared parent up front (snap container, or broadcast the
    // album's main post first). Single posts are top-level — no parent.
    let parent = null;
    if (mode !== 'single') {
      try {
        parent = await resolveParent();
      } catch (err) {
        setIsPublishing(false);
        const errorText = err?.message || t('audio.upload.unknown');
        // Shown in the review step too, with its own retry: nothing went out,
        // so publishing again starts cleanly.
        setMainError(errorText);
        replaceStatuses({});
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
        const message = uploadErrorText(err, t);
        setTrackStatus(track.id, { state: 'error', stage: undefined, message });
      }
    }

    await finishAlbum();

    // The audiograms from the audio editor, as Shorts: each posted track's, linking to it
    const shortErrors = [];
    let shortsRan = false;
    for (const tr of tracks) {
      if (!trackPostsRef.current[tr.id] || !tr.audiograms?.length || warmup || !user) continue;
      if (shortsRan) await sleep(PUBLISH_DELAY_MS);
      shortsRan = true;
      const results = await postShortsOf(tr);
      shortErrors.push(...results.filter(r => !r.ok).map(r => r.error));
    }
    if (shortErrors.length) toast.error(t('audio.upload.shorts.failed', { error: shortErrors[0] }));
    setIsPublishing(false);

    if (allOk) {
      toast.success(t('audio.upload.toasts.published', { count: tracks.length }));
      queryClient.invalidateQueries({ queryKey: ['myPlaylists', user] });
      // No auto-close: the review step now shows where everything landed.
      markDoneIfComplete();
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
      <div
        className="audio-upload-modal audio-upload-modal-wizard"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="audio-upload-grab" aria-hidden="true" />
        <div className="audio-upload-header">
          <span className="audio-upload-header-icon" aria-hidden="true"><Icon name="graphic_eq" size={20} /></span>
          <h2 id={titleId}>{t('audio.upload.title')}</h2>
          <IconButton icon="close" label={t('common.actions.close')} size={36} variant="ghost" round onClick={attemptClose} />
        </div>

        {(authChecking || rcChecking || needsAuth || rcInsufficient) ? (
          <div className="audio-upload-body">
            <div className="audio-upload-auth-gate">
              {(authChecking || rcChecking) ? (
                <p className="audio-upload-gate-checking"><Icon name="progress_activity" size={18} className="v2-spin" /> {t('audio.upload.gate.checking')}</p>
              ) : needsAuth ? (
                <>
                  <span className="audio-upload-gate-icon is-cyan" aria-hidden="true"><Icon name="verified_user" size={28} /></span>
                  <p><Trans i18nKey="audio.upload.gate.allowThreespeak" components={{ b: <strong /> }} /></p>
                  <Button variant="primary" size={44} next onClick={handleAuthorize} disabled={authorizing} loading={authorizing}>
                    {authorizing ? t('audio.upload.gate.authorizing') : t('audio.upload.gate.authorize')}
                  </Button>
                </>
              ) : (
                <>
                  <span className="audio-upload-gate-icon" aria-hidden="true"><Icon name="battery_alert" size={28} /></span>
                  <p><Trans i18nKey="audio.upload.gate.notEnoughRc" components={{ b: <strong /> }} /></p>
                  <Button variant="secondary" size={44} icon="help" onClick={() => setRcModalOpen(true)}>
                    {t('audio.upload.gate.whyCantUpload')}
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (<>
        {/* Multi-step: a 4px bar per step (accent = done or current), labels under it (§11) */}
        <ol className="audio-upload-steps" style={{ '--steps': flow.length }} aria-label={t('audio.upload.title')}>
          {flow.map((key, i) => (
            <li
              key={key}
              className={`audio-upload-step${step === i ? ' active' : ''}${step > i ? ' done' : ''}`}
              aria-current={step === i ? 'step' : undefined}
            >
              <span className="audio-upload-step-bar" aria-hidden="true" />
              <span className="audio-upload-step-label">
                {step > i && <Icon name="check" size={14} />}
                {t(STEP_LABEL_KEYS[key])}
              </span>
            </li>
          ))}
        </ol>

        <div className="audio-upload-body">
          {stepKey === 'source' && warmup && tracks.length > 1 && (
            <Banner tone="warn" className="audio-upload-warmup-note">{t('audio.upload.warmupOneTrack')}</Banner>
          )}
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
              teleprompter={<AudioTeleprompter recording={isRecording} streamRef={recordStreamRef} user={owner} />}
              onRemove={removeTrack}
              onEditTrack={FEATURE_EDITOR ? openTrackInEditor : null}
              editLocked={(id) => isPublishing || ['success', 'uploading', 'posting'].includes(publishStatus[id]?.state)}
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
              adsVisible={adsVisible}
              audioAdsOn={audioAdsOn}
              setAudioAdsOn={setAudioAdsOn}
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
              defaultKind={mode === 'snaps' ? 'voice' : mode === 'album' ? 'music' : trackCategoryToKind(tracks[0]?.type || 'podcast')}
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
              setThumb={(url) => setCoverFor('main', url)}
              thumbFromPlaylist={postThumbFrom !== 'user' && !!postThumb}
              onDesignThumb={() => setDesignFor({ target: 'main', src: postThumb || null })}
              thumbUploading={thumbUploadingId === 'main'}
              thumbRef={thumbInputRef}
              onPickThumb={(file) => uploadCoverFor('main', file)}
              payout={postPayout}
              setPayout={setPostPayout}
              beneCount={beneList.length}
              onOpenBene={() => openBeneFor('main')}
              addToBlog={addToBlog}
              setAddToBlog={setAddToBlog}
              warmup={warmup}
              onShortsChange={setShortsOf}
              onDesignShortThumb={(trackId, url) => setShortThumbFor({ trackId, url })}
              shortsLocked={isPublishing}
              transcript={stepKey === 'post' ? transcriptPropsFor(tracks[0], 'post') : null}
            />
          )}
          {stepKey === 'tracks' && (
            <TracksStep
              tracks={tracks}
              mode={mode}
              patchTrack={patchTrack}
              sharedDesc={sharedDesc}
              setSharedDesc={setSharedDesc}
              sharedThumb={sharedThumb}
              setSharedThumb={(url) => setCoverFor('shared', url)}
              onDesignCover={(target, src) => setDesignFor({ target, src: src || null })}
              onEditTrack={FEATURE_EDITOR ? openTrackInEditor : null}
              editLocked={(id) => isPublishing || ['success', 'uploading', 'posting'].includes(publishStatus[id]?.state)}
              sharedPayout={sharedPayout}
              setSharedPayout={setSharedPayout}
              sharedBeneCount={(() => { try { return (JSON.parse(sharedBeneStr || '[]') || []).length; } catch { return 0; } })()}
              applyToAllTracks={applyToAllTracks}
              onOpenBene={openBeneFor}
              uploadCoverFor={uploadCoverFor}
              thumbUploadingId={thumbUploadingId}
              thumbRef={thumbInputRef}
              onShortsChange={setShortsOf}
              onDesignShortThumb={(trackId, url) => setShortThumbFor({ trackId, url })}
              shortsLocked={isPublishing}
              transcriptPropsFor={(tr) => transcriptPropsFor(tr, 'track')}
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
              mainError={mainError}
              onRetryMain={onPublish}
              published={published}
              onNavigate={closeModal}
              shortsCount={warmup ? 0 : tracks.reduce((n, tr) => n + (tr.audiograms?.length || 0), 0)}
              shortStatus={shortStatus}
              onRetryShort={retryShort}
              showShorts={!warmup}
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
            <Button variant="secondary" size={44} icon="arrow_back" onClick={goBack} disabled={isPublishing}>
              {t('common.actions.back')}
            </Button>
          ) : <span />}
          {!isLastStep ? (
            <Button variant="primary" size={44} next onClick={goNext} disabled={!canNext}>
              {t('common.actions.next')}
            </Button>
          ) : allPublished ? (
            <Button variant="inverse" size={44} icon="check" onClick={closeModal}>
              {t('common.actions.close')}
            </Button>
          ) : !gateSatisfied ? (
            <Button
              variant="primary"
              size={44}
              icon="smart_display"
              onClick={() => { if (pendingAd && !gateAd) setGateAd(pendingAd); }}
              title={t('upload.review.watchSponsorFirst')}
            >
              {t('upload.review.watchAdToPublish')}
            </Button>
          ) : (
            <Button
              variant="primary"
              size={44}
              trailing="send"
              onClick={onPublish}
              disabled={isPublishing}
              loading={isPublishing}
            >
              {isPublishing ? t('audio.upload.publishing') : t('common.actions.publish')}
            </Button>
          )}
        </div>
        </>)}

        {gateAd && createPortal(<UploadGate ad={gateAd} onWatched={onGateWatched} />, portalDoc.body)}

        {/* The thumbnail editor for a cover; inside the modal box so its clicks
            never reach the backdrop's close */}
        {designFor && (
          <CoverDesigner
            key={`${designFor.target}:${designFor.src || ''}`}
            src={designFor.src}
            onClose={() => setDesignFor(null)}
            onDone={(url) => { setCoverFor(designFor.target, url); setDesignFor(null); }}
          />
        )}

        {/* The thumbnail editor for a Short made from an audiogram (9:16) */}
        {shortThumbFor && (
          <ShortThumbDesigner
            key={`${shortThumbFor.trackId}:${shortThumbFor.url}`}
            videoUrl={shortThumbFor.url}
            owner={user}
            onClose={() => setShortThumbFor(null)}
            onDone={(url) => { setShortThumb(shortThumbFor.trackId, shortThumbFor.url, url); setShortThumbFor(null); }}
          />
        )}

        {showCloseConfirm && (
          <div className="audio-upload-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="audio-upload-confirm-card" role="alertdialog" aria-labelledby={`${titleId}-discard`}>
              <span className="audio-upload-confirm-icon" aria-hidden="true"><Icon name="delete" size={22} /></span>
              <h4 id={`${titleId}-discard`}>{t('audio.upload.discard.title')}</h4>
              <p>
                {isRecording
                  ? t('audio.upload.discard.bodyRecording', { count: tracks.length })
                  : t('audio.upload.discard.body', { count: tracks.length })}
              </p>
              <div className="audio-upload-confirm-actions">
                <Button
                  variant="secondary"
                  size={44}
                  onClick={() => setShowCloseConfirm(false)}
                  autoFocus
                >
                  {t('audio.upload.discard.keepEditing')}
                </Button>
                <Button
                  variant="danger"
                  size={44}
                  icon="delete"
                  onClick={() => { setShowCloseConfirm(false); closeModal(); }}
                >
                  {t('audio.upload.discard.discard')}
                </Button>
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
  onStart, onStop, onRemove, onEditTrack = null, editLocked = () => false,
  teleprompter = null,
}) {
  const { t } = useTranslation();
  return (
    <>
      <div className="audio-upload-source-row">
        <div
          className={`audio-upload-dropzone${isDragging ? ' dragging' : ''}`}
          onClick={onPickFiles}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPickFiles(); } }}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          role="button"
          tabIndex={0}
        >
          <Icon name="library_music" size={28} className="audio-upload-dropzone-icon" />
          <p>{t('audio.upload.source.dropHere')}</p>
          <small>{t('audio.upload.source.formats')}</small>
          <input
            ref={fileInputRef}
            type="file"
            accept={AUDIO_ACCEPT}
            multiple
            hidden
            onChange={onFilesSelected}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
        <div className={`audio-upload-recorder${isRecording ? ' recording' : ''}`}>
          <span className="audio-upload-rec-icon" aria-hidden="true">
            {isRecording ? <span className="audio-upload-rec-dot" /> : <Icon name="mic" size={24} />}
          </span>
          {isRecording ? (
            <div className="audio-upload-rec-text">
              <b className="audio-upload-rec-time">{fmtTime(recordSec)}</b>
              <small>{t('audio.upload.source.recordLimit', { minutes: Math.round(MAX_RECORD_SEC / 60) })}</small>
            </div>
          ) : (
            <div className="audio-upload-rec-text">
              <p>{t('audio.upload.source.orRecord')}</p>
              <small>{t('audio.upload.source.recordLimit', { minutes: Math.round(MAX_RECORD_SEC / 60) })}</small>
            </div>
          )}
          {isRecording ? (
            <Button variant="danger" size={40} icon="stop" onClick={onStop}>
              {t('audio.upload.source.stop')}
            </Button>
          ) : (
            <Button variant="secondary" size={40} icon="fiber_manual_record" onClick={onStart}>
              {t('audio.upload.source.record')}
            </Button>
          )}
        </div>
      </div>
      {teleprompter}
      {tracks.length > 0 && (
        <div className="audio-upload-track-list">
          <h4 className="v2-eyebrow">{t('audio.upload.source.added', { count: tracks.length })}</h4>
          {tracks.map(tr => (
            <div key={tr.id} className="audio-upload-track-row">
              <span className="audio-upload-track-source" title={tr.source === 'record' ? t('audio.upload.recorded') : t('audio.upload.uploaded')}>
                <Icon name={tr.source === 'record' ? 'mic' : 'audio_file'} size={18} />
              </span>
              <span className="audio-upload-track-name">{tr.filename}</span>
              {tr.edited && <EditedBadge />}
              <span className="audio-upload-track-meta">{fmtTime(tr.durationSec)}</span>
              {onEditTrack && tr.blob && (
                <EditAudioButton onClick={() => onEditTrack(tr)} disabled={editLocked(tr.id)} />
              )}
              <IconButton icon="delete" label={t('common.actions.remove')} size={32} variant="ghost" round className="audio-upload-track-remove" onClick={() => onRemove(tr.id)} />
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
            <IconButton icon="delete" label={t('common.actions.remove')} size={32} variant="ghost" round className="audio-upload-track-remove" onClick={() => onRemove(tr.id)} />
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

function PlaylistStep({ playlists, loading, choice, onChoose, pendingPlaylist, onCreate, required = false, defaultKind = 'podcast' }) {
  const { t } = useTranslation();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAccess, setNewAccess] = useState('public');
  const [newKind, setNewKind] = useState(defaultKind);
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
    setNewKind(defaultKind);
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
      // Album details belong to music playlists only (the form hides them otherwise).
      ...(newKind === 'music' ? { credits: newCredits, musicStyle: newMusicStyle, year: newYear, label: newLabel } : {}),
      description: newDescription,
      thumbnail: thumbnailUrl,
      audioKind: newKind,
    });
    setSubmitting(false);
    if (ok) resetForm();
  };

  // One playlist (or none) as a choice card: cyan, the secondary selection (36a)
  const accessSub = (access, text) => (
    <span className="audio-upload-playlist-sub">
      <Icon name={access === 'private' ? 'lock' : 'public'} size={12} />
      {text}
    </span>
  );

  return (
    <div className="audio-upload-playlist-step">
      <p className="audio-upload-step-help">
        {required
          ? t('audio.upload.playlist.helpRequired')
          : t('audio.upload.playlist.helpOptional')}
      </p>
      <p className="audio-upload-step-note">{t('audio.upload.playlist.onlyOn3Speak')}</p>

      <div className="v2-choices audio-upload-playlist-list" role="radiogroup" aria-label={t('audio.upload.steps.playlist')}>
        {!required && (
          <ChoiceCard
            tone="cyan"
            className="audio-upload-playlist-item"
            icon="playlist_remove"
            selected={choice === null}
            onClick={() => onChoose(null)}
            title={t('audio.upload.playlist.none')}
            sub={t('audio.upload.playlist.noneHint')}
          />
        )}

        {showPending && (
          <ChoiceCard
            tone="cyan"
            className="audio-upload-playlist-item audio-upload-playlist-pending"
            icon="playlist_add_check"
            selected={choice === pendingPlaylist.id}
            onClick={() => onChoose(pendingPlaylist.id)}
            title={pendingPlaylist.name}
            sub={accessSub(pendingPlaylist.access, t('audio.upload.playlist.creatingPending'))}
          />
        )}

        {loading ? (
          <div className="audio-upload-playlist-loading"><Icon name="progress_activity" size={18} className="v2-spin" /> {t('audio.upload.playlist.loading')}</div>
        ) : playlists.length === 0 && !showPending ? (
          <div className="audio-upload-playlist-empty">{t('audio.upload.playlist.empty')}</div>
        ) : (
          playlists.map(p => (
            <ChoiceCard
              key={p.id}
              tone="cyan"
              className="audio-upload-playlist-item"
              icon={choice === p.id ? 'playlist_add_check' : 'queue_music'}
              selected={choice === p.id}
              onClick={() => onChoose(p.id)}
              title={p.name}
              sub={accessSub(p.access, t('audio.upload.playlist.items', { count: p.items?.length || 0 }))}
            />
          ))
        )}
      </div>

      {!showCreateForm ? (
        <Button
          variant="secondary"
          size={44}
          block
          icon="add"
          className="audio-upload-playlist-create-btn"
          onClick={() => setShowCreateForm(true)}
        >
          {t('audio.upload.playlist.newPlaylist')}
        </Button>
      ) : (
        <div className="audio-upload-playlist-form">
          <input
            type="text"
            className="audio-upload-title-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('audio.upload.playlist.namePlaceholder')}
            aria-label={t('audio.upload.playlist.namePlaceholder')}
            maxLength={80}
            autoFocus
          />
          <Segmented
            size={32}
            className="audio-upload-playlist-access"
            value={newAccess}
            onChange={setNewAccess}
            options={[
              { value: 'public', label: t('audio.upload.playlist.public'), icon: 'public' },
              { value: 'private', label: t('audio.upload.playlist.private'), icon: 'lock' },
            ]}
          />
          <PlaylistTypePicker
            audioOnly type="audio" kind={newKind} onChange={({ kind }) => setNewKind(kind)}
            groupClass="audio-upload-chips" btnClass="audio-upload-chip"
            labelClass="v2-eyebrow audio-upload-playlist-kind-label" iconSize={16} disabled={submitting}
          />
          {newKind === 'music' && (
            <>
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
            </>
          )}

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
                <IconButton
                  icon="close"
                  size={28}
                  variant="media"
                  round
                  className="audio-upload-album-thumb-remove"
                  onClick={(e) => { e.stopPropagation(); setThumbnailUrl(''); }}
                  label={t('audio.upload.playlist.removeThumb')}
                />
              </>
            ) : (
              <>
                <Icon name={thumbnailUploading ? 'progress_activity' : 'add_photo_alternate'} size={28} className={cx('audio-upload-thumb-icon', thumbnailUploading && 'v2-spin')} />
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
            <Button variant="ghost" size={40} onClick={resetForm} disabled={submitting}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="cyan" size={40} icon="playlist_add" onClick={submit} disabled={submitting || !newName.trim()} loading={submitting}>
              {submitting ? t('audio.upload.playlist.creating') : t('audio.upload.playlist.create')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// "Edit audio" on a track: opens it in the audio editor.
function EditAudioButton({ onClick, disabled }) {
  const { t } = useTranslation();
  return (
    <Button variant="secondary" size={32} icon="graphic_eq" className="audio-upload-track-edit" onClick={onClick} disabled={disabled} title={t('audio.upload.editAudioHint')}>
      {t('audio.upload.editAudio')}
    </Button>
  );
}

function EditedBadge() {
  const { t } = useTranslation();
  return <span className="v2-pill is-accent audio-upload-edited-badge" title={t('audio.upload.editedHint')}>{t('audio.upload.edited')}</span>;
}

// Reusable cover picker — owns its own file input so many can coexist.
// `onDesign` opens the cover designer (thumbnail editor) on the current cover,
// or on a blank one; `fromPlaylist` marks a cover that came with the playlist.
function ThumbPicker({ value, uploading, onPick, onClear, label, onDesign = null, fromPlaylist = false }) {
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
          {fromPlaylist && <span className="audio-upload-thumb-badge">{t('audio.upload.thumb.fromPlaylist')}</span>}
          <IconButton
            icon="close"
            size={28}
            variant="media"
            round
            className="audio-upload-album-thumb-remove"
            onClick={(e) => { e.stopPropagation(); onClear(); }}
            label={t('audio.upload.thumb.removeCover')}
          />
        </>
      ) : (
        <>
          <Icon name={uploading ? 'progress_activity' : 'add_photo_alternate'} size={28} className={cx('audio-upload-thumb-icon', uploading && 'v2-spin')} />
          <span>{uploading ? t('audio.upload.thumb.uploading') : (label === undefined ? t('audio.upload.thumb.addCover') : label)}</span>
          <small>{t('audio.upload.thumb.hint')}</small>
        </>
      )}
      {onDesign && !uploading && (
        <Button
          variant={value ? 'media' : 'secondary'}
          size={32}
          icon="palette"
          className="audio-upload-thumb-design"
          onClick={(e) => { e.stopPropagation(); onDesign(); }}
          title={t('audio.upload.thumb.designHint')}
        >
          {value ? t('audio.upload.thumb.editCover') : t('audio.upload.thumb.designCover')}
        </Button>
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
function ModeStep({
  tracks, mode, setMode, rewardMode, setRewardMode, isPublishing, publishStatus = {},
  adsVisible = false, audioAdsOn = true, setAudioAdsOn,
}) {
  const { t } = useTranslation();
  const locked = isPublishing || tracks.some(tr => publishStatus[tr.id]?.state);
  const count = tracks.length;
  const opt = (id, enabled, icon, title, desc) => (
    <ChoiceCard
      className="audio-upload-reward-opt"
      icon={icon}
      selected={mode === id}
      onClick={() => enabled && setMode(id)}
      disabled={locked || !enabled}
      title={title}
      sub={desc}
    />
  );
  return (
    <div className="audio-upload-review">
      <p className="audio-upload-step-help">
        {t('audio.upload.mode.help', { count })}
      </p>

      <div className="audio-upload-reward">
        <span className="audio-upload-reward-label" id="audio-upload-mode-label">{t('audio.upload.mode.howPublished')}</span>
        <div className="v2-choices" role="radiogroup" aria-labelledby="audio-upload-mode-label">
          {opt('snaps', true, 'bolt', t('audio.upload.mode.snapsTitle'),
            t('audio.upload.mode.snapsDesc'))}
          {opt('single', count === 1, 'article', count !== 1 ? t('audio.upload.mode.singleTitleSingleOnly') : t('audio.upload.mode.singleTitle'),
            t('audio.upload.mode.singleDesc'))}
          {opt('album', count >= 2, 'album', count < 2 ? t('audio.upload.mode.albumTitleNeeds2') : t('audio.upload.mode.albumTitle'),
            t('audio.upload.mode.albumDesc'))}
        </div>
      </div>

      {ENABLE_PPL && (
        <div className="audio-upload-reward">
          <span className="audio-upload-reward-label" id="audio-upload-earn-label">{t('audio.upload.mode.howEarn')}</span>
          <div className="v2-choices audio-upload-earn-grid" role="radiogroup" aria-labelledby="audio-upload-earn-label">
            <ChoiceCard
              tone="cyan"
              className="audio-upload-reward-opt"
              icon="payments"
              selected={rewardMode === 'post'}
              onClick={() => setRewardMode('post')}
              disabled={locked}
              title={t('audio.upload.mode.postRewardsTitle')}
              sub={t('audio.upload.mode.postRewardsDesc')}
            />
            <ChoiceCard
              tone="cyan"
              className="audio-upload-reward-opt"
              icon="headphones"
              selected={rewardMode === 'ppl'}
              onClick={() => setRewardMode('ppl')}
              disabled={locked}
              title={t('audio.upload.mode.pplTitle')}
              sub={t('audio.upload.mode.pplDesc', { account: PPL_BENEFICIARY })}
            />
          </div>
        </div>
      )}

      {adsVisible && (
        <div className="audio-upload-setting-card">
          <SettingRow
            icon="campaign"
            title={t('audio.upload.mode.adsTitle')}
            sub={t('audio.upload.mode.adsHint')}
            control={<Toggle checked={!!audioAdsOn} onChange={setAudioAdsOn} label={t('audio.upload.mode.adsTitle')} disabled={locked} />}
          />
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
      <label className="v2-field">
        <span className="v2-eyebrow">{t('audio.upload.reward.distribution')}</span>
        <select className="v2-input is-select" value={payout} onChange={(e) => setPayout(e.target.value)}>
          <option value="default">{t('audio.upload.reward.default')}</option>
          <option value="powerup">{t('audio.upload.reward.powerup')}</option>
          <option value="decline">{t('audio.upload.reward.decline')}</option>
        </select>
      </label>
      <Button variant="secondary" size={40} icon="group_add" trailing="chevron_right" className="audio-upload-bene-btn" onClick={onOpenBene}>
        {beneCount > 0 ? t('audio.upload.reward.beneficiariesCount', { count: beneCount }) : t('audio.upload.reward.beneficiaries')}
      </Button>
    </div>
  );
}

// ─── Step: Main post composer (single post, or the album's parent post) ───
function MainPostStep({
  variant, singleTrack, patchTrack,
  title, setTitle, description, setDescription,
  community, setCommunityOpen, tagsInput, setTagsInput,
  thumb, setThumb, thumbUploading, onPickThumb, thumbFromPlaylist = false, onDesignThumb = null,
  payout, setPayout, beneCount, onOpenBene,
  addToBlog, setAddToBlog, warmup = false,
  onShortsChange = null, onDesignShortThumb = null, shortsLocked = false,
  transcript = null,
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

      {/* Cover on the left, what the post is called and where it goes on the right (24a) */}
      <div className="audio-upload-post-top">
        <ThumbPicker
          value={thumb}
          uploading={thumbUploading}
          onPick={onPickThumb}
          onClear={() => setThumb('')}
          onDesign={onDesignThumb}
          fromPlaylist={thumbFromPlaylist}
        />
        <div className="audio-upload-post-fields">
          <input
            type="text"
            className="audio-upload-post-tags audio-upload-post-title"
            placeholder={t('audio.upload.mainPost.titlePlaceholder')}
            aria-label={t('audio.upload.mainPost.titlePlaceholder')}
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
              : <><Icon name="groups" size={20} className="audio-upload-community-icon" />{t('audio.upload.mainPost.selectCommunity')}</>}
            <span className="audio-upload-community-change">{t('audio.upload.mainPost.change')}</span>
          </button>

          <TagChipsInput
            value={tagsInput}
            onChange={setTagsInput}
            placeholder={t('audio.upload.mainPost.tagsPlaceholder')}
          />
        </div>
      </div>

      {/* The same composer as a video post: toolbar, emoji, GIFs, images and a preview */}
      <div className="audio-upload-post-composer">
        <MarkdownComposer
          value={description}
          onChange={setDescription}
          placeholder={t('audio.upload.fields.descriptionOptional')}
        />
      </div>
      {!isAlbum && transcript && <TranscriptControl {...transcript} disabled={shortsLocked} />}

      {!isAlbum && singleTrack && (
        <div className="audio-upload-title-card">
          <span className="audio-upload-reward-label">{t('audio.upload.mainPost.whatKind')}</span>
          <TrackTypeFields track={singleTrack} patchTrack={patchTrack} />
        </div>
      )}

      {/* The audiograms going out as Shorts with it (not for warm-up: Shorts need the Hive account) */}
      {!isAlbum && singleTrack && !warmup && onShortsChange && (
        <AudiogramShortsSection
          track={singleTrack}
          onChange={(list) => onShortsChange(singleTrack.id, list)}
          onDesign={(url) => onDesignShortThumb(singleTrack.id, url)}
          disabled={shortsLocked}
        />
      )}

      {/* A warm-up post has no payout and no blog yet: those come with the Hive account. */}
      {!warmup && (
        <>
        <RewardRow payout={payout} setPayout={setPayout} beneCount={beneCount} onOpenBene={onOpenBene} />

        <div className="audio-upload-setting-card">
          <SettingRow
            icon="dynamic_feed"
            title={t('audio.upload.mainPost.addToBlog')}
            sub={t('audio.upload.mainPost.addToBlogHint')}
            control={<Toggle checked={!!addToBlog} onChange={setAddToBlog} label={t('audio.upload.mainPost.addToBlog')} />}
          />
        </div>
        </>
      )}
    </div>
  );
}

// Tags as pills, like the video upload shows them: space, comma or Enter turns
// the typed word into a pill, Backspace on an empty field takes the last one
// back. `value` stays the space-separated string the publish code reads.
// Android keyboards often send no key events for space, so the onChange path
// splits too.
const MAX_TAGS = 10;
const cleanTag = (raw) => String(raw || '').trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '').slice(0, 24);

function TagChipsInput({ value, onChange, placeholder }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const tags = String(value || '').split(/[\s,]+/).filter(Boolean);

  const addTags = (words) => {
    const next = [...tags];
    for (const w of words) {
      const tag = cleanTag(w);
      if (tag && !next.includes(tag) && next.length < MAX_TAGS) next.push(tag);
    }
    if (next.length !== tags.length) onChange(next.join(' '));
  };
  const removeTag = (tag) => onChange(tags.filter((x) => x !== tag).join(' '));

  return (
    <div className="audio-upload-tag-chips">
      {tags.map((tag) => (
        <span key={tag} className="audio-upload-tag-chip">
          {tag}
          <button type="button" onClick={() => removeTag(tag)} aria-label={t('audio.upload.mainPost.removeTag', { tag })}>
            <Icon name="close" size={14} />
          </button>
        </span>
      ))}
      {tags.length < MAX_TAGS && (
        <input
          type="text"
          value={draft}
          placeholder={tags.length ? '' : placeholder}
          onChange={(e) => {
            const parts = e.target.value.split(/[\s,]+/);
            if (parts.length > 1) {
              addTags(parts.slice(0, -1));
              setDraft(parts[parts.length - 1]);
            } else {
              setDraft(e.target.value);
            }
          }}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',' || e.key === ' ') && draft.trim()) {
              e.preventDefault();
              addTags([draft]);
              setDraft('');
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onChange(tags.slice(0, -1).join(' '));
            }
          }}
          onBlur={() => {
            if (draft.trim()) { addTags([draft]); setDraft(''); }
          }}
        />
      )}
    </div>
  );
}

// ─── Step: Tracks (snaps / album) — apply-to-all panel + per-track accordion ───
function TracksStep({
  tracks, mode, patchTrack,
  sharedDesc, setSharedDesc, sharedThumb, setSharedThumb,
  sharedPayout, setSharedPayout, sharedBeneCount,
  applyToAllTracks, onOpenBene, uploadCoverFor, thumbUploadingId,
  onDesignCover = null, onEditTrack = null, editLocked = () => false,
  onShortsChange = null, onDesignShortThumb = null, shortsLocked = false,
  transcriptPropsFor = null,
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
          value={sharedDesc}
          onChange={(e) => setSharedDesc(e.target.value)}
        />
        <ThumbPicker
          value={sharedThumb}
          uploading={thumbUploadingId === 'shared'}
          onPick={(f) => uploadCoverFor('shared', f)}
          onClear={() => setSharedThumb('')}
          label={t('audio.upload.tracks.sharedCover')}
          onDesign={onDesignCover ? () => onDesignCover('shared', sharedThumb) : null}
        />
        <RewardRow
          payout={sharedPayout}
          setPayout={setSharedPayout}
          beneCount={sharedBeneCount}
          onOpenBene={() => onOpenBene('shared')}
        />
        <Button
          variant="cyan"
          size={40}
          icon="done_all"
          className="audio-upload-apply-all"
          onClick={applyToAllTracks}
        >
          {t('audio.upload.tracks.applyToAll', { count: tracks.length })}
        </Button>
      </div>

      {tracks.map((tr, i) => {
        const expanded = openId === tr.id;
        let beneCount = 0;
        try { beneCount = (JSON.parse(tr.beneStr || '[]') || []).length; } catch { beneCount = 0; }
        return (
          <div key={tr.id} className="audio-upload-title-card">
            <div
              className="audio-upload-title-row audio-upload-track-head"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={() => setOpenId(expanded ? null : tr.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenId(expanded ? null : tr.id); } }}
            >
              <span className="audio-upload-title-num">{i + 1}</span>
              <span className="audio-upload-track-head-title">
                {tr.title || tr.filename}
              </span>
              <span className="audio-upload-community-change">
                {expanded ? t('audio.upload.tracks.hide') : t('common.actions.edit')}
                <Icon name={expanded ? 'expand_less' : 'expand_more'} size={18} />
              </span>
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
                <RewardRow
                  payout={tr.payout || 'default'}
                  setPayout={(v) => patchTrack(tr.id, { payout: v })}
                  beneCount={beneCount}
                  onOpenBene={() => onOpenBene(tr.id)}
                />
              </>
            )}

            {/* The text this track's comment (or snap) carries. Always in view:
                hidden behind Edit, people only ever found the shared field. */}
            <textarea
              className="audio-upload-post-desc audio-upload-track-text"
              placeholder={mode === 'album' ? t('audio.upload.tracks.commentText') : t('audio.upload.tracks.snapText')}
              rows={tr.transcriptText ? 6 : 2}
              maxLength={tr.transcriptText ? TRANSCRIPT_TEXT_MAX : 5000}
              value={tr.desc || ''}
              onChange={(e) => patchTrack(tr.id, { desc: e.target.value })}
            />
            {transcriptPropsFor && (
              <TranscriptControl {...transcriptPropsFor(tr)} disabled={shortsLocked || editLocked(tr.id)} />
            )}
            {/* Its own cover, also always in view (it was behind Edit). */}
            <ThumbPicker
              value={tr.thumb || ''}
              uploading={thumbUploadingId === tr.id}
              onPick={(f) => uploadCoverFor(tr.id, f)}
              onClear={() => patchTrack(tr.id, { thumb: '' })}
              label={t('audio.upload.tracks.trackCover')}
              onDesign={onDesignCover ? () => onDesignCover(tr.id, tr.thumb) : null}
            />

            <div className="audio-upload-title-meta-line">
              <span>{fmtTime(tr.durationSec)} · {tr.source === 'record' ? t('audio.upload.recorded') : tr.filename}</span>
              {tr.edited && <EditedBadge />}
              {onEditTrack && tr.blob && (
                <EditAudioButton onClick={() => onEditTrack(tr)} disabled={editLocked(tr.id)} />
              )}
            </div>

            {onShortsChange && (
              <AudiogramShortsSection
                track={tr}
                onChange={(list) => onShortsChange(tr.id, list)}
                onDesign={(url) => onDesignShortThumb(tr.id, url)}
                disabled={shortsLocked || editLocked(tr.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 5: Review (summary + publish) ───
function ReviewStep({
  tracks, playlists, playlistChoice, pendingPlaylist, publishStatus = {}, onRetry, onRetryAll, isPublishing,
  mode, rewardMode, community, mainError, onRetryMain, published, onNavigate, shortsCount = 0,
  shortStatus = {}, onRetryShort = null, showShorts = true,
}) {
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
        <div className="audio-upload-review-kv">
          <Icon name={mode === 'album' ? 'album' : mode === 'single' ? 'article' : 'bolt'} size={18} />
          <strong>{t('audio.upload.review.publishAs')}</strong> <span>{publishAsLabel}</span>
        </div>
        <div className="audio-upload-review-kv">
          <Icon name="payments" size={18} />
          <strong>{t('audio.upload.review.earnings')}</strong> <span>{rewardMode === 'ppl' ? t('audio.upload.review.earningsPpl', { account: PPL_BENEFICIARY }) : t('audio.upload.review.earningsNormal')}</span>
        </div>
        {chosen && (
          <div className="audio-upload-review-kv">
            <Icon name="queue_music" size={18} />
            <strong>{t('audio.upload.review.playlist')}</strong> <span>{chosen.name}</span>
          </div>
        )}
        {shortsCount > 0 && (
          <div className="audio-upload-review-kv">
            <Icon name="view_day" size={18} />
            <strong>{t('audio.upload.review.shortsLabel')}</strong>{' '}
            <span>{t('audio.upload.review.shortsValue', { count: shortsCount })}</span>
          </div>
        )}
      </div>

      {published && (
        <div className="audio-upload-done v2-success">
          <span className="audio-upload-done-icon" aria-hidden="true"><Icon name="check" size={24} /></span>
          <strong>{t('audio.upload.done.title')}</strong>
          <div className="audio-upload-done-links">
            {published.post && (
              <Button as={Link} variant="primary" size={40} next to={published.post} onClick={onNavigate}>
                {t('audio.upload.done.openPost')}
              </Button>
            )}
            {published.playlist && (
              <Button as={Link} variant="secondary" size={40} icon="queue_music" to={published.playlist} onClick={onNavigate}>
                {t('audio.upload.done.openPlaylist')}
              </Button>
            )}
            {published.profileAudio && (
              <Button as={Link} variant={published.post ? 'secondary' : 'primary'} size={40} icon="graphic_eq" to={published.profileAudio} onClick={onNavigate}>
                {t('audio.upload.done.openMyAudio')}
              </Button>
            )}
          </div>
        </div>
      )}

      {mainError && (
        <div className="audio-upload-review-error">
          <Icon name="error" size={18} className="audio-upload-review-error-icon" />
          <p className="audio-upload-review-error-msg">
            {t(mode === 'album' ? 'audio.upload.review.mainFailed' : 'audio.upload.review.containerFailed', { message: mainError })}
          </p>
          <Button variant="danger" size={32} icon="refresh" onClick={onRetryMain} disabled={isPublishing}>
            {t('common.actions.retry')}
          </Button>
        </div>
      )}

      {failedCount > 0 && (
        <div className="audio-upload-review-failed-banner">
          <Icon name="error" size={18} className="audio-upload-review-error-icon" />
          <span>{t('audio.upload.review.failedCount', { count: failedCount })}</span>
          <Button variant="danger" size={32} icon="refresh" onClick={onRetryAll} disabled={isPublishing}>
            {t('audio.upload.review.retryAllFailed')}
          </Button>
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
                <Icon name="error" size={18} className="audio-upload-review-error-icon" />
                <p className="audio-upload-review-error-msg">
                  {t(status.stage === 'upload'
                    ? 'audio.upload.review.failedDuringUpload'
                    : status.stage === 'post'
                      ? 'audio.upload.review.failedDuringPost'
                      : 'audio.upload.review.failedWithMessage',
                  { message: status.message || t('audio.upload.unknownError') })}
                </p>
                <Button variant="danger" size={32} icon="refresh" onClick={() => onRetry?.(tr.id)} disabled={isPublishing}>
                  {t('common.actions.retry')}
                </Button>
              </div>
            )}

            <audio controls preload="metadata" src={tr.objectUrl} className="audio-upload-review-player" />

            {/* Its audiograms: posted as Shorts together with it, each with its own state */}
            {showShorts && tr.audiograms?.length > 0 && (
              <ul className="audio-upload-review-shorts" aria-label={t('audio.upload.shorts.withAudio')}>
                {tr.audiograms.map((a) => {
                  const st = shortStatus[`${tr.id}|${a.url}`];
                  return (
                    <li key={a.url} className={`audio-upload-review-short${st?.state ? ` is-${st.state}` : ''}`} data-testid="review-short">
                      <span className="audio-upload-review-short-thumb" aria-hidden="true">
                        {a.thumbnailUrl ? <img src={a.thumbnailUrl} alt="" /> : <video src={`${a.url}#t=1.5`} muted playsInline preload="metadata" />}
                      </span>
                      <span className="audio-upload-review-short-info">
                        <strong>{t('audio.upload.shorts.rowTitle', { title: (a.title || '').trim() || tr.title })}</strong>
                        <small>{t('audio.upload.shorts.withAudio')}</small>
                        {st?.state === 'error' && <small className="audio-upload-review-error-msg">{st.message || t('audio.upload.unknownError')}</small>}
                      </span>
                      {st && <PublishBadge status={st} />}
                      {st?.state === 'error' && onRetryShort && (
                        <Button variant="danger" size={28} icon="refresh" onClick={() => onRetryShort(tr.id, a.url)} disabled={isPublishing}>
                          {t('common.actions.retry')}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
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
  const spin = <Icon name="progress_activity" size={12} className="v2-spin" />;
  if (status.state === 'uploading') return <StatusPill tone="cyan" icon={spin} className="audio-upload-review-badge uploading">{stageLabel || t('audio.upload.stage.uploadingFallback')}…</StatusPill>;
  if (status.state === 'posting') return <StatusPill tone="cyan" icon={spin} className="audio-upload-review-badge posting">{stageLabel || t('audio.upload.stage.post')}…</StatusPill>;
  if (status.state === 'success') return <StatusPill tone="cyan" icon="check" className="audio-upload-review-badge success">{t('audio.upload.stage.published')}</StatusPill>;
  if (status.state === 'error') return <StatusPill tone="accent" icon="error" className="audio-upload-review-badge error">{t('audio.upload.failed')}</StatusPill>;
  return null;
}

export default AudioUploadModal;
