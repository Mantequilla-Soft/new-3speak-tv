import mark from "../../assets/image/3S_mark.svg";
import "./nav.scss";
import Sidebar from "../Sidebar/Sidebar";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAppStore } from "../../lib/store";
import { IoCloudUploadSharp } from "react-icons/io5";
import { useEffect, useRef, useState } from "react";
import NavSearch from "./NavSearch";
import { TiThMenu } from "react-icons/ti";
import { MdOutlineSearch, MdGraphicEq, MdPlaylistPlay, MdWatchLater, MdHistory, MdKeyboardArrowDown, MdAdd, MdHomeFilled, MdChevronRight, MdChevronLeft } from "react-icons/md";
import { FaMedal } from "react-icons/fa6";
import { useMyPlaylists } from "../../hooks/useMyPlaylists";
import ShortsIcon from "../icons/ShortsIcon";
import UploadLinks from "../UploadLinks";
import NotificationBell from "./NotificationBell";
import { hideToastLayer, showToastLayer } from "../../utils/toast";
import ChatButton from "../Chat/ChatButton";
import PremiumBadge from "../PremiumBadge/PremiumBadge";
import { FiSettings, FiLogIn } from "react-icons/fi";
import SettingsModal from "../SettingsModal/SettingsModal";
import { ENABLE_BUTRAUTH } from "../../utils/config";
import { useAvatarUrl } from "../../utils/avatarCache";

function NavPlaylistsDropdown({ user }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const { data: playlists = [] } = useMyPlaylists({ enabled: !!user });
  const watchLater = playlists.find((p) => p.name === 'Watch Later');
  const watchLaterLink = watchLater ? `/playlist/${watchLater.id}` : '/profile?tab=playlists';

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="nav-playlists-wrapper" ref={ref}>
      <button type="button" className={`nav-tab nav-playlists-trigger${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)}>
        <MdPlaylistPlay className="nav-tab-icon" />
        <span>Playlists</span>
        <MdKeyboardArrowDown className={`nav-playlists-chevron${open ? ' open' : ''}`} size={16} />
      </button>
      {open && (
        <div className="nav-playlists-flyout" onClick={() => setOpen(false)}>
          <Link to={watchLaterLink} className="nav-playlists-flyout-item">
            <MdWatchLater className="nav-playlists-flyout-icon" />
            <span>Watch Later{watchLater?.items?.length > 0 ? ` (${watchLater.items.length})` : ''}</span>
          </Link>
          {user && (
            <Link to={`/watched/${user}`} className="nav-playlists-flyout-item">
              <MdHistory className="nav-playlists-flyout-icon" />
              <span>Watch History</span>
            </Link>
          )}
          <Link to="/profile?tab=playlists" className="nav-playlists-flyout-item">
            <MdPlaylistPlay className="nav-playlists-flyout-icon" />
            <span>All Playlists</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function NavUploadDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="nav-upload-wrapper" ref={ref}>
      {/* Two icons, one shown per breakpoint: the labelled cloud button on
          desktop, a bare "+" on mobile where this replaces the bottom bar's
          centre item and has to fit next to the avatar. */}
      <div className="nav-upload-btn" onClick={() => setOpen(!open)} title="Share">
        <IoCloudUploadSharp size={18} className="nav-upload-icon-desktop" />
        <MdAdd size={21} className="nav-upload-icon-mobile" />
        <span className="nav-upload-label">Share</span>
      </div>
      {open && (
        <div className="nav-upload-flyout" onClick={() => setOpen(false)}>
          <UploadLinks linkClass="nav-upload-flyout-item" iconClass="nav-upload-flyout-icon" />
        </div>
      )}
    </div>
  );
}

// Per-browser, like the theme: a choice about how this person wants the bar to
// look, not something to sync anywhere.
const NAV_TABS_KEY = '3speak_nav_tabs_open';

function Nav({ setSideBar, toggleProfileNav, openLoginModal }) {
  const { authenticated, LogOut, user, initializeTheme } = useAppStore();
  const sidebarHidden = useAppStore((s) => s.sidebarHidden);
  // Shows a just-uploaded profile picture immediately instead of the cached
  // hive proxy copy (utils/avatarCache).
  const myAvatar = useAvatarUrl(user, 'small');
  const location = useLocation();
  const [nav, setNav] = useState(false)
   const sideNavRef = useRef(null); // Ref for the side nav container
  const menuIconRef = useRef(null); // Ref for the menu toggle button
  const [navHidden, setNavHidden] = useState(false);
  // The page tabs are folded away behind the logo, and whether they are out is
  // remembered per browser — so someone who wants them can set it once instead of
  // reaching for the logo on every visit.
  //
  // Read in the initialiser rather than in an effect, so the first paint is
  // already right: setting it afterwards makes the row flick into place on every
  // load for the people who chose to keep it.
  const [tabsOpen, setTabsOpen] = useState(() => {
    try {
      return localStorage.getItem(NAV_TABS_KEY) === 'true';
    } catch {
      // Private mode, or storage switched off. Not being able to remember the
      // preference is not a reason to fail to render a nav bar.
      return false;
    }
  });

  const toggleTabs = () => {
    setTabsOpen((open) => {
      const next = !open;
      try { localStorage.setItem(NAV_TABS_KEY, String(next)); } catch { /* see above */ }
      return next;
    });
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const navContainerRef = useRef(null);

  // Measure nav height and set CSS variables globally
  useEffect(() => {
    const el = navContainerRef.current;
    if (!el) return;
    const updateHeight = () => {
      const h = `${el.offsetHeight}px`;
      el.style.setProperty('--nav-height', h);
      document.documentElement.style.setProperty('--nav-height', h);
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Expose nav hidden state as CSS variable
  useEffect(() => {
    document.documentElement.style.setProperty('--nav-top-offset', navHidden ? '0px' : 'var(--nav-height, 50px)');
  }, [navHidden]);

  // Deliberately nothing closes this but the logo. It used to shut on an outside
  // click and on choosing a page, which is right for a popover but wrong for a
  // remembered setting: both of them fired within a click or two of opening it,
  // so the stored value would have been "closed" almost every time it was read.

  // Toasts get out of the way of the right-hand nav's panels, and come back on
  // the next click anywhere else. Bound on the document rather than on each
  // panel because those panels own their open state privately (the Share
  // flyout, the bell, the profile drawer) and threading a callback through all
  // of them would be four places to keep in step for one visual rule.
  //
  // The click that OPENS a panel lands inside .nav-right and is skipped here,
  // so it cannot un-hide what the capture handler just hid.
  useEffect(() => {
    // The cluster itself plus the surfaces it opens. A click inside an open
    // panel is someone still using it, so the stack stays down; the backdrop
    // is deliberately NOT in this list, because clicking it closes the drawer
    // and the toasts should come straight back.
    const KEEP_HIDDEN = '.nav-right, .profile-wrap, .notif-dropdown, .nav-upload-flyout';
    const onDocClick = (e) => {
      if (e.target instanceof Element && e.target.closest(KEEP_HIDDEN)) return;
      showToastLayer();
    };
    document.addEventListener('click', onDocClick);
    return () => {
      document.removeEventListener('click', onDocClick);
      showToastLayer();
    };
  }, []);

  // ...and put it back to zero when the bar is not rendered at all (mobile Shorts
  // unmounts it). Everything that hangs off this — the toasts, Discover's sticky
  // filter row, the watch-page rail — should sit flush when there is no bar above
  // them, and a stale value from the last route is how you get a gap under nothing.
  useEffect(() => () => {
    document.documentElement.style.setProperty('--nav-top-offset', '0px');
  }, []);

  // The top nav stays locked/visible — no scroll-based auto-hide (it flickered).
  // The only time it hides is immersive landscape video on /watch, which is
  // orientation-driven (not scroll-driven), so there's nothing to flicker.
  useEffect(() => {
    const landscapeQuery = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
    const apply = () => setNavHidden(location.pathname === '/watch' && landscapeQuery.matches);
    apply();
    landscapeQuery.addEventListener('change', apply);
    return () => landscapeQuery.removeEventListener('change', apply);
  }, [location.pathname]);



  const handleNav = () =>{
    setNav((prev) => !prev);
   }

   // Initialize theme on mount
   useEffect(() => {
    initializeTheme();
   }, []);

   useEffect(() => {
  const handleClickOutside = (e) => {
    // Check if:
    // 1. Nav is open
    // 2. Click is outside side nav
    // 3. Click is outside menu icon (if ref exists)
    if (nav && 
        sideNavRef.current && 
        !sideNavRef.current.contains(e.target) && 
        (!menuIconRef.current || !menuIconRef.current.contains(e.target))) {
      setNav(false);
    }
  };

  document.addEventListener('click', handleClickOutside, true);

  return () => {
    document.removeEventListener('click', handleClickOutside, true);
  };
}, [nav]);





  return (
    <nav ref={navContainerRef} className={`nav-container${navHidden ? ' nav-hidden' : ''}`}>
      <div className="nav-left flex-dev">
        {!sidebarHidden && (
          <TiThMenu size={25} className="menu-icon" onClick={() => setSideBar((prev) => (prev === false ? true : false))}/>
        )}
        {/* The logo opens the pages instead of going home — "Overview" below is
            the way home now. A button, not a link: it goes nowhere, and shipping
            it as an <a> would put it in the tab order promising navigation. */}
        <button
          type="button"
          className={`nav-logo-btn${tabsOpen ? ' is-open' : ''}`}
          aria-expanded={tabsOpen}
          aria-controls="nav-tabs"
          title={tabsOpen ? 'Hide pages' : 'Show pages'}
          onClick={toggleTabs}
        >
          <img className="logo" src={mark} alt="3Speak" />
          {/* The hint that the logo does something, on the side the tabs come out
              of. Inside the button on purpose: it has to be clickable, and a
              second button beside it would be two tab stops and two screen-reader
              announcements for one action. */}
          <MdChevronRight className="nav-logo-chevron" aria-hidden="true" />
        </button>
      </div>

      {tabsOpen && (
      <div className="nav-tabs flex-dev" id="nav-tabs">
        {/* What the logo used to do. First in the row, so the way home is the
            first thing under the cursor once the group opens. */}
        <NavLink to="/" end className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <MdHomeFilled className="nav-tab-icon" /> <span>Overview</span>
        </NavLink>
        <NavLink to="/shorts" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <ShortsIcon className="nav-tab-icon" outlineWidth={30} /> <span>Shorts</span>
        </NavLink>
        <NavLink to="/audio" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <MdGraphicEq className="nav-tab-icon" /> <span>Audio</span>
        </NavLink>
        {authenticated && <NavPlaylistsDropdown user={user} />}
        <NavLink to="/leaderboard" className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <FaMedal className="nav-tab-icon nav-tab-icon--medal" /> <span>Leaderboard</span>
        </NavLink>
      </div>
      )}

      <div className="phone-nav-left" ref={menuIconRef} >
        {!sidebarHidden && (
          <TiThMenu size={25} className="menu-icon" onClick={handleNav} />
        )}
        <Link to="/"><img className="logo" src={mark} alt="3Speak" /></Link>
      </div>
      <div className={nav ? "side-nav" : "side-nav-else"} ref={sideNavRef}>
      {/* Was a bare × in the top-right corner, which sat on the drawer's blurred
          backdrop at text colour and was easy to miss. A chevron on the left edge
          points the way the drawer leaves. */}
      <button type="button" className="side-nav-close" onClick={handleNav} aria-label="Close menu">
        <MdChevronLeft />
      </button>
      <Sidebar sidebar={true} onNavigate={handleNav} />
      </div>

      {/* Search sits next to the nav tabs on desktop (after the logo on tablet) */}
      <NavSearch />

      {authenticated ? (
        <div className="nav-right flex-div" onClickCapture={hideToastLayer}>
          <NavUploadDropdown />
          <Link to="/discover" className="nav-mobile-discover" title="Discover">
            <MdOutlineSearch size={19} />
          </Link>
          <ChatButton />
          <NotificationBell />
          <FiSettings size={19} className="nav-settings-btn" onClick={() => setSettingsOpen(true)} title="Settings" />
          <span className="nav-avatar-wrap" onClick={toggleProfileNav}>
            <img src={myAvatar} alt="" />
            <PremiumBadge username={user} size={10} className="nav-avatar-premium" />
          </span>
        </div>
      ) : (
        <div className="nav-right flex-div" onClickCapture={hideToastLayer}>
          <Link to="/discover" className="nav-mobile-discover" title="Discover">
            <MdOutlineSearch size={19} />
          </Link>
          <Link to="/about" className="nav-guest-about">About 3Speak</Link>
          {ENABLE_BUTRAUTH ? (
            <>
              <button className="nav-guest-login nav-guest-login--secondary" onClick={() => openLoginModal('login')}><FiLogIn /> Log in</button>
              <button className="nav-guest-signup" onClick={() => openLoginModal('signup')}>Sign up</button>
            </>
          ) : (
            <button className="nav-guest-login" onClick={() => openLoginModal('login')}><FiLogIn /> Log in</button>
          )}
          <FiSettings size={19} className="nav-settings-btn" onClick={() => setSettingsOpen(true)} title="Settings" />
        </div>
      )}

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </nav>
  );
}

export default Nav;
