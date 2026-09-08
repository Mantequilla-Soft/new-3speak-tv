import { useState } from 'react';
import { createPortal } from 'react-dom';
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
  { key: 'upload', label: 'Uploading' },
  { key: 'playback', label: 'Playback' },
  { key: 'live', label: 'Live streaming' },
  { key: 'discovery', label: 'Discovery / feed' },
  { key: 'design', label: 'Design / UX' },
  { key: 'performance', label: 'Speed' },
  { key: 'mobile', label: 'Mobile' },
  { key: 'other', label: 'Something else' },
];

// When the popup is opened for a specific context, pre-select the matching aspect.
const AREA_ASPECT = { upload: 'upload', stream: 'live', live: 'live' };

// Context-aware heading based on where the popup was opened from.
const TITLES = {
  upload: 'How was your upload?',
  stream: 'How was your livestream?',
  live: 'How was your livestream?',
  watch: 'How was watching on 3Speak?',
  global: "How's your 3Speak experience?",
};
const STAR_LABELS = ['', 'Poor', 'Fair', 'Good', 'Great', 'Amazing'];

/**
 * Reusable feedback/review popup. Hand it { area, username, permlink } and an
 * onClose. Writes a review (1–5 stars + aspects + recommend + comment) to the
 * checker's `reviews` collection. area: 'global' | 'stream' | 'upload' | …
 */
function ReviewModal({ area = 'global', username = null, permlink = null, onClose }) {
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
      toast.error('Please pick a star rating');
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
      toast.success('Thanks for your feedback! 🙏');
      onClose?.();
    } catch (e) {
      toast.error('Could not send your review. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const title = TITLES[area] || 'Help us make 3Speak better';
  const shown = hover || stars;

  return createPortal(
    <div className="review-overlay" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
      <div
        className="review-modal"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Send feedback"
      >
        <div className="review-header">
          <div className="review-head-text">
            <h3>{title}</h3>
            <p>Your feedback helps us make 3Speak better.</p>
          </div>
          <button className="review-close" onClick={onClose} aria-label="Close">
            <MdClose />
          </button>
        </div>

        <div className="review-body">
          <div className="review-stars" role="radiogroup" aria-label="Star rating">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`star ${n <= shown ? 'on' : ''}`}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setStars(n)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                aria-pressed={stars === n}
              >
                {n <= shown ? <MdStar /> : <MdStarBorder />}
              </button>
            ))}
            <span className="star-label">{STAR_LABELS[shown] || ''}</span>
          </div>

          <div className="review-field">
            <label>
              What&apos;s this about? <span>(optional)</span>
            </label>
            <div className="review-chips">
              {ASPECTS.map((a) => (
                <button
                  key={a.key}
                  type="button"
                  className={`chip ${aspects.includes(a.key) ? 'on' : ''}`}
                  onClick={() => toggleAspect(a.key)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <div className="review-field">
            <label>
              Would you recommend 3Speak? <span>(optional)</span>
            </label>
            <div className="review-recommend">
              <button
                type="button"
                className={`rec ${recommend === true ? 'on yes' : ''}`}
                onClick={() => setRecommend(recommend === true ? null : true)}
              >
                <MdThumbUp /> Yes
              </button>
              <button
                type="button"
                className={`rec ${recommend === false ? 'on no' : ''}`}
                onClick={() => setRecommend(recommend === false ? null : false)}
              >
                <MdThumbDown /> No
              </button>
            </div>
          </div>

          <div className="review-field">
            <label>
              Tell us more <span>(optional)</span>
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="What did you like? What could be better?"
            />
          </div>
        </div>

        <div className="review-actions">
          <button className="review-cancel" onClick={onClose} disabled={submitting}>
            Not now
          </button>
          <button className="review-submit" onClick={submit} disabled={submitting || !stars}>
            {submitting ? 'Sending…' : 'Send feedback'}
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
