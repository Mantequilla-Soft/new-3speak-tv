import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../lib/store';
import { useLiveStreams } from '../../hooks/useLiveStreams';
import { useNotifyLevels, levelOf } from '../../lib/notifyLevels';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import '../NewFromFollowing/NewFromFollowing.scss';
import './LiveFromFollowing.scss';

/**
 * "Live now from people you follow" on Home, next to "New from people you follow"
 * and drawn with the same strip (`nff-*`). Only while someone followed is live;
 * the rail is open from the start, since a stream is now or never.
 *
 * The live list is the one the feeds already poll (hooks/useLiveStreams.js, every
 * 30 s, `following: true`); creators set to Off (lib/notifyLevels.js) stay out.
 */
export default function LiveFromFollowing() {
  const { t } = useTranslation();
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const streams = useLiveStreams({ following: true });
  const levels = useNotifyLevels(authenticated ? user : null);

  // One chip per host (a host rarely runs two streams; the newest wins).
  const seen = new Set();
  const live = streams.filter((s) => {
    const host = String(s.author || '').toLowerCase();
    if (!host || s._openpodRoom || seen.has(host) || levelOf(levels, host) === 'off') return false;
    seen.add(host);
    return true;
  });

  if (!authenticated || !user || !live.length) return null;

  return (
    <section className="new-from-following live-from-following" aria-label={t('social.live.aria')}>
      <div className="nff-head">
        <div className="nff-stack" aria-hidden="true">
          {live.slice(0, 4).map((s) => (
            <HiveAvatar key={s.author} username={s.author} size="small" alt="" badgeSize={0} className="nff-stack-avatar" />
          ))}
        </div>
        <p className="nff-summary">
          <span className="lff-dot" aria-hidden="true" />
          <b>{t('social.live.summary', { count: live.length })}</b>
        </p>
      </div>
      <div className="nff-wrapper">
        <div className="nff-rail">
          {live.map((s) => (
            <Link key={`${s.author}/${s.roomName}`} to={`/watch/${s.roomName}`} className="nff-chip lff-chip" title={s.title}>
              <HiveAvatar username={s.author} size="small" alt="" badgeSize={0} className="nff-chip-avatar" />
              <span className="nff-chip-text">
                <b>@{s.author}</b>
                <span>{s.title || t('social.live.badge')}</span>
              </span>
              <span className="lff-tag">{t('social.live.badge')}</span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
