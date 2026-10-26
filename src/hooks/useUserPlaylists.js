import { useQuery } from '@tanstack/react-query';
import { getHiveUrl } from '../utils/hiveNode';
import axios from 'axios';
import { HIVE_API_URL, PLAYLISTS_READ_URL } from '../utils/config';
import { fallbackImg, fixVideoThumbnail } from '../utils/fixThumbnails';

/**
 * Fetch thumbnail URL from Hive post metadata
 * @param {string} author - Post author
 * @param {string} permlink - Post permlink
 * @returns {Promise<string>} Thumbnail URL
 */
async function fetchVideoThumbnail(author, permlink) {
  try {
    const response = await axios.post(getHiveUrl(), {
      jsonrpc: '2.0',
      method: 'condenser_api.get_content',
      params: [author, permlink],
      id: 1,
    });

    const jsonMetadata = response.data?.result?.json_metadata;
    if (jsonMetadata) {
      const metadata = typeof jsonMetadata === 'string' ? JSON.parse(jsonMetadata) : jsonMetadata;
      // Try to get thumbnail from image array or video.info
      if (metadata.image?.[0]) {
        return metadata.image[0];
      }
      if (metadata.video?.info?.ipfsThumbnail) {
        return `https://ipfs.3speak.tv/ipfs/${metadata.video.info.ipfsThumbnail}`;
      }
    }
  } catch (error) {
    console.error('Error fetching video thumbnail:', error);
  }
  return null;
}

/**
 * Fetch public playlists for a specific user
 * @param {string} owner - The username to fetch playlists for
 * @param {object} options - Query options
 * @returns {object} React Query result with playlists data
 */
export function useUserPlaylists(owner, options = {}) {
  return useQuery({
    queryKey: ['userPlaylists', owner],
    queryFn: async () => {
      if (!owner) return [];

      const response = await axios.get(`${PLAYLISTS_READ_URL}/playlists`, {
        params: {
          owner,
          limit: options.limit || 50,
          offset: options.offset || 0,
        },
      });

      // API returns { count, playlists: [...] }
      const playlists = response.data?.playlists || [];
      // Viewing someone else's profile: only their PUBLIC playlists are shown.
      // This is the client-side per-user visibility filter (private + Watch Later
      // stay hidden); the API token gate is a separate, coarser server-side guard.
      const publicPlaylists = playlists.filter(playlist => playlist.access === 'public');

      // Prefer the playlist's own album cover (set via _update on the indexer).
      // Fall back to fetching the first video's thumbnail otherwise.
      const playlistsWithThumbnails = await Promise.all(
        publicPlaylists.map(async (playlist) => {
          if (playlist.thumbnail) return playlist;
          const albumThumb = playlist.metadata?.album?.thumbnail;
          if (albumThumb) return { ...playlist, thumbnail: albumThumb };
          if (playlist.items?.length > 0) {
            const firstItem = playlist.items[0];
            const thumbnail = await fetchVideoThumbnail(firstItem.author, firstItem.permlink);
            return { ...playlist, thumbnail };
          }
          return playlist;
        })
      );

      return playlistsWithThumbnails;
    },
    enabled: !!owner,
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...options,
  });
}

/**
 * Get thumbnail URL for a playlist
 * @param {object} playlist - The playlist object (may have thumbnail from hook)
 * @returns {string} Thumbnail URL
 */
export function getPlaylistThumbnail(playlist) {
  // Use pre-fetched thumbnail if available
  // Resized through the /img/ cache: a cover is the full-size upload, and the
  // first item's thumbnail can be a raw original too.
  if (playlist?.thumbnail) {
    return fixVideoThumbnail({ thumbnail: playlist.thumbnail });
  }

  // Fallback to default
  return fallbackImg;
}

export default useUserPlaylists;
