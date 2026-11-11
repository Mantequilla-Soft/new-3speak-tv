import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import { Sheet } from "../v2/ui";
import { toastIn } from '../../utils/toast';
import PropTypes from "prop-types";
import { isLoggedIn } from "../../hive-api/aioha";
import { useAppStore } from "../../lib/store";
import AddToPlaylistModal from "../AddToPlaylistModal/AddToPlaylistModal";
import AddTagModal from "../AddTagModal/AddTagModal";
import { useQueryClient } from "@tanstack/react-query";
import { hideVideo, unhideVideo, hideCreator, unhideCreator, refreshRailsAfterHide } from "../../utils/userFilters";
import "./CardOptionsMenu.scss";

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

// Under 768px the menu is a bottom sheet (STYLE_GUIDE §7); above it a popover.
const SHEET_QUERY = "(max-width: 767px)";
const wantsSheet = () => typeof window !== "undefined" && !!window.matchMedia?.(SHEET_QUERY).matches;

/**
 * The "⋮" menu on a thumbnail card, drawn as a tile-grid menu (07d / 28b): the
 * two "do something with it" actions as tiles, then the feed-tuning rows. It replaces the old bare add-to-playlist
 * button, which sat at z-index 3 and so was painted over by the hover-preview
 * overlay (z-index 4) the moment the preview started — making it unusable.
 *
 * The dropdown is portalled to <body> and positioned from the trigger's rect, so
 * neither the card's overflow:hidden nor its stacking context can clip it.
 *
 * `onDismiss(kind, payload)` lets the parent grid drop the card(s) immediately —
 * the server-side filter only takes effect on the next feed fetch.
 */
function CardOptionsMenu({ author, permlink, title, onDismiss, onOpenChange, className = "" }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const user = useAppStore((s) => s.user);

  // Tell the host (the hover-preview overlay) to hold the preview open while a
  // popup of ours is up — otherwise moving into the portalled dropdown counts as
  // leaving the card and unmounts us mid-click. Also released on unmount.
  const anyOpen = open || playlistOpen || tagOpen;
  useEffect(() => {
    onOpenChange?.(anyOpen);
  }, [anyOpen, onOpenChange]);
  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  const close = useCallback(() => setOpen(false), []);

  // Close on outside click, Escape, scroll or resize (the menu is position:fixed,
  // so it would otherwise detach from its card as the page moves).
  useEffect(() => {
    if (!open || coords?.sheet) return undefined;
    const onDown = (e) => {
      if (menuRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close, coords?.sheet]);

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) return close();
    if (wantsSheet()) {
      setCoords({ sheet: true });
      setOpen(true);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const MENU_W = 260;
      const MENU_H = 210;
      // Right-aligned to the trigger (it sits at the card's top-right); flip
      // left / up when we would overflow the viewport.
      const left = Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8);
      const openUp = window.innerHeight - r.bottom < MENU_H;
      setCoords({ left: Math.max(8, left), top: openUp ? r.top - 6 : r.bottom + 6, openUp });
    } else {
      setCoords({ left: 8, top: 8, openUp: false });
    }
    setOpen(true);
  };

  const requireLogin = () => {
    if (isLoggedIn() && user) return true;
    toast.error(t('engagement.cardMenu.loginToPersonalize'));
    return false;
  };

  const act = (e, fn) => {
    e.preventDefault();
    e.stopPropagation();
    close();
    fn();
  };

  const onNotInterested = () => {
    if (!requireLogin()) return;
    onDismiss?.("video", { owner: author, permlink });
    hideVideo(user, author, permlink);
    toast.success(t('engagement.cardMenu.notInterestedToast'), {
      action: {
        label: t('engagement.cardMenu.undo'),
        onClick: () => {
          unhideVideo(user, author, permlink);
          onDismiss?.("undo-video", { owner: author, permlink });
        },
      },
    });
  };

  const onHideCreator = () => {
    if (!requireLogin()) return;
    if (user?.toLowerCase() === String(author).toLowerCase()) {
      toast.error(t('engagement.cardMenu.cantHideOwn'));
      return;
    }
    onDismiss?.("creator", { owner: author });
    // Their shorts, audio and playlists leave the other rails too, once saved.
    hideCreator(user, author).then((ok) => { if (ok) refreshRailsAfterHide(queryClient); });
    toast.success(t('engagement.cardMenu.hidingCreatorToast', { author }), {
      action: {
        label: t('engagement.cardMenu.undo'),
        onClick: () => {
          unhideCreator(user, author).then((ok) => { if (ok) refreshRailsAfterHide(queryClient); });
          onDismiss?.("undo-creator", { owner: author });
        },
      },
    });
  };

  const onAddToPlaylist = () => {
    if (!isLoggedIn()) {
      toast.error(t('engagement.cardMenu.loginForPlaylists'));
      return;
    }
    setPlaylistOpen(true);
  };

  // Tagging broadcasts a signed custom_json, so it needs a logged-in account.
  const onAddTag = () => {
    if (!isLoggedIn() || !user) {
      toast.error(t('engagement.cardMenu.loginToTag'));
      return;
    }
    setTagOpen(true);
  };

  // The menu's content: two tiles, then the rows (07d). Shared by the popover
  // and the phone sheet.
  const items = (
    <>
      <div className="card-menu-tiles">
        <button type="button" role="menuitem" className="card-menu-tile" onClick={(e) => act(e, onAddToPlaylist)}>
          <Icon name="playlist_add" size={24} />
          <span>{t('engagement.cardMenu.addToPlaylist')}</span>
        </button>
        <button type="button" role="menuitem" className="card-menu-tile" onClick={(e) => act(e, onAddTag)}>
          <Icon name="sell" size={24} />
          <span>{t('engagement.cardMenu.addTag')}</span>
        </button>
      </div>
      <div className="card-menu-rows">
        <button type="button" role="menuitem" className="card-menu-row" onClick={(e) => act(e, onNotInterested)}>
          <Icon name="block" size={20} />
          <span>{t('engagement.cardMenu.notInterested')}</span>
        </button>
        <button type="button" role="menuitem" className="card-menu-row" onClick={(e) => act(e, onHideCreator)}>
          <Icon name="person_off" size={20} />
          <span>{t('engagement.cardMenu.dontShowCreator', { author })}</span>
        </button>
      </div>
    </>
  );

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`card-options-btn ${open ? "open" : ""} ${className}`}
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('engagement.cardMenu.moreOptions')}
        title={t('engagement.cardMenu.moreOptions')}
      >
        <Icon name="more_vert" size={18} />
      </button>

      {open && coords && !coords.sheet && createPortal(
        <div
          ref={menuRef}
          className={`card-options-menu ${coords.openUp ? "up" : ""}`}
          style={{ left: coords.left, top: coords.top }}
          role="menu"
          aria-label={t('engagement.cardMenu.moreOptions')}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {items}
        </div>,
        document.body
      )}

      {open && coords?.sheet && (
        // The sheet is portalled, but React events still bubble through this
        // component to the card: keep them from reaching the card's link.
        <span className="card-options-guard" onClick={(e) => e.stopPropagation()}>
        <Sheet open onClose={close} title={title || t('engagement.cardMenu.moreOptions')} width={440} className="card-options-sheet">
          <div
            ref={menuRef}
            className="card-options-menu card-options-menu--sheet"
            role="menu"
            aria-label={t('engagement.cardMenu.moreOptions')}
            onClick={(e) => e.stopPropagation()}
          >
            {items}
          </div>
        </Sheet>
        </span>
      )}

      {playlistOpen && (
        <AddToPlaylistModal
          isOpen={playlistOpen}
          onClose={() => setPlaylistOpen(false)}
          author={author}
          permlink={permlink}
          videoTitle={title}
        />
      )}

      {tagOpen && (
        <AddTagModal
          isOpen={tagOpen}
          onClose={() => setTagOpen(false)}
          author={author}
          permlink={permlink}
          title={title}
        />
      )}
    </>
  );
}

CardOptionsMenu.propTypes = {
  author: PropTypes.string.isRequired,
  permlink: PropTypes.string.isRequired,
  title: PropTypes.string,
  onDismiss: PropTypes.func,
  onOpenChange: PropTypes.func,
  className: PropTypes.string,
};

export default CardOptionsMenu;
