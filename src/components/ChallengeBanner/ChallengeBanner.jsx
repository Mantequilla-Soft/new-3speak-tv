import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/ui';
import { challengeText, useCurrentChallenge } from '../../lib/shortsChallenge';
import './ChallengeBanner.scss';

/**
 * One line pointing at this week's Shorts challenge (lib/shortsChallenge.js),
 * for the Shorts uploader: the theme and a link to /challenge. Nothing in a
 * week without a challenge.
 */
export default function ChallengeBanner({ className = '' }) {
  const { t } = useTranslation();
  const challenge = useCurrentChallenge();
  if (!challenge) return null;
  const title = challengeText(challenge, 'title');
  return (
    <Link to="/challenge" className={`challenge-banner ${className}`.trim()}>
      <span className="challenge-banner__icon"><Icon name="emoji_events" size={20} /></span>
      <span className="challenge-banner__text">{t('challenges.uploadBanner', { title })}</span>
      <span className="challenge-banner__action">
        {t('challenges.uploadBannerAction')}
        <Icon name="arrow_forward" size={16} />
      </span>
    </Link>
  );
}
