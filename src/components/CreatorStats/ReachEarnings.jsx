// Creator stats, the newer cards: Reach (impressions, click-through rate and
// where viewers found the videos, from lib/cardReach.js) and Earnings (a daily
// series per source, stacked, with CSV exports). They render inside
// .creator-stats and reuse its card, well and bar styles.
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../v2/ui';
import { fmtCount, fmtHbd, EARNING_SOURCES, earnedTotal } from '../../lib/creatorStats';
import { formatDate, formatNumber } from '../../i18n';
import './ReachEarnings.scss';

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const fmtCtr = (v) => (v == null ? '-' : `${formatNumber(v, { maximumFractionDigits: 1 })}%`);

// Sorted bars in the look of the stats page's other breakdowns.
function Bars({ items, valueOf, labelOf, sideOf }) {
  const sum = items.reduce((s, i) => s + valueOf(i), 0);
  return (
    <div className="cs-bars">
      {items.slice(0, 8).map((it, i) => {
        const p = pct(valueOf(it), sum);
        return (
          <div className="cs-bar" key={labelOf(it)}>
            <div className="cs-bar-row">
              <span className="cs-bar-label">{labelOf(it)}</span>
              {sideOf && <span className="re-bar-side">{sideOf(it)}</span>}
              <b className="cs-bar-val" title={fmtCount(valueOf(it))}>{p}%</b>
            </div>
            <span className="cs-bar-track"><span className={`cs-bar-fill${i === 0 ? ' is-accent' : i === 1 ? ' is-cyan' : ''}`} style={{ width: `${p}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}

/** Impressions, CTR and where viewers found it, channel-wide for the range. */
export function ReachCard({ reach }) {
  const { t } = useTranslation();
  const totals = reach?.totals || {};
  const found = reach?.found || [];
  const shown = reach?.bySurface || [];
  const empty = !totals.impressions && !totals.opens;
  const wells = [
    { l: t('creator.reach.impressions'), v: fmtCount(totals.impressions || 0) },
    { l: t('creator.reach.ctr'), v: fmtCtr(totals.ctr) },
    { l: t('creator.reach.clicks'), v: fmtCount(totals.clicks || 0) },
    { l: t('creator.reach.opens'), v: fmtCount(totals.opens || 0) },
  ];
  return (
    <section className="cs-card re-reach" aria-label={t('creator.reach.title')}>
      <h3 className="cs-card-title">{t('creator.reach.title')}</h3>
      <div className="cs-wells">
        {wells.map((w) => (
          <div className="cs-well" key={w.l}><span>{w.l}</span><b>{w.v}</b></div>
        ))}
      </div>
      {empty ? (
        <div className="cs-chart-empty">{t('creator.reach.empty')}</div>
      ) : (
        <>
          {found.length > 0 && (
            <div className="re-block">
              <b className="re-block-title">{t('creator.reach.foundTitle')}</b>
              <Bars items={found} valueOf={(f) => f.opens} labelOf={(f) => t(`creator.sources.${f.source}`)} />
            </div>
          )}
          {shown.length > 0 && (
            <div className="re-block">
              <b className="re-block-title">{t('creator.reach.shownTitle')}</b>
              <Bars
                items={shown}
                valueOf={(s) => s.impressions}
                labelOf={(s) => t(`creator.sources.${s.surface}`)}
                sideOf={(s) => t('creator.reach.ctrShort', { ctr: fmtCtr(s.ctr) })}
              />
            </div>
          )}
        </>
      )}
      <p className="cs-note">
        {reach?.since ? t('creator.reach.since', { date: formatDate(`${reach.since}T00:00:00Z`, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) }) : t('creator.reach.sampled')}
      </p>
    </section>
  );
}

/** One day's earnings, stacked by source. */
function StackedBars({ series }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const n = series.length;
  const max = Math.max(0, ...series.map(earnedTotal));

  const onMove = useCallback((e) => {
    const el = wrapRef.current;
    if (!el || !n) return;
    const cx = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(0.9999, (cx - rect.left) / rect.width));
    setHover(Math.floor(frac * n));
  }, [n]);

  const rects = useMemo(() => {
    if (!(max > 0)) return [];
    const w = 100 / n;
    const out = [];
    series.forEach((d, i) => {
      let y = 100;
      for (const k of EARNING_SOURCES) {
        const h = ((Number(d[k]) || 0) / max) * 94;
        if (h <= 0) continue;
        y -= h;
        out.push(<rect key={`${i}-${k}`} x={i * w + w * 0.12} width={w * 0.76} y={y} height={h} className={`re-seg is-${k}`} />);
      }
    });
    return out;
  }, [series, max, n]);

  if (!(max > 0)) return <div className="cs-chart-empty">{t('creator.earnings.empty')}</div>;
  const day = hover != null ? series[hover] : null;
  return (
    <div
      className="re-chart"
      ref={wrapRef}
      role="img"
      aria-label={t('creator.earnings.chartLabel', { days: n })}
      onMouseMove={onMove} onMouseLeave={() => setHover(null)}
      onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{rects}</svg>
      {day && (
        <div className={`re-tip${hover > n / 2 ? ' is-left' : ''}`} style={{ left: `${((hover + 0.5) / n) * 100}%` }}>
          <b>{formatDate(`${day.date}T00:00:00Z`, { day: 'numeric', month: 'short', timeZone: 'UTC' })} · {fmtHbd(earnedTotal(day))}</b>
          {EARNING_SOURCES.filter((k) => day[k] > 0).map((k) => (
            <span key={k}><i className={`re-dot is-${k}`} />{t(`creator.earnings.sources.${k}`)} {fmtHbd(day[k])}</span>
          ))}
          {day.lightningSats > 0 && <span>{t('creator.earnings.sats', { count: day.lightningSats })}</span>}
        </div>
      )}
    </div>
  );
}

/** Earnings over time by source, and the CSV exports of the page's tables. */
export function EarningsCard({ earnings, allTime, error, onExportDaily, onExportContent }) {
  const { t } = useTranslation();
  const totals = earnings?.totals || {};
  const sum = earnedTotal(totals);
  return (
    <section className="cs-card cs-span2 re-earnings" aria-label={t('creator.earnings.title')}>
      <div className="cs-card-head">
        <h3 className="cs-card-title">{t('creator.earnings.title')}</h3>
        <b className="re-total">{fmtHbd(sum)}</b>
      </div>
      {allTime && <p className="cs-note">{t('creator.earnings.lastYear')}</p>}
      {error ? (
        <div className="cs-chart-empty">{t('creator.earnings.unavailable')}</div>
      ) : !earnings ? (
        <div className="re-chart v2-skeleton" aria-busy="true" />
      ) : (
        <>
          <StackedBars series={earnings.series || []} />
          <div className="re-legend">
            {EARNING_SOURCES.map((k) => (
              <span key={k} className="re-legend-item">
                <i className={`re-dot is-${k}`} />{t(`creator.earnings.sources.${k}`)} <b>{fmtHbd(totals[k])}</b>
              </span>
            ))}
            {totals.lightningSats > 0 && (
              <span className="re-legend-item">{t('creator.earnings.sources.lightning')} <b>{t('creator.earnings.sats', { count: totals.lightningSats })}</b></span>
            )}
          </div>
          <p className="cs-note">{t('creator.earnings.note')}</p>
        </>
      )}
      <div className="re-exports">
        <Button size={36} icon="download" disabled={!earnings} onClick={onExportDaily}>{t('creator.export.daily')}</Button>
        {/* The content table carries each post's earnings: it waits for them, and
            stays off (saying why) while they cannot be loaded. */}
        <Button
          size={36}
          icon="download"
          disabled={!earnings}
          title={error ? t('creator.earnings.unavailable') : undefined}
          onClick={onExportContent}
        >
          {t('creator.export.content')}
        </Button>
      </div>
    </section>
  );
}
