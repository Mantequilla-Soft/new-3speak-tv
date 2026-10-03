import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { fetchVideoAnalytics, fmtDuration, fmtCount } from '../../lib/creatorStats';
import BarLoader from '../Loader/BarLoader';
import useSeekPreview from '../../hooks/useSeekPreview';
import './VideoStats.scss';
import { useTranslation, Trans } from 'react-i18next';

function mmss(sec) {
  const s = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// SVG area over the 0→100% timeline (retention / most-replayed). Single series,
// so no legend — the block title names it. On hover it shows a low-res video
// frame at that moment (same scrub-preview technique as the player timeline;
// see useSeekPreview) plus the value + timestamp — falls back to a plain
// tooltip when no videoId is available.
export function PositionChart({ values, maxValue, color, duration, formatValue, emptyLabel, videoId }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const n = values?.length || 0;
  const has = n > 1 && values.some((v) => v > 0);

  const {
    videoRef: previewVideoRef, preview, previewWidth, showAt, hide,
  } = useSeekPreview({ videoId, trackRef: wrapRef, duration });

  const path = useMemo(() => {
    if (!has) return '';
    const y = (v) => (100 - Math.max(0, Math.min(1, (v || 0) / maxValue)) * 96).toFixed(2);
    const pts = values.map((v, i) => `${((i / (n - 1)) * 100).toFixed(2)},${y(v)}`).join(' L');
    return `M0,100 L${pts} L100,100 Z`;
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

  if (!has) return <div className="vs-chart-empty">{emptyLabel || t('stats.video.noData')}</div>;

  return (
    <div
      className="vs-poschart"
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onTouchStart={onMove}
      onTouchMove={onMove}
      onTouchEnd={onLeave}
      onTouchCancel={onLeave}
    >
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="vs-poschart-svg" aria-hidden="true">
        <path d={path} style={{ fill: color, stroke: color }} />
      </svg>
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
      <div className="vs-poschart-axis"><span>0:00</span><span>{mmss(duration)}</span></div>
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
  const biggestDrop = dropAmt >= 8 && dropI > 0 ? { t: tAt(dropI), amt: Math.round(dropAmt) } : null;

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
 * Per-video watch analytics — stats + insights + audience-retention + most-replayed.
 * Reused by the profile dashboard AND the watch page.
 *
 * @param {string} username  video owner (Hive author)
 * @param {string} permlink  asset OR Hive permlink (the API resolves either)
 * @param {boolean} compact  tighter layout for inline use (watch page)
 * @param {function} onSeek  optional — makes replay timestamps clickable (seek the player)
 */
export default function VideoStats({ username, permlink, compact = false, onSeek = null }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

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

  if (loading) return <div className={`video-stats${compact ? ' compact' : ''}`}><BarLoader /></div>;
  if (err || !data || data.sessions === 0) {
    return <div className={`video-stats${compact ? ' compact' : ''}`}><div className="vs-chart-empty">{t('stats.video.empty')}</div></div>;
  }

  return (
    <div className={`video-stats${compact ? ' compact' : ''}`}>
      <div className="vs-stats">
        <div><span>{fmtDuration(data.watchSeconds)}</span><label>{t('stats.metrics.watchTime')}</label></div>
        <div><span>{fmtCount(data.sessions)}</span><label>{t('stats.metrics.views')}</label></div>
        <div><span>{fmtCount(data.viewers)}</span><label>{t('stats.video.uniqueViewers')}</label></div>
        <div><span>{data.avgPct}%</span><label>{t('stats.tiles.avgWatched')}</label></div>
        <div><span>{data.avgRate}×</span><label>{t('stats.video.avgSpeed')}</label></div>
      </div>

      {(() => {
        const ins = deriveInsights(data);
        if (!ins.biggestDrop && !ins.topMoments.length && !(data.duration <= 90 && ins.earlyDrop)) return null;
        return (
          <div className="vs-insights">
            {ins.biggestDrop && <span className="vs-insight"><Trans i18nKey="stats.video.mostDropOff" values={{ time: mmss(ins.biggestDrop.t) }} components={{ b: <b /> }} /></span>}
            {data.duration <= 90 && ins.earlyDrop != null && <span className="vs-insight"><Trans i18nKey="stats.video.earlyDrop" values={{ pct: ins.earlyDrop }} components={{ b: <b /> }} /></span>}
            {ins.topMoments.length > 0 && (
              <span className="vs-insight">{t('stats.video.replayed')}
                {ins.topMoments.map((m, i) => (
                  onSeek
                    ? <button key={i} type="button" className="vs-ts" onClick={() => onSeek(m.t)}>{mmss(m.t)}</button>
                    : <b key={i} className="vs-ts-static">{mmss(m.t)}</b>
                ))}
              </span>
            )}
          </div>
        );
      })()}

      <div className="vs-charts">
        <div className="vs-chart-block">
          <h5>{t('stats.video.retentionTitle')}<em>{t('stats.video.retentionSub')}</em></h5>
          <PositionChart
            values={data.retention} maxValue={100} duration={data.duration}
            color="var(--accent-primary, #e53935)"
            formatValue={(v) => t('stats.video.pctWatching', { pct: Math.round(v) })}
            videoId={previewId}
          />
        </div>

        <div className="vs-chart-block">
          <h5>{t('stats.video.replayTitle')}<em>{t('stats.video.replaySub')}</em></h5>
          <PositionChart
            values={data.replay?.normalized || []} maxValue={1} duration={data.duration}
            color="rgba(120,170,255,0.85)"
            formatValue={() => t('stats.video.hotSpot')}
            emptyLabel={t('stats.video.notEnoughReplays')}
            videoId={previewId}
          />
        </div>
      </div>
    </div>
  );
}
