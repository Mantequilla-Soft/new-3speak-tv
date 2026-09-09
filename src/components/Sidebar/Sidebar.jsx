import { RiProfileLine } from "react-icons/ri";
import "./Sidebar.scss";
import { PiUserSwitchBold } from "react-icons/pi";
import { HiInformationCircle } from "react-icons/hi";
import {
  MdOutlineDashboard,
  MdOutlineDynamicFeed,
  MdOutlineLeaderboard,
  MdPlaylistPlay,
  MdWatchLater,
  MdHistory,
  MdMic,
  MdOutlineWorkspacePremium,
} from "react-icons/md";
import useOpenPodsCount from "../../hooks/useOpenPodsCount";
import { LuNewspaper } from "react-icons/lu";
import { FaFire, FaRegSmile } from "react-icons/fa";
import { MdGraphicEq } from "react-icons/md";
import { IoCloudUploadSharp } from "react-icons/io5";
import { RiRssFill } from "react-icons/ri";
import { BiChevronRight } from "react-icons/bi";
import { BsCollectionPlay } from "react-icons/bs";
import { Link } from "react-router-dom";
import { useState, useRef, useEffect } from "react";
import { useAppStore } from "../../lib/store";
import ShortsIcon from "../icons/ShortsIcon";
import { COMPACT_SIDEBAR } from "../../utils/config";
import { useMyPlaylists } from "../../hooks/useMyPlaylists";

const SidebarDropdown = ({ icon: Icon, label, children, sidebar }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const compact = sidebar === false;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open && !compact) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, compact]);

  return (
    <div
      className={`sidebar-dropdown ${open ? "open" : ""}`}
      ref={ref}
      onMouseEnter={compact ? () => setOpen(true) : undefined}
      onMouseLeave={compact ? () => setOpen(false) : undefined}
    >
      <div
        className="side-link dropdown-toggle"
        onClick={compact ? undefined : () => setOpen(!open)}
        title={label}
      >
        <Icon className="icon" />
        <span>{label}</span>
        <BiChevronRight className="chevron" />
      </div>
      {open && <div className="flyout-menu" onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
};

const Sidebar = ({ sidebar, onNavigate }) => {
  const { authenticated, user } = useAppStore();
  const livePodsCount = useOpenPodsCount();
  const { data: playlists = [] } = useMyPlaylists({ enabled: !!authenticated });
  const watchLaterPlaylist = playlists.find(p => p.name === 'Watch Later');
  const watchLaterLink = watchLaterPlaylist ? `/playlist/${watchLaterPlaylist.id}` : '/profile?tab=playlists';
  const nav = onNavigate || undefined;

  return (
    <div className={`sidebar ${sidebar ? "" : "small-sidebar"}`}>
      <div className="shortcut-links">
        <Link to="/" className="side-link" title="Home" onClick={nav}>
          <MdOutlineDashboard className="icon" /> <span>Home</span>
        </Link>
        <Link to="/shorts" className="side-link" title="Shorts" onClick={nav}>
          <ShortsIcon className="icon" outlineWidth={30} /> <span>Shorts</span>
        </Link>
        <Link to="/audio" className="side-link" title="Audio" onClick={nav}>
          <MdGraphicEq className="icon" /> <span>Audio</span>
        </Link>
        {COMPACT_SIDEBAR ? (
          <SidebarDropdown icon={BsCollectionPlay} label="Feeds" sidebar={sidebar}>
            <Link to="/firstupload" className="side-link" title="First Uploads" onClick={nav}>
              <FaRegSmile className="icon" /> <span>First Uploads</span>
            </Link>
            <Link to="/new" className="side-link" title="New Content" onClick={nav}>
              <LuNewspaper className="icon" /> <span>New Content</span>
            </Link>
            {authenticated && (
              <Link to="/follow-feed" className="side-link" title="Follow Feed" onClick={nav}>
                <RiRssFill className="icon" /> <span>Follow Feed</span>
              </Link>
            )}
            <Link to="/trend" className="side-link" title="Trending Content" onClick={nav}>
              <FaFire className="icon" /> <span>Trending Content</span>
            </Link>
          </SidebarDropdown>
        ) : (
          <>
            <Link to="/firstupload" className="side-link" title="First Uploads" onClick={nav}>
              <FaRegSmile className="icon" /> <span>First Uploads</span>
            </Link>
            <Link to="/trend" className="side-link" title="Trending Content" onClick={nav}>
              <FaFire className="icon" /> <span>Trending Content</span>
            </Link>
            <Link to="/new" className="side-link" title="New Content" onClick={nav}>
              <LuNewspaper className="icon" /> <span>New Content</span>
            </Link>
          </>
        )}

        {authenticated && (
          <SidebarDropdown icon={MdPlaylistPlay} label="Playlists" sidebar={sidebar}>
            <Link to={watchLaterLink} className="side-link" title="Watch Later" onClick={nav}>
              <MdWatchLater className="icon" /> <span>Watch Later{watchLaterPlaylist?.items?.length > 0 ? ` (${watchLaterPlaylist.items.length})` : ''}</span>
            </Link>
            <Link to={`/watched/${user}`} className="side-link" title="Watch History" onClick={nav}>
              <MdHistory className="icon" /> <span>Watch History</span>
            </Link>
            <Link to="/profile?tab=playlists" className="side-link" title="All Playlists" onClick={nav}>
              <MdPlaylistPlay className="icon" /> <span>All Playlists</span>
            </Link>
          </SidebarDropdown>
        )}

        <Link to="/openpods" className="side-link" title="OpenPods" onClick={nav}>
          <MdMic className="icon" />
          <span>OpenPods</span>
          {livePodsCount > 0 && (
            <span className="sidebar-live-badge">{livePodsCount}</span>
          )}
        </Link>
        <Link to="/communities" className="side-link" title="Communities" onClick={nav}>
          <MdOutlineDynamicFeed className="icon" /> <span>Communities</span>
        </Link>
        <Link to="/badges" className="side-link" title="Badges" onClick={nav}>
          <MdOutlineWorkspacePremium className="icon" /> <span>Badges</span>
        </Link>
        <Link to="/about" className="side-link" title="About 3speak" onClick={nav}>
          <HiInformationCircle className="icon" /> <span>About 3speak</span>
        </Link>

      </div>
    </div>
  );
};

export default Sidebar;
