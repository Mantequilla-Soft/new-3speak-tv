import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { MdPlaylistAdd, MdMoreVert } from "react-icons/md";
import { IoBanOutline, IoEyeOffOutline, IoPricetagOutline } from "react-icons/io5";
import { toastIn } from '../../utils/toast';
import PropTypes from "prop-types";
import { isLoggedIn } from "../../hive-api/aioha";
import { useAppStore } from "../../lib/store";
import AddToPlaylistModal from "../AddToPlaylistModal/AddToPlaylistModal";
import AddTagModal from "../AddTagModal/AddTagModal";
import { hideVideo, unhideVideo, hideCreator, unhideCreator } from "../../utils/userFilters";
import "./CardOptionsMenu.scss";

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

/**
 * The "⋮" menu on a thumbnail card. It replaces the old bare add-to-playlist
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
    if (!open) return undefined;
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
  }, [open, close]);

  const toggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) return close();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const MENU_W = 232;
      // Flip left/up when we'd overflow the viewport.
      const left = Math.min(r.left, window.innerWidth - MENU_W - 8);
      const openUp = window.innerHeight - r.bottom < 180;
      setCoords({ left: Math.max(8, left), top: openUp ? r.top - 8 : r.bottom + 6, openUp });
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
    hideCreator(user, author);
    toast.success(t('engagement.cardMenu.hidingCreatorToast', { author }), {
      action: {
        label: t('engagement.cardMenu.undo'),
        onClick: () => {
          unhideCreator(user, author);
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

  return (
    <>
      <button
        ref={btnRef}
        className={`card-options-btn ${open ? "open" : ""} ${className}`}
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t('engagement.cardMenu.moreOptions')}
      >
        <MdMoreVert size={20} />
      </button>

      {open && coords && createPortal(
        <div
          ref={menuRef}
          className={`card-options-menu ${coords.openUp ? "up" : ""}`}
          style={{ left: coords.left, top: coords.top }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button role="menuitem" onClick={(e) => act(e, onAddToPlaylist)}>
            <MdPlaylistAdd size={19} /> {t('engagement.cardMenu.addToPlaylist')}
          </button>
          <button role="menuitem" onClick={(e) => act(e, onAddTag)}>
            <IoPricetagOutline size={17} /> {t('engagement.cardMenu.addTag')}
          </button>
          <button role="menuitem" onClick={(e) => act(e, onNotInterested)}>
            <IoEyeOffOutline size={17} /> {t('engagement.cardMenu.notInterested')}
          </button>
          <button role="menuitem" onClick={(e) => act(e, onHideCreator)}>
            <IoBanOutline size={17} /> {t('engagement.cardMenu.dontShowCreator', { author })}
          </button>
        </div>,
        document.body
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
