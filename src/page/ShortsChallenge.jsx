import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import Card3 from '../components/Cards/Card3';
import { Pagination } from '../components/FeedToolbar/FeedToolbar';
import { Button, Icon } from '../components/v2/ui';
import { useContentBatch } from '../hooks/useContentBatch';
import { useWatchHistory } from '../hooks/useWatchHistory';
import useViewCounts from '../hooks/useViewCounts';
import { formatNumber, getLanguage } from '../i18n';
import {
  challengeText, fetchChallengeEntries, rememberJoin, useShortsChallenge, useShortsChallenges, weekIdOf,
} from '../lib/shortsChallenge';
import './ShortsChallenge.scss';

const LIMIT = 24;
const DAY_MS = 24 * 3600 * 1000;

const weekNumber = (weekId) => Number(String(weekId).slice(6));

function dayLabel(date) {
  try {
    return new Intl.DateTimeFormat(getLanguage(), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * /challenge (this week) and /challenge/:week ('2026-W48'): the weekly Shorts
 * challenge (lib/shortsChallenge.js; the themes and entries come from the
 * checker). The theme and its prompt, how to join, the Shorts the team has
 * checked, next week's theme so people can plan, and the weeks before. No votes,
 * no winners.
 */
export default function ShortsChallenge() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { week: weekParam } = useParams();
  const [page, setPage] = useState(1);
  const now = new Date();
  const thisWeek = weekIdOf(now);
  const weekId = weekParam ? String(weekParam).toUpperCase() : null;

  const list = useShortsChallenges();
  const one = useShortsChallenge(weekId, { enabled: !!weekId });
  const loading = list.isLoading || (!!weekId && one.isLoading);
  const challenge = weekId ? (one.data || null) : (list.data?.current || null);
  const isCurrent = !!challenge && challenge.week === thisWeek;
  const isPast = !!challenge && challenge.week < thisWeek;
  const next = list.data?.next || null;
  const past = (list.data?.past || []).filter((c) => c.week !== challenge?.week);
  const thisWeeksChallenge = list.data?.current || null;

  const { data, isFetching, isError } = useQuery({
    queryKey: ['shortsChallengeEntries', challenge?.week, page],
    enabled: !!challenge && challenge.week <= thisWeek,
    queryFn: () => fetchChallengeEntries(challenge.week, { page, limit: LIMIT }),
    staleTime: 60 * 1000,
  });
  const entries = data?.videos || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, data?.totalPages || 1);
  const { getContentForVideo } = useContentBatch(entries);
  const { isWatched } = useWatchHistory(entries);
  const { getViewCount } = useViewCounts(entries);

  const join = () => {
    rememberJoin(challenge.week);
    navigate('/embed-studio?from=shorts');
  };

  const pastList = past.length > 0 && (
    <section className="challenge-past">
      <h2 className="challenge-section-title">{t('challenges.past')}</h2>
      <div className="challenge-past__list">
        {past.map((c) => (
          <Link key={c.week} to={`/challenge/${c.week}`} className="challenge-past__item">
            <span className="challenge-past__week">{t('challenges.eyebrow', { week: weekNumber(c.week) })}</span>
            <span className="challenge-past__title">{challengeText(c, 'title')}</span>
          </Link>
        ))}
      </div>
    </section>
  );

  if (loading) {
    return <div className="challenge-page" aria-busy="true" />;
  }

  if (!challenge) {
    return (
      <div className="challenge-page">
        <section className="challenge-empty">
          <Icon name="emoji_events" size={32} />
          <p>{t(weekParam ? 'challenges.unknownWeek' : 'challenges.none')}</p>
          {weekParam && thisWeeksChallenge && (
            <Button variant="secondary" size={40} onClick={() => navigate('/challenge')}>{t('challenges.backToCurrent')}</Button>
          )}
        </section>
        {next && (
          <Link to={`/challenge/${next.week}`} className="challenge-next">
            <span className="challenge-next__label">{t('challenges.eyebrow', { week: weekNumber(next.week) })}</span>
            <span className="challenge-next__hint">{t('challenges.nextHint')}</span>
            <span className="challenge-next__title">{challengeText(next, 'title')}</span>
          </Link>
        )}
        {pastList}
      </div>
    );
  }

  const start = new Date(challenge.starts_at);
  const end = new Date(challenge.ends_at);
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY_MS) - 1;

  return (
    <div className="challenge-page">
      <header className="challenge-hero">
        <span className="challenge-hero__eyebrow">{t('challenges.eyebrow', { week: weekNumber(challenge.week) })}</span>
        <h1 className="challenge-hero__title">{challengeText(challenge, 'title')}</h1>
        <p className="challenge-hero__prompt">{challengeText(challenge, 'prompt')}</p>
        <p className="challenge-hero__meta">
          {[
            t('challenges.dates', { start: dayLabel(start), end: dayLabel(end) }),
            isCurrent && (daysLeft <= 0 ? t('challenges.endsToday') : t('challenges.endsIn', { count: daysLeft })),
          ].filter(Boolean).join(' · ')}
        </p>
        <div className="challenge-hero__actions">
          {isCurrent && (
            <Button variant="primary" size={48} icon="add" onClick={join}>{t('challenges.join')}</Button>
          )}
          <Link to={`/t/${challenge.tag}`} className="challenge-hero__tag">#{challenge.tag}</Link>
        </div>
        {!isCurrent && (
          <p className="challenge-hero__note">
            {t(isPast ? 'challenges.pastWeek' : 'challenges.upcomingWeek')}{' '}
            {thisWeeksChallenge && <Link to="/challenge">{t('challenges.backToCurrent')}</Link>}
          </p>
        )}
      </header>

      <div className="challenge-info">
        <section className="challenge-how">
          <h2 className="challenge-section-title">{t('challenges.howTitle')}</h2>
          <ol>
            <li>{t('challenges.how1')}</li>
            <li>{t('challenges.how2', { tag: challenge.tag })}</li>
            <li>{t('challenges.how3')}</li>
          </ol>
        </section>
        {isCurrent && next && (
          <Link to={`/challenge/${next.week}`} className="challenge-next">
            <span className="challenge-next__label">{t('challenges.next')}</span>
            <span className="challenge-next__hint">{t('challenges.nextHint')}</span>
            <span className="challenge-next__title">{challengeText(next, 'title')}</span>
          </Link>
        )}
      </div>

      {challenge.week <= thisWeek && (
        <section className="challenge-entries">
          <h2 className="challenge-section-title">
            {t('challenges.entries')}
            {total > 0 && <span className="challenge-count">{t('challenges.entriesCount', { count: total, num: formatNumber(total) })}</span>}
          </h2>
          {isError && <p className="challenge-muted">{t('challenges.loadError')}</p>}
          {!isError && !isFetching && entries.length === 0 && (
            <p className="challenge-muted">{t(isCurrent ? 'challenges.noEntries' : 'challenges.noEntriesPast')}</p>
          )}
          {entries.length > 0 && (
            <Card3 windowed
              variant="bare"
              videos={entries}
              loading={isFetching}
              getContentForVideo={getContentForVideo}
              isWatched={isWatched}
              getViewCount={getViewCount}
              linkPrefix="/shorts"
              shortsGrid
            />
          )}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </section>
      )}

      {pastList}
    </div>
  );
}
