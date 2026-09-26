import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { IoCloudUploadSharp } from "react-icons/io5";
import { Clapperboard } from "lucide-react";
import { MdGraphicEq, MdDesktopWindows, MdSmartphone, MdGroups } from "react-icons/md";
import { BiCommentDetail } from "react-icons/bi";
import ShortsIcon from "./icons/ShortsIcon";
import { FEATURE_EDITOR, openpodsEnabledFor } from "../utils/config";
import { getCreatorSettings, isUploadBlocked } from "../utils/creatorSettings";
import { useSupportBlock } from "../lib/supportBlockStore";
import { useAppStore } from "../lib/store";
import "./UploadLinks.scss";

/**
 * Shared upload link pair used in Nav, Sidebar, and ProfileNav.
 * @param {string}   linkClass  – className applied to each <Link>
 * @param {string}   iconClass  – className applied to each icon (optional)
 * @param {function} onClick    – optional callback fired when a link is clicked
 */
function pauseAllMedia() {
  document.querySelectorAll('video, audio').forEach((el) => {
    if (!el.paused) el.pause();
  });
}

export default function UploadLinks({ linkClass, iconClass = "icon", onClick }) {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);

  // "Go Live" on a phone, "Stream Studio" on desktop. Same destination — the
  // wording just matches what the two studios actually feel like: a phone user
  // taps and is broadcasting, while the desktop studio is a scene/source
  // console you set up first. 767px is the app's mobile breakpoint (App.jsx).
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Plain navigation entries (Go Live, Community Snap) — no upload gate, just
  // pause any playing media and close the dropdown, then let the Link navigate.
  const go = (e) => { pauseAllMedia(); if (onClick) onClick(e); };

  // Gate every upload entry at click: a creator with canUpload === false sees
  // the "contact support" modal immediately instead of opening the studio /
  // recorder. Fails open if the check errors (never blocks on a failed check).
  const gatedGo = async (e, action) => {
    e.preventDefault();
    pauseAllMedia();
    if (onClick) onClick(e); // close the dropdown/menu either way
    const settings = await getCreatorSettings(useAppStore.getState().user);
    if (isUploadBlocked(settings)) {
      useSupportBlock.getState().showSupportBlock('upload');
      return;
    }
    action();
  };

  // "Others" can be empty (no signed-in user, editor flag off), so its header
  // only renders when there's something under it — a lone heading reads as a
  // bug.
  const hasOthers = !!user || FEATURE_EDITOR;

  return (
    <>
      <div className="share-menu-heading">Upload</div>
      <Link to="/embed-studio" className={linkClass} title="Regular Video" onClick={(e) => gatedGo(e, () => navigate('/embed-studio'))}>
        <IoCloudUploadSharp className={iconClass} /> <span>Regular Video</span>
      </Link>
      <Link to="/embed-studio?from=shorts" className={linkClass} title="Vertical Short" onClick={(e) => gatedGo(e, () => navigate('/embed-studio?from=shorts'))}>
        <ShortsIcon className={iconClass} outlineWidth={30} /> <span>Vertical Short</span>
      </Link>
      <a href="#" className={linkClass} title="Music / Audio" onClick={(e) => gatedGo(e, () => window.dispatchEvent(new CustomEvent('open-audio-upload')))}>
        <MdGraphicEq className={iconClass} /> <span>Music / Audio</span>
      </a>

      {/* OpenPods live streaming — the whole "Live" category is gated behind
          VITE_ENABLE_OPENPODS (off by default), plus an always-on allowlist of
          test accounts (see openpodsEnabledFor). */}
      {openpodsEnabledFor(user) && (
        <>
          <div className="share-menu-heading">Live</div>
          <Link
            to="/openpods?create=1&mode=conference"
            className={linkClass}
            title="Group Chat"
            onClick={go}
          >
            <MdGroups className={iconClass} /> <span>Group Chat</span>
          </Link>
          <Link
            to="/openpods?create=1&mode=standalone"
            className={linkClass}
            title={isMobile ? "Go Live" : "Stream Studio"}
            onClick={go}
          >
            {isMobile
              ? <MdSmartphone className={iconClass} />
              : <MdDesktopWindows className={iconClass} />}
            {' '}<span>{isMobile ? "Go Live" : "Stream Studio"}</span>
          </Link>
        </>
      )}

      {hasOthers && <div className="share-menu-heading">Others</div>}
      {user && (
        <Link to={`/p/${user}?tab=community`} className={linkClass} title="Community Snap" onClick={go}>
          <BiCommentDetail className={iconClass} /> <span>Community Snap</span>
        </Link>
      )}
      {FEATURE_EDITOR && (
        <a href="#" className={linkClass} title="Shorts Editor" onClick={(e) => gatedGo(e, () => window.dispatchEvent(new CustomEvent('open-shorts-editor')))}>
          <Clapperboard className={iconClass} size={18} /> <span>Shorts Editor</span>
        </a>
      )}
    </>
  );
}
