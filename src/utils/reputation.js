/**
 * Reputation and content filtering utilities
 * Filters out spam accounts with negative reputation
 * 
 * Based on snapie.io implementation
 */

const REPUTATION_API = 'https://api.syncad.com/reputation-api/accounts';

// Cache to avoid repeated API calls for the same user
const repCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Get user reputation from Syncad API
 * Returns the raw reputation score (can be negative)
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

    const response = await fetch(`${REPUTATION_API}/${username}/reputation`);
    
    if (!response.ok) {
      return 25; // Default to neutral reputation on error
    }

    const reputation = await response.json();
    
    // Cache the result
    repCache.set(username, {
      rep: reputation,
      timestamp: Date.now()
    });

    return reputation;
  } catch (error) {
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
async function batchGetReputations(usernames) {
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
 * Clear the reputation cache (useful for testing)
 */
export function clearReputationCache() {
  repCache.clear();
}
