import { useEffect, useState } from 'react';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { APP_VERSION } from '../../version';
import './EmbedUploadProgressBar.scss';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Progress } from '../v2/ui';

// Compact elapsed time: 45s, 4m12s, 1h05m. Short enough to sit on the fault line
// without wrapping on a phone.
function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  if (h) return `${h}h${String(m).padStart(2, '0')}m`;
  if (m) return `${m}m${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

// Compact byte formatter for the diagnostics line — one decimal under 10 units so
// a slow trickle still visibly moves (9.4 MB → 9.6 MB), whole numbers above.
function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

// Cells in the chunk grid at most (35b: four columns); longer uploads map
// several chunks to one.
const MAX_CELLS = 24;

/**
 * The background video upload that starts on the "Add details" step, as a v2
 * card (design 35b): title with the percentage, the method as a pill, a cyan
 * bar (system work), the chunk strip for a chunked upload, the diagnostics in
 * mono, and Cancel. `compact` (the details step's side column) keeps the card
 * but drops the strip.
 * Hidden once the final publish flow takes over (it has its own status UI),
 * and for prefilled flows (nothing to upload).
 */
export default function EmbedUploadProgressBar({ compact = false }) {
  const { t } = useTranslation();
  const {
    videoUploadStatus, uploadProgress, uploading, prefilled, selectedEndpoint,
    statusText, uploadDetail, cancelEarlyUpload,
  } = useEmbedUpload();
  // Tick once a second while uploading purely so the elapsed clock keeps moving.
  // A wedged upload produces no progress events, and "stuck at 0%" reads very
  // differently at 20s than at 40 minutes — which is exactly the distinction a
  // screenshot has to carry on its own.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (videoUploadStatus !== 'uploading') return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [videoUploadStatus]);

  if (prefilled || uploading) return null;
  if (!videoUploadStatus || videoUploadStatus === 'idle') return null;

  const pct = videoUploadStatus === 'done' ? 100 : Math.max(0, Math.min(100, uploadProgress || 0));

  // The details step's side column (21c) names the work in one word and puts
  // the percentage at the right in mono; the full card (35b) says it in a line.
  const label =
    videoUploadStatus === 'done'
      ? (compact ? t('upload.progress.uploaded') : t('upload.progress.uploadedFinishDetails'))
      : videoUploadStatus === 'error'
        ? (statusText || t('upload.progress.backgroundFailed'))
        : compact ? t('upload.progress.uploading') : t('upload.progress.uploadingPct', { pct });

  // Show just the hostname of the chosen upload server.
  const endpointHost = selectedEndpoint
    ? selectedEndpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : '';

  // A percentage alone cannot tell "slow" from "wedged" — the exact confusion an
  // upload stuck at 0% causes. This line says which method is in play, which step
  // it is on, and whether bytes are actually moving, so a stall is legible.
  const d = uploadDetail || {};
  const method = d.method ? (d.method === 'reliable' ? t('upload.progress.methodReliable') : t('upload.progress.methodResumable')) : '';
  const bits = [];
  if (d.phase) bits.push(d.phase);
  if (d.attempts > 1 && d.attempt) bits.push(t('upload.progress.attempt', { attempt: d.attempt, attempts: d.attempts }));
  if (Number.isFinite(d.sent) && Number.isFinite(d.total) && d.total > 0) {
    // "sent" is bytes pushed into the socket; "confirmed" is what the server
    // acknowledged. A proxy that swallows uploads makes those two diverge, so
    // show both whenever they disagree.
    bits.push(
      Number.isFinite(d.acked) && d.acked !== d.sent
        ? t('upload.progress.sentConfirmedOf', { sent: fmtBytes(d.sent), acked: fmtBytes(d.acked), total: fmtBytes(d.total) })
        : t('upload.progress.sentOf', { sent: fmtBytes(d.sent), total: fmtBytes(d.total) }),
    );
  }
  if (Number.isFinite(d.chunksTotal) && d.chunksTotal > 0) {
    bits.push(t('upload.progress.chunk', { done: d.chunksDone ?? 0, total: d.chunksTotal }));
  }
  const detailLine = bits.join(' · ');

  // Second line: the transport shape actually in use. Chunk size and worker count
  // are the two numbers that decide whether a weak link can move anything at all,
  // and probeBps says what the link really did rather than what it claims.
  const shape = [];
  if (Number.isFinite(d.chunkBytes) && d.chunkBytes > 0) {
    shape.push(`${fmtBytes(d.chunkBytes)}${Number.isFinite(d.workers) ? ` x${d.workers}` : ''}`);
  }
  if (Number.isFinite(d.probeBps)) {
    shape.push(d.probeBps > 0 ? `probe ${Math.round((d.probeBps * 8) / 1000)}kbps` : 'probe failed');
  }
  if (d.link) {
    const link = [d.link];
    if (Number.isFinite(d.linkDown) && d.linkDown !== null) link.push(`dl${d.linkDown}`);
    if (Number.isFinite(d.linkRtt) && d.linkRtt !== null) link.push(`rtt${d.linkRtt}`);
    if (d.saveData) link.push('saveData');
    shape.push(link.join(' '));
  }
  const shapeLine = shape.join(' · ');

  // Third line: what has gone wrong and for how long. Version last, so a
  // screenshot always says which build produced everything above it.
  const faults = [];
  if (Number.isFinite(d.retries) && d.retries > 0) faults.push(`retries ${d.retries}`);
  if (d.lastError) faults.push(`last ${d.lastError}${d.lastStatus ? `/${d.lastStatus}` : ''}`);
  if (Number.isFinite(d.startedAt)) faults.push(fmtDuration(Date.now() - d.startedAt));
  if (Number.isFinite(d.fileBytes) && d.fileBytes > 0) faults.push(fmtBytes(d.fileBytes));
  faults.push(`v${APP_VERSION}`);
  const faultLine = faults.join(' · ');

  // The escape hatch. Display-only was the bug: an upload that could not move a
  // byte retried forever with nothing on screen to stop it.
  const canCancel = videoUploadStatus === 'uploading' || videoUploadStatus === 'error';
  const showWaiting = d.waitingOn && videoUploadStatus !== 'done';

  // Spin only while we are ATTEMPTING something with nothing to show for it yet:
  // an outstanding request (waitingOn), or an upload that has not moved a byte.
  // Once bytes flow the bar itself conveys motion, and a spinner next to a
  // climbing percentage is just noise.
  const isWaiting =
    videoUploadStatus !== 'done' &&
    videoUploadStatus !== 'error' &&
    (!!d.waitingOn || pct === 0);

  // The chunk strip: confirmed chunks cyan, the one in flight accent, the rest
  // still to go. Capped at MAX_CELLS cells so a long upload stays one strip.
  const chunksTotal = Number.isFinite(d.chunksTotal) && d.chunksTotal > 0 ? d.chunksTotal : 0;
  const cells = !compact && chunksTotal > 1 && videoUploadStatus !== 'done'
    ? Array.from({ length: Math.min(chunksTotal, MAX_CELLS) }, (_, i, arr) => {
      const per = chunksTotal / arr.length;
      const done = Math.min(chunksTotal, d.chunksDone ?? 0);
      if ((i + 1) * per <= done) return 'is-done';
      if (i * per <= done && videoUploadStatus === 'uploading') return 'is-live';
      return '';
    })
    : null;

  const tone = videoUploadStatus === 'error' ? 'is-error' : videoUploadStatus === 'done' ? 'is-done' : '';

  // 35b: a retry in progress reads as an accent line, and the switch to the
  // compatible method as a note, both from the status line the upload writes.
  const unstable = videoUploadStatus === 'uploading' && !!statusText && (
    statusText === t('upload.progress.connectionUnstable')
    || (Number(d.attempt) > 1 && statusText === t('upload.progress.connectionUnstableAttempt', { attempt: d.attempt, attempts: d.attempts }))
  );
  const switching = videoUploadStatus === 'uploading' && statusText === t('upload.progress.switchingMethod');

  return (
    <section
      className={`embed-upload-progress embed-upload-progress--${videoUploadStatus}${compact ? ' is-compact' : ''}`}
      aria-label={label}
    >
      <div className="embed-upload-progress-head">
        {/* The tone bar (35b); a spinner while nothing has moved yet. */}
        {isWaiting
          ? <Icon name="progress_activity" size={20} className="embed-upload-progress-icon v2-spin" />
          : <span className={`embed-upload-progress-bar ${tone}`} aria-hidden="true" />}
        <b className={`embed-upload-progress-label ${tone}`}>{label}</b>
        {compact && videoUploadStatus !== 'error' && <span className="embed-upload-progress-pct">{pct}%</span>}
        {method && videoUploadStatus !== 'done' && <span className="embed-upload-progress-method">{method}</span>}
      </div>
      {/* Full card: accent, the creator's own action (35b). Side column: cyan (21c). */}
      <Progress value={pct} tone={videoUploadStatus === 'error' || !compact ? 'accent' : 'cyan'} label={label} />
      {cells && (
        <div className="embed-upload-progress-chunks" aria-hidden="true">
          {cells.map((c, i) => <span key={i} className={c} />)}
        </div>
      )}
      {(detailLine || shapeLine || faultLine || endpointHost || unstable) && (
        <div className="embed-upload-progress-lines">
          {detailLine && <span className="embed-upload-progress-detail">{detailLine}</span>}
          {shapeLine && <span className="embed-upload-progress-detail">{shapeLine}</span>}
          {faultLine && <span className="embed-upload-progress-detail">{faultLine}</span>}
          {endpointHost && (
            <span className="embed-upload-progress-endpoint">{t('upload.progress.uploadServer', { host: endpointHost })}</span>
          )}
          {unstable && <span className="embed-upload-progress-detail is-accent">{statusText}</span>}
        </div>
      )}
      {switching && (
        <span className="embed-upload-progress-waiting">
          <Icon name="swap_horiz" size={18} />
          {t('upload.progress.patchBlockedSwitching')}
        </span>
      )}
      {showWaiting && (
        <span className="embed-upload-progress-waiting">
          <Icon name="hourglass_top" size={16} />
          {t('upload.progress.waitingOn', { what: d.waitingOn })}
        </span>
      )}
      {canCancel && (
        <Button
          variant="secondary"
          size={compact ? 36 : 44}
          next={false}
          trailing="close"
          className="embed-upload-progress-cancel is-next"
          onClick={cancelEarlyUpload}
        >
          {t('upload.progress.cancelUpload')}
        </Button>
      )}
    </section>
  );
}
