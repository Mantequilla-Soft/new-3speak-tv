import { Link, useNavigate } from "react-router-dom";
import { Icon } from "./v2/Icon";
import { FEATURE_EDITOR, openpodsEnabledFor, storiesEnabledFor } from "../utils/config";
import { creatorKey, getCreatorSettings, isUploadBlocked } from "../utils/creatorSettings";
import { useSupportBlock } from "../lib/supportBlockStore";
import { useAppStore } from "../lib/store";
import { useTranslation } from "react-i18next";
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

// The entry's icon (16) in a 32px well, tinted by category (44c): video and live in
// the accent, audio cyan, the rest muted.
function ItemIcon({ name, tone, className }) {
  return (
    <span className={`${className} share-menu-icon is-${tone}`} aria-hidden="true">
      <Icon name={name} size={16} />
    </span>
  );
}

// Label plus a one-line subtitle saying what the entry makes.
function ItemText({ label, sub }) {
  return (
    <span className="share-menu-text">
      <span className="share-menu-label">{label}</span>
      <span className="share-menu-sub">{sub}</span>
    </span>
  );
}

export default function UploadLinks({ linkClass, iconClass = "icon", onClick }) {
  const { t } = useTranslation();
  const text = (key) => <ItemText label={t(`misc.uploadLinks.${key}`)} sub={t(`misc.uploadLinks.subtitles.${key}`)} />;
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);

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
    const { user: hiveUser, incubationHandle } = useAppStore.getState();
    const settings = await getCreatorSettings(creatorKey(hiveUser, incubationHandle));
    if (isUploadBlocked(settings)) {
      const note = settings?.uploadBlockedReason;
      useSupportBlock.getState().showSupportBlock('upload', note ? { note } : undefined);
      return;
    }
    action();
  };

  // "Others" is empty without a signed-in user, so its header only renders
  // when there's something under it: a lone heading reads as a bug.
  const hasOthers = !!user;

  // Each category is its own group, stacked in one column (44c) in the
  // desktop flyout and in the sheet alike (nav.scss).
  return (
    <div className="share-menu-layout">
      <div className="share-menu-group">
        <div className="share-menu-heading">{t('misc.uploadLinks.headings.video')}</div>
        <Link to="/embed-studio" className={linkClass} title={t('misc.uploadLinks.regularVideo')} onClick={(e) => gatedGo(e, () => navigate('/embed-studio'))}>
          <ItemIcon name="smart_display" tone="accent" className={iconClass} /> {text('regularVideo')}
        </Link>
        <Link to="/embed-studio?from=shorts" className={linkClass} title={t('misc.uploadLinks.verticalShort')} onClick={(e) => gatedGo(e, () => navigate('/embed-studio?from=shorts'))}>
          <ItemIcon name="view_day" tone="accent" className={iconClass} /> {text('verticalShort')}
        </Link>
        {FEATURE_EDITOR && (
          <a href="#" className={linkClass} title={t('misc.uploadLinks.shortsEditor')} onClick={(e) => gatedGo(e, () => window.dispatchEvent(new CustomEvent('open-shorts-editor')))}>
            <ItemIcon name="movie_edit" tone="accent" className={iconClass} /> {text('shortsEditor')}
          </a>
        )}
        {/* 24h story: a vertical short that leaves the stories row after a day.
            Any Hive account (storiesEnabledFor); the checker enforces it too. */}
        {storiesEnabledFor(user) && (
          <Link to="/embed-studio?from=story" className={linkClass} title={t('misc.uploadLinks.story')} onClick={(e) => gatedGo(e, () => navigate('/embed-studio?from=story'))}>
            <ItemIcon name="history_toggle_off" tone="accent" className={iconClass} /> {text('story')}
          </Link>
        )}
      </div>

      {/* Audio: its own category, the upload and the editor side by side. */}
      <div className="share-menu-group">
        <div className="share-menu-heading">{t('misc.uploadLinks.headings.audio')}</div>
        <a href="#" className={linkClass} title={t('misc.uploadLinks.musicAudio')} onClick={(e) => gatedGo(e, () => window.dispatchEvent(new CustomEvent('open-audio-upload')))}>
          <ItemIcon name="graphic_eq" tone="cyan" className={iconClass} /> {text('musicAudio')}
        </a>
        {/* The video editor in audio mode: cut, clean up and level a podcast or
            song, then hand it to the audio upload (App.jsx, open-audio-editor). */}
        {FEATURE_EDITOR && (
          <a href="#" className={linkClass} title={t('misc.uploadLinks.audioEditor')} onClick={(e) => gatedGo(e, () => window.dispatchEvent(new CustomEvent('open-audio-editor')))}>
            <ItemIcon name="tune" tone="cyan" className={iconClass} /> {text('audioEditor')}
          </a>
        )}
      </div>

      {/* OpenPods live streaming — the whole "Live" category is gated behind
          VITE_ENABLE_OPENPODS (off by default), plus an always-on allowlist of
          test accounts (see openpodsEnabledFor). */}
      {openpodsEnabledFor(user) && (
        <div className="share-menu-group">
          <div className="share-menu-heading">{t('misc.uploadLinks.headings.live')}</div>
          <Link
            to="/openpods?create=1&mode=standalone"
            className={linkClass}
            title={t('misc.uploadLinks.goLiveNow')}
            onClick={go}
          >
            <ItemIcon name="sensors" tone="accent" className={iconClass} />
            {' '}{text('goLiveNow')}
          </Link>
          <Link
            to="/openpods?create=1&mode=conference"
            className={linkClass}
            title={t('misc.uploadLinks.groupChat')}
            onClick={go}
          >
            <ItemIcon name="groups" tone="accent" className={iconClass} /> {text('groupChat')}
          </Link>
        </div>
      )}

      {hasOthers && (
        <div className="share-menu-group">
          <div className="share-menu-heading">{t('misc.uploadLinks.headings.others')}</div>
          <Link to={`/@${user}?tab=community`} className={linkClass} title={t('misc.uploadLinks.communitySnap')} onClick={go}>
            <ItemIcon name="bolt" tone="muted" className={iconClass} /> {text('communitySnap')}
          </Link>
          <Link to="/profile?tab=playlists&create=playlist" className={linkClass} title={t('misc.uploadLinks.playlist')} onClick={go}>
            <ItemIcon name="playlist_add" tone="muted" className={iconClass} /> {text('playlist')}
          </Link>
        </div>
      )}
    </div>
  );
}
