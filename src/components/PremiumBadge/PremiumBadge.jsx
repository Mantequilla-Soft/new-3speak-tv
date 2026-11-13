import { usePremiumBadge } from '../../hooks/usePremiumStatus';
import { Icon } from '../v2/Icon';
import './PremiumBadge.scss';

/**
 * Tiny "3Speak Pro" indicator: the workspace_premium symbol, in
 * `currentColor` so it blends with whatever container it's dropped into.
 * Returns null when the user has no premium flag — safe to drop next to
 * any avatar without per-call gating.
 *
 * Props:
 *   username — Hive account to check. When unset, renders nothing.
 *   size     — pixel size of the inline SVG (default 14).
 *   title    — tooltip shown on hover.
 *   className — extra class for layout tweaks at the callsite.
 */
export default function PremiumBadge({ username, size = 14, title = '3Speak Pro', className }) {
  if (!usePremiumBadge(username)) return null;

  return (
    <span
      className={`hh-premium-badge${className ? ` ${className}` : ''}`}
      // `data-tooltip` powers the custom CSS hover tooltip (fast +
      // branded). aria-label keeps screen readers covered. No `title`
      // attribute — it'd double up with the native OS tooltip and
      // flash 500ms after ours appears.
      data-tooltip={title}
      aria-label={title}
      role="img"
      tabIndex={0}
    >
      {/* 30c: the Pro mark is Material Symbols' workspace_premium, filled. */}
      <Icon name="workspace_premium" size={size} fill />
    </span>
  );
}
