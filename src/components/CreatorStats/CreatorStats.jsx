import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import {
  fetchCreatorOverview, fetchCreatorTimeseries, fetchCreatorDemographics, fetchVideoAnalytics, fetchCreatorFollows,
  fmtDuration, fmtCount, timeAgo, countryFlag, countryName, countryLatLng,
} from '../../lib/creatorStats';
import { getFollowers } from '../../hive-api/api';
import { Segmented, Button, Icon } from '../v2/ui';
import { Link } from 'react-router-dom';

// The "Your year on 3Speak" link. OFF until the recap launches (planned with a
// popup around 2026-12-20); /recap itself still works by its address.
const RECAP_LINK_VISIBLE = false;
import VideoStats from './VideoStats';
import { WORLD_LAND_PATH } from '../../lib/worldMapPath';
import './CreatorStats.scss';
import { useTranslation, Trans } from 'react-i18next';
import { getLanguage } from '../../i18n';

const RANGES = [{ d: 7, l: 'stats.ranges.d7' }, { d: 28, l: 'stats.ranges.d28' }, { d: 90, l: 'stats.ranges.d90' }, { d: 0, l: 'stats.ranges.all' }];
const CONTENTS = [{ k: 'all', l: 'stats.content.all' }, { k: 'videos', l: 'stats.content.videos' }, { k: 'shorts', l: 'stats.content.shorts' }];
const SORTS = [
  { key: 'watchSeconds', label: 'stats.metrics.watchTime', fmt: fmtDuration },
  { key: 'sessions', label: 'stats.metrics.views', fmt: fmtCount },
  { key: 'avgPct', label: 'stats.metrics.avgPct', fmt: (v) => `${v}%` },
  { key: 'votes', label: 'stats.metrics.votes', fmt: fmtCount },
  { key: 'comments', label: 'stats.metrics.comments', fmt: fmtCount },
  { key: 'payout', label: 'stats.metrics.payout', fmt: (v) => `$${Number(v || 0).toFixed(2)}` },
];
// Translation-key suffixes for the day rows (stats.days.short.* / stats.days.initial.*).
const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
// Friendly names for the view `source` field (watchTracking.js): translation keys.
const SOURCE_LABELS = { '3speak': 'stats.sources.threespeak', player: 'stats.sources.player' };
// Hive makes a block every 3 seconds: 28,800 a day. The follows endpoint dates
// each follow by its block, so a period is a block window back from the head.
const BLOCKS_PER_DAY = 28800;
// The stats endpoints only answer for 7, 28, 90 and 365 days. The previous
// period of a range comes from the daily series of the next range up.
const LONGER = { 7: 28, 28: 90, 90: 365 };

// Country name in the UI language (Intl), falling back to the lib's English name.
function regionName(code) {
  if (!code) return countryName(code);
  try {
    return new Intl.DisplayNames([getLanguage()], { type: 'region' }).of(code.toUpperCase()) || countryName(code);
  } catch { return countryName(code); }
}

// Weekday name in the UI language. 2023-01-01 was a Sunday (index 0 of DOW).
function weekdayName(d) {
  try {
    return new Date(Date.UTC(2023, 0, 1 + d)).toLocaleDateString(getLanguage(), { weekday: 'long', timeZone: 'UTC' });
  } catch { return DOW[d]; }
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// "+12%" against the previous period of the same length; null when there is
// nothing to compare with (All, or no data before).
function delta(cur, prev) {
  if (prev == null || !(prev > 0)) return null;
  const d = Math.round(((cur - prev) / prev) * 100);
  return `${d > 0 ? '+' : ''}${d}%`;
}

// ── Trend (31a): this period in the accent, the previous one dashed in cyan. ──
function TrendChart({ values, prev, dates, fmt }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const n = values?.length || 0;
  const showPrev = Array.isArray(prev) && prev.length > 1;
  const max = Math.max(1, ...(values || []), ...(showPrev ? prev : []));
  const has = n > 1 && (values.some((v) => v > 0) || (showPrev && prev.some((v) => v > 0)));

  const paths = useMemo(() => {
    if (!has) return { cur: '', prev: '' };
    const line = (vals) => {
      const m = vals.length;
      if (m < 2) return '';
      return `M${vals.map((v, i) => `${((i / (m - 1)) * 100).toFixed(2)},${(100 - (v / max) * 88 - 6).toFixed(2)}`).join(' L')}`;
    };
    return { cur: line(values), prev: showPrev ? line(prev) : '' };
  }, [values, prev, showPrev, max, has]);

  const onMove = useCallback((e) => {
    const el = wrapRef.current; if (!el || !n) return;
    const cx = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    setHover(Math.min(n - 1, Math.round(frac * (n - 1))));
  }, [n]);

  if (!has) return <div className="cs-trend cs-trend--empty">{t('stats.trend.empty')}</div>;

  return (
    <div className="cs-trend" ref={wrapRef}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="cs-trend-svg" aria-hidden="true">
        {paths.prev && <path className="cs-trend-prev" d={paths.prev} vectorEffect="non-scaling-stroke" />}
        <path className="cs-trend-line" d={paths.cur} vectorEffect="non-scaling-stroke" />
      </svg>
      {hover != null && (
        <>
          <div className="cs-trend-cursor" style={{ left: `${(hover / (n - 1)) * 100}%` }} />
          <div className="cs-trend-tip" style={{ left: `${(hover / (n - 1)) * 100}%` }}>
            <strong>{fmt(values[hover])}</strong>
            {dates?.[hover] && <span>{dates[hover].slice(5)}</span>}
          </div>
        </>
      )}
    </div>
  );
}

// ── Sorted bars (country / device / browser) for the Breakdown view. ──
function MiniBars({ items, labelKey, renderLabel, total }) {
  const { t } = useTranslation();
  if (!items?.length) return <div className="cs-chart-empty">{t('stats.noData')}</div>;
  const sum = total || items.reduce((s, i) => s + (i.sessions ?? i.viewers ?? 0), 0);
  return (
    <div className="cs-bars">
      {items.slice(0, 8).map((it, i) => {
        const v = it.sessions ?? it.viewers ?? 0;
        const p = pct(v, sum);
        return (
          <div className="cs-bar" key={it[labelKey]}>
            <div className="cs-bar-row">
              <span className="cs-bar-label">{renderLabel ? renderLabel(it) : it[labelKey]}</span>
              <b className="cs-bar-val" title={fmtCount(v)}>{p}%</b>
            </div>
            <span className="cs-bar-track"><span className={`cs-bar-fill${i === 0 ? ' is-accent' : i === 1 ? ' is-cyan' : ''}`} style={{ width: `${p}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

// ── World bubble map (country centroids sized by watch sessions). ──
const WorldMap = memo(function WorldMap({ byCountry }) {
  const { t } = useTranslation();
  const pts = (byCountry || []).map((c) => ({ ...c, ll: countryLatLng(c.country) })).filter((c) => c.ll);
  if (!pts.length) return <div className="cs-chart-empty">{t('stats.demo.empty')}</div>;
  const max = Math.max(1, ...pts.map((c) => c.viewers));
  const top = pts.reduce((a, b) => (b.viewers > a.viewers ? b : a), pts[0]);
  return (
    <div className="cs-map">
      <svg viewBox="0 0 360 180" preserveAspectRatio="xMidYMid meet" className="cs-map-svg" role="img" aria-label={t('stats.demo.viewerLocations')}>
        {WORLD_LAND_PATH && <path d={WORLD_LAND_PATH} className="cs-map-land" />}
        {pts.map((c) => {
          const cx = c.ll[1] + 180;
          const cy = 90 - c.ll[0];
          const r = 3 + Math.sqrt(c.viewers / max) * 10;
          return (
            <circle key={c.country} cx={cx} cy={cy} r={r} className="cs-map-bubble">
              <title>{t('stats.demo.mapBubble', { country: regionName(c.country), count: c.viewers })}</title>
            </circle>
          );
        })}
      </svg>
      {/* The leading country is labelled on the map (45a). */}
      <span
        className="cs-map-label"
        style={{ left: `${((top.ll[1] + 180) / 360) * 100}%`, top: `${((90 - top.ll[0]) / 180) * 100}%` }}
      >
        {t('stats.demo.mapBubble', { country: regionName(top.country), count: top.viewers })}
      </span>
    </div>
  );
});

// ── Viewer locations (45a): map or breakdown, the splits, then the breakdown picker. ──
const LocationsCard = memo(function LocationsCard({ demo }) {
  const { t } = useTranslation();
  const [view, setView] = useState('map');
  const [list, setList] = useState('countries');
  const empty = !demo || (!demo.byCountry?.length && !demo.byDevice?.length);
  // New vs returning is null since we stopped tracking viewers across visits — it
  // simply isn't derivable any more. nr === 0 hides that split entirely: better an
  // absent metric than one that silently reports "100% new".
  const nr = (demo?.newViewers || 0) + (demo?.returningViewers || 0);
  const src = demo?.bySource || [];
  const srcTotal = src.reduce((s, x) => s + (x.sessions || 0), 0);
  const threeSpeak = src.find((s) => s.source === '3speak')?.sessions || 0;
  const pickList = (v) => { setList(v); setView('bars'); };

  return (
    <section className="cs-card cs-locations">
      <div className="cs-card-head">
        <h3 className="cs-card-title is-sm">{t('stats.demo.viewerLocations')}</h3>
        <Segmented
          className="cs-seg-mini"
          size={28}
          block={false}
          value={view}
          onChange={setView}
          label={t('stats.demo.viewerLocations')}
          options={[
            { value: 'map', label: t('stats.demo.map') },
            { value: 'bars', label: t('stats.demo.breakdown') },
          ]}
        />
      </div>

      {/* Fixed height: switching map / breakdown never moves the card. */}
      <div className="cs-loc-body">
        {empty ? (
          <div className="cs-chart-empty">{t('stats.demo.empty')}</div>
        ) : view === 'map' ? (
          <WorldMap byCountry={demo.byCountry} />
        ) : (
          <div className="cs-loc-scroll">
            {list === 'countries' && (
              <MiniBars items={demo.byCountry} labelKey="country"
                renderLabel={(c) => <>{countryFlag(c.country)} {regionName(c.country)}</>} />
            )}
            {list === 'devices' && <MiniBars items={demo.byDevice} labelKey="device" />}
            {list === 'browsers' && <MiniBars items={demo.byBrowser} labelKey="browser" />}
          </div>
        )}
      </div>

      {/* "Sessions", not "viewers": we no longer identify people across visits, so a
          reload is a fresh session. Unlocated = private mode, an IP we couldn't
          place, or a country too small to show without singling someone out. */}
      {demo?.unknownViewers > 0 && (
        <p className="cs-note">
          {t('stats.demo.located', { located: fmtCount(demo.locatedViewers), total: fmtCount(demo.totalSessions ?? demo.totalViewers) })}
        </p>
      )}

      {nr > 0 && (
        <div className="cs-split">
          <div className="cs-split-head"><b>{t('stats.demo.newVsReturning')}</b></div>
          <div className="cs-split-bar"><span style={{ width: `${pct(demo.newViewers, nr)}%` }} /></div>
          <div className="cs-split-legend">
            <span>{t('stats.demo.new')} {pct(demo.newViewers, nr)}%</span>
            <span>{t('stats.demo.returning')} {pct(demo.returningViewers, nr)}%</span>
          </div>
        </div>
      )}

      {srcTotal > 0 && (
        <div className="cs-split">
          <div className="cs-split-head"><b>{t('stats.demo.whereTitle')}</b><span>{t('stats.demo.whereSub')}</span></div>
          <div className="cs-split-bar"><span style={{ width: `${pct(threeSpeak, srcTotal)}%` }} /></div>
          <div className="cs-split-legend">
            <span>{t(SOURCE_LABELS['3speak'])} {pct(threeSpeak, srcTotal)}%</span>
            <span>{t(SOURCE_LABELS.player)} {100 - pct(threeSpeak, srcTotal)}%</span>
          </div>
        </div>
      )}

      {!empty && (
        <Segmented
          className="cs-seg-chips"
          size={28}
          block={false}
          value={view === 'bars' ? list : null}
          onChange={pickList}
          label={t('stats.demo.breakdown')}
          options={[
            { value: 'countries', label: t('stats.demo.countries') },
            { value: 'devices', label: t('stats.demo.devices') },
            { value: 'browsers', label: t('stats.demo.browsers') },
          ]}
        />
      )}
    </section>
  );
});

// ── "When your viewers watch" (31a): 7 days × 12 two-hour cells, cyan by volume,
// the busiest cell in the accent, and that time spelled out under it. ──
function WhenCard({ matrix }) {
  const { t } = useTranslation();
  const cells = useMemo(() => {
    if (!matrix?.length) return null;
    const rows = matrix.map((row) => Array.from({ length: 12 }, (_, b) => (row[b * 2] || 0) + (row[b * 2 + 1] || 0)));
    const max = Math.max(0, ...rows.flat());
    if (max <= 1) return null;
    let best = { d: 0, b: 0, v: -1 };
    rows.forEach((row, d) => row.forEach((v, b) => { if (v > best.v) best = { d, b, v }; }));
    return { rows, max, best };
  }, [matrix]);
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;

  return (
    <section className="cs-card cs-when">
      <h3 className="cs-card-title">{t('stats.when.title')}</h3>
      {!cells ? (
        <div className="cs-chart-empty">{t('stats.noData')}</div>
      ) : (
        <>
          <div className="cs-when-grid">
            {cells.rows.map((row, d) => row.map((v, b) => {
              const isBest = d === cells.best.d && b === cells.best.b;
              return (
                <span
                  key={`${d}-${b}`}
                  className={`cs-when-cell${isBest ? ' is-best' : ''}`}
                  style={isBest ? undefined : { background: `color-mix(in srgb, var(--cyan) ${Math.round(10 + (v / cells.max) * 70)}%, transparent)` }}
                  title={t('stats.when.cellTitle', { day: t(`stats.days.short.${DOW[d]}`), hour: String(b * 2).padStart(2, '0'), count: v })}
                />
              );
            }))}
          </div>
          <p className="cs-when-best">
            <Trans
              t={t}
              i18nKey="stats.when.best"
              values={{ day: weekdayName(cells.best.d), from: hh(cells.best.b * 2), to: hh((cells.best.b * 2 + 2) % 24) }}
              components={{ b: <b /> }}
            />
          </p>
        </>
      )}
    </section>
  );
}

// ── Audience (31a): four wells with the headline numbers. ──
function AudienceCard({ demo, totals }) {
  const { t } = useTranslation();
  const sessions = demo?.totalSessions ?? demo?.totalViewers ?? 0;
  const topC = demo?.byCountry?.[0];
  const topD = demo?.byDevice?.[0];
  const wells = [
    { l: t('stats.audience.topCountry'), v: topC ? `${regionName(topC.country)} ${pct(topC.sessions ?? topC.viewers, sessions)}%` : '-' },
    { l: t('stats.audience.topDevice'), v: topD ? `${topD.device} ${pct(topD.sessions, sessions)}%` : '-' },
    { l: t('stats.tiles.avgViewDuration'), v: fmtDuration(totals.avgViewDuration) },
    { l: t('stats.tiles.avgWatched'), v: `${totals.avgPct ?? 0}%` },
  ];
  return (
    <section className="cs-card cs-audience">
      <h3 className="cs-card-title">{t('stats.audience.title')}</h3>
      <div className="cs-wells">
        {wells.map((w) => (
          <div className="cs-well" key={w.l}>
            <span>{w.l}</span>
            <b>{w.v}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

// Overlaid retention curves for two videos (x = % of video, so different lengths
// compare fairly). 45a: the two picks wear their series color.
function CompareChart({ username, a, b }) {
  const { t } = useTranslation();
  const [ra, setRa] = useState(null);
  const [rb, setRb] = useState(null);
  const [loading, setLoading] = useState(false);
  const ready = a && b && a.permlink !== b.permlink;
  useEffect(() => {
    if (!ready) { setRa(null); setRb(null); return undefined; }
    let cancelled = false; setLoading(true); setRa(null); setRb(null);
    Promise.all([
      fetchVideoAnalytics(username, a.permlink).catch(() => null),
      fetchVideoAnalytics(username, b.permlink).catch(() => null),
    ]).then(([da, db]) => { if (!cancelled) { setRa(da); setRb(db); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [username, ready, a?.permlink, b?.permlink]);

  const line = (vals) => {
    if (!vals || vals.length < 2) return '';
    const n = vals.length; const y = (v) => (100 - (v / 100) * 92).toFixed(2);
    return `M${vals.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${y(v)}`).join(' L')}`;
  };
  const sa = ra?.retention || []; const sb = rb?.retention || [];
  const enough = sa.length >= 2 || sb.length >= 2;

  return (
    <>
      <div className={`cs-compare-chart${loading ? ' v2-skeleton' : ''}`} aria-busy={loading || undefined}>
        {!loading && enough && (
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path d={line(sb)} className="cs-cmp-b" vectorEffect="non-scaling-stroke" />
            <path d={line(sa)} className="cs-cmp-a" vectorEffect="non-scaling-stroke" />
          </svg>
        )}
      </div>
      <div className="cs-cmp-axis"><span>{t('stats.compare.start')}</span><span>{t('stats.compare.axis')}</span><span>{t('stats.compare.end')}</span></div>
      {!loading && !enough && <div className="cs-chart-empty is-sm">{t('stats.compare.notEnough')}</div>}
    </>
  );
}

export default function CreatorStats({ user }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(28);
  const [content, setContent] = useState('all');
  const [overview, setOverview] = useState(null);
  const [prevTotals, setPrevTotals] = useState(null);
  const [demo, setDemo] = useState(null);
  const [series, setSeries] = useState(null);
  const [prevSeries, setPrevSeries] = useState(null);
  // Tagged with the range it was counted for; a stale count is never shown.
  const [followsFor, setFollows] = useState(null);
  const follows = followsFor?.days === days ? followsFor : null;
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [sort, setSort] = useState('watchSeconds');
  const [selected, setSelected] = useState(null);
  const [cmpA, setCmpA] = useState('');
  const [cmpB, setCmpB] = useState('');
  const [metric, setMetric] = useState('views');
  const [compare, setCompare] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(false); setSelected(null);
    const opts = { days, content };
    const longer = LONGER[days] ? { days: LONGER[days], content } : null;
    Promise.all([
      fetchCreatorOverview(user, opts).catch(() => null),
      fetchCreatorTimeseries(user, opts).catch(() => null),
      fetchCreatorDemographics(user, opts).catch(() => null),
      longer ? fetchCreatorTimeseries(user, longer).catch(() => null) : null,
    ]).then(([ov, ts, dm, tsLong]) => {
      if (cancelled) return;
      if (!ov) setErr(true);
      setOverview(ov); setSeries(ts?.series || null); setDemo(dm);
      // The `days` before this range, from the longer daily series.
      const all = tsLong?.series || [];
      const prev = all.length >= days * 2 ? all.slice(all.length - days * 2, all.length - days) : null;
      setPrevSeries(prev);
      setPrevTotals(prev ? {
        sessions: prev.reduce((a, p) => a + (p.views || 0), 0),
        watchSeconds: prev.reduce((a, p) => a + (p.watchSeconds || 0), 0),
      } : null);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, days, content]);

  // Followers: new follows in the period (and the one before) from the dated
  // follow list; for All, the account's follower count.
  useEffect(() => {
    let cancelled = false;
    if (days > 0) {
      fetchCreatorFollows(user, { days: 365 }).then((f) => {
        if (cancelled || !f?.headBlock) return;
        const head = f.headBlock;
        const span = days * BLOCKS_PER_DAY;
        const list = f.followers || [];
        const cur = list.filter((x) => x.block > head - span);
        const prev = days * 2 <= 365 ? list.filter((x) => x.block <= head - span && x.block > head - 2 * span).length : null;
        const perDay = Array.from({ length: days }, () => 0);
        cur.forEach((x) => {
          const back = Math.floor((head - x.block) / BLOCKS_PER_DAY);
          if (back >= 0 && back < days) perDay[days - 1 - back] += 1;
        });
        setFollows({ days, count: cur.length, prev, perDay, gained: true });
      }).catch(() => {});
    } else {
      getFollowers(user).then((c) => {
        if (!cancelled && c?.follower_count != null) setFollows({ days, count: c.follower_count, prev: null, perDay: null, gained: false });
      }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [user, days]);

  const header = (
    <header className="cs-head">
      <h2 className="cs-title">{t('stats.title')}</h2>
      <div className="cs-controls">
        <Segmented
          className="cs-seg"
          block={false}
          value={days}
          onChange={setDays}
          label={t('stats.title')}
          options={RANGES.map((r) => ({ value: r.d, label: t(r.l) }))}
        />
        <Segmented
          className="cs-seg"
          block={false}
          value={content}
          onChange={setContent}
          options={CONTENTS.map((c) => ({ value: c.k, label: t(c.l) }))}
        />
        <Button
          className={`cs-compare-btn${compare && days > 0 ? '' : ' is-off'}`}
          size={44}
          icon="compare_arrows"
          aria-pressed={compare && days > 0}
          disabled={days === 0}
          onClick={() => setCompare((c) => !c)}
        >
          {t('stats.compare.lastPeriod')}
        </Button>
        {/* The last 12 months as a short story (page/Recap.jsx). Hidden until the
            recap launches in December (RECAP_LINK_VISIBLE). */}
        {RECAP_LINK_VISIBLE && <Link className="cs-recap-link" to="/recap">{t('recap.open')}</Link>}
      </div>
    </header>
  );

  if (loading) {
    return (
      <div className="creator-stats" aria-busy="true">
        {header}
        <div className="cs-grid">
          <div className="cs-skeleton cs-span2 v2-skeleton" />
          <div className="cs-skeleton v2-skeleton" />
          <div className="cs-skeleton is-short v2-skeleton" />
          <div className="cs-skeleton is-short v2-skeleton" />
          <div className="cs-skeleton is-short v2-skeleton" />
        </div>
      </div>
    );
  }
  if (err || !overview) return <div className="creator-stats">{header}<div className="cs-chart-empty cs-chart-empty--error" role="alert">{t('stats.loadError')}</div></div>;

  const totals = overview.totals || {};
  const videos = overview.videos || [];
  const sortDef = SORTS.find((s) => s.key === sort);
  const list = [...videos].sort((a, b) => (b[sort] || 0) - (a[sort] || 0)).slice(0, 8);
  const detail = selected || list[0] || null;
  const cmpAVid = videos.find((v) => v.permlink === cmpA);
  const cmpBVid = videos.find((v) => v.permlink === cmpB);
  const cmpOpts = videos.map((v) => <option key={v.permlink} value={v.permlink}>{v.title}</option>);
  const sortOptions = SORTS.map((m) => ({ value: m.key, label: t(m.label) }));
  const showPrev = compare && days > 0;

  // The four headline tiles (31a). Views, watch time and followers have a daily
  // series, so they pick the chart; earnings have none and only show the total.
  const tiles = [
    { key: 'views', label: t('stats.metrics.views'), value: fmtCount(totals.sessions || 0), d: delta(totals.sessions || 0, prevTotals?.sessions), chart: true },
    { key: 'watch', label: t('stats.metrics.watchTime'), value: fmtDuration(totals.watchSeconds || 0), d: delta(totals.watchSeconds || 0, prevTotals?.watchSeconds), chart: true },
    {
      key: 'followers',
      label: t('stats.metrics.followers'),
      value: follows ? `${follows.gained && follows.count > 0 ? '+' : ''}${fmtCount(follows.count)}` : '-',
      d: follows ? delta(follows.count, follows.prev) : null,
      chart: !!follows?.perDay,
    },
    // No daily payouts to compare with, so no change line under earnings.
    { key: 'earned', label: t('stats.metrics.earned'), value: `$${Number(totals.payout || 0).toFixed(2)}`, d: null, chart: false },
  ];
  const active = tiles.find((x) => x.key === metric && x.chart) ? metric : 'views';
  const pickSeries = (s) => {
    if (!s) return null;
    if (active === 'watch') return s.map((p) => p.watchSeconds || 0);
    return s.map((p) => p.views || 0);
  };
  const chartValues = active === 'followers' ? follows?.perDay : pickSeries(series);
  const chartPrev = showPrev && active !== 'followers' ? pickSeries(prevSeries) : null;
  const chartFmt = active === 'watch' ? fmtDuration : fmtCount;

  return (
    <div className="creator-stats">
      {header}

      {!totals.videos ? (
        <div className="cs-empty">{t('stats.emptyRange')}</div>
      ) : (
        <div className="cs-grid">
          {/* Tiles and the trend under them, one card (31a) */}
          <section className="cs-card cs-overview cs-span2">
            <div className="cs-tiles">
              {tiles.map((tile) => {
                const El = tile.chart ? 'button' : 'div';
                return (
                  <El
                    key={tile.key}
                    type={tile.chart ? 'button' : undefined}
                    className={`cs-tile${active === tile.key ? ' is-on' : ''}`}
                    aria-pressed={tile.chart ? active === tile.key : undefined}
                    onClick={tile.chart ? () => setMetric(tile.key) : undefined}
                  >
                    <span className="cs-tile-l">{tile.label}</span>
                    <b className="cs-tile-v">{tile.value}</b>
                    <span className="cs-tile-d">{tile.d || ' '}</span>
                  </El>
                );
              })}
            </div>

            <TrendChart
              values={chartValues || []}
              prev={chartPrev}
              dates={active === 'followers' ? null : (series || []).map((p) => p.date)}
              fmt={chartFmt}
            />

            <div className="cs-legend">
              {chartPrev && (
                <>
                  <span><i className="is-a" />{t('stats.legend.current')}</span>
                  <span><i className="is-b" />{t('stats.legend.previous')}</span>
                </>
              )}
              <span className="cs-subtotals">
                {t('stats.subtotals', { videos: fmtCount(totals.videos), votes: fmtCount(totals.votes), comments: fmtCount(totals.comments), payout: Number(totals.payout || 0).toFixed(2), rate: totals.avgRate })}
              </span>
            </div>
          </section>

          <LocationsCard demo={demo} />

          <WhenCard matrix={demo?.whenHeatmap} />
          <AudienceCard demo={demo} totals={totals} />

          {/* Top content (31a): the ranked list; a row opens its detail below. */}
          <section className="cs-card cs-top">
            <h3 className="cs-card-title">{t('stats.sections.top')}</h3>
            <Segmented className="cs-seg-scroll" size={28} scroll block={false} value={sort} onChange={setSort} options={sortOptions} label={t('stats.sections.top')} />
            <div className="cs-list">
              {list.map((v, i) => {
                const pick = () => setSelected(v);
                // Clicking the TITLE opens the video/short in a new tab; clicking the
                // rest of the row shows its analytics below.
                const watchUrl = v.short ? `/shorts?v=${user}/${v.permlink}` : `/@${user}/${v.permlink}`;
                return (
                  <div
                    key={v.permlink}
                    className={`cs-item${detail?.permlink === v.permlink ? ' selected' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={detail?.permlink === v.permlink}
                    onClick={pick}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
                  >
                    <span className={`cs-rank${i === 0 ? ' is-first' : ''}`}>{i + 1}</span>
                    <span className="cs-item-thumb v2-thumb r8">{v.thumbnail && <img src={v.thumbnail} alt="" loading="lazy" />}</span>
                    <span className="cs-item-info">
                      <a
                        className="cs-item-title"
                        href={watchUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        title={t('stats.openInNewTab')}
                      >
                        {v.short && <Icon name="view_day" size={14} className="cs-item-short" />}{v.title || v.permlink}
                      </a>
                      {v.created && <span className="cs-item-date">{timeAgo(v.created)}</span>}
                    </span>
                    <span className="cs-item-metric">{sortDef.fmt(v[sort])}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Per video (45a): the picked row in depth. */}
          {detail && (
            <section className="cs-card cs-detail cs-span2">
              <h3 className="cs-card-title">{detail.title || detail.permlink}</h3>
              <span className="cs-detail-sub">
                {t('stats.detail.summary', { votes: fmtCount(detail.votes), comments: fmtCount(detail.comments), payout: Number(detail.payout || 0).toFixed(2) })}
                {detail.created ? ` · ${timeAgo(detail.created)}` : ''}
              </span>
              <VideoStats username={user} permlink={detail.permlink} variant="detail" />
              <p className="cs-footnote">{t('stats.footnote')}</p>
            </section>
          )}

          {/* Compare videos (45a) */}
          {videos.length >= 2 && (
            <section className="cs-card cs-compare">
              <h3 className="cs-card-title is-sm">{t('stats.compare.title')}</h3>
              <div className="cs-compare-picks">
                <select className="v2-input is-select cs-pick is-a" aria-label={t('stats.compare.pickA')} value={cmpA} onChange={(e) => setCmpA(e.target.value)}><option value="">{t('stats.compare.pickA')}</option>{cmpOpts}</select>
                <span className="cs-compare-vs">{t('stats.compare.vs')}</span>
                <select className="v2-input is-select cs-pick is-b" aria-label={t('stats.compare.pickB')} value={cmpB} onChange={(e) => setCmpB(e.target.value)}><option value="">{t('stats.compare.pickB')}</option>{cmpOpts}</select>
              </div>
              <CompareChart username={user} a={cmpAVid} b={cmpBVid} />
            </section>
          )}
        </div>
      )}

      {!detail && <p className="cs-footnote">{t('stats.footnote')}</p>}
    </div>
  );
}
