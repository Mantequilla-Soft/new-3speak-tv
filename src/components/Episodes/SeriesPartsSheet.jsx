import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import DialogShell from '../modal/DialogShell';
import { Icon } from '../v2/Icon';
import { seriesParts } from '../../lib/series';
import { fetchVideosForPlaylist } from '../../utils/playlistVideos';
import './Series.scss';

const shortHref = (p) => `/shorts?v=${encodeURIComponent(p.author)}/${encodeURIComponent(p.permlink)}`;

/**
 * Every part of a Shorts series, opened from the series line on a Short
 * (ShortSeriesBar): numbered, with thumbnail and title, the one playing marked.
 * Tapping a part plays it in the Shorts player; "Play from part 1" starts the
 * series over; the series page is one link away. Titles and thumbnails come
 * from Hive once the sheet opens; until then (or if that fails) the parts list
 * as "Part 2", "Part 3".
 */
export default function SeriesPartsSheet({ series, current, onClose }) {
  const { t } = useTranslation();
  const parts = useMemo(() => seriesParts(series), [series]);
  const { data: details = [] } = useQuery({
    queryKey: ['seriesParts', series.id, parts.map((p) => `${p.author}/${p.permlink}`).join(',')],
    queryFn: () => fetchVideosForPlaylist(parts),
    staleTime: 5 * 60 * 1000,
  });
  const byKey = useMemo(() => new Map(details.map((d) => [`${d.author}/${d.permlink}`, d])), [details]);
  const playing = parts.findIndex((p) => p.author === current.author && p.permlink === current.permlink);

  return (
    <DialogShell
      open
      onClose={onClose}
      title={series.name}
      sub={playing >= 0 ? t('episodes.series.partOf', { part: playing + 1, total: parts.length }) : null}
      width={460}
      isolate
      className="series-parts"
    >
      {playing > 0 && (
        <Link to={shortHref(parts[0])} className="series-parts__start" onClick={onClose} data-testid="series-parts-start">
          <Icon name="replay" size={18} />
          {t('episodes.series.fromStart')}
        </Link>
      )}
      <ol className="series-parts__list" aria-label={t('episodes.series.allParts')}>
        {parts.map((p, i) => {
          const d = byKey.get(`${p.author}/${p.permlink}`);
          const isPlaying = i === playing;
          return (
            <li key={`${p.author}/${p.permlink}`}>
              <Link
                to={shortHref(p)}
                className={`series-parts__item${isPlaying ? ' is-playing' : ''}`}
                aria-current={isPlaying ? 'true' : undefined}
                onClick={onClose}
              >
                <span className="series-parts__num num">{i + 1}</span>
                <span className="series-parts__thumb">
                  {d?.images?.thumbnail ? <img src={d.images.thumbnail} alt="" loading="lazy" /> : <Icon name="smart_display" size={18} />}
                </span>
                <span className="series-parts__title">{d?.title || t('episodes.series.partN', { part: i + 1 })}</span>
                {/* aria-current tells a screen reader; the bars show it */}
                {isPlaying && <Icon name="equalizer" size={18} className="series-parts__now" />}
              </Link>
            </li>
          );
        })}
      </ol>
      <Link to={`/playlist/${series.id}`} className="series-parts__page" onClick={onClose}>
        {t('episodes.series.openPage')}
        <Icon name="arrow_forward" size={16} />
      </Link>
    </DialogShell>
  );
}
