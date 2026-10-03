import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation, Trans } from 'react-i18next';
import { MdStar, MdStarBorder, MdClose, MdThumbUp, MdThumbDown } from 'react-icons/md';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { toastIn } from '../../utils/toast';
import { CHECKER_URL } from '../../utils/config';
import { APP_VERSION } from '../../version';
import { useReviewModal } from '../../lib/reviewStore';
import './ReviewModal.scss';

// Every toast from this module is headed "Feedback"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Feedback');

// What the feedback is about — optional multi-select tags stored on the review.
const ASPECTS = [
  { key: 'upload', labelKey: 'comments.review.aspects.upload' },
  { key: 'playback', labelKey: 'comments.review.aspects.playback' },
  { key: 'live', labelKey: 'comments.review.aspects.live' },
  { key: 'discovery', labelKey: 'comments.review.aspects.discovery' },
  { key: 'design', labelKey: 'comments.review.aspects.design' },
  { key: 'performance', labelKey: 'comments.review.aspects.performance' },
  { key: 'mobile', labelKey: 'comments.review.aspects.mobile' },
  { key: 'other', labelKey: 'comments.review.aspects.other' },
];

// When the popup is opened for a specific context, pre-select the matching aspect.
const AREA_ASPECT = { upload: 'upload', stream: 'live', live: 'live' };

// Context-aware heading based on where the popup was opened from.
const TITLES = {
  upload: 'comments.review.titles.upload',
  stream: 'comments.review.titles.stream',
  live: 'comments.review.titles.stream',
  watch: 'comments.review.titles.watch',
  global: 'comments.review.titles.global',
};
const STAR_LABELS = ['', 'comments.review.stars.poor', 'comments.review.stars.fair', 'comments.review.stars.good', 'comments.review.stars.great', 'comments.review.stars.amazing'];

/**
 * Reusable feedback/review popup. Hand it { area, username, permlink } and an
 * onClose. Writes a review (1–5 stars + aspects + recommend + comment) to the
 * checker's `reviews` collection. area: 'global' | 'stream' | 'upload' | …
 */
function ReviewModal({ area = 'global', username = null, permlink = null, onClose }) {
  const { t } = useTranslation();
  const location = useLocation();
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [aspects, setAspects] = useState(() => {
    const preset = AREA_ASPECT[area];
    return preset ? [preset] : [];
  });
  const [recommend, setRecommend] = useState(null); // true | false | null
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const toggleAspect = (k) =>
    setAspects((prev) => (prev.includes(k) ? prev.filter((a) => a !== k) : [...prev, k]));

  const submit = async () => {
    if (!stars) {
      toast.error(t('comments.review.errors.pickStars'));
      return;
    }
    setSubmitting(true);
    try {
      await axios.post(`${CHECKER_URL}/reviews`, {
        area,
        username,
        permlink,
        stars,
        aspects,
        recommend,
        comment: comment.trim(),
        app_version: APP_VERSION,
        path: location.pathname,
      });
      toast.success(t('comments.review.thanks'));
      onClose?.();
    } catch (e) {
      toast.error(t('comments.review.errors.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const title = t(TITLES[area] || 'comments.review.titles.fallback');
  const shown = hover || stars;

  return createPortal(
    <div className="review-overlay" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="review-modal"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={t('comments.review.sendFeedback')}
      >
        <div className="review-header">
          <div className="review-head-text">
            <h3>{title}</h3>
            <p>{t('comments.review.subtitle')}</p>
          </div>
          <button className="review-close" onClick={onClose} aria-label={t('common.actions.close')}>
            <MdClose />
          </button>
        </div>

        <div className="review-body">
          <div className="review-stars" role="radiogroup" aria-label={t('comments.review.starRating')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star ${n <= shown ? 'on' : ''}`}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setStars(n)}
                aria-label={t('comments.review.starsAria', { count: n })}
                aria-pressed={stars === n}
              >
                {n <= shown ? <MdStar /> : <MdStarBorder />}
              </button>
            ))}
            <span className="star-label">{STAR_LABELS[shown] ? t(STAR_LABELS[shown]) : ''}</span>
          </div>

          <div className="review-field">
            <label>
              <Trans i18nKey="comments.review.aboutLabel" components={{ opt: <span /> }} />
            </label>
            <div className="review-chips">
              {ASPECTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={`chip ${aspects.includes(a.key) ? 'on' : ''}`}
                  onClick={() => toggleAspect(a.key)}
                >
                  {t(a.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="review-field">
            <label>
              <Trans i18nKey="comments.review.recommendLabel" components={{ opt: <span /> }} />
            </label>
            <div className="review-recommend">
              <button
                type="button"
                className={`rec ${recommend === true ? 'on yes' : ''}`}
                onClick={() => setRecommend(recommend === true ? null : true)}
              >
                <MdThumbUp /> {t('common.actions.yes')}
              </button>
              <button
                type="button"
                className={`rec ${recommend === false ? 'on no' : ''}`}
                onClick={() => setRecommend(recommend === false ? null : false)}
              >
                <MdThumbDown /> {t('common.actions.no')}
              </button>
            </div>
          </div>

          <div className="review-field">
            <label>
              <Trans i18nKey="comments.review.moreLabel" components={{ opt: <span /> }} />
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder={t('comments.review.placeholder')}
            />
          </div>
        </div>

        <div className="review-actions">
          <button className="review-cancel" onClick={onClose} disabled={submitting}>
            {t('comments.review.notNow')}
          </button>
          <button className="review-submit" onClick={submit} disabled={submitting || !stars}>
            {submitting ? t('comments.review.sending') : t('comments.review.sendFeedback')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ReviewModal;

// Global instance driven by the review store — mounted once in App. Individual
// callers (embed-studio finish, stream end) can render <ReviewModal .../> directly.
export function GlobalReviewModal() {
  const review = useReviewModal((s) => s.review);
  const closeReview = useReviewModal((s) => s.closeReview);
  if (!review) return null;
  return (
    <ReviewModal
      area={review.area}
      username={review.username}
      permlink={review.permlink}
      onClose={closeReview}
    />
  );
}
