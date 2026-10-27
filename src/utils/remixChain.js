// Remix chains: a remix of a remix credits and pays every earlier creator.
//
// A remix post saves its chain in `json_metadata.video.remixChain`: the videos
// it was made from, nearest first ({ author, permlink } with the Hive post's
// permlink, plus `short` = the short's own id when it is a short, for links).
// Remixes from before that only name their direct source
// (`video.originalAuthor` / `originalPermlink`), so those are walked post by post.

import { getPostDetails } from '../hive-api/hiveApi';
import { getLockedBeneficiaries, HIVE_MAX_BENEFICIARIES } from './beneficiaries';

// Earlier videos a remix may build on. A video with this many already in its
// chain cannot be remixed.
export const REMIX_CHAIN_MAX = 6;

const HIVE_NAME = /^[a-z][a-z0-9.-]{2,15}$/;
const PERMLINK = /^[a-z0-9-]{1,256}$/;

function chainEntry(author, permlink, short) {
  const a = String(author || '').toLowerCase();
  const p = String(permlink || '').toLowerCase();
  if (!HIVE_NAME.test(a) || !PERMLINK.test(p)) return null;
  const s = short && short !== p && PERMLINK.test(String(short)) ? String(short) : null;
  return { author: a, permlink: p, ...(s ? { short: s } : {}) };
}

const sameVideo = (x, y) => x.author === y.author && x.permlink === y.permlink;

async function videoMeta(author, permlink) {
  try {
    const post = await getPostDetails(author, permlink);
    const meta = typeof post?.json_metadata === 'string' ? JSON.parse(post.json_metadata) : post?.json_metadata;
    return meta?.video || null;
  } catch {
    return null; // deleted post, or a short with no Hive post: the walk ends here
  }
}

/**
 * The chain a remix of this video gets: the video itself first, then the video
 * it was made from, and so on. Holds at most REMIX_CHAIN_MAX + 1 entries, so a
 * caller can tell a full chain (see remixBlockReason). `short` = the short's id
 * when the video is a short (its link differs from the Hive post's).
 */
export async function resolveRemixChain(author, permlink, short = null) {
  const first = chainEntry(author, permlink, short);
  if (!first) return [];
  const chain = [first];
  const add = (entry) => {
    if (!entry || chain.some(c => sameVideo(c, entry))) return false;
    chain.push(entry);
    return true;
  };
  let current = first;
  while (chain.length <= REMIX_CHAIN_MAX) {
    const video = await videoMeta(current.author, current.permlink);
    if (!video) break;
    if (Array.isArray(video.remixChain)) {
      for (const c of video.remixChain) {
        if (chain.length > REMIX_CHAIN_MAX) break;
        add(chainEntry(c?.author, c?.permlink, c?.short));
      }
      break;
    }
    const source = chainEntry(video.originalAuthor, video.originalPermlink);
    if (!add(source)) break;
    current = source;
  }
  return chain.slice(0, REMIX_CHAIN_MAX + 1);
}

/** The chain's authors who get a split: each once, never the remixer. */
export function remixChainAuthors(chain, user) {
  const me = String(user || '').toLowerCase();
  return [...new Set((chain || []).map(c => c.author))].filter(a => a !== me);
}

/**
 * Why `user` cannot remix a video with this chain, or null when they can:
 * 'full' = it already builds on REMIX_CHAIN_MAX earlier videos; 'slots' = the
 * locked splits (3Speak fund, encoder, a split per chain author) would leave no
 * beneficiary slot free on Hive for a sound or the creator's own picks.
 */
export function remixBlockReason(chain, { user, isPremium }) {
  if (chain.length > REMIX_CHAIN_MAX) return 'full';
  const locked = getLockedBeneficiaries({
    isPremium,
    username: user,
    includeEncoder: true,
    remixAuthors: remixChainAuthors(chain, user),
  });
  return locked.length >= HIVE_MAX_BENEFICIARIES ? 'slots' : null;
}

/**
 * For the remix / clip buttons: the chain a remix of this video gets, and the
 * reason `user` cannot make one (null = go ahead). `t` turns that reason into
 * the message to show.
 */
export async function checkRemix({ author, permlink, short = null }, { user, isPremium }) {
  const chain = await resolveRemixChain(author, permlink, short);
  return { chain, blocked: chain.length ? remixBlockReason(chain, { user, isPremium }) : null };
}

export function remixBlockedMessage(reason, t) {
  return reason === 'full'
    ? t('shorts.remix.chainFull', { max: REMIX_CHAIN_MAX })
    : t('shorts.remix.chainNoSlots');
}

/** A chain video's page, as the remix footer links it. */
export function remixVideoLink(entry, origin = window.location.origin) {
  return entry.short
    ? `${origin}/shorts?v=${entry.author}/${entry.short}`
    : `${origin}/@${entry.author}/${entry.permlink}`;
}

/**
 * The earlier videos of a remix chain for the post body (after the direct
 * source, which the "Based on a video by" line already links). Empty when the
 * chain has nothing before its source.
 */
export function remixChainMarkdown(chain, origin) {
  const earlier = (chain || []).slice(1);
  if (!earlier.length) return '';
  const links = earlier.map(c => `[@${c.author}](${remixVideoLink(c, origin)})`).join(' · ');
  return `\n*Earlier in this remix chain: ${links}*`;
}
