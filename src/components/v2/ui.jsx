// 3Speak v2 UI primitives. Every screen is built from these; their look lives
// in src/styles/design-system.scss (the .v2-* classes), so markup that can't
// use a component can use the same classes directly.
//
// `icon` props take either a Material Symbols name ("share") or a component
// (Icon.of("share"), or any component that accepts `size`).
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { cx, renderIcon } from "./helpers";
import { useEscapeLayer } from "../../hooks/useDialog";

export { Icon };

/* ---------- Text ---------- */
export const Eyebrow = ({ children, tone, className, as: El = "div", ...rest }) => (
  <El className={cx("v2-eyebrow", tone && `is-${tone}`, className)} {...rest}>{children}</El>
);
export const Num = ({ children, className, money }) => <span className={cx(money ? "money" : "num", className)}>{children}</span>;

/* ---------- Buttons ----------
   variant: primary (red fill) | cyan | secondary (surface-2) | ghost | danger (red tint) | inverse (text fill) | media (over video)
   size: 24 | 28 | 32 | 36 | 40 | 44 | 48 | 56 | 64. Labels sit flush left; `next` adds a trailing arrow.
   Pass `as="a"` / `as={Link}` for links that look like buttons. */
export function Button({ variant = "secondary", size = 40, block, next, center, icon, trailing, children, className, as: El = "button", type, loading, ...rest }) {
  const iconSize = size <= 32 ? 16 : 18;
  return (
    <El
      className={cx("v2-btn", `v2-btn--${variant}`, `h${size}`, block && "is-block", next && "is-next", center && "is-center", className)}
      type={El === "button" ? (type || "button") : type}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Icon name="progress_activity" size={iconSize} className="v2-spin" /> : renderIcon(icon, iconSize)}
      {children != null && children !== false && <span className="v2-btn__label">{children}</span>}
      {next ? <Icon name="arrow_forward" size={16} /> : renderIcon(trailing, iconSize)}
    </El>
  );
}
export const IconButton = ({ icon, label, size = 36, variant = "secondary", round, className, fill, as: El = "button", type, ...rest }) => (
  <El className={cx("v2-iconbtn", `v2-btn--${variant}`, `h${size}`, round && "is-round", className)} aria-label={label} title={label}
    type={El === "button" ? (type || "button") : type} {...rest}>
    {typeof icon === "string" ? <Icon name={icon} size={size <= 32 ? 16 : 20} fill={fill} /> : renderIcon(icon, size <= 32 ? 16 : 18)}
  </El>
);

/* ---------- Chips and tabs ---------- */
export const Chip = ({ selected, children, count, icon, tone, size = 32, className, ...rest }) => (
  <button type="button" className={cx("v2-chip", selected && "is-on", tone && `is-${tone}`, size === 28 && "h28", className)} aria-pressed={!!selected} {...rest}>
    {renderIcon(icon, 16)}{children}{count != null && <span className="v2-chip__n">{count}</span>}
  </button>
);

// Segmented: a track with one selected option. Use for 2 to 5 short options, and for ALL tabs.
export function Segmented({ options, value, onChange, size = 32, block = true, scroll, label, className }) {
  return (
    <div className={cx("v2-seg", block && "is-block", scroll && "is-scroll", className)} role="tablist" aria-label={label}>
      {options.map(o => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        const on = opt.value === value;
        return (
          <button type="button" key={opt.value} role="tab" aria-selected={on} disabled={opt.disabled}
            className={cx("v2-seg__opt", `h${size}`, on && "is-on")} onClick={() => onChange?.(opt.value)}>
            {renderIcon(opt.icon, 16)}{opt.label}{opt.count != null && <span className="v2-seg__n">{opt.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Forms ---------- */
export function Field({ label, hint, error, optional, optionalLabel = "optional", children, as = "input", className, id: idProp, ...rest }) {
  const autoId = useId();
  const id = idProp || autoId;
  const Ctl = as;
  return (
    <div className={cx("v2-field", error && "is-error", className)}>
      {label && <label htmlFor={id} className="v2-eyebrow">{label}{optional && <span className="v2-field__opt"> · {optionalLabel}</span>}</label>}
      {children ?? <Ctl id={id} className={cx("v2-input", as === "textarea" && "is-area", as === "select" && "is-select")} aria-invalid={!!error} {...rest} />}
      {error ? <div className="v2-field__err" role="alert">{error}</div> : hint && <div className="v2-field__hint">{hint}</div>}
    </div>
  );
}

// ChoiceCard: radio-like tile with a 2px border. tone: accent (default) | cyan.
export const ChoiceCard = ({ selected, icon, title, sub, tone = "accent", onClick, children, disabled, role = "radio", className }) => (
  <button type="button" role={role} aria-checked={!!selected} disabled={disabled} className={cx("v2-choice", `is-${tone}`, selected && "is-on", className)} onClick={onClick}>
    {renderIcon(icon, 20, { className: "v2-choice__icon" })}
    <span className="v2-choice__body"><b>{title}</b>{sub && <span>{sub}</span>}{children}</span>
  </button>
);

export const Toggle = ({ checked, onChange, label, disabled, id }) => (
  <button type="button" role="switch" id={id} aria-checked={!!checked} aria-label={label} disabled={disabled}
    className={cx("v2-toggle", checked && "is-on")} onClick={() => onChange?.(!checked)}>
    <span className="v2-toggle__thumb" />
  </button>
);

// SettingRow: a title, a description, and a control on the right. Used for every settings toggle.
export const SettingRow = ({ title, sub, control, icon, className }) => (
  <div className={cx("v2-setting", className)}>
    {icon && <span className="v2-setting__icon">{renderIcon(icon, 18)}</span>}
    <div className="v2-setting__body"><b>{title}</b>{sub && <span>{sub}</span>}</div>
    {control}
  </div>
);

export const Checkbox = ({ label, className, ...rest }) => (
  <label className={cx("v2-check", className)}><input type="checkbox" {...rest} />{label && <span>{label}</span>}</label>
);

/* ---------- Surfaces ---------- */
export const Card = ({ as: El = "div", radius = 24, pad, dense, large, className, children, style, ...rest }) => (
  <El className={cx("v2-card", radius !== 24 && `r${radius}`, dense && "is-dense", large && "is-large", className)}
    style={pad != null ? { padding: pad, ...style } : style} {...rest}>{children}</El>
);
export const Well = ({ className, children, ...rest }) => <div className={cx("v2-well", className)} {...rest}>{children}</div>;

// Banner: inline notice. tone: info (cyan) | warn (accent) | neutral
export const Banner = ({ tone = "info", icon, title, children, action, className }) => (
  <div className={cx("v2-banner", `is-${tone}`, className)} role={tone === "warn" ? "alert" : "status"}>
    {renderIcon(icon ?? (tone === "warn" ? "warning" : tone === "info" ? "info" : null), 18, { className: "v2-banner__icon" })}
    <div className="v2-banner__body">{title && <b>{title}</b>} {children}</div>
    {action}
  </div>
);

// StatusPill: small uppercase status. tone: accent | cyan | muted | live | media
export const StatusPill = ({ tone = "muted", children, icon, className }) => (
  <span className={cx("v2-pill", `is-${tone}`, className)}>{renderIcon(icon, 12)}{children}</span>
);

export const StatTile = ({ label, value, sub, money, className }) => (
  <div className={cx("v2-stat", money && "is-money", className)}><div className="v2-stat__l">{label}</div><b className="num">{value}</b>{sub && <div className="v2-stat__s">{sub}</div>}</div>
);

export const Progress = ({ value = 0, tone = "accent", label, thin }) => (
  <div className={cx("v2-progress", thin && "is-thin")} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
    <span className={`is-${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
  </div>
);

// StepBar: 4px segments on top of a multi-step dialog (accent = done or current)
export const StepBar = ({ steps, current }) => (
  <div className="v2-steps" aria-hidden>{Array.from({ length: steps }, (_, i) => <span key={i} className={cx(i <= current && "is-on")} />)}</div>
);

// StepList: async work. items: [{ label, state: 'done' | 'current' | 'next' }]
export const StepList = ({ items }) => (
  <ul className="v2-steplist">
    {items.map((it, i) => (
      <li key={i} className={cx(it.state === "current" && "is-current", it.state === "done" && "is-done")}>
        <Icon name={it.state === "done" ? "check" : it.state === "current" ? "progress_activity" : "radio_button_unchecked"} size={18} />
        <span>{it.label}</span>
      </li>
    ))}
  </ul>
);

export const Avatar = ({ src, name = "", size = 32, square, ring, alt = "", className }) => (
  <span className={cx("v2-avatar", square && "is-square", ring && `ring-${ring}`, className)} style={{ width: size, height: size, fontSize: Math.round(size * .38) }}>
    {src ? <img src={src} alt={alt} loading="lazy" /> : String(name).slice(0, 1).toUpperCase()}
  </span>
);

export const Thumb = ({ src, ratio = "16/9", children, radius = 12, alt = "", playing, className }) => (
  <div className={cx("v2-thumb", `r${radius}`, playing && "is-playing", className)} style={{ aspectRatio: ratio }}>{src && <img src={src} alt={alt} loading="lazy" />}{children}</div>
);

// DockTile: the action tile grid under the player (vote, comment, tip, save, share…)
export const DockTile = ({ icon, label, active, tone = "accent", fill, className, ...rest }) => (
  <button type="button" className={cx("v2-dock", active && `is-on is-${tone}`, className)} aria-pressed={active ?? undefined} {...rest}>
    {typeof icon === "string" ? <Icon name={icon} size={22} fill={fill ?? active} /> : renderIcon(icon, 22)}
    <span>{label}</span>
  </button>
);

export const EmptyState = ({ icon, title, children, action, className }) => (
  <div className={cx("v2-empty", className)}>{renderIcon(icon, 28)}<b>{title}</b>{children && <p>{children}</p>}{action}</div>
);

/* ---------- Overlays ----------
   Dialog: centered on desktop (>= 768px), bottom sheet on mobile. One component, CSS decides.
   Traps focus, closes on Esc and on a backdrop click, renders in a portal. */
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
export function Dialog({ open, onClose, title, sub, children, footer, width = 440, closeLabel = "Close", className, bodyClassName, head = true, dismissible = true, leading, backdropClose = true, zIndex }) {
  const ref = useRef(null);
  // Escape closes only the topmost open dialog (shared layer stack with useDialog/ModalHeader).
  useEscapeLayer(ref, onClose, { active: Boolean(open && dismissible && onClose) });
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === "Tab" && ref.current) {
        const els = [...ref.current.querySelectorAll(FOCUSABLE)];
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    ref.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (prev && prev.focus) prev.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="v2-dialog" role="presentation" style={zIndex != null ? { zIndex } : undefined} onMouseDown={e => dismissible && backdropClose /* false: only X and Esc close it (a decision dialog) */ && e.target === e.currentTarget && onClose?.()}>
      <div className={cx("v2-dialog__panel", className)} role="dialog" aria-modal="true" data-dialog="" aria-label={typeof title === "string" ? title : undefined} tabIndex={-1} ref={ref} style={{ "--w": `${width}px` }}>
        <div className="v2-dialog__grab" aria-hidden />
        {head && (
          <div className="v2-dialog__head">
            {leading /* optional: a back button before the title (multi-view dialogs) */}
            <h2>{title}{sub && <span className="v2-dialog__sub">{sub}</span>}</h2>
            {onClose && dismissible && <IconButton icon="close" label={closeLabel} size={32} variant="ghost" round onClick={onClose} />}
          </div>
        )}
        <div className={cx("v2-dialog__body", bodyClassName)}>{children}</div>
        {footer && <div className="v2-dialog__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
export const Sheet = Dialog;

// ConfirmBar: small confirmations as a bottom bar, not a modal (07f)
export const ConfirmBar = ({ children, actions }) => <div className="v2-confirmbar" role="alertdialog">{children}<div className="v2-confirmbar__actions">{actions}</div></div>;

// Island: the top toast (07f).
export const Island = ({ icon, children, action, tone = "neutral" }) => (
  <div className={cx("v2-island", `is-${tone}`)} role="status">{renderIcon(icon, 18)}<span>{children}</span>{action}</div>
);

// Menu: a popover card of rows. Position it yourself (absolute/fixed).
export const Menu = ({ children, className, style, ...rest }) => <div className={cx("v2-menu", className)} role="menu" style={style} {...rest}>{children}</div>;
export const MenuRow = ({ icon, children, danger, on, as: El = "button", className, ...rest }) => (
  <El role="menuitem" className={cx("v2-menu__row", danger && "is-danger", on && "is-on", className)} type={El === "button" ? "button" : undefined} {...rest}>
    {renderIcon(icon, 18)}<span>{children}</span>
  </El>
);
