import React from 'react';
import { Palette } from 'lucide-react';

// The small building blocks every tool panel is made of, so new tools look
// like the existing ones without new CSS.

/** One labelled row: label left, control(s) right (stacked on phones). */
export function Field({ label, value, children, htmlFor }) {
  return (
    <div className="thumb-field">
      {htmlFor
        ? <label className="thumb-field__label" htmlFor={htmlFor}>{label}</label>
        : <span className="thumb-field__label">{label}</span>}
      <div className="thumb-field__control">
        {children}
        {value != null && <span className="thumb-field__value">{value}</span>}
      </div>
    </div>
  );
}

export function Slider({ id, min, max, step = 1, value, onChange, label }) {
  return (
    <input
      id={id}
      className="thumb-slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/** A row of mutually exclusive buttons. options: [{ value, label, icon? }] */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="thumb-seg" role="radiogroup" aria-label={label}>
      {options.map(({ value: v, label: l, icon: Icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          title={l}
          className={`thumb-seg__btn${value === v ? ' is-active' : ''}`}
          onClick={() => onChange(v)}
        >
          {Icon ? <Icon size={16} aria-hidden="true" /> : null}
          {Icon ? <span className="thumb-sr">{l}</span> : l}
        </button>
      ))}
    </div>
  );
}

export function ToolButton({ icon: Icon, children, onClick, disabled, title }) {
  return (
    <button
      type="button"
      className={`thumb-btn${children ? '' : ' thumb-btn--icon'}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={children ? undefined : title}
    >
      {Icon ? <Icon size={15} aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Hint({ children }) {
  return <p className="thumb-hint">{children}</p>;
}

/** An on/off switch. */
export function Toggle({ id, checked, onChange, label }) {
  return (
    <label className={`thumb-toggle${checked ? ' is-on' : ''}`} htmlFor={id}>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span className="thumb-toggle__track" aria-hidden="true"><span className="thumb-toggle__knob" /></span>
    </label>
  );
}

const SWATCHES = ['#ffffff', '#111111', '#ffd600', '#e53935', '#2196f3', '#43a047'];

/** Preset swatches plus "any colour" (the native picker behind a palette icon). */
export function ColorPicker({ value, onChange, customLabel }) {
  const current = String(value || '').toLowerCase();
  const isPreset = SWATCHES.includes(current);
  return (
    <div className="thumb-swatches">
      {SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          className={`thumb-swatch${current === c ? ' is-active' : ''}`}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
          title={c}
        />
      ))}
      <label
        className={`thumb-swatch thumb-swatch--custom${isPreset ? '' : ' is-active'}`}
        title={customLabel}
        style={isPreset ? undefined : { background: value }}
      >
        {isPreset ? <Palette size={15} aria-hidden="true" /> : null}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={customLabel} />
      </label>
    </div>
  );
}
