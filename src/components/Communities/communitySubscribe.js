// Subscribing to a community, shared by the community page and the directory's
// Join buttons so both write the same thing the same way.
//
// A Hive account signs the on-chain `community` custom_json with its posting
// key. An incubating user has no Hive account yet, so their subscription is
// kept off-chain by the incubation service until they graduate.
import { customJsonWithAioha, isLoggedIn, KeyTypes } from '../../hive-api/aioha';

// Who can subscribe at all: logged in, and either holding a wallet (Hive
// account) or incubating. isLoggedIn() alone is the wallet check, which told
// the one group who cannot subscribe on chain to log in while they already were.
export function canSubscribe({ authenticated, incubationHandle }) {
  return !!authenticated && (!!incubationHandle || isLoggedIn());
}

/**
 * Write a subscribe (next = true) or unsubscribe (next = false).
 * `prompt` is the line the wallet shows while asking to sign.
 * Resolves with `{ onChain }`: false for an incubation (off-chain) write, whose
 * effect Hive's subscriber count does not include yet.
 */
export async function setCommunitySubscription({ id, next, incubationHandle, prompt }) {
  if (incubationHandle) {
    const { subscribeIncubation } = await import('../../lib/incubation');
    await subscribeIncubation(id, next);
    return { onChain: false };
  }
  const json = JSON.stringify([next ? 'subscribe' : 'unsubscribe', { community: id }]);
  await customJsonWithAioha(KeyTypes.Posting, 'community', json, prompt);
  return { onChain: true };
}
