import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { BADGES_URL } from '../../utils/config';
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
          Badges are awarded on Hive for events, contributions and milestones.
          Open one to watch what its recipients publish here.
        </p>
      </div>

      <div className="search-wrapper">
        <input
          type="text"
          placeholder="Search badges..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <SkeletonLoader />
      ) : error ? (
        <p className="badges-error">Could not load badges right now.</p>
      ) : filtered.length === 0 ? (
        <p className="badges-error">No badge matches that search.</p>
      ) : (
        <div className="badges-grid">
          {filtered.map(badge => (
            <Link className="badge-card" to={`/b/${badge.account}`} key={badge.account}>
              <div className="badge-card-img">
                <img
                  src={`https://images.hive.blog/u/${badge.account}/avatar`}
                  alt={badge.title}
                  loading="lazy"
                />
              </div>
              <h3 className="badge-card-title">{badge.title}</h3>
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
    </div>
  );
}

export default BadgesRender;
