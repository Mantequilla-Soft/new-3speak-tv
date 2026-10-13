// "Add to my blog": reblog the creator's own post right after publishing.
//
// Hive leaves an author's own COMMUNITY posts out of their blog and out of
// their followers' feeds unless they reblog them, and 3Speak publishes every
// video and audio post into a community. Ecency offers the same switch
// ("Reblog: auto share with your followers") for community posts.
//
// It is a plain `follow` custom_json, which the @threespeak broadcast proxy
// already allows (server/index.cjs ALLOWED_CUSTOM_JSON_IDS), so it can ride in
// the same transaction as the post. On by default; the last choice is kept per
// browser.

const STORAGE_KEY = '3speak_add_to_blog';

export function readAddToBlog() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeAddToBlog(on) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // storage blocked: the choice just isn't remembered
  }
}

/** The reblog op for `account` sharing author/permlink on their own blog. */
export function reblogOp(account, author, permlink) {
  return ['custom_json', {
    required_auths: [],
    required_posting_auths: [account],
    id: 'follow',
    json: JSON.stringify(['reblog', { account, author, permlink }]),
  }];
}
