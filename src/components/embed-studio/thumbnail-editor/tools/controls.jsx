import React from 'react';
import { Button, Icon, Toggle as V2Toggle } from '../../../v2/ui';
import { renderIcon } from '../../../v2/helpers';

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

/**
 * A row of mutually exclusive buttons, drawn as the v2 segmented track.
 * options: [{ value, label, icon? }]; `icon` a Material Symbols name or a
 * component, shown alone with the label for screen readers.
 */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="v2-seg thumb-seg" role="radiogroup" aria-label={label}>
      {options.map(({ value: v, label: l, icon }) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          title={l}
          className={`v2-seg__opt h32 thumb-seg__btn${value === v ? ' is-on is-active' : ''}`}
          onClick={() => onChange(v)}
        >
          {icon ? renderIcon(icon, 18) : null}
          {icon ? <span className="thumb-sr">{l}</span> : l}
        </button>
      ))}
    </div>
  );
}

/** A v2 secondary button (36 tall); without children an icon button. `icon`: a Material Symbols name. */
export function ToolButton({ icon, children, onClick, disabled, title }) {
  return (
    <Button
      variant="secondary"
      size={36}
      icon={icon}
      className={`thumb-btn${children ? '' : ' thumb-btn--icon'}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={children ? undefined : title}
    >
      {children || null}
    </Button>
  );
}

export function Hint({ children }) {
  return <p className="thumb-hint">{children}</p>;
}

/** An on/off switch: the v2 toggle. */
export function Toggle({ id, checked, onChange, label }) {
  return <V2Toggle id={id} checked={!!checked} onChange={onChange} label={label} />;
}

// Paint for the thumbnail itself (drawn into the picture), not interface colours.
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
        {isPreset ? <Icon name="palette" size={18} /> : null}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={customLabel} />
      </label>
    </div>
  );
}
