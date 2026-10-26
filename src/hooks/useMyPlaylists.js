import { useQuery } from '@tanstack/react-query';
import { getHiveUrl } from '../utils/hiveNode';
import axios from 'axios';
import { useAppStore } from '../lib/store';
import { PLAYLISTS_READ_URL, HIVE_API_URL } from '../utils/config';

/**
 * Fetch ALL playlists for the authenticated user (public + private)
 * Ordered by modification date descending
 * @param {object} options - Query options
 * @returns {object} React Query result with playlists data
 */
export function useMyPlaylists(options = {}) {
  const { user } = useAppStore();

  return useQuery({
    queryKey: ['myPlaylists', user],
    queryFn: async () => {
      if (!user) return [];

      const response = await axios.get(`${PLAYLISTS_READ_URL}/playlists`, {
        params: {
          owner: user,
          limit: options.limit || 100,
          offset: options.offset || 0,
        },
      });

      // API returns { count, playlists: [...] }
      const playlists = response.data?.playlists || [];

      // Sort by updated_at descending (most recently modified first)
      playlists.sort((a, b) => {
        const dateA = new Date(a.updated_at || a.created_at || 0);
        const dateB = new Date(b.updated_at || b.created_at || 0);
        return dateB - dateA;
      });

      // Prefer the playlist's own thumbnail (set via _update on the indexer when
      // the album has a cover image). Fall back to fetching the first video's
      // thumbnail from Hive otherwise.
      const playlistsWithThumbnails = await Promise.all(
        playlists.map(async (playlist) => {
          // Already has a top-level thumbnail (album cover) — use it as-is.
          if (playlist.thumbnail) return playlist;

          // Some playlists store it nested under metadata.album.thumbnail.
          const albumThumb = playlist.metadata?.album?.thumbnail;
          if (albumThumb) return { ...playlist, thumbnail: albumThumb };

          // Fall back to the first video in the playlist (legacy video playlists).
          if (playlist.items?.length > 0) {
            const firstItem = playlist.items[0];
            try {
              const res = await axios.post(getHiveUrl(), {
                jsonrpc: '2.0',
                method: 'condenser_api.get_content',
                params: [firstItem.author, firstItem.permlink],
                id: 1,
              });
              const jsonMetadata = res.data?.result?.json_metadata;
              if (jsonMetadata) {
                const metadata = typeof jsonMetadata === 'string' ? JSON.parse(jsonMetadata) : jsonMetadata;
                if (metadata.image?.[0]) {
                  return { ...playlist, thumbnail: metadata.image[0] };
                }
                if (metadata.video?.info?.ipfsThumbnail) {
                  return { ...playlist, thumbnail: `https://ipfs.3speak.tv/ipfs/${metadata.video.info.ipfsThumbnail}` };
                }
              }
            } catch (e) {
              // ignore, fall through to no thumbnail
            }
          }
          return playlist;
        })
      );

      return playlistsWithThumbnails;
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000, // 2 minutes
    ...options,
  });
}

/**
 * Check if a video is already in a playlist
 * @param {object} playlist - The playlist object
 * @param {string} author - Video author
 * @param {string} permlink - Video permlink
 * @returns {boolean} True if video is in playlist
 */
export function isVideoInPlaylist(playlist, author, permlink) {
  if (!playlist?.items || !Array.isArray(playlist.items)) return false;
  return playlist.items.some(
    (item) => item.author === author && item.permlink === permlink
  );
}

export default useMyPlaylists;
