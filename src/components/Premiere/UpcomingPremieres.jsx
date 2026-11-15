import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchUpcomingPremieres } from '../../lib/premieres';
import { watchPath } from '../../utils/urls';
import { StatusPill } from '../v2/ui';
import { splitCountdown } from './PremiereCountdown';
import '../NewFromFollowing/NewFromFollowing.scss';
import '../ContinueWatching/ContinueWatching.scss';
import './Premiere.scss';

/** "in 2 d", "in 3 h", "in 12 min", or Live now. */
function useStartsLabel(startAt, skew) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew), 30 * 1000);
    return () => clearInterval(id);
  }, [skew]);
  const left = Date.parse(startAt) - now;
  if (left <= 0) return { live: true, label: t('premieres.liveNow') };
  const { days, hours, minutes } = splitCountdown(left);
  if (days > 0) return { live: false, label: t('premieres.inDays', { count: days }) };
  if (hours > 0) return { live: false, label: t('premieres.inHours', { count: hours }) };
  return { live: false, label: t('premieres.inMinutes', { count: Math.max(1, minutes) }) };
}

function PremiereCard({ p, skew, showAuthor }) {
  const { live, label } = useStartsLabel(p.startAt, skew);
  return (
    <div className="cw-card premiere-card">
      <Link className="cw-card-link" to={watchPath(p.owner, p.permlink)} title={p.title}>
        <span className="cw-card-thumb">
          {p.thumbnail && <img src={p.thumbnail} alt="" loading="lazy" />}
          <span className="premiere-card__when">
            <StatusPill tone={live ? 'live' : 'media'} icon="theaters" caps={false}>{label}</StatusPill>
          </span>
        </span>
        <span className="cw-card-text">
          <b>{p.title || p.permlink}</b>
          {showAuthor && <span>@{p.owner}</span>}
          <span>{new Date(p.startAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
        </span>
      </Link>
    </div>
  );
}

/**
 * "Upcoming premieres": a small row of cards, on Home (every creator) and on a
 * channel (`owner`). Nothing at all when there are none.
 */
export default function UpcomingPremieres({ owner = null }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['premieres-upcoming', owner || ''],
    staleTime: 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchUpcomingPremieres({ owner, limit: 12 }),
  });
  const list = data?.premieres || [];
  if (!list.length) return null;
  return (
    <section className="new-from-following continue-watching upcoming-premieres" aria-label={t('premieres.upcoming')}>
      <div className="nff-head">
        <p className="nff-summary"><b>{t('premieres.upcoming')}</b></p>
      </div>
      <div className="nff-wrapper">
        <div className="nff-rail cw-rail">
          {list.map((p) => <PremiereCard key={`${p.owner}/${p.permlink}`} p={p} skew={data.skew || 0} showAuthor={!owner} />)}
        </div>
      </div>
    </section>
  );
}
