import { Route, Routes, useLocation, useNavigate, Navigate } from "react-router-dom";
import { useRef, lazy, Suspense } from "react";
import "./App.css";
// import Home from './page/Home'
// import Treanding from './page/Treanding'
import Nav from "./components/nav/Nav";
import { useState } from "react";
import Sidebar from "./components/Sidebar/Sidebar";
import HomeGrouped from "./page/HomeGrouped";
// KeyChainLogin replaced by LoginRedirect (opens aioha modal)
import { useAppStore } from "./lib/store";
import { useSupportBlock } from "./lib/supportBlockStore";
import { getCreatorSettings, isBanned } from "./utils/creatorSettings";
import SupportModal from "./components/SupportModal/SupportModal";
import CookieConsent from "./components/CookieConsent/CookieConsent";
import { GlobalReviewModal } from "./components/ReviewModal/ReviewModal";
import ReviewFab from "./components/ReviewModal/ReviewFab";
import { useEffect } from "react";
import { readAppVersion } from "./utils/appVersion";
import ChangelogModal from "./components/Changelog/ChangelogModal";
import ProfileNav from "./components/nav/ProfileNav";
// Legacy studio is retired: /studio routes now redirect to /embed-studio
// (the embed-studio uploader in non-short mode is the only video upload flow).
// import StudioPage from "./components/legacy-studio/StudioPage";
import ScrollToTop from "./components/ScrollToTop";
import RouteTitle from "./components/RouteTitle";
import OpenShortsOnStart from "./components/OpenShortsOnStart";
import AddAccount_modal from "./components/modal/AddAccount_modal";
// import TestingLogin from "./page/Login/TestingLogin";
import { Toaster } from 'sonner';
import { toastIn } from './utils/toast';
import { CircleCheck, CircleX, TriangleAlert, Info } from 'lucide-react'
import './toast.css'
import { fetchNewerVersion, reloadForUpdate } from './utils/checkLatestVersion'
// Retired alongside the legacy /studio flow — kept here as comments for ease of
// roll-back; the embed-studio equivalents at /embed-studio/{thumbnail,details,preview}
// are what users hit now.
// import Thumbnail from "./components/legacy-studio/Thumbnail";
// import Details from "./components/legacy-studio/Details";
// import Preview from "./components/legacy-studio/Preview";
import ShortsPreloader from "./components/ShortsPreloader";
// import Email from "./page/Login/Email"
// // import {AUTH_JWT_SECRET} from "../src/utils/config";


import { jwtDecode } from "jwt-decode";
import NotFound from "./page/NotFound";
import { EmbedUploadProvider } from "./context/EmbedUploadContext";
import { HiveAuthProvider } from "./context/HiveAuthContext";
import { HangoutContextProvider, useHangout } from "./context/HangoutContext";
import { ChatProvider } from "./context/ChatContext";
const OpenPodModal = lazy(() => import("./components/OpenPod/OpenPodModal"));
const ObsOverlay = lazy(() => import("./page/ObsOverlay"));

// Route components are code-split: only the route the visitor actually opens is
// downloaded. Everything here used to be a static import, so a first paint pulled
// the studio, wallet, editor and every other page down before rendering anything.
// The index route (HomeGrouped) stays eager - lazying it would only add a waterfall.
const AboutPage = lazy(() => import("./components/LandingPage/AboutPage"));
const Audio = lazy(() => import("./page/Audio"));
const AudioPost = lazy(() => import("./page/AudioPost"));
const AuthCallback = lazy(() => import("./page/Login/AuthCallback"));
const ChatPage = lazy(() => import("./components/Chat/ChatPage"));
const CommunitiesRender = lazy(() => import("./components/Communities/CommunitiesRender"));
const CommunityPage = lazy(() => import("./components/Communities/CommunityPage"));
const Discover = lazy(() => import("./page/Discover"));
const DraftStudio = lazy(() => import("./components/studio/DraftStudio"));
const EditScheduledPost = lazy(() => import("./page/EditScheduledPost"));
const EditVideo = lazy(() => import("./page/EditVideo"));
const EgressStream = lazy(() => import("./page/EgressStream"));
const EmbedCameraRecord = lazy(() => import("./components/embed-studio/EmbedCameraRecord"));
const EmbedDetails = lazy(() => import("./components/embed-studio/EmbedDetails"));
const EmbedPlayer = lazy(() => import("./page/EmbedPlayer"));
const EmbedPreview = lazy(() => import("./components/embed-studio/EmbedPreview"));
const EmbedStudioPage = lazy(() => import("./components/embed-studio/EmbedStudioPage"));
const EmbedThumbnail = lazy(() => import("./components/embed-studio/EmbedThumbnail"));
const Feed = lazy(() => import("./components/Feed/Feed"));
const FirstUploads = lazy(() => import("./page/FirstUploads"));
const FollowFeed = lazy(() => import("./page/FollowFeed"));
const HiveImageUploader = lazy(() => import("./page/HiveImageUploader"));
const Leaderboard = lazy(() => import("./page/Leaderboard"));
const Advertise = lazy(() => import("./page/Advertise"));
const Legal = lazy(() => import("./page/Legal"));
const LoginNew = lazy(() => import("./page/Login/LoginNew"));
const ManteAuthCallback = lazy(() => import("./page/Login/ManteAuthCallback"));
const NewVideos = lazy(() => import("./page/NewVideos"));
const Notifications = lazy(() => import("./page/Notifications"));
const OpenPodPublish = lazy(() => import("./page/OpenPodPublish"));
const OpenPods = lazy(() => import("./page/OpenPods"));
const PlaylistView = lazy(() => import("./page/PlaylistView"));
const PostView = lazy(() => import("./page/PostView"));
const ProfileModal = lazy(() => import("./components/modal/ProfileModal"));
const ProfilePage = lazy(() => import("./page/ProfilePage"));
const Short = lazy(() => import("./page/Short"));
const ShortsStoryFeed = lazy(() => import("./page/ShortsStoryFeed"));
const Spotlight = lazy(() => import("./page/Spotlight"));
const TagFeed = lazy(() => import("./page/TagFeed"));
const Trend = lazy(() => import("./page/Trend"));
const UploadVideo = lazy(() => import("./page/UploadVideo"));
const UserProfilePage = lazy(() => import("./components/Userprofilepage/UserProfilePage"));
const Wallet = lazy(() => import("./page/Wallet"));
const Watch = lazy(() => import("./page/Watch"));
const WatchStream = lazy(() => import("./page/WatchStream"));
const WatchedView = lazy(() => import("./page/WatchedView"));

function OpenPodModalMounter() {
  const { activeRoom, closeRoom, sessionToken, hangoutsUser } = useHangout();
  const { provider } = useAioha();
  if (!activeRoom) return null;
  // Treat the user as a real hangouts participant (vs. listen-only guest) only
  // when we have a session token, or a wallet that can still hand one over. A
  // stale `authenticated` flag with no signable provider must fall through to
  // guest mode so the modal joins via /listen instead of hanging on
  // "Authenticating with OpenPods…".
  const canParticipate = !!sessionToken || (!!provider && provider !== Providers.HiveSigner);
  return (
    <Suspense fallback={null}>
      <OpenPodModal
        isOpen
        onClose={closeRoom}
        roomName={activeRoom}
        sessionToken={sessionToken}
        username={hangoutsUser}
        isAuthenticated={canParticipate}
      />
    </Suspense>
  );
}

// Embed studio pages
import { useAioha } from "@aioha/react-ui";
import LoginModal from "./components/LoginModal/LoginModal";
import ActiveAuthModal from "./components/ActiveAuthModal/ActiveAuthModal";
import InterestsPrompt from "./components/InterestsPrompt/InterestsPrompt";
import WelcomePrompt from "./components/WelcomePrompt/WelcomePrompt";
import AdsPrompt from "./components/AdsPrompt/AdsPrompt";
import ViewerRewardsPrompt from "./components/AdsPrompt/ViewerRewardsPrompt";
import AvatarSync from "./components/HiveAvatar/AvatarSync";
import EditorModal from "./components/modal/EditorModal";
import { FEATURE_EDITOR } from "./utils/config";
import BottomNav from "./components/BottomNav/BottomNav";
import MiniPlayer from "./components/MiniPlayer/MiniPlayer";
import GlobalAudioPlayer from "./components/GlobalAudioPlayer/GlobalAudioPlayer";
import AudioUploadModal from "./components/AudioUploadModal/AudioUploadModal";
import { KeyTypes, Providers } from "@aioha/aioha";
import '@aioha/react-ui/dist/build.css';
import { LOCAL_STORAGE_USER_ID_KEY } from "./hooks/localStorageKeys";

// Every toast from this module is headed "Sign in"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Sign in');

// Hive-like URL redirects: /@user → profile, /@user/permlink → post view, /@user/shorts → profile shorts tab
// PostView handles 3Speak video detection and redirects to /watch when appropriate
const HiveLinkRedirect = () => {
  const location = useLocation();
  const path = location.pathname;
  const match = path.match(/^\/@([^/]+)(?:\/(.+))?$/);
  if (match) {
    const [, user, permlink] = match;
    if (permlink === 'shorts') {
      return <Navigate to={`/p/${user}?tab=shorts`} replace />;
    }
    if (permlink) {
      return <Navigate to={`/post/${user}/${permlink}${location.search || ''}`} replace />;
    }
    // Preserve query string (e.g. ?tab=audio) when redirecting /@user → /p/user
    return <Navigate to={`/p/${user}${location.search || ''}`} replace />;
  }
  return <NotFound />;
};

// /login and /auth/login open the aioha modal and redirect to home
const LoginRedirect = ({ openLoginModal }) => {
  const navigate = useNavigate();
  useEffect(() => {
    // Replace /login in history with home, then open modal on next tick
    navigate('/', { replace: true });
    setTimeout(() => openLoginModal(), 0);
  }, []);
  return null;
};

// Survives StrictMode's double mount and any remount, so the refresh prompt is
// raised at most once per page load.
let updatePromptShown = false;

function App() {
  const location = useLocation();
  const { initializeAuth, initializeTheme, authenticated, LogOut, setUser, user: appUser } = useAppStore();
  const sessionExpired = useAppStore((s) => s.sessionExpired);
  const homeCardSize = useAppStore((s) => s.homeCardSize);

  // Reflect the card-size preference on <html> so the card grids (home, profile,
  // playlists) can size themselves via CSS variables.
  useEffect(() => {
    document.documentElement.setAttribute('data-card-size', homeCardSize || 'small');
  }, [homeCardSize]);
  const clearSessionExpired = useAppStore((s) => s.clearSessionExpired);
  const { aioha, user: aiohaUser } = useAioha();
  const sidebar = useAppStore((s) => s.sidebarOpen);
  const setSideBar = useAppStore((s) => s.setSidebarOpen);
  const sidebarHidden = useAppStore((s) => s.sidebarHidden);
  const [profileNavVisible, setProfileNavVisible] = useState(false);

  const [globalCloseRender, setGlobalCloseRender] = useState(false)
  const [toggle, setToggle] = useState(false);
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginIntent, setLoginIntent] = useState(null); // 'login' | 'signup' from the nav
  const [loginProof, setLoginProof] = useState(() => Math.floor(Date.now() / 1000));
  const [editorModalOpen, setEditorModalOpen] = useState(false);
  const [audioUploadOpen, setAudioUploadOpen] = useState(false);
  // Carries an in-flight blob handed off from another flow (e.g. an
  // OpenPods recording stop). The AudioUploadModal seeds it as the
  // first track on open with the type its sender chose.
  const [pendingAudioTrack, setPendingAudioTrack] = useState(null);
  const loginInProgress = useRef(false); // Track if login is being processed
  const aiohaUserSeen = useRef(false); // Track if aiohaUser has ever been populated
  const sessionExpiredHandled = useRef(false); // Guard so the expiry prompt shows once (StrictMode-safe)

  // Hide nav on /shorts route on mobile — and on a live stream's watch page,
  // which uses the same full-bleed shorts layout.
  const isShorts = location.pathname.startsWith('/shorts')
    || /^\/(watch|l)\/[^/]+$/.test(location.pathname);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 767);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 767);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const hideNavOnMobile = isShorts && isMobile;

  // Listen for "open-shorts-editor" custom event from UploadLinks
  useEffect(() => {
    const handleOpenEditor = () => setEditorModalOpen(true);
    window.addEventListener('open-shorts-editor', handleOpenEditor);
    return () => window.removeEventListener('open-shorts-editor', handleOpenEditor);
  }, []);

  // Apply the saved theme on every route — Nav (which also calls this) isn't
  // rendered on the mobile shorts view, so a fresh /shorts deep link would
  // otherwise load unthemed.
  useEffect(() => { initializeTheme?.(); }, [initializeTheme]);

  // Listen for "open-audio-upload" custom event from UploadLinks. The
  // event may carry a payload with a pre-recorded blob (e.g. handed off
  // from the OpenPods modal) that the modal seeds as its first track.
  useEffect(() => {
    const handleOpenAudioUpload = (e) => {
      const detail = e?.detail;
      if (detail?.blob) {
        setPendingAudioTrack({
          blob: detail.blob,
          filename: detail.filename || 'recording.ogg',
          type: detail.type ?? null,
        });
      }
      setAudioUploadOpen(true);
    };
    window.addEventListener('open-audio-upload', handleOpenAudioUpload);
    return () => window.removeEventListener('open-audio-upload', handleOpenAudioUpload);
  }, []);

  useEffect(() => {
    initializeAuth();
    tokenVaildation()
  }, []);

  // When initializeAuth clears a stale/expired wallet session (e.g. an expired
  // HiveSigner token with a lingering user_id), it sets `sessionExpired` in the
  // store. Prompt a re-login. Driven by the store flag (not read-before-clear)
  // and ref-guarded so it fires exactly once under React StrictMode.
  useEffect(() => {
    if (sessionExpired && !sessionExpiredHandled.current) {
      sessionExpiredHandled.current = true;
      toast.error("Your session expired — please log in again");
      setLoginModalOpen(true);
      clearSessionExpired();
    }
  }, [sessionExpired]);

  // On load, decide whether to show the "what's new" popup. For an upgrade we expose
  // the previous version via the store; the stored version is advanced only after the
  // popup is shown (markVersionSeen on close). First-time visitors never see a prompt.
  useEffect(() => {
    const { previousVersion, shouldPrompt } = readAppVersion();
    if (shouldPrompt) useAppStore.getState().setAppUpdatedFrom(previousVersion);
  }, []);

  // Compare the running build against the latest version on GitHub (develop) and
  // prompt the user to refresh if they're on a stale (cached) build — so updates
  // don't require a manual reload. Re-checks on tab focus and every 30 min.
  useEffect(() => {
    const promptIfNewer = async () => {
      // Module-scoped, not a variable inside this effect: StrictMode mounts effects
      // twice in dev, and a per-effect flag let each mount raise its own toast — the
      // reason the prompt appeared as a stacked pair rather than once.
      if (updatePromptShown) return;
      const newer = await fetchNewerVersion();
      if (!newer) return;
      updatePromptShown = true;
      toast(`A new version (${newer}) is available`, {
        description: 'Refresh to get the latest updates.',
        duration: Infinity,
        action: { label: 'Refresh', onClick: () => reloadForUpdate() },
      });
    };
    promptIfNewer();
    const onFocus = () => promptIfNewer();
    window.addEventListener('focus', onFocus);
    const id = setInterval(promptIfNewer, 30 * 60 * 1000);
    return () => { window.removeEventListener('focus', onFocus); clearInterval(id); };
  }, []);

  // Persist the last visited non-login route so the app can return
  // users to the same page after they sign in.
  useEffect(() => {
    if (!location) return;
    const path = `${location.pathname}${location.search || ''}`;
    // don't overwrite when on login or auth callback routes
    if (path.startsWith('/login') || path.startsWith('/auth/callback') || path.startsWith('/newlogin')) return;
    try {
      sessionStorage.setItem('preLoginPath', path);
    } catch {
      // ignore storage errors
    }
  }, [location]);

  // Watch for aioha user changes and sync with 3Speak
  useEffect(() => {
    if (loginInProgress.current) return; // handleAiohaLogin is already handling this
    if (aiohaUser) aiohaUserSeen.current = true;
    if (!aiohaUser && appUser && aiohaUserSeen.current) {
      // Aioha logged out - log out of 3Speak too
      console.log("Aioha logged out, logging out of 3Speak");
      LogOut(appUser);
      toast.success("Logged out successfully");
    } else if (aiohaUser && aiohaUser !== appUser && loginModalOpen) {
      // Account switch: modal is open and user clicked an existing account
      // Only sync aiohaUser when modal is open — when closed, handleAiohaLogin
      // is the sole authority, preventing aioha's stale user reports from overriding
      console.log("Aioha account switched:", aiohaUser);
      localStorage.removeItem('manteauth_login'); // switching to a wallet account clears any prior Butter Auth flag
      localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, aiohaUser);
      setUser(aiohaUser);
      setLoginModalOpen(false);
      toast.success("Login successful!");
    }
  }, [aiohaUser]);

  // Reconcile a Butter Auth (ManteAuth) session that's sitting on top of a still-
  // active aioha WALLET session for a different account. Butter Auth login does
  // not log aioha out, so `appUser` can be the Butter Auth name while aioha's
  // current user is still e.g. a Keychain account. In that state "Change account"
  // opens straight into aioha's modal with the wallet account already selected —
  // clicking it is a no-op (aiohaUser never changes) and nothing switches. When
  // the modal is opened in this mismatch, adopt the wallet session so the switch
  // actually lands (and tear down the now-unused Butter Auth backend session).
  useEffect(() => {
    if (!loginModalOpen) return;
    if (localStorage.getItem('manteauth_login') !== 'true') return;
    if (aiohaUser && aiohaUser !== appUser) {
      localStorage.removeItem('manteauth_login');
      localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, aiohaUser);
      setUser(aiohaUser);
      setLoginModalOpen(false);
      fetch('/api/manteauth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
      toast.success(`Switched to @${aiohaUser}`);
    }
  }, [loginModalOpen, aiohaUser]);

  // Finalize a Butter Auth popup login. The popup (ManteAuthCallback) does the
  // token exchange, then writes `butrauth_login_result` to localStorage and
  // closes — which fires a `storage` event here in the opener window.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== 'butrauth_login_result' || !e.newValue) return;
      let payload;
      try { payload = JSON.parse(e.newValue); } catch { return; }
      localStorage.removeItem('butrauth_login_result');
      // Close the login popup from the opener side — more reliable than the
      // popup closing itself (browsers can block window.close() after the
      // cross-origin auth hop, leaving it stuck on the callback page).
      try { window.__butrauthLoginPopup?.close(); } catch { /* ignore */ }
      window.__butrauthLoginPopup = null;
      if (payload?.error) {
        toast.error('Butter Auth login failed: ' + payload.error);
        return;
      }
      if (payload?.username) {
        useAppStore.getState().setUser(payload.username); // sets user + authenticated
        setLoginModalOpen(false);
        toast.success(`Logged in as @${payload.username} via Butter Auth`);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Banned-creator gate. Keyed on the persisted `appUser` (NOT `authenticated`)
  // so it reliably fires on a page refresh too: `user` is restored synchronously
  // from persistence, while `authenticated` only flips true later via
  // initializeAuth. So if a logged-in creator gets banned, refreshing forces a
  // logout + shows the "contact support" modal. Fails open if the check errors.
  useEffect(() => {
    if (!appUser) return;
    let cancelled = false;
    (async () => {
      const settings = await getCreatorSettings(appUser);
      if (cancelled) return;
      if (isBanned(settings)) {
        useSupportBlock.getState().showSupportBlock('banned');
        try { await LogOut(appUser); } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
  }, [appUser]);

  const tokenVaildation = ()=>{
    const token = window.localStorage.getItem("access_token")
    if (token && authenticated){
      try {
    const decoded = jwtDecode(token);
    console.log(decoded)

    // exp is in seconds, Date.now() is in ms
    const isExpired = decoded.exp * 1000 < Date.now();
    if (isExpired) {
          // console.warn("Token expired — logging out user");
          toast.error("Secssion expired")
          LogOut(decoded.user_id); // this will already remove the token
          return false;
        }
    return !isExpired;
  } catch (err) {
    console.error("Invalid token:", err);
    return false;
  }
    }

  }

  

  // const closeProfileNav = ()=>{
  //   setProfileNavVisible(!profileNavVisible)
  // }
  const toggleProfileNav = () => {
    setProfileNavVisible((prev) => !prev);
    console.log(profileNavVisible);
  };

  const toggleAddAccount = () => {
    setToggle((prev) => !prev);
  }

  // `mode` is 'login' | 'signup' from the nav buttons (opens the modal straight
  // to that action). Other callers pass no string, so intent stays null.
  const openLoginModal = (mode) => {
    setLoginIntent(typeof mode === 'string' ? mode : null);
    setLoginProof(Math.floor(Date.now() / 1000)); // Fresh timestamp when modal opens
    if (!aioha.isLoggedIn()) {
      loginInProgress.current = true; // Only guard during fresh login, not account switch
    }
    setLoginModalOpen(true);
  }

  const closeLoginModal = () => {
    setLoginModalOpen(false);
    loginInProgress.current = false;
  }

  // Handle login callback from AiohaModal
  const handleAiohaLogin = (loginResult) => {
    console.log("Aioha login result:", loginResult);

    if (!loginResult || loginResult.error) {
      toast.error("Login failed: " + (loginResult?.error || "Unknown error"));
      loginInProgress.current = false;
      return;
    }

    // Switching in from a Butter Auth session → tear it down so the new wallet
    // account isn't still treated as a Butter Auth login (stale manteauth flag).
    if (localStorage.getItem('manteauth_login') === 'true') {
      localStorage.removeItem('manteauth_login');
      fetch('/api/manteauth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    }
    localStorage.setItem(LOCAL_STORAGE_USER_ID_KEY, loginResult.username);
    setUser(loginResult.username);
    setLoginModalOpen(false);
    loginInProgress.current = false;
    toast.success("Login successful!");
  }

  // Bare, chrome-free player route (iframed by the Spotlight /links page). Rendered
  // WITHOUT the nav / context providers so the iframe is just the player. Wrapped in
  // Routes/Route so EmbedPlayer's useParams() resolves author/permlink.
  if (location.pathname.startsWith('/embed/')) {
    return (
      // EmbedPlayer is lazy now, so it needs its own boundary here — this block
      // returns BEFORE the router's Suspense below. Fallback is a bare black box
      // rather than a spinner: this renders inside an iframe on someone else's
      // page, where a flash of loading chrome is worse than nothing.
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: '#000' }} />}>
        <Routes>
          <Route path="/embed/:author/:permlink" element={<EmbedPlayer />} />
        </Routes>
      </Suspense>
    );
  }

  // Bare, chrome-free OBS Browser Source overlay (pasted into OBS by the host).
  // Rendered WITHOUT nav / context providers — StandaloneObsOverlay owns its own
  // LiveKit connection and reads url+token+room+host from the query string.
  if (location.pathname === '/obs') {
    return (
      <Suspense fallback={<div style={{ position: 'fixed', inset: 0, background: 'transparent' }} />}>
        <ObsOverlay />
      </Suspense>
    );
  }

  return (
    <HangoutContextProvider tokenStorage={import.meta.env.VITE_HANGOUTS_TOKEN_STORAGE || 'none'}>
    <HiveAuthProvider>
    <EmbedUploadProvider>
    <ChatProvider>
    <div onClick={()=> {setGlobalCloseRender(true)}}>
      <Toaster
        position="top-right"
        /* Below the title bar, never on top of it. The user icon sits in the
           top-right corner, so a toast landing there made the avatar unclickable for
           as long as any message was on screen — and the messages that fire most
           often are the login ones, i.e. exactly when someone is reaching for it.

           Driven by --nav-top-offset, which Nav.jsx sets from the bar's OWN measured
           height (and 0 when the bar is hidden or unmounted), so this tracks the real
           bar instead of a hardcoded guess that goes wrong the moment it reflows. */
        offset={{ top: 'calc(var(--nav-top-offset, 50px) + 12px)', right: '16px' }}
        mobileOffset={{ top: 'calc(var(--nav-top-offset, 50px) + 8px)', right: '8px', left: '8px' }}
        expand
        visibleToasts={6}
        gap={12}
        closeButton
        swipeDirections={['right']}
        /* 20px to match the rail-style toast in toast.css — the icon now sits
           beside the text rather than out on its own, so it reads as part of
           the line instead of a badge. */
        icons={{
          success: <CircleCheck size={20} strokeWidth={2.25} />,
          error: <CircleX size={20} strokeWidth={2.25} />,
          warning: <TriangleAlert size={20} strokeWidth={2.25} />,
          info: <Info size={20} strokeWidth={2.25} />,
        }}
        toastOptions={{
          classNames: {
            toast: 'ts-toast',
            title: 'ts-toast-title',
            description: 'ts-toast-desc',
            icon: 'ts-toast-icon',
            closeButton: 'ts-toast-close',
          },
        }}
      />
      <ChangelogModal />
      <SupportModal />
      <CookieConsent />
      <GlobalReviewModal />
      <ReviewFab />
      <ShortsPreloader />
      {!hideNavOnMobile && (
        <Nav setSideBar={setSideBar} toggleProfileNav={toggleProfileNav} globalClose={globalCloseRender} setGlobalClose={setGlobalCloseRender} openLoginModal={openLoginModal} />
      )}
      <div>
        {!hideNavOnMobile && !sidebarHidden && <Sidebar sidebar={sidebar} />}
        <div className={`container ${sidebar && !sidebarHidden ? "" : "large-container"} ${sidebarHidden ? "sidebar-fully-hidden" : ""} ${hideNavOnMobile ? "shorts-mobile-container" : ""}`}>
          <ScrollToTop />
          {/* Browser-tab title for every route (watch/shorts set their own). */}
          <RouteTitle />
          {/* Optional: land on /shorts when the app is opened (off by default). */}
          <OpenShortsOnStart />
          {/* <Toaster richColors position="top-right" /> */}
          {/* Every route below the index one is lazy, so the router needs a
              boundary. The fallback is deliberately EMPTY: the nav, sidebar and
              bottom bar live outside this boundary and keep rendering, so a route
              chunk arriving swaps in just the page body. A spinner here would
              flash on every navigation, which reads worse than the shell holding
              still for a moment. */}
          <Suspense fallback={<div className="route-suspense-fallback" />}>
          <Routes>
            <Route path="/" element={<HomeGrouped />} />
            <Route path="/home-feed" element={<Feed />} />
            <Route path="/follow-feed" element={<FollowFeed />} />
            <Route path="/watch" element={<Watch v2 />} />
            {/* Live OpenPods stream at /watch/<roomName> (path param, distinct
                from the ?v= VOD route above). */}
            <Route path="/watch/:streamId" element={<WatchStream />} />
            {/* Short alias for stream share links — see buildOpenPodShareUrl. */}
            <Route path="/l/:streamId" element={<WatchStream />} />
            {/* Opened by the LiveKit egress worker, never by a person: a
                chrome-free full-bleed render of a standalone stream, which is
                what gets recorded into the VOD. */}
            <Route path="/egress-stream" element={<EgressStream />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/post/:author/:permlink" element={<PostView />} />
            <Route path="/upload" element={<UploadVideo />} />
            <Route path="/firstupload" element={<FirstUploads />} />
            <Route path="/trend" element={<Trend />} />
            <Route path="/discover" element={<Discover />} />
            <Route path="/audio" element={<Audio />} />
            <Route path="/audio/:author/:permlink" element={<AudioPost />} />
            <Route path="/new" element={<NewVideos />} />
            <Route path="/login" element={<LoginRedirect openLoginModal={openLoginModal} />} />
            <Route path="/auth/login" element={<LoginRedirect openLoginModal={openLoginModal} />} />
             <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/callback" element={<ManteAuthCallback />} />
            {/* <Route path="/email" element={<Email/>} />  */}
            <Route path="/newlogin" element={<LoginNew />} />
            {/* Legacy /studio retired — redirect to the embed-studio non-short uploader.
                The embed-studio defaults to non-short mode when no ?from=stories|shorts
                query string is present, which is the case for these plain redirects. */}
            <Route path="/studio" element={<Navigate to="/embed-studio" replace />} />
            <Route path="/studio/thumbnail" element={<Navigate to="/embed-studio/thumbnail" replace />} />
            <Route path="/studio/details" element={<Navigate to="/embed-studio/details" replace />} />
            <Route path="/studio/preview" element={<Navigate to="/embed-studio/preview" replace />} />
            {/* Embed studio (uses embed.okinoko.io upload service) */}
            <Route path="/embed-studio" element={<EmbedStudioPage />} />
            <Route path="/embed-studio/record" element={<EmbedCameraRecord />} />
            <Route path="/embed-studio/thumbnail" element={<EmbedThumbnail />} />
            <Route path="/embed-studio/details" element={<EmbedDetails />} />
            <Route path="/embed-studio/preview" element={<EmbedPreview />} />
            <Route path="/draft" element={<DraftStudio />} />
            <Route path="/editvideo/:d" element={<EditVideo />} />
            <Route path="/edit-scheduled/:permlink" element={<EditScheduledPost />} />
            <Route path="/communities" element={<CommunitiesRender />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/privacy" element={<Legal />} />
            <Route path="/imprint" element={<Legal />} />
            <Route path="/shorts/stories" element={<ShortsStoryFeed />} />
            <Route path="/shorts" element={<Short />} />
            <Route
              path="/community/:communityName"
              element={<CommunityPage />}
            />
            <Route path="/t/:tag" element={<TagFeed />} />
            <Route path="/leaderboard" element={<Leaderboard />} />
            <Route path="/advertise" element={<Advertise openLoginModal={openLoginModal} />} />
            <Route path="/profile" element={<ProfilePage />} />
            {/* Spotlight — creator link page. Canonical: 3speak.tv/links/username (no @).
                Legacy /@handle/links still resolves (nginx 301s it to /links/ in prod). */}
            <Route path="/links/:handle" element={<Spotlight />} />
            <Route path="/:handle/links" element={<Spotlight />} />
            <Route path="/p/:user" element={<UserProfilePage />} />
            <Route path="/user/:user" element={<UserProfilePage />} />
            <Route path="/playlist/:playlistId" element={<PlaylistView />} />
            <Route path="/watched/:username" element={<WatchedView />} />
            <Route path="/wallet/:user" element={<Wallet />} />
            <Route path="/test" element={<ProfileModal />} />
            <Route path="/image" element={<HiveImageUploader />} />
            <Route path="/openpods" element={<OpenPods />} />
            <Route path="/openpods/publish" element={<OpenPodPublish />} />
            <Route path="/openpods/:roomName" element={<OpenPods />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="*" element={<HiveLinkRedirect />} />
          </Routes>
          </Suspense>
          <OpenPodModalMounter />
        </div>
        {!hideNavOnMobile && (
          <ProfileNav isVisible={profileNavVisible} onclose={toggleProfileNav} toggleAddAccount={toggleAddAccount} openLoginModal={openLoginModal} />
        )}
        <MiniPlayer />
        <GlobalAudioPlayer />
        <AudioUploadModal
          isOpen={audioUploadOpen}
          onClose={() => { setAudioUploadOpen(false); setPendingAudioTrack(null); }}
          initialTrack={pendingAudioTrack}
        />
        {!hideNavOnMobile && <BottomNav openLoginModal={openLoginModal} />}
        {toggle && <AddAccount_modal close={toggleAddAccount} isOpen={toggle} /> }
        <LoginModal
          displayed={loginModalOpen}
          intent={loginIntent}
          onLogin={handleAiohaLogin}
          onClose={closeLoginModal}
          loginTitle="Login to 3Speak"
          loginOptions={{
            msg: `${loginProof}`,
            keyType: KeyTypes.Posting
          }}
        />
        <ActiveAuthModal />
        <AvatarSync />
        {/* Welcome first, then interests, then the ads pair. Each claims the modal
            slot while it is up so they never stack (see utils/welcomeGate). */}
        <WelcomePrompt />
        <InterestsPrompt />
        <AdsPrompt />
        <ViewerRewardsPrompt />
        {FEATURE_EDITOR && (
          <EditorModal
            isOpen={editorModalOpen}
            onClose={() => setEditorModalOpen(false)}
          />
        )}
      </div>
    </div>

    </ChatProvider>
    </EmbedUploadProvider>
    </HiveAuthProvider>
    </HangoutContextProvider>
  );
}

export default App;