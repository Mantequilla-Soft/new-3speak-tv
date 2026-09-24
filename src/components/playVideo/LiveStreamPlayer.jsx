import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HangoutsProvider, StandaloneWatch, StreamVideo, StreamViewerCount, ChatPanel, CollabRequest, useStreamLive } from '@snapie/hangouts-react';
import { defaultEndpoint, findRoomEndpoint } from '../../utils/hangoutsEndpoints';
import { useStreamSession } from '../../hooks/useStreamSession';
import StreamBoostButton from '../openpods/StreamBoostButton';
import StreamSignInButton from '../openpods/StreamSignInButton';
import '@snapie/hangouts-react/src/styles/hangouts.css';
import './LiveStreamPlayer.scss';

// Strip a trailing slash — the SDK builds `${apiBaseUrl}/rooms/...` with a raw
// fetch, so a trailing slash yields `//rooms` and a 404.
const API_URL = (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/$/, '');
const LK_URL = import.meta.env.VITE_LIVEKIT_URL || 'wss://livekit.3speak.tv';

/**
 * "The recording is on its way" card, shown over the dead player once the host
 * has gone and the encoder still has the VOD. Gated on the host being offline
 * so a stream that's merely mid-reconnect doesn't get an obituary — must live
 * inside <StandaloneWatch> to read the room's live state.
 */
function VodProcessingNotice({ expected }) {
  const live = useStreamLive();
  if (live || !expected) return null;
  return (
    <div className="live-stream-player__vod">
      <span className="live-stream-player__vod-spinner" aria-hidden="true" />
      <strong>The recording is processing…</strong>
      <span>
        This stream has ended. The video will replace it here as soon as the
        encoder is finished — no need to reload.
      </span>
    </div>
  );
}

/**
 * The live OpenPods player, dropped into the watch page's player slot in
 * place of the VOD `<video>` when a post is a live stream (video.live). Fills
 * its positioned parent (`.video-iframe-wrapper`); the surrounding watch page
 * keeps rendering the real post's details, voting and comments.
 *
 * `chatSlot` (a DOM element in the watch page's right column) gets the live
 * chat PORTALLED into it. A portal rather than a second <StandaloneWatch>
 * because the chat has to sit inside this component's LiveKit room context —
 * mounting the sidebar's own provider would open a second connection to the
 * same room and double the viewer count.
 */
export default function LiveStreamPlayer({ roomName, chatSlot = null, onChatSent = null, vodAssetPending = false, onRoomMeta = null }) {
  // Resolve which deployment hosts this room before connecting.
  const [endpoint, setEndpoint] = useState(() => defaultEndpoint());
  useEffect(() => {
    if (!roomName) return;
    let alive = true;
    findRoomEndpoint(roomName).then((ep) => { if (alive) setEndpoint(ep); });
    return () => { alive = false; };
  }, [roomName]);

  // Join as the logged-in Hive user rather than an anonymous guest, so chat
  // carries the viewer's real name and the server lets their messages through.
  // The room carries two facts the Hive post can't: when the host actually hit
  // Start (chat timecodes anchor to it) and whether they asked for a VOD.
  const [roomMeta, setRoomMeta] = useState(null);
  const onRoomMetaRef = useRef(onRoomMeta);
  onRoomMetaRef.current = onRoomMeta;
  useEffect(() => {
    if (!roomName || !endpoint?.api) return undefined;
    let alive = true;
    fetch(`${endpoint.api}/rooms/${encodeURIComponent(roomName)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((room) => { if (alive && room) { setRoomMeta(room); onRoomMetaRef.current?.(room); } })
      .catch(() => { /* falls back to the post's timestamp */ });
    return () => { alive = false; };
  }, [roomName, endpoint?.api]);

  const { aioha, sessionToken, hangoutsUser, connectReady, joinKey, needsSignIn, canInteract, signIn, signingIn } = useStreamSession();

  if (!roomName) return null;
  return (
    <div className="live-stream-player">
      <HangoutsProvider
        apiBaseUrl={endpoint.api}
        livekitServerUrl={endpoint.lk}
        sessionToken={sessionToken || undefined}
        username={hangoutsUser || undefined}
        aioha={aioha}
      >
        {connectReady && (
          <StandaloneWatch key={joinKey} roomName={roomName}>
            <StreamVideo showLiveBadge />
            {/* The host's own choice is the reliable signal; an encoder row
                that exists but isn't published covers rooms that pre-date the
                server recording that choice. */}
            <VodProcessingNotice expected={!!roomMeta?.willPublishVod || vodAssetPending} />
            <StreamViewerCount render={(c) => (
              <span className="live-stream-player__viewers">👁 {c} watching</span>
            )} />
            <StreamBoostButton variant="overlay" />
            <div className="live-stream-player__collab">
              {needsSignIn
                ? <StreamSignInButton variant="overlay" label="Sign in to raise your hand" onSignIn={signIn} busy={signingIn} />
                : <CollabRequest canRequest={canInteract} />}
            </div>
            {chatSlot && createPortal(
              <ChatPanel
                readOnly={!canInteract}
                readOnlyNotice={needsSignIn
                  ? <StreamSignInButton label="Sign in to chat" onSignIn={signIn} busy={signingIn} />
                  : '🔒 Sign in to join the chat.'}
                onMessageSent={onChatSent || undefined}
              />,
              chatSlot,
            )}
          </StandaloneWatch>
        )}
      </HangoutsProvider>
    </div>
  );
}
