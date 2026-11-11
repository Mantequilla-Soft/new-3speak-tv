import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { BADGES_URL } from '../../utils/config';
import GroupSort, { sortBy } from '../Groups/GroupSort';
import { useAppStore } from '../../lib/store';
import fetchHiveBadges from '../../utils/hiveBadges';
import { cachedProfileImage } from '../../utils/avatarCache';
import CreateCommunity from '../modal/CreateCommunity';
import SkeletonLoader from '../Communities/SkeletonLoader';
import { useTranslation, Trans } from 'react-i18next';
import { formatNumber } from '../../i18n';
import { Banner, Button, EmptyState, StatusPill } from '../v2/ui';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import './BadgesRender.scss';

/**
 * The badge directory.
 *
 * The list itself is curated on chain: one registry account follows every badge
 * worth listing (@peakd keeps `badge-500500` for peakd.com and it is the
 * de-facto list), and the checker resolves it to profiles + counts. So this page
 * shows the same badges a Hive user already recognises from elsewhere, rather
 * than a second list only 3Speak knows about.
 */
function BadgesRender() {
  const { t } = useTranslation();
  const [badges, setBadges] = useState([]);
  // Recipients first, most-held first: the closest thing a badge list has to
  // "biggest", and the order that puts the recognisable ones at the top.
  const [sortField, setSortField] = useState('recipients');
  const [sortDir, setSortDir] = useState('desc');
  const [creating, setCreating] = useState(false);
  const user = useAppStore((st) => st.user);
  const incubationHandle = useAppStore((st) => st.incubationHandle);
  // Badges this person HOLDS. Only a Hive account can hold one -- a badge is
  // held by the badge account following you -- so an incubating user has none
  // and this stays empty for them rather than fetching nothing.
  const [mine, setMine] = useState(() => new Set());

  useEffect(() => {
    if (!user) { setMine(new Set()); return undefined; }
    let alive = true;
    fetchHiveBadges(user)
      .then((list) => { if (alive) setMine(new Set((list || []).map((x) => x.account || x.name))); })
      .catch(() => { /* the directory is still useful unsorted */ });
    return () => { alive = false; };
  }, [user]);

  // Everything here comes from the registry response, so offering these costs
  // no extra request.
  const SORTS = [
    { id: 'recipients', label: t('badges.directory.sort.recipients'), value: (b) => b.recipients },
    { id: 'created', label: t('badges.directory.sort.created'), value: (b) => (b.created ? Date.parse(b.created) : null) },
    { id: 'title', label: t('badges.directory.sort.name'), value: (b) => b.title, text: true },
  ];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    axios.get(BADGES_URL)
      .then(res => { if (alive) setBadges(res.data?.badges || []); })
      .catch(() => { if (alive) setError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return badges;
    return badges.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.account.includes(q) ||
      (b.description || '').toLowerCase().includes(q)
    );
  }, [badges, query]);

  const locked = !!incubationHandle;

  return (
    <div className="badges-render">
      <p className="groups-intro">
        <Trans i18nKey="badges.directory.intro" components={{ b: <strong /> }} />
      </p>

      {/* Same bar as the communities tab: search left, create right. */}
      <div className="groups-bar">
        <label className="groups-search">
          <Icon name="search" size={18} />
          <input
            type="text"
            placeholder={t('badges.directory.searchPlaceholder')}
            aria-label={t('badges.directory.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {/* Same gate as the community button: an account_create paid from a
            Hive account with an active key. */}
        <Button
          variant="cyan"
          size={44}
          icon="add"
          className={cx('groups-create', locked && 'is-locked')}
          onClick={locked ? undefined : () => setCreating(true)}
          aria-disabled={locked ? true : undefined}
          title={locked ? t('badges.directory.createLocked') : undefined}
        >
          {t('badges.directory.create')}
        </Button>
      </div>
      {locked && (
        <Banner tone="neutral" icon="lock" className="groups-locked">{t('badges.directory.createLocked')}</Banner>
      )}

      <GroupSort
        options={SORTS}
        field={sortField}
        direction={sortDir}
        onFieldChange={setSortField}
        onDirectionChange={setSortDir}
      />

      {loading ? (
        <SkeletonLoader height={96} />
      ) : error ? (
        <div className="v2-failure badges-error"><b>{t('badges.directory.loadError')}</b></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon="search_off" title={t('badges.directory.noMatch')} className="badges-error" />
      ) : (
        <div className="groups-grid badges-grid">
          {sortBy(filtered, SORTS, sortField, sortDir, { ids: mine, idOf: (b) => b.account }).map(badge => (
            <Link className="badge-card" to={`/b/${badge.account}`} key={badge.account}>
              <span className="badge-card-img">
                {/* The badge's OWN picture, which the directory already
                    carries, served from our /img/ cache. */}
                <img
                  src={cachedProfileImage(badge.account, badge.image, 'medium')}
                  alt=""
                  loading="lazy"
                />
              </span>
              <span className="badge-card-text">
                <span className="badge-card-head">
                  <b className="badge-card-title">{badge.title}</b>
                  {/* Says why it is at the top, and it is the right word: a
                      badge is awarded, never joined. */}
                  {mine.has(badge.account) && <StatusPill tone="cyan" icon="check" className="badge-mine">{t('badges.directory.held')}</StatusPill>}
                </span>
                <span className="badge-card-count num">
                  {t('badges.directory.recipients', { count: badge.recipients, num: formatNumber(badge.recipients) })}
                </span>
                {badge.description ? (
                  <span className="badge-card-desc">{badge.description}</span>
                ) : null}
              </span>
            </Link>
          ))}
        </div>
      )}
      {creating && <CreateCommunity isOpen={creating} close={() => setCreating(false)} kind="badge" />}
    </div>
  );
}

export default BadgesRender;
