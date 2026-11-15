import { useTranslation } from 'react-i18next';
import { episodeLabel } from '../../utils/episodeNumbers';
import './Episodes.scss';

/**
 * "S2 E5" on an audio card or episode page, from the row's (or the post's)
 * season and episode. Nothing when neither is set.
 */
export default function EpisodeBadge({ season, episode, className = '' }) {
  const { t } = useTranslation();
  const label = episodeLabel({ season, episode });
  if (!label) return null;
  return (
    <span className={`episode-badge num ${className}`.trim()} title={t('episodes.numbers.badgeTitle', { label })} data-testid="episode-badge">
      {label}
    </span>
  );
}
