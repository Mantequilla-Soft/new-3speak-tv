import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { MdAdd } from 'react-icons/md';
import { BADGES_URL } from '../../utils/config';
import GroupSort, { sortBy } from '../Groups/GroupSort';
import { useAppStore } from '../../lib/store';
import fetchHiveBadges from '../../utils/hiveBadges';
import CreateCommunity from '../modal/CreateCommunity';
import SkeletonLoader from '../Communities/SkeletonLoader';
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
    { id: 'recipients', label: 'Recipients', value: (b) => b.recipients },
    { id: 'created', label: 'Created', value: (b) => (b.created ? Date.parse(b.created) : null) },
    { id: 'title', label: 'Name', value: (b) => b.title, text: true },
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

  return (
    <div className="badges-render">
      <div className="badges-head">
        <h1>Badges</h1>
        <p>
          Badges are awards <strong>given to you by others</strong> on Hive, for
          events, contributions and milestones. You cannot join one: someone
          awards it. Open a badge to watch what its recipients publish here.
        </p>
      </div>

      {/* Same bar as the communities tab: search left, sort and create right. */}
      <div className="communities-bar">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Search badges..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="communities-bar-actions">
          <GroupSort
            options={SORTS}
            field={sortField}
            direction={sortDir}
            onFieldChange={setSortField}
            onDirectionChange={setSortDir}
          />
          {/* Same gate as the community button: an account_create paid from a
              Hive account with an active key. */}
          <button
            type="button"
            className={`group-create-btn${incubationHandle ? ' is-locked' : ''}`}
            onClick={incubationHandle ? undefined : () => setCreating(true)}
            aria-disabled={incubationHandle ? true : undefined}
            title={incubationHandle
              ? 'Creating a badge needs a Hive account. This unlocks when yours is ready.'
              : undefined}
          >
            <MdAdd size={17} /> Create badge
          </button>
        </div>
      </div>

      {loading ? (
        <SkeletonLoader />
      ) : error ? (
        <p className="badges-error">Could not load badges right now.</p>
      ) : filtered.length === 0 ? (
        <p className="badges-error">No badge matches that search.</p>
      ) : (
        <div className="badges-grid">
          {sortBy(filtered, SORTS, sortField, sortDir, { ids: mine, idOf: (b) => b.account }).map(badge => (
            <Link className="badge-card" to={`/b/${badge.account}`} key={badge.account}>
              <div className="badge-card-img">
                {/* The badge's OWN picture, which the directory already
                    carries. This was hardcoded to images.hive.blog, and that
                    proxy cannot read images.3speak.tv -- it answers with its own
                    grey placeholder (200, so nothing looks broken), which is why
                    a badge created here had a blank face in this grid while its
                    art was sitting in the index the whole time. */}
                <img
                  src={badge.image || `https://images.hive.blog/u/${badge.account}/avatar`}
                  alt={badge.title}
                  loading="lazy"
                />
              </div>
              <h3 className="badge-card-title">
                {badge.title}
                {/* Says why it is at the top, and it is the right word: a badge
                    is awarded, never joined. */}
                {mine.has(badge.account) && <span className="badge-mine">Held</span>}
              </h3>
              {badge.description ? (
                <p className="badge-card-desc">{badge.description}</p>
              ) : null}
              <span className="badge-card-count">
                {badge.recipients.toLocaleString('en-US')} recipients
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
