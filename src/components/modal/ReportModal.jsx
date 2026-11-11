import { useId, useState } from 'react';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { REPORT_API_URL, REPORT_API_SECRET } from '../../utils/config';
import { useTranslation } from 'react-i18next';
import DialogShell from './DialogShell';
import { Button, ChoiceCard, Eyebrow, Field } from '../v2/ui';
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

// Material Symbols per reason (design 07c: reason tiles with an icon).
const REASON_ICONS = {
  spam: 'campaign',
  harassment: 'sentiment_dissatisfied',
  hate_speech: 'block',
  violence: 'warning',
  sexual: 'visibility_off',
  copyright: 'copyright',
  scam: 'gpp_bad',
  impersonation: 'person_off',
  other: 'more_horiz',
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

  const uid = useId();
  if (!isOpen) return null;

  const title = type === 'user' ? t('modals.report.titles.user') : type === 'comment' ? t('modals.report.titles.comment') : type === 'short' ? t('modals.report.titles.short') : type === 'post' ? t('modals.report.titles.post') : t('modals.report.titles.video');
  const formId = `${uid}-form`;
  const reasonLabelId = `${uid}-reason`;

  return (
    <DialogShell
      open
      onClose={handleClose}
      title={title}
      width={520}
      overlayClassName="report-modal-overlay"
      className="report-modal-content"
      footer={(
        <>
          <Button variant="secondary" onClick={handleClose}>{t('common.actions.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={submitting || !reason} loading={submitting}>
            {submitting ? t('modals.report.submitting') : t('modals.report.submit')}
          </Button>
        </>
      )}
    >
      {target?.author && (
        <p className="report-target">
          @{target.author}{target.permlink ? ` / ${target.permlink}` : ''}
        </p>
      )}

      <form id={formId} onSubmit={handleSubmit} className="report-form">
        <Eyebrow id={reasonLabelId}>{t('modals.report.reason')}</Eyebrow>
        <div className="report-reasons" role="radiogroup" aria-labelledby={reasonLabelId}>
          {reasons.map((r) => (
            <ChoiceCard
              key={r.value}
              className="report-reason"
              selected={reason === r.value}
              icon={REASON_ICONS[r.value] || 'flag'}
              title={t(r.labelKey)}
              onClick={() => setReason(r.value)}
            />
          ))}
        </div>

        <Field
          as="textarea"
          label={t('modals.report.details')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder={t('modals.report.detailsPlaceholder')}
          rows={3}
          maxLength={500}
        />
      </form>
    </DialogShell>
  );
}
