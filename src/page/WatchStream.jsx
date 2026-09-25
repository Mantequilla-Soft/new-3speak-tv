import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Navigate } from 'react-router-dom';
import axios from 'axios';
import {
  HangoutsProvider, StandaloneWatch, StreamVideo, StreamViewerCount, StreamQualityControl, ChatPanel, CollabRequest, useIsMobile, useChat,
} from '@snapie/hangouts-react';
import '@snapie/hangouts-react/src/styles/hangouts.css';
import StreamBoostButton from '../components/openpods/StreamBoostButton';
import StreamReportButton from '../components/openpods/StreamReportButton';
import StreamClipButton from '../components/openpods/StreamClipButton';
import StreamSignInButton from '../components/openpods/StreamSignInButton';
import { useStreamSession } from '../hooks/useStreamSession';
import { useLiveStreamPager } from '../hooks/useLiveStreamPager';
import { useStreamChatMirror } from '../hooks/useStreamChatMirror';
import { fetchVideoDetails } from '../lib/videoData';
// The mobile layout reuses the shorts page's classes — load its styles too.
import './Short.scss';
import SEOHead from '../components/SEOHead';
import BarLoader from '../components/Loader/BarLoader';
import Card3 from '../components/Cards/Card3';
import AuthorBadge from '../components/AuthorBadge/AuthorBadge';
import { ArrowLeft, MessageSquare, Send, Share2 } from 'lucide-react';

import { TAG_FEED_URL } from '../utils/config';
import { FaThumbsUp, FaRegCommentAlt, FaBookmark } from 'react-icons/fa';
import { MdShare } from 'react-icons/md';
import '../page/Watch.scss';
import '../page/WatchV2.scss';
import '../components/playVideo/PlayVideo.scss';
import './WatchStream.scss';

const API_URL = (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/$/, '');
const LK_URL = import.meta.env.VITE_LIVEKIT_URL || 'wss://livekit.3speak.tv';
const IMAGE_KEY = import.meta.env.VITE_IMAGE_SERVER_API_KEY;

/**
 * The chat composer, docked to the bottom of the screen like the shorts
 * comment bar — separate from the chat overlay, which shows messages only.
 * Must live inside <StandaloneWatch> to reach the LiveKit room context.
 */
function StreamChatBar({ canChat, needsSignIn = false, onSignIn, signingIn = false, onSent }) {
  // The SDK's chat hook — ChatPanel renders what THIS publishes. LiveKit's
  // own useChat is a different transport; sending on it meant neither the
  // viewer nor the streamer ever saw the message.
  const { sendMessage } = useChat();
  const [text, setText] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const msg = text.trim();
    if (!msg || !canChat) return;
    void sendMessage(msg);
    setText('');
    try { onSent?.(msg); } catch { /* mirroring is best-effort */ }
  };
  return (
    <form className="shortsBottomComment ws-shorts__bar" onSubmit={submit}>
      <textarea
        rows={1}
        placeholder={canChat ? 'Say something…' : (signingIn ? 'Waiting for your wallet…' : 'Sign in to chat')}
        value={text}
        // Signed in to 3Speak but not to the room yet: tapping the box is the
        // "I want to chat" moment, so that is when the wallet is asked.
        readOnly={!canChat && needsSignIn}
        onFocus={() => { if (!canChat && needsSignIn && !signingIn) onSignIn?.(); }}
        disabled={!canChat && !needsSignIn}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
      />
      <button className="sendCommentBtn" type="submit" disabled={!canChat || !text.trim()} aria-label="Send message">
        <Send size={18} />
      </button>
    </form>
  );
}

export default function WatchStream() {
  const { streamId } = useParams();
  const navigate = useNavigate();
  const { aioha, sessionToken, hangoutsUser, connectReady, joinKey, needsSignIn, canInteract, signIn, signingIn } = useStreamSession();

  const [state, setState] = useState({ status: 'loading', room: null, hivePost: null });
  const [copied, setCopied] = useState(false);
  const [recommended, setRecommended] = useState({ loading: false, videos: [] });
  // Phones get a shorts-style full-bleed player rather than the desktop grid.
  const isMobile = useIsMobile();
  // A phone rotated to landscape exceeds useIsMobile's 820px width breakpoint,
  // which would wrongly flip us to the desktop grid. Track orientation and treat
  // a SHORT landscape viewport (phones, not tablets/desktop) as mobile too.
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(orientation: landscape)').matches === true,
  );
  const [phoneLandscape, setPhoneLandscape] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(orientation: landscape) and (max-height: 500px)').matches === true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const land = window.matchMedia('(orientation: landscape)');
    const phone = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
    const update = () => { setIsLandscape(land.matches); setPhoneLandscape(phone.matches); };
    update();
    land.addEventListener('change', update);
    phone.addEventListener('change', update);
    return () => { land.removeEventListener('change', update); phone.removeEventListener('change', update); };
  }, []);
  const mobileLayout = isMobile || phoneLandscape;

  // Landscape only (mobile): the author/info block auto-hides 3s after it last
  // appeared and comes back on a screen tap. Portrait keeps it always visible.
  const [infoVisible, setInfoVisible] = useState(true);
  const hideTimerRef = useRef(null);
  const revealInfo = useCallback(() => {
    setInfoVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (isLandscape) hideTimerRef.current = setTimeout(() => setInfoVisible(false), 3000);
  }, [isLandscape]);
  useEffect(() => {
    revealInfo();
    return () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); };
  }, [revealInfo]);

  const [chatOverlayOn, setChatOverlayOn] = useState(true);
  // Swipe/scroll to the next live stream, shorts-style. No-op when nothing else
  // is live.
  const { containerRef: pagerRef, hasNext: hasNextLive } = useLiveStreamPager({
    currentRoom: streamId,
    enabled: mobileLayout,
  });

  // Detect the live stream via the room lookup (works for unlisted too), then
  // ask Hive whether the host actually ANNOUNCED it.
  //
  // The room's `post` field is seeded from the create-room form and exists
  // whether or not anything was ever broadcast, so it can't answer that — only
  // the chain can. An announced stream publishes under `host/<roomName>`, and
  // when that post exists the ordinary watch page is the better home for the
  // stream: it already carries votes, payout, comments, playlists, and it
  // swaps the live player for the recording once the VOD publishes. See the
  // redirect below.
  useEffect(() => {
    let alive = true;
    setState({ status: 'loading', room: null, hivePost: null });
    if (!streamId || !API_URL) { setState({ status: 'notfound', room: null, hivePost: null }); return undefined; }
    fetch(`${API_URL}/rooms/${encodeURIComponent(streamId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then(async (room) => {
        if (!alive) return;
        if (!room || room.mode !== 'standalone') {
          setState({ status: 'notlive', room: room || null, hivePost: null });
          return;
        }
        let hivePost = null;
        try { hivePost = room.host ? await fetchVideoDetails(room.host, streamId) : null; }
        catch { /* Hive unreachable — treat as unannounced and stay on this page */ }
        if (!alive) return;
        setState({ status: 'live', room, hivePost });
      })
      .catch(() => { if (alive) setState({ status: 'notfound', room: null, hivePost: null }); });
    return () => { alive = false; };
  }, [streamId]);

  const post = state.room?.post || {};
  const tags = Array.isArray(post.tags) ? post.tags : [];

  // Recommended videos related to the stream's first tag.
  useEffect(() => {
    let alive = true;
    const tag = tags[0];
    if (state.status !== 'live' || !tag) { setRecommended({ loading: false, videos: [] }); return undefined; }
    setRecommended({ loading: true, videos: [] });
    axios.get(`${TAG_FEED_URL}/videos/tag/${encodeURIComponent(tag)}?page=1&limit=8&type=videos`)
      .then((res) => { if (alive) setRecommended({ loading: false, videos: res.data?.videos || [] }); })
      .catch(() => { if (alive) setRecommended({ loading: false, videos: [] }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, tags[0]]);

  const mirrorChatToHive = useStreamChatMirror({
    author: state.room?.host,
    permlink: streamId,
    // `liveAt` is the server's stamp of the moment the host hit Start, which is
    // also when recording began — so timecodes line up with the VOD's timeline.
    // The post's timestamp is a fallback (the announcement lands seconds after
    // go-live); `createdAt` — when the room was OPENED, possibly long before —
    // is the last resort for rooms that pre-date the stamp.
    startedAt: state.room?.liveAt || state.hivePost?.created_at || state.room?.createdAt,
    hasPost: !!state.hivePost,
  });

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard unavailable */ }
  };

  if (state.status === 'loading') return <BarLoader />;

  if (state.status !== 'live') {
    return (
      <div className="ws-error">
        <p>{state.status === 'notlive' ? 'This stream isn’t live right now.' : 'No live stream found for this link.'}</p>
        <button className="ws-error-btn" onClick={() => navigate('/openpods')}>Browse live streams</button>
        {/* Same floating back affordance the live view has (.shortBackBtn),
            so leaving a dead link works exactly like leaving a live one. */}
        <button
          className="shortBackBtn ws-error-back"
          onClick={() => navigate('/')}
          title="Back to 3Speak"
        >
          <ArrowLeft size={18} />
        </button>
      </div>
    );
  }

  const { room } = state;

  // Announced on Hive → hand the viewer to the real watch page, which is the
  // same stream plus everything a post gets: votes, payout, comments, playlists
  // and the VOD once it publishes. It renders the live player in the video slot
  // and puts this chat where the reaction panel goes (see Watch.jsx).
  //
  // Desktop only. On a phone the shorts-style layout below is the better
  // experience and the watch page's sidebar — where the chat would live — is
  // collapsed away anyway.
  if (!mobileLayout && state.hivePost) {
    return <Navigate to={`/watch?v=${room.host}/${streamId}`} replace />;
  }
  const host = room.host;
  const title = post.title || room.title;
  const description = post.description || room.description || '';

  // --- mobile: the shorts layout, rendered exactly as Short.jsx does -------
  // Top level, NOT inside .play-container: `.short-main` is position:fixed at
  // ≤767px and a wrapper with its own layout context was penning it in, which
  // is why the player sat inline with the nav instead of covering the screen.
  if (mobileLayout) {
    return (
      <>
        <SEOHead title={`${title} (LIVE)`} author={host} url={window.location.href} />
        <HangoutsProvider
          apiBaseUrl={API_URL}
          livekitServerUrl={LK_URL}
          imageServerApiKey={IMAGE_KEY || undefined}
          sessionToken={sessionToken || undefined}
          username={hangoutsUser || undefined}
          aioha={aioha}
        >
          {!connectReady ? <BarLoader /> : (
            <StandaloneWatch key={joinKey} roomName={streamId} connecting={<BarLoader />}>
              <main className={`short-main no-bottom-bar ws-shorts${isLandscape ? ' ws-shorts--landscape' : ''}${!infoVisible ? ' ws-info-hidden' : ''}`}>
                <div className="videoWrapper">
                  <div className="videoContainer" ref={pagerRef} onClick={revealInfo}>
                    <StreamVideo showLiveBadge={false} />

                    {/* Same back affordance as the shorts feed. */}
                    <button
                      className="shortBackBtn"
                      onClick={(e) => { e.stopPropagation(); navigate('/'); }}
                      title="Back to 3Speak"
                    >
                      <ArrowLeft size={18} />
                    </button>

                    {/* Quality lives in the top-right corner, not the rail. */}
                    <div className="ws-shorts__quality" onClick={(e) => e.stopPropagation()}>
                      <StreamQualityControl />
                    </div>

                    {hasNextLive && (
                      <div className="ws-shorts__next-hint" aria-hidden="true">
                        Swipe for the next live stream
                      </div>
                    )}

                    <div className="bottomOverlay">
                      <div className="ws-shorts__live">
                        <span className="ws-live-tag">● LIVE</span>
                        <StreamViewerCount render={(c) => <span className="ws-shorts__watching">👁 {c}</span>} />
                      </div>
                      <div className="userRow" onClick={(e) => e.stopPropagation()}>
                        <AuthorBadge author={host} showFollow fetchFollowers color="#fff" />
                      </div>
                      <div className="caption">
                        <p className="captionText">{title}</p>
                        {description && <p className="captionText ws-shorts__desc">{description}</p>}
                      </div>
                    </div>

                    <div className="actionSidebar" onClick={(e) => e.stopPropagation()}>
                      <div className="actionItem" onClick={() => setChatOverlayOn((v) => !v)}>
                        <div className={`actionButton${chatOverlayOn ? ' liked' : ''}`}>
                          <MessageSquare size={24} />
                        </div>
                        <span className="actionLabel">Chat</span>
                      </div>
                      <CollabRequest variant="rail" canRequest={canInteract} />
                      <StreamBoostButton variant="rail" />
                      <div className="actionItem" onClick={copyLink}>
                        <div className="actionButton"><Share2 size={24} /></div>
                        <span className="actionLabel">{copied ? 'Copied' : 'Share'}</span>
                      </div>
                      <StreamClipButton roomName={streamId} variant="sidebar" />
                      <StreamReportButton roomName={streamId} host={host} variant="sidebar" />
                    </div>

                    {chatOverlayOn && (
                      <div className="ws-shorts__chat">
                        {/* Messages only — the composer lives in the bottom bar. */}
                        <ChatPanel readOnly readOnlyNotice="" />
                      </div>
                    )}
                  </div>
                </div>
                <StreamChatBar canChat={canInteract} needsSignIn={needsSignIn} onSignIn={signIn} signingIn={signingIn} onSent={mirrorChatToHive} />
              </main>
            </StandaloneWatch>
          )}
        </HangoutsProvider>
      </>
    );
  }

  return (
    <div className="play-container watch-v2 ws-page">
      <SEOHead title={`${title} (LIVE)`} author={host} url={window.location.href} />
      <HangoutsProvider
        apiBaseUrl={API_URL}
        livekitServerUrl={LK_URL}
        imageServerApiKey={IMAGE_KEY || undefined}
        sessionToken={sessionToken || undefined}
        username={hangoutsUser || undefined}
        aioha={aioha}
      >
        {!connectReady ? <BarLoader /> : (

        <StandaloneWatch key={joinKey} roomName={streamId} connecting={<BarLoader />}>
          <div className="ws-grid">
            {/* Main column */}
            <div className="ws-col-main">
              <div className="ws-player">
                <StreamVideo showLiveBadge={false} />
              </div>

              {/* Info area — reuses the watch page (PlayVideo) classes so it
                  looks identical. The `.play-video` wrapper scopes them. */}
              <div className="play-video ws-play-video">
                <div className="top-container">
                  <div className="video-title-row">
                    <div className="video-title-col">
                      <div className="video-title-line">
                        <span className="ws-live-tag">● LIVE</span>
                        <h3>{title}</h3>
                        <StreamViewerCount render={(c) => <span className="ws-watching">👁 {c} watching now</span>} />
                      </div>
                    </div>
                  </div>

                  {/* Quality sits in the author row rather than on its own
                      line under the player — one less band of chrome between
                      the video and the title. */}
                  <div className="badges-row ws-badges-row">
                    <AuthorBadge author={host} showFollow fetchFollowers />
                    <div className="ws-quality-slot">
                      <StreamQualityControl />
                    </div>
                  </div>

                  {tags.length > 0 && (
                    <div className="community-tags-row">
                      <div className="tag-wrapper">
                        {tags.map((t, i) => (
                          <span key={i} onClick={() => navigate(`/t/${t}`)}>{t}</span>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="play-video-info">
                    <div className="info-buttons-row">
                      <div className="info-buttons-right">
                        {needsSignIn
                          ? <StreamSignInButton variant="overlay" label="Sign in to raise your hand" onSignIn={signIn} busy={signingIn} />
                          : <CollabRequest canRequest={canInteract} />}
                        <StreamBoostButton />
                        <button type="button" className="pv-btn share-btn" onClick={copyLink} title="Copy the stream link">
                          <MdShare size={16} /><span>{copied ? 'Copied' : 'Share'}</span>
                        </button>
                        <button type="button" className="pv-btn vote-btn" disabled title="Not available for live streams">
                          <FaThumbsUp size={14} /><span>Vote</span>
                        </button>
                        <button type="button" className="pv-btn" disabled title="Not available for live streams">
                          <FaRegCommentAlt size={14} /><span>Comment</span>
                        </button>
                        <button type="button" className="pv-btn" disabled title="Not available for live streams">
                          <FaBookmark size={14} /><span>Save</span>
                        </button>
                        <StreamClipButton roomName={streamId} />
                        <StreamReportButton roomName={streamId} host={host} />
                      </div>
                    </div>
                  </div>

                  {description && (
                    <div className="description-wrap">
                      <div className="blog-content ws-desc-text">{description}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Side column: chat + recommended */}
            <div className="ws-col-side">
              <div className="ws-chat">
                <div className="ws-chat-head">Live chat</div>
                <ChatPanel
                  readOnly={!canInteract}
                  readOnlyNotice={needsSignIn
                    ? <StreamSignInButton label="Sign in to chat" onSignIn={signIn} busy={signingIn} />
                    : '🔒 Sign in to join the chat.'}
                  onMessageSent={mirrorChatToHive}
                />
              </div>

              {(recommended.loading || recommended.videos.length > 0) && (
                <div className="ws-recommended">
                  <h3 className="ws-recommended-head">More {tags[0] ? `#${tags[0]}` : 'videos'}</h3>
                  <Card3 videos={recommended.videos} loading={recommended.loading} />
                </div>
              )}
            </div>
          </div>
        </StandaloneWatch>
        )}
      </HangoutsProvider>

    </div>
  );
}
