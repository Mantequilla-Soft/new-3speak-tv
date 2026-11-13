import { useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { Dialog } from '../v2/ui';
import { Icon } from '../v2/Icon';
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
    } catch {
      toast.error(t('comments.review.errors.sendFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const title = t(TITLES[area] || 'comments.review.titles.fallback');
  const shown = hover || stars;

  // The v2 Dialog (a sheet on phones), designs 17i / 43c. The wrapper stops a
  // press inside it from reaching outside-click handlers of whatever opened it
  // (a menu or another dialog): React events bubble through the portal.
  return (
    <div className="review-portal-guard" onMouseDown={(e) => e.stopPropagation()}>
      <Dialog
        open
        onClose={onClose}
        title={title}
        sub={t('comments.review.subtitle')}
        closeLabel={t('common.actions.close')}
        width={480}
        className="review-modal"
        bodyClassName="review-body"
        footer={(
          <>
            <button type="button" className="v2-btn v2-btn--secondary h40 is-center review-cancel" onClick={onClose} disabled={submitting}>
              <span className="v2-btn__label">{t('comments.review.notNow')}</span>
            </button>
            <button type="button" className="v2-btn v2-btn--primary h40 is-center review-submit" onClick={submit} disabled={submitting || !stars}>
              <span className="v2-btn__label">{submitting ? t('comments.review.sending') : t('comments.review.sendFeedback')}</span>
              <Icon name={submitting ? 'progress_activity' : 'send'} size={18} className={submitting ? 'v2-spin' : undefined} />
            </button>
          </>
        )}
      >
          {/* Five stars in a row with the word for the rating beside them (43c). */}
          <div className="review-rating">
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
                <Icon name="star" size={28} fill />
              </button>
            ))}
          </div>
          <span className="star-label" aria-live="polite">{STAR_LABELS[shown] ? t(STAR_LABELS[shown]) : ''}</span>
          </div>

          <div className="review-field">
            <label className="v2-eyebrow">
              <Trans i18nKey="comments.review.aboutLabel" components={{ opt: <span className="v2-field__opt" /> }} />
            </label>
            <div className="review-chips v2-chips">
              {ASPECTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  aria-pressed={aspects.includes(a.key)}
                  className={`v2-chip chip${aspects.includes(a.key) ? ' is-on on' : ''}`}
                  onClick={() => toggleAspect(a.key)}
                >
                  {t(a.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="review-field">
            <label className="v2-eyebrow">
              <Trans i18nKey="comments.review.recommendLabel" components={{ opt: <span className="v2-field__opt" /> }} />
            </label>
            <div className="review-recommend">
              <button
                type="button"
                aria-pressed={recommend === true}
                className={`rec ${recommend === true ? 'on yes' : ''}`}
                onClick={() => setRecommend(recommend === true ? null : true)}
              >
                <Icon name="thumb_up" size={18} fill={recommend === true} /> {t('common.actions.yes')}
              </button>
              <button
                type="button"
                aria-pressed={recommend === false}
                className={`rec ${recommend === false ? 'on no' : ''}`}
                onClick={() => setRecommend(recommend === false ? null : false)}
              >
                <Icon name="thumb_down" size={18} fill={recommend === false} /> {t('common.actions.no')}
              </button>
            </div>
          </div>

          <div className="review-field">
            <label className="v2-eyebrow" htmlFor="review-more">
              <Trans i18nKey="comments.review.moreLabel" components={{ opt: <span className="v2-field__opt" /> }} />
            </label>
            <textarea
              id="review-more"
              className="v2-input is-area"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder={t('comments.review.placeholder')}
            />
          </div>
      </Dialog>
    </div>
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
