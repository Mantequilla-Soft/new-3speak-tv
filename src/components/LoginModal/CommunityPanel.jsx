import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import AccountImg from '../HiveAvatar/AccountImg';
import { fetchLeaderboard } from '../../lib/leaderboardData';
import { cx } from '../v2/helpers';
import mark from '../../assets/image/3S_mark.svg';

// The ring around each face (design 07e): white, red or grey, in this order.
const RINGS = ['white', 'accent', 'accent', 'muted', 'white', 'white', 'accent', 'accent', 'white'];

/**
 * The left half of the login window (07e): "the community, not a plain form".
 * The 3Speak mark, nine creators who uploaded this month and one line about
 * owning your channel. Decorative only (aria-hidden): the login itself is on the
 * right. Hidden on phones, where the login is a bottom sheet.
 *
 * The faces come from the leaderboard (top uploaders, last 30 days), cached for
 * the visit; while it loads, or if it fails, the circles stay empty.
 */
export default function CommunityPanel() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['login-community-faces'],
    queryFn: () => fetchLeaderboard({ window: '30d', metric: 'video_uploads', limit: 9 }),
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const names = (data?.entries || []).map((e) => e.user).filter(Boolean);
  return (
    <div className="login-community" aria-hidden="true">
      <img className="login-community__mark" src={mark} alt="" />
      <div className="login-community__faces">
        {RINGS.map((ring, i) => (
          <span key={i} className={cx('login-community__face', `is-${ring}`)}>
            {names[i] && <AccountImg account={names[i]} alt="" loading="lazy" />}
          </span>
        ))}
      </div>
      <p className="login-community__tagline">{t('auth.loginModal.communityTagline')}</p>
    </div>
  );
}
