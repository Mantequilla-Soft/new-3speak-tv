import React, { useState } from 'react';
import './SettingInfo.scss';
import { useTranslation } from 'react-i18next';
import DialogShell from '../modal/DialogShell';
import { Icon } from '../v2/ui';

/**
 * The (i) beside a setting's short description, holding the long explanation.
 *
 * Tiles only have room for a line or two, but several of these settings have
 * real consequences (NSFW hides a video from feeds, supporters-only cannot be
 * undone after upload), so the full wording has to stay reachable rather than
 * being cut.
 *
 * The explanation is a v2 dialog (DialogShell): centred on desktop, a bottom
 * sheet on phones, Escape closes only the topmost window.
 *
 * ⚠️ Every click inside stops propagation. A portal moves the DOM node to
 * <body>, but React still bubbles synthetic events through the REACT tree, so a
 * click in the dialog reaches the tile that renders this component — closing
 * the dialog would silently toggle whatever setting it was explaining. The
 * wrapper span below is the dialog's React parent and swallows those clicks.
 */
const stop = (e) => e.stopPropagation();

/**
 * The dialog on its own, so any setting that needs one (the schedule picker,
 * the payout choice, the guest list) gets the same behaviour as the info popup.
 */
// `side`: the 21c/17 settings sheet docked to the right on desktop (a bottom
// sheet on phones), with a `tone` bar before the title and a pinned `footer`.
export function SettingSheet({ title, open, onClose, children, side = false, tone, footer, width = 480 }) {
  if (!open) return null;
  return (
    <span className="setting-info__portal" onClick={stop}>
      <DialogShell open title={title} onClose={onClose} width={side ? 430 : width} className="setting-info__sheet" side={side} tone={tone} footer={footer}>
        {children}
      </DialogShell>
    </span>
  );
}

export default function SettingInfo({ title, children }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="setting-info__trigger"
        aria-label={t('upload.settingInfo.moreAbout', { title })}
        title={t('upload.settingInfo.moreAbout', { title })}
        onClick={(e) => {
          // Keep the tile from toggling: the (i) only explains.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        <Icon name="info" size={16} />
      </button>

      {open && (
        <span className="setting-info__portal" onClick={stop}>
          <DialogShell open title={title} onClose={() => setOpen(false)} width={440} className="setting-info__sheet">
            <div className="setting-info__body">{children}</div>
          </DialogShell>
        </span>
      )}
    </>
  );
}
