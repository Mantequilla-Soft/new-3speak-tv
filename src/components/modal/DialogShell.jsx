import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import useDialog from "../../hooks/useDialog";
import ModalHeader from "../ModalHeader/ModalHeader";
import { StepBar } from "../v2/ui";
import { cx } from "../v2/helpers";
import "./DialogShell.scss";

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The v2 dialog (design 07, STYLE_GUIDE §7) on the app's dialog stack: the
 * same markup and classes as <Dialog> from src/components/v2/ui.jsx (centred,
 * radius 28, title 18/700 with a round close button; a bottom sheet with a grab
 * handle under 768px), but Escape goes through useDialog, so it closes only the
 * topmost window when dialogs are stacked, and the head is the shared ModalHeader.
 *
 *   <DialogShell open onClose={close} title={t('…')} footer={<>…</>}>…</DialogShell>
 *
 * @param {boolean}   open        – render nothing when false (default true)
 * @param {function}  onClose     – X, Escape and backdrop click; omit for a prompt that must be answered
 * @param {boolean}   busy        – while saving: no X, no Escape, no backdrop close
 * @param {ReactNode} title, sub  – head title and an optional muted line under it
 * @param {ReactNode} leading     – control before the title (a wizard's Back)
 * @param {ReactNode} headExtra   – controls between the title and the X (a "1 / 2" counter)
 * @param {number}    steps, step – a StepBar under the head for multi-step flows (§11)
 * @param {ReactNode} footer      – actions, primary last (it sits on the right)
 * @param {number}    width       – desktop max width, 440 to 520 for most dialogs
 * @param {number}    zIndex      – over another layer that sits above 1000
 * @param {boolean}   side        – the 07/17 sheet: on desktop a full-height sheet docked to the
 *                                  right (page blurred behind it), head with a tone bar and a
 *                                  20/900 title, main action pinned full width at the bottom;
 *                                  a bottom sheet under 768px like every dialog
 * @param {string}    tone        – the bar before the title: 'accent' | 'cyan' | 'text' | 'muted'
 * @param {Document}  doc         – the document to portal into (usePortalDoc), default the page's
 * @param {boolean}   isolate     – stop clicks inside from bubbling up the React tree to
 *                                  whatever opened it (a card, a link, a hover preview)
 */
export default function DialogShell({
  open = true, onClose, busy = false, title, sub, leading, headExtra, steps, step = 0,
  footer, width = 480, zIndex, className, bodyClassName, overlayClassName, panelProps, doc, isolate = false, children,
  side = false, tone,
}) {
  const close = busy ? undefined : onClose;
  const panelRef = useRef(null);
  const { titleId, props: dialogProps } = useDialog(close, { active: open, ref: panelRef });
  const onCloseRef = useRef(close);
  useEffect(() => { onCloseRef.current = close; }, [close]);

  // Focus moves in on open, Tab wraps inside, and focus goes back on close.
  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const d = panel?.ownerDocument || document;
    const prev = d.activeElement;
    if (panel && !panel.contains(d.activeElement)) panel.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== "Tab" || !panel || !panel.contains(d.activeElement)) return;
      const els = [...panel.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && (d.activeElement === first || d.activeElement === panel)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && d.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    d.addEventListener("keydown", onKey);
    const overflow = d.body.style.overflow;
    d.body.style.overflow = "hidden";
    return () => {
      d.removeEventListener("keydown", onKey);
      d.body.style.overflow = overflow;
      if (prev?.isConnected && typeof prev.focus === "function") prev.focus({ preventScroll: true });
    };
  }, [open, panelRef]);

  if (!open) return null;
  const stop = isolate ? (e) => e.stopPropagation() : undefined;
  return createPortal(
    <div
      className={cx("v2-dialog", "dlg-shell", side && "is-side", overlayClassName)}
      role="presentation"
      style={zIndex ? { zIndex } : undefined}
      onMouseDown={(e) => { stop?.(e); if (e.target === e.currentTarget) onCloseRef.current?.(); }}
      onClick={stop}
      onPointerDown={stop}
      onTouchStart={stop}
    >
      <div
        className={cx("v2-dialog__panel", className)}
        tabIndex={-1}
        {...dialogProps}
        {...panelProps}
        style={{ "--w": `${width}px`, ...panelProps?.style }}
      >
        <div className="v2-dialog__grab" aria-hidden="true" />
        <ModalHeader title={title} sub={sub} titleId={titleId} onClose={close} leading={leading} tone={tone}>
          {headExtra}
        </ModalHeader>
        {steps > 1 && <div className="dlg-shell__steps"><StepBar steps={steps} current={step} /></div>}
        <div className={cx("v2-dialog__body", bodyClassName)}>{children}</div>
        {footer && <div className="v2-dialog__foot">{footer}</div>}
      </div>
    </div>,
    (doc || document).body,
  );
}

/**
 * "Context first" (07, 17): the card at the top of a sheet that shows what you
 * act on: a video (16:9 thumb), a creator (avatar) or an amount.
 *   <SheetContext thumb={url} title="…" meta="@author · 3:12" />
 *   <SheetContext avatar={<Avatar … />} title="@name" meta="for …" />
 */
export function SheetContext({ thumb, avatar, title, meta, trailing, className }) {
  return (
    <div className={cx("dlg-ctx", className)}>
      {avatar ?? (
        <span className="dlg-ctx__thumb" aria-hidden="true">
          {thumb ? <img src={thumb} alt="" loading="lazy" /> : null}
        </span>
      )}
      <span className="dlg-ctx__body">
        <b className="dlg-ctx__title">{title}</b>
        {meta && <span className="dlg-ctx__meta">{meta}</span>}
      </span>
      {trailing}
    </div>
  );
}
