import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MdChevronLeft, MdChevronRight, MdClose } from 'react-icons/md';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';
import RecapScene from '../components/Recap/RecapScene';
import { useAppStore } from '../lib/store';
import { hiveAvatarUrl, cachedProfileImage } from '../utils/avatarCache';
import { hasWebGL } from '../lib/three3d';
import { fetchUserLeaderboardStats, fetchLeaderboard, formatDuration, formatMetric, METRICS } from '../lib/leaderboardData';
import { fetchCreatorOverview, fetchCreatorTimeseries, fetchCreatorWeeklyTop, fetchCreatorAdIncome, fetchCreatorFollows } from '../lib/creatorStats';
import { fetchSupporters, fetchSupports } from '../lib/supports';
import { fetchHiveYear, fetchNewFollowers, fetchCommunityPosts, fetchIncomeYear, notExcluded } from '../lib/hiveYear';
import { fetchUploadsYear, fetchWatchedYear, usableThumb } from '../lib/recapData';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import { formatDate, formatNumber, formatTimeAgo } from '../i18n';
import './Recap.scss';

// The recap covers the last 12 months: the checker's 365-day leaderboard window
// and creator stats. In December that is the calendar year.
const WINDOW = '365d';
const DAYS = 365;
// Boards a "best spot" can come from. Streaming boards stay out: they are not
// offered on the leaderboard either.
const RANKED = METRICS.filter((m) => !['Streaming'].includes(m.group));
// TEMPORARY (2026-10-30): accounts that may open other people's recaps while
// the slides are being tested. REMOVE before the recap goes to production.
const RECAP_TESTERS = ['tibfox'];

// A standee's picture, as addresses to try in order: our own image cache
// (same origin, so no CORS and no rate limit on Hive's proxy), the site's route
// for the account's exact picture (3Speak-hosted art goes through /img/a/), and
// the original itself (some hosts, e.g. robohash.org, allow it). The scene
// draws the first that loads, else a lettered disc.
function avatarCandidates(name, image) {
  const list = [hiveAvatarUrl(name, 'large')];
  if (image) {
    list.push(cachedProfileImage(name, image, 'large'));
    if (/^https:\/\//i.test(image)) list.push(image);
  }
  return [...new Set(list)];
}

// Longest the loading screen waits for gallery thumbnails.
const THUMB_WAIT_MS = 20000;
// Steps on the best-rank staircase (the top of that board, plus the account).
const LADDER_STEPS = 12;

function useRecapData(user, isOwner) {
  const enabled = !!user;
  const lb = useQuery({
    queryKey: ['recap-lb', user],
    queryFn: () => fetchUserLeaderboardStats(user, WINDOW),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
  const ov = useQuery({
    queryKey: ['recap-overview', user],
    queryFn: () => fetchCreatorOverview(user, { days: DAYS }),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const ts = useQuery({
    queryKey: ['recap-timeseries', user],
    queryFn: () => fetchCreatorTimeseries(user, { days: DAYS }),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  const sup = useQuery({
    queryKey: ['recap-supporters', user],
    queryFn: () => fetchSupporters(user, 5),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Fans, communities and follows, from one read of the account's Hive
  // history. Runs in the background from the first slide on: it can take a
  // few seconds on big accounts and its slides come later.
  const year = useQuery({
    queryKey: ['recap-hive-year', user],
    queryFn: () => fetchHiveYear(user, { days: DAYS }),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  // What the account itself watched. Private: only on your own recap.
  const watched = useQuery({
    queryKey: ['recap-watched', user],
    queryFn: () => fetchWatchedYear(user, { days: DAYS }),
    enabled: enabled && isOwner,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Who started following this account (notifications: about 90 days back).
  const followers = useQuery({
    queryKey: ['recap-new-followers', user],
    queryFn: () => fetchNewFollowers(user, { days: DAYS }),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  // The videos behind each week's watch time (shown next to a hovered bar).
  // Optional: an older checker without the route just shows no panel.
  const weekTop = useQuery({
    queryKey: ['recap-week-top', user],
    queryFn: () => fetchCreatorWeeklyTop(user, { days: DAYS, per: 5 }),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Where the account posted: from its own post list, so a busy account's
  // whole year counts (the history scan above stops after 10 pages).
  const communities = useQuery({
    queryKey: ['recap-communities', user],
    queryFn: () => fetchCommunityPosts(user, { days: DAYS }),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  // Every upload of the window, for the uploads gallery.
  const uploads = useQuery({
    queryKey: ['recap-uploads', user],
    queryFn: () => fetchUploadsYear(user, { days: DAYS }),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Income: rewards and ad revenue from Hive history, tips from the checker.
  const income = useQuery({
    queryKey: ['recap-income', user],
    queryFn: () => fetchIncomeYear(user, { days: DAYS }),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  const tips = useQuery({
    queryKey: ['recap-tips', user],
    queryFn: () => fetchSupports(user, 1, 1),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // How each ad payout splits by kind (creator / viewer / ...), from the checker.
  const adIncome = useQuery({
    queryKey: ['recap-ad-income', user],
    queryFn: () => fetchCreatorAdIncome(user, { days: DAYS }),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  // Follows over the whole year, both directions, dated by HafSQL (the Hive
  // APIs only reach ~90 days back for followers). Falls back to them if absent.
  const follows = useQuery({
    queryKey: ['recap-follows', user],
    queryFn: () => fetchCreatorFollows(user, { days: DAYS }),
    enabled,
    staleTime: 30 * 60 * 1000,
    retry: false,
  });
  return { lb, ov, ts, sup, year, watched, followers, weekTop, communities, uploads, income, tips, adIncome, follows };
}

// Daily watch time -> every week from the one watch tracking started in (no
// earlier: there is nothing to show before it) to the end of the year. Weeks
// run Monday to Sunday, UTC; weeks still to come are null (no bar). Also
// returns where each month starts and which week is this one, for the graph's
// labels and its starting position.
const WEEK_MS = 7 * 86400000;
const mondayOf = (ms) => ms - (((new Date(ms).getUTCDay() + 6) % 7) * 86400000);
function yearOfWeeks(series, trackedSince, now = new Date()) {
  const year = now.getUTCFullYear();
  const since = trackedSince ? Date.parse(`${trackedSince}T00:00:00Z`) : NaN;
  const from = Number.isNaN(since) ? Date.UTC(year, 0, 1) : Math.max(Date.UTC(year, 0, 1), since);
  const first = mondayOf(from);
  const end = Date.UTC(year, 11, 31);
  const byDay = new Map((series || []).map((d) => [d.date, d.watchSeconds || 0]));
  const weeks = [];
  for (let start = first; start <= end; start += WEEK_MS) {
    let secs = 0;
    for (let d = 0; d < 7; d += 1) secs += byDay.get(new Date(start + d * 86400000).toISOString().slice(0, 10)) || 0;
    weeks.push({ start: new Date(start), secs: start > now.getTime() ? null : secs });
  }
  // Months that fall in the range; the first one labels the first week.
  const marks = Array.from({ length: 12 }, (_, m) => Date.UTC(year, m, 1))
    .filter((ms) => ms + 31 * 86400000 > first)
    .map((ms) => ({
      index: Math.max(0, Math.floor((ms - first) / WEEK_MS)),
      label: formatDate(new Date(ms), { month: 'short', timeZone: 'UTC' }),
    }));
  const focus = Math.min(weeks.length - 1, Math.floor((now.getTime() - first) / WEEK_MS));
  return { weeks, marks, focus };
}

// Viewer-side payout kinds (rewards for watching / listening); every other
// kind (creator, referral, ...) is revenue as a creator.
const VIEWER_KINDS = new Set(['viewer', 'audio', 'podcast']);

// The ads pillar, stacked: as creator, as viewer, and payments that combined
// both and could not be split (the checker's per-period parts split them when
// it has them). Each payment's on-chain value is shared out by those parts.
function adsSource(d, price, periods, parts) {
  const seg = { creator: { hbd: 0, hive: 0, n: 0 }, viewer: { hbd: 0, hive: 0, n: 0 }, combined: { hbd: 0, hive: 0, n: 0 } };
  const add = (key, pay, share) => {
    seg[key].hbd += pay.hbd * share;
    seg[key].hive += pay.hive * share;
    seg[key].n += 1;
  };
  (d.ads.payments || []).forEach((pay) => {
    const kinds = String(pay.kind).split('+');
    if (kinds.length === 1) {
      add(VIEWER_KINDS.has(kinds[0]) ? 'viewer' : 'creator', pay, 1);
      return;
    }
    // Only a real per-kind breakdown splits it; rows written before the payout
    // job stored `parts` come back as { "creator+viewer": x } and can't.
    const raw = pay.period && periods[pay.period];
    const split = raw && Object.keys(raw).length > 1 && !Object.keys(raw).some((k) => k.includes('+')) ? raw : null;
    const total = split ? Object.values(split).reduce((a, b) => a + (Number(b) || 0), 0) : 0;
    if (!total) { add('combined', pay, 1); return; }
    const viewerPart = Object.entries(split).reduce((a, [k, v]) => (VIEWER_KINDS.has(k) ? a + (Number(v) || 0) : a), 0) / total;
    if (viewerPart > 0) add('viewer', pay, viewerPart);
    if (viewerPart < 1) add('creator', pay, 1 - viewerPart);
  });
  const worth = (x) => x.hbd + x.hive * price;
  const segments = ['creator', 'viewer', 'combined']
    .filter((k) => seg[k].n > 0 || k !== 'combined')
    .map((k) => ({ key: `ads_${k}`, value: worth(seg[k]), posts: null, payments: seg[k].n, detail: parts([[seg[k].hbd, 'HBD'], [seg[k].hive, 'HIVE']]) }));
  return {
    id: 'ads',
    value: d.ads.hbd + d.ads.hive * price,
    stack: segments.map((x) => x.value),
    detail: parts([[d.ads.hbd, 'HBD'], [d.ads.hive, 'HIVE']]),
    segments,
  };
}

// Everything the recap links to opens in a new tab (target="_blank" on every
// Link below), so the recap stays where it was.

/**
 * "Your year on 3Speak": a creator's last 12 months as a short run of slides
 * over a calm 3D backdrop (RecapScene). Private: only ever the signed-in
 * account's own (/recap/<someone else> redirects to /recap).
 */
export default function Recap() {
  const { t } = useTranslation();
  const params = useParams();
  const viewer = useAppStore((s) => s.user);
  // Private: a recap is only ever its viewer's own. /recap/<someone else>
  // lands on your own (/recap); signed out, there is nothing to show.
  // TEMPORARY: RECAP_TESTERS may open anyone's, to test the slides.
  const raw = String(params.username || '').replace(/^@/, '').toLowerCase();
  const tester = !!viewer && RECAP_TESTERS.includes(viewer);
  const user = tester && raw && /^[a-z][a-z0-9.-]{2,15}$/.test(raw) ? raw : viewer || null;
  // Testers see every slide of the recap they open, the private ones included.
  const isOwner = !!viewer && (viewer === user || tester);
  const { lb, ov, ts, sup, year, watched, followers, weekTop, communities, uploads, income, tips, adIncome, follows } = useRecapData(user, isOwner);
  // Income by source, each in HBD at the chain's HIVE price (HBD ~ US$).
  // `detail` is the per-currency breakdown shown on hover.
  const incomeSources = useMemo(() => {
    const d = income.data;
    if (!d) return null;
    const p = d.hivePrice || 0;
    const fmt = (n, asset) => `${formatNumber(Math.round(n * 1000) / 1000)} ${asset}`;
    const parts = (list) => list.filter(([n]) => n > 0).map(([n, a]) => fmt(n, a)).join(' · ') || '0';
    const tipHbd = tips.data?.total_hbd || 0;
    const tipSats = tips.data?.total_sats || 0;
    // Post rewards split by where the post came from: a permlink among this
    // year's 3Speak uploads (videos and shorts) counts as 3Speak.
    const ours = new Set([...(uploads.data?.videos || []), ...(uploads.data?.shorts || [])].map((v) => v.permlink));
    const worth = (r) => r.hbd + (r.hive + r.hp) * p;
    const authorTotal = worth(d.author);
    const mine = { hbd: 0, hive: 0, hp: 0, posts: 0 };
    Object.entries(d.authorByPost || {}).forEach(([permlink, r]) => {
      if (!ours.has(permlink)) return;
      mine.hbd += r.hbd; mine.hive += r.hive; mine.hp += r.hp; mine.posts += 1;
    });
    const rest = {
      hbd: Math.max(0, d.author.hbd - mine.hbd),
      hive: Math.max(0, d.author.hive - mine.hive),
      hp: Math.max(0, d.author.hp - mine.hp),
      posts: Math.max(0, Object.keys(d.authorByPost || {}).length - mine.posts),
    };
    const on3Speak = worth(mine);
    return [
      {
        id: 'author',
        value: authorTotal,
        stack: [on3Speak, Math.max(0, authorTotal - on3Speak)],
        detail: parts([[d.author.hbd, 'HBD'], [d.author.hive, 'HIVE'], [d.author.hp, 'HP']]),
        // Hovering a segment of the stack shows just that part.
        segments: [
          { key: 'ours', value: on3Speak, posts: mine.posts, detail: parts([[mine.hbd, 'HBD'], [mine.hive, 'HIVE'], [mine.hp, 'HP']]) },
          { key: 'other', value: Math.max(0, authorTotal - on3Speak), posts: rest.posts, detail: parts([[rest.hbd, 'HBD'], [rest.hive, 'HIVE'], [rest.hp, 'HP']]) },
        ],
      },
      adsSource(d, p, adIncome.data?.periods || {}, parts),
      { id: 'tips', value: tipHbd, detail: parts([[tipHbd, 'HBD'], [tipSats, 'sats']]) },
    ];
  }, [income.data, tips.data, uploads.data, adIncome.data]);
  // What the pointer is over in the scene (desktop), and what a click locked
  // open: { type: 'community', name } | { type: 'tile', kind, index } | { type: 'bar', index }.
  // Touch screens step with the arrows only: invisible tap halves over the
  // scene turned every touch meant for it into a slide change as well.
  const [touchScreen] = useState(() => !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches);
  const [hoverPick, setHoverPick] = useState(null);
  const [locked, setLocked] = useState(null);

  // Every board this account placed on (streaming boards left out), best
  // first. The rank slide shows them all; clicking one switches its staircase.
  const allRanks = useMemo(() => {
    const st = lb.data?.stats || {};
    const ranks = lb.data?.ranks || {};
    return RANKED
      .filter((x) => ranks[x.id] && (st[x.id] || 0) > 0)
      .sort((a, b) => ranks[a.id] - ranks[b.id])
      .map((m) => ({ metric: m, rank: ranks[m.id], value: st[m.id] || 0 }));
  }, [lb.data]);
  const [rankMetricId, setRankMetricId] = useState(null);
  const best = allRanks.find((r) => r.metric.id === rankMetricId) || allRanks[0] || null;
  const board = useQuery({
    queryKey: ['recap-board', best?.metric.id],
    queryFn: () => fetchLeaderboard({ window: WINDOW, metric: best.metric.id, limit: LADDER_STEPS }),
    enabled: !!best,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  // Ladder steps: the top of that board, then (after a gap, if it is further
  // down) the account itself. One entry per step: { rank, user, value }.
  const lastLadder = useRef(null);
  const ladder = useMemo(() => {
    if (!best) return null;
    // Switching boards: keep the last staircase up until the new board is in,
    // rather than collapsing it to a single step for a moment.
    if (!board.data && lastLadder.current) return lastLadder.current;
    const top = (board.data?.entries || []).map((e) => ({ rank: e.rank, user: e.user, value: e[best.metric.id] || 0 }));
    // The board list leaves hidden (team / test) accounts out; the per-user
    // rank counts them, so it can be lower than the list says. When the
    // account is on the list, its place THERE is the truth (it is what the
    // leaderboard page shows), and it must not be added a second time.
    const onList = top.findIndex((e) => e.user === user);
    if (onList >= 0) return { steps: top, mine: onList, gap: false, rank: top[onList].rank };
    const me = { rank: best.rank, user, value: best.value };
    if (!top.length) return { steps: [me], mine: 0, gap: false, rank: best.rank };
    const head = top.slice(0, LADDER_STEPS - 1);
    // Further down than the list reaches: after a gap, at its own rank.
    return { steps: [...head, me], mine: head.length, gap: best.rank > head.length + 1, rank: Math.max(best.rank, head.length + 1) };
  }, [best, board.data, user]);
  useEffect(() => { if (board.data) lastLadder.current = ladder; }, [ladder, board.data]);
  const fans = { isLoading: year.isLoading, data: year.data?.fans };
  const [index, setIndex] = useState(0);
  const [barHover, setBarHover] = useState(null);
  const trackedSince = lb.data?.watch_tracked_since;
  const yearGraph = useMemo(() => yearOfWeeks(ts.data?.series, trackedSince), [ts.data, trackedSince]);
  const weeks = yearGraph.weeks;
  const weekValues = useMemo(() => weeks.map((w) => w.secs), [weeks]);
  const graphMeta = useMemo(() => ({ marks: yearGraph.marks, focus: yearGraph.focus }), [yearGraph]);
  // Community standees: picture (Hive's image proxy, which allows WebGL use),
  // name and post count, drawn in the scene.
  const communityList = communities.data?.communities;
  const ladderMeta = useMemo(() => ({
    avatar: user ? avatarCandidates(user, null) : null,
    letter: user || '?',
    mine: ladder?.mine || 0,
    gapBeforeMine: !!ladder?.gap,
    rank: ladder?.rank ?? best?.rank,
  }), [user, ladder, best]);
  const ladderValues = useMemo(() => (ladder?.steps || []).map((e) => e.value), [ladder]);
  const islandMeta = useMemo(() => ({
    items: (communityList || []).map((c) => ({
      name: c.name,
      avatar: avatarCandidates(c.name, c.image),
      title: c.title,
      label: t('recap.communities.posts', { count: c.posts }),
    })),
  }), [communityList, t]);

  // Both galleries' thumbnails start loading as soon as their lists are in
  // (during the loading screen), with the exact URLs the tiles use below.
  const galleryThumbs = (list) => ({
    long: (list?.videos || []).map((v) => (v.thumbnail ? fixVideoThumbnail({ thumbnail: v.thumbnail }, false) : null)),
    short: (list?.shorts || []).map((v) => (v.thumbnail ? fixVideoThumbnail({ thumbnail: v.thumbnail }, true) : null)),
  });
  const preloadThumbs = useMemo(() => {
    const w = galleryThumbs(watched.data);
    const u = galleryThumbs(uploads.data);
    return { long: [...w.long, ...u.long], short: [...w.short, ...u.short] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watched.data, uploads.data]);

  // Loading: every source the recap reads, in the order they are shown. The
  // first slide carries the progress until all have answered (or failed).
  const sources = [
    { key: 'stats', q: lb }, { key: 'uploads', q: uploads }, { key: 'watch', q: ts }, { key: 'audience', q: ov },
    { key: 'fans', q: year }, { key: 'income', q: income }, { key: 'communities', q: communities },
    { key: 'followers', q: followers }, { key: 'followers', q: follows }, ...(isOwner ? [{ key: 'watched', q: watched }] : []),
  ];
  // Plus the gallery thumbnails: the loading screen waits until they are
  // downloaded and on the GPU (the scene reports it), or 20 s at most so one
  // slow image host can't hold the recap up. Without WebGL there is nothing to wait for.
  const [thumbProgress, setThumbProgress] = useState({ done: 0, total: 0 });
  const [thumbTimeout, setThumbTimeout] = useState(false);
  const listsIn = !uploads.isLoading && (!isOwner || !watched.isLoading);
  const expectedThumbs = useMemo(() => new Set([
    ...preloadThumbs.long.filter(Boolean).map((u) => `${u}|l`),
    ...preloadThumbs.short.filter(Boolean).map((u) => `${u}|s`),
  ]).size, [preloadThumbs]);
  useEffect(() => {
    if (!listsIn || !expectedThumbs) return undefined;
    const timer = setTimeout(() => setThumbTimeout(true), THUMB_WAIT_MS);
    return () => clearTimeout(timer);
  }, [listsIn, expectedThumbs]);
  const thumbsReady = listsIn && (!expectedThumbs || !hasWebGL() || thumbTimeout
    || (thumbProgress.total >= expectedThumbs && thumbProgress.done >= thumbProgress.total));
  const settledData = sources.filter((x) => !x.q.isLoading).length;
  const thumbShare = expectedThumbs ? Math.min(1, thumbProgress.done / expectedThumbs) : (listsIn ? 1 : 0);
  const settled = settledData + (thumbsReady ? 1 : thumbShare);
  const ready = settledData === sources.length && thumbsReady;
  const step = sources.find((x) => x.q.isLoading)?.key || (thumbsReady ? null : 'thumbnails');
  const sourceCount = sources.length + 1;

  const slides = useMemo(() => {
    if (!lb.data || !ready) return [{ id: 'intro', mode: 'ring', pending: true }];
    const s = lb.data.stats || {};
    const videos = s.video_uploads || 0;
    const shorts = s.short_uploads || 0;
    const watchSecs = (s.video_watch_secs || 0) + (s.short_watch_secs || 0);
    const totals = ov.data?.totals || {};
    const topVideos = (ov.data?.best?.byWatchTime || []).filter((v) => v.watchSeconds > 0).slice(0, 3);
    const supporters = (sup.data?.supporters || []).filter((x) => !x.tipper || notExcluded(x.tipper));

    if (!videos && !shorts) return [{ id: 'empty', mode: 'ring' }];

    const out = [{ id: 'intro', mode: 'ring' }];
    out.push({ id: 'uploads', mode: 'gallery', count: videos + shorts, videos, shorts, gallery: uploads.data || null, atTop: true });
    if (watchSecs > 0) {
      // The year as a graph once there is a series; without one, one block per hour.
      const graph = weeks.some((w) => w.secs > 0);
      const peak = graph ? weeks.reduce((a, b) => ((b.secs || 0) > (a.secs || 0) ? b : a)) : null;
      out.push({
        id: 'watch',
        mode: graph ? 'graph' : 'tower',
        count: graph ? weeks.length : Math.ceil(watchSecs / 3600),
        watchSecs,
        peak,
        since: lb.data.watch_tracked_since,
      });
    }
    // `sessions`: watch logs keep no viewer identity, so this counts views.
    // The audience slide also lists the top fans (votes + replies on Hive),
    // which load separately; it waits with a line while they come in.
    if (totals.sessions > 0 || totals.votes > 0 || totals.comments > 0) {
      out.push({ id: 'audience', mode: 'orbit', count: totals.sessions || 40, totals });
    }
    // Top three videos and the supporters share one slide (a hand of cards).
    if (topVideos.length || supporters.length) {
      out.push({ id: 'top', mode: 'fan', count: Math.max(1, topVideos.length), topVideos, supporters, atTop: true });
    }
    if (best) out.push({ id: 'rank', mode: 'ladder', count: ladder?.steps.length || 1, rank: ladder?.rank ?? best.rank, metric: best.metric, allRanks, atTop: true });

    // The account's own side of the year: where it posted, who it followed,
    // and (own recap only) whom it watched. These load later and slot in
    // before the outro, so nothing already on screen moves.
    // Income, after the leaderboard spot: only once there is some.
    const incomeTotal = (incomeSources || []).reduce((sum, src) => sum + src.value, 0);
    if (incomeTotal > 0) {
      const adsCombined = incomeSources.find((src) => src.id === 'ads')?.segments?.some((x) => x.key === 'ads_combined');
      out.push({ id: 'income', mode: 'pillars', count: incomeSources.length, total: incomeTotal, complete: income.data.complete, adsCombined, atTop: true });
    }

    const y = year.data;
    const cm = communities.data;
    if (cm?.communities?.length) {
      out.push({ id: 'communities', mode: 'islands', count: cm.communities.length, communities: cm.communities, total: cm.total, atTop: true });
    }
    // Both directions of following: who you followed, who followed you.
    // Full year from HafSQL when the checker has it; otherwise the account's
    // history (followed) and ~90 days of notifications (followers).
    const fy = follows.data;
    const followedList = (fy ? fy.following.map((r) => r.account) : (y?.followed || [])).filter(notExcluded);
    const followerList = (fy ? fy.followers.map((r) => r.account) : (followers.data?.accounts || [])).filter(notExcluded);
    if (followedList.length || followerList.length) {
      out.push({
        id: 'followed',
        mode: 'stars',
        count: followedList.length + followerList.length,
        followed: followedList,
        total: followedList.length,
        newFollowers: followerList,
        followersSince: fy ? null : followers.data?.since || null,
      });
    }
    if (isOwner && watched.data?.creators?.length) {
      out.push({ id: 'watched', mode: 'gallery', count: watched.data.videos.length + watched.data.shorts.length, ...watched.data, gallery: watched.data, atTop: true });
    }
    out.push({ id: 'outro', mode: 'helix' });
    return out;
  }, [lb.data, ready, ov.data, sup.data, weeks, year.data, watched.data, followers.data, follows.data, communities.data, uploads.data, isOwner, best, ladder, allRanks, incomeSources, income.data]);

  // The creator's own thumbnails for the 3D tiles, most watched first,
  // through our image cache / Hive's proxy (both allow WebGL use). The
  // site's placeholder image is left out: a plain tile reads better.
  const thumbs = useMemo(() => {
    const seen = new Set([fallbackImg]);
    const sorted = [...(ov.data?.videos || [])]
      .sort((a, b) => (b.watchSeconds || 0) - (a.watchSeconds || 0))
      .filter((v) => usableThumb(v.thumbnail));
    // Videos landscape, shorts portrait (their own crop from the image cache).
    const pick = (short) => sorted
      .filter((v) => !!v.short === short)
      .map((v) => fixVideoThumbnail({ thumbnail: v.thumbnail }, short))
      .filter((u) => u && !seen.has(u) && seen.add(u))
      .slice(0, 40);
    // The top videos' own thumbnails, in rank order, for the hand of cards.
    const top = (ov.data?.best?.byWatchTime || []).slice(0, 3)
      .map((v) => (usableThumb(v.thumbnail) ? fixVideoThumbnail({ thumbnail: v.thumbnail }, false) : fallbackImg))
      .map((u) => (u === fallbackImg ? null : u));
    return { long: pick(false), short: pick(true), top };
  }, [ov.data]);

  const total = slides.length;
  const at = Math.min(index, Math.max(0, total - 1));
  const slide = slides[at];
  const go = useCallback((d) => setIndex((i) => Math.min(Math.max(0, i + d), Math.max(0, total - 1))), [total]);
  // Gallery tiles: one thumbnail per video of the slide's list.
  const galleryList = slide?.gallery;
  const galleryZoom = slide?.id === 'watched' ? 1 : 0.5; // watched: all of it; uploads: halfway
  const galleryMeta = useMemo(() => ({
    zoomStart: galleryZoom,
    longThumbs: (galleryList?.videos || []).map((v) => (v.thumbnail ? fixVideoThumbnail({ thumbnail: v.thumbnail }, false) : null)),
    shortThumbs: (galleryList?.shorts || []).map((v) => (v.thumbnail ? fixVideoThumbnail({ thumbnail: v.thumbnail }, true) : null)),
  }), [galleryList, galleryZoom]);
  const islandValues = useMemo(() => (slide?.communities || []).map((c) => c.posts), [slide?.communities]);
  const incomeValues = useMemo(() => (incomeSources || []).map((src) => src.value), [incomeSources]);
  const incomeMeta = useMemo(() => ({
    labels: (incomeSources || []).map((src) => ({ title: t(`recap.income.sources.${src.id}`), value: `$${formatNumber(Math.round(src.value * 100) / 100)}` })),
    stacks: (incomeSources || []).map((src) => src.stack || null),
  }), [incomeSources, t]);
  const sceneValues = slide?.mode === 'graph' ? weekValues
    : slide?.mode === 'islands' ? islandValues
      : slide?.mode === 'ladder' ? ladderValues
        : slide?.mode === 'pillars' ? incomeValues : undefined;
  const sceneMeta = slide?.mode === 'graph' ? graphMeta
    : slide?.mode === 'islands' ? islandMeta
      : slide?.mode === 'ladder' ? ladderMeta
        : slide?.mode === 'gallery' ? galleryMeta
          : slide?.mode === 'pillars' ? incomeMeta : undefined;
  // A click locks a panel open; otherwise it follows the hover.
  const active = locked || hoverPick;
  const weekIndex = locked?.type === 'bar' ? locked.index : barHover?.index;
  const hoveredWeek = slide?.mode === 'graph' && weekIndex != null && weeks[weekIndex]?.secs != null ? weeks[weekIndex] : null;
  const weekVideos = (hoveredWeek && weekTop.data?.weeks?.[hoveredWeek.start.toISOString().slice(0, 10)]) || [];
  const hoveredCommunity = active?.type === 'community' && (slide?.communities || []).find((c) => c.name === active.name);
  const tileCard = slide?.mode === 'gallery' && active?.type === 'tile'
    ? (active.kind === 'short' ? galleryList?.shorts : galleryList?.videos)?.[active.index] : null;
  // "Close and look around": unlock AND forget the hover, or the panel just
  // stays open on the last bar / tile touched (a phone never moves off it).
  const sceneRef = useRef(null);
  const closePanel = useCallback(() => {
    setLocked(null);
    setHoverPick(null);
    setBarHover(null);
    sceneRef.current?.clearHover();
  }, []);

  // A new slide starts with nothing locked.
  const slideId = slide?.id;
  useEffect(() => { setLocked(null); setHoverPick(null); }, [slideId]);
  const hoveredStep = slide?.mode === 'ladder' && barHover ? ladder?.steps[barHover.index] : null;
  const hoveredSource = slide?.mode === 'pillars' && barHover ? incomeSources?.[barHover.index] : null;

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (raw && raw !== user) return <Navigate to="/recap" replace />;
  if (!user) {
    return <div className="recap-page"><div className="recap-state">{t('recap.signIn')}</div></div>;
  }

  const failed = lb.isError;

  return (
    <div className="recap-page">
      <Helmet><title>{`3S | ${t('recap.pageTitle', { user })}`}</title></Helmet>
      <div className={`recap-stage${slide?.pending ? ' is-loading' : ''}`}>
        <RecapScene
          ref={sceneRef}
          mode={slide?.mode || 'ring'}
          count={slide?.count || 0}
          values={sceneValues}
          meta={sceneMeta}
          // A click locks that panel open (again = unlock; empty space = unlock).
          onPick={(pick) => setLocked((cur) => (pick && JSON.stringify(cur) !== JSON.stringify(pick) ? pick : null))}
          onPickHover={setHoverPick}
          thumbs={thumbs}
          preload={preloadThumbs}
          onPreloadProgress={setThumbProgress}
          onBarHover={setBarHover}
          // A locked card / panel: the scene holds still so the mouse can reach it.
          frozen={!!locked}
        />

        {failed && <div className="recap-state">{t('recap.error')}</div>}

        {/* Loading: only the loader, nothing else on the stage. A bar that
            fills per source, and what is being counted right now. */}
        {!failed && slide?.pending && (
          <div className="recap-state" role="status">
            <div className="recap-progress-load">
              <div className="recap-progress-load-bar">
                <span style={{ width: `${Math.round((settled / sourceCount) * 100)}%` }} />
              </div>
              <p className="recap-note">
                {step ? t(`recap.loadingSteps.${step}`, { done: thumbProgress.done, total: expectedThumbs }) : t('recap.loading')}
              </p>
              <LoadingTips />
            </div>
          </div>
        )}

        {!failed && slide && !slide.pending && (
          <>
            <div className="recap-progress" aria-label={t('recap.nav.slide', { n: at + 1, total })}>
              {slides.map((s, i) => (
                <span key={s.id} className={`recap-progress-bar${i <= at ? ' done' : ''}`} />
              ))}
            </div>

            {/* Tap left / right half to step, like stories. Not where the scene
                itself takes the pointer (graph: drag pans the year; islands:
                click a community), so there only the arrows step. */}
            {!touchScreen && !['graph', 'islands', 'gallery', 'pillars', 'ladder'].includes(slide.mode) && (
              <>
                <button type="button" className="recap-tap recap-tap--prev" aria-label={t('recap.nav.previous')} onClick={() => go(-1)} disabled={at === 0} />
                <button type="button" className="recap-tap recap-tap--next" aria-label={t('recap.nav.next')} onClick={() => go(1)} disabled={at >= total - 1} />
              </>
            )}

            <div className={`recap-slide${slide.atTop || slide.mode === 'graph' ? ' recap-slide--top' : ''}`} key={slide.id}>
              <Slide
                slide={slide}
                user={user}
                isOwner={viewer === user}
                fans={fans}
                onPickRank={setRankMetricId}
              />
            </div>

            {slide.mode === 'islands' && hoveredCommunity && (
              <SidePanel
                title={hoveredCommunity.title}
                locked={locked?.type === 'community'}
                onClose={closePanel}
                footer={<Link target="_blank" rel="noopener noreferrer" to={`/community/${hoveredCommunity.name}`}>{t('recap.panel.openCommunity')}</Link>}
              >
                {hoveredCommunity.items.map((v) => (
                  <li key={v.permlink}>
                    <Link target="_blank" rel="noopener noreferrer" to={`/@${v.author}/${v.permlink}`}>
                      {v.image
                        ? <img src={fixVideoThumbnail({ thumbnail: v.image }, false)} alt="" />
                        : <span className="recap-week-panel-blank" />}
                      <span className="recap-chip-text">
                        <span className="recap-chip-title">{v.title}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </SidePanel>
            )}
            {tileCard && (
              <VideoCardPanel card={tileCard} locked={locked?.type === 'tile'} onClose={closePanel} />
            )}
            {hoveredSource && (() => {
              // A stacked pillar's segment: 3Speak posts or elsewhere on Hive.
              const seg = barHover.segment != null ? hoveredSource.segments?.[barHover.segment] : null;
              return (
                <div className="recap-bar-tip" style={tipStyle(barHover)}>
                  <strong>{seg ? t(`recap.income.segments.${seg.key}`) : t(`recap.income.sources.${hoveredSource.id}`)}</strong>
                  <span>
                    ${formatNumber(Math.round((seg ? seg.value : hoveredSource.value) * 100) / 100)}
                    {seg?.posts != null ? ` · ${t('recap.income.rewardedPosts', { count: seg.posts })}` : ''}
                    {seg?.payments != null ? ` · ${t('recap.income.payments', { count: seg.payments })}` : ''}
                  </span>
                  <span>{seg ? seg.detail : hoveredSource.detail}</span>
                </div>
              );
            })()}
            {hoveredStep && (
              <div className="recap-bar-tip" style={tipStyle(barHover)}>
                <strong>#{hoveredStep.rank} @{hoveredStep.user}</strong>
                <span>{formatMetric(hoveredStep.value, best.metric.unit)} · {t(best.metric.labelKey)}</span>
              </div>
            )}
            {hoveredWeek && weekVideos.length > 0 && (
              <SidePanel
                title={t('recap.watch.weekOf', { date: formatDate(hoveredWeek.start, { month: 'short', day: 'numeric', timeZone: 'UTC' }) })}
                locked={locked?.type === 'bar'}
                onClose={closePanel}
              >
                {weekVideos.map((v) => (
                  <li key={v.permlink}>
                    <Link target="_blank" rel="noopener noreferrer" to={`/watch?v=${v.hiveAuthor || user}/${v.hivePermlink || v.permlink}`}>
                      {usableThumb(v.thumbnail)
                        ? <img src={fixVideoThumbnail({ thumbnail: v.thumbnail }, false)} alt="" />
                        : <span className="recap-week-panel-blank" />}
                      <span className="recap-chip-text">
                        <span className="recap-chip-title">{v.title}</span>
                        <span className="recap-chip-stats">{formatDuration(v.watchSeconds)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </SidePanel>
            )}
            {hoveredWeek && (
              <div className="recap-bar-tip" style={tipStyle(barHover)}>
                <strong>{formatDuration(hoveredWeek.secs)}</strong>
                <span>{t('recap.watch.weekOf', { date: formatDate(hoveredWeek.start, { month: 'short', day: 'numeric', timeZone: 'UTC' }) })}</span>
              </div>
            )}

            <div className="recap-nav">
              <button type="button" className="recap-nav-btn" onClick={() => go(-1)} disabled={at === 0} aria-label={t('recap.nav.previous')}>
                <MdChevronLeft size={22} />
              </button>
              <span className="recap-nav-count">{at + 1} / {total}</span>
              <button type="button" className="recap-nav-btn" onClick={() => go(1)} disabled={at >= total - 1} aria-label={t('recap.nav.next')}>
                <MdChevronRight size={22} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// How the recap is steered, one tip at a time while it loads. Mouse and touch
// get their own set (a mouse tip is wrong on a phone).
const TIP_COUNT = { mouse: 5, touch: 6 };
const TIP_MS = 4000;

function LoadingTips() {
  const { t } = useTranslation();
  const [kind] = useState(() => (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ? 'mouse' : 'touch'));
  const [n, setN] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setN((i) => (i + 1) % TIP_COUNT[kind]), TIP_MS);
    return () => clearInterval(timer);
  }, [kind]);
  return (
    <p className="recap-loading-tip" key={n}>
      <span className="recap-loading-tip-label">{t('recap.tips.label')}</span> {t(`recap.tips.${kind}.tip${n + 1}`)}
    </p>
  );
}

// The panel on the right of the stage: follows the hover, or stays open
// (scrollable, clickable, with a close button) once a click locked it.
function SidePanel({ title, locked, onClose, footer = null, children }) {
  return (
    <div className={`recap-week-panel${locked ? ' is-locked' : ''}`}>
      <div className="recap-week-panel-head">
        <p className="recap-week-panel-title">{title}</p>
      </div>
      <ul className="recap-week-panel-list">{children}</ul>
      {footer && <div className="recap-week-panel-foot">{footer}</div>}
      {locked && <PanelCloseButton onClose={onClose} />}
    </div>
  );
}

// A gallery tile's video as a Discover-style card: thumbnail with its
// length, title, creator and age. The whole card opens the video.
function VideoCardPanel({ card, locked, onClose }) {
  const { t } = useTranslation();
  const mins = Math.floor((card.duration || 0) / 60);
  const secs = String(Math.floor((card.duration || 0) % 60)).padStart(2, '0');
  return (
    <div className={`recap-week-panel recap-video-card${locked ? ' is-locked' : ''}`}>
      <Link target="_blank" rel="noopener noreferrer" to={card.href} className="recap-video-card-link">
        <span className={`recap-video-card-thumb${card.short ? ' is-short' : ''}`}>
          {card.thumbnail
            ? <img src={fixVideoThumbnail({ thumbnail: card.thumbnail }, card.short)} alt="" />
            : <span className="recap-week-panel-blank" />}
          {card.duration > 0 && <span className="recap-video-card-duration">{mins}:{secs}</span>}
        </span>
        <span className="recap-video-card-title">{card.title || t('recap.panel.untitled')}</span>
        <span className="recap-video-card-meta">
          <HiveAvatar username={card.author} size="small" className="recap-chip-avatar" />
          <span className="recap-chip-text">
            <span className="recap-chip-title">@{card.author}</span>
            {card.created && <span className="recap-chip-stats">{formatTimeAgo(new Date(card.created))}</span>}
          </span>
        </span>
      </Link>
      {locked && <PanelCloseButton onClose={onClose} />}
    </div>
  );
}

// Under a locked panel: closes it and lets the scene follow the mouse again.
function PanelCloseButton({ onClose }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="recap-panel-close-btn" onClick={onClose}>
      <MdClose size={16} aria-hidden="true" />
      {t('recap.panel.closeAndLook')}
    </button>
  );
}

// A bar tooltip's position: over the bar, but kept inside the stage (it is
// centred on x, so never closer to an edge than half its width).
const TIP_HALF = 130;
const tipStyle = (at) => ({ left: `clamp(${TIP_HALF}px, ${at.x}px, calc(100% - ${TIP_HALF}px))`, top: at.y });

// Up to 12 linked faces in a row.
function FaceRow({ names }) {
  return (
    <ul className="recap-avatars">
      {names.slice(0, 12).map((name) => (
        <li key={name}>
          <Link target="_blank" rel="noopener noreferrer" to={`/@${name}`} title={`@${name}`}>
            <HiveAvatar username={name} size="small" className="recap-chip-avatar" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Slide({ slide, user, isOwner, fans, onPickRank }) {
  const { t } = useTranslation();

  switch (slide.id) {
    case 'empty':
      return (
        <>
          <h1 className="recap-title">{t('recap.empty.title')}</h1>
          <p className="recap-sub">{t('recap.empty.sub')}</p>
          {isOwner && <Link target="_blank" rel="noopener noreferrer" className="recap-btn" to="/upload">{t('recap.empty.upload')}</Link>}
        </>
      );
    case 'intro':
      return (
        <>
          <HiveAvatar username={user} size="large" className="recap-avatar" />
          <h1 className="recap-title">{t('recap.intro.title', { user })}</h1>
          <p className="recap-sub">{t('recap.intro.sub')}</p>
        </>
      );
    case 'uploads':
      return (
        <>
          <p className="recap-kicker">{t('recap.uploads.kicker')}</p>
          <p className="recap-big">{t('recap.uploads.videos', { count: slide.videos })}</p>
          {slide.shorts > 0 && (
            <p className="recap-big recap-big--second">
              <span className="recap-and">{t('recap.uploads.and')}</span> {t('recap.uploads.shorts', { count: slide.shorts })}
            </p>
          )}
        </>
      );
    case 'watch': {
      const since = slide.since ? new Date(`${slide.since}T00:00:00Z`) : null;
      const showSince = since && Date.now() - since.getTime() < DAYS * 86400000;
      return (
        <>
          <p className="recap-kicker">{t('recap.watch.kicker')}</p>
          <p className="recap-big">{formatDuration(slide.watchSecs)}</p>
          <p className="recap-sub">{slide.peak ? t('recap.watch.graph') : t('recap.watch.sub')}</p>
          {slide.peak && (
            <p className="recap-sub recap-peak">
              {t('recap.watch.bestWeek', {
                date: formatDate(slide.peak.start, { month: 'long', day: 'numeric', timeZone: 'UTC' }),
                time: formatDuration(slide.peak.secs),
              })}
            </p>
          )}
          {slide.peak && <p className="recap-note">{t('recap.watch.panHint')}</p>}
          {showSince && <p className="recap-note">{t('recap.watch.since', { date: formatDate(since, { month: 'long', day: 'numeric', year: 'numeric' }) })}</p>}
        </>
      );
    }
    case 'audience':
      return (
        <>
          {slide.totals.sessions > 0 && (
            <>
              <p className="recap-kicker">{t('recap.audience.kicker')}</p>
              <p className="recap-big">{t('recap.audience.views', { count: slide.totals.sessions })}</p>
            </>
          )}
          <p className="recap-sub">
            {t('recap.audience.votes', { count: slide.totals.votes || 0 })}
            {' · '}
            {t('recap.audience.comments', { count: slide.totals.comments || 0 })}
          </p>
          <p className="recap-kicker recap-kicker--gap">{t('recap.audience.fans')}</p>
          {fans.isLoading && <p className="recap-note">{t('recap.audience.fansLoading')}</p>}
          {fans.data?.length > 0 && (
            <ul className="recap-chips">
              {fans.data.map((f) => (
                <li key={f.account}>
                  <Link target="_blank" rel="noopener noreferrer" to={`/@${f.account}`}>
                    <HiveAvatar username={f.account} size="small" className="recap-chip-avatar" />
                    <span className="recap-chip-text">
                      <span className="recap-chip-title">@{f.account}</span>
                      <span className="recap-chip-stats">
                        {t('recap.audience.votes', { count: f.votes })}
                        {' · '}
                        {t('recap.audience.comments', { count: f.comments })}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!fans.isLoading && !fans.data?.length && <p className="recap-note">{t('recap.audience.noFans')}</p>}
        </>
      );
    case 'top':
      // Top three videos and the people who tipped: one slide over the hand of cards.
      return (
        <>
          {slide.topVideos.length > 0 && (
            <>
              <p className="recap-kicker">{t('recap.top.kicker')}</p>
              <ol className="recap-chips recap-chips--list">
                {slide.topVideos.map((v, i) => (
                  <li key={v.permlink}>
                    <Link target="_blank" rel="noopener noreferrer" to={`/watch?v=${v.hiveAuthor || user}/${v.hivePermlink || v.permlink}`}>
                      <span className="recap-chip-rank">{i + 1}</span>
                      <span className="recap-chip-text">
                        <span className="recap-chip-title">{v.title}</span>
                        <span className="recap-chip-stats">{t('recap.top.watched', { time: formatDuration(v.watchSeconds) })}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </>
          )}
          {slide.supporters.length > 0 && (
            <div className="recap-bottom">
              <p className="recap-kicker">{t('recap.supporters.kicker')}</p>
              <ul className="recap-chips">
                {slide.supporters.map((sp, i) => (
                  <li key={sp.tipper || `anon-${i}`}>
                    {sp.tipper ? (
                      <Link target="_blank" rel="noopener noreferrer" to={`/@${sp.tipper}`}>
                        <HiveAvatar username={sp.tipper} size="small" className="recap-chip-avatar" />
                        <span className="recap-chip-title">@{sp.tipper}</span>
                      </Link>
                    ) : (
                      <span className="recap-chip-static">{t('recap.supporters.anonymous')}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      );
    case 'income':
      return (
        <>
          <p className="recap-kicker">{t('recap.income.kicker')}</p>
          <p className="recap-big">≈ ${formatNumber(Math.round(slide.total))}</p>
          <p className="recap-sub">{t('recap.income.sub')}</p>
          {/* The post-rewards pillar is stacked: say what its two colours are. */}
          <p className="recap-legend">
            <span className="recap-legend-name">{t('recap.income.sources.author')}:</span>
            <i className="recap-legend-swatch recap-legend-swatch--red" />
            {t('recap.income.legendOurs')}
            <i className="recap-legend-swatch recap-legend-swatch--grey" />
            {t('recap.income.legendOther')}
          </p>
          <p className="recap-legend">
            <span className="recap-legend-name">{t('recap.income.sources.ads')}:</span>
            <i className="recap-legend-swatch recap-legend-swatch--red" />
            {t('recap.income.legendCreator')}
            <i className="recap-legend-swatch recap-legend-swatch--grey" />
            {t('recap.income.legendViewer')}
            {slide.adsCombined && (
              <>
                <i className="recap-legend-swatch recap-legend-swatch--light" />
                {t('recap.income.legendCombined')}
              </>
            )}
          </p>
          <p className="recap-note">{t('recap.income.note')} {t('recap.income.logScale')}</p>
          {!slide.complete && <p className="recap-note">{t('recap.income.partial')}</p>}
          <p className="recap-note recap-note--hover">{t('recap.income.hint')}</p>
        </>
      );
    case 'communities':
      // The communities themselves stand on the discs in the scene (click one
      // to open it); the text stays a headline.
      return (
        <>
          <p className="recap-kicker">{t('recap.communities.kicker')}</p>
          <p className="recap-big">{t('recap.communities.count', { count: slide.total })}</p>
        </>
      );
    case 'followed':
      // Both directions of following, each in its own solid card.
      return (
        <div className="recap-cards">
          {slide.total > 0 && (
            <div className="recap-card">
              <p className="recap-kicker">{t('recap.followed.kicker')}</p>
              <p className="recap-big recap-big--second">{t('recap.followed.count', { count: slide.total })}</p>
              <FaceRow names={slide.followed} />
            </div>
          )}
          {slide.newFollowers.length > 0 && (
            <div className="recap-card">
              <p className="recap-kicker">
                {slide.followersSince
                  ? t('recap.followers.kicker', { date: formatDate(slide.followersSince, { month: 'long', day: 'numeric' }) })
                  : t('recap.followers.kickerYear')}
              </p>
              <p className="recap-big recap-big--second">{t('recap.followers.count', { count: slide.newFollowers.length })}</p>
              <FaceRow names={slide.newFollowers} />
            </div>
          )}
        </div>
      );
    case 'watched':
      return (
        <>
          <p className="recap-kicker">{t('recap.watched.kicker')}</p>
          <ul className="recap-chips">
            {slide.creators.map((c) => (
              <li key={c.account}>
                <Link target="_blank" rel="noopener noreferrer" to={`/@${c.account}`}>
                  <HiveAvatar username={c.account} size="small" className="recap-chip-avatar" />
                  <span className="recap-chip-text">
                    <span className="recap-chip-title">@{c.account}</span>
                    <span className="recap-chip-stats">{t('recap.watched.videos', { count: c.videos })}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      );
    case 'rank':
      // The selected spot big, every spot as a card below it: clicking one
      // rebuilds the staircase from that board's real top (hover a step).
      return (
        <>
          <p className="recap-kicker">{t('recap.rank.kicker')}</p>
          <p className="recap-big">#{slide.rank}</p>
          <Link target="_blank" rel="noopener noreferrer" className="recap-sub recap-link" to={`/leaderboard?window=${WINDOW}&metric=${slide.metric.id}&user=${encodeURIComponent(user)}`}>
            {t('recap.rank.board', { board: t(slide.metric.labelKey) })}
          </Link>
          {slide.allRanks.length > 1 && (
            <ul className="recap-chips recap-chips--ranks">
              {slide.allRanks.map((r) => (
                <li key={r.metric.id}>
                  <button
                    type="button"
                    className={r.metric.id === slide.metric.id ? 'active' : ''}
                    aria-pressed={r.metric.id === slide.metric.id}
                    onClick={() => onPickRank(r.metric.id)}
                  >
                    <span className="recap-rank-badge">#{r.metric.id === slide.metric.id ? slide.rank : r.rank}</span>
                    <span className="recap-chip-title">{t(r.metric.labelKey)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="recap-note recap-note--hover">{t('recap.rank.hint')}</p>
        </>
      );
    case 'outro':
    default:
      return (
        <>
          <h1 className="recap-title">{t('recap.outro.title')}</h1>
          <p className="recap-sub">{t('recap.outro.sub')}</p>
          <div className="recap-actions">
            <Link target="_blank" rel="noopener noreferrer" className="recap-btn" to={`/@${user}`}>{t('recap.outro.channel')}</Link>
          </div>
        </>
      );
  }
}
