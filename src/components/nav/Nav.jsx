import mark from "../../assets/image/3S_mark.svg";
import { useSignupPossible } from '../../utils/signupPossible';
import "./nav.scss";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../lib/store";
import { IoCloudUploadSharp } from "react-icons/io5";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import NavSearch from "./NavSearch";
import { MdOutlineSearch, MdGraphicEq, MdPlaylistPlay, MdWatchLater, MdHistory, MdKeyboardArrowDown, MdAdd, MdHomeFilled, MdChevronRight, MdGroups, MdCampaign, MdHelpOutline } from "react-icons/md";
import { FaMedal } from "react-icons/fa6";
import { useMyPlaylists } from "../../hooks/useMyPlaylists";
import ShortsIcon from "../icons/ShortsIcon";
import UploadLinks from "../UploadLinks";
import NavProgress from '../Incubation/NavProgress';
import IncubationBell from '../Incubation/IncubationBell';
import NotificationBell from "./NotificationBell";
import { hideToastLayer, showToastLayer } from "../../utils/toast";
import ChatButton from "../Chat/ChatButton";
import PremiumBadge from "../PremiumBadge/PremiumBadge";
import { FiSettings, FiLogIn } from "react-icons/fi";
import SettingsModal from "../SettingsModal/SettingsModal";
import { ENABLE_BUTRAUTH } from "../../utils/config";
import { useAvatarUrl } from "../../utils/avatarCache";
import { isRememberedAdvertiser, rememberAdvertiserAccount, hasAdvertiserProduct } from "../../utils/advertiserAccount";

function NavPlaylistsDropdown({ user, scrollerRef }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const ref = useRef(null);
  const flyoutRef = useRef(null);
  const { data: playlists = [] } = useMyPlaylists({ enabled: !!user });
  const watchLater = playlists.find((p) => p.name === 'Watch Later');
  const watchLaterLink = watchLater ? `/playlist/${watchLater.id}` : '/profile?tab=playlists';

  // The tab row scrolls sideways once it runs out of room, and a scroll
  // container clips BOTH axes — an absolutely positioned flyout under this
  // trigger would be sliced off at the row's edge. So it hangs off <body> and
  // is placed from the trigger's box instead.
  const updatePos = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const width = flyoutRef.current?.offsetWidth || 200; // min-width, before it has rendered
    setPos({
      top: Math.round(rect.bottom + 6),
      // Stays on screen when the trigger has been scrolled near the right edge.
      left: Math.round(Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))),
    });
  }, []);

  // Layout effect, not an effect: placed before the first paint, so it never
  // flashes in the corner on its way to the trigger.
  useLayoutEffect(() => {
    if (!open) return;
    updatePos();
    const handleClickOutside = (e) => {
      // The flyout is no longer inside `ref`, so it has to be excused by hand —
      // closing on mousedown would unmount the link before its click landed.
      if (ref.current?.contains(e.target) || flyoutRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const scroller = scrollerRef?.current;
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', updatePos);
    scroller?.addEventListener('scroll', updatePos, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePos);
      scroller?.removeEventListener('scroll', updatePos);
    };
  }, [open, updatePos, scrollerRef]);

  return (
    <div className="nav-playlists-wrapper" ref={ref}>
      <button type="button" title={t('nav.playlists.tooltip')} className={`nav-tab nav-playlists-trigger${open ? ' open' : ''}`} onClick={() => setOpen((v) => !v)}>
        <MdPlaylistPlay className="nav-tab-icon" />
        <span>{t('nav.playlists.label')}</span>
        <MdKeyboardArrowDown className={`nav-playlists-chevron${open ? ' open' : ''}`} size={16} />
      </button>
      {open && createPortal(
        <div
          className="nav-playlists-flyout"
          ref={flyoutRef}
          style={{ top: `${pos.top}px`, left: `${pos.left}px` }}
          onClick={() => setOpen(false)}
        >
          <Link to={watchLaterLink} className="nav-playlists-flyout-item">
            <MdWatchLater className="nav-playlists-flyout-icon" />
            <span>{watchLater?.items?.length > 0 ? t('nav.playlists.watchLaterCount', { n: watchLater.items.length }) : t('nav.playlists.watchLater')}</span>
          </Link>
          {user && (
            <Link to={`/watched/${user}`} className="nav-playlists-flyout-item">
              <MdHistory className="nav-playlists-flyout-icon" />
              <span>{t('nav.playlists.watchHistory')}</span>
            </Link>
          )}
          <Link to="/profile?tab=playlists" className="nav-playlists-flyout-item">
            <MdPlaylistPlay className="nav-playlists-flyout-icon" />
            <span>{t('nav.playlists.all')}</span>
          </Link>
        </div>,
        document.body
      )}
    </div>
  );
}

/**
 * "Advertise", left of Share, for advertiser accounts only: one that graduated from
 * the advertiser warm-up in this browser, or one with an advertiser product on file.
 * Nothing for anyone else, and nothing while we cannot tell.
 */
function NavAdvertiseButton({ user }) {
  const { t } = useTranslation();
  const [show, setShow] = useState(() => isRememberedAdvertiser(user));
  useEffect(() => {
    let alive = true;
    if (!user) return undefined;
    if (isRememberedAdvertiser(user)) { setShow(true); return undefined; }
    hasAdvertiserProduct(user).then((yes) => {
      if (!alive) return;
      if (yes) rememberAdvertiserAccount(user);
      setShow(yes);
    });
    return () => { alive = false; };
  }, [user]);
  if (!show) return null;
  return (
    <Link to="/advertise" className="nav-advertise-btn" title={t('nav.advertise')}>
      <MdCampaign size={18} aria-hidden="true" />
      <span className="nav-advertise-label">{t('nav.advertise')}</span>
    </Link>
  );
}

function NavUploadDropdown() {
  const { t } = useTranslation();
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
      <div className="nav-upload-btn" onClick={() => setOpen(!open)} title={t('common.actions.share')}>
        <IoCloudUploadSharp size={18} className="nav-upload-icon-desktop" />
        <MdAdd size={21} className="nav-upload-icon-mobile" />
        <span className="nav-upload-label">{t('common.actions.share')}</span>
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

function Nav({ toggleProfileNav, openLoginModal }) {
  const { t } = useTranslation();
  const { authenticated, LogOut, user, initializeTheme } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const authChecked = useAppStore((s) => s.authChecked);
  const signupPossible = useSignupPossible();
  // Shows a just-uploaded profile picture immediately instead of the cached
  // hive proxy copy (utils/avatarCache).
  const myAvatar = useAvatarUrl(user, 'small');
  const location = useLocation();
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
  const navTabsRef = useRef(null);

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

  // Cap the page-tab row at the search box's left edge, and let it scroll
  // sideways under that cap.
  //
  // The search box is centred on the BAR and taken out of the flow (see
  // nav.scss), so it costs the row no width and CSS here has no way to work out
  // where its left edge lands — the answer moves with the window, with the
  // logo/menu cluster to the row's left, and with the box itself, which grows
  // from 220px to 420px while it has focus. So it is measured, and handed to
  // the stylesheet as --nav-tabs-max. Without it the last pills simply run
  // under the box: the row is flex-shrink: 0 and the box paints on top.
  useEffect(() => {
    const navEl = navContainerRef.current;
    const tabsEl = navTabsRef.current;
    if (!navEl || !tabsEl) return;
    const searchEl = navEl.querySelector('.navsearch-wrap');
    if (!searchEl) return;

    // Clear of the box's shadow, and wide enough to swallow the 6px the opening
    // animation borrows from the row's left edge.
    const GUTTER = 16;
    let lastAvail = null;

    // Which way there is more to see, for the fade at the cut edge.
    const updateEdges = () => {
      const max = tabsEl.scrollWidth - tabsEl.clientWidth;
      tabsEl.classList.toggle('can-scroll-left', tabsEl.scrollLeft > 1);
      tabsEl.classList.toggle('can-scroll-right', tabsEl.scrollLeft < max - 1);
    };

    const measure = () => {
      // display: none below the desktop breakpoint — nothing to cap, and every
      // measurement would read zero.
      if (!tabsEl.offsetParent) return;
      // offsetLeft rather than the rect: on the frame the row opens it is
      // mid-slide, and a rect would read 6px further left than it ends up.
      const rowLeft = tabsEl.offsetParent === navEl
        ? navEl.getBoundingClientRect().left + tabsEl.offsetLeft
        : tabsEl.getBoundingClientRect().left;
      const avail = Math.max(0, Math.round(searchEl.getBoundingClientRect().left - rowLeft - GUTTER));
      // Guard the write: the box's width transition fires this a dozen times a
      // second, and re-setting the same value would notify the observer again.
      if (avail !== lastAvail) {
        lastAvail = avail;
        navEl.style.setProperty('--nav-tabs-max', `${avail}px`);
      }
      updateEdges();
    };

    // A plain mouse only has a vertical wheel. Chrome does hand deltaY to a
    // scroller that can only move sideways, but hiding this row's vertical
    // overflow opts it out of that (measured: deltaX scrolls it, deltaY does
    // nothing), which would leave the pills past the cut edge reachable by
    // keyboard and trackpad only. Native listener, not onWheel: React's wheel
    // handlers are passive, so preventDefault there is ignored.
    const onWheel = (e) => {
      if (e.deltaX) return; // a trackpad is already scrolling it sideways
      const max = tabsEl.scrollWidth - tabsEl.clientWidth;
      if (max <= 0) return;
      const next = Math.max(0, Math.min(max, tabsEl.scrollLeft + e.deltaY));
      if (next === tabsEl.scrollLeft) return; // at either end: the page can have it
      e.preventDefault();
      // 'instant', not 'auto': 'auto' means "whatever CSS scroll-behavior says",
      // which here is smooth — every wheel notch would restart a 300ms animation
      // and the row would crawl. Smooth is wanted only for the active-pill jump.
      tabsEl.scrollTo({ left: next, behavior: 'instant' });
    };

    measure();
    // navEl for the window width, searchEl for the focus grow, tabsEl for the
    // cap landing (its own width never feeds back into the number above).
    const ro = new ResizeObserver(measure);
    ro.observe(navEl);
    ro.observe(searchEl);
    ro.observe(tabsEl);
    tabsEl.addEventListener('scroll', updateEdges, { passive: true });
    tabsEl.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      tabsEl.removeEventListener('scroll', updateEdges);
      tabsEl.removeEventListener('wheel', onWheel);
    };
  }, [tabsOpen, authenticated]);

  // The page you are on should be the one you can see, even when it sits past
  // the right edge of a scrolled row.
  useEffect(() => {
    const tabsEl = navTabsRef.current;
    if (!tabsEl || !tabsEl.offsetParent) return;
    tabsEl.querySelector('.nav-tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tabsOpen, location.pathname]);

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



   // Initialize theme on mount
   useEffect(() => {
    initializeTheme();
   }, []);






  return (
    <nav ref={navContainerRef} className={`nav-container${navHidden ? ' nav-hidden' : ''}`}>
      <div className="nav-left flex-dev">
        {/* The logo opens the pages instead of going home — "Overview" below is
            the way home now. A button, not a link: it goes nowhere, and shipping
            it as an <a> would put it in the tab order promising navigation. */}
        <button
          type="button"
          className={`nav-logo-btn${tabsOpen ? ' is-open' : ''}`}
          aria-expanded={tabsOpen}
          aria-controls="nav-tabs"
          title={tabsOpen ? t('nav.hidePages') : t('nav.showPages')}
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
      <div className="nav-tabs flex-dev" id="nav-tabs" ref={navTabsRef}>
        {/* What the logo used to do. First in the row, so the way home is the
            first thing under the cursor once the group opens. */}
        <NavLink to="/" end title={t('nav.tabs.overviewTooltip')} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <MdHomeFilled className="nav-tab-icon" /> <span>{t('nav.tabs.overview')}</span>
        </NavLink>
        <NavLink to="/shorts" title={t('nav.tabs.shortsTooltip')} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <ShortsIcon className="nav-tab-icon" outlineWidth={30} /> <span>{t('common.nav.shorts')}</span>
        </NavLink>
        <NavLink to="/audio" title={t('nav.tabs.audioTooltip')} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <MdGraphicEq className="nav-tab-icon" /> <span>{t('nav.bottom.audio')}</span>
        </NavLink>
        {/* Groups, not Badges: badges are one tab of it, alongside communities.
            Both lost their menu entry when the sidebar went, and one word in the
            bar covers what were two. */}
        <NavLink to="/groups" title={t('nav.tabs.groupsTooltip')} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          {/* A group of people, not the badge medal this tab inherited when it
              was the Badges tab: badges are one thing inside it now. */}
          <MdGroups className="nav-tab-icon" /> <span>{t('nav.bottom.groups')}</span>
        </NavLink>
        {/* "Rankings" rather than "Leaderboard": the page ranks creators by
            several measures, and the route keeps its old name so existing links
            still work. */}
        <NavLink to="/leaderboard" title={t('nav.tabs.rankingsTooltip')} className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}>
          <FaMedal className="nav-tab-icon nav-tab-icon--medal" /> <span>{t('app.routes.rankings')}</span>
        </NavLink>
        {/* Last, and only when signed in: it is the one tab that lists YOUR
            things rather than the site's. */}
        {authenticated && <NavPlaylistsDropdown user={user} scrollerRef={navTabsRef} />}
      </div>
      )}

      <div className="phone-nav-left">
        <Link to="/"><img className="logo" src={mark} alt="3Speak" /></Link>
      </div>
      {/* Search sits next to the nav tabs on desktop (after the logo on tablet) */}
      <NavSearch />

      {authenticated ? (
        <div className="nav-right flex-div" onClickCapture={hideToastLayer}>
          {/* Incubating users only; renders nothing for everyone else. */}
          <NavProgress />
          {/* Hive accounts only: an incubating user cannot book ads yet. */}
          {!incubationHandle && <NavAdvertiseButton user={user} />}
          <NavUploadDropdown />
          <Link to="/discover" className="nav-mobile-discover" title={t('app.routes.discover')}>
            <MdOutlineSearch size={19} />
          </Link>
          <ChatButton />
          {/* One bell or the other. Hive's notifications need a Hive account,
              so an incubating user's bell reads from the incubation service
              instead of showing them a permanently empty one. */}
          {incubationHandle ? <IncubationBell /> : <NotificationBell />}
          <FiSettings size={19} className="nav-settings-btn" onClick={() => setSettingsOpen(true)} title={t('common.nav.settings')} />
          <span className="nav-avatar-wrap" onClick={toggleProfileNav}>
            <img src={myAvatar} alt="" />
            <PremiumBadge username={user} size={10} className="nav-avatar-premium" />
          </span>
        </div>
      ) : (
        <div className="nav-right flex-div" onClickCapture={hideToastLayer}>
          <Link to="/discover" className="nav-mobile-discover" title={t('app.routes.discover')}>
            <MdOutlineSearch size={19} />
          </Link>
          {/* Help for first-time visitors: a pill on desktop, a bare ? icon
              on phones and tablets, where the About pill is hidden. */}
          <Link to="/faq" className="nav-mobile-discover nav-guest-faq-icon" title={t('nav.faqAria')} aria-label={t('nav.faqAria')}>
            <MdHelpOutline size={19} />
          </Link>
          <Link to="/about" className="nav-guest-about">{t('nav.aboutLink')}</Link>
          <Link to="/faq" className="nav-guest-about" aria-label={t('nav.faqAria')}>{t('nav.faqLink')}</Link>
          {/* No guest buttons until the stored session has been read: a logged-in
              refresh otherwise flashes Log in before the avatar replaces it. */}
          {authChecked && (<>
          {/* Sign up is dropped when Butter Auth says no account can be created
              from this address, leaving the single Log in button the
              butrauth-disabled build shows -- so the bar has no gap where a
              button used to be. Fails open: a failed check still offers it.
              Not shown while the check is in flight: for someone it refuses
              (a VPN, say) it flashed in on every load and then vanished. */}
          {ENABLE_BUTRAUTH && !signupPossible.loading && signupPossible.possible ? (
            <>
              <button className="nav-guest-login nav-guest-login--secondary" onClick={() => openLoginModal('login')}><FiLogIn /> {t('common.actions.login')}</button>
              <button className="nav-guest-signup" onClick={() => openLoginModal('signup')}>{t('common.actions.signUp')}</button>
            </>
          ) : (
            <button className="nav-guest-login" onClick={() => openLoginModal('login')}><FiLogIn /> {t('common.actions.login')}</button>
          )}
          </>)}
          <FiSettings size={19} className="nav-settings-btn" onClick={() => setSettingsOpen(true)} title={t('common.nav.settings')} />
        </div>
      )}

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </nav>
  );
}

export default Nav;
