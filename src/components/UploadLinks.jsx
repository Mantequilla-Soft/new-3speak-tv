import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "./v2/Icon";
import { FEATURE_EDITOR, openpodsEnabledFor, storiesEnabledFor } from "../utils/config";
import { creatorKey, getCreatorSettings, isUploadBlocked } from "../utils/creatorSettings";
import { useSupportBlock } from "../lib/supportBlockStore";
import { useAppStore } from "../lib/store";
import { useTranslation } from "react-i18next";
import "./UploadLinks.scss";

function pauseAllMedia() {
  document.querySelectorAll('video, audio').forEach((el) => {
    if (!el.paused) el.pause();
  });
}

// The icon in a well, tinted by category (44c): video and live in the accent,
// audio cyan, the rest muted. 28 on a 52px well in the tiles.
function ItemIcon({ name, tone, className }) {
  return (
    <span className={`${className} share-menu-icon is-${tone}`} aria-hidden="true">
      <Icon name={name} size={28} />
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

/**
 * The Create menu (owner 2026-11-18: "too many items"): four category tiles
 * first (Video, Audio, Streams, Others), a tap on one shows its entries as
 * tiles with a Back button. A category with nothing in it for this user is
 * left out. Shared by the desktop flyout and the narrow-screen sheet (Nav.jsx);
 * both unmount it on close, so it opens on the categories again.
 *
 * @param {string}   linkClass  – className applied to each entry
 * @param {string}   iconClass  – className applied to each icon (optional)
 * @param {function} onClick    – optional callback fired when an entry is clicked
 * @param {function} onStep     – optional, fired when the view changes (the
 *                                flyout pins a hover peek with it)
 */
export default function UploadLinks({ linkClass, iconClass = "icon", onClick, onStep }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const [open, setOpen] = useState(null);
  const backRef = useRef(null);
  const tileRefs = useRef({});
  const lastOpen = useRef(null);

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
  const toPage = (to) => ({ to, gated: true });
  const fire = (name) => ({ event: name, gated: true });
  const sub = (key) => ({ label: t(`misc.uploadLinks.${key}`), sub: t(`misc.uploadLinks.subtitles.${key}`) });

  const categories = [
    {
      id: 'video', icon: 'smart_display', tone: 'accent', heading: 'video',
      items: [
        { key: 'regularVideo', icon: 'smart_display', ...sub('regularVideo'), ...toPage('/embed-studio') },
        { key: 'verticalShort', icon: 'view_day', ...sub('verticalShort'), ...toPage('/embed-studio?from=shorts') },
        // 24h story: a vertical short that leaves the stories row after a day.
        // Any Hive account (storiesEnabledFor); the checker enforces it too.
        // Its own row under the uploads, the editors below under "Edit" (owner
        // 2026-11-18): the heading spans the grid, so it starts a new row.
        storiesEnabledFor(user) && { key: 'story', icon: 'history_toggle_off', ...sub('story'), ...toPage('/embed-studio?from=story') },
        FEATURE_EDITOR && { key: 'editHeading', heading: t('misc.uploadLinks.headings.edit') },
        FEATURE_EDITOR && { key: 'shortsEditor', icon: 'movie_edit', ...sub('shortsEditor'), ...fire('open-shorts-editor') },
        // The same editor as a landscape project (up to 10 minutes), posted as a
        // normal video (hooks/useEditorLauncher.js, open-video-editor).
        FEATURE_EDITOR && { key: 'videoEditor', icon: 'content_cut', label: t('editorFormat.videoEditor'), sub: t('editorFormat.videoEditorSub'), ...fire('open-video-editor') },
      ],
    },
    {
      id: 'audio', icon: 'graphic_eq', tone: 'cyan', heading: 'audio',
      items: [
        { key: 'musicAudio', icon: 'graphic_eq', ...sub('musicAudio'), ...fire('open-audio-upload') },
        // The video editor in audio mode: cut, clean up and level a podcast or
        // song, then hand it to the audio upload (App.jsx, open-audio-editor).
        FEATURE_EDITOR && { key: 'audioEditor', icon: 'tune', ...sub('audioEditor'), ...fire('open-audio-editor') },
      ],
    },
    // OpenPods live streaming: gated behind VITE_ENABLE_OPENPODS plus an
    // always-on allowlist of test accounts (see openpodsEnabledFor).
    {
      id: 'streams', icon: 'sensors', tone: 'accent', heading: 'streams',
      items: openpodsEnabledFor(user) ? [
        { key: 'goLiveNow', icon: 'sensors', ...sub('goLiveNow'), to: '/openpods?create=1&mode=standalone' },
        { key: 'groupChat', icon: 'groups', ...sub('groupChat'), to: '/openpods?create=1&mode=conference' },
      ] : [],
    },
    // Signed-in Hive accounts only: both live on the user's channel.
    {
      id: 'others', icon: 'more_horiz', tone: 'muted', heading: 'others',
      items: user ? [
        { key: 'communitySnap', icon: 'bolt', ...sub('communitySnap'), to: `/@${user}?tab=community` },
        { key: 'playlist', icon: 'playlist_add', ...sub('playlist'), to: '/profile?tab=playlists&create=playlist' },
      ] : [],
    },
  ].map((c) => ({ ...c, items: c.items.filter(Boolean) })).filter((c) => c.items.length > 0);

  const current = categories.find((c) => c.id === open) || null;

  // Keyboard focus follows the view: Back on the way in, the category's tile
  // on the way out.
  useEffect(() => {
    if (current) backRef.current?.focus();
    else if (lastOpen.current) tileRefs.current[lastOpen.current]?.focus();
  }, [current]);

  // The desktop flyout closes on any click inside it: moving between views
  // must not reach it.
  const step = (e, id) => {
    e.stopPropagation();
    if (id) lastOpen.current = id;
    setOpen(id);
    onStep?.();
  };

  const entry = (it, tone) => {
    if (it.heading) return <span key={it.key} className="share-menu-heading share-menu-subheading">{it.heading}</span>;
    const body = <><ItemIcon name={it.icon} tone={tone} className={iconClass} /><ItemText label={it.label} sub={it.sub} /></>;
    const className = `${linkClass} share-menu-tile`;
    if (it.event) {
      return (
        <a key={it.key} href="#" className={className} title={it.label}
          onClick={(e) => gatedGo(e, () => window.dispatchEvent(new CustomEvent(it.event)))}>
          {body}
        </a>
      );
    }
    return (
      <Link key={it.key} to={it.to} className={className} title={it.label}
        onClick={it.gated ? (e) => gatedGo(e, () => navigate(it.to)) : go}>
        {body}
      </Link>
    );
  };

  if (current) {
    return (
      <div className="share-menu-layout" data-view={current.id}>
        <div className="share-menu-head">
          <span className="share-menu-heading">{t(`misc.uploadLinks.headings.${current.heading}`)}</span>
          {/* On the right (owner 2026-11-18). */}
          <button type="button" ref={backRef} className="share-menu-back" onClick={(e) => step(e, null)}>
            <Icon name="arrow_back" size={18} />
            <span>{t('common.actions.back')}</span>
          </button>
        </div>
        <div className="share-menu-grid share-menu-group">
          {current.items.map((it) => entry(it, current.tone))}
        </div>
      </div>
    );
  }

  return (
    <div className="share-menu-layout" data-view="categories">
      <div className="share-menu-grid">
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            ref={(el) => { tileRefs.current[c.id] = el; }}
            className="share-menu-tile share-menu-cat"
            onClick={(e) => step(e, c.id)}
          >
            <ItemIcon name={c.icon} tone={c.tone} className={iconClass} />
            <ItemText label={t(`misc.uploadLinks.headings.${c.heading}`)} sub={t(`misc.uploadLinks.categories.${c.id}`)} />
          </button>
        ))}
      </div>
    </div>
  );
}
