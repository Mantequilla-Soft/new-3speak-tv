import { lazy, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import MountWhenOpened from '../common/LazyMount';
import { useVideoPlaylists } from '../../hooks/useVideoPlaylists';
import { seriesOf, seriesPosition } from '../../lib/series';
import './Series.scss';

const SeriesPartsSheet = lazy(() => import('./SeriesPartsSheet'));

/**
 * On a Short that is a part of its creator's series (lib/series.js): "Part 3 of
 * 7 · <series>", which opens the list of every part to jump to
 * (SeriesPartsSheet), and a "Next part" button while there is one. Read from
 * the public playlists that contain the Short; nothing while that loads or when
 * it is in no series (then `fallback`, the virtual series of its source).
 */
export default function ShortSeriesBar({ author, permlink, className = '', fallback = null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data: playlists, isLoading } = useVideoPlaylists(author, permlink);
  const series = seriesOf(playlists, author);
  const at = series ? seriesPosition(series, author, permlink) : null;
  // In no series of its own: the `fallback` (SourceSeriesBar) once the playlists are known.
  if (!series || !at) return isLoading ? null : fallback;
  const stop = (e) => e.stopPropagation();
  return (
    <div className={`short-series ${className}`.trim()} data-testid="short-series-bar" onClick={stop}>
      <button type="button" className="btn-reset short-series__info" aria-haspopup="dialog" onClick={(e) => { stop(e); setOpen(true); }}>
        <Icon name="video_library" size={16} />
        <span className="short-series__text">
          <b>{t('episodes.series.partOf', { part: at.part, total: at.total })}</b>
          <span aria-hidden="true"> · </span>
          <span>{series.name}</span>
        </span>
        <Icon name="expand_less" size={16} />
      </button>
      <MountWhenOpened when={open} name="series-parts">
        {open && <SeriesPartsSheet series={series} current={{ author, permlink }} onClose={() => setOpen(false)} />}
      </MountWhenOpened>
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
