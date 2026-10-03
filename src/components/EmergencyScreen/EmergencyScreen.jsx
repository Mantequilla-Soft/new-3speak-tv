import { useTranslation } from 'react-i18next';
import { TailChase } from 'ldrs/react';
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '30px',
        padding: '24px',
        textAlign: 'center',
        background: 'var(--bg-primary, #0f0f0f)',
        color: 'var(--text-primary, #f1f1f1)',
      }}
    >
      <img
        src={isDark ? logoDark : logo}
        alt="3Speak"
        style={{ width: 'min(220px, 62vw)', height: 'auto' }}
      />

      {!checking && (
      <div style={{ maxWidth: '460px' }}>
        <h1 style={{ fontSize: 'clamp(20px, 4.5vw, 27px)', fontWeight: 700, margin: '0 0 12px' }}>
          {t('app.emergency.title')}
        </h1>
        <p
          style={{
            fontSize: 'clamp(14px, 2.6vw, 16px)',
            lineHeight: 1.55,
            margin: 0,
            color: 'var(--text-secondary, #9aa0a6)',
          }}
        >
          {t('app.emergency.body')}
        </p>
      </div>
      )}

      {!checking && (
      <a
        href="https://discord.com/invite/NSFS2VGj83"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 22px',
          borderRadius: '10px',
          background: '#5865F2', // Discord blurple
          color: '#fff',
          fontSize: '15px',
          fontWeight: 600,
          textDecoration: 'none',
          boxShadow: '0 4px 16px rgba(88, 101, 242, 0.35)',
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.2.36-.43.842-.59 1.226a18.27 18.27 0 0 0-5.487 0A12.6 12.6 0 0 0 9.21 3a19.74 19.74 0 0 0-4.435 1.37C1.9 8.64 1.12 12.8 1.51 16.9a19.9 19.9 0 0 0 6.06 3.06c.49-.67.93-1.38 1.3-2.12-.71-.27-1.4-.6-2.04-.99.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.34 0c.16.14.33.27.5.4-.65.39-1.33.72-2.05.99.38.74.81 1.45 1.3 2.12a19.85 19.85 0 0 0 6.06-3.06c.46-4.72-.79-8.85-3.26-12.53ZM8.52 14.35c-1.19 0-2.16-1.1-2.16-2.44 0-1.35.95-2.45 2.16-2.45 1.21 0 2.18 1.1 2.16 2.45 0 1.34-.95 2.44-2.16 2.44Zm6.97 0c-1.19 0-2.16-1.1-2.16-2.44 0-1.35.95-2.45 2.16-2.45 1.21 0 2.18 1.1 2.16 2.45 0 1.34-.94 2.44-2.16 2.44Z" />
        </svg>
        {t('app.emergency.joinDiscord')}
      </a>
      )}

      <TailChase size="42" speed="1.75" color="var(--accent-primary, #e0594b)" />
    </div>
  );
}
