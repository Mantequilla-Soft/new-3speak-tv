import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { HangoutsProvider, HangoutsRoom } from '@snapie/hangouts-react';
import '@snapie/hangouts-react/src/styles/hangouts.css';
import logoDark from '../../assets/image/3S_logodark.png';
import { Star } from 'lucide-react';
import { useAppStore } from '../../lib/store';
import { useReviewModal } from '../../lib/reviewStore';
import { useWakeLock } from '../../hooks/useWakeLock';
import { getCreatorSettings, isUploadBlocked } from '../../utils/creatorSettings';
import { useSupportBlock } from '../../lib/supportBlockStore';
import { firePendingAnnouncement, getAnnounceConfig } from '../../utils/openpodAnnounce';
import { publishStreamVod, trackServerVodPublish } from '../../utils/streamVod';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { defaultEndpoint, findRoomEndpoint } from '../../utils/hangoutsEndpoints';
import AnnounceOptions from '../openpods/AnnounceOptions';
import './OpenPodModal.scss';

// Strip any trailing slash — useHangoutsRoom builds `${apiBaseUrl}/rooms` with a
// raw fetch, so a trailing slash yields `//rooms` and a 404 from the API.
const API_URL = (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/$/, '');
const LK_URL  = import.meta.env.VITE_LIVEKIT_URL || 'wss://livekit.3speak.tv';
const IMAGE_KEY = import.meta.env.VITE_IMAGE_SERVER_API_KEY;

// Hostnames whose rooms should be shared via the 3speak.tv deep link
// (where 3speak users land back inside their existing session). Anything
// else falls back to the standalone hangout site.
const THREE_SPEAK_HOSTS = new Set(['3speak.tv', 'preview.3speak.tv', '3speak.okinoko.io']);

// The studio persists its post composer to localStorage under this key; we
// reuse it to title/describe/thumbnail the published VOD.
const POST_DRAFT_KEY = 'hh-studio-post-draft';
function readPostDraft() {
  try {
    const raw = window.localStorage.getItem(POST_DRAFT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function buildOpenPodShareUrl(roomName, origin, mode) {
  // Where the link should DROP the recipient depends on what kind of session
  // it is. A standalone stream has a spectator-facing watch page; a conference
  // room has no such thing — you either join it or you see nothing — so its
  // link has to be the room route itself. Sharing /watch for a conference sent
  // people to a page with no stream on it.
  //
  // Built from the CURRENT host so a preview session shares a preview link
  // instead of a prod one that doesn't exist yet.
  if (origin && THREE_SPEAK_HOSTS.has(origin)) {
    return mode === 'standalone'
      ? `https://${origin}/watch/${roomName}`
      : `https://${origin}/openpods/${roomName}`;
  }
  return `https://hangout.3speak.tv/room/${roomName}`;
}

export default function OpenPodModal({ isOpen, onClose, roomName, sessionToken, username, isAuthenticated }) {
  const navigate = useNavigate();
  useWakeLock(isOpen);
  // Follow the 3speak-selected theme (light/dark/system) instead of
  // forcing the SDK widgets dark.
  const hhTheme = useAppStore((s) => s.getEffectiveTheme());
  const premiumStatus = usePremiumStatus(username);
  const isPremium = !!premiumStatus?.premium;
  // Owned here so the studio can react: with no announcement there's no post
  // for a VOD to replace, so that option is hidden and inert.
  const [announceEnabled, setAnnounceEnabled] = useState(() => getAnnounceConfig().announceEnabled !== false);
  // A room lives on exactly ONE hangouts deployment — resolve which before
  // connecting, otherwise we'd join the wrong server and 404.
  const [endpoint, setEndpoint] = useState(() => defaultEndpoint());
  // An UNLISTED session is link-only, so announcing it on Hive is a
  // contradiction — the create dialog already hides the option, and this keeps
  // the studio's own toggle consistent (which also hides the VOD option, since
  // there'd be no post to replace).
  const [isUnlisted, setIsUnlisted] = useState(false);
  // Decides which share link the room hands out — see buildOpenPodShareUrl.
  const [roomMode, setRoomMode] = useState(null);
  // The host ended their stream — show a confirmation instead of dropping them
  // straight back to the lobby. Reset each time a session opens.
  const [streamEnded, setStreamEnded] = useState(false);
  // Room existence: 'checking' | 'exists' | 'gone'. A stream that ended leaves a
  // deleted room; refreshing on /openpods/:roomName must NOT try to connect to
  // it forever (the "connecting…" hang) — we detect the 404 and show the ended
  // state instead.
  const [roomStatus, setRoomStatus] = useState('checking');
  useEffect(() => { if (isOpen) setStreamEnded(false); }, [isOpen, roomName]);
  const openReview = useReviewModal((s) => s.openReview);
  useEffect(() => {
    if (!roomName) return;
    let alive = true;
    setRoomStatus('checking');
    findRoomEndpoint(roomName).then(async (ep) => {
      if (!alive) return;
      setEndpoint(ep);
      try {
        const res = await fetch(`${ep.api}/rooms/${encodeURIComponent(roomName)}`);
        if (!alive) return;
        if (res.status === 404) { setRoomStatus('gone'); return; }
        const room = res.ok ? await res.json() : null;
        setRoomStatus('exists');
        // Set explicitly both ways: only ever setting `true` meant the flag
        // stuck after opening an unlisted room and then a public one.
        const unlisted = room?.visibility === 'unlisted';
        setIsUnlisted(unlisted);
        setRoomMode(room?.mode || null);
        if (unlisted) setAnnounceEnabled(false);
      } catch { if (alive) setRoomStatus('exists'); /* transient error → fail open */ }
    }).catch(() => { if (alive) setRoomStatus('exists'); });
    return () => { alive = false; };
  }, [roomName]);

  // React fires child effects before parent effects. Without this flag,
  // HangoutsRoom.useEffect (join) fires before HangoutsProvider.useEffect
  // (setSessionToken on apiClient) — causing a 401 on every first join attempt.
  // By deferring HangoutsRoom's mount to the render AFTER HangoutsProvider's
  // effects have run, the token is guaranteed to be set before join() is called.
  // Guests don't need a session token, so they're ready as soon as the
  // modal opens.
  const [roomReady, setRoomReady] = useState(false);
  useEffect(() => {
    if (!isOpen || !roomName) {
      setRoomReady(false);
      return;
    }
    // Authenticated user → wait for the hangouts session token first.
    // Unauthenticated visitor → guest path; nothing to wait for.
    setRoomReady(isAuthenticated ? !!sessionToken : true);
  }, [sessionToken, isOpen, roomName, isAuthenticated]);

  const getShareUrl = useCallback(
    (name, origin) => buildOpenPodShareUrl(name, origin, roomMode),
    [roomMode],
  );

  if (!isOpen || !roomName) return null;

  // Audio recordings: close the OpenPods modal and forward the blob to
  // the AudioUploadModal at App level, pre-typed as a podcast. App.jsx
  // listens for the custom event and seeds the modal's first track.
  const handleAudioHandoff = async (file) => {
    if (isUploadBlocked(await getCreatorSettings(username))) {
      onClose();
      useSupportBlock.getState().showSupportBlock('upload');
      return;
    }
    onClose();
    window.dispatchEvent(new CustomEvent('open-audio-upload', {
      detail: {
        blob: file.blob,
        filename: file.filename,
        type: 'podcast',
      },
    }));
  };

  // Video recordings: park the MP4 in the share-target Cache that the
  // legacy /studio PWA-share pickup reads from, then navigate. Same
  // mechanic the SDK previously hardcoded — now provided by the
  // integrator so the SDK stays generic.
  const handleVideoHandoff = async (file) => {
    if (isUploadBlocked(await getCreatorSettings(username))) {
      onClose();
      useSupportBlock.getState().showSupportBlock('upload');
      return;
    }
    try {
      const cache = await caches.open('share-target-cache');
      await cache.put('/shared-video', new Response(file.blob, {
        headers: {
          'Content-Type': file.blob.type || 'video/mp4',
          'X-File-Name': file.filename,
        },
      }));
      onClose();
      window.location.href = '/embed-studio?shared=true';
    } catch (err) {
      console.error('OpenPod video handoff failed:', err);
    }
  };

  return (
    <div
      className="openpod-modal-overlay"
      onClick={(e) => {
        // Only count clicks that landed on the overlay itself, not
        // bubbled clicks from inside the modal. Confirm before
        // leaving so the host doesn't accidentally drop the room
        // by missing the modal edge.
        if (e.target !== e.currentTarget) return;
        // Already ended — no room to drop, so just close.
        if (streamEnded) { onClose(); return; }
        if (window.confirm('Leave this OpenPod? You can rejoin from the lobby anytime.')) {
          onClose();
        }
      }}
    >
      <div className="openpod-modal" data-hh-theme={hhTheme}>
        <HangoutsProvider
          apiBaseUrl={endpoint.api}
          livekitServerUrl={endpoint.lk}
          imageServerApiKey={IMAGE_KEY || undefined}
          sessionToken={sessionToken}
          username={username || undefined}
        >
          {(streamEnded || roomStatus === 'gone') ? (
            <div className="openpod-ended">
              <div className="openpod-ended__icon" aria-hidden="true">✅</div>
              <h2 className="openpod-ended__title">
                {streamEnded ? 'Your stream has ended' : 'This stream has ended'}
              </h2>
              <p className="openpod-ended__text">
                {!streamEnded
                  ? 'It is no longer live. Start a new one whenever you are ready.'
                  : announceEnabled && !isUnlisted
                    ? 'Nice one! Your recording is being processed and will appear on the announcement post shortly.'
                    : 'Nice one — thanks for going live!'}
              </p>
              <div className="openpod-ended__actions">
                {/* navigate('/') BEFORE onClose: OpenPods' URL-cleanup effect
                    fires on room-close but now only rewrites to /openpods when
                    the path is still /openpods, so going home first sticks. */}
                <button className="openpod-ended__btn" onClick={() => { navigate('/'); onClose(); }}>Back to Home</button>
                <button className="openpod-ended__btn" onClick={onClose}>Back to OpenPods</button>
              </div>
              <button
                className="openpod-ended__feedback"
                onClick={() => openReview({ area: 'stream', username: username || null, permlink: roomName || null })}
              >
                <Star size={18} /> How was your stream?
              </button>
            </div>
          ) : (roomReady && roomStatus === 'exists') ? (
            <HangoutsRoom
              roomName={roomName}
              onLeave={onClose}
              onEnded={() => setStreamEnded(true)}
              onVideoHandoff={handleVideoHandoff}
              onAudioHandoff={handleAudioHandoff}
              onStreamStart={(post) => firePendingAnnouncement(roomName, post)}
              // Pro auto-VOD: publish the finished recording as this session's
              // video. Fire-and-forget into a module-level publisher so the
              // upload survives this modal unmounting when the room ends.
              onStreamVod={(file) => {
                // Normal path: the server publishes the VOD itself — just track
                // its progress and toast it.
                if (file.publishStatusUrl) {
                  void trackServerVodPublish({ statusUrl: file.publishStatusUrl });
                  return;
                }
                // Legacy fallback: an older server handed us the blob to upload.
                const draft = readPostDraft();
                void publishStreamVod({
                  blob: file.blob,
                  filename: file.filename,
                  duration: file.duration,
                  roomName: file.roomName || roomName,
                  owner: username,
                  title: draft.title,
                  description: draft.description,
                  tags: draft.tags,
                  thumbnailUrl: draft.thumbnail,
                });
              }}
              canPublishVod={announceEnabled && !isUnlisted}
              isUnlisted={isUnlisted}
              renderPostExtras={(
                <AnnounceOptions
                  announceType="post"
                  isPremium={isPremium}
                  showAnnounceToggle={!isUnlisted}
                  announceEnabled={announceEnabled}
                  onAnnounceEnabledChange={setAnnounceEnabled}
                />
              )}
              video
              embedded
              guestFallback
              getShareUrl={getShareUrl}
              watermarkLogoUrl={new URL(logoDark, window.location.origin).href}
              // Serve the OBS Browser Source overlay from OUR origin (/obs route,
              // current SDK, multi-endpoint aware) instead of the stale shared
              // hangout.3speak.tv/obs page.
              obsBaseUrl={window.location.origin}
            />
          ) : (
            <div className="openpod-connecting">
              {sessionToken ? 'Connecting to OpenPods…' : 'Authenticating with OpenPods…'}
            </div>
          )}
        </HangoutsProvider>
      </div>
    </div>
  );
}
