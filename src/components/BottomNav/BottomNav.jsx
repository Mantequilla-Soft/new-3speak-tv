import { Link, useLocation, useNavigate } from "react-router-dom";
import { MdOutlineSearch, MdOutlineDownload, MdGraphicEq, MdSettings, MdTrendingUp } from "react-icons/md";
import { IoAddCircleOutline, IoPower, IoCloudUploadSharp, IoShareOutline } from "react-icons/io5";
import { IoMdPerson } from "react-icons/io";
import { HiInformationCircle } from "react-icons/hi";
import { GiAstronautHelmet } from "react-icons/gi";
import { RiWallet3Fill } from "react-icons/ri";
import { FaDiscord } from "react-icons/fa";
import { FaSquareXTwitter, FaMedal, FaChartBar } from "react-icons/fa6";
import { SiTelegram } from "react-icons/si";
import { Clapperboard, MessageCircle } from "lucide-react";
import { useAppStore } from "../../lib/store";
import { useChat } from "../../context/ChatContext";
import { useServerUnread } from "../../hooks/useServerUnread";
import ShortsIcon from "../icons/ShortsIcon";
import SettingsModal from "../SettingsModal/SettingsModal";
import { FEATURE_EDITOR } from "../../utils/config";
import { APP_VERSION } from "../../version";
import { getHiveUrl } from "../../utils/hiveNode";
import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import PremiumBadge from "../PremiumBadge/PremiumBadge";
import { toastIn } from '../../utils/toast';
import logo from "../../assets/image/3S_logo.svg";
import logoDark from "../../assets/image/3S_logodark.png";
import "./BottomNav.scss";

// Every toast from this module is headed "Install"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Install');

// Split out so the polling subscription only exists while the badge is actually
// rendered (mobile + connected chat). Server-truth count, never a local tally.
function BottomNavChatBadge() {
  const { unreadCount } = useServerUnread();
  if (!unreadCount) return null;
  return (
    <span className="bottom-nav-chat-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>
  );
}

const BottomNav = ({ openLoginModal }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { authenticated, user, theme, LogOut } = useAppStore();
  const isManteAuth = localStorage.getItem("manteauth_login") === "true";
  const path = location.pathname;
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef(null);
  const { ready: chatReady } = useChat();

  // This bar is CSS-hidden rather than unmounted on desktop, so gate the unread
  // subscription on the same breakpoint the CSS uses.
  const [isMobileBar, setIsMobileBar] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 1024px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1024px)");
    const on = () => setIsMobileBar(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const isActive = (route) => path === route;
  const isShortsActive = path.startsWith("/shorts");

  // PWA install prompt
  const [installPrompt, setInstallPrompt] = useState(null);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async (e) => {
    e.preventDefault();
    setMenuOpen(false);
    if (installPrompt) {
      installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    }
  };

  // Detect iOS Safari (no beforeinstallprompt, needs manual instructions)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

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

  // Chat needs an account, so logged out this asks for one instead of routing to
  // a page that can't do anything.
  const handleChatClick = (e) => {
    if (!authenticated) {
      e.preventDefault();
      openLoginModal();
      return;
    }
    setMenuOpen(false);
  };

  const showInstallOption = !isStandalone && (installPrompt || isIOS);

  const handleProfileClick = (e) => {
    e.preventDefault();
    if (!authenticated) {
      // Logged out: the bottom-right "Login" button opens the login modal directly.
      openLoginModal();
    } else {
      setMenuOpen((prev) => !prev);
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

      <Link to="/audio" className={`bottom-nav-item ${isActive("/audio") ? "active" : ""}`}>
        <MdGraphicEq className="bottom-nav-icon" />
        <span>Audio</span>
      </Link>

      {/* Chat = the centre item (Share moved to the top bar's "+"). Logged out it
          opens the login modal, exactly as the old centre item did. */}
      <Link
        to="/chat"
        className={`bottom-nav-item ${isActive("/chat") ? "active" : ""}`}
        onClick={handleChatClick}
      >
        <span className="bottom-nav-icon-wrap">
          <MessageCircle className="bottom-nav-icon" />
          {/* Mounted on mobile only: the badge polls the server for unread, and
              this bar stays mounted (just CSS-hidden) on desktop, where the
              top-bar chat button already owns that subscription. */}
          {authenticated && chatReady && isMobileBar && <BottomNavChatBadge />}
        </span>
        <span>Chat</span>
      </Link>

      <Link to="/shorts" className={`bottom-nav-item ${isShortsActive ? "active" : ""}`}>
        <span className="bottom-nav-icon-wrap">
          <ShortsIcon className="bottom-nav-icon bottom-nav-icon--shorts" outlineWidth={isShortsActive ? 40 : 30} />
        </span>
        <span>Shorts</span>
      </Link>

      <a href="#" className={`bottom-nav-item ${menuOpen ? "active" : ""}`} onClick={handleProfileClick}>
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

      {menuOpen && authenticated && (
        <div className="bottom-nav-menu">
          <div className="bottom-nav-menu-header">
            <span className="bottom-nav-menu-avatar-wrap">
              <img src={`https://images.hive.blog/u/${user}/avatar/small`} alt={user} className="bottom-nav-menu-avatar" />
              <PremiumBadge username={user} size={12} className="bottom-nav-menu-avatar-premium" />
            </span>
            <span className="bottom-nav-menu-user">
              {user}
              <PremiumBadge username={user} size={13} />
            </span>
          </div>
          <div className="bottom-nav-menu-divider" />
          <Link to="/profile" className="bottom-nav-menu-item" onClick={() => setMenuOpen(false)}>
            <IoMdPerson className="bottom-nav-menu-icon" /> My Channel
          </Link>
          <Link to="/profile?tab=stats" className="bottom-nav-menu-item" onClick={() => setMenuOpen(false)}>
            <MdTrendingUp className="bottom-nav-menu-icon" /> Analytics
          </Link>
          <Link to="/leaderboard" className="bottom-nav-menu-item" onClick={() => setMenuOpen(false)}>
            <FaMedal className="bottom-nav-menu-icon" /> Leaderboard
          </Link>

          <Link to={`/wallet/${user}`} className="bottom-nav-menu-item" onClick={() => setMenuOpen(false)}>
            <RiWallet3Fill className="bottom-nav-menu-icon" /> Wallet
          </Link>
          <a href="#" className="bottom-nav-menu-item" onClick={(e) => { e.preventDefault(); setSettingsOpen(true); setMenuOpen(false); }}>
            <MdSettings className="bottom-nav-menu-icon" /> Settings
          </a>
          <Link to="/about" className="bottom-nav-menu-item" onClick={() => setMenuOpen(false)}>
            <HiInformationCircle className="bottom-nav-menu-icon" /> About 3Speak
          </Link>
          {/* Hidden for ButrAuth sessions — see ProfileNav for the reasoning. */}
          {!isManteAuth && (
            <a href="#" className="bottom-nav-menu-item" onClick={(e) => { e.preventDefault(); setMenuOpen(false); openLoginModal(); }}>
              <IoPower className="bottom-nav-menu-icon" /> Change account
            </a>
          )}
          {isManteAuth && (
            <a href="#" className="bottom-nav-menu-item" onClick={(e) => { e.preventDefault(); setMenuOpen(false); LogOut(user); navigate('/'); }}>
              <IoPower className="bottom-nav-menu-icon" /> Logout
            </a>
          )}

          {!isStandalone && (installPrompt || isIOS) && (
            <>
              <div className="bottom-nav-menu-divider" />
              {installPrompt ? (
                <a href="#" className="bottom-nav-menu-item bottom-nav-install" onClick={handleInstallClick}>
                  <MdOutlineDownload className="bottom-nav-menu-icon" /> Install App
                </a>
              ) : isIOS ? (
                <a href="#" className="bottom-nav-menu-item bottom-nav-install" onClick={(e) => { e.preventDefault(); setMenuOpen(false); toast('Tap the Share button in Safari, then "Add to Home Screen"', { icon: '📲' }); }}>
                  <MdOutlineDownload className="bottom-nav-menu-icon" />
                  <span className="bottom-nav-install-label">Install App</span>
                  <span className="bottom-nav-install-hint">via <IoShareOutline style={{ verticalAlign: 'middle', fontSize: 14 }} /> Share</span>
                </a>
              ) : null}
            </>
          )}

          <div className="bottom-nav-menu-divider" />
          <div className="bottom-nav-menu-logo">
            <img src={theme === 'light' ? logo : logoDark} alt="3Speak" />
          </div>
          <div className="bottom-nav-menu-social">
            <a href="https://discord.com/invite/NSFS2VGj83" target="_blank" rel="noopener noreferrer" aria-label="Discord"><FaDiscord size={24} /></a>
            <a href="https://x.com/3speaktv?utm_source=3speak.tv" target="_blank" rel="noopener noreferrer" aria-label="X"><FaSquareXTwitter size={24} /></a>
            <a href="https://t.me/threespeak?utm_source=3speak.tv" target="_blank" rel="noopener noreferrer" aria-label="Telegram"><SiTelegram size={24} /></a>
          </div>
        </div>
      )}

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
    <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>,
    document.body
  );
};

export default BottomNav;
