import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { Icon } from '../v2/ui';
import {
  challengeText, hideChallengeWeek, readHiddenChallengeWeek, useCurrentChallenge,
} from '../../lib/shortsChallenge';
import '../NewFromFollowing/NewFromFollowing.scss';
import './ChallengeBanner.scss';

/**
 * This week's Shorts challenge as a Home strip, beside "New from following" and
 * "Continue watching" (HomeGrouped .home-strips): the follow strip's shape in
 * brand red, a trophy where they show avatars, the theme, "See it" to
 * /challenge and "Hide". For everyone, signed in or not; nothing in a week
 * without a challenge (lib/shortsChallenge.js, from the checker).
 *
 * "Hide" keeps it away for the rest of that week only (owner 2026-11-25: the
 * next week's challenge shows again).
 */
export default function ChallengeStrip() {
  const { t } = useTranslation();
  const challenge = useCurrentChallenge();
  const [hiddenWeek, setHiddenWeek] = useState(readHiddenChallengeWeek);
  if (!challenge || hiddenWeek === challenge.week) return null;

  const hide = () => {
    hideChallengeWeek(challenge.week);
    setHiddenWeek(challenge.week);
  };

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
        <button
          type="button"
          className="nff-seen"
          onClick={hide}
          title={t('challenges.hideTitle')}
          aria-label={t('challenges.hideTitle')}
        >
          <Icon name="visibility_off" size={18} />
          <span className="nff-seen-label">{t('challenges.hide')}</span>
        </button>
        <Link to="/challenge" className="nff-toggle challenge-strip__action">{t('challenges.uploadBannerAction')}</Link>
      </div>
    </section>
  );
}
