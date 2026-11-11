import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { fetchVideoAnalytics, fmtCount } from '../../lib/creatorStats';
import { Icon } from '../v2/Icon';
import useSeekPreview from '../../hooks/useSeekPreview';
import './VideoStats.scss';
import { useTranslation, Trans } from 'react-i18next';

// The insight strings open with an emoji in every locale; the chips draw a
// Material icon instead (no emoji as icons), so the leading emoji is dropped.
const LEAD_EMOJI = /^\s*\p{Extended_Pictographic}\uFE0F?\s*/u;

function mmss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// SVG area over the 0→100% timeline (retention / most-replayed). Single series,
// so no legend — the block title names it. On hover it shows a low-res video
// frame at that moment (same scrub-preview technique as the player timeline;
// see useSeekPreview) plus the value + timestamp — falls back to a plain
// tooltip when no videoId is available.
// `bars` draws N bars instead of the area (23d retention, 45a most replayed): the
// highest bar (or `hotIndex`) in the accent. `marker` is a dashed accent line at
// a position (0..1) with a label pill (45a: the biggest drop-off).
export function PositionChart({ values, maxValue, color, duration, formatValue, emptyLabel, videoId, bars = 0, hotIndex = null, marker = null, axis = true }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const n = values?.length || 0;
  const has = n > 1 && values.some((v) => v > 0);

  const {
    videoRef: previewVideoRef, preview, previewWidth, showAt, hide,
  } = useSeekPreview({ videoId, trackRef: wrapRef, duration });

  // The area (a tint) and its top edge (the line), drawn in the series color.
  const { path, line } = useMemo(() => {
    if (!has) return { path: '', line: '' };
    const y = (v) => (100 - Math.max(0, Math.min(1, (v || 0) / maxValue)) * 96).toFixed(2);
    const pts = values.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${y(v)}`).join(' L');
    return { path: `M0,100 L${pts} L100,100 Z`, line: `M${pts}` };
  }, [values, maxValue, has, n]);

  // Handles both mouse hover (desktop) and touch drag (mobile — no hover there).
  const onMove = useCallback((e) => {
    const el = wrapRef.current;
    if (!el || !n) return;
    const cx = e.touches && e.touches[0] ? e.touches[0].clientX : e.clientX;
    if (cx == null) return;
    const rect = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (cx - rect.left) / rect.width));
    setHover({ i: Math.min(n - 1, Math.round(frac * (n - 1))), x: frac });
    if (videoId) showAt(cx);
  }, [n, videoId, showAt]);

  const onLeave = useCallback(() => { setHover(null); hide(); }, [hide]);

  // Bucket the 0..100% samples into `bars` columns (mean of each bucket).
  const barVals = useMemo(() => {
    if (!bars || !has) return null;
    return Array.from({ length: bars }, (_, b) => {
      const from = Math.floor((b / bars) * n);
      const to = Math.max(from + 1, Math.floor(((b + 1) / bars) * n));
      const slice = values.slice(from, to);
      return slice.reduce((a, v) => a + (v || 0), 0) / (slice.length || 1);
    });
  }, [bars, has, n, values]);
  const hot = barVals
    ? (hotIndex != null ? Math.min(bars - 1, Math.floor(hotIndex * bars)) : barVals.indexOf(Math.max(...barVals)))
    : null;

  if (!has) return <div className="vs-chart-empty">{emptyLabel || t('stats.video.noData')}</div>;

  return (
    <div
      className={`vs-poschart${barVals ? ' is-bars' : ''}${axis ? '' : ' no-axis'}`}
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onTouchStart={onMove}
      onTouchMove={onMove}
      onTouchEnd={onLeave}
      onTouchCancel={onLeave}
    >
      {barVals ? (
        <div className="vs-bars" aria-hidden="true">
          {barVals.map((v, i) => (
            <span
              key={i}
              className={i === hot ? 'is-hot' : undefined}
              style={{ height: `${Math.max(4, Math.min(1, v / maxValue) * 100)}%`, ...(i === hot ? null : { background: color }) }}
            />
          ))}
        </div>
      ) : (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="vs-poschart-svg" aria-hidden="true">
          <path className="vs-poschart-area" d={path} style={{ fill: color }} />
          <path className="vs-poschart-line" d={line} style={{ stroke: color }} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      {marker && (
        <>
          <span className="vs-marker" style={{ left: `${marker.x * 100}%` }} aria-hidden="true" />
          <span className="vs-marker-label" style={{ left: `${marker.x * 100}%` }}>{marker.label}</span>
        </>
      )}
      {hover && <div className="vs-poschart-cursor" style={{ left: `${hover.x * 100}%` }} />}

      {videoId ? (
        // Low-res frame preview + value/timestamp, following the cursor.
        <div
          className={`vs-seek-preview${preview.visible ? ' visible' : ''}`}
          style={{ left: `${preview.leftPx}px`, width: `${previewWidth}px` }}
        >
          <video ref={previewVideoRef} className="vs-seek-preview-video" muted playsInline disablePictureInPicture />
          {hover && (
            <div className="vs-seek-preview-meta">
              <strong>{formatValue(values[hover.i])}</strong>
              <span>{mmss(hover.x * (duration || 0))}</span>
            </div>
          )}
        </div>
      ) : (
        hover && (
          <div className="vs-poschart-tip" style={{ left: `${hover.x * 100}%` }}>
            <strong>{formatValue(values[hover.i])}</strong>
            <span>{mmss(hover.x * (duration || 0))}</span>
          </div>
        )
      )}
      {axis && <div className="vs-poschart-axis"><span>0:00</span><span>{mmss(duration)}</span></div>}
    </div>
  );
}

// Derive quick insights from the retention/replay arrays.
function deriveInsights(data) {
  const retention = data.retention || [];
  const norm = data.replay?.normalized || [];
  const duration = data.duration || 0;
  const N = retention.length || 100;
  const tAt = (i) => (i / N) * duration;

  // Biggest drop-off: steepest single-step decline in retention.
  let dropI = -1, dropAmt = 0;
  for (let i = 0; i < retention.length - 1; i++) {
    const d = retention[i] - retention[i + 1];
    if (d > dropAmt) { dropAmt = d; dropI = i + 1; }
  }
  const biggestDrop = dropAmt >= 8 && dropI > 0
    ? { t: tAt(dropI), amt: Math.round(dropAmt), x: dropI / Math.max(1, retention.length - 1), left: retention[dropI] }
    : null;

  // Top replayed moments: peak buckets, deduped by proximity.
  const ranked = norm.map((v, i) => ({ v, i })).filter((p) => p.v >= 0.55).sort((a, b) => b.v - a.v);
  const picks = [];
  for (const p of ranked) {
    if (picks.every((m) => Math.abs(m.i - p.i) > N * 0.06)) picks.push(p);
    if (picks.length >= 3) break;
  }
  const topMoments = picks.sort((a, b) => a.i - b.i).map((m) => ({ t: tAt(m.i) }));

  // Early drop-off (swipe-away): viewers gone by ~3s.
  const b3 = Math.min(N - 1, Math.floor((3 / (duration || 1)) * N));
  const earlyDrop = duration > 0 ? Math.max(0, Math.round(100 - (retention[b3] ?? retention[0] ?? 0))) : null;

  return { biggestDrop, topMoments, earlyDrop };
}

/**
 * Per-video watch analytics, reused by the profile dashboard AND the watch page,
 * both drawn as 45a: four wells (unique viewers, avg view duration, avg watched,
 * avg speed), the retention curve with the biggest drop-off marked, the insights
 * line, most replayed as bars.
 *
 * variant "detail" (profile): the body only; the dashboard has its own title
 *   and footnote.
 * default (watch page, `.watch-stats-panel`): with the 16/700 title over it and
 *   the private footnote under it.
 *
 * @param {string} username  video owner (Hive author)
 * @param {string} permlink  asset OR Hive permlink (the API resolves either)
 * @param {boolean} compact  tighter layout for inline use (watch page)
 * @param {string} variant   "detail" for the profile dashboard
 * @param {string} title     optional panel title (the video's); defaults to "Video stats"
 * @param {function} onSeek  optional — makes replay timestamps clickable (seek the player)
 */
export default function VideoStats({ username, permlink, compact = false, variant = 'panel', title = '', onSeek = null }) {
  const { t } = useTranslation();
  const tPlain = (...args) => String(t(...args)).replace(LEAD_EMOJI, '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);
  const detail = variant === 'detail';
  const cls = `video-stats is-detail${compact ? ' compact' : ''}${detail ? '' : ' is-panel'}`;
  // The watch-page panel carries its own title (45a: 16/700, the video's name).
  const head = detail ? null : <h3 className="vs-title">{title || t('watch.actions.videoStats')}</h3>;

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setErr(false); setData(null);
    fetchVideoAnalytics(username, permlink)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setErr(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [username, permlink]);

  // The low-res scrub-preview loads by owner/permlink (the SDK resolves either
  // the asset or Hive permlink). Prefer the API's resolved asset permlink.
  const previewId = username && (data?.permlink || permlink)
    ? `${username}/${data?.permlink || permlink}`
    : null;

  if (loading) {
    return (
      <div className={cls} aria-busy="true">
        {head}
        <div className="vs-skeleton v2-skeleton" />
      </div>
    );
  }
  if (err || !data || data.sessions === 0) {
    return <div className={cls}>{head}<div className="vs-chart-empty">{t('stats.video.empty')}</div></div>;
  }

  const ins = deriveInsights(data);
  const showEarly = data.duration <= 90 && ins.earlyDrop != null;
  const hasInsights = ins.biggestDrop || ins.topMoments.length || showEarly;
  const avgView = data.sessions ? data.watchSeconds / data.sessions : 0;
  const norm = data.replay?.normalized || [];

  const insights = hasInsights ? (
    <div className="vs-insights">
      {ins.biggestDrop && <span className="vs-insight"><Icon name="trending_down" size={16} /><Trans t={tPlain} i18nKey="stats.video.mostDropOff" values={{ time: mmss(ins.biggestDrop.t) }} components={{ b: <b /> }} /></span>}
      {showEarly && <span className="vs-insight"><Icon name="bolt" size={16} /><Trans t={tPlain} i18nKey="stats.video.earlyDrop" values={{ pct: ins.earlyDrop }} components={{ b: <b /> }} /></span>}
      {ins.topMoments.length > 0 && (
        <span className="vs-insight"><Icon name="replay" size={16} />{tPlain('stats.video.replayed')}
          {ins.topMoments.map((m, i) => (
            onSeek
              ? <button key={i} type="button" className="vs-ts" onClick={() => onSeek(m.t)}>{mmss(m.t)}</button>
              : <b key={i} className="vs-ts-static">{mmss(m.t)}</b>
          ))}
        </span>
      )}
    </div>
  ) : null;

  return (
    <div className={cls}>
      {head}
      <div className="vs-wells">
        <div className="vs-well"><span>{t('stats.video.uniqueViewers')}</span><b>{fmtCount(data.viewers ?? data.sessions)}</b></div>
        <div className="vs-well"><span>{t('stats.tiles.avgViewDuration')}</span><b>{mmss(avgView)}</b></div>
        <div className="vs-well"><span>{t('stats.tiles.avgWatched')}</span><b>{`${Math.round(data.avgPct)}%`}</b></div>
        <div className="vs-well"><span>{t('stats.video.avgSpeed')}</span><b>{`${data.avgRate}×`}</b></div>
      </div>

      <h5 className="vs-h">{t('stats.video.retentionTitle')}<em>{t('stats.video.retentionSub')}</em></h5>
      <PositionChart
        values={data.retention} maxValue={100} duration={data.duration}
        color="var(--cyan)"
        formatValue={(v) => t('stats.video.pctWatching', { pct: Math.round(v) })}
        videoId={previewId}
        marker={ins.biggestDrop ? { x: ins.biggestDrop.x, label: t('stats.video.pctWatching', { pct: Math.round(ins.biggestDrop.left ?? 0) }) } : null}
      />
      {insights}

      <h5 className="vs-h">{t('stats.video.replayTitle')}<em>{t('stats.video.replaySub')}</em></h5>
      <PositionChart
        values={norm} maxValue={1} duration={data.duration}
        color="color-mix(in srgb, var(--text) 28%, transparent)"
        formatValue={() => t('stats.video.hotSpot')}
        emptyLabel={t('stats.video.notEnoughReplays')}
        videoId={previewId}
        bars={30}
        axis={false}
      />
      {!detail && <p className="vs-foot">{t('stats.footnote')}</p>}
    </div>
  );
}
