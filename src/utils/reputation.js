/**
 * Reputation and content filtering utilities
 * Filters out spam accounts with negative reputation
 * 
 * Based on snapie.io implementation
 */

import { hiveClient } from './hiveNode';

export const LOW_REP_THRESHOLD = 15;

// Cache to avoid repeated API calls for the same user
const repCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get user reputation from the app's own Hive RPC pool (hiveNode.js — health-picked
 * node + dhive failover). `bridge.get_profile` returns the human-readable score
 * (e.g. 73.54), the same scale the old third-party endpoint returned; the raw
 * `reputation` field on condenser_api accounts is 0 since it left consensus, so
 * bridge is the lookup to use. Negative = spammer.
 * @param {string} username - Hive username
 * @returns {Promise<number>} - Reputation score
 */
export async function getUserReputation(username) {
  try {
    // Check cache first
    const cached = repCache.get(username);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.rep;
    }

    const profile = await hiveClient.call('bridge', 'get_profile', { account: username });

    // No profile / no reputation data (new account) — treat as neutral (25)
    const score = Number(profile?.reputation);
    const rep = Number.isFinite(score) && score !== 0 ? score : 25;

    // Cache the result
    repCache.set(username, {
      rep,
      timestamp: Date.now()
    });

    return rep;
  } catch (error) {
    // Not on Hive (a warm-up creator): neutral, cached, and not an error.
    if (/does not exist/i.test(String(error?.message || '') + JSON.stringify(error?.jse_info || error?.data || ''))) {
      repCache.set(username, { rep: 25, timestamp: Date.now() });
      return 25;
    }
    console.error('Error fetching reputation for', username, error);
    return 25; // Default to neutral on error (fail-open)
  }
}

/**
 * Check if a user should be filtered out based on reputation
 * Returns true if the account should be hidden (negative rep)
 * @param {string} username - Hive username
 * @returns {Promise<boolean>} - True if account is spammer (negative rep)
 */
export async function isLowReputation(username) {
  const rep = await getUserReputation(username);
  return rep < 0;
}

/**
 * Batch fetch reputations for multiple users in parallel
 * Returns a Map of username -> reputation
 * @param {string[]} usernames - Array of usernames to lookup
 * @returns {Promise<Map<string, number>>} - Map of username to reputation
 */
export async function batchGetReputations(usernames) {
  const uniqueUsernames = [...new Set(usernames)];
  const results = new Map();
  
  // Fetch all reputations in parallel
  const promises = uniqueUsernames.map(async (username) => {
    const rep = await getUserReputation(username);
    return { username, rep };
  });
  
  const resolved = await Promise.all(promises);
  resolved.forEach(({ username, rep }) => {
    results.set(username, rep);
  });
  
  return results;
}

/**
 * Collect all unique authors from content and nested children/replies
 * @param {Array} content - Array of comments/posts with author and optional children
 * @returns {string[]} - Array of all author usernames
 */
function collectAllAuthors(content) {
  const authors = [];
  
  function collect(items) {
    for (const item of items) {
      // Handle both {author: 'name'} and {author: {username: 'name'}} formats
      const authorName = typeof item.author === 'string' 
        ? item.author 
        : item.author?.username;
      
      if (authorName) {
        authors.push(authorName);
      }
      
      // Check for children (3Speak format) or replies (other formats)
      const nested = item.children || item.replies;
      if (nested && nested.length > 0) {
        collect(nested);
      }
    }
  }
  
  collect(content);
  return authors;
}

/**
 * Seed the cache from `author_reputation`, the raw bigint Hive already ships on
 * every comment from condenser_api.get_content_replies. Comment threads therefore
 * cost ZERO extra RPCs — without this a 24-reply thread would fire 24
 * bridge.get_profile calls at the shared node. Items without the field fall
 * through to the normal lookup.
 * @param {Array} content - Array of comments/posts (possibly nested)
 */
function seedFromAuthorReputation(content) {
  const now = Date.now();

  function seed(items) {
    for (const item of items) {
      const authorName = typeof item.author === 'string'
        ? item.author
        : item.author?.username;

      if (authorName && item.author_reputation != null && !repCache.has(authorName)) {
        const score = hiveRepToScore(item.author_reputation);
        if (score != null) repCache.set(authorName, { rep: score, timestamp: now });
      }

      const nested = item.children || item.replies;
      if (nested && nested.length > 0) {
        seed(nested);
      }
    }
  }

  seed(content);
}

/**
 * Filter content by reputation
 * Removes items from authors with negative reputation (spammers/bots)
 * Also filters nested children/replies recursively
 * 
 * OPTIMIZED: Pre-fetches all reputations in parallel before filtering
 * 
 * @template T
 * @param {T[]} content - Array of comments/posts to filter
 * @returns {Promise<T[]>} - Filtered array without spam accounts
 */
export async function filterByReputation(content) {
  if (!content || content.length === 0) return [];

  // Pre-fetch all reputations in parallel (huge performance win!)
  seedFromAuthorReputation(content);
  const allAuthors = collectAllAuthors(content);
  const reputations = await batchGetReputations(allAuthors);
  
  // Now filter synchronously using pre-fetched data
  function filterItems(items) {
    const filtered = [];
    
    for (const item of items) {
      // Handle both {author: 'name'} and {author: {username: 'name'}} formats
      const authorName = typeof item.author === 'string' 
        ? item.author 
        : item.author?.username;
      
      const reputation = reputations.get(authorName) ?? 25;
      const isSpammer = reputation < 0;
      
      if (!isSpammer) {
        // Create a copy to avoid mutating original
        const filteredItem = { ...item };
        
        // Filter nested children/replies using the same pre-fetched data
        const nested = item.children || item.replies;
        if (nested && nested.length > 0) {
          if (item.children) {
            filteredItem.children = filterItems(nested);
          } else if (item.replies) {
            filteredItem.replies = filterItems(nested);
          }
        }
        
        filtered.push(filteredItem);
      }
    }
    
    return filtered;
  }
  
  return filterItems(content);
}

/**
 * Mark content by reputation without removing anything.
 * Adds `isLowReputation: true` to items from authors with rep < LOW_REP_THRESHOLD.
 * Recursively marks nested children/replies.
 *
 * @template T
 * @param {T[]} content - Array of comments/posts to mark
 * @returns {Promise<T[]>} - Same array with isLowReputation flag added
 */
export async function markByReputation(content) {
  if (!content || content.length === 0) return [];

  seedFromAuthorReputation(content);
  const allAuthors = collectAllAuthors(content);
  const reputations = await batchGetReputations(allAuthors);

  function markItems(items) {
    return items.map(item => {
      const authorName = typeof item.author === 'string'
        ? item.author
        : item.author?.username;

      const reputation = reputations.get(authorName) ?? 25;
      const marked = { ...item, isLowReputation: reputation < LOW_REP_THRESHOLD };

      const nested = item.children || item.replies;
      if (nested && nested.length > 0) {
        if (item.children) {
          marked.children = markItems(nested);
        } else if (item.replies) {
          marked.replies = markItems(nested);
        }
      }

      return marked;
    });
  }

  return markItems(content);
}

/**
 * Convert raw Hive author_reputation (bigint) to human-readable score (e.g. 72)
 * @param {number|string} raw - Raw reputation from Hive API
 * @returns {number|null}
 */
export function hiveRepToScore(raw) {
  if (raw == null) return null;
  const n = parseInt(raw);
  if (isNaN(n) || n === 0) return 25;
  const neg = n < 0;
  const out = Math.log10(Math.abs(n));
  return Math.floor(Math.max(out - 9, 0) * (neg ? -1 : 1) * 9 + 25);
}

/**
 * Clear the reputation cache (useful for testing)
 */
export function clearReputationCache() {
  repCache.clear();
}
