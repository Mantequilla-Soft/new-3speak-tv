import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';
import { flightPrice } from '../../lib/adMarket';
import { Icon } from '../v2/Icon';
import './DayRateChart.scss';

/**
 * What one second of the selected format costs per day, for every flight length the
 * booking form allows. Asked for by the owner (2026-10-18) so advertisers can work
 * out their length and duration without trial and error in the form.
 *
 * The line is the SAME formula the quote uses (flightPrice: days^K x rate x seconds),
 * divided back down to one second and one day, so the chart can never describe a
 * different price than the total under it. With no day curve (K = 1) it is flat,
 * which is the honest picture: every day costs the same.
 *
 * One series, so no legend: the title names it. Hover (or touch) updates the readout
 * line above the plot with that day's rate and what the chosen ad length would cost
 * in total; clicking picks those days. The readout sits ABOVE the plot rather than
 * floating over it, so it never hides the line or an axis label (it did, on phones).
 * The key-point row under the plot is the table view, readable without the chart.
 */
const HEIGHT = 210;
// Room for the axis titles: rotated y title on the left, x title under the ticks.
const PAD = { top: 10, right: 16, bottom: 44, left: 70 };
// `compact` (the general page, 47a): no ticks, the axis names inside the plot, the
// picked day as a cyan label on the line, and the total under it.
const HEIGHT_COMPACT = 200;
const PAD_COMPACT = { top: 30, right: 12, bottom: 30, left: 12 };
const KEY_DAYS = [1, 7, 14, 30, 60, 90];

const round4 = (n) => Math.round(n * 10000) / 10000;

function niceTicks(min, max, count = 4) {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(round4(v));
  return out;
}

export default function DayRateChart({ rate, dayCurveK, minDays = 1, maxDays = 90, days, seconds, formatLabel, onPickDays, compact = false }) {
  const { t } = useTranslation();
  const HEIGHT_ = compact ? HEIGHT_COMPACT : HEIGHT;
  const PAD_ = compact ? PAD_COMPACT : PAD;
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.max(240, el.clientWidth || 560));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  // A chart first drawn inside a hidden tab measured 0 and fell back to 560; catch up
  // on the next render once it is visible, in case the observer did not report it.
  // Every render on purpose; it only sets state when the width really changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const w = wrapRef.current?.clientWidth || 0;
    if (w > 0 && Math.abs(Math.max(240, w) - width) > 1) setWidth(Math.max(240, w));
  });

  const lo = Math.max(1, Math.floor(Number(minDays) || 1));
  const hi = Math.max(lo + 1, Math.floor(Number(maxDays) || 90));
  // Per second per day for d days: the quote's curve (days^K x rate), unrounded, so
  // cheap formats draw a smooth line instead of the 0.001 HBD steps of a 1 s quote.
  // Totals in the tooltip still come from flightPrice, to match the form exactly.
  const k = Number(dayCurveK);
  const exp = Number.isFinite(k) && k > 0 && k <= 1 ? k : 1;
  const perSecDay = (d) => (Number.isFinite(Number(rate)) && d > 0 ? (d ** exp) * Number(rate) / d : null);

  const points = useMemo(() => {
    const out = [];
    for (let d = lo; d <= hi; d += 1) {
      const v = perSecDay(d);
      if (v != null) out.push({ d, v });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- perSecDay is derived from these
  }, [rate, exp, lo, hi]);

  if (points.length < 2) return null;

  const vMax = Math.max(...points.map((p) => p.v));
  const vMin = Math.min(...points.map((p) => p.v));
  // A flat line (no curve) still needs a visible band to sit in.
  const yTop = vMax * 1.05;
  const yBottom = vMax === vMin ? 0 : Math.max(0, vMin - (vMax - vMin) * 0.1);
  const plotW = width - PAD_.left - PAD_.right;
  const plotH = HEIGHT_ - PAD_.top - PAD_.bottom;
  const x = (d) => PAD_.left + ((d - lo) / (hi - lo)) * plotW;
  const y = (v) => PAD_.top + (1 - (v - yBottom) / (yTop - yBottom)) * plotH;

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const yTicks = niceTicks(yBottom, yTop, 3).filter((v) => v >= yBottom && v <= yTop);
  const xTicks = KEY_DAYS.filter((d) => d >= lo && d <= hi);
  if (!xTicks.includes(lo)) xTicks.unshift(lo);
  if (!xTicks.includes(hi)) xTicks.push(hi);

  const chosen = Number(days) >= lo && Number(days) <= hi ? Math.round(Number(days)) : null;
  const secs = Number(seconds) > 0 ? Number(seconds) : null;

  const dayAt = (clientX) => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return null;
    const px = clientX - box.left;
    const d = Math.round(lo + ((px - PAD_.left) / plotW) * (hi - lo));
    return Math.min(hi, Math.max(lo, d));
  };

  const focus = hover ?? chosen;
  const focusV = focus != null ? perSecDay(focus) : null;

  const tipText = (d) => {
    const v = perSecDay(d);
    if (v == null) return '';
    const line = t('ads.book.chartRate', { count: d, rate: round4(v) });
    return secs
      ? `${line} · ${t('ads.book.chartTotal', { seconds: secs, count: d, total: flightPrice(d, rate, secs, dayCurveK) })}`
      : line;
  };

  if (compact) {
    // Keyboard: the plot is a slider over the days, so the picked length can be
    // changed without a pointer (the full chart has the chip row for that).
    const pick = (d) => onPickDays?.(Math.min(hi, Math.max(lo, d)));
    const onKey = (e) => {
      const cur = chosen ?? lo;
      const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 7, PageDown: -7 }[e.key];
      if (step) { e.preventDefault(); pick(cur + step); }
      else if (e.key === 'Home') { e.preventDefault(); pick(lo); }
      else if (e.key === 'End') { e.preventDefault(); pick(hi); }
    };
    const fx = focus != null ? x(focus) : null;
    const fy = focusV != null ? y(focusV) : null;
    // The label sits right of the marker, or left of it near the right edge.
    const flip = fx != null && fx > width - 150;
    return (
      <figure className="mkt-dayrate is-compact">
        <figcaption className="mkt-dayrate-sr">{t('ads.book.chartTitle', { format: formatLabel })}</figcaption>
        <div
          className="mkt-dayrate-plot"
          ref={wrapRef}
          role="slider"
          tabIndex={0}
          aria-label={t('ads.book.chartAria', {
            format: formatLabel, from: round4(points[0].v), to: round4(points[points.length - 1].v), min: lo, max: hi,
          })}
          aria-valuemin={lo}
          aria-valuemax={hi}
          aria-valuenow={chosen ?? undefined}
          aria-valuetext={chosen != null ? tipText(chosen) : undefined}
          onKeyDown={onKey}
          onPointerMove={(e) => setHover(dayAt(e.clientX))}
          onPointerLeave={() => setHover(null)}
          onClick={(e) => { const d = dayAt(e.clientX); if (d != null) onPickDays?.(d); }}
        >
          <svg width={width} height={HEIGHT_} aria-hidden="true">
            <path className="mkt-dayrate-line" d={path} />
            {fx != null ? (
              <line className="mkt-dayrate-cross" x1={fx} x2={fx} y1={0} y2={HEIGHT_} />
            ) : null}
          </svg>
          <span className="mkt-dayrate-yname">{t('ads.book.chartYAxis')}</span>
          <span className="mkt-dayrate-xname">{t('ads.book.chartDays')}</span>
          {fx != null && fy != null ? (
            <span
              className="mkt-dayrate-flag"
              style={flip
                ? { right: width - fx + 8, top: Math.max(4, fy - 30) }
                : { left: fx + 8, top: Math.max(4, fy - 30) }}
            >
              {t('ads.book.chartChip', { count: focus, rate: round4(focusV) })}
            </span>
          ) : null}
        </div>
        <p className="mkt-dayrate-total" aria-live="polite">
          {focus != null && secs
            ? t('ads.book.chartTotal', { seconds: secs, count: focus, total: flightPrice(focus, rate, secs, dayCurveK) })
            : (focus != null ? t('ads.book.chartRate', { count: focus, rate: round4(focusV) }) : '\u00a0')}
        </p>
      </figure>
    );
  }

  return (
    <figure className="mkt-dayrate">
      <figcaption className="mkt-dayrate-head">
        <strong>{t('ads.book.chartTitle', { format: formatLabel })}</strong>
        <span className="mkt-hint">{t('ads.book.chartSub')}</span>
      </figcaption>
      <p className="mkt-dayrate-readout" aria-live="polite">
        {focus != null ? tipText(focus) : '\u00a0'}
      </p>
      <div
        className="mkt-dayrate-plot"
        ref={wrapRef}
        onPointerMove={(e) => setHover(dayAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onClick={(e) => { const d = dayAt(e.clientX); if (d != null) onPickDays?.(d); }}
      >
        <svg
          width={width}
          height={HEIGHT_}
          role="img"
          aria-label={t('ads.book.chartAria', {
            format: formatLabel, from: round4(points[0].v), to: round4(points[points.length - 1].v), min: lo, max: hi,
          })}
        >
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line className="mkt-dayrate-grid" x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
              <text className="mkt-dayrate-axis" x={PAD.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">{v}</text>
            </g>
          ))}
          {xTicks.map((d) => (
            <text key={`x${d}`} className="mkt-dayrate-axis" x={x(d)} y={PAD.top + plotH + 18} textAnchor="middle">{d}</text>
          ))}
          <line className="mkt-dayrate-baseline" x1={PAD.left} x2={width - PAD.right} y1={PAD.top + plotH} y2={PAD.top + plotH} />
          <text className="mkt-dayrate-title" x={PAD.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle">{t('ads.book.chartDays')}</text>
          <text
            className="mkt-dayrate-title"
            transform={`translate(14 ${PAD.top + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {t('ads.book.chartYAxis')}
          </text>
          <path className="mkt-dayrate-line" d={path} />
          {focus != null && focusV != null ? (
            <g>
              <line className="mkt-dayrate-cross" x1={x(focus)} x2={x(focus)} y1={PAD.top} y2={PAD.top + plotH} />
              <circle className="mkt-dayrate-dot" cx={x(focus)} cy={y(focusV)} r={5} />
            </g>
          ) : null}
          {/* The booked length stays marked while hovering elsewhere. */}
          {hover != null && chosen != null && hover !== chosen ? (
            <circle className="mkt-dayrate-dot is-chosen" cx={x(chosen)} cy={y(perSecDay(chosen))} r={4} />
          ) : null}
        </svg>
      </div>
      <ul className="mkt-dayrate-keys">
        {xTicks.map((d) => (
          <li key={d}>
            <button type="button" className={d === chosen ? 'selected' : ''} onClick={() => onPickDays?.(d)}>
              {t('ads.book.chartChip', { count: d, rate: round4(perSecDay(d)) })}
            </button>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * The same chart on the general Advertise page, before anybody has booked anything:
 * pick a format and a length, see what every flight length costs. Reads the rate card
 * the page already loaded, so the numbers are the ones the booking form will quote.
 */
export function PriceExplorer({ pricing, compact = false }) {
  const { t } = useTranslation();
  const formats = (pricing?.formats || []).filter((f) => Number.isFinite(Number(f.ratePerSecondDayHbd)));
  const [key, setKey] = useState(null);
  const fmt = formats.find((f) => f.key === key) || formats[0] || null;
  const maxSeconds = fmt?.maxSeconds || pricing?.maxCreativeSeconds || 30;
  const [secondsRaw, setSecondsRaw] = useState('10');
  const [days, setDays] = useState(() => Math.max(14, pricing?.minDays || 1));
  const uid = useId();
  const secondsId = `mkt-explore-seconds-${uid}`;
  const formatId = `mkt-explore-format-${uid}`;
  if (!fmt) return null;
  const secs = Math.min(maxSeconds, Math.max(1, parseInt(secondsRaw, 10) || 0));
  if (compact) {
    // 47a: two filled chips, "Ad format: Video spot" and "Ad length: 10 s", over the plot.
    return (
      <div className="mkt-explorer is-compact">
        <div className="mkt-explorer-chips">
          <label className="mkt-xchip mkt-xchip--select" htmlFor={formatId}>
            <span className="mkt-xchip__k">{t('ads.general.explorerFormat')}:</span>
            <select id={formatId} value={fmt.key} onChange={(e) => setKey(e.target.value)}>
              {formats.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            <Icon name="expand_more" size={16} aria-hidden="true" />
          </label>
          <label className="mkt-xchip" htmlFor={secondsId}>
            <span className="mkt-xchip__k">{t('ads.general.explorerLength')}:</span>
            <input
              id={secondsId}
              type="number"
              min={1}
              max={maxSeconds}
              step={1}
              value={secondsRaw}
              aria-label={t('ads.general.explorerSeconds', { max: maxSeconds })}
              onChange={(e) => setSecondsRaw(e.target.value)}
            />
            <span aria-hidden="true">{t('ads.general.explorerUnit')}</span>
          </label>
        </div>
        <DayRateChart
          compact
          rate={Number(fmt.ratePerSecondDayHbd)}
          dayCurveK={pricing?.dayCurveK}
          minDays={pricing?.minDays || 1}
          maxDays={pricing?.maxDays || 90}
          days={days}
          seconds={secs}
          formatLabel={fmt.label}
          onPickDays={setDays}
        />
      </div>
    );
  }
  return (
    <div className="mkt-explorer">
      <div className="mkt-explorer-controls">
      <div className="mkt-field mkt-explorer-format">
        <label htmlFor={formatId}>{t('ads.general.explorerFormat')}</label>
        <select id={formatId} value={fmt.key} onChange={(e) => setKey(e.target.value)}>
          {formats.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
      </div>
      <div className="mkt-field mkt-explorer-seconds">
        <label htmlFor={secondsId}>{t('ads.general.explorerSeconds', { max: maxSeconds })}</label>
        <input
          id={secondsId}
          type="number"
          min={1}
          max={maxSeconds}
          step={1}
          value={secondsRaw}
          onChange={(e) => setSecondsRaw(e.target.value)}
        />
      </div>
      </div>
      <DayRateChart
        rate={Number(fmt.ratePerSecondDayHbd)}
        dayCurveK={pricing?.dayCurveK}
        minDays={pricing?.minDays || 1}
        maxDays={pricing?.maxDays || 90}
        days={days}
        seconds={secs}
        formatLabel={fmt.label}
        onPickDays={setDays}
      />
    </div>
  );
}

PriceExplorer.propTypes = {
  pricing: PropTypes.object,
  compact: PropTypes.bool,
};

DayRateChart.propTypes = {
  rate: PropTypes.number.isRequired,
  dayCurveK: PropTypes.number,
  minDays: PropTypes.number,
  maxDays: PropTypes.number,
  days: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  seconds: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  formatLabel: PropTypes.string,
  onPickDays: PropTypes.func,
  compact: PropTypes.bool,
};
