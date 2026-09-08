import { useState } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { REPORT_API_URL, REPORT_API_SECRET } from '../../utils/config';
import './ReportModal.scss';

// Every toast from this module is headed "Report"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Report');

/**
 * Check if a target has been reported by this browser.
 * @param {'post'|'comment'|'user'} objectType
 * @param {string} objectId - "author/permlink" or "username"
 */
export function isReported(objectType, objectId) {
  try { return localStorage.getItem(`reported_${objectType}_${objectId}`) === '1'; } catch { return false; }
}

const REPORT_REASONS = {
  post: [
    { value: 'spam', label: 'Spam or misleading' },
    { value: 'harassment', label: 'Harassment or bullying' },
    { value: 'hate_speech', label: 'Hate speech' },
    { value: 'violence', label: 'Violent or graphic content' },
    { value: 'sexual', label: 'Sexual content' },
    { value: 'copyright', label: 'Copyright infringement' },
    { value: 'scam', label: 'Scam or fraud' },
    { value: 'other', label: 'Other' },
  ],
  video: [
    { value: 'spam', label: 'Spam or misleading' },
    { value: 'harassment', label: 'Harassment or bullying' },
    { value: 'hate_speech', label: 'Hate speech' },
    { value: 'violence', label: 'Violent or graphic content' },
    { value: 'sexual', label: 'Sexual content' },
    { value: 'copyright', label: 'Copyright infringement' },
    { value: 'scam', label: 'Scam or fraud' },
    { value: 'other', label: 'Other' },
  ],
  comment: [
    { value: 'spam', label: 'Spam' },
    { value: 'harassment', label: 'Harassment or bullying' },
    { value: 'hate_speech', label: 'Hate speech' },
    { value: 'impersonation', label: 'Impersonation' },
    { value: 'other', label: 'Other' },
  ],
  user: [
    { value: 'spam', label: 'Spam account' },
    { value: 'harassment', label: 'Harassment or bullying' },
    { value: 'hate_speech', label: 'Hate speech' },
    { value: 'impersonation', label: 'Impersonation' },
    { value: 'scam', label: 'Scam or fraud' },
    { value: 'other', label: 'Other' },
  ],
};

/**
 * ReportModal - report videos, comments, or users
 *
 * @param {boolean} isOpen
 * @param {() => void} onClose
 * @param {'post' | 'video' | 'comment' | 'user'} type
 * @param {{ author: string, permlink?: string }} target - what is being reported
 */
export default function ReportModal({ isOpen, onClose, type = 'video', target }) {
  const { user } = useAppStore();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasons = REPORT_REASONS[type] || REPORT_REASONS.video;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) {
      toast.error('Please select a reason');
      return;
    }
    if (!user) {
      toast.error('You must be logged in to report');
      return;
    }

    setSubmitting(true);
    try {
      // Build object_id: for users just the username, for posts/comments "author/permlink"
      const objectType = type === 'video' ? 'post' : type === 'short' ? 'short' : type;
      const objectId = type === 'user'
        ? target?.author
        : `${target?.author}/${target?.permlink}`;

      const res = await fetch(`${REPORT_API_URL}/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Secret': REPORT_API_SECRET,
        },
        body: JSON.stringify({
          object_id: objectId,
          object_type: objectType,
          reason,
          comment: comment.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Report failed (${res.status})`);
      }

      // Remember this report in localStorage
      const reportKey = `reported_${objectType}_${objectId}`;
      try {
        localStorage.setItem(reportKey, '1');
      } catch {
        // Ignore storage failures; the report itself was accepted.
      }

      toast.success('Report submitted. Thank you.');
      handleClose();
    } catch (err) {
      console.error('Report failed:', err);
      toast.error('Failed to submit report');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setReason('');
    setComment('');
    onClose();
  };

  if (!isOpen) return null;

  const typeLabel = type === 'user' ? 'User' : type === 'comment' ? 'Comment' : type === 'short' ? 'Short' : type === 'post' ? 'Post' : 'Video';

  return createPortal(
    <div className="report-modal-overlay" onClick={handleClose}>
      <div className="report-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="report-close-btn" onClick={handleClose}>
          <IoClose size={22} />
        </button>

        <h3 className="report-modal-title">Report {typeLabel}</h3>

        {target?.author && (
          <p className="report-target">
            @{target.author}{target.permlink ? ` / ${target.permlink}` : ''}
          </p>
        )}

        <form onSubmit={handleSubmit} className="report-form">
          <label className="report-label">Reason</label>
          <select
            className="report-select"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">Select a reason...</option>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>

          <label className="report-label">Additional details (optional)</label>
          <textarea
            className="report-textarea"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Provide more context..."
            rows={3}
            maxLength={500}
          />

          <button
            type="submit"
            className="report-submit-btn"
            disabled={submitting || !reason}
          >
            {submitting ? 'Submitting...' : 'Submit Report'}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
