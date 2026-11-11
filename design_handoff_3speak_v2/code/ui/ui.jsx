// 3Speak v2 UI primitives: a reference implementation.
// React 19, no dependencies beyond lucide-react (already in package.json).
// Each primitive matches what the design files draw inline. Build screens
// from these instead of restyling one-off markup.
import { useEffect, useId, useRef } from "react";
import { ArrowRight, X } from "lucide-react";
import "./ui.scss";

const cx = (...a) => a.filter(Boolean).join(" ");

/* ---------- Text ---------- */
export const Eyebrow = ({ children, tone, className }) => (
  <div className={cx("v2-eyebrow", tone && `is-${tone}`, className)}>{children}</div>
);
export const Num = ({ children, className }) => <span className={cx("num", className)}>{children}</span>;

/* ---------- Buttons ----------
   variant: primary (red fill) | cyan | secondary (surface-2) | ghost | danger (red tint) | inverse (text fill)
   size: 28 | 32 | 36 | 40 | 44 | 48 | 56. Labels sit flush left; `next` adds a trailing arrow. */
export function Button({ variant = "secondary", size = 40, block, next, icon: Icon, children, className, ...rest }) {
  return (
    <button className={cx("v2-btn", `v2-btn--${variant}`, `h${size}`, block && "is-block", next && "is-next", className)} {...rest}>
      {Icon && <Icon size={size <= 32 ? 14 : 16} aria-hidden />}
      <span className="v2-btn__label">{children}</span>
      {next && <ArrowRight size={16} aria-hidden />}
    </button>
  );
}
export const IconButton = ({ icon: Icon, label, size = 36, variant = "secondary", ...rest }) => (
  <button className={cx("v2-iconbtn", `v2-btn--${variant}`, `h${size}`)} aria-label={label} title={label} {...rest}>
    <Icon size={size <= 32 ? 16 : 18} aria-hidden />
  </button>
);

/* ---------- Chips and tabs ---------- */
export const Chip = ({ selected, children, count, ...rest }) => (
  <button className={cx("v2-chip", selected && "is-on")} aria-pressed={!!selected} {...rest}>
    {children}{count != null && <span className="v2-chip__n">{count}</span>}
  </button>
);

// Segmented: a track with one selected option. Use for 2 to 5 short options, and for in-card tabs.
export function Segmented({ options, value, onChange, size = 32, block = true, label }) {
  return (
    <div className={cx("v2-seg", block && "is-block")} role="tablist" aria-label={label}>
      {options.map(o => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        const on = opt.value === value;
        return (
          <button key={opt.value} role="tab" aria-selected={on} className={cx("v2-seg__opt", `h${size}`, on && "is-on")} onClick={() => onChange?.(opt.value)}>
            {opt.label}{opt.count != null && <span className="v2-seg__n">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Forms ---------- */
export function Field({ label, hint, error, optional, children, as = "input", ...rest }) {
  const id = useId();
  const Ctl = as;
  return (
    <div className={cx("v2-field", error && "is-error")}>
      {label && <label htmlFor={id} className="v2-eyebrow">{label}{optional && <span className="v2-field__opt"> · optional</span>}</label>}
      {children ?? <Ctl id={id} className={cx("v2-input", as === "textarea" && "is-area")} aria-invalid={!!error} {...rest} />}
      {error ? <div className="v2-field__err" role="alert">{error}</div> : hint && <div className="v2-field__hint">{hint}</div>}
    </div>
  );
}

// ChoiceCard: radio-like tile with a 2px border. tone: accent (default) | cyan.
export const ChoiceCard = ({ selected, icon: Icon, title, sub, tone = "accent", onClick, children }) => (
  <button type="button" role="radio" aria-checked={!!selected} className={cx("v2-choice", `is-${tone}`, selected && "is-on")} onClick={onClick}>
    {Icon && <Icon size={20} aria-hidden className="v2-choice__icon" />}
    <span className="v2-choice__body"><b>{title}</b>{sub && <span>{sub}</span>}{children}</span>
  </button>
);

export const Toggle = ({ checked, onChange, label, disabled }) => (
  <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled}
    className={cx("v2-toggle", checked && "is-on")} onClick={() => onChange?.(!checked)}>
    <span className="v2-toggle__thumb" />
  </button>
);

// SettingRow: a title, a description, and a control on the right. Used for every settings toggle.
export const SettingRow = ({ title, sub, control, icon: Icon }) => (
  <div className="v2-setting">
    {Icon && <span className="v2-setting__icon"><Icon size={18} aria-hidden /></span>}
    <div className="v2-setting__body"><b>{title}</b>{sub && <span>{sub}</span>}</div>
    {control}
  </div>
);

/* ---------- Surfaces ---------- */
export const Card = ({ as: El = "div", radius = 24, pad = 16, className, children, ...rest }) => (
  <El className={cx("v2-card", `r${radius}`, className)} style={{ padding: pad }} {...rest}>{children}</El>
);
export const Well = ({ className, children, ...rest }) => <div className={cx("v2-well", className)} {...rest}>{children}</div>;

// Banner: inline notice. tone: info (cyan) | warn (accent) | neutral
export const Banner = ({ tone = "info", icon: Icon, title, children, action }) => (
  <div className={cx("v2-banner", `is-${tone}`)} role={tone === "warn" ? "alert" : "status"}>
    {Icon && <Icon size={18} aria-hidden className="v2-banner__icon" />}
    <div className="v2-banner__body">{title && <b>{title}</b>} {children}</div>
    {action}
  </div>
);

// StatusPill: small uppercase status. tone: accent | cyan | muted | live
export const StatusPill = ({ tone = "muted", children }) => <span className={cx("v2-pill", `is-${tone}`)}>{children}</span>;

export const StatTile = ({ label, value, sub }) => (
  <div className="v2-stat"><div className="v2-stat__l">{label}</div><b className="num">{value}</b>{sub && <div className="v2-stat__s">{sub}</div>}</div>
);

export const Progress = ({ value = 0, tone = "accent", label }) => (
  <div className="v2-progress" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
    <span className={`is-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

export const Avatar = ({ src, name = "", size = 32, square, ring }) => (
  <span className={cx("v2-avatar", square && "is-square", ring && `ring-${ring}`)} style={{ width: size, height: size, fontSize: Math.round(size * .38) }}>
    {src ? <img src={src} alt="" /> : name.slice(0, 1).toUpperCase()}
  </span>
);

export const Thumb = ({ src, ratio = "16/9", children, radius = 12 }) => (
  <div className={cx("v2-thumb", `r${radius}`)} style={{ aspectRatio: ratio }}>{src && <img src={src} alt="" />}{children}</div>
);

// DockTile: the action tile grid under the player (vote, comment, tip, save, share…)
export const DockTile = ({ icon: Icon, label, active, tone = "accent", ...rest }) => (
  <button className={cx("v2-dock", active && `is-on is-${tone}`)} {...rest}><Icon size={22} aria-hidden /><span>{label}</span></button>
);

export const EmptyState = ({ icon: Icon, title, children, action }) => (
  <div className="v2-empty">{Icon && <Icon size={28} aria-hidden />}<b>{title}</b>{children && <p>{children}</p>}{action}</div>
);

/* ---------- Overlays ----------
   Dialog: centered on desktop (>= 768px), bottom sheet on mobile. One component, CSS decides. */
export function Dialog({ open, onClose, title, children, footer, width = 440 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = e => e.key === "Escape" && onClose?.();
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="v2-dialog" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose?.()}>
      <div className="v2-dialog__panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} style={{ "--w": `${width}px` }}>
        <div className="v2-dialog__grab" aria-hidden />
        <div className="v2-dialog__head"><b>{title}</b><IconButton icon={X} label="Close" size={32} variant="ghost" onClick={onClose} /></div>
        <div className="v2-dialog__body">{children}</div>
        {footer && <div className="v2-dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ConfirmBar: small confirmations as a bottom bar, not a modal (07f)
export const ConfirmBar = ({ children, actions }) => <div className="v2-confirmbar" role="alertdialog">{children}<div className="v2-confirmbar__actions">{actions}</div></div>;

// Island: the top toast (07f). Pair with sonner/react-toastify via a custom renderer.
export const Island = ({ icon: Icon, children, action, tone = "neutral" }) => (
  <div className={cx("v2-island", `is-${tone}`)} role="status">{Icon && <Icon size={18} aria-hidden />}<span>{children}</span>{action}</div>
);
