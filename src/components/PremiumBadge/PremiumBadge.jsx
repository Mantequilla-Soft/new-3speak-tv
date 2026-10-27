import { usePremiumBadge } from '../../hooks/usePremiumStatus';
import './PremiumBadge.scss';

/**
 * Tiny "3Speak Pro" indicator. Renders a stylised crown that picks up
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
      <svg
        width={size}
        height={size}
        viewBox="0 0 512 512"
        fill="currentColor"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Font Awesome 6 — fa-solid fa-rocket. Diagonal rocket with
            booster flame, rounded fins, and a porthole. Reads cleanly
            even at 10px once it sits on an avatar corner. */}
        <path d="M156.6 384.9L125.7 353.1c-8.5-8.5-11.5-20.8-7.7-32.2c3-8.9 7-20.5 11.8-33.8L24 288c-8.6 0-16.6-4.6-20.9-12.1s-4.2-16.7 .2-24.1l52.5-88.5c13-21.9 36.5-35.3 61.9-35.3l82.3 0c2.4-4 4.8-7.7 7.2-11.3C289.1-4.1 411.1-8.1 483.9 5.3c11.6 2.1 20.6 11.2 22.8 22.8c13.4 72.9 9.3 194.8-111.4 276.7c-3.5 2.4-7.3 4.8-11.3 7.2v82.3c0 25.4-13.4 49-35.3 61.9l-88.5 52.5c-7.4 4.4-16.6 4.5-24.1 .2s-12.1-12.4-12.1-20.9V380.8c-14.1 4.9-26.4 8.9-35.7 11.9c-11.2 3.6-23.4 .5-31.8-7.8zM384 168a40 40 0 1 0 0-80 40 40 0 1 0 0 80z" />
      </svg>
    </span>
  );
}
