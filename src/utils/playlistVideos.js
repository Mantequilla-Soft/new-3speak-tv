import axios from 'axios';
import { getHiveUrl } from './hiveNode';
import { CHECKER_URL } from './config';

/**
 * Fetch video data from Hive for a list of playlist items
 */
export async function fetchVideosForPlaylist(items) {
  if (!items?.length) return [];

  // Sort items by position
  const sortedItems = [...items].sort((a, b) => a.position - b.position);

  // Fetch all video data in parallel
  const videoPromises = sortedItems.map(async (item) => {
    try {
      const response = await axios.post(getHiveUrl(), {
        jsonrpc: '2.0',
        method: 'condenser_api.get_content',
        params: [item.author, item.permlink],
        id: 1,
      });

      const post = response.data?.result;
      if (!post || !post.author) return null;

      // Parse json_metadata for video info
      let metadata = {};
      try {
        metadata = typeof post.json_metadata === 'string'
          ? JSON.parse(post.json_metadata)
          : post.json_metadata || {};
      } catch (e) {
        console.error('Error parsing metadata:', e);
      }

      // Extract thumbnail
      let thumbnail = null;
      if (metadata.image?.[0]) {
        thumbnail = metadata.image[0];
      }

      // Extract duration from video metadata
      const duration = metadata.video?.info?.duration || 0;

      // Detect audio: the body contains an audio.3speak.tv/play?a=<permlink> link
      // (the marker the checker's audioHiveSync also uses)
      const audioMatch = typeof post.body === 'string'
        ? post.body.match(/audio\.3speak\.tv\/play\?a=([^\s)]+)/)
        : null;
      const audioPermlink = audioMatch?.[1] || null;

      // For audio items, eagerly resolve the embed-audio doc so we can render
      // the same AudioTile used elsewhere and trigger playback via the global player.
      let audioDoc = null;
      if (audioPermlink) {
        try {
          const { data: ad } = await axios.get(
            `${CHECKER_URL}/audio?owner=${encodeURIComponent(post.author)}&permlink=${encodeURIComponent(audioPermlink)}&limit=1`
          );
          audioDoc = ad?.audio?.[0] || null;
        } catch { /* no audio doc: the item still lists as a plain post */ }
      }

      return {
        author: post.author,
        permlink: post.permlink,
        title: post.title,
        created_at: post.created,
        images: { thumbnail },
        duration,
        position: item.position,
        added_at: item.added_at,
        parentAuthor: post.parent_author || '',
        parentPermlink: post.parent_permlink || '',
        isAudio: !!audioDoc,
        audioPermlink,
        audioDoc,
      };
    } catch (error) {
      console.error(`Error fetching video ${item.author}/${item.permlink}:`, error);
      return null;
    }
  });

  const videos = await Promise.all(videoPromises);
  return videos.filter(Boolean);
}
