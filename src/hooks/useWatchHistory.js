import { useState, useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../lib/store';
import { batchCheckWatched } from '../utils/watchHistory';
import { WATCH_HISTORY_THRESHOLD_DAYS } from '../utils/config';

/**
 * Hook to batch check watch history for a list of videos
 * @param {Array} videos - Array of video objects with author/permlink
 * @returns {{ watchedData: Map, isWatched: Function, loading: boolean }}
 */
export function useWatchHistory(videos) {
  const { user } = useAppStore();
  // Watch history is 3Speak's own store, keyed by a name -- not a chain record.
  // A handle is a perfectly good key, and gating on `user` alone meant an
  // incubating viewer's history was never read, so "hide watched" quietly did
  // nothing for them and Discover kept showing videos they had just seen.
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const historyUser = user || incubationHandle;
  const watchedDataRef = useRef(new Map());
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(new Set());

  useEffect(() => {
    if (!historyUser || !videos || videos.length === 0) {
      return;
    }

    // Calculate threshold date based on config
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - WATCH_HISTORY_THRESHOLD_DAYS);

    // Filter videos we haven't checked yet AND are within threshold
    const newVideos = videos.filter(video => {
      const author = video.author?.username || video.author || video.owner;
      const permlink = video.permlink;
      if (!author || !permlink) return false;

      // Only query for videos within threshold
      const videoDate = new Date(video.created_at || video.created);
      if (videoDate < thresholdDate) return false;

      const key = `${author}/${permlink}`;
      return !fetchedRef.current.has(key);
    });

    if (newVideos.length === 0) {
      return;
    }

    const fetchWatchHistory = async () => {
      setLoading(true);

      // Prepare posts for batch request (max 50 at a time)
      const postsToFetch = newVideos.slice(0, 50).map(video => ({
        author: video.author?.username || video.author || video.owner,
        permlink: video.permlink,
      }));

      // Mark as fetched to avoid re-fetching
      postsToFetch.forEach(post => {
        fetchedRef.current.add(`${post.author}/${post.permlink}`);
      });

      try {
        const results = await batchCheckWatched(historyUser, postsToFetch);

        // Merge new results with existing data in ref
        results.forEach((value, key) => {
          watchedDataRef.current.set(key, value);
        });
        
        // Trigger re-render without changing Map reference
        setVersion(v => v + 1);
      } catch (error) {
        console.error('Error fetching watch history:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchWatchHistory();
  }, [videos, historyUser]);

  // Helper function to check if a video was watched
  const isWatched = useCallback((author, permlink) => {
    if (!historyUser) return null; // null = unknown (nobody is signed in)
    const key = `${author}/${permlink}`;
    return watchedDataRef.current.has(key);
  }, [historyUser]);

  // Helper function to get watch data for a video
  const getWatchData = useCallback((author, permlink) => {
    const key = `${author}/${permlink}`;
    return watchedDataRef.current.get(key) || null;
  }, []);

  return {
    watchedData: watchedDataRef.current,
    isWatched,
    getWatchData,
    loading,
    // Bumps whenever new watch-history results land. `isWatched` is a stable
    // useCallback reading a ref, so a memo that only depends on it never recomputes
    // when data arrives — depend on `version` too to react to fresh results.
    version,
  };
}
