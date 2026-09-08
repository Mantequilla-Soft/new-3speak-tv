import { useState } from 'react';
import axios from 'axios';
import { Flag } from 'lucide-react';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL } from '../../utils/config';
import { APP_VERSION } from '../../version';
import { useAppStore } from '../../lib/store';
import './StreamReportButton.scss';

// Every toast from this module is headed "Live"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Live');

// Report a live stream / room for abuse. POSTs to the checker's `/reports`
// collection (processed:false) for moderator triage — same triage pattern as
// the feedback reviews. Reasons mirror the checker's accepted set.
const REASONS = [
  { value: 'harassment', label: 'Harassment or hate' },
  { value: 'sexual', label: 'Sexual or explicit content' },
  { value: 'violence', label: 'Violence or dangerous acts' },
  { value: 'selfharm', label: 'Self-harm' },
  { value: 'illegal', label: 'Illegal content' },
  { value: 'spam', label: 'Spam or scam' },
  { value: 'other', label: 'Something else' },
];

/**
 * @param {string} roomName – the live room / stream id being reported
 * @param {string} host     – the streamer (Hive account) being reported
 * @param {string} [variant] – 'sidebar' (mobile action rail) | 'inline' (default)
 */
export default function StreamReportButton({ roomName, host, variant = 'inline' }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [sending, setSending] = useState(false);
  const user = useAppStore((s) => s.user);

  const close = () => { if (!sending) { setOpen(false); setReason(''); setDetail(''); } };

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    try {
      await axios.post(`${CHECKER_URL}/reports`, {
        kind: 'stream',
        reason,
        detail: detail.trim(),
        roomName: roomName || null,
        reported: host || null,
        reporter: user || null,
        url: typeof window !== 'undefined' ? window.location.href : null,
        app_version: APP_VERSION,
        path: typeof window !== 'undefined' ? window.location.pathname : null,
      });
      toast.success('Thanks — this stream has been reported to our team.');
      setOpen(false); setReason(''); setDetail('');
    } catch (e) {
      toast.error('Could not send the report. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {variant === 'sidebar' ? (
        <div className="actionItem" onClick={() => setOpen(true)} role="button" title="Report this stream">
          <div className="actionButton"><Flag size={22} /></div>
          <span className="actionLabel">Report</span>
        </div>
      ) : (
        <button type="button" className="stream-report-trigger" onClick={() => setOpen(true)} title="Report this stream">
          <Flag size={16} /> <span>Report</span>
        </button>
      )}

      {open && (
        <div className="stream-report" role="dialog" aria-label="Report this stream" aria-modal="true">
          <div className="stream-report__backdrop" onClick={close} />
          <div className="stream-report__card">
            <div className="stream-report__head">
              <strong>Report this stream</strong>
              <button className="stream-report__close" onClick={close} aria-label="Close">✕</button>
            </div>
            <p className="stream-report__sub">
              {host ? <>Reporting <b>@{host}</b>. </> : null}Tell us what's wrong — our team reviews every report.
            </p>

            <div className="stream-report__reasons">
              {REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  className={`stream-report__reason${reason === r.value ? ' is-selected' : ''}`}
                  onClick={() => setReason(r.value)}
                  aria-pressed={reason === r.value}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <textarea
              className="stream-report__detail"
              placeholder="Add any details (optional)"
              value={detail}
              maxLength={4000}
              onChange={(e) => setDetail(e.target.value)}
            />

            <div className="stream-report__actions">
              <button className="stream-report__cancel" onClick={close} disabled={sending}>Cancel</button>
              <button className="stream-report__submit" onClick={submit} disabled={!reason || sending}>
                {sending ? 'Sending…' : 'Submit report'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
