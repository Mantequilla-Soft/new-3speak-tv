import { useEffect, useLayoutEffect, useRef } from "react";
import { useEscapeLayer } from "../../hooks/useDialog";
import { useTranslation } from "react-i18next";
import { Icon } from "../v2/Icon";
import "./ModalHeader.scss";

// A box reads as a dialog by its role or its class name (modal, sheet, prompt…),
// or by the overlay it sits in. Panels that only borrow the header (a comments
// column, a menu, a dropdown) match none of these and keep their own frame.
const DIALOG_NAME = /modal|dialog|sheet|popup|prompt|chooser|popover/i;
const SCRIM_NAME = /overlay|backdrop|modal|dialog|sheet/i;
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const looksLikeDialog = (el, re) => !!el && (
  el.getAttribute("role") === "dialog" || el.hasAttribute("data-dialog") || re.test(el.getAttribute("class") || "")
);

/**
 * The v2 dialog frame for every box that uses this header (STYLE_GUIDE §7):
 * when the box sits directly in a fixed, full-screen overlay, it is marked
 * `data-v2-dialog` (and the overlay `data-v2-scrim`), and
 * src/components/modal/_modal-base.scss turns it into the v2 dialog: surface,
 * radius 28, 1px border, sheet shadow, and a bottom sheet with a grab handle
 * under 768px. The marked box also gets a focus trap: focus moves in on open,
 * Tab wraps inside it, and focus goes back where it was on close.
 * Boxes already built on the v2 dialog classes (.v2-dialog__panel) are skipped.
 */
function useDialogFrame(ref) {
  const marked = useRef(null);

  // Runs after every render: a box that is kept mounted and only shown later
  // (display:none first) is picked up the first time it is really on screen.
  useLayoutEffect(() => {
    if (marked.current) return;
    const box = ref.current?.parentElement;
    if (!box || box.closest(".v2-dialog__panel")) return;
    const scrim = box.parentElement;
    if (!scrim || scrim === document.body || typeof window.getComputedStyle !== "function") return;
    if (window.getComputedStyle(scrim).position !== "fixed") return;
    const sr = scrim.getBoundingClientRect();
    if (sr.width < window.innerWidth * 0.9 || sr.height < window.innerHeight * 0.9) return;
    if (!looksLikeDialog(box, DIALOG_NAME) && !looksLikeDialog(scrim, SCRIM_NAME)) return;
    // Full-screen editors (a box as big as the window on a desktop) keep their frame.
    const br = box.getBoundingClientRect();
    if (window.innerWidth >= 768 && br.width >= window.innerWidth * 0.96 && br.height >= window.innerHeight * 0.96) return;
    const bg = window.getComputedStyle(scrim).backgroundColor;
    box.setAttribute("data-v2-dialog", "");
    scrim.setAttribute("data-v2-scrim", bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)" ? "fill" : "");
    marked.current = { box, prev: document.activeElement };
    // Focus moves into the dialog (unless something inside already has it).
    if (!box.contains(document.activeElement)) {
      if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "-1");
      box.focus({ preventScroll: true });
    }
  });

  // Tab wraps inside the marked box; on close, focus goes back where it was.
  useEffect(() => {
    const onKey = (e) => {
      const box = marked.current?.box;
      if (e.key !== "Tab" || !box || !box.contains(document.activeElement)) return;
      const els = [...box.querySelectorAll(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const frame = marked.current;
      if (!frame) return;
      const active = document.activeElement;
      const lost = !active || active === document.body || frame.box.contains(active);
      if (lost && frame.prev?.isConnected && typeof frame.prev.focus === "function") frame.prev.focus({ preventScroll: true });
    };
  }, []);
}

/**
 * The one header every modal / bottom sheet uses: the v2 dialog head. Title
 * (18/700) on the left, a round close button on the right. Drop it in as the
 * first child of the dialog box; the box gets the v2 dialog frame by itself
 * (see useDialogFrame above), or build the box on DialogShell
 * (src/components/modal/DialogShell.jsx) for the full v2 dialog.
 * @param {ReactNode} title     – heading text (or node)
 * @param {ReactNode} sub       – optional muted line under the title
 * @param {function}  onClose   – close handler; the X is hidden without it
 * @param {ReactNode} leading   – optional control before the title (a wizard's back button)
 * @param {ReactNode} children  – optional extra controls, shown before the X
 * @param {string}    className – extra class for per-modal spacing tweaks
 * @param {string}    titleId   – id for the heading, for aria-labelledby
 * @param {boolean}   closeOnEscape – Escape runs onClose (default). Pass false
 *                    where the window handles Escape itself (editors, menus).
 *                    Inside a useDialog box the box owns Escape, not the header.
 */
export default function ModalHeader({ title, sub, onClose, leading, children, className = "", titleId, closeOnEscape = true }) {
  const { t } = useTranslation();
  const ref = useRef(null);
  useEscapeLayer(ref, onClose, { active: Boolean(onClose) && closeOnEscape, skipInsideDialog: true });
  useDialogFrame(ref);
  return (
    <div ref={ref} className={`app-modal-header ${className}`.trim()}>
      <span className="app-modal-header-grab" aria-hidden="true" />
      {leading}
      {sub ? (
        <div className="app-modal-header-text">
          <h2 className="app-modal-header-title" id={titleId}>{title}</h2>
          <p className="app-modal-header-sub">{sub}</p>
        </div>
      ) : (
        <h2 className="app-modal-header-title" id={titleId}>{title}</h2>
      )}
      {children}
      {onClose && (
        <button type="button" className="app-modal-header-close" onClick={onClose} aria-label={t('common.actions.close')}>
          <Icon name="close" size={20} />
        </button>
      )}
    </div>
  );
}
