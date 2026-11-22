import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Icon } from '../v2/ui';
import { challengeText, useCurrentChallenge } from '../../lib/shortsChallenge';
import '../NewFromFollowing/NewFromFollowing.scss';
import './ChallengeBanner.scss';

/**
 * This week's Shorts challenge as a Home strip, beside "New from following" and
 * "Continue watching" (HomeGrouped .home-strips): the same cyan strip, a trophy
 * where they show avatars, the theme, and "See it" to /challenge. For everyone,
 * signed in or not; nothing in a week without a challenge (lib/shortsChallenge.js,
 * from the checker).
 */
export default function ChallengeStrip() {
  const { t } = useTranslation();
  const challenge = useCurrentChallenge();
  if (!challenge) return null;
  return (
    <section className="new-from-following challenge-strip" aria-label={t('challenges.menuEntry')}>
      <div className="nff-head">
        <span className="challenge-strip__icon" aria-hidden="true"><Icon name="emoji_events" size={20} /></span>
        <p className="nff-summary">
          <Trans
            i18nKey="challenges.homeStrip"
            values={{ title: challengeText(challenge, 'title') }}
            components={{ b: <b /> }}
          />
        </p>
        <Link to="/challenge" className="nff-toggle challenge-strip__action">{t('challenges.uploadBannerAction')}</Link>
      </div>
    </section>
  );
}
