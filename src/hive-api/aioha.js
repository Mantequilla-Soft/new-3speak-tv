import { initAioha, Asset, KeyTypes, Providers } from '@aioha/aioha'

const aioha = initAioha({
  hiveauth: {
    name: '3Speak',
    description: '3Speak - Decentralized Video Platform'
  },
  hivesigner: {
    app: '3speak.tv',
    callbackURL: window.location.origin + '/hivesigner.html',
    scope: ['login', 'vote', 'comment', 'custom_json']
  }
})

// Store for HiveAuth waiting callbacks
let hiveAuthCallbacks = {
  onWaiting: null,
  onComplete: null
};

// Set HiveAuth waiting callbacks (called from React component)
export const setHiveAuthCallbacks = (onWaiting, onComplete) => {
  hiveAuthCallbacks.onWaiting = onWaiting;
  hiveAuthCallbacks.onComplete = onComplete;
};

// Check if current provider is HiveAuth
export const isHiveAuthProvider = () => {
  return aioha.getCurrentProvider() === Providers.HiveAuth;
};

// Wrapper to handle HiveAuth waiting state
const withHiveAuthWaiting = async (operation, message = 'Waiting for approval...') => {
  const isHiveAuth = isHiveAuthProvider();

  if (isHiveAuth && hiveAuthCallbacks.onWaiting) {
    hiveAuthCallbacks.onWaiting(message);
  }

  try {
    const result = await operation();
    return result;
  } finally {
    if (isHiveAuth && hiveAuthCallbacks.onComplete) {
      hiveAuthCallbacks.onComplete();
    }
  }
};

// Helper function to vote on content
export const voteWithAioha = async (author, permlink, weight = 10000) => {
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.vote(author, permlink, weight);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        throw new Error(result.error || 'Vote failed');
      }
    } catch (error) {
      console.error('Vote error:', error);
      throw error;
    }
  }, 'Approve vote on HiveAuth...');
};

// Helper function to transfer HIVE or HBD
export const transferWithAioha = async (to, amount, currency, memo = '') => {
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.transfer(to, amount, currency, memo);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        throw new Error(result.error || 'Transfer failed');
      }
    } catch (error) {
      console.error('Transfer error:', error);
      throw error;
    }
  }, 'Approve transfer on HiveAuth...');
};

// Helper function to follow/unfollow a user
export const followWithAioha = async (target, follow = true) => {
  return withHiveAuthWaiting(async () => {
    try {
      const result = follow
        ? await aioha.follow(target)
        : await aioha.unfollow(target);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        throw new Error(result.error || 'Follow/Unfollow failed');
      }
    } catch (error) {
      console.error('Follow error:', error);
      throw error;
    }
  }, follow ? 'Approve follow on HiveAuth...' : 'Approve unfollow on HiveAuth...');
};

// Helper function for custom_json operations
export const customJsonWithAioha = async (keyType, id, json, displayTitle = '') => {
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.customJSON(keyType, id, json, displayTitle);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        throw new Error(result.error || 'Custom JSON failed');
      }
    } catch (error) {
      console.error('Custom JSON error:', error);
      throw error;
    }
  }, 'Approve action on HiveAuth...');
};

// Helper function to post a comment
export const commentWithAioha = async (parentAuthor, parentPermlink, permlink, title, body, jsonMetadata = {}, options = null) => {
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.comment(parentAuthor, parentPermlink, permlink, title, body, JSON.stringify(jsonMetadata), options);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        throw new Error(result.error || 'Comment failed');
      }
    } catch (error) {
      console.error('Comment error:', error);
      throw error;
    }
  }, 'Approve comment on HiveAuth...');
};

// Generic broadcast for raw operations (e.g., account_create, custom operations)
export const broadcastWithAioha = async (operations, keyType = KeyTypes.Active) => {
  return withHiveAuthWaiting(async () => {
    try {
      const result = await aioha.signAndBroadcastTx(operations, keyType);
      if (result.success) {
        return { success: true, result: result.result };
      } else {
        throw new Error(result.error || 'Broadcast failed');
      }
    } catch (error) {
      console.error('Broadcast error:', error);
      throw error;
    }
  }, 'Approve transaction on HiveAuth...');
};

// Check if user is logged in
export const isLoggedIn = () => {
  return aioha.isLoggedIn();
};

// Get current user
export const getCurrentUser = () => {
  return aioha.getCurrentUser();
};

// Get current provider
export const getCurrentProvider = () => {
  return aioha.getCurrentProvider();
};

export { Asset, KeyTypes };
export default aioha;
