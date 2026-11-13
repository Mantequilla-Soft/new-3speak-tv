import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import './EmergencyScreen.scss';
import logo from '../../assets/image/3S_logo.svg';
import logoDark from '../../assets/image/3S_logodark.png';
import { useAppStore } from '../../lib/store';

// ── EMERGENCY / MAINTENANCE takeover ──────────────────────────────────────────
// HARD override: flip to `true` to force the maintenance screen for everyone,
// no network round-trip. When `false` (normal), Bootstrap instead decides at
// load time from the checker's /healthz probe (see utils/healthGate.js) — and
// ops can force maintenance without any redeploy via the checker's
// MAINTENANCE_MODE env. So this const is only for a deliberate, baked-in takeover.
export const EMERGENCY_MODE = false;

/**
 * Full-screen takeover shown INSTEAD of the app.
 *
 * variant="down" (default): 3Speak logo, outage message, Discord link, spinner.
 * variant="checking": neutral branded splash (logo + spinner only) shown for the
 *   brief moment the health probe is in flight, so a healthy load never flashes
 *   the scary "infrastructure issues" copy.
 */
export default function EmergencyScreen({ variant = 'down' }) {
  const { t } = useTranslation();
  const theme = useAppStore((s) => s.theme);
  const isDark = theme !== 'light'; // dark is the default
  const checking = variant === 'checking';

  // Design 44a ("We're having some infrastructure issues"): the logo, then one
  // card with the construction glyph in cyan (info, not an error of yours), the
  // copy, and the cyan way to live updates. Styles: EmergencyScreen.scss.
  return (
    <div className="emergency-screen" role={checking ? 'status' : 'alert'} aria-busy={checking || undefined}>
      <img className="emergency-logo" src={isDark ? logoDark : logo} alt="3Speak" />

      {!checking && (
        <div className="emergency-card">
          <Icon name="construction" size={28} className="emergency-icon" />
          <h1>{t('app.emergency.title')}</h1>
          <p>{t('app.emergency.body')}</p>
          <a
            className="v2-btn v2-btn--cyan h44 is-next emergency-discord"
            href="https://discord.com/invite/NSFS2VGj83"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon name="forum" size={18} />
            <span className="v2-btn__label">{t('app.emergency.joinDiscord')}</span>
            <Icon name="open_in_new" size={16} />
          </a>
        </div>
      )}

      <Icon name="progress_activity" size={32} className="v2-spin emergency-spinner" />
    </div>
  );
}
