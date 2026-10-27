import { IoClose } from "react-icons/io5";
import { useTranslation } from "react-i18next";
import "./ModalHeader.scss";

/**
 * The one header every modal / bottom sheet uses: title on the left, close X on
 * the right, a divider line under it. Drop it in as the first child of the
 * dialog box.
 * @param {ReactNode} title     – heading text (or node)
 * @param {function}  onClose   – close handler; the X is hidden without it
 * @param {ReactNode} leading   – optional control before the title (a wizard's back button)
 * @param {ReactNode} children  – optional extra controls, shown before the X
 * @param {string}    className – extra class for per-modal spacing tweaks
 * @param {string}    titleId   – id for the heading, for aria-labelledby
 */
export default function ModalHeader({ title, onClose, leading, children, className = "", titleId }) {
  const { t } = useTranslation();
  return (
    <div className={`app-modal-header ${className}`.trim()}>
      {leading}
      <h2 className="app-modal-header-title" id={titleId}>{title}</h2>
      {children}
      {onClose && (
        <button type="button" className="app-modal-header-close" onClick={onClose} aria-label={t('common.actions.close')}>
          <IoClose size={20} />
        </button>
      )}
    </div>
  );
}
