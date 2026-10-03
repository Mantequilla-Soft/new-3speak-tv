import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MdOutlineRateReview } from 'react-icons/md';
import { useReviewModal } from '../../lib/reviewStore';
import { useAppStore } from '../../lib/store';
import './ReviewModal.scss';

// Placeholder trigger for the review popup (area: 'global'). Shown ONLY on the
// main/home page ('/') for now; later it is replaced by the one-time "initial
// review" auto-prompt for every user.
export default function ReviewFab() {
  const { t } = useTranslation();
  const location = useLocation();
  const openReview = useReviewModal((s) => s.openReview);
  const user = useAppStore((s) => s.user);
  // On mobile the mini-player ("history bar") sits on top of the bottom nav, so lift
  // the FAB above it while it's showing (else the FAB covers that bar).
  const miniPlayer = useAppStore((s) => s.miniPlayer);

  if (location.pathname !== '/') return null;

  return (
    <button
      className={`review-fab${miniPlayer ? ' review-fab--mini' : ''}`}
      onClick={() => openReview({ area: 'global', username: user || null, permlink: null })}
      aria-label={t('comments.review.fabAria')}
    >
      <MdOutlineRateReview />
      <span>{t('comments.review.fab')}</span>
    </button>
  );
}
