import { useTranslation } from 'react-i18next';
import { Field } from '../v2/ui';
import { MAX_EPISODE, MAX_SEASON, cleanNumber } from '../../utils/episodeNumbers';
import './Episodes.scss';

/**
 * Season and episode numbers on a details step (video and audio uploads). Both
 * optional whole numbers, kept as typed (strings) by the caller and cleaned when
 * the post is built (utils/episodeNumbers.js episodeFields). A value that is
 * not a whole number in range is marked, never silently changed.
 */
export default function EpisodeNumberFields({ season, episode, onSeason, onEpisode, className = '' }) {
  const { t } = useTranslation();
  const bad = (v, max) => String(v ?? '').trim() !== '' && cleanNumber(v, max) == null;
  const only = (v) => v.replace(/[^0-9]/g, '').slice(0, 5);
  return (
    <div className={`episode-numbers ${className}`.trim()}>
      <Field
        label={t('episodes.numbers.season')}
        optional
        optionalLabel={t('episodes.numbers.optional')}
        inputMode="numeric"
        pattern="[0-9]*"
        value={season}
        onChange={(e) => onSeason(only(e.target.value))}
        error={bad(season, MAX_SEASON) ? t('episodes.numbers.invalid', { max: MAX_SEASON }) : null}
        data-testid="episode-season"
      />
      <Field
        label={t('episodes.numbers.episode')}
        optional
        optionalLabel={t('episodes.numbers.optional')}
        inputMode="numeric"
        pattern="[0-9]*"
        value={episode}
        onChange={(e) => onEpisode(only(e.target.value))}
        error={bad(episode, MAX_EPISODE) ? t('episodes.numbers.invalid', { max: MAX_EPISODE }) : null}
        data-testid="episode-episode"
      />
      <p className="episode-numbers__hint">{t('episodes.numbers.hint')}</p>
    </div>
  );
}
