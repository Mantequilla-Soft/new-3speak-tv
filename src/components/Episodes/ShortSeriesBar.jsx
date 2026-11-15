import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { useVideoPlaylists } from '../../hooks/useVideoPlaylists';
import { seriesOf, seriesPosition } from '../../lib/series';
import './Series.scss';

/**
 * On a Short that is a part of its creator's series (lib/series.js): "Part 3 of
 * 7 · <series>" (opens the series page) and a "Next part" button while there is
 * one. Read from the public playlists that contain the Short; nothing while
 * that loads or when it is in no series.
 */
export default function ShortSeriesBar({ author, permlink, className = '' }) {
  const { t } = useTranslation();
  const { data: playlists } = useVideoPlaylists(author, permlink);
  const series = seriesOf(playlists, author);
  const at = series ? seriesPosition(series, author, permlink) : null;
  if (!series || !at) return null;
  const stop = (e) => e.stopPropagation();
  return (
    <div className={`short-series ${className}`.trim()} data-testid="short-series-bar" onClick={stop}>
      <Link to={`/playlist/${series.id}`} className="short-series__info" onClick={stop}>
        <Icon name="video_library" size={16} />
        <span className="short-series__text">
          <b>{t('episodes.series.partOf', { part: at.part, total: at.total })}</b>
          <span aria-hidden="true"> · </span>
          <span>{series.name}</span>
        </span>
      </Link>
      {at.next && (
        <Link
          to={`/shorts?v=${encodeURIComponent(at.next.author)}/${encodeURIComponent(at.next.permlink)}`}
          className="short-series__next"
          onClick={stop}
          data-testid="short-series-next"
        >
          {t('episodes.series.nextPart')}
          <Icon name="skip_next" size={16} fill />
        </Link>
      )}
    </div>
  );
}
