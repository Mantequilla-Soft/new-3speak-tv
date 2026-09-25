import { Link, useLocation } from "react-router-dom";
import { MdOutlineDownload, MdGraphicEq, MdGroups } from "react-icons/md";
import { IoAddCircleOutline, IoCloudUploadSharp } from "react-icons/io5";
import { IoMdPerson } from "react-icons/io";
import { GiAstronautHelmet } from "react-icons/gi";
import { FaChartBar } from "react-icons/fa6";
import { Clapperboard } from "lucide-react";
import { useAppStore } from "../../lib/store";
import ShortsIcon from "../icons/ShortsIcon";
import { FEATURE_EDITOR } from "../../utils/config";
import { APP_VERSION } from "../../version";
import { getHiveUrl } from "../../utils/hiveNode";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import PremiumBadge from "../PremiumBadge/PremiumBadge";
import { usePwaInstall } from "../../utils/pwaInstall";
import "./BottomNav.scss";


const BottomNav = ({ openLoginModal, onOpenProfileMenu, profileMenuOpen }) => {
  const location = useLocation();
  const { authenticated, user } = useAppStore();
  const path = location.pathname;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const isActive = (route) => path === route;
  const isShortsActive = path.startsWith("/shorts");
  const isGroupsActive = path.startsWith("/groups");

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

  return createPortal(
    <>
    <nav className={`bottom-nav${path === '/watch' ? ' bottom-nav--watch' : ''}`} ref={menuRef}>
      <Link to="/" className={`bottom-nav-item ${isActive("/") ? "active" : ""}`}>
        <span className="bottom-nav-icon-wrap">
          <FaChartBar className="bottom-nav-icon bottom-nav-icon--feeds" />
        </span>
        <span>Feeds</span>
      </Link>

      <Link to="/shorts" className={`bottom-nav-item ${isShortsActive ? "active" : ""}`}>
        <span className="bottom-nav-icon-wrap">
          <ShortsIcon className="bottom-nav-icon bottom-nav-icon--shorts" outlineWidth={isShortsActive ? 40 : 30} />
        </span>
        <span>Shorts</span>
      </Link>

      {/* Groups takes the slot chat used to hold. Chat is not gone: it moved to
          the top bar, which now shows its button at every width instead of
          hiding it below 1024px, so the unread badge went with it and is no
          longer mounted in two places. */}
      <Link to="/groups" className={`bottom-nav-item ${isGroupsActive ? "active" : ""}`}>
        <span className="bottom-nav-icon-wrap">
          <MdGroups className="bottom-nav-icon" />
        </span>
        <span>Groups</span>
      </Link>

      <Link to="/audio" className={`bottom-nav-item ${isActive("/audio") ? "active" : ""}`}>
        <MdGraphicEq className="bottom-nav-icon" />
        <span>Audio</span>
      </Link>

      <a href="#" className={`bottom-nav-item ${menuOpen || profileMenuOpen ? "active" : ""}`} onClick={handleProfileClick}>
        {authenticated ? (
          <span className="bottom-nav-avatar-wrap">
            <img
              src={`https://images.hive.blog/u/${user}/avatar/small`}
              alt={user}
              className="bottom-nav-avatar"
            />
            <PremiumBadge username={user} size={10} className="bottom-nav-avatar-premium" />
          </span>
        ) : (
          <div className="bottom-nav-avatar-placeholder">
            <GiAstronautHelmet />
          </div>
        )}
        <span>{authenticated ? "Profile" : "Login"}</span>
      </a>

      {menuOpen && !authenticated && showInstallOption && (
        <div className="bottom-nav-menu">
          {installPrompt ? (
            <a href="#" className="bottom-nav-menu-item bottom-nav-install" onClick={handleInstallClick}>
              <MdOutlineDownload className="bottom-nav-menu-icon" /> Install App
            </a>
          ) : isIOS ? (
            <div className="bottom-nav-menu-item bottom-nav-install bottom-nav-ios-hint">
              <MdOutlineDownload className="bottom-nav-menu-icon" />
              <span>Tap <strong>Share</strong> then <strong>Add to Home Screen</strong></span>
            </div>
          ) : null}
          <div className="bottom-nav-menu-divider" />
          <a href="#" className="bottom-nav-menu-item" onClick={(e) => { e.preventDefault(); setMenuOpen(false); openLoginModal(); }}>
            <IoMdPerson className="bottom-nav-menu-icon" /> Login
          </a>
        </div>
      )}
    </nav>
    </>,
    document.body
  );
};

export default BottomNav;
