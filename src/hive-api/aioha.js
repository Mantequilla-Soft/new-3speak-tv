import { initAioha, Asset, KeyTypes } from '@aioha/aioha'

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

// Helper function to vote on content
export const voteWithAioha = async (author, permlink, weight = 10000) => {
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
};

// Helper function to transfer HIVE or HBD
export const transferWithAioha = async (to, amount, currency, memo = '') => {
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
};

// Helper function to follow/unfollow a user
export const followWithAioha = async (target, follow = true) => {
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
};

// Helper function for custom_json operations
export const customJsonWithAioha = async (keyType, id, json, displayTitle = '') => {
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
};

// Helper function to post a comment
export const commentWithAioha = async (parentAuthor, parentPermlink, permlink, title, body, jsonMetadata = {}, options = null) => {
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
};

// Generic broadcast for raw operations (e.g., account_create, custom operations)
export const broadcastWithAioha = async (operations, keyType = KeyTypes.Active) => {
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
