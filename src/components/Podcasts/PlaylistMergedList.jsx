import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MdPlayArrow, MdVideocam } from 'react-icons/md';
import BarLoader from '../Loader/BarLoader';
import { EpisodeTile } from './EpisodeTile';
import PlaylistEpisodeTile from './PlaylistEpisodeTile';
import { podcastPath, episodePath } from '../../lib/podcasts';
import { fmtDuration, useDateFormat } from '../../lib/podcastFormat';
import { audioItemPath } from '../AudioItem/AudioItemView';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import './PodcastsTab.scss';

/** A 3Speak video of the playlist as a tile among the episodes: opens the watch page. */
function PlaylistVideoTile({ video, to, state, at }) {
  const { t } = useTranslation();
  const fmtDate = useDateFormat();
  return (
    <li className="pod-tile">
      <div className="pod-tile-top">
        <Link to={to} state={state} className="pod-tile-cover" aria-label={video.title}>
          <img className="pod-art" src={fixVideoThumbnail(video)} alt="" loading="lazy" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
          <span className="pod-tile-play"><MdPlayArrow size={24} /></span>
        </Link>
        <div className="pod-tile-head">
          <Link to={to} state={state} className="pod-tile-title" title={video.title}>{video.title || t('audio.untitled')}</Link>
          <div className="pod-tile-meta">
            <span className="pod-badge"><MdVideocam size={12} /> {t('playlists.feeds.video')}</span>
            {at > 0 && <span>{fmtDate(new Date(at).toISOString())}</span>}
            {video.duration > 0 && <span className="pod-tile-dur">{fmtDuration(video.duration)}</span>}
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * A playlist with outside shows in it: its 3Speak items and the shows' episodes
 * in one list, newest first (lib/playlistFeeds.js mergeByDate). Outside episodes
 * name their show above the title; that marks them.
 *
 * Props:
 *   entries       from mergeByDate, already filtered
 *   contextItems  the tracks of `entries` in order, so play continues down the list
 *   trackItem     a 3Speak audio item → the track to play (the playlist cover applied)
 *   playlist, playlistId, allVideos   for the watch-page links (?playlist=&pos=)
 *   loading, hasMore, loadingMore, onLoadMore, pending (shows not read yet), emptyText
 *   onAddToPlaylist(video)   optional: the Playlist button on 3Speak audio tiles
 */
export default function PlaylistMergedList({
  entries, contextItems, trackItem, playlist, playlistId, allVideos,
  loading, hasMore, loadingMore, onLoadMore, pending = 0, emptyText, onAddToPlaylist,
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (loading) return <BarLoader />;
  return (
    <>
      {pending > 0 && <p className="pod-empty">{t('playlists.feeds.pending', { count: pending })}</p>}
      {entries.length === 0 ? (
        <p className="pod-empty">{emptyText}</p>
      ) : (
        <ul className="pod-tile-grid">
          {entries.map((e) => {
            if (e.kind === 'episode') {
              return (
                <EpisodeTile
                  key={e.ep.id}
                  ep={e.ep}
                  feed={e.feed}
                  contextItems={contextItems}
                  onOpenShow={(id) => navigate(podcastPath(id))}
                  onOpenEpisode={(id) => navigate(episodePath(id))}
                />
              );
            }
            const v = e.video;
            const key = `${v.author}-${v.permlink}`;
            if (v.isAudio && v.audioDoc) {
              return (
                <PlaylistEpisodeTile
                  key={key}
                  video={v}
                  item={trackItem(v)}
                  contextItems={contextItems}
                  onOpen={() => navigate(audioItemPath(v.audioDoc))}
                  onAddToPlaylist={onAddToPlaylist ? () => onAddToPlaylist(v) : undefined}
                />
              );
            }
            return (
              <PlaylistVideoTile
                key={key}
                video={v}
                at={e.at}
                to={`/@${v.author}/${v.permlink}?playlist=${playlistId}&pos=${v.position}`}
                state={{ playlist, videos: allVideos, currentIndex: v.position }}
              />
            );
          })}
        </ul>
      )}
      {hasMore && (
        <div className="pl-merged-more">
          <button type="button" className="pod-btn" onClick={onLoadMore} disabled={loadingMore}>
            {t('audio.podcasts.loadOlder')}
          </button>
        </div>
      )}
    </>
  );
}
