import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getFollowers, getFollowing } from '../../utils/hiveUtils';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { CHECKER_URL, HIVE_API_URL } from '../../utils/config';
import './Follower.scss';

const PAGE = 100;

/**
 * Per-account detail for one page of names: Hive follower counts plus this
 * creator's 3Speak output.
 *
 * BOTH lookups are bulk, and that is the whole reason this is affordable —
 * `bridge.get_profiles` takes the entire page in one call (~1s for 100), and
 * the checker's /users/counts does one aggregation per collection grouped by
 * owner (~240ms for 100, versus 300 aggregations if the per-user route were
 * called in a loop). Never fetch these one name at a time.
 */
async function fetchDetails(names) {
  if (names.length === 0) return {};
  const [profiles, counts] = await Promise.all([
    axios.post(HIVE_API_URL, {
      jsonrpc: '2.0', method: 'bridge.get_profiles', params: { accounts: names }, id: 1,
    }).then((r) => r.data?.result || []).catch(() => []),
    axios.post(`${CHECKER_URL}/users/counts`, { usernames: names })
      .then((r) => r.data?.counts || {}).catch(() => ({})),
  ]);

  const out = {};
  for (const p of profiles) {
    out[p.name] = { followers: p.stats?.followers ?? null };
  }
  for (const [name, c] of Object.entries(counts)) {
    out[name] = { ...(out[name] || {}), videos: c.videos, shorts: c.shorts };
  }
  return out;
}

/**
 * Followers / Following for the profile being VIEWED.
 *
 * The account has to come in as a prop: this used to read `user` from the app
 * store, which is the SIGNED-IN account — so it listed your own followers on
 * everyone else's profile, and listed nothing at all when logged out, because
 * the effect bailed on a null username.
 *
 * Hive returns these 100 at a time from a cursor, so the list pages in on
 * demand rather than showing the first 100 and calling it done.
 */
function Follower({ count = {}, username }) {
  const [lists, setLists] = useState({ followers: [], following: [] });
  const [done, setDone] = useState({ followers: false, following: false });
  const [activeTab, setActiveTab] = useState('followers');
  const [isLoading, setIsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // username -> { followers, videos, shorts }. Filled in AFTER the names
  // render, so the list is never blocked on the ~1s profiles call.
  const [details, setDetails] = useState({});
  const navigate = useNavigate();
  // Guards against a late response for a previous account overwriting the
  // current one when you move between profiles.
  const reqRef = useRef(0);

  const fetchPage = useCallback(async (tab, cursor = '') => {
    const fn = tab === 'followers' ? getFollowers : getFollowing;
    const rows = await fn(username, cursor, PAGE);
    // Hive echoes the cursor row back as the first result, so drop it —
    // otherwise every page after the first repeats a name.
    return cursor ? rows.filter((r) => r !== cursor) : rows;
  }, [username]);

  useEffect(() => {
    if (!username) return undefined;
    const id = ++reqRef.current;
    setIsLoading(true);
    setLists({ followers: [], following: [] });
    setDone({ followers: false, following: false });
    setDetails({});
    (async () => {
      try {
        const [followers, following] = await Promise.all([
          fetchPage('followers'),
          fetchPage('following'),
        ]);
        if (reqRef.current !== id) return; // a newer profile won
        setLists({ followers, following });
        setDone({ followers: followers.length < PAGE, following: following.length < PAGE });
      } catch (err) {
        console.error('Error fetching followers/following:', err);
      } finally {
        if (reqRef.current === id) setIsLoading(false);
      }
    })();
    return () => { reqRef.current += 1; };
  }, [username, fetchPage]);

  const loadMore = async () => {
    const current = lists[activeTab];
    const cursor = current[current.length - 1];
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const rows = await fetchPage(activeTab, cursor);
      setLists((p) => ({ ...p, [activeTab]: [...p[activeTab], ...rows] }));
      if (rows.length < PAGE) setDone((p) => ({ ...p, [activeTab]: true }));
    } catch (err) {
      console.error('Error loading more:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const missing = lists[activeTab].filter((u) => !details[u]);
    if (missing.length === 0) return undefined;
    let cancelled = false;
    fetchDetails(missing.slice(0, PAGE)).then((got) => {
      if (!cancelled) setDetails((prev) => ({ ...prev, ...got }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lists, activeTab]);

  const users = lists[activeTab];
  const total = activeTab === 'followers' ? count.follower_count : count.following_count;
  const avatar = (u) => `/img/u/${u}/avatar/small`;
  const compact = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n));

  const TABS = [
    { id: 'followers', label: 'Followers', n: count.follower_count },
    { id: 'following', label: 'Following', n: count.following_count },
  ];

  return (
    <div className="followers-page">
      {/* Same treatment as the profile's own tabs: plain text with an accent
          underline, no button chrome. */}
      <div className="follower-tabs" role="tablist" aria-label="Followers and following">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={activeTab === t.id}
            className={`follower-tab${activeTab === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}{typeof t.n === 'number' ? ` (${t.n.toLocaleString()})` : ''}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="follower-loading"><div className="spinner" /></div>
      ) : users.length === 0 ? (
        <p className="follower-empty">
          {activeTab === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'}
        </p>
      ) : (
        <>
          <div className="users-grid">
            {users.map((u) => (
              <button
                type="button"
                className="user-card"
                key={`${activeTab}-${u}`}
                onClick={() => navigate(`/p/${u}`)}
              >
                <img
                  className="user-avatar"
                  src={avatar(u)}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.src = `https://ui-avatars.com/api/?name=${u}&background=dc2626&color=ffffff&size=150`;
                  }}
                />
                <span className="user-text">
                  <span className="user-name">@{u}</span>
                  {details[u] ? (
                    <span className="user-stats">
                      {typeof details[u].followers === 'number'
                        ? <span>{compact(details[u].followers)} followers</span> : null}
                      {details[u].videos > 0 ? <span>{compact(details[u].videos)} videos</span> : null}
                      {details[u].shorts > 0 ? <span>{compact(details[u].shorts)} shorts</span> : null}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>

          <div className="follower-more">
            {done[activeTab] ? (
              <span className="follower-count-note">Showing all {users.length.toLocaleString()}</span>
            ) : (
              <>
                <button type="button" className="follower-more-btn" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
                <span className="follower-count-note">
                  Showing {users.length.toLocaleString()}
                  {typeof total === 'number' ? ` of ${total.toLocaleString()}` : ''}
                </span>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default Follower;
