import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Icon } from '../v2/Icon';
import { getPostDetails } from '../../hive-api/hiveApi';
import { episodePath } from '../../utils/audiogramLink';
import './AudiogramEpisodeLink.scss';

const metaOf = (post) => {
  try {
    return typeof post?.json_metadata === 'string' ? JSON.parse(post.json_metadata || '{}') : (post?.json_metadata || {});
  } catch {
    return {};
  }
};

/**
 * On a Short made from an audiogram: the episode it is a piece of, as a card
 * (its cover, "Full episode", its title) that opens its audio page. The
 * episode comes from the Short's metadata (utils/audiogramLink.js); its title
 * and cover from its own post, read when the card shows.
 */
export default function AudiogramEpisodeLink({ author, permlink, className = '' }) {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ['audiogram-episode', author, permlink],
    queryFn: async () => {
      const post = await getPostDetails(author, permlink);
      if (!post) return null;
      const jm = metaOf(post);
      const cover = [jm.image?.[0], jm.audio?.thumbnail, jm.thumbnail].find((u) => typeof u === 'string' && /^https:\/\//.test(u)) || null;
      return { title: post.title || '', cover };
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!(author && permlink),
  });
  return (
    <Link
      to={episodePath({ author, permlink })}
      className={`audiogramEpisodeLink ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
      aria-label={t('shorts.audiogram.listen', { title: data?.title || '' })}
      data-testid="audiogram-episode-link"
    >
      <span className="audiogramEpisodeLink__cover" aria-hidden="true">
        {data?.cover ? <img src={data.cover} alt="" loading="lazy" /> : <Icon name="headphones" size={16} />}
      </span>
      <span className="audiogramEpisodeLink__text">
        <small>{t('shorts.audiogram.fullEpisode')}</small>
        <span aria-hidden="true"> · </span>
        <strong>{data?.title || `@${author}`}</strong>
      </span>
    </Link>
  );
}
