/**
 * On a Short cut from a longer post (an audiogram of an episode, a clip of a
 * video or stream), when its creator cut more than one from it: "Part 2 of 4 ·
 * from <the source>" and "Next part", in the order of the source. A virtual
 * series, from the checker's "made from" index (lib/derived.js); the creator
 * builds no playlist for it. A real series (ShortSeriesBar) wins over it.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { getPostDetails } from '../../hive-api/hiveApi';
import { fetchDerived, sourceSeriesPosition } from '../../lib/derived';
import './Series.scss';

/** The kinds whose Shorts form a series of their source. */
const SERIES_KINDS = new Set(['audiogram', 'clip', 'stream_clip']);

export default function SourceSeriesBar({ author, permlink, source, className = '' }) {
  const { t } = useTranslation();
  const ok = !!(author && permlink && source?.author && source?.permlink && SERIES_KINDS.has(source.kind));
  const { data: parts } = useQuery({
    queryKey: ['source-series', source?.author, source?.permlink, author],
    queryFn: async () => (await fetchDerived(source.author, source.permlink, { by: author, media: 'short', order: 'start', limit: 60 })).items,
    staleTime: 5 * 60 * 1000,
    enabled: ok,
  });
  const at = ok ? sourceSeriesPosition(parts, author, permlink) : null;
  const { data: title } = useQuery({
    queryKey: ['derived-source-title', source?.author, source?.permlink],
    queryFn: async () => (await getPostDetails(source.author, source.permlink).catch(() => null))?.title || '',
    staleTime: 10 * 60 * 1000,
    enabled: !!at,
  });
  if (!at) return null;
  const stop = (e) => e.stopPropagation();
  return (
    <div className={`short-series ${className}`.trim()} data-testid="source-series-bar" onClick={stop}>
      <span className="short-series__info">
        <Icon name="video_library" size={16} />
        <span className="short-series__text">
          <b>{t('episodes.series.partOf', { part: at.part, total: at.total })}</b>
          <span aria-hidden="true"> · </span>
          <span>{t('derived.series.from', { title: title || `@${source.author}` })}</span>
        </span>
      </span>
      {at.next && (
        <Link
          to={`/shorts?v=${encodeURIComponent(at.next.author)}/${encodeURIComponent(at.next.permlink)}`}
          className="short-series__next"
          onClick={stop}
          data-testid="source-series-next"
        >
          {t('episodes.series.nextPart')}
          <Icon name="skip_next" size={16} fill />
        </Link>
      )}
    </div>
  );
}
