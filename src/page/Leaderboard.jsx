import { useEffect, useRef, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { MdOutlineLeaderboard, MdInfoOutline } from 'react-icons/md';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';
import { useAppStore } from '../lib/store';
import { TAG_CATEGORIES, getCategoryOf } from '../utils/tagsV2';
import {
  WINDOWS,
  METRICS,
  METRIC_GROUPS,
  DEFAULT_WINDOW,
  DEFAULT_METRIC,
  metricSupportsTopics,
  metricById,
  fetchLeaderboard,
  fetchTopics,
  fetchTopicLeaderboard,
  fetchUserLeaderboardStats,
  formatMetric,
} from '../lib/leaderboardData';
import './Leaderboard.scss';

const PAGE_SIZE = 50;

// Arriving from a profile badge (?user=), the board keeps loading pages until it
// reaches that creator's row. Bounded so a long-tail rank can't turn one click
// into an unbounded crawl of the whole board.
const MAX_AUTO_PAGES = 8;

const rowId = (user) => `lb-entry-${user}`;

function watchNotice(sinceIso) {
  const d = new Date(sinceIso);
  const since = Number.isNaN(d.getTime())
    ? sinceIso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `Watch time has only been tracked since ${since}, so longer windows still show the same short history.`;
}

// Top 3 get the podium; everyone else falls through to the ranked rows below.
// A thin board (one or two creators — common on a quiet topic) still gets the
// full three-slot podium, with the unclaimed places shown as empty placeholders
// rather than collapsing the winner into a plain list row.
function Podium({ entries, metric, focusUser }) {
  if (!entries.length) return null;
  const slot = (rank) => entries[rank - 1] || { rank, placeholder: true };
  // Visual order puts the winner in the middle: 2nd, 1st, 3rd.
  const order = [slot(2), slot(1), slot(3)];
  return (
    <div className="lb-podium">
      {order.map((e) => (e.placeholder ? (
        <div
          key={`empty-${e.rank}`}
          className={`lb-podium-slot lb-rank-${e.rank} empty`}
          aria-hidden="true"
        >
          <span className="lb-podium-medal">{e.rank}</span>
          <span className="lb-podium-avatar-empty" />
          <span className="lb-podium-user">Unclaimed</span>
          <span className="lb-podium-value">—</span>
          <span className="lb-podium-metric">{metric.label}</span>
        </div>
      ) : (
        <Link
          key={e.user}
          to={`/user/${e.user}`}
          id={rowId(e.user)}
          className={`lb-podium-slot lb-rank-${e.rank}${e.user === focusUser ? ' focused' : ''}`}
        >
          <span className="lb-podium-medal">{e.rank}</span>
          <HiveAvatar username={e.user} size="medium" className="lb-podium-avatar" badgeSize={14} />
          <span className="lb-podium-user">@{e.user}</span>
          <span className="lb-podium-value">{formatMetric(e[metric.id], metric.unit)}</span>
          <span className="lb-podium-metric">{metric.label}</span>
        </Link>
      )))}
    </div>
  );
}

function Row({ entry, metric, isMe, focused }) {
  return (
    <Link
      to={`/user/${entry.user}`}
      id={rowId(entry.user)}
      className={`lb-row${isMe ? ' me' : ''}${focused ? ' focused' : ''}`}
    >
      <span className="lb-row-rank">{entry.rank}</span>
      <HiveAvatar username={entry.user} size="small" className="lb-row-avatar" />
      <span className="lb-row-user">@{entry.user}</span>
      <span className="lb-row-value">{formatMetric(entry[metric.id], metric.unit)}</span>
    </Link>
  );
}

// The signed-in user's own standing, pinned above the board so they don't have
// to scroll for it. A user with no activity in the window has no row at all —
// the checker reports that as zeros with a null rank.
function MyStanding({ user, window, metric }) {
  const { data } = useQuery({
    queryKey: ['leaderboard-me', user, window],
    queryFn: () => fetchUserLeaderboardStats(user, window),
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
  if (!user || !data) return null;

  const rank = data.ranks?.[metric.id];
  const value = data.stats?.[metric.id] || 0;
  return (
    <div className="lb-me">
      <span className="lb-me-rank">{rank ? `#${rank}` : '—'}</span>
      <HiveAvatar username={user} size="small" className="lb-row-avatar" />
      <span className="lb-me-user">@{user}</span>
      <span className="lb-me-value">
        {formatMetric(value, metric.unit)}
        <small>{metric.label}</small>
      </span>
      {!rank && <span className="lb-me-empty">No activity in this window yet</span>}
    </div>
  );
}

function Leaderboard() {
  const user = useAppStore((s) => s.user);
  // Profile badges deep-link to the exact board they were earned on.
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: topicData } = useQuery({
    queryKey: ['leaderboard-topics'],
    queryFn: fetchTopics,
    staleTime: 60 * 60 * 1000,
  });
  const topics = topicData?.topics || [];

  const window = WINDOWS.some((w) => w.id === searchParams.get('window'))
    ? searchParams.get('window')
    : DEFAULT_WINDOW;
  // Empty topic = the overall board. Trust the server's list rather than a
  // hardcoded one, so a new topic works without a frontend change.
  const rawTopic = searchParams.get('topic') || '';
  // Category slugs are valid boards too (they roll up to their topics server-side)
  // even though the server's topic list only contains slugs that have their own rows.
  const CATEGORY_SLUGS = TAG_CATEGORIES.map((c) => c.slug);
  const topic = (topics.includes(rawTopic) || CATEGORY_SLUGS.includes(rawTopic)) ? rawTopic : '';

  // One metric list, always. The tabs never change under the user; a topic only
  // re-points the query at the per-topic board for the same metric.
  const metricId = METRICS.some((m) => m.id === searchParams.get('metric'))
    ? searchParams.get('metric')
    : DEFAULT_METRIC;
  const metric = metricById(metricId);

  // Tags aren't tracked per topic, so that metric has no topic board at all.
  const topicsAvailable = metricSupportsTopics(metricId);
  const activeTopic = topicsAvailable ? topic : '';

  // Topics as a 2-LEVEL tree (same taxonomy as the vote dialog): the 7 broad
  // categories, each holding the topics the server actually has a board for.
  // A category is only selectable itself when the tagger emitted it AS a tag
  // (it's a valid coarse tag), otherwise it just expands its topics. Anything
  // the taxonomy doesn't know (legacy slugs) falls into "Other" so no board
  // silently disappears from the UI.
  const topicSet = useMemo(() => new Set(topics), [topics]);
  const groups = useMemo(() => {
    const gs = TAG_CATEGORIES.map((c) => ({
      slug: c.slug,
      label: c.label,
      emoji: c.emoji,
      self: topicSet.has(c.slug),
      topics: c.topics.filter((t) => topicSet.has(t.slug)),
    })).filter((g) => g.self || g.topics.length > 0);

    const known = new Set(TAG_CATEGORIES.flatMap((c) => [c.slug, ...c.topics.map((t) => t.slug)]));
    const other = topics.filter((t) => !known.has(t));
    if (other.length) {
      gs.push({
        slug: '__other', label: 'Other', emoji: '🏷️', self: false,
        topics: other.map((t) => ({ slug: t, label: t })),
      });
    }
    return gs;
  }, [topics, topicSet]);

  // Which category is expanded. Follows the active topic so a deep-linked board
  // opens on the right branch; the user can override by clicking another.
  const [openCat, setOpenCat] = useState(null);
  const activeCat = getCategoryOf(activeTopic)
    || groups.find((g) => g.topics.some((t) => t.slug === activeTopic))?.slug
    || null;
  const shownCat = openCat || activeCat;
  const openGroup = groups.find((g) => g.slug === shownCat) || null;

  // The creator whose profile badge brought us here — highlighted and scrolled to.
  const focusUser = searchParams.get('user') || null;

  // Changing tabs by hand abandons that focus: the badge's board is no longer
  // the board being looked at, so dragging the highlight along would be wrong.
  const select = (next) => {
    const p = { window, metric: metricId, ...(activeTopic ? { topic: activeTopic } : {}), ...next };
    // Selecting Tags while a topic is active drops the topic rather than asking
    // the topic board for a metric it doesn't carry. The metric itself always
    // survives — switching topics must never move the user's metric choice.
    if (!metricSupportsTopics(p.metric) || !p.topic) delete p.topic;
    setSearchParams(p, { replace: true });
  };
  const setWindow = (w) => select({ window: w });
  const setMetricId = (m) => select({ metric: m });
  const setTopic = (t) => select({ topic: t });

  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['leaderboard', activeTopic, window, metricId],
    queryFn: ({ pageParam = 1 }) =>
      activeTopic
        ? fetchTopicLeaderboard({ topic: activeTopic, window, metric: metricId, limit: PAGE_SIZE, page: pageParam })
        : fetchLeaderboard({ window, metric: metricId, limit: PAGE_SIZE, page: pageParam }),
    getNextPageParam: (last) => (last.has_more ? last.page + 1 : undefined),
    staleTime: 5 * 60 * 1000,
  });

  const pages = data?.pages || [];
  const entries = pages.flatMap((p) => p.entries || []);
  const partialWatch = pages[0]?.partial_watch_data;
  const trackedSince = pages[0]?.watch_tracked_since;
  const podium = entries.slice(0, 3);
  const rest = entries.slice(3);

  const found = focusUser && entries.some((e) => e.user === focusUser);
  const exhausted = !hasNextPage || pages.length >= MAX_AUTO_PAGES;
  // Keep pulling pages until the focused creator's row is loaded, then scroll to
  // it once. `scrolled` guards against re-scrolling on every later render (e.g.
  // when the user clicks Load more themselves).
  const scrolled = useRef(null);
  useEffect(() => {
    if (!focusUser) return;
    if (scrolled.current === focusUser) return;
    if (!found) {
      if (!exhausted && !isFetchingNextPage) fetchNextPage();
      return;
    }
    const el = document.getElementById(rowId(focusUser));
    if (!el) return;
    scrolled.current = focusUser;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusUser, found, exhausted, isFetchingNextPage, fetchNextPage]);

  // Still hunting for them across pages — say so rather than showing a board
  // that silently never scrolls.
  const seeking = focusUser && !found && !exhausted;
  // On the board but past where we're willing to auto-load, or not on it at all.
  const unreachable = focusUser && !found && exhausted && !isLoading;

  return (
    <div className="leaderboard-page">
      <header className="lb-header">
        <MdOutlineLeaderboard className="lb-header-icon" />
        <div>
          <h1>Rankings</h1>
          <p>
            {metric.blurb} — top creators
            {activeTopic ? ` in ${activeTopic}` : ' on 3Speak'}.
          </p>
        </div>
      </header>

      {/* What you're ranking, then over what interval, then narrowed to a topic.
          Metrics are grouped (Video / Streaming / Boosts) so the 13 tabs stay legible. */}
      <div className="lb-tabs lb-metrics">
        {METRIC_GROUPS.map((g) => (
          <div className="lb-metric-group" key={g}>
            <span className="lb-metric-group-label">{g}</span>
            {METRICS.filter((m) => m.group === g).map((m) => (
              <button
                key={m.id}
                type="button"
                className={`lb-tab${metricId === m.id ? ' active' : ''}`}
                onClick={() => setMetricId(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className={`lb-tabs lb-windows${topicsAvailable ? '' : ' last-filter'}`}>
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`lb-tab${window === w.id ? ' active' : ''}`}
            onClick={() => setWindow(w.id)}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Hidden entirely for Tags, which isn't tracked per topic. */}
      {topicsAvailable && groups.length > 0 && (
        <>
          <div className="lb-tabs lb-topics">
            <button
              type="button"
              className={`lb-tab lb-topic${!activeTopic ? ' active' : ''}`}
              onClick={() => { setTopic(''); setOpenCat(null); }}
            >
              All topics
            </button>
            {groups.map((g) => (
              <button
                key={g.slug}
                type="button"
                className={`lb-tab lb-topic${shownCat === g.slug ? ' open' : ''}${activeTopic === g.slug ? ' active' : ''}`}
                onClick={() => {
                  setOpenCat(g.slug);
                  // '__other' is a UI bucket, not a real board — it only expands.
                  if (g.slug !== '__other') setTopic(g.slug);
                }}
              >
                {g.emoji} {g.label}
              </button>
            ))}
          </div>

          {openGroup && (
            <div className="lb-tabs lb-topics lb-subtopics">
              {openGroup.topics.map((t) => (
                <button
                  key={t.slug}
                  type="button"
                  className={`lb-tab lb-topic${activeTopic === t.slug ? ' active' : ''}`}
                  onClick={() => setTopic(t.slug)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {partialWatch && trackedSince && (
        <div className="lb-notice">
          <MdInfoOutline /> <span>{watchNotice(trackedSince)}</span>
        </div>
      )}

      {seeking && (
        <div className="lb-state">Finding @{focusUser} on this board…</div>
      )}
      {unreachable && (
        <div className="lb-notice">
          <MdInfoOutline />
          <span>@{focusUser} isn’t in the top {MAX_AUTO_PAGES * PAGE_SIZE} of this board.</span>
        </div>
      )}

      {/* Your-standing card is overall-only: the checker's per-user endpoint
          covers the five global metrics, not the per-topic boards. */}
      {user && !activeTopic && <MyStanding user={user} window={window} metric={metric} />}

      {isLoading && <div className="lb-state">Loading leaderboard…</div>}
      {isError && <div className="lb-state error">Couldn’t load the leaderboard. Try again shortly.</div>}

      {!isLoading && !isError && entries.length === 0 && (
        <div className="lb-state">No one has any {metric.label.toLowerCase()} in this window yet.</div>
      )}

      {!isLoading && !isError && entries.length > 0 && (
        <>
          <Podium entries={podium} metric={metric} focusUser={focusUser} />
          {/* Only 1–2 creators on the board: they're all on the podium, so the
              list would just be an empty bordered box. */}
          {rest.length > 0 && (
            <div className="lb-list">
              {rest.map((e) => (
                <Row
                  key={e.user}
                  entry={e}
                  metric={metric}
                  isMe={e.user === user}
                  focused={e.user === focusUser}
                />
              ))}
            </div>
          )}
          {hasNextPage && (
            <button
              type="button"
              className="lb-more"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default Leaderboard;
