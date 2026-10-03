import { Link } from 'react-router-dom';
import PropTypes from 'prop-types';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { MdPlaylistPlay } from 'react-icons/md';
import { getHiveUrl } from '../../utils/hiveNode';
import AuthorBadge from '../AuthorBadge/AuthorBadge';
import fallback from '../../assets/image/speak.jpg';
import './PlaylistFeedCard.scss';
import { useTranslation } from 'react-i18next';

dayjs.extend(relativeTime);

// Resolve the first item's thumbnail from its Hive post metadata — same approach
// as useUserPlaylists, but only when the checker didn't already return a cover.
async function fetchFirstItemThumb(author, permlink) {
  try {
    const { data } = await axios.post(getHiveUrl(), {
      jsonrpc: '2.0',
      method: 'condenser_api.get_content',
      params: [author, permlink],
      id: 1,
    });
    const raw = data?.result?.json_metadata;
    if (!raw) return null;
    const meta = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (meta.image?.[0]) return meta.image[0];
    if (meta.video?.info?.ipfsThumbnail) return `https://ipfs-3speak.b-cdn.net/ipfs/${meta.video.info.ipfsThumbnail}`;
  } catch { /* ignore — fall back to avatar */ }
  return null;
}

/**
 * A single recently-changed public playlist, rendered as a feed card next to the
 * community snaps. Cover priority: checker-provided thumbnail → first item's Hive
 * thumbnail (lazy, cached) → the owner's Hive avatar → bundled fallback.
 */
function PlaylistFeedCard({ playlist }) {
  const { t } = useTranslation();
  const { id, name, owner, itemCount, thumbnail, firstItem, updated_at: updatedAt } = playlist;

  const { data: resolvedThumb } = useQuery({
    queryKey: ['playlist-item-thumb', firstItem?.author, firstItem?.permlink],
    queryFn: () => fetchFirstItemThumb(firstItem.author, firstItem.permlink),
    enabled: !thumbnail && !!firstItem?.author && !!firstItem?.permlink,
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
    retry: 1,
  });

  const cover = thumbnail || resolvedThumb || (owner ? `https://images.hive.blog/u/${owner}/avatar` : fallback);
  const changed = updatedAt ? dayjs(updatedAt).fromNow() : null;

  return (
    <article className="playlist-feed-card">
      <Link to={`/playlist/${id}`} className="pfc-cover" aria-label={t('cards.playlist.openAria', { name })}>
        <img
          src={cover}
          alt={name}
          loading="lazy"
          onError={(e) => { e.currentTarget.src = fallback; }}
        />
        <span className="pfc-count">
          <MdPlaylistPlay />
          {itemCount}
        </span>
        <span className="pfc-tag">{t('cards.playlist.tag')}</span>
      </Link>

      <div className="pfc-body">
        <Link to={`/playlist/${id}`} className="pfc-title" title={name}>{name}</Link>
        <div className="pfc-owner">
          <AuthorBadge author={owner} showFollow compact tabHint="playlists" />
        </div>
        {changed && <p className="pfc-changed">{t('cards.playlist.updated', { when: changed })}</p>}
      </div>
    </article>
  );
}

PlaylistFeedCard.propTypes = {
  playlist: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    owner: PropTypes.string,
    itemCount: PropTypes.number,
    thumbnail: PropTypes.string,
    firstItem: PropTypes.shape({ author: PropTypes.string, permlink: PropTypes.string }),
    updated_at: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  }).isRequired,
};

export default PlaylistFeedCard;
