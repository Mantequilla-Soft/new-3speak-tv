import { useState, useMemo, useEffect, useCallback } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { HIVE_API_URL } from '../utils/config';
import { useAppStore } from '../lib/store';
import {
  useHiveNotifications,
  NOTIF_CATEGORIES,
} from '../hooks/useHiveNotifications';
import {
  getNotificationRoute,
  getNotificationActor,
  getNotificationTypeLabel,
  formatNotifTime,
  formatNotificationMsg,
  getNotificationPostKey,
} from '../utils/notificationHelpers';
import {
  use3SpeakDetection,
  resolveRootPost,
  ensure3SpeakStatus,
} from '../utils/threeSpeakDetection';
import { groupNotifications } from '../utils/notificationGrouping';
import { useWhaleDetection } from '../utils/whaleDetection';
import threeSpeakLogo from '../assets/image/3S_mark.svg';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';
import './Notifications.scss';
import { useTranslation } from 'react-i18next';

const MAX_STACKED_AVATARS = 5;

// ──────────────────────────────────────────────────
// Time-based digest sections
// ──────────────────────────────────────────────────
function getTimeBucket(dateStr) {
  if (!dateStr) return 'older';
  const date = new Date(dateStr + (dateStr.endsWith('Z') ? '' : 'Z'));
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);
  const monthStart = new Date(todayStart);
  monthStart.setMonth(monthStart.getMonth() - 1);

  if (date >= todayStart) return 'today';
  if (date >= yesterdayStart) return 'yesterday';
  if (date >= weekStart) return 'this_week';
  if (date >= monthStart) return 'this_month';
  return 'older';
}

// Translation keys for the time-bucket headings.
const BUCKET_LABELS = {
  today: 'notifications.buckets.today',
  yesterday: 'notifications.buckets.yesterday',
  this_week: 'notifications.buckets.thisWeek',
  this_month: 'notifications.buckets.thisMonth',
  older: 'notifications.buckets.older',
};
const BUCKET_ORDER = ['today', 'yesterday', 'this_week', 'this_month', 'older'];

function bucketize(groups) {
  const buckets = {};
  for (const b of BUCKET_ORDER) buckets[b] = [];
  for (const g of groups) {
    const bucket = getTimeBucket(g.date);
    buckets[bucket].push(g);
  }
  return buckets;
}

// ──────────────────────────────────────────────────
function Notifications() {
  const { t } = useTranslation();
  const { user, authenticated } = useAppStore();
  const navigate = useNavigate();
  const [filter, setFilter] = useState('all');

  const {
    notifications,
    loading,
    loadingMore,
    hasMore,
    error,
    refetch,
    loadMore,
    unreadCount,
    markAllAsRead,
    markAsRead,
    markingAsRead,
    isUnread,
  } = useHiveNotifications(authenticated ? user : null, { limit: 50 });

  // Monthly state declared early so mergedNotifications can reference it
  const [monthNotifs, setMonthNotifs] = useState([]);
  const [monthLoading, setMonthLoading] = useState(false);

  // Don't auto-mark-all-as-read — let the user do it via the button,
  // so the "Unread" filter tab actually works.

  // Merge paginated notifications with the monthly fetch — deduplicate by id,
  // sort by date descending. This gives the list all the data we already have.
  const mergedNotifications = useMemo(() => {
    const seen = new Set();
    const all = [];
    for (const n of [...notifications, ...monthNotifs]) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      all.push(n);
    }
    all.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return all;
  }, [notifications, monthNotifs]);

  // 3Speak detection
  const postKeys = mergedNotifications.map(getNotificationPostKey).filter(Boolean);
  const is3SpeakMap = use3SpeakDetection(postKeys);

  const [rootIs3Speak, setRootIs3Speak] = useState({});
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const key of postKeys) {
        if (rootIs3Speak[key] !== undefined) continue;
        try {
          const rootKey = await resolveRootPost(key);
          const isSpeak = await ensure3SpeakStatus(rootKey);
          if (cancelled) return;
          setRootIs3Speak((prev) =>
            prev[key] === isSpeak ? prev : { ...prev, [key]: isSpeak }
          );
        } catch { /* ignore */ }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postKeys.join('|')]);

  // Whale detection
  const allActors = useMemo(() => {
    const set = new Set();
    for (const n of mergedNotifications) {
      const a = getNotificationActor(n);
      if (a) set.add(a);
    }
    return [...set];
  }, [mergedNotifications]);
  const whaleMap = useWhaleDetection(allActors);

  // Filtering
  const filtered = useMemo(() => {
    let base = mergedNotifications;
    if (filter === 'unread') {
      return base.filter((n) => isUnread(n));
    }
    if (filter !== 'all') {
      const allowed = NOTIF_CATEGORIES[filter]?.types;
      if (allowed) base = base.filter((n) => allowed.includes(n.type));
    }
    return base;
  }, [mergedNotifications, filter, isUnread]);

  // Grouping + time bucketing
  const grouped = useMemo(() => groupNotifications(filtered), [filtered]);
  const bucketed = useMemo(() => bucketize(grouped), [grouped]);

  // ─── Summary stats helper ───────────────────
  const computeSummary = (items) => {
    const votes = items.filter((n) => n.type === 'vote');
    const replies = items.filter((n) => n.type === 'reply' || n.type === 'reply_comment');
    const mentions = items.filter((n) => n.type === 'mention');
    const follows = items.filter((n) => n.type === 'follow');
    const reblogs = items.filter((n) => n.type === 'reblog');
    const transfers = items.filter((n) => n.type === 'transfer');

    let totalEarnings = 0;
    for (const v of votes) {
      const m = v.msg?.match(/\(\$([0-9]+(?:\.[0-9]+)?)\)/);
      if (m) totalEarnings += parseFloat(m[1]);
    }
    totalEarnings = Math.round(totalEarnings * 1000) / 1000;

    const uniqueVoters = new Set();
    for (const v of votes) {
      const a = getNotificationActor(v);
      if (a) uniqueVoters.add(a);
    }

    return {
      total: items.length,
      votes: votes.length,
      uniqueVoters: uniqueVoters.size,
      totalEarnings,
      replies: replies.length,
      mentions: mentions.length,
      follows: follows.length,
      reblogs: reblogs.length,
      transfers: transfers.length,
    };
  };

  const [summaryTab, setSummaryTab] = useState('week');

  const todaySummary = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    return computeSummary(notifications.filter((n) => {
      const d = new Date(n.date + (n.date.endsWith('Z') ? '' : 'Z'));
      return d >= todayStart;
    }));
  }, [notifications]);

  const weeklySummary = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    return computeSummary(notifications.filter((n) => {
      const d = new Date(n.date + (n.date.endsWith('Z') ? '' : 'Z'));
      return d >= cutoff;
    }));
  }, [notifications]);

  // ─── Monthly summary (paginated fetch until 30 days covered) ──────
  useEffect(() => {
    if (!authenticated || !user) return;
    let cancelled = false;
    setMonthLoading(true);
    setMonthNotifs([]);

    const BATCH = 100;
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    (async () => {
      const all = [];
      let lastId = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelled) return;
        try {
          const params = { account: user, limit: BATCH };
          if (lastId != null) params.last_id = lastId;

          const res = await axios.post(getHiveUrl(), {
            jsonrpc: '2.0',
            method: 'bridge.account_notifications',
            params,
            id: 1,
          });
          const batch = Array.isArray(res.data?.result) ? res.data.result : [];
          if (batch.length === 0) break;

          for (const n of batch) {
            const d = new Date(n.date + (n.date.endsWith('Z') ? '' : 'Z'));
            if (d >= monthAgo) {
              all.push(n);
            }
          }

          // Stream partial results so the UI updates progressively
          if (!cancelled) setMonthNotifs([...all]);

          // Check if the oldest notification in this batch is older than our cutoff
          const oldestDate = new Date(batch[batch.length - 1].date + (batch[batch.length - 1].date.endsWith('Z') ? '' : 'Z'));
          if (oldestDate < monthAgo) break;

          // If we got fewer than BATCH, there are no more
          if (batch.length < BATCH) break;

          lastId = batch[batch.length - 1].id;
        } catch {
          break; // silently stop on error — non-critical feature
        }
      }

      if (!cancelled) {
        setMonthNotifs([...all]);
        setMonthLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [authenticated, user]);

  const monthlySummary = useMemo(() => computeSummary(monthNotifs), [monthNotifs]);

  const getIs3Speak = (notif) => {
    const pk = getNotificationPostKey(notif);
    return pk ? (is3SpeakMap.get(pk) === true || rootIs3Speak[pk] === true) : false;
  };
  const getWhaleTier = (actor) => whaleMap.get(actor)?.tier || null;

  const handleClick = (notif) => {
    const route = getNotificationRoute(notif);
    if (!route) return;
    navigate(route);
  };

  if (!authenticated || !user) {
    return (
      <div className="notifications-page">
        <div className="notifications-empty">{t('notifications.loginRequired')}</div>
      </div>
    );
  }

  return (
    <div className="notifications-page">
      <header className="notifications-header">
        <h1 className="notifications-title">
          {t('common.nav.notifications')}
          {unreadCount > 0 && <span className="notifications-unread-chip">{t('notifications.unreadChip', { count: unreadCount })}</span>}
        </h1>
        <div className="notifications-header-actions">
          {unreadCount > 0 && (
            <button
              type="button"
              className="notifications-mark-all"
              onClick={markAllAsRead}
              disabled={markingAsRead}
              title={t('notifications.markAllTitle')}
            >
              {markingAsRead
                ? <><i className="fa-solid fa-spinner fa-spin" /> {t('notifications.marking')}</>
                : <><i className="fa-solid fa-check-double" /> {t('notifications.markAllRead')}</>
              }
            </button>
          )}
          <button
            type="button"
            className="notifications-refresh"
            onClick={() => refetch()}
            disabled={loading}
          >
            {loading ? t('notifications.refreshing') : t('common.actions.refresh')}
          </button>
        </div>
      </header>

      <div className="notifications-filters" role="tablist">
        {Object.entries(NOTIF_CATEGORIES).map(([key, cat]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={`notifications-filter-btn${filter === key ? ' active' : ''}`}
            onClick={() => setFilter(key)}
          >
            {t(cat.labelKey)}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={filter === 'unread'}
          className={`notifications-filter-btn notifications-filter-unread${filter === 'unread' ? ' active' : ''}`}
          onClick={() => setFilter('unread')}
        >
          <i className="fa-solid fa-circle" /> {t('notifications.unread')}
          {unreadCount > 0 && <span className="notifications-filter-count">{unreadCount}</span>}
        </button>
      </div>

      {/* ─── Activity Summary (tabbed) ─────── */}
      {authenticated && user && (
        <div className="notif-summary-section">
          <div className="notif-summary-header">
            <h2 className="notif-summary-title"><i className="fa-solid fa-chart-simple" /> {t('notifications.summary.title')}</h2>
            <div className="notif-summary-tabs">
              <button
                type="button"
                className={`notif-summary-tab${summaryTab === 'today' ? ' active' : ''}`}
                onClick={() => setSummaryTab('today')}
              >
                {t('notifications.summary.today')}
              </button>
              <button
                type="button"
                className={`notif-summary-tab${summaryTab === 'week' ? ' active' : ''}`}
                onClick={() => setSummaryTab('week')}
              >
                {t('notifications.summary.week')}
              </button>
              <button
                type="button"
                className={`notif-summary-tab${summaryTab === 'month' ? ' active' : ''}`}
                onClick={() => setSummaryTab('month')}
              >
                {t('notifications.summary.month')} {monthLoading && <i className="fa-solid fa-spinner fa-spin notif-summary-tab-spin" />}
              </button>
            </div>
          </div>

          {summaryTab === 'today' && (
            todaySummary.total > 0
              ? <SummaryCards summary={todaySummary} onFilter={setFilter} />
              : <div className="notif-summary-empty">{t('notifications.summary.emptyToday')}</div>
          )}

          {summaryTab === 'week' && (
            weeklySummary.total > 0
              ? <SummaryCards summary={weeklySummary} onFilter={setFilter} />
              : <div className="notif-summary-empty">{t('notifications.summary.emptyWeek')}</div>
          )}

          {summaryTab === 'month' && (
            monthLoading && monthlySummary.total === 0 ? (
              <div className="notif-summary-loading">
                <div className="notif-summary-skeleton" />
                <div className="notif-summary-skeleton" />
                <div className="notif-summary-skeleton" />
              </div>
            ) : monthlySummary.total > 0 ? (
              <>
                <SummaryCards summary={monthlySummary} onFilter={setFilter} />
                {monthLoading && <div className="notif-summary-loading-hint">{t('notifications.summary.stillLoading')}</div>}
              </>
            ) : (
              <div className="notif-summary-empty">{t('notifications.summary.emptyMonth')}</div>
            )
          )}
        </div>
      )}

      {error && (
        <div className="notifications-error">
          {t('notifications.loadError')} <button onClick={() => refetch()}>{t('common.actions.retry')}</button>
        </div>
      )}

      {!error && loading && filtered.length === 0 && (
        <div className="notifications-empty">{t('common.status.loading')}</div>
      )}

      {!error && !loading && filtered.length === 0 && (
        <div className="notifications-empty">
          {filter === 'all'
            ? t('notifications.empty.all')
            : filter === 'unread'
              ? t('notifications.empty.unread')
              : t(`notifications.empty.${filter}`)}
        </div>
      )}

      {grouped.length > 0 && (
        <>
          {BUCKET_ORDER.map((bucket) => {
            const items = bucketed[bucket];
            if (!items || items.length === 0) return null;
            return (
              <section key={bucket} className="notifications-section">
                <h2 className="notifications-section-title">{t(BUCKET_LABELS[bucket])}</h2>
                <ul className="notifications-list">
                  {items.map((group) => {
                    if (group.type === 'group') {
                      return (
                        <GroupRow

                          key={group.id}
                          group={group}
                          isUnread={isUnread}
                          is3Speak={getIs3Speak(group.items[0])}
                          getWhaleTier={getWhaleTier}
                          onClick={() => handleClick(group.items[0])}
                        />
                      );
                    }
                    const n = group.notification;
                    const actor = getNotificationActor(n);
                    const tier = getWhaleTier(actor);
                    const unread = isUnread(n);
                    const is3Speak = getIs3Speak(n);
                    return (
                      <li
                        key={group.id}
                        className={`notifications-row${unread ? ' unread' : ''}${tier ? ` notif-page-${tier}` : ''}`}
                        onClick={() => handleClick(n)}
                      >
                        <div className="notifications-avatar-wrap">
                          {actor && (
                            <HiveAvatar
                              username={actor}
                              size="small"
                              imgClassName="notifications-avatar"
                              alt={actor}
                              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                              badgeSize={10}
                            />
                          )}
                          {tier && <span className={`notifications-tier-badge tier-${tier}`}>{tier === 'whale' ? '🐋' : '🐬'}</span>}
                        </div>
                        <div className="notifications-body">
                          <div className="notifications-msg">
                            {formatNotificationMsg(n.msg) || getNotificationTypeLabel(n.type)}
                          </div>
                          <div className="notifications-meta">
                            <span className="notifications-type">{getNotificationTypeLabel(n.type)}</span>
                            <span className="notifications-dot">·</span>
                            <span className="notifications-time">{formatNotifTime(n.date)}</span>
                          </div>
                        </div>
                        {is3Speak && (
                          <img className="notifications-3speak-icon" src={threeSpeakLogo} alt="3Speak" title={t('notifications.threeSpeakVideo')} />
                        )}
                        {unread && <span className="notifications-unread-dot" aria-hidden="true" />}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          {hasMore && (
            <div className="notifications-load-more-wrap">
              <button
                type="button"
                className="notifications-load-more"
                onClick={() => {
                  const oldestId = mergedNotifications[mergedNotifications.length - 1]?.id;
                  loadMore(oldestId);
                }}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.status.loading') : t('common.actions.loadMore')}
              </button>
            </div>
          )}
          {!hasMore && mergedNotifications.length > 0 && (
            <div className="notifications-end">{t('notifications.end')}</div>
          )}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────
// Group row component (votes / follows)
// ──────────────────────────────────────────────────
// ──────────────────────────────────────────────────
// Summary cards (reused for week + month)
// ──────────────────────────────────────────────────
function SummaryCards({ summary, onFilter }) {
  const { t } = useTranslation();
  const cards = [
    summary.votes > 0 && {
      key: 'votes',
      icon: 'fa-solid fa-thumbs-up',
      value: summary.votes,
      label: t('notifications.cards.votes'),
      sub: summary.totalEarnings > 0 ? `$${summary.totalEarnings.toFixed(2)}` : null,
      detail: t('notifications.cards.voters', { count: summary.uniqueVoters }),
      filter: 'votes',
      color: 'votes',
    },
    summary.replies > 0 && {
      key: 'replies',
      icon: 'fa-solid fa-comment-dots',
      value: summary.replies,
      label: t('notifications.cards.replies'),
      filter: 'replies',
      color: 'replies',
    },
    summary.follows > 0 && {
      key: 'follows',
      icon: 'fa-solid fa-user-plus',
      value: summary.follows,
      label: t('notifications.cards.newFollowers'),
      filter: 'follows',
      color: 'follows',
    },
    summary.mentions > 0 && {
      key: 'mentions',
      icon: 'fa-solid fa-at',
      value: summary.mentions,
      label: t('notifications.cards.mentions'),
      filter: 'mentions',
      color: 'mentions',
    },
    summary.reblogs > 0 && {
      key: 'reblogs',
      icon: 'fa-solid fa-retweet',
      value: summary.reblogs,
      label: t('notifications.cards.reblogs'),
      filter: 'reblogs',
      color: 'reblogs',
    },
    summary.transfers > 0 && {
      key: 'transfers',
      icon: 'fa-solid fa-arrow-right-arrow-left',
      value: summary.transfers,
      label: t('notifications.cards.transfers'),
      filter: 'transfers',
      color: 'transfers',
    },
  ].filter(Boolean);

  if (cards.length === 0) return null;

  return (
    <div className="notif-summary-cards">
      {cards.map((c) => (
        <div
          key={c.key}
          className={`notif-summary-card notif-summary-${c.color}`}
          onClick={() => onFilter(c.filter)}
        >
          <i className={`${c.icon} notif-summary-card-icon`} />
          <span className="notif-summary-card-value">{c.value}</span>
          <span className="notif-summary-card-label">{c.label}</span>
          {c.sub && <span className="notif-summary-card-sub">{c.sub}</span>}
          {c.detail && <span className="notif-summary-card-detail">{c.detail}</span>}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────
// Group row component (votes / follows)
// ──────────────────────────────────────────────────
function GroupRow({ group, isUnread, is3Speak, getWhaleTier, onClick }) {
  const { t } = useTranslation();
  const { actors = [], items, notifType, date } = group;
  const hasUnread = items.some((n) => isUnread(n));
  const topActors = actors.slice(0, MAX_STACKED_AVATARS);
  const remaining = actors.length - MAX_STACKED_AVATARS;
  const [expanded, setExpanded] = useState(false);

  const topTier = actors.reduce((best, a) => {
    const tier = getWhaleTier(a);
    if (tier === 'whale') return 'whale';
    if (tier === 'orca' && best !== 'whale') return 'orca';
    return best;
  }, null);

  // Whole sentences per actor count: one actor, two actors, or "X and N others".
  const actorSentence = (prefix) => {
    if (actors.length <= 1) return t(`notifications.group.${prefix}One`, { user: actors[0] || '' });
    if (actors.length === 2) return t(`notifications.group.${prefix}Two`, { user: actors[0], user2: actors[1] });
    return t(`notifications.group.${prefix}Many`, { user: actors[0], count: actors.length - 1 });
  };
  let label;
  if (notifType === 'vote') {
    label = actorSentence('vote');
    if (group.totalValue > 0) label += ` ($${group.totalValue.toFixed(2)})`;
  } else if (notifType === 'follow') {
    label = actorSentence('follow');
  } else {
    label = t('notifications.group.generic', { count: items.length, type: notifType });
  }

  return (
    <>
      <li
        className={`notifications-row notifications-row-group${hasUnread ? ' unread' : ''}${topTier ? ` notif-page-${topTier}` : ''}`}
        onClick={(e) => {
          if (items.length > 1) {
            e.stopPropagation();
            setExpanded(!expanded);
          } else {
            onClick();
          }
        }}
      >
        <div className="notifications-avatar-stack">
          {topActors.map((actor, i) => (
            <HiveAvatar
              key={actor}
              username={actor}
              size="small"
              imgClassName="notifications-stacked-avatar"
              style={{ zIndex: MAX_STACKED_AVATARS - i, marginLeft: i === 0 ? 0 : -10 }}
              alt={actor}
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              badgeSize={9}
            />
          ))}
          {remaining > 0 && <span className="notifications-avatar-more">+{remaining}</span>}
        </div>
        <div className="notifications-body">
          <div className="notifications-msg">{label}</div>
          <div className="notifications-meta">
            <span className="notifications-type">{t('notifications.group.typeCount', { count: items.length, type: notifType })}</span>
            <span className="notifications-dot">·</span>
            <span className="notifications-time">{formatNotifTime(date)}</span>
            {topTier && <span className="notifications-meta-tier">{topTier === 'whale' ? '🐋' : '🐬'}</span>}
            {items.length > 1 && (
              <span className="notifications-expand-hint">{expanded ? t('notifications.group.collapse') : t('notifications.group.expand')}</span>
            )}
          </div>
        </div>
        {is3Speak && (
          <img className="notifications-3speak-icon" src={threeSpeakLogo} alt="3Speak" title={t('notifications.threeSpeakVideo')} />
        )}
        {hasUnread && <span className="notifications-unread-dot" aria-hidden="true" />}
      </li>

      {expanded && items.map((n) => {
        const actor = getNotificationActor(n);
        const tier = getWhaleTier(actor);
        return (
          <li
            key={n.id}
            className={`notifications-row notifications-row-nested${tier ? ` notif-page-${tier}` : ''}`}
            onClick={onClick}
          >
            <div className="notifications-avatar-wrap">
              {actor && (
                <HiveAvatar
                  username={actor}
                  size="small"
                  imgClassName="notifications-avatar"
                  alt={actor}
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  badgeSize={10}
                />
              )}
              {tier && <span className={`notifications-tier-badge tier-${tier}`}>{tier === 'whale' ? '🐋' : '🐬'}</span>}
            </div>
            <div className="notifications-body">
              <div className="notifications-msg">{formatNotificationMsg(n.msg)}</div>
              <div className="notifications-meta">
                <span className="notifications-time">{formatNotifTime(n.date)}</span>
              </div>
            </div>
          </li>
        );
      })}
    </>
  );
}

export default Notifications;
