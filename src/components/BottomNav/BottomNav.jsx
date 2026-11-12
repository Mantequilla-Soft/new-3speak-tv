import { Link, useLocation } from "react-router-dom";
import { useTranslation, Trans } from "react-i18next";
import useWarmupProgress, { warmupFigures } from "../../hooks/useWarmupProgress";
import { handleAvatar } from "../../lib/incubation";
import { useAppStore } from "../../lib/store";
import { Icon } from "../v2/Icon";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import PremiumBadge from "../PremiumBadge/PremiumBadge";
import { usePwaInstall } from "../../utils/pwaInstall";
import "./BottomNav.scss";
import { isWatchPath } from '../../utils/urls';
import { OPEN_CREATE_EVENT } from "../nav/navTabsPref";
import { creatorKey, isUploadBlocked, useCreatorSettings } from "../../utils/creatorSettings";


const BottomNav = ({ openLoginModal, onOpenProfileMenu, profileMenuOpen }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { authenticated, user } = useAppStore();
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  // Same rule as the top bar's Create: a warm-up user blocked from uploads gets
  // no "+" (their `~<handle>` row has canUpload: false).
  const warmupKey = !user && incubationHandle ? creatorKey(null, incubationHandle) : null;
  const warmup = useWarmupProgress(!user && !!incubationHandle);
  const warmupNums = warmupFigures(warmup);
  const warmupRing = !!warmup && !warmup.needsTrack && warmupNums.total > 0;
  const createBlocked = isUploadBlocked(useCreatorSettings(warmupKey));
  const path = location.pathname;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isActive = (route) => path === route;
  const isShortsActive = path.startsWith("/shorts");
  const isAudioActive = path === "/audio" || path.startsWith("/audio/");

  // PWA install prompt. Shared with the account menu, which offers the same
  // "Install App" row to signed-in users.
  const { canInstallPrompt: installPrompt, isIOS, showInstall: showInstallOption, promptInstall } = usePwaInstall();

  const handleInstallClick = async (e) => {
    e.preventDefault();
    setMenuOpen(false);
    await promptInstall();
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
      }
    };
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  // (Hide-on-scroll behavior was removed — the bar is now always visible.)

  // Close menus on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [path]);

  const handleProfileClick = (e) => {
    e.preventDefault();
    if (!authenticated) {
      // Logged out: the bottom-right "Login" button opens the login modal directly.
      openLoginModal();
    } else {
      // Signed in: the same account menu the desktop avatar opens, shown as a
      // compact card above this button. There used to be a second, separate menu
      // here that had to be kept in step with it by hand.
      onOpenProfileMenu?.();
    }
  };

  // One tab: a Material Symbols icon (filled when it is the current section)
  // over its label. The label is its own span so the link's text is exactly it.
  // The current one sits on a 52px surface-2 tile (20a phone).
  const tab = (to, icon, label, active) => (
    <Link to={to} className={`bottom-nav-item${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>
      <span className="bottom-nav-tile">
        <span className="bottom-nav-icon-wrap"><Icon name={icon} size={24} fill={active} className="bottom-nav-icon" /></span>
        <span className="bottom-nav-label">{label}</span>
      </span>
    </Link>
  );

  // The red "+" in the middle opens the Create menu (Nav.jsx owns it), or the
  // login dialog for a visitor.
  const onCreate = () => {
    if (!authenticated) { openLoginModal(); return; }
    window.dispatchEvent(new CustomEvent(OPEN_CREATE_EVENT));
  };

  return createPortal(
    <nav className={`bottom-nav${isWatchPath(path) ? ' bottom-nav--watch' : ''}`} ref={menuRef}>
      {tab("/", "home", t('common.nav.home'), isActive("/"))}
      {tab("/shorts", "smart_display", t('common.nav.shorts'), isShortsActive)}
      {!createBlocked ? (
        <span className="bottom-nav-item bottom-nav-create-slot">
          <button type="button" className="bottom-nav-create" onClick={onCreate} aria-label={t('nav.create')} title={t('nav.create')}>
            <Icon name="add" size={28} />
          </button>
        </span>
      ) : <span className="bottom-nav-item" aria-hidden="true" />}
      {/* Audio (owner 2026-11-12; Groups held this slot, it moved into the
          account menu on phones). Chat is in the account menu on phones and in
          the top bar from tablets up. */}
      {tab("/audio", "headphones", t('nav.bottom.audio'), isAudioActive)}

      <a href="#" className={`bottom-nav-item${menuOpen || profileMenuOpen ? " active" : ""}`} onClick={handleProfileClick}
        aria-label={authenticated ? t('common.nav.profile') : t('nav.bottom.login')}>
        <span className="bottom-nav-tile">
          {authenticated ? (
            <span className={`bottom-nav-icon-wrap bottom-nav-avatar-wrap${warmupRing ? " has-ring" : ""}`}>
              {/* A warm-up account's progress ring around the avatar (owner
                  2026-11-12), as the top bar has it on desktop; on phones and
                  tablets this is the only one. */}
              {warmupRing && (
                <svg className={`bottom-nav-ring${warmupNums.complete ? " is-complete" : ""}`} viewBox="0 0 36 36" aria-hidden="true">
                  <circle className="bottom-nav-ring-track" cx="18" cy="18" r="15.9155" />
                  <circle className="bottom-nav-ring-arc" cx="18" cy="18" r="15.9155" strokeDasharray={`${Math.min(100, warmupNums.fraction * 100)} 100`} />
                </svg>
              )}
              <img
                src={user ? `/img/u/${user}/avatar/small` : handleAvatar(incubationHandle)}
                alt={user || incubationHandle || ""}
                className="bottom-nav-avatar"
              />
              <PremiumBadge username={user} size={10} className="bottom-nav-avatar-premium" />
            </span>
          ) : (
            <span className="bottom-nav-icon-wrap"><Icon name="person" size={24} className="bottom-nav-icon" /></span>
          )}
          <span className="bottom-nav-label">{authenticated ? t('nav.bottom.you') : t('nav.bottom.login')}</span>
        </span>
      </a>

      {menuOpen && !authenticated && showInstallOption && (
        <div className="bottom-nav-menu v2-menu" role="menu">
          {installPrompt ? (
            <a href="#" className="v2-menu__row bottom-nav-install" role="menuitem" onClick={handleInstallClick}>
              <Icon name="install_mobile" size={18} /> <span>{t('nav.installApp')}</span>
            </a>
          ) : isIOS ? (
            <div className="bottom-nav-ios-hint">
              <Icon name="install_mobile" size={18} />
              <span><Trans i18nKey="nav.iosInstallHint" components={{ b: <strong /> }} /></span>
            </div>
          ) : null}
          <div className="v2-menu__sep" />
          <a href="#" className="v2-menu__row" role="menuitem" onClick={(e) => { e.preventDefault(); setMenuOpen(false); openLoginModal(); }}>
            <Icon name="login" size={18} /> <span>{t('nav.bottom.login')}</span>
          </a>
        </div>
      )}
    </nav>,
    document.body
  );
};

export default BottomNav;
