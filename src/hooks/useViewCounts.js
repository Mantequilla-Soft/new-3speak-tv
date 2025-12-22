import { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import { API_URL_FROM_WEST } from '../utils/config';

const BATCH_SIZE = 50;

/**
 * Hook for fetching video view counts in batches
 * @param {Array} videos - Array of video objects with author.username and permlink
 * @returns {Object} - { viewCounts, loading, getViewCount }
 */
const useViewCounts = (videos) => {
  const [viewCounts, setViewCounts] = useState({});
  const [loading, setLoading] = useState(false);
  const fetchedRef = useRef(new Set());

  useEffect(() => {
    if (!videos?.length) return;

    // Extract author from various possible structures
    const getAuthor = (v) => {
      return v.author?.username || v.author || v.owner || null;
    };

    // Filter videos that haven't been fetched yet and have valid data
    const toFetch = videos.filter((v) => {
      const author = getAuthor(v);
      const permlink = v.permlink;
      if (!author || !permlink) return false;
      const key = `${author}/${permlink}`;
      return !fetchedRef.current.has(key);
    });

    if (toFetch.length === 0) return;

    // Split into batches of BATCH_SIZE
    const batches = [];
    for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
      batches.push(toFetch.slice(i, i + BATCH_SIZE));
    }

    const fetchViews = async () => {
      setLoading(true);
      
      for (const batch of batches) {
        try {
          const videosPayload = batch.map((v) => ({
            author: getAuthor(v),
            permlink: v.permlink,
          }));

          const response = await axios.post(
            `${API_URL_FROM_WEST}/views`,
            { videos: videosPayload },
            { timeout: 15000 }
          );

          if (response.data.success) {
            setViewCounts((prev) => ({ ...prev, ...response.data.data }));
            // Mark as fetched
            batch.forEach((v) => {
              const author = getAuthor(v);
              fetchedRef.current.add(`${author}/${v.permlink}`);
            });
          }
        } catch (err) {
          console.error('Failed to fetch view counts:', err.response?.data || err.message);
        }
      }
      
      setLoading(false);
    };

    fetchViews();
  }, [videos]);

  const getViewCount = useCallback(
    (author, permlink) => {
      return viewCounts[`${author}/${permlink}`] ?? null;
    },
    [viewCounts]
  );

  return { viewCounts, loading, getViewCount };
};

export default useViewCounts;
