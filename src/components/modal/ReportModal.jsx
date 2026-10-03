import { useState } from 'react';
import { createPortal } from 'react-dom';
import { IoClose } from 'react-icons/io5';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { REPORT_API_URL, REPORT_API_SECRET } from '../../utils/config';
import { useTranslation } from 'react-i18next';
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
    { value: 'spam', labelKey: 'modals.report.reasons.spamMisleading' },
    { value: 'harassment', labelKey: 'modals.report.reasons.harassment' },
    { value: 'hate_speech', labelKey: 'modals.report.reasons.hateSpeech' },
    { value: 'violence', labelKey: 'modals.report.reasons.violence' },
    { value: 'sexual', labelKey: 'modals.report.reasons.sexual' },
    { value: 'copyright', labelKey: 'modals.report.reasons.copyright' },
    { value: 'scam', labelKey: 'modals.report.reasons.scam' },
    { value: 'other', labelKey: 'modals.report.reasons.other' },
  ],
  video: [
    { value: 'spam', labelKey: 'modals.report.reasons.spamMisleading' },
    { value: 'harassment', labelKey: 'modals.report.reasons.harassment' },
    { value: 'hate_speech', labelKey: 'modals.report.reasons.hateSpeech' },
    { value: 'violence', labelKey: 'modals.report.reasons.violence' },
    { value: 'sexual', labelKey: 'modals.report.reasons.sexual' },
    { value: 'copyright', labelKey: 'modals.report.reasons.copyright' },
    { value: 'scam', labelKey: 'modals.report.reasons.scam' },
    { value: 'other', labelKey: 'modals.report.reasons.other' },
  ],
  comment: [
    { value: 'spam', labelKey: 'modals.report.reasons.spam' },
    { value: 'harassment', labelKey: 'modals.report.reasons.harassment' },
    { value: 'hate_speech', labelKey: 'modals.report.reasons.hateSpeech' },
    { value: 'impersonation', labelKey: 'modals.report.reasons.impersonation' },
    { value: 'other', labelKey: 'modals.report.reasons.other' },
  ],
  user: [
    { value: 'spam', labelKey: 'modals.report.reasons.spamAccount' },
    { value: 'harassment', labelKey: 'modals.report.reasons.harassment' },
    { value: 'hate_speech', labelKey: 'modals.report.reasons.hateSpeech' },
    { value: 'impersonation', labelKey: 'modals.report.reasons.impersonation' },
    { value: 'scam', labelKey: 'modals.report.reasons.scam' },
    { value: 'other', labelKey: 'modals.report.reasons.other' },
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
  const { t } = useTranslation();
  const { user } = useAppStore();
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reasons = REPORT_REASONS[type] || REPORT_REASONS.video;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!reason) {
      toast.error(t('modals.report.selectReasonError'));
      return;
    }
    if (!user) {
      toast.error(t('modals.report.loginRequired'));
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

      toast.success(t('modals.report.submitted'));
      handleClose();
    } catch (err) {
      console.error('Report failed:', err);
      toast.error(t('modals.report.failed'));
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

  const title = type === 'user' ? t('modals.report.titles.user') : type === 'comment' ? t('modals.report.titles.comment') : type === 'short' ? t('modals.report.titles.short') : type === 'post' ? t('modals.report.titles.post') : t('modals.report.titles.video');

  return createPortal(
    <div className="report-modal-overlay" onClick={handleClose}>
      <div className="report-modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="report-close-btn" onClick={handleClose}>
          <IoClose size={22} />
        </button>

        <h3 className="report-modal-title">{title}</h3>

        {target?.author && (
          <p className="report-target">
            @{target.author}{target.permlink ? ` / ${target.permlink}` : ''}
          </p>
        )}

        <form onSubmit={handleSubmit} className="report-form">
          <label className="report-label">{t('modals.report.reason')}</label>
          <select
            className="report-select"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          >
            <option value="">{t('modals.report.selectReason')}</option>
            {reasons.map((r) => (
              <option key={r.value} value={r.value}>{t(r.labelKey)}</option>
            ))}
          </select>

          <label className="report-label">{t('modals.report.details')}</label>
          <textarea
            className="report-textarea"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('modals.report.detailsPlaceholder')}
            rows={3}
            maxLength={500}
          />

          <button
            type="submit"
            className="report-submit-btn"
            disabled={submitting || !reason}
          >
            {submitting ? t('modals.report.submitting') : t('modals.report.submit')}
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
}
