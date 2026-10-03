import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import './SettingInfo.scss';
import { useTranslation } from 'react-i18next';

/**
 * The (i) beside a setting's short description, holding the long explanation.
 *
 * Tiles only have room for a line or two, but several of these settings have
 * real consequences (NSFW hides a video from feeds, supporters-only cannot be
 * undone after upload), so the full wording has to stay reachable rather than
 * being cut.
 *
 * Rendered through a portal: the tiles sit inside a bordered panel with its own
 * stacking context, so an inline popover would be clipped by it. On phones it
 * comes up as a bottom sheet, matching the rest of the app's dialogs.
 *
 * ⚠️ Every click inside stops propagation. A portal moves the DOM node to
 * <body>, but React still bubbles synthetic events through the REACT tree, so a
 * click on the overlay reaches the tile that renders this component — closing
 * the dialog would silently toggle whatever setting it was explaining.
 */

/**
 * The portal + overlay + sheet on its own, so any setting that needs a dialog
 * (the schedule picker, for one) gets the same behaviour as the info popup:
 * centred on desktop, a bottom sheet on phones, Escape to close, background
 * locked while open.
 */
export function SettingSheet({ title, open, onClose, children }) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="setting-info__overlay" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div
        className="setting-info__sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="setting-info__head">
          <strong>{title}</strong>
          <button type="button" aria-label={t('common.actions.close')} onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
        </div>
        <div className="setting-info__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export default function SettingInfo({ title, children }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  // Escape closes it, and the background must not scroll underneath a sheet.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className="setting-info__trigger"
        aria-label={t('upload.settingInfo.moreAbout', { title })}
        title={t('upload.settingInfo.moreAbout', { title })}
        onClick={(e) => {
          // The tile itself is not clickable today, but stop this anyway so the
          // (i) never doubles as a toggle if that changes.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        i
      </button>

      {open && createPortal(
        <div className="setting-info__overlay" onClick={(e) => { e.stopPropagation(); setOpen(false); }}>
          <div
            className="setting-info__sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="setting-info__head">
              <strong>{title}</strong>
              <button type="button" aria-label={t('common.actions.close')} onClick={(e) => { e.stopPropagation(); setOpen(false); }}>×</button>
            </div>
            <div className="setting-info__body">{children}</div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
