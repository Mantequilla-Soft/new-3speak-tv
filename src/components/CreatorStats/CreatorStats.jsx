import { useState, useEffect, useMemo, useRef, useCallback, memo } from 'react';
import {
  fetchCreatorOverview, fetchCreatorTimeseries, fetchCreatorDemographics, fetchVideoAnalytics,
  fmtDuration, fmtCount, timeAgo, countryFlag, countryName, countryLatLng,
} from '../../lib/creatorStats';
import BarLoader from '../Loader/BarLoader';
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

// Country name in the UI language (Intl), falling back to the lib's English name.
function regionName(code) {
  if (!code) return countryName(code);
  try {
    return new Intl.DisplayNames([getLanguage()], { type: 'region' }).of(code.toUpperCase()) || countryName(code);
  } catch { return countryName(code); }
}

// ── Watch-time trend (area + hover). Single series → title names it. ──
function TrendChart({ series }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const n = series?.length || 0;
  const max = Math.max(1, ...(series || []).map((p) => p.watchSeconds));
  const has = n > 1 && series.some((p) => p.watchSeconds > 0);

  const path = useMemo(() => {
    if (!has) return { area: '', line: '' };
    const y = (v) => (100 - (v / max) * 92).toFixed(2);
    const pts = series.map((p, i) => `${((i / (n - 1)) * 100).toFixed(2)},${y(p.watchSeconds)}`);
    return { area: `M0,100 L${pts.join(' L')} L100,100 Z`, line: `M${pts.join(' L')}` };
  }, [series, max, has, n]);

  const onMove = useCallback((e) => {
    const el = wrapRef.current; if (!el || !n) return;
    const cx = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    setHover(Math.min(n - 1, Math.round(frac * (n - 1))));
  }, [n]);

  if (!has) return <div className="cs-chart-empty">{t('stats.trend.empty')}</div>;
  const hp = hover != null ? series[hover] : null;

  return (
    <div className="cs-trend" ref={wrapRef}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="cs-trend-svg" aria-hidden="true">
        <path className="cs-trend-area" d={path.area} />
        <path className="cs-trend-line" d={path.line} vectorEffect="non-scaling-stroke" />
      </svg>
      {hp && (
        <>
          <div className="cs-trend-cursor" style={{ left: `${(hover / (n - 1)) * 100}%` }} />
          <div className="cs-trend-tip" style={{ left: `${(hover / (n - 1)) * 100}%` }}>
            <strong>{fmtDuration(hp.watchSeconds)}</strong>
            <span>{t('stats.trend.tip', { count: hp.views, date: hp.date.slice(5) })}</span>
          </div>
        </>
      )}
      <div className="cs-trend-axis"><span>{series[0].date.slice(5)}</span><span>{series[n - 1].date.slice(5)}</span></div>
    </div>
  );
}

// ── Simple sorted bars (device / browser / country). ──
function MiniBars({ items, labelKey, renderLabel }) {
  const { t } = useTranslation();
  if (!items?.length) return <div className="cs-chart-empty">{t('stats.noData')}</div>;
  const max = Math.max(1, ...items.map((i) => i.sessions ?? i.viewers ?? 0));
  return (
    <div className="cs-demo-bars">
      {items.slice(0, 8).map((it) => {
        const v = it.sessions ?? it.viewers ?? 0;
        return (
          <div className="cs-demo-row" key={it[labelKey]}>
            <span className="cs-demo-label">{renderLabel ? renderLabel(it) : it[labelKey]}</span>
            <span className="cs-demo-track"><span className="cs-demo-fill" style={{ width: `${(v / max) * 100}%` }} /></span>
            <span className="cs-demo-val">{fmtCount(v)}</span>
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
  if (!pts.length) return null;
  const max = Math.max(1, ...pts.map((c) => c.viewers));
  return (
    <div className="cs-map">
      <svg viewBox="0 0 360 180" className="cs-map-svg" role="img" aria-label={t('stats.demo.viewerLocations')}>
        <rect x="0" y="0" width="360" height="180" className="cs-map-bg" />
        {WORLD_LAND_PATH && <path d={WORLD_LAND_PATH} className="cs-map-land" />}
        {[30, 60, 90, 120, 150].map((y) => <line key={`h${y}`} x1="0" y1={y} x2="360" y2={y} className="cs-map-grid" />)}
        {[60, 120, 180, 240, 300].map((x) => <line key={`v${x}`} x1={x} y1="0" x2={x} y2="180" className="cs-map-grid" />)}
        {pts.map((c) => {
          const cx = c.ll[1] + 180;
          const cy = 90 - c.ll[0];
          const r = 2 + Math.sqrt(c.viewers / max) * 10;
          return (
            <circle key={c.country} cx={cx} cy={cy} r={r} className="cs-map-bubble">
              <title>{t('stats.demo.mapBubble', { country: regionName(c.country), count: c.viewers })}</title>
            </circle>
          );
        })}
      </svg>
    </div>
  );
});

// ── "When your viewers watch" — 7×24 day/hour heatmap. ──
function WhenHeatmap({ matrix }) {
  const { t } = useTranslation();
  if (!matrix?.length) return null;
  const max = Math.max(1, ...matrix.flat());
  if (max <= 1) return null;
  return (
    <div className="cs-when">
      <div className="cs-when-grid">
        {matrix.map((row, d) => (
          <div className="cs-when-row" key={d}>
            <span className="cs-when-day">{t(`stats.days.initial.${DOW[d]}`)}</span>
            {row.map((v, h) => (
              <span
                key={h}
                className="cs-when-cell"
                style={{ opacity: v ? 0.15 + (v / max) * 0.85 : 0.06 }}
                title={t('stats.when.cellTitle', { day: t(`stats.days.short.${DOW[d]}`), hour: String(h).padStart(2, '0'), count: v })}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="cs-when-hours">{[0, 6, 12, 18, 23].map((h) => <span key={h}>{t('stats.when.hour', { hour: h })}</span>)}</div>
    </div>
  );
}

const Demographics = memo(function Demographics({ demo }) {
  // Mobile only: switch between the breakdown bars and the map.
  const { t } = useTranslation();
  const [tab, setTab] = useState('map');
  if (!demo || (!demo.byCountry?.length && !demo.byDevice?.length)) {
    return <div className="cs-chart-empty">{t('stats.demo.empty')}</div>;
  }
  // New vs returning is null since we stopped tracking viewers across visits — it
  // simply isn't derivable any more. nr === 0 hides the chart entirely, which is the
  // point: better an absent metric than one that silently reports "100% new".
  const nr = (demo.newViewers || 0) + (demo.returningViewers || 0);
  return (
    <div className="cs-demo">
      {/* Mobile tab switcher (hidden on desktop) */}
      <div className="cs-demo-tabs cs-seg">
        <button className={tab === 'bars' ? 'active' : ''} onClick={() => setTab('bars')}>{t('stats.demo.breakdown')}</button>
        <button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}>{t('stats.demo.map')}</button>
      </div>

      {/* Desktop: bars on the left, 50% map on the right. Mobile: one per tab. */}
      <div className={`cs-demo-main tab-${tab}`}>
        <div className="cs-demo-bars-side">
          <div className="cs-demo-col">
            <h5>{t('stats.demo.countries')}</h5>
            <MiniBars items={demo.byCountry} labelKey="country"
              renderLabel={(c) => <>{countryFlag(c.country)} {regionName(c.country)}</>} />
          </div>
          <div className="cs-demo-col">
            <h5>{t('stats.demo.devices')}</h5>
            <MiniBars items={demo.byDevice} labelKey="device" />
          </div>
          <div className="cs-demo-col">
            <h5>{t('stats.demo.browsers')}</h5>
            <MiniBars items={demo.byBrowser} labelKey="browser" />
          </div>
          {demo.bySource?.length > 0 && (
            <div className="cs-demo-col">
              <h5>{t('stats.demo.whereTitle')}<em>{t('stats.demo.whereSub')}</em></h5>
              <MiniBars items={demo.bySource} labelKey="source" renderLabel={(s) => (SOURCE_LABELS[s.source] ? t(SOURCE_LABELS[s.source]) : s.source)} />
            </div>
          )}
          {nr > 0 && (demo.returningViewers > 0 || demo.days > 0) && (
            <div className="cs-demo-col">
              <h5>{t('stats.demo.newVsReturning')}</h5>
              <MiniBars
                items={[
                  { label: t('stats.demo.new'), viewers: demo.newViewers },
                  { label: t('stats.demo.returning'), viewers: demo.returningViewers },
                ]}
                labelKey="label"
              />
            </div>
          )}
          <div className="cs-demo-col">
            <h5>{t('stats.when.title')}<em>{t('stats.when.sub')}</em></h5>
            <WhenHeatmap matrix={demo.whenHeatmap} />
          </div>
        </div>
        <div className="cs-demo-map-side">
          <WorldMap byCountry={demo.byCountry} />
        </div>
      </div>

      {/* "Sessions", not "viewers": we no longer identify people across visits, so a
          reload is a fresh session. Saying "viewers" here would overstate what the
          number means. Unlocated = private mode, an IP we couldn't place, or a
          country too small to show without singling someone out. */}
      {demo.unknownViewers > 0 && (
        <p className="cs-demo-note">
          {t('stats.demo.located', { located: demo.locatedViewers, total: demo.totalSessions ?? demo.totalViewers })}
        </p>
      )}
    </div>
  );
});

function VideoDetail({ username, video, onClose }) {
  const { t } = useTranslation();
  return (
    <div className="cs-detail">
      <div className="cs-detail-head">
        <img className="cs-detail-thumb" src={video.thumbnail} alt="" />
        <div className="cs-detail-title">
          <strong>{video.title || video.permlink}</strong>
          <span>{t('stats.detail.summary', { votes: fmtCount(video.votes), comments: fmtCount(video.comments), payout: Number(video.payout || 0).toFixed(2) })}{video.created ? ` · ${timeAgo(video.created)}` : ''}</span>
        </div>
        <button className="cs-detail-close" onClick={onClose} aria-label={t('common.actions.close')}>✕</button>
      </div>
      <VideoStats username={username} permlink={video.permlink} compact />
    </div>
  );
}

// Overlaid retention curves for two videos (x = % of video, so different lengths
// compare fairly). Two series → legend is always shown.
function CompareChart({ username, a, b }) {
  const { t } = useTranslation();
  const [ra, setRa] = useState(null);
  const [rb, setRb] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false; setLoading(true); setRa(null); setRb(null);
    Promise.all([
      fetchVideoAnalytics(username, a.permlink).catch(() => null),
      fetchVideoAnalytics(username, b.permlink).catch(() => null),
    ]).then(([da, db]) => { if (!cancelled) { setRa(da); setRb(db); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [username, a.permlink, b.permlink]);

  const line = (vals) => {
    if (!vals || vals.length < 2) return '';
    const n = vals.length; const y = (v) => (100 - (v / 100) * 92).toFixed(2);
    return `M${vals.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${y(v)}`).join(' L')}`;
  };
  if (loading) return <BarLoader />;
  const sa = ra?.retention || []; const sb = rb?.retention || [];
  if (sa.length < 2 && sb.length < 2) return <div className="cs-chart-empty">{t('stats.compare.notEnough')}</div>;

  return (
    <div className="cs-compare">
      <div className="cs-compare-legend">
        <span><i style={{ background: 'var(--accent-primary, #e53935)' }} />{a.title}</span>
        <span><i style={{ background: 'rgba(120,170,255,0.95)' }} />{b.title}</span>
      </div>
      <div className="cs-compare-chart">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d={line(sa)} className="cs-cmp-a" vectorEffect="non-scaling-stroke" />
          <path d={line(sb)} className="cs-cmp-b" vectorEffect="non-scaling-stroke" />
        </svg>
        <div className="cs-cmp-axis"><span>{t('stats.compare.start')}</span><span>{t('stats.compare.axis')}</span><span>{t('stats.compare.end')}</span></div>
      </div>
    </div>
  );
}

export default function CreatorStats({ user }) {
  const { t } = useTranslation();
  const [days, setDays] = useState(28);
  const [content, setContent] = useState('all');
  const [overview, setOverview] = useState(null);
  const [demo, setDemo] = useState(null);
  const [series, setSeries] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const [sort, setSort] = useState('watchSeconds');
  const [selected, setSelected] = useState(null);
  const [cmpA, setCmpA] = useState('');
  const [cmpB, setCmpB] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(false); setSelected(null);
    const opts = { days, content };
    Promise.all([
      fetchCreatorOverview(user, opts).catch(() => null),
      fetchCreatorTimeseries(user, opts).catch(() => null),
      fetchCreatorDemographics(user, opts).catch(() => null),
    ]).then(([ov, ts, dm]) => {
      if (cancelled) return;
      if (!ov) setErr(true);
      setOverview(ov); setSeries(ts?.series || null); setDemo(dm);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user, days, content]);

  const filters = (
    <div className="cs-filters">
      <div className="cs-seg">
        {RANGES.map((r) => <button key={r.d} className={days === r.d ? 'active' : ''} onClick={() => setDays(r.d)}>{t(r.l)}</button>)}
      </div>
      <div className="cs-seg">
        {CONTENTS.map((c) => <button key={c.k} className={content === c.k ? 'active' : ''} onClick={() => setContent(c.k)}>{t(c.l)}</button>)}
      </div>
    </div>
  );

  if (loading) return <div className="creator-stats">{filters}<BarLoader /></div>;
  if (err || !overview) return <div className="creator-stats">{filters}<div className="cs-chart-empty">{t('stats.loadError')}</div></div>;

  const totals = overview.totals || {};
  const videos = overview.videos || [];
  const sortDef = SORTS.find((s) => s.key === sort);
  const list = [...videos].sort((a, b) => (b[sort] || 0) - (a[sort] || 0)).slice(0, 8);
  const cmpAVid = videos.find((v) => v.permlink === cmpA);
  const cmpBVid = videos.find((v) => v.permlink === cmpB);
  const cmpOpts = videos.map((v) => <option key={v.permlink} value={v.permlink}>{v.title}</option>);

  return (
    <div className="creator-stats">
      {filters}

      {!totals.videos ? (
        <div className="cs-empty">{t('stats.emptyRange')}</div>
      ) : (
        <>
          {/* Tiles */}
          <div className="cs-tiles">
            <div className="cs-tile"><span>{fmtDuration(totals.watchSeconds)}</span><label>{t('stats.metrics.watchTime')}</label></div>
            <div className="cs-tile"><span>{fmtCount(totals.sessions)}</span><label>{t('stats.metrics.views')}</label></div>
            {/* The "Unique viewers" tile is gone. We no longer identify a viewer across
                visits, so it counted the same thing as Views — a duplicate number under a
                label that promised distinct people. Dropped rather than left to mislead. */}
            <div className="cs-tile"><span>{fmtDuration(totals.avgViewDuration)}</span><label>{t('stats.tiles.avgViewDuration')}</label></div>
            <div className="cs-tile"><span>{totals.avgPct}%</span><label>{t('stats.tiles.avgWatched')}</label></div>
            <div className="cs-tile"><span>{(Number(totals.engagementRate || 0) / 100).toFixed(1)}</span><label>{t('stats.tiles.reactionsPerView')}</label></div>
          </div>
          <p className="cs-subtotals">
            {t('stats.subtotals', { videos: fmtCount(totals.videos), votes: fmtCount(totals.votes), comments: fmtCount(totals.comments), payout: Number(totals.payout || 0).toFixed(2), rate: totals.avgRate })}
          </p>

          {/* Trend */}
          {series && (
            <section className="cs-section">
              <div className="cs-section-head"><h4>{t('stats.sections.trend')}</h4></div>
              <TrendChart series={series} />
            </section>
          )}

          {/* Best performing + Compare (side by side on desktop) */}
          <section className="cs-section">
            <div className="cs-section-head">
              <h4>{t('stats.sections.best')}</h4>
            </div>

            <div className="cs-perf-row">
              <div className="cs-list-col">
                <div className="cs-seg cs-seg-scroll">
                  {SORTS.map((m) => (
                    <button key={m.key} className={sort === m.key ? 'active' : ''} onClick={() => setSort(m.key)}>{t(m.label)}</button>
                  ))}
                </div>
                <div className="cs-list">
                {list.map((v, i) => {
                  const toggle = () => setSelected(selected?.permlink === v.permlink ? null : v);
                  // Clicking the TITLE opens the video/short in a new tab; clicking the
                  // rest of the row shows its analytics below.
                  const watchUrl = `/${v.short ? 'shorts' : 'watch'}?v=${user}/${v.permlink}`;
                  return (
                    <div
                      key={v.permlink}
                      className={`cs-item${selected?.permlink === v.permlink ? ' selected' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={toggle}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
                    >
                      <span className="cs-rank">{i + 1}</span>
                      <img className="cs-item-thumb" src={v.thumbnail} alt="" loading="lazy" />
                      <span className="cs-item-info">
                        <a
                          className="cs-item-title"
                          href={watchUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title={t('stats.openInNewTab')}
                        >
                          {v.short ? '⏱ ' : ''}{v.title || v.permlink}
                        </a>
                        {v.created && <span className="cs-item-date">{timeAgo(v.created)}</span>}
                      </span>
                      <span className="cs-item-metric">{sortDef.fmt(v[sort])}</span>
                    </div>
                  );
                })}
                </div>
              </div>

              {videos.length >= 2 && (
                <div className="cs-perf-compare">
                  <h5>{t('stats.compare.title')}</h5>
                  <div className="cs-compare-picks">
                    <select value={cmpA} onChange={(e) => setCmpA(e.target.value)}><option value="">{t('stats.compare.pickA')}</option>{cmpOpts}</select>
                    <span className="cs-compare-vs">{t('stats.compare.vs')}</span>
                    <select value={cmpB} onChange={(e) => setCmpB(e.target.value)}><option value="">{t('stats.compare.pickB')}</option>{cmpOpts}</select>
                  </div>
                </div>
              )}
            </div>

            {/* Graphs under the whole row */}
            {selected && <VideoDetail username={user} video={selected} onClose={() => setSelected(null)} />}
            {cmpAVid && cmpBVid && cmpAVid.permlink !== cmpBVid.permlink && (
              <div className="cs-compare-result">
                <CompareChart username={user} a={cmpAVid} b={cmpBVid} />
              </div>
            )}
          </section>

          {/* Demographics */}
          <section className="cs-section">
            <div className="cs-section-head"><h4>{t('stats.sections.audience')}</h4></div>
            <Demographics demo={demo} />
          </section>
        </>
      )}

      <p className="cs-footnote">{t('stats.footnote')}</p>
    </div>
  );
}
