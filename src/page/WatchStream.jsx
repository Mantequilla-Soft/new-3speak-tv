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
import CroppableStreamVideo from '../components/openpods/CroppableStreamVideo';
import LiveAdLayer from '../components/openpods/LiveAdLayer';
import StreamFullscreenButton from '../components/openpods/StreamFullscreenButton';
import StreamWatermark from '../components/openpods/StreamWatermark';
import StreamSignInButton from '../components/openpods/StreamSignInButton';
import { useStreamSession } from '../hooks/useStreamSession';
import { useLiveStreamPager } from '../hooks/useLiveStreamPager';
import { useStreamChatMirror } from '../hooks/useStreamChatMirror';
import { fetchVideoDetails } from '../lib/videoData';
import { defaultEndpoint, findRoomEndpoint } from '../utils/hangoutsEndpoints';
// The mobile layout reuses the shorts page's classes — load its styles too.
import './Short.scss';
import SEOHead from '../components/SEOHead';
import BarLoader from '../components/Loader/BarLoader';
import Card3 from '../components/Cards/Card3';
import AuthorBadge from '../components/AuthorBadge/AuthorBadge';
import { Button, DockTile, EmptyState, Icon, StatusPill } from '../components/v2/ui';

import { TAG_FEED_URL } from '../utils/config';
import { useTranslation } from 'react-i18next';
import './WatchStream.scss';

// A room lives on exactly ONE hangouts deployment (VITE_HANGOUTS_API_URLS), e.g.
// a stream started from OBS is created on the server that has the templates.
// So the page looks the room up across all of them, like LiveStreamPlayer, and
// connects to that server's API + LiveKit pair.
const IMAGE_KEY = import.meta.env.VITE_IMAGE_SERVER_API_KEY;
// The viewer's last vertical/full choice on phones. A per-device convenience,
// so plain localStorage; vertical is the default when nothing is stored.
const VERTICAL_PREF_KEY = 'ws-vertical-view';
function readVerticalPref() {
  try { return localStorage.getItem(VERTICAL_PREF_KEY) !== '0'; } catch { return true; }
}
// Chat over the picture, on or off. Same kind of convenience; on unless turned off.
const CHAT_OVERLAY_KEY = 'ws-chat-overlay';
function readChatOverlayPref() {
  try { return localStorage.getItem(CHAT_OVERLAY_KEY) !== '0'; } catch { return true; }
}

/**
 * The chat composer, docked to the bottom of the screen like the shorts
 * comment bar — separate from the chat overlay, which shows messages only.
 * Must live inside <StandaloneWatch> to reach the LiveKit room context.
 */
function StreamChatBar({ canChat, needsSignIn = false, onSignIn, signingIn = false, onSent }) {
  // The SDK's chat hook — ChatPanel renders what THIS publishes. LiveKit's
  // own useChat is a different transport; sending on it meant neither the
  // viewer nor the streamer ever saw the message.
  const { t } = useTranslation();
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
        placeholder={canChat ? t('misc.watchStream.saySomething') : (signingIn ? t('misc.watchStream.waitingWallet') : t('misc.watchStream.signInToChat'))}
        value={text}
        // Signed in to 3Speak but not to the room yet: tapping the box is the
        // "I want to chat" moment, so that is when the wallet is asked.
        readOnly={!canChat && needsSignIn}
        onFocus={() => { if (!canChat && needsSignIn && !signingIn) onSignIn?.(); }}
        disabled={!canChat && !needsSignIn}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
      />
      <button className="sendCommentBtn" type="submit" disabled={!canChat || !text.trim()} aria-label={t('misc.watchStream.sendMessage')}>
        <Icon name="send" size={20} fill />
      </button>
    </form>
  );
}

export default function WatchStream() {
  const { t } = useTranslation();
  const { streamId } = useParams();
  const navigate = useNavigate();
  const { aioha, sessionToken, hangoutsUser, connectReady, joinKey, needsSignIn, canInteract, signIn, signingIn } = useStreamSession();

  const [state, setState] = useState({ status: 'loading', room: null, hivePost: null });
  const [endpoint, setEndpoint] = useState(() => defaultEndpoint());
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

  const [chatOverlayOn, setChatOverlayOn] = useState(readChatOverlayPref);
  // Phones: the viewer's "clean view". Everything over the picture goes (rail,
  // caption, chat, composer, quality, back); one small button in the top-right
  // corner brings it all back.
  const [controlsHidden, setControlsHidden] = useState(false);

  // Dual format: a landscape stream on a phone held upright plays as a vertical,
  // draggable crop by default. The switch only appears when the stream really is
  // landscape (CroppableStreamVideo reads the decoded frame size), and a phone
  // turned sideways always gets the full frame.
  const [streamLandscape, setStreamLandscape] = useState(null);
  const [verticalPref, setVerticalPref] = useState(readVerticalPref);
  const toggleVertical = () => {
    setVerticalPref((v) => {
      const next = !v;
      try { localStorage.setItem(VERTICAL_PREF_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  };
  const canCrop = !isLandscape && streamLandscape === true;
  const verticalOn = !isLandscape && verticalPref;
  // While LiveAdLayer holds the stream for a pre-roll: the stream's sound is off
  // and, on phones, its chrome (chat, rail, caption) steps out of the ad's way.
  const [prerollHold, setPrerollHold] = useState(false);
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
    if (!streamId || !defaultEndpoint().api) { setState({ status: 'notfound', room: null, hivePost: null }); return undefined; }
    findRoomEndpoint(streamId)
      .then((ep) => {
        if (alive) setEndpoint(ep);
        return fetch(`${ep.api}/rooms/${encodeURIComponent(streamId)}`);
      })
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
    const notLive = state.status === 'notlive';
    return (
      <div className="ws-error">
        <EmptyState
          icon={notLive ? 'live_tv' : 'search_off'}
          title={notLive ? t('misc.watchStream.notLive') : t('misc.watchStream.notFound')}
          action={(
            <div className="ws-error__actions">
              <Button variant="primary" next className="ws-error-btn" onClick={() => navigate('/openpods')}>
                {t('misc.watchStream.browse')}
              </Button>
              {/* The way out a dead link needs, like the live view's back button. */}
              <Button variant="secondary" icon="arrow_back" className="ws-error-back" onClick={() => navigate('/')}>
                {t('misc.watchStream.back')}
              </Button>
            </div>
          )}
        />
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
    return <Navigate to={`/@${room.host}/${streamId}`} replace />;
  }
  const host = room.host;
  // Set by the hangouts server on a stream started from OBS by a non-Pro host.
  const showWatermark = !!(room.headless && room.watermark);
  const title = post.title || room.title;
  const description = post.description || room.description || '';

  // --- mobile: the shorts layout, rendered exactly as Short.jsx does -------
  // Top level, NOT inside .play-container: `.short-main` is position:fixed at
  // ≤767px and a wrapper with its own layout context was penning it in, which
  // is why the player sat inline with the nav instead of covering the screen.
  if (mobileLayout) {
    return (
      <>
        <SEOHead title={t('misc.watchStream.seoTitle', { title })} author={host} url={window.location.href} />
        <HangoutsProvider
          apiBaseUrl={endpoint.api}
          livekitServerUrl={endpoint.lk}
          imageServerApiKey={IMAGE_KEY || undefined}
          sessionToken={sessionToken || undefined}
          username={hangoutsUser || undefined}
          aioha={aioha}
        >
          {!connectReady ? <BarLoader /> : (
            <StandaloneWatch key={joinKey} roomName={streamId} connecting={<BarLoader />} audioMuted={prerollHold}>
              <main className={`short-main no-bottom-bar ws-shorts${isLandscape ? ' ws-shorts--landscape' : ''}${!infoVisible ? ' ws-info-hidden' : ''}${prerollHold ? ' ws-preroll-on' : ''}${chatOverlayOn ? '' : ' ws-chat-off'}${controlsHidden ? ' ws-controls-hidden' : ''}`}>
                <div className="videoWrapper">
                  <div className="videoContainer" ref={pagerRef} onClick={revealInfo}>
                    <CroppableStreamVideo vertical={verticalOn} onOrientation={setStreamLandscape} />
                    {/* Free host streaming from OBS: draw the 3Speak mark the
                        browser studio would have burned in. Follows the crop. */}
                    <StreamWatermark show={showWatermark} />
                    {/* Ticker + drawn banner. Below the back button / quality row. */}
                    <LiveAdLayer
                      host={host}
                      room={streamId}
                      fit={verticalOn && streamLandscape ? 'cover' : 'contain'}
                      tickerTop="calc(52px + env(safe-area-inset-top, 0px))"
                      onPreroll={setPrerollHold}
                    />

                    {/* Same back affordance as the shorts feed. */}
                    <button
                      className="shortBackBtn"
                      // Back to where the viewer came from (a profile, a feed), like
                      // the shorts feed; home only when the stream was opened
                      // straight from a link and there is nothing in the app to go back to.
                      onClick={(e) => { e.stopPropagation(); if (window.history.state?.idx > 0) navigate(-1); else navigate('/'); }}
                      title={t('misc.watchStream.back')}
                      aria-label={t('misc.watchStream.back')}
                    >
                      <Icon name="arrow_back" size={20} />
                    </button>

                    {/* Quality lives in the top-right corner, not the rail. */}
                    <div className="ws-shorts__quality" onClick={(e) => e.stopPropagation()}>
                      <StreamQualityControl />
                    </div>

                    {hasNextLive && (
                      <div className="ws-shorts__next-hint" aria-hidden="true">
                        <Icon name="swipe_up" size={16} />
                        {t('misc.watchStream.swipeNext')}
                      </div>
                    )}

                    <div className="bottomOverlay">
                      <div className="ws-shorts__live">
                        <StatusPill tone="live" className="ws-live-tag">{t('feeds.live.badge')}</StatusPill>
                        <StreamViewerCount render={(c) => (
                          <span className="ws-shorts__watching">
                            <Icon name="visibility" size={14} /><span className="num">{c}</span>
                          </span>
                        )} />
                      </div>
                      <div className="userRow" onClick={(e) => e.stopPropagation()}>
                        <AuthorBadge author={host} showFollow fetchFollowers color="var(--on-media)" />
                      </div>
                      <div className="caption">
                        <p className="captionText">{title}</p>
                        {description && <p className="captionText ws-shorts__desc">{description}</p>}
                      </div>
                    </div>

                    <div className="actionSidebar" onClick={(e) => e.stopPropagation()}>
                      <div className="actionItem" onClick={() => setChatOverlayOn((v) => {
                        try { localStorage.setItem(CHAT_OVERLAY_KEY, v ? '0' : '1'); } catch { /* storage off */ }
                        return !v;
                      })}>
                        <div className={`actionButton${chatOverlayOn ? ' liked' : ''}`}>
                          <Icon name="chat" size={24} fill={chatOverlayOn} />
                        </div>
                        <span className="actionLabel">{t('misc.watchStream.chat')}</span>
                      </div>
                      <CollabRequest variant="rail" canRequest={canInteract} />
                      <StreamBoostButton variant="rail" />
                      {canCrop && (
                        <div className="actionItem" onClick={toggleVertical}>
                          <div className="actionButton">
                            <Icon name={verticalPref ? 'crop_landscape' : 'crop_portrait'} size={24} />
                          </div>
                          <span className="actionLabel">{verticalPref ? t('misc.watchStream.fullView') : t('misc.watchStream.verticalView')}</span>
                        </div>
                      )}
                      <div className="actionItem" onClick={copyLink}>
                        <div className="actionButton"><Icon name={copied ? 'check' : 'share'} size={24} /></div>
                        <span className="actionLabel">{copied ? t('common.actions.copied') : t('common.actions.share')}</span>
                      </div>
                      <StreamClipButton roomName={streamId} variant="sidebar" />
                      <StreamReportButton roomName={streamId} host={host} variant="sidebar" />
                      <div className="actionItem" onClick={() => setControlsHidden(true)}>
                        <div className="actionButton"><Icon name="visibility_off" size={24} /></div>
                        <span className="actionLabel">{t('misc.watchStream.hideControls')}</span>
                      </div>
                    </div>

                    {controlsHidden && (
                      <button
                        type="button"
                        className="ws-shorts__show-controls"
                        onClick={(e) => { e.stopPropagation(); setControlsHidden(false); }}
                        aria-label={t('misc.watchStream.showControls')}
                        title={t('misc.watchStream.showControls')}
                      >
                        <Icon name="visibility" size={20} />
                      </button>
                    )}

                    {chatOverlayOn && (
                      <div className="ws-shorts__chat">
                        {/* Messages only — the composer lives in the bottom bar. */}
                        <ChatPanel readOnly readOnlyNotice="" />
                      </div>
                    )}
                  </div>
                </div>
                {/* Chat switched off on the rail: the composer (and its "sign in to
                    chat" prompt) goes with the messages. */}
                {chatOverlayOn && !controlsHidden && (
                  <StreamChatBar canChat={canInteract} needsSignIn={needsSignIn} onSignIn={signIn} signingIn={signingIn} onSent={mirrorChatToHive} />
                )}
              </main>
            </StandaloneWatch>
          )}
        </HangoutsProvider>
      </>
    );
  }

  const notLiveTitle = t('misc.watchStream.notAvailableLive');

  return (
    <div className="ws-page">
      <SEOHead title={t('misc.watchStream.seoTitle', { title })} author={host} url={window.location.href} />
      <HangoutsProvider
        apiBaseUrl={endpoint.api}
        livekitServerUrl={endpoint.lk}
        imageServerApiKey={IMAGE_KEY || undefined}
        sessionToken={sessionToken || undefined}
        username={hangoutsUser || undefined}
        aioha={aioha}
      >
        {!connectReady ? <BarLoader /> : (

        <StandaloneWatch key={joinKey} roomName={streamId} connecting={<BarLoader />} audioMuted={prerollHold}>
          {/* Live strip (18c): LIVE, who is watching, the tags, playback quality. */}
          <div className="ws-strip">
            <StatusPill tone="live" className="ws-live-tag">{t('feeds.live.badge')}</StatusPill>
            <StreamViewerCount render={(c) => <span className="ws-watching">{t('misc.watchStream.watchingNow', { count: c })}</span>} />
            {tags.length > 0 && (
              <span className="ws-strip__tags">
                {tags.map((tag, i) => (
                  <button key={i} type="button" className="ws-strip__tag" onClick={() => navigate(`/t/${tag}`)}>#{tag}</button>
                ))}
              </span>
            )}
            <span className="ws-strip__spacer" />
            <div className="ws-quality-slot">
              <StreamQualityControl />
            </div>
          </div>

          <div className="ws-grid">
            {/* Main column */}
            <div className="ws-col-main">
              <div className="ws-player">
                <StreamVideo showLiveBadge={false} />
                <StreamWatermark show={showWatermark} />
                <LiveAdLayer host={host} room={streamId} onPreroll={setPrerollHold} />
                <StreamFullscreenButton />
              </div>

              <div className="ws-info">
                <h1 className="ws-title">{title}</h1>
                <div className="ws-author-row">
                  <AuthorBadge author={host} showFollow fetchFollowers />
                </div>
              </div>

              {/* Tile dock (18c, 30b): taking part, boost, share, then what a
                  live stream can't do yet, then clip and report. */}
              <div className="ws-dock">
                {needsSignIn
                  ? <StreamSignInButton variant="dock" label={t('misc.watchStream.signInRaiseHand')} onSignIn={signIn} busy={signingIn} />
                  : <CollabRequest canRequest={canInteract} />}
                <StreamBoostButton />
                <DockTile icon={copied ? 'check' : 'share'} label={copied ? t('common.actions.copied') : t('common.actions.share')} onClick={copyLink} title={t('misc.watchStream.copyLink')} />
                <DockTile icon="thumb_up" label={t('misc.watchStream.vote')} disabled title={notLiveTitle} />
                <DockTile icon="chat_bubble" label={t('misc.watchStream.comment')} disabled title={notLiveTitle} />
                <DockTile icon="bookmark" label={t('common.actions.save')} disabled title={notLiveTitle} />
                <StreamClipButton roomName={streamId} />
                <StreamReportButton roomName={streamId} host={host} />
              </div>

              {description && (
                <div className="ws-desc">{description}</div>
              )}

              {(recommended.loading || recommended.videos.length > 0) && (
                <section className="ws-recommended">
                  <h2 className="ws-recommended-head">{tags[0] ? t('misc.watchStream.moreTag', { tag: tags[0] }) : t('misc.watchStream.moreVideos')}</h2>
                  <Card3 videos={recommended.videos} loading={recommended.loading} />
                </section>
              )}
            </div>

            {/* Side column: the chat, always beside the stream (18c). */}
            <aside className="ws-col-side">
              <div className="ws-chat">
                <div className="ws-chat-head">
                  <Icon name="forum" size={18} />
                  <span>{t('misc.watchStream.liveChat')}</span>
                </div>
                <ChatPanel
                  readOnly={!canInteract}
                  readOnlyNotice={needsSignIn
                    ? <StreamSignInButton label={t('misc.watchStream.signInToChat')} onSignIn={signIn} busy={signingIn} />
                    : t('misc.watchStream.signInToJoin')}
                  onMessageSent={mirrorChatToHive}
                />
              </div>
            </aside>
          </div>
        </StandaloneWatch>
        )}
      </HangoutsProvider>
    </div>
  );
}
