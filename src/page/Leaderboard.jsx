import { useCallback, useEffect, useRef, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';
import { useAppStore } from '../lib/store';
import { getRelationshipBetweenAccounts } from '../hive-api/api';
import { followWithAioha, isLoggedIn } from '../hive-api/aioha';
import { toastIn } from '../utils/toast';
import { TAG_CATEGORIES, getCategoryOf } from '../utils/tagsV2';
import {
  WINDOWS,
  METRICS,
  BOARD_TYPES,
  boardTypeOf,
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
import { useTranslation } from 'react-i18next';
import { t as tNow, formatDate } from '../i18n';
import { Banner, Button, Chip, EmptyState, Segmented } from '../components/v2/ui';
import { cx } from '../components/v2/helpers';
import { Icon } from '../components/v2/Icon';
import './Leaderboard.scss';

const PAGE_SIZE = 50;

// Follow toasts are headed "Profile", like the other follow buttons.
const toast = toastIn('Profile');

// The metric groups of 45c, in the order the metrics are listed.
const GROUPS = [
  { id: 'Video', labelKey: 'misc.leaderboard.groups.video' },
  { id: 'Streaming', labelKey: 'misc.leaderboard.groups.streaming' },
  { id: 'Stories', labelKey: 'misc.leaderboard.groups.stories' },
];

// Arriving from a profile badge (?user=), the board keeps loading pages until it
// reaches that creator's row. Bounded so a long-tail rank can't turn one click
// into an unbounded crawl of the whole board.
const MAX_AUTO_PAGES = 8;

const rowId = (user) => `lb-entry-${user}`;

function watchNotice(sinceIso) {
  const d = new Date(sinceIso);
  const since = Number.isNaN(d.getTime())
    ? sinceIso
    : formatDate(d, { month: 'short', day: 'numeric', year: 'numeric' });
  return tNow('badges.leaderboard.watchNotice', { since });
}

// Top 3 get the podium (26b): three cards standing on a common baseline, the
// winner in the middle and taller, each card's content at its foot. Everyone
// else falls through to the ranked rows below. A thin board (one or two
// creators, common on a quiet topic) still gets all three places, the
// unclaimed ones as dashed placeholders.
function Podium({ entries, metric, focusUser }) {
  const { t } = useTranslation();
  if (!entries.length) return null;
  const slot = (rank) => entries[rank - 1] || { rank, placeholder: true };
  // Visual order puts the winner in the middle: 2nd, 1st, 3rd.
  const order = [slot(2), slot(1), slot(3)];
  const unit = t(`misc.leaderboard.metricsInSentence.${metric.id}`);
  return (
    <div className="lb-podium">
      {order.map((e) => (e.placeholder ? (
        <div
          key={`empty-${e.rank}`}
          className={`lb-podium-slot lb-rank-${e.rank} empty`}
          aria-hidden="true"
        >
          <span className="lb-podium-medal num">{e.rank}</span>
          <span className="lb-podium-avatar-empty" />
          <b className="lb-podium-user">{t('badges.leaderboard.unclaimed')}</b>
          <span className="lb-podium-value"><span className="num">—</span> {unit}</span>
        </div>
      ) : (
        <Link
          key={e.user}
          to={`/@${e.user}`}
          id={rowId(e.user)}
          className={`lb-podium-slot lb-rank-${e.rank}${e.user === focusUser ? ' focused' : ''}`}
        >
          <span className="lb-podium-medal num">{e.rank}</span>
          <HiveAvatar username={e.user} size="medium" className="lb-podium-avatar" badgeSize={14} />
          <b className="lb-podium-user">{e.user}</b>
          <span className="lb-podium-value"><span className="num">{formatMetric(e[metric.id], metric.unit)}</span> {unit}</span>
        </Link>
      )))}
    </div>
  );
}

// Follow at the end of a row (26b): accent "Follow", quiet "Following". The
// relationship is read only once the row scrolls into view, so a page of 50
// rows does not ask Hive 50 questions up front.
function RowFollow({ author }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const ref = useRef(null);
  const [seen, setSeen] = useState(false);
  const [following, setFollowing] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    const io = new IntersectionObserver((list) => {
      if (list.some((x) => x.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen || !user || author === user) return undefined;
    let live = true;
    getRelationshipBetweenAccounts(user, author).then((r) => {
      if (live && r?.follows != null) setFollowing(!!r.follows);
    }).catch(() => {});
    return () => { live = false; };
  }, [seen, author, user]);

  const toggle = useCallback(() => {
    if (busy || following === null) return;
    const willFollow = !following;
    setBusy(true);
    setFollowing(willFollow);
    followWithAioha(author, willFollow)
      .then(() => toast.success(willFollow ? t('audio.author.followed', { author }) : t('audio.author.unfollowed', { author })))
      .catch((err) => { setFollowing(!willFollow); toast.error(err?.message || t('audio.author.failed')); })
      .finally(() => setBusy(false));
  }, [author, following, busy, t]);

  if (author === user) return <span className="lb-row-follow" ref={ref} aria-hidden="true" />;
  return (
    <span className="lb-row-follow" ref={ref}>
      <Button
        variant={following ? 'secondary' : 'primary'}
        size={40}
        block
        className={cx('lb-follow', following && 'is-following')}
        onClick={toggle}
        disabled={busy || following === null}
        aria-pressed={!!following}
        trailing={following ? 'check' : 'person_add'}
      >
        {following ? t('common.actions.following') : t('common.actions.follow')}
      </Button>
    </span>
  );
}

// The name is the row's link and stretches over the whole row; the Follow
// button sits above it as its own target.
function Row({ entry, metric, isMe, focused, follow }) {
  return (
    <div
      id={rowId(entry.user)}
      className={`lb-row${isMe ? ' me' : ''}${focused ? ' focused' : ''}${follow ? ' has-follow' : ''}`}
    >
      <span className="lb-row-rank num">{entry.rank}</span>
      <HiveAvatar username={entry.user} size="small" className="lb-row-avatar" />
      <Link className="lb-row-user" to={`/@${entry.user}`}>{entry.user}</Link>
      <span className="lb-row-value num">{formatMetric(entry[metric.id], metric.unit)}</span>
      {follow && <RowFollow author={entry.user} />}
    </div>
  );
}

// The signed-in user's own standing, pinned above the board so they don't have
// to scroll for it. A user with no activity in the window has no row at all —
// the checker reports that as zeros with a null rank.
function MyStanding({ user, window, metric }) {
  const { t } = useTranslation();
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
      <span className="lb-me-rank num">{rank ? `#${rank}` : '—'}</span>
      <HiveAvatar username={user} size="small" className="lb-row-avatar" />
      <span className="lb-me-text">
        <b className="lb-me-user">{user}</b>
        {!rank && <span className="lb-me-empty">{t('badges.leaderboard.noActivity')}</span>}
      </span>
      <span className="lb-me-value">
        <span className="num">{formatMetric(value, metric.unit)}</span>
        <small>{t(metric.labelKey)}</small>
      </span>
    </div>
  );
}

function Leaderboard() {
  const { t } = useTranslation();
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
  const boardType = boardTypeOf(metricId);
  // Streaming only shows while a badge link has it selected (see BOARD_TYPES).
  const shownTypes = BOARD_TYPES.filter((bt) => !bt.deepLinkOnly || bt.id === boardType.id);

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
      label: t(c.labelKey),
      emoji: c.emoji,
      self: topicSet.has(c.slug),
      topics: c.topics.filter((tp) => topicSet.has(tp.slug)).map((tp) => ({ ...tp, label: t(tp.labelKey) })),
    })).filter((g) => g.self || g.topics.length > 0);

    const known = new Set(TAG_CATEGORIES.flatMap((c) => [c.slug, ...c.topics.map((tp) => tp.slug)]));
    const other = topics.filter((tp) => !known.has(tp));
    if (other.length) {
      gs.push({
        slug: '__other', label: t('badges.leaderboard.otherTopics'), emoji: '🏷️', self: false,
        topics: other.map((tp) => ({ slug: tp, label: tp })),
      });
    }
    return gs;
  }, [topics, topicSet, t]);

  // Which category is expanded. Follows the active topic so a deep-linked board
  // opens on the right branch; the user can override by clicking another.
  const [openCat, setOpenCat] = useState(null);
  const activeCat = getCategoryOf(activeTopic)
    || groups.find((g) => g.topics.some((tp) => tp.slug === activeTopic))?.slug
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
  const setTopic = (tp) => select({ topic: tp });

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
  // Follow buttons on the rows need a Hive account that can sign.
  const canFollow = !!user && isLoggedIn();
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
      {/* The time range applies to every board, so it sits with the title as the
          page's one global filter (design 26b). */}
      <header className="lb-header">
        <h1>{t('badges.leaderboard.title')}</h1>
        <Segmented
          className="lb-window-switch"
          label={t('misc.leaderboard.timeRange')}
          options={WINDOWS.map((w) => ({ value: w.id, label: t(w.labelKey) }))}
          value={window}
          onChange={setWindow}
          size={36}
          block={false}
        />
      </header>

      {/* What is ranked (design 45c): every metric as a chip under its group's
          eyebrow (Video, Streaming, Stories), then one line saying what the
          picked one counts, then the topics. Streaming only shows while a
          badge link has it selected (see BOARD_TYPES). */}
      <section className="lb-filters">
        {GROUPS.filter((g) => g.id !== 'Streaming' || shownTypes.some((bt) => bt.id === 'streams')).map((g) => (
          <div className="lb-group" key={g.id}>
            <div className="v2-eyebrow lb-group-label">{t(g.labelKey)}</div>
            <div className="v2-chips lb-types" role="group" aria-label={t(g.labelKey)}>
              {METRICS.filter((m) => m.group === g.id).map((m) => (
                <Chip key={m.id} selected={metricId === m.id} onClick={() => setMetricId(m.id)}>
                  {t(m.labelKey)}
                </Chip>
              ))}
            </div>
          </div>
        ))}
        <p className="lb-blurb">
          {activeTopic
            ? t('badges.leaderboard.subtitleTopic', { blurb: t(metric.blurbKey), topic: activeTopic })
            // 45c: "Peak viewers: best concurrent viewers (a high-water mark, not a sum)."
            : t('badges.leaderboard.explain', { label: t(metric.labelKey), blurb: t(`misc.leaderboard.blurbsInSentence.${metric.id}`) })}
        </p>

        {/* Hidden entirely for Tags, which isn't tracked per topic. */}
        {topicsAvailable && groups.length > 0 && (
          <>
            <div className="v2-chips lb-topics">
              <Chip
                size={28}
                selected={!activeTopic}
                onClick={() => { setTopic(''); setOpenCat(null); }}
              >
                {t('badges.leaderboard.allTopics')}
              </Chip>
              {groups.map((g) => (
                <Chip
                  key={g.slug}
                  size={28}
                  // The board being shown is ink; an expanded category that is
                  // not itself the board is cyan, so it reads weaker.
                  selected={activeTopic === g.slug || shownCat === g.slug}
                  tone={activeTopic === g.slug ? undefined : 'cyan'}
                  className="lb-topic"
                  onClick={() => {
                    setOpenCat(g.slug);
                    // '__other' is a UI bucket, not a real board: it only expands.
                    if (g.slug !== '__other') setTopic(g.slug);
                  }}
                >
                  {g.label}
                </Chip>
              ))}
            </div>

            {openGroup && openGroup.topics.length > 0 && (
              <div className="v2-chips lb-topics lb-subtopics">
                {openGroup.topics.map((tp) => (
                  <Chip
                    key={tp.slug}
                    size={28}
                    selected={activeTopic === tp.slug}
                    className="lb-topic"
                    onClick={() => setTopic(tp.slug)}
                  >
                    {tp.label}
                  </Chip>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {partialWatch && trackedSince && (
        <Banner tone="info" className="lb-notice">{watchNotice(trackedSince)}</Banner>
      )}

      {seeking && (
        <div className="lb-state v2-meta">
          <Icon name="progress_activity" size={16} className="v2-spin" /> {t('badges.leaderboard.finding', { user: focusUser })}
        </div>
      )}
      {unreachable && (
        <Banner tone="neutral" className="lb-notice">
          {t('badges.leaderboard.notInTop', { user: focusUser, n: MAX_AUTO_PAGES * PAGE_SIZE })}
        </Banner>
      )}

      {/* Your-standing card is overall-only: the checker's per-user endpoint
          covers the five global metrics, not the per-topic boards. */}
      {/* Only above a board that has people on it: on an empty one (nobody has
          posted a story yet) a lone "you: 0" row reads as a board of one. */}
      {user && !activeTopic && entries.length > 0 && <MyStanding user={user} window={window} metric={metric} />}

      {isLoading && (
        <div className="lb-skeleton" aria-label={t('badges.leaderboard.loading')}>
          <div className="lb-skeleton-podium">
            {[0, 1, 2].map((i) => <div key={i} className="v2-skeleton" />)}
          </div>
          {[0, 1, 2, 3].map((i) => <div key={i} className="v2-skeleton lb-skeleton-row" />)}
        </div>
      )}
      {isError && <div className="v2-failure lb-state-card"><b>{t('badges.leaderboard.loadError')}</b></div>}

      {!isLoading && !isError && entries.length === 0 && (
        <EmptyState className="lb-state-card" icon="leaderboard" title={t('badges.leaderboard.empty', { metric: t(`misc.leaderboard.metricsInSentence.${metric.id}`) })} />
      )}

      {!isLoading && !isError && entries.length > 0 && (
        <>
          <Podium key={`${activeTopic}|${window}|${metricId}`} entries={podium} metric={metric} focusUser={focusUser} />
          {/* Only 1–2 creators on the board: they're all on the podium, so the
              list would just be an empty box. */}
          {rest.length > 0 && (
            <div className="lb-list">
              {rest.map((e) => (
                <Row
                  key={e.user}
                  entry={e}
                  metric={metric}
                  isMe={e.user === user}
                  focused={e.user === focusUser}
                  follow={canFollow}
                />
              ))}
            </div>
          )}
          {hasNextPage && (
            <Button
              variant="secondary"
              className="lb-more"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              loading={isFetchingNextPage}
              center
            >
              {isFetchingNextPage ? t('common.status.loading') : t('common.actions.loadMore')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default Leaderboard;
