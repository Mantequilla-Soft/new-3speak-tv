import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Icon } from '../v2/Icon';
import { usePremiumBadge } from '../../hooks/usePremiumStatus';
import {
  fetchLeaderboardBadges,
  visibleBadges,
  badgeLabel,
  badgeTitle,
} from '../../lib/leaderboardData';
import { useTranslation } from 'react-i18next';
import './LeaderboardBadges.scss';

// One icon per topic, so the shortened label doesn't have to carry the meaning.
// Material Symbols names.
const BADGE_ICONS = {
  video_uploads: 'smart_display',
  short_uploads: 'smartphone',
  video_watch_secs: 'visibility',
  short_watch_secs: 'timer',
  tags_given: 'sell',
  story_uploads: 'history_toggle_off',
  story_streak: 'local_fire_department',
};

/**
 * Leaderboard standings shown on a profile ("#1 Videos"). The checker returns
 * the user's best tier per metric across every window; we show the few
 * strongest. Clicking one opens the exact board it was earned on, scrolled to
 * and highlighting the row of the profile you came from (`?user=`).
 *
 * Renders nothing when the user holds no badges — most accounts won't, and an
 * empty row would just add noise to the profile header.
 */
function LeaderboardBadges({ username }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['leaderboard-badges', username],
    queryFn: () => fetchLeaderboardBadges(username),
    enabled: !!username,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  // 3Speak Pro sits in the same row as the standings. It's a status, not a
  // ranking, so it leads — and it shows even for accounts holding no
  // leaderboard badges at all.
  const isPro = !!usePremiumBadge(username);

  const badges = visibleBadges(data?.badges);
  if (!badges.length && !isPro) return null;

  return (
    <div className="lb-badges">
      {isPro && (
        <span className="lb-badge lb-badge-pro" title={t('badges.leaderboardBadges.proTitle')}>
          <Icon name="rocket_launch" size={14} fill className="lb-badge-icon" />
          <span>3Speak Pro</span>
        </span>
      )}
      {badges.map((b) => {
        const icon = BADGE_ICONS[b.metric] || 'smart_display';
        return (
          <Link
            key={b.metric}
            to={`/leaderboard?window=${b.window}&metric=${b.metric}&user=${encodeURIComponent(username)}`}
            className={`lb-badge lb-badge-${b.tier}`}
            title={badgeTitle(b)}
          >
            <Icon name={icon} size={14} className="lb-badge-icon" />
            <span>{badgeLabel(b)}</span>
          </Link>
        );
      })}
    </div>
  );
}

export default LeaderboardBadges;
