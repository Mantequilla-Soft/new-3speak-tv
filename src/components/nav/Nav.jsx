import mark from "../../assets/image/3S_mark.svg";
import { useSignupPossible } from '../../utils/signupPossible';
import "./nav.scss";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../lib/store";
import { useEffect, useRef, useState } from "react";
import NavSearch from "./NavSearch";
import { Icon } from "../v2/Icon";
import { OPEN_CREATE_EVENT, useNavTabsOpen } from "./navTabsPref";
import UploadLinks from "../UploadLinks";
import { creatorKey, isUploadBlocked, useCreatorSettings } from "../../utils/creatorSettings";
import useHoverPeek from "../../hooks/useHoverPeek";
import { Dialog } from "../v2/ui";
import NavProgress from '../Incubation/NavProgress';
import IncubationBell from '../Incubation/IncubationBell';
import NotificationBell from "./NotificationBell";
import { hideToastLayer, showToastLayer } from "../../utils/toast";
import ChatButton from "../Chat/ChatButton";
import PremiumBadge from "../PremiumBadge/PremiumBadge";
import SettingsModal from "../SettingsModal/SettingsModal";
import { ENABLE_BUTRAUTH } from "../../utils/config";
import { useAvatarUrl } from "../../utils/avatarCache";
import { isRememberedAdvertiser, rememberAdvertiserAccount, hasAdvertiserProduct } from "../../utils/advertiserAccount";
import { isWatchPath } from '../../utils/urls';

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
    <Link to="/advertise" className="v2-btn v2-btn--secondary h40 nav-advertise-btn" title={t('nav.advertise')}>
      <Icon name="campaign" size={18} />
      <span className="nav-advertise-label">{t('nav.advertise')}</span>
    </Link>
  );
}

// Same range as the compact "+" button (phone + tab): the menu opens as a
// bottom sheet there, since a dropdown hung off the "+" runs off the screen.
const UPLOAD_SHEET_QUERY = '(max-width: 1024px)';

function NavUploadDropdown() {
  const { t } = useTranslation();
  const ref = useRef(null);
  const sheetRef = useRef(null);
  const [asSheet, setAsSheet] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(UPLOAD_SHEET_QUERY).matches,
  );
  // Desktop dropdown: a mouse resting on Share peeks at it, a click keeps it open,
  // and it fades in and out (hooks/useHoverPeek.js). The bottom sheet is tap only.
  const menu = useHoverPeek({ enabled: !asSheet });
  const { shown: open, close: closeMenu, hold } = menu;

  // The bottom bar's red "+" (20a phone) opens this same menu: on phones the
  // top bar shows no Create button of its own.
  useEffect(() => {
    window.addEventListener(OPEN_CREATE_EVENT, hold);
    return () => window.removeEventListener(OPEN_CREATE_EVENT, hold);
  }, [hold]);

  useEffect(() => {
    const mq = window.matchMedia(UPLOAD_SHEET_QUERY);
    const onChange = (e) => setAsSheet(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    // The sheet is portalled to <body>, so it's outside `ref`: a tap on one of
    // its items must not count as an outside click (that would unmount it
    // before the link's click lands).
    const handleClickOutside = (e) => {
      if (ref.current?.contains(e.target) || sheetRef.current?.contains(e.target)) return;
      if (e.target instanceof Element && e.target.closest('.nav-upload-sheet')) return;
      closeMenu();
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, closeMenu]);

  return (
    <div className="nav-upload-wrapper" ref={ref} {...menu.hoverProps}>
      {/* The labelled primary button on desktop; below 1025px the label hides
          and it is a square "+" (nav.scss), next to the avatar-less bar. */}
      <button
        type="button"
        className="btn-reset v2-btn v2-btn--primary h40 nav-upload-btn"
        onClick={menu.toggle}
        title={t('nav.create')}
        aria-label={t('nav.create')}
        aria-expanded={open}
      >
        <span className="nav-upload-label">{t('nav.create')}</span>
        <Icon name="add" size={20} className="nav-upload-icon" />
      </button>
      {menu.rendered && !asSheet && (
        <div className={`nav-upload-flyout${menu.leaving ? ' nav-upload-flyout--leaving' : ''}`} onClick={menu.close}>
          <UploadLinks linkClass="nav-upload-flyout-item" iconClass="nav-upload-flyout-icon" />
        </div>
      )}
      {/* The v2 Dialog: a bottom sheet under 768px, a centred dialog on a
          tablet. Portalled, so the bar's own transform never drags it along. */}
      {asSheet && (
        <Dialog
          open={open}
          onClose={menu.close}
          title={t('nav.create')}
          closeLabel={t('common.actions.close')}
          width={520}
          className="nav-upload-sheet"
        >
          <div ref={sheetRef} onClick={(e) => { if (e.target.closest('a')) menu.close(); }}>
            <UploadLinks linkClass="nav-upload-flyout-item" iconClass="nav-upload-flyout-icon" />
          </div>
        </Dialog>
      )}
    </div>
  );
}

// The section tabs of the bar (20a): a segmented track, text only.
// Live leads to the live grid; the rest are the app's main sections.
const SECTION_TABS = [
  { to: '/', end: true, label: (t) => t('common.nav.home'), tip: 'nav.tabs.overviewTooltip' },
  { to: '/shorts', label: (t) => t('common.nav.shorts'), tip: 'nav.tabs.shortsTooltip' },
  { to: '/live', label: (t) => t('nav.tabs.live'), tip: 'nav.tabs.liveTooltip' },
  { to: '/audio', label: (t) => t('nav.bottom.audio'), tip: 'nav.tabs.audioTooltip' },
  { to: '/groups', label: (t) => t('nav.bottom.groups'), tip: 'nav.tabs.groupsTooltip' },
];

function Nav({ toggleProfileNav, profileMenuHover, openLoginModal }) {
  const { t } = useTranslation();
  const { authenticated, user, initializeTheme } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  // Only a warm-up user is looked up here; a Hive account always keeps Create.
  const warmupKey = !user && incubationHandle ? creatorKey(null, incubationHandle) : null;
  const warmupUploadBlocked = isUploadBlocked(useCreatorSettings(warmupKey));
  const authChecked = useAppStore((s) => s.authChecked);
  const signupPossible = useSignupPossible();
  // Shows a just-uploaded profile picture immediately instead of the cached
  // hive proxy copy (utils/avatarCache).
  const myAvatar = useAvatarUrl(user, 'small');
  const location = useLocation();
  const [navHidden, setNavHidden] = useState(false);
  // The section tabs are out unless a member folded them away from the
  // account menu ("Hide pages", 42b). A visitor has no such menu, so always
  // sees them.
  const tabsPref = useNavTabsOpen();
  const tabsOpen = authenticated ? tabsPref : true;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // A mouse resting on the gear peeks at Settings, hung under it (SettingsModal
  // `dropdown`); typing in it, or a click on the gear, keeps it there. A click on the gear with nothing
  // showing opens the usual centred dialog. Never at phone widths (bottom sheet).
  // Visitors only: a member reaches Settings from the account menu (07d).
  const settingsPeek = useHoverPeek({
    enabled: typeof window !== 'undefined' && !!window.matchMedia?.('(min-width: 641px)').matches,
  });
  const [settingsRect, setSettingsRect] = useState(null);
  const settingsGearProps = {
    onClick: () => { if (settingsPeek.shown) settingsPeek.toggle(); else setSettingsOpen(true); },
    onPointerEnter: (e) => {
      if (!settingsPeek.shown) setSettingsRect(e.currentTarget.getBoundingClientRect());
      settingsPeek.hoverProps.onPointerEnter(e);
    },
    onPointerLeave: settingsPeek.hoverProps.onPointerLeave,
  };
  // A real button around the cog, so Settings is reachable from the keyboard.
  const settingsGear = (
    <button
      type="button"
      className="btn-reset nav-icon-btn nav-settings-btn"
      {...settingsGearProps}
      title={t('common.nav.settings')}
      aria-label={t('common.nav.settings')}
    >
      <Icon name="settings" size={24} />
    </button>
  );
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

  // Toasts get out of the way of the right-hand nav's panels, and come back on
  // the next click anywhere else. Bound on the document rather than on each
  // panel because those panels own their open state privately (the Create
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
  // The only time it hides is immersive landscape video on the watch page, which is
  // orientation-driven (not scroll-driven), so there's nothing to flicker.
  useEffect(() => {
    const landscapeQuery = window.matchMedia('(orientation: landscape) and (max-height: 500px)');
    const apply = () => setNavHidden(isWatchPath(location.pathname) && landscapeQuery.matches);
    apply();
    landscapeQuery.addEventListener('change', apply);
    return () => landscapeQuery.removeEventListener('change', apply);
  }, [location.pathname]);

  // Initialize theme on mount
  useEffect(() => {
    initializeTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The account button: the picture, or the first letter on the accent while
  // there is none (20a draws the "B" tile).
  const initial = String(user || incubationHandle || '').slice(0, 1).toUpperCase();

  return (
    // The bar (20a): a translucent card floating 16px under the top of the
    // window, lined up with the 1280 frame, over whatever is behind it (the
    // Home hero runs up under it). --nav-height is measured off the strip, so
    // sticky rows below it land right under the card.
    <nav ref={navContainerRef} className={`nav-container${navHidden ? ' nav-hidden' : ''}`}>
      <div className="nav-bar">
        <div className="nav-left">
          {/* The logo goes home. Class kept for the welcome tour. */}
          <Link to="/" className="nav-logo-btn" aria-label="3Speak" title={t('common.nav.home')}>
            <img className="logo" src={mark} alt="" />
          </Link>
        </div>

        {tabsOpen && (
          <div className="nav-tabs" id="nav-tabs">
            {SECTION_TABS.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                title={t(tab.tip)}
                className={({ isActive }) => `nav-tab${isActive ? ' active' : ''}`}
              >
                {tab.label(t)}
              </NavLink>
            ))}
          </div>
        )}

        <div className="phone-nav-left">
          <Link to="/" aria-label="3Speak"><img className="logo" src={mark} alt="" /></Link>
        </div>
        {/* In the flow after the tabs, pushed right next to Create (NavSearch.scss) */}
        <NavSearch />

        {authenticated ? (
          <div className="nav-right" onClickCapture={hideToastLayer}>
            {/* Incubating users only; renders nothing for everyone else. */}
            <NavProgress />
            {/* Hive accounts only: an incubating user cannot book ads yet. */}
            {!incubationHandle && <NavAdvertiseButton user={user} />}
            {/* Hidden outright for a warm-up user blocked from uploads (their
                `~<handle>` row has canUpload: false). A Hive account keeps it and
                gets the "contact support" popup from the entries instead. */}
            {!warmupUploadBlocked && <NavUploadDropdown />}
            <Link to="/discover" className="nav-icon-btn nav-mobile-discover" title={t('app.routes.discover')} aria-label={t('app.routes.discover')}>
              <Icon name="search" size={24} />
            </Link>
            <ChatButton />
            {/* One bell or the other. Hive's notifications need a Hive account,
                so an incubating user's bell reads from the incubation service
                instead of showing them a permanently empty one. */}
            {incubationHandle ? <IncubationBell /> : <NotificationBell />}
            <button
              type="button"
              className="btn-reset nav-avatar-wrap"
              onClick={toggleProfileNav}
              {...profileMenuHover}
              aria-label={t('nav.profile.accountMenu')}
              aria-haspopup="menu"
            >
              {myAvatar ? <img src={myAvatar} alt="" /> : <span className="nav-avatar-initial" aria-hidden="true">{initial}</span>}
              <PremiumBadge username={user} size={10} className="nav-avatar-premium" />
            </button>
          </div>
        ) : (
          <div className="nav-right" onClickCapture={hideToastLayer}>
            <Link to="/discover" className="nav-icon-btn nav-mobile-discover" title={t('app.routes.discover')} aria-label={t('app.routes.discover')}>
              <Icon name="search" size={24} />
            </Link>
            {/* Help for first-time visitors: a button on desktop, a bare ? icon
                on phones and tablets, where the button is hidden. */}
            <Link to="/faq" className="nav-icon-btn nav-mobile-discover nav-guest-faq-icon" title={t('nav.faqAria')} aria-label={t('nav.faqAria')}>
              <Icon name="help" size={24} />
            </Link>
            <Link to="/faq" className="v2-btn v2-btn--ghost h40 nav-guest-about" aria-label={t('nav.faqAria')}>{t('nav.faqLink')}</Link>
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
                <button type="button" className="v2-btn v2-btn--secondary h40 nav-guest-login nav-guest-login--secondary" onClick={() => openLoginModal('login')}>
                  <Icon name="login" size={18} /><span className="v2-btn__label">{t('common.actions.login')}</span>
                </button>
                <button type="button" className="v2-btn v2-btn--primary h40 nav-guest-signup" onClick={() => openLoginModal('signup')}>
                  <span className="v2-btn__label">{t('common.actions.signUp')}</span>
                </button>
              </>
            ) : (
              <button type="button" className="v2-btn v2-btn--primary h40 nav-guest-login" onClick={() => openLoginModal('login')}>
                <Icon name="login" size={18} /><span className="v2-btn__label">{t('common.actions.login')}</span>
              </button>
            )}
            </>)}
            {settingsGear}
          </div>
        )}
      </div>

      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {!settingsOpen && settingsPeek.rendered && settingsRect && (
        <SettingsModal
          isOpen
          dropdown={{ rect: settingsRect, held: settingsPeek.open }}
          leaving={settingsPeek.leaving}
          hoverProps={settingsPeek.hoverProps}
          typingProps={settingsPeek.typingProps}
          onClose={settingsPeek.close}
        />
      )}
    </nav>
  );
}

export default Nav;
