/**
 * Keyboard for a media timeline drawn as a slider (the video scrubber, the audio
 * waveform and the audio progress bar): the keys a screen reader user expects of
 * role="slider" (WAI-ARIA slider pattern).
 *
 *   ArrowLeft / ArrowDown   step back (5 s)
 *   ArrowRight / ArrowUp    step forward
 *   PageDown / PageUp       10 % of the length back / forward
 *   Home / End              the start / the end
 *
 * seekKeyTarget() answers the new time in seconds for a key, or null when the key
 * is not a slider key (so the caller leaves it alone). Never outside [0, max].
 */
export const SEEK_STEP_S = 5;
export const SEEK_PAGE_FRACTION = 0.1;

export function seekKeyTarget(key, value, max, { step = SEEK_STEP_S } = {}) {
  if (!(max > 0)) return null;
  const now = Number.isFinite(value) ? value : 0;
  const page = max * SEEK_PAGE_FRACTION;
  let to;
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowDown': to = now - step; break;
    case 'ArrowRight':
    case 'ArrowUp': to = now + step; break;
    case 'PageDown': to = now - page; break;
    case 'PageUp': to = now + page; break;
    case 'Home': to = 0; break;
    case 'End': to = max; break;
    default: return null;
  }
  return Math.min(max, Math.max(0, to));
}

/** m:ss, or h:mm:ss from an hour up. */
export function clockText(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/**
 * The ARIA props of a timeline slider. `t` is i18next's, for "1:05 of 4:00".
 * Spread onto the element together with an onKeyDown that calls seekKeyTarget.
 */
export function timelineSliderProps({ value, max, label, t, disabled = false }) {
  const d = max > 0 ? max : 0;
  const v = Math.min(d, Math.max(0, Number(value) || 0));
  return {
    role: 'slider',
    tabIndex: disabled ? -1 : 0,
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': Math.round(d),
    'aria-valuenow': Math.round(v),
    'aria-valuetext': t('playerKeys.valueText', { time: clockText(v), total: clockText(d) }),
    'aria-disabled': disabled || undefined,
  };
}
