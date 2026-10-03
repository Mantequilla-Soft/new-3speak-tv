import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { CHECKER_URL } from '../../utils/config';
import { getAccounts } from '../../hive-api/hiveApi';
import { useTranslation, Trans } from 'react-i18next';
import { formatNumber } from '../../i18n';
import './ProfileStats.scss';

/**
 * The one-line stat summary under a profile's bio: how much this creator has
 * published, how much it's been watched, and how long they've been at it.
 *
 * Backed by the checker's `/user/:username/counts`, whose queries MIRROR the
 * tabs below (legacy + embed for videos, the embed_url-keyed query for shorts).
 * A stat that disagrees with the tab under it is worse than no stat.
 *
 * The "since" year comes from the CHAIN (the Hive account's creation date), not
 * from our oldest stored upload: for @meno the oldest row we hold is 2025 while
 * the account dates to 2017, so an upload-derived date would describe when our
 * index picked him up. Hence the honest label, "on Hive since".
 */

const fmt = (n) => formatNumber(Number(n) || 0, { compact: true });

export default function ProfileStats({ username, followers, onFollowersClick }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['profile-counts', username],
    enabled: !!username,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => (await axios.get(`${CHECKER_URL}/user/${encodeURIComponent(username)}/counts`)).data,
  });

  // Account age, straight from the chain. Its own query so a slow/failed Hive
  // node costs the year, not the whole stat line.
  const { data: since } = useQuery({
    queryKey: ['profile-since', username],
    enabled: !!username,
    staleTime: 24 * 60 * 60 * 1000,   // an account's birthday never changes
    retry: 1,
    queryFn: async () => {
      const [account] = await getAccounts([String(username).toLowerCase()]);
      const created = account?.created;
      const year = created ? new Date(`${created}Z`).getFullYear() : null;
      return Number.isFinite(year) ? year : null;
    },
  });

  if (!data) return null;

  // Only render the parts that are actually true for this creator — a row of
  // zeroes says less than a shorter row.
  // Every number here is abbreviated ("3.8K"), so each carries the exact figure
  // in its tooltip — the short form is for scanning, not a loss of detail.
  const exact = (n) => formatNumber(Number(n || 0));
  const items = [
    followers != null && {
      key: 'followers',
      value: fmt(followers),
      count: followers,
      labelKey: 'profile.stats.followers',
      title: t('profile.stats.followersTitle', { count: followers, num: exact(followers) }),
      onClick: onFollowersClick,
    },
    data.videos > 0 && { key: 'videos', value: fmt(data.videos), count: data.videos, labelKey: 'profile.stats.videos', title: t('profile.stats.videosTitle', { count: data.videos, num: exact(data.videos) }) },
    data.shorts > 0 && { key: 'shorts', value: fmt(data.shorts), count: data.shorts, labelKey: 'profile.stats.shorts', title: t('profile.stats.shortsTitle', { count: data.shorts, num: exact(data.shorts) }) },
    data.views > 0 && { key: 'views', value: fmt(data.views), count: data.views, labelKey: 'profile.stats.views', title: t('profile.stats.viewsTitle', { count: data.views, num: exact(data.views) }) },
  ].filter(Boolean);

  if (!items.length) return null;

  return (
    <div className="profile-stats">
      {items.map((i) => (
        <span
          className={`profile-stat${i.onClick ? ' profile-stat--action' : ''}`}
          key={i.key}
          title={i.title}
          {...(i.onClick ? {
            role: 'button',
            tabIndex: 0,
            onClick: i.onClick,
            onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); i.onClick(); } },
          } : {})}
        >
          <Trans i18nKey={i.labelKey} count={i.count} values={{ value: i.value }} components={{ b: <strong /> }} />
        </span>
      ))}
      {since ? <span className="profile-stat profile-stat--since">{t('profile.stats.onHiveSince', { year: since })}</span> : null}
    </div>
  );
}
