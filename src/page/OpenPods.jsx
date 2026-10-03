import { useCallback, useEffect, useRef, useState } from 'react';
import { HangoutsProvider, RoomLobby } from '@snapie/hangouts-react';
import '@snapie/hangouts-react/src/styles/hangouts.css';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useAioha } from '@aioha/react-ui';
import { useTranslation } from 'react-i18next';
import { useHangout } from '../context/HangoutContext';
import { broadcastWithAioha, getOperationUser } from '../hive-api/aioha';
import { useAppStore } from '../lib/store';
import { usePremiumStatus } from '../hooks/usePremiumStatus';
import { providerSignPrompt } from '../utils/aiohaProviderUi';
import { OPENPODS_STANDALONE } from '../utils/config';
import { defaultEndpoint, pickLeastLoadedEndpoint, fetchAllEndpoints } from '../utils/hangoutsEndpoints';
import { postOpenPodAnnouncement, setPendingAnnouncement, setAnnounceConfig } from '../utils/openpodAnnounce';
import AnnounceOptions from '../components/openpods/AnnounceOptions';
import MarkdownComposer from '../components/studio/MarkdownComposer';
import './OpenPods.scss';

// Strip any trailing slash — useHangoutsRoom builds `${apiBaseUrl}/rooms` with a
// raw fetch, so a trailing slash yields `//rooms` and a 404 from the API.
const API_URL = (import.meta.env.VITE_HANGOUTS_API_URL || '').replace(/\/$/, '');
const LK_URL = import.meta.env.VITE_LIVEKIT_URL || 'wss://livekit.3speak.tv';
const IMAGE_KEY = import.meta.env.VITE_IMAGE_SERVER_API_KEY;
// Premium/Pro (/premium/*) is served by the hangouts deployment that has those
// routes — not (yet) the prod rooms API. Empty ⇒ falls back to apiBaseUrl.
const PREMIUM_API = (import.meta.env.VITE_HANGOUTS_PREMIUM_API_URL || '').replace(/\/$/, '');

export default function OpenPods() {
  const { t } = useTranslation();
  const { openRoom, activeRoom, sessionToken, sessionLoading, hangoutsUser, retryLogin } = useHangout();
  const { authenticated, user } = useAppStore();
  // Follow the 3speak-selected theme (light/dark/system) for the SDK lobby.
  const hhTheme = useAppStore((s) => s.getEffectiveTheme());
  const { aioha, provider, user: aiohaUser } = useAioha();
  const navigate = useNavigate();
  const location = useLocation();
  // A create request from a menu item ("Group chat" / "Start stream").
  //
  // REACTIVE, not read-once: clicking one of those while already on /openpods
  // changes the URL but does NOT remount this page, so a ref captured at mount
  // would keep the first mode forever — which is exactly why switching the
  // menu item didn't switch the form. `seq` rises on every request so
  // re-clicking the same item (e.g. after cancelling) still re-opens it, and
  // it keys <RoomLobby> below so a mode change remounts it with the new draft.
  const parseCreate = (search) => {
    const p = new URLSearchParams(search);
    const m = p.get('mode');
    return { open: p.get('create') === '1', mode: m === 'conference' || m === 'standalone' ? m : undefined };
  };
  const [createReq, setCreateReq] = useState(() => ({ ...parseCreate(location.search), seq: 0 }));
  useEffect(() => {
    const parsed = parseCreate(location.search);
    if (!parsed.open) return;
    setCreateReq((prev) => ({ ...parsed, seq: prev.seq + 1 }));
    // Strip both params so a reload — or landing back here after the studio
    // closes — doesn't reopen the dialog.
    const params = new URLSearchParams(location.search);
    params.delete('create');
    params.delete('mode');
    const qs = params.toString();
    navigate({ pathname: location.pathname, search: qs ? `?${qs}` : '' }, { replace: true });
  }, [location.search, location.pathname, navigate]);
  const { roomName: roomNameFromUrl } = useParams();
  const premiumStatus = usePremiumStatus(user);
  const isPremium = !!premiumStatus?.premium;

  // New sessions go to whichever deployment reports the lightest load
  // (fewest sessions, then fewest viewers) via its /health.
  const [endpoint, setEndpoint] = useState(() => defaultEndpoint());
  useEffect(() => {
    let alive = true;
    pickLeastLoadedEndpoint().then((ep) => { if (alive) setEndpoint(ep); });
    return () => { alive = false; };
  }, []);

  // A session we can hand over to OpenPods. Deliberately NOT limited to wallets
  // that can sign client-side: the challenge is signed server-side by
  // @threespeak's DELEGATED posting authority, which works for every login type
  // — including HiveSigner and ManteAuth, neither of which can sign a buffer in
  // the browser. loginToHangouts tries that delegated signer FIRST and only
  // falls back to a client-side signature. Gating on a signable provider (as
  // this used to) meant mobile users, who have no Keychain extension, never got
  // a handover at all and were told to sign in again.
  const handoverUser = aiohaUser || user;
  const canHandover = !!authenticated && !!handoverUser;

  // If they're genuinely signed in on 3Speak, hand that session over in the
  // background so hosting/speaking lights up automatically. Otherwise do
  // nothing — they browse as a guest and sign on demand (button below).
  // Either way the lobby renders immediately and never blocks.
  const handoverTriedRef = useRef(null);
  const [handoverFailed, setHandoverFailed] = useState(false);
  useEffect(() => {
    if (!canHandover || sessionToken || sessionLoading) return;
    // Exactly ONE automatic attempt per user. A failed handover clears
    // sessionLoading, which re-triggers this effect — without this guard a user
    // who hasn't granted @threespeak posting authority would sit in a tight
    // retry loop hammering /openpods/sign-challenge with 403s.
    if (handoverTriedRef.current === handoverUser) return;
    handoverTriedRef.current = handoverUser;
    setHandoverFailed(false);
    Promise.resolve(retryLogin(handoverUser)).then((token) => {
      if (!token) setHandoverFailed(true);
    });
  }, [canHandover, handoverUser, sessionToken, sessionLoading, retryLogin]);

  // Deep-link: /openpods/:roomName auto-opens the modal once. We track the
  // last-opened name so closing the modal doesn't immediately reopen on the
  // next render (the URL still carries the param). A fresh nav to a different
  // room name re-fires.
  const openedDeepLinkRef = useRef(null);
  useEffect(() => {
    if (!roomNameFromUrl) return;
    if (openedDeepLinkRef.current === roomNameFromUrl) return;
    openedDeepLinkRef.current = roomNameFromUrl;
    openRoom(roomNameFromUrl);
  }, [roomNameFromUrl, openRoom]);

  /**
   * Open a room AND put it in the address bar.
   *
   * Switching apps can make a mobile browser discard the page entirely; it then
   * reloads from the URL, and every bit of React state — including which room
   * the host was broadcasting in — is gone. Without the room name in the path,
   * a streamer who checked a message came back to the lobby with their stream
   * abandoned. `/openpods/:roomName` already deep-links, so this just makes the
   * live session use it.
   */
  // Once the room closes, drop it from the URL — otherwise a later reload
  // deep-links straight back into a session that has ended. Gated on having
  // actually been in a room, because activeRoom is briefly null on a cold deep
  // link before openRoom() runs, and navigating then would kill the deep link
  // we were in the middle of following.
  const wasInRoomRef = useRef(false);
  useEffect(() => {
    if (activeRoom) { wasInRoomRef.current = true; return; }
    if (!wasInRoomRef.current || !roomNameFromUrl) return;
    wasInRoomRef.current = false;
    openedDeepLinkRef.current = null;
    // Only rewrite the URL to the lobby if we're STILL on an /openpods route.
    // When the modal is closed by navigating elsewhere — e.g. the ended screen's
    // "Back to Home" → '/' — leave that destination intact instead of yanking
    // the user back to /openpods.
    if (location.pathname.startsWith('/openpods')) {
      navigate('/openpods', { replace: true });
    }
  }, [activeRoom, roomNameFromUrl, navigate, location.pathname]);

  const openRoomAtUrl = useCallback((name) => {
    if (!name) return;
    // Claim the deep-link guard first: the effect below watches the URL and
    // would otherwise treat our own navigation as a fresh deep link.
    openedDeepLinkRef.current = name;
    openRoom(name);
    navigate(`/openpods/${encodeURIComponent(name)}`, { replace: true });
  }, [navigate, openRoom]);

  // The Pro offer now lives in the SDK, rendered by CreateRoomDialog right
  // beside the locked recording checkboxes — a better moment than this page's
  // old post-create interception, which could only fire once the host had
  // already committed. Nothing to defer here any more.
  const handleRoomCreated = async (room, options) => {
    // Open the modal immediately — don't wait for the Hive post
    openRoomAtUrl(room.name);

    // Carry the create dialog's "Announce on Hive" choice into the shared
    // config, so the studio's own toggle opens matching it. Without this the
    // studio showed announcing as ON (its persisted default) for a room that
    // was deliberately created with announcements off.
    setAnnounceConfig({ announceEnabled: options?.notifyOnHive !== false });

    // Honor that choice — when unchecked, skip the announcement so
    // private/test rooms don't litter the user's blog.
    if (options && options.notifyOnHive === false) return;
    if (!authenticated || !user) return;

    // community/payout/beneficiaries come from the shared announce config
    // (edited in the dialog AND the studio post tab), read at post time.
    const payload = { room, options, user, isPremium };

    // A standalone stream must ONLY announce once the host actually hits
    // "Start Stream" in the studio — not when the room is created. Stash the
    // intent; OpenPodModal fires it (room-scoped) on the start signal.
    if (room.mode === 'standalone') {
      setPendingAnnouncement(payload);
      return;
    }

    // Conference rooms have no separate "start" step — announce right away.
    await postOpenPodAnnouncement(payload);
  };

  // List rooms from EVERY deployment, not just the one we'd create on.
  // Joining still works by name — OpenPodModal resolves the owning host.
  // useCallback keeps the identity stable so the lobby's 10s poll survives.
  // Conferences only. A standalone stream is a broadcast, not a room you drop
  // into to talk: it has one publisher, viewers watch it on the 3Speak watch
  // page, and joining it from here would put a spectator into the room UI. It
  // already surfaces in the feeds as a LIVE card. Rooms created before the
  // standalone split carry no `mode`, and those were all conferences.
  const fetchAllRooms = useCallback(
    () => fetchAllEndpoints('/rooms').then((rooms) => (Array.isArray(rooms) ? rooms : [])
      .filter((r) => (r?.mode ?? 'conference') === 'conference')),
    [],
  );

  const handleJoinRoom = (roomName) => {
    openRoomAtUrl(roomName);
  };

  // Single guest-first path: the lobby always renders, so visitors can browse
  // active OpenPods and drop into any room as listen-only guests (the SDK's
  // `allowGuestBrowse` / `guestFallback` handle the /listen flow). A hangouts
  // `sessionToken` — handed over from the user's 3Speak wallet session — simply
  // unlocks hosting and speaking on top of that. We never block on it.
  return (
    <div className="openpods-page" data-hh-theme={hhTheme}>
      <HangoutsProvider
        apiBaseUrl={endpoint.api}
        livekitServerUrl={endpoint.lk}
        imageServerApiKey={IMAGE_KEY || undefined}
        sessionToken={sessionToken || undefined}
        username={hangoutsUser || undefined}
        aioha={aioha}
        /* Premium + the free trial are served by the hangouts deployment that
           has /premium routes, which is not (yet) the prod rooms API. */
        premiumApiBaseUrl={PREMIUM_API || undefined}
        theme={hhTheme}
        pro={{
          /* 3Speak's wrapper, not raw aioha: it handles the ButrAuth /
             HiveSigner proxy paths. And ButrAuth sessions carry no aioha user,
             so the username has to come from getOperationUser(). */
          broadcastOps: (ops, keyType) => broadcastWithAioha(ops, keyType),
          getUsername: () => getOperationUser() || user,
        }}
      >
        <RoomLobby
          key={`create-${createReq.mode ?? 'any'}-${createReq.seq}`}
          /* "Go Live" links to /openpods?create=1 — open the create form
             straight away instead of making the host find the button. The
             dialog itself stays gated on being authenticated, so it appears
             as soon as the handover lands.

             Read ONCE, from a ref: the flag is stripped from the URL below, and
             any later return to this page (closing the studio, a dropped
             connection) must not re-open the create form on top of the lobby. */
          defaultCreateOpen={createReq.open}
          defaultMode={createReq.mode}
          onJoinRoom={handleJoinRoom}
          onRoomCreated={handleRoomCreated}
          fetchRooms={fetchAllRooms}
          allowGuestBrowse
          allowStandalone={OPENPODS_STANDALONE}
          /* Snaps disabled on 3Speak — announcements are always a full post. */
          allowSnapAnnounce={false}
          /* We present our own live listing elsewhere — /openpods should land
             the host straight in the create-room wizard, never the SDK lobby.
             Cancelling goes home. (hideEmptyState is a belt-and-braces for the
             guest fall-through, where the wizard needs a login first.) */
          createOnly
          onCreateCancel={() => navigate('/')}
          hideEmptyState
          isPremium={isPremium}
          renderAnnounceOptions={(announceType) => (
            <AnnounceOptions announceType={announceType} isPremium={isPremium} />
          )}
          renderDescriptionEditor={(value, onChange) => (
            <MarkdownComposer
              value={value}
              onChange={onChange}
              placeholder={t('live.lobby.descriptionPlaceholder')}
            />
          )}
        />
      </HangoutsProvider>

      {/* No session yet → show the right call-to-action without blocking the
          lobby. Signing in progress · can hand over on demand · not signed in. */}
      {!sessionToken && (
        <div className="openpods-guest-cta">
          {sessionLoading ? (
            <span className="openpods-connecting__action">{providerSignPrompt(provider)}</span>
          ) : canHandover ? (
            <>
              <button
                className="openpods-login-btn"
                onClick={() => {
                  handoverTriedRef.current = null;
                  setHandoverFailed(false);
                  retryLogin(handoverUser);
                }}
              >
                {t('live.lobby.enableHosting')}
              </button>
              {handoverFailed && (
                <p className="openpods-guest-cta__hint">
                  {t('live.lobby.handoverFailed')}
                </p>
              )}
            </>
          ) : (
            <button className="openpods-login-btn" onClick={() => navigate('/login')}>
              {t('live.lobby.signInToHost')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
