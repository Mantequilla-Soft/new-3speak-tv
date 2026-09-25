/**
 * Hive Blockchain API Service for Shorts
 *
 * Uses axios for API calls
 */

import axios from "axios";
import { getHiveUrl } from '../utils/hiveNode';
import { isSnapsContainer } from '../utils/snapsContainer';

/* Hivemind SYNTHESISES a title for a comment: `bridge.get_post` answers
 * "RE: <parent title>" where the raw post has none at all. Harmless in a thread view
 * and wrong everywhere else — it put "RE: Snaps Container // 6/8/2026, 2:36:00 PM" on
 * the origin card of a reaction chain, which is the container's name on a card that
 * exists to name the person's snap.
 *
 * Treated as absent, so callers fall through to the body, which is what was written. */
const chainTitle = (title) => {
  const t = String(title || '').trim();
  return /^re:\s/i.test(t) ? '' : t;
};
import { convert } from "html-to-text";
import { HIVE_API_URL, CHECKER_URL, SHORTS_API_URL, USER_SHORTS_API_URL, appendNsfw } from "../utils/config";
import { getPlayerUrl } from "../utils/playerUrl";
import { getFeedSeed, regenerateFeedSeed } from "../utils/feedSeed";
import { useAppStore } from "../lib/store";

/* -----------------------------
   Hive RPC setup
------------------------------ */
// ONE page size for every shorts request. The server paginates with
// skip = (page-1)*limit, so page 1 and the loadMore pages MUST agree — they used
// to be 10 and 20, which made page 2 start at server item 20 while the client only
// had 10. Items 11-20 were never fetched: that's the "swipe jumps over a short".
export const SHORTS_PAGE_SIZE = 10;

const SHORTS_API = SHORTS_API_URL;
const USER_SHORTS_API = USER_SHORTS_API_URL;

// Random seed for shorts ordering — regenerated each time shorts are opened
// Shorts share the app-wide session seed: stable across navigation, new on a real
// page refresh. (It used to be regenerated on every visit to /shorts, which
// reshuffled the feed whenever you navigated back to it.)

export function regenerateShortsSeed() {
  return regenerateFeedSeed();
}

/* -----------------------------
   Hive RPC helper
------------------------------ */

async function hiveRpc(method, params) {
  try {
    const response = await axios.post(getHiveUrl(), {
      jsonrpc: "2.0",
      method,
      params,
      id: 1
    });

    if (response.data.error) {
      throw new Error(response.data.error.message);
    }

    return response.data.result;
  } catch (error) {
    console.error(`Hive RPC error (${method}):`, error);
    throw error;
  }
}

/* -----------------------------
   Shorts list
------------------------------ */

// In-memory index of shorts we've already fetched — avoids redundant API lookups
const _shortsByEmbedUrl = new Map(); // embed_url → short object
const _shortsByPermlink = new Map(); // permlink → short object

export async function fetchShortsList(page = 1, limit = 20, currentuser = null) {
  let url = appendNsfw(`${SHORTS_API}?page=${page}&limit=${limit}&seed=${getFeedSeed()}`, useAppStore.getState().showNsfw);
  // Bias the feed toward the logged-in user's interests (checker weights them).
  const _st = useAppStore.getState();
  const _hasInterests = Array.isArray(_st.interests) && _st.interests.length > 0;
  if (_hasInterests) url += `&interests=${encodeURIComponent(_st.interests.join(','))}`;
  // "My interests" mode: ask the checker to HARD-filter to those topics rather than
  // just boost them. Only meaningful when the user actually has interests set.
  if (_hasInterests && _st.shortsFeedMode === 'interests') url += '&onlyinterests=1';
  // Always identify the user when we can: the checker needs `currentuser` for the
  // always-on dismissals ("not interested" / hidden creator), and separately reads
  // `hidewatched` for the toggleable hide-watched preference.
  const _watchUser = currentuser || _st.user || null;
  if (_watchUser) {
    url += `&currentuser=${encodeURIComponent(_watchUser)}`;
    url += `&hidewatched=${_st.hideWatched ? '1' : '0'}`;
  }
  console.log('Shorts API URL:', url);
  const response = await axios.get(url);
  console.log('Fetching shorts list data:', response.data);

  // Index every short we receive so findShortByEmbedUrl/findShortByPermlink
  // can resolve instantly without extra API calls
  if (response.data?.shorts) {
    for (const s of response.data.shorts) {
      if (s.embed_url) _shortsByEmbedUrl.set(s.embed_url, s);
      if (s.permlink) _shortsByPermlink.set(s.permlink, s);
    }
  }

  return response.data;
}

/* -----------------------------
   Hive data fetchers
------------------------------ */

export async function getPostDetails(author, permlink) {
  return await hiveRpc("bridge.get_post", { author, permlink });
}

export async function getActiveVotes(author, permlink) {
  return await hiveRpc("condenser_api.get_active_votes", [author, permlink]);
}

export async function getComments(author, permlink) {
  return await hiveRpc("bridge.get_discussion", { author, permlink });
}

export async function getAccounts(accounts) {
  return await hiveRpc("condenser_api.get_accounts", [accounts]);
}

// Communities an account subscribes to. Each entry is [name, title, role, role_title].
export async function getSubscriptions(account) {
  return await hiveRpc("bridge.list_all_subscriptions", { account });
}

/* -----------------------------
   Utils
------------------------------ */

/**
 * Convert hive_body (markdown/HTML) to clean plaintext for display as caption.
 * Strips URLs, HTML tags, markdown syntax, and collapses whitespace.
 */
export function bodyToPlaintext(body) {
  if (!body) return "";
  // Preserve markdown links [text](url) by replacing them with placeholders before HTML conversion
  const links = [];
  let text = body.replace(/\[([^\]]*)\]\(([^)]*)\)/g, (match) => {
    links.push(match);
    return `%%LINK${links.length - 1}%%`;
  });
  // Convert any HTML to text
  text = convert(text, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }] });
  // Restore markdown links
  text = text.replace(/%%LINK(\d+)%%/g, (_, i) => links[parseInt(i)]);
  // Remove standalone URLs (not inside markdown link syntax)
  text = text.replace(/(?<!\()https?:\/\/\S+/gi, '');
  // Remove markdown images (but keep regular links)
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Remove markdown bold/italic markers
  text = text.replace(/[*_]{1,3}/g, '');
  // Remove markdown headers
  text = text.replace(/^#{1,6}\s+/gm, '');
  // Remove <sup>...</sup> and similar stray HTML
  text = text.replace(/<[^>]+>/g, '');
  // Collapse whitespace and trim
  text = text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  return text;
}

/**
 * Parse embed_url to extract author and permlink
 * embed_url format: "@author/permlink" (e.g., "@ismeris/20260129t125012354z")
 */
export function parseEmbedUrl(embedUrl) {
  if (!embedUrl) return { author: null, permlink: null };

  let cleaned = embedUrl;

  // Handle full URLs like https://3speak.tv/watch?v=author/permlink 
  // or https://play.3speak.tv/embed?v=author/permlink
  if (embedUrl.includes('?v=')) {
    cleaned = embedUrl.split('?v=')[1].split('&')[0];
  } else if (embedUrl.includes('3speak.tv/')) {
    // Handle formats like https://3speak.tv/author/permlink
    const urlParts = embedUrl.split('3speak.tv/')[1].split('/');
    if (urlParts.length >= 2) {
      cleaned = `${urlParts[0]}/${urlParts[1]}`;
    }
  }

  // Remove leading @ if present
  if (cleaned.startsWith('@')) {
    cleaned = cleaned.slice(1);
  }

  const parts = cleaned.split('/');

  if (parts.length >= 2) {
    return {
      author: parts[0],
      permlink: parts[1]
    };
  }

  return { author: null, permlink: null };
}

export function parseUserAvatar(account) {
  if (!account) {
    return "https://images.hive.blog/u/null/avatar/small";
  }

  try {
    const meta =
      typeof account.posting_json_metadata === "string"
        ? JSON.parse(account.posting_json_metadata)
        : account.posting_json_metadata;

    if (meta?.profile?.profile_image) {
      return meta.profile.profile_image;
    }

    const jsonMeta =
      typeof account.json_metadata === "string"
        ? JSON.parse(account.json_metadata)
        : account.json_metadata;

    if (jsonMeta?.profile?.profile_image) {
      return jsonMeta.profile.profile_image;
    }
  } catch (_) { }

  return `https://images.hive.blog/u/${account.name}/avatar/small`;
}

export function formatNumber(num) {
  if (!num) return "0";
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + "M";
  if (num >= 1_000) return (num / 1_000).toFixed(1) + "K";
  return num.toString();
}

export function timeAgo(dateString) {
  if (!dateString) return "Just now";

  // Append "Z" only if the string has no timezone indicator already
  const hasTimezone = /[Zz]|[+-]\d{2}:\d{2}$/.test(dateString);
  const parsed = new Date(hasTimezone ? dateString : dateString + "Z");
  const seconds = Math.floor((Date.now() - parsed) / 1000);
  if (isNaN(seconds)) return "";

  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
  if (seconds < 31536000) return `${Math.floor(seconds / 2592000)}mo ago`;
  return `${Math.floor(seconds / 31536000)}y ago`;
}

/* -----------------------------
   Short aggregation
------------------------------ */

export async function fetchCompleteShortData(shortItem, loggedInUser = null) {
  const {
    owner,
    permlink: playerPermlink,
    thumbnail_url,
    views,
    createdAt,
    embed_url,
    embed_title
  } = shortItem;

  const { author: embedAuthor, permlink: hivePermlink } = parseEmbedUrl(embed_url);
  const author = embedAuthor || owner;

  const base = {
    id: `${author}-${playerPermlink}`,
    author,
    permlink: playerPermlink,
    hivePermlink: hivePermlink,
    // True when there is no resolvable Hive post to interact with (no hive permlink,
    // or the post was never created / was deleted). Disables vote/comment/reshare.
    hivePostMissing: !hivePermlink,
    embedUrl: embed_url,
    thumbnailUrl: thumbnail_url,
    views: views || 0,
    createdAt,
    timeAgo: timeAgo(createdAt),
    title: embed_title || "",
    caption: embed_title || "",
    user: {
      username: `@${author}`,
      avatar: `https://images.hive.blog/u/${author}/avatar/small`,
      isSubscribed: false
    },
    stats: {
      likes: 0,
      dislikes: 0,
      comments: 0,
      shares: 0,
      remixes: 0,
      payout: "0.00"
    },
    comments: [],
    commentsLoaded: false,
    isLiked: false,
    isDisliked: false
  };

  try {
    if (hivePermlink) {
      // Run vote check and post details in parallel
      const [votes, post] = await Promise.all([
        loggedInUser ? getActiveVotes(author, hivePermlink).catch(() => null) : Promise.resolve(null),
        getPostDetails(author, hivePermlink).catch(() => null),
      ]);

      // No resolvable Hive post (deleted / never created) — interactions disabled.
      if (!post) base.hivePostMissing = true;

      // Lightweight vote status from get_active_votes
      if (votes && loggedInUser) {
        const userVote = votes.find(v => v.voter === loggedInUser);
        if (userVote) {
          base.isLiked = userVote.percent >= 0;
          base.isDisliked = userVote.percent < 0;
        }
      }

      if (post) {
        // Populate stats from Hive post data
        base.stats.likes = post.stats?.total_votes || post.active_votes?.filter(v => v.percent > 0).length || 0;
        base.stats.comments = post.children || 0;
        const payout = parseFloat(post.payout) || parseFloat(post.pending_payout_value) || 0;
        base.stats.payout = payout.toFixed(2);
        base.caption = bodyToPlaintext(post.body) || base.caption;
        base.title = post.title || base.title;

        // Check if this short is a reaction with a parentTimestamp
        const jm = typeof post.json_metadata === 'string'
          ? JSON.parse(post.json_metadata || '{}')
          : (post.json_metadata || {});

        // Extract reusable flag from MongoDB via checker endpoint
        try {
          const reusableRes = await axios.get(`${CHECKER_URL}/api/video/${author}/${playerPermlink}`);
          if (reusableRes.data?.success) {
            base.reusable = !!reusableRes.data.reusable;
          }
        } catch {
          // Fallback to Hive json_metadata if checker unavailable
          if (jm.video && jm.video.reusable != null) {
            base.reusable = !!jm.video.reusable;
          }
        }

        // Detect remix shorts: video.originalAuthor set but no parentTimestamp
        const isRemix = !jm.parentTimestamp && jm.video?.originalAuthor && jm.video?.originalPermlink && post.parent_author;

        if ((jm.parentTimestamp != null || isRemix) && post.parent_author) {
          if (jm.parentTimestamp != null) base.parentTimestamp = jm.parentTimestamp;
          try {
            const immediateParent = await getPostDetails(post.parent_author, post.parent_permlink);
            if (immediateParent) {
              let rootPost = immediateParent;
              let intermediateChain = [];

              // If the immediate parent is a comment (not the root video), capture it
              if (immediateParent.parent_author) {
                const bodyExcerpt = (immediateParent.body || '').split('\n').filter(l => l.trim()).slice(0, 2).join('\n');
                if (bodyExcerpt) {
                  base.parentComment = {
                    author: immediateParent.author,
                    body: bodyExcerpt,
                  };
                }

                // Check if the immediate parent is itself a short (video reaction)
                const parentJm = typeof immediateParent.json_metadata === 'string'
                  ? JSON.parse(immediateParent.json_metadata || '{}')
                  : (immediateParent.json_metadata || {});
                if (parentJm.video?.url || parentJm.video?.platform === '3speak') {
                  try {
                    const parentShortEntry = await findShortByEmbedUrl(immediateParent.author, immediateParent.permlink);
                    if (parentShortEntry) {
                      base.parentShort = {
                        author: parentShortEntry.owner,
                        permlink: parentShortEntry.permlink,
                      };
                    }
                  } catch (e) {
                    console.warn('Failed to look up parent short:', e.message);
                  }
                }

                // Walk up the chain to find the root video, collecting the chain
                const parentDur = parentJm.video?.info?.duration || parentJm.video?.duration || 0;
                const parentBody = (immediateParent.body || '').split('\n').filter(l => l.trim() && !l.startsWith('<sup>') && !l.startsWith('http')).slice(0, 3).join('\n');

                const reactionChain = [{
                  author: immediateParent.author,
                  permlink: immediateParent.permlink,
                  title: chainTitle(immediateParent.title),
                  body: parentBody,
                  duration: parentDur,
                  type: parentJm.video ? 'video' : 'comment',
                  thumbnail: parentJm?.image?.[0] || null,
                  children: immediateParent.children || 0,
                }];
                let current = immediateParent;
                let depth = 0;
                while (current.parent_author && depth < 10) {
                  current = await getPostDetails(current.parent_author, current.parent_permlink);
                  if (!current) break;
                  if (current.parent_author) {
                    const cJm = typeof current.json_metadata === 'string'
                      ? JSON.parse(current.json_metadata || '{}') : (current.json_metadata || {});
                    const dur = cJm.video?.info?.duration || cJm.video?.duration || 0;
                    const cBody = (current.body || '').split('\n').filter(l => l.trim() && !l.startsWith('<sup>') && !l.startsWith('http')).slice(0, 3).join('\n');

                    reactionChain.unshift({
                      author: current.author,
                      permlink: current.permlink,
                      title: chainTitle(current.title),
                      body: cBody,
                      duration: dur,
                      type: cJm.video ? 'video' : 'comment',
                      thumbnail: cJm?.image?.[0] || null,
                      children: current.children || 0,
                    });
                  }
                  depth++;
                }
                if (current) rootPost = current;
                // Store intermediates for later — root will be prepended below
                intermediateChain = reactionChain;
              }

              /* THE CONTAINER IS NOT A STEP.
               *
               * A snap lives as a comment under @peak.snaps' rotating container post,
               * so walking up from a reaction lands on that container and it became the
               * origin card: "Snaps Container // 6/8/2026" above the snap somebody
               * actually wrote. Three steps, the first of which nobody authored and
               * nobody can meaningfully open.
               *
               * Dropped here rather than hidden in the view, so everything reading a
               * reaction chain agrees on where it starts. The snap itself is promoted
               * to the origin below, after the permlink resolution — marking it root
               * any earlier would exclude it from that pass and cost it its "open the
               * short" link. */
              const rootIsContainer = isSnapsContainer(rootPost);

              // Store the root video
              if (rootPost && !rootPost.parent_author && !rootIsContainer) {
                const rootJm = typeof rootPost.json_metadata === 'string'
                  ? JSON.parse(rootPost.json_metadata || '{}')
                  : (rootPost.json_metadata || {});
                base.parentVideo = {
                  author: rootPost.author,
                  permlink: rootPost.permlink,
                  title: rootPost.title,
                  created: rootPost.created,
                  duration: rootJm?.video?.info?.duration || rootJm?.video?.duration || 0,
                  thumbnail: rootJm?.image?.[0] || null,
                  stats: {
                    total_hive_reward: rootPost.payout || rootPost.pending_payout_value || 0,
                    num_votes: rootPost.stats?.total_votes || rootPost.active_votes?.length || 0,
                  }
                };

                // Build complete chain: [root, ...intermediates]
                const rootDur = rootJm?.video?.info?.duration || rootJm?.video?.duration || 0;
                const rootBody = (rootPost.body || '').split('\n').filter(l => l.trim() && !l.startsWith('<sup>') && !l.startsWith('http')).slice(0, 3).join('\n');
                const rootEntry = {
                  author: rootPost.author,
                  permlink: rootPost.permlink,
                  title: chainTitle(rootPost.title),
                  body: rootBody,
                  duration: rootDur,
                  type: 'video',
                  thumbnail: rootJm?.image?.[0] || null,
                  isRoot: true,
                  children: rootPost.children || 0,
                };
                base.reactionChain = [rootEntry, ...intermediateChain];

                // Resolve internal player permlinks for video-type chain steps
                try {
                  await Promise.all(
                    base.reactionChain
                      .filter(step => step.type === 'video' && !step.isRoot)
                      .map(async (step) => {
                        const found = await findShortByEmbedUrl(step.author, step.permlink);
                        if (found) {
                          step.shortAuthor = found.owner;
                          step.shortPermlink = found.permlink;
                        }
                      })
                  );
                } catch (e) {
                  console.warn('Failed to resolve chain step permlinks:', e.message);
                }
              }

              /* The container case: the chain is the intermediates alone, and the
               * oldest of them — the snap the reaction answers — becomes the origin.
               * `parentVideo` is deliberately left null: there is no root VIDEO here,
               * and pointing it at the container would send anybody following it to a
               * page full of other people's snaps. */
              if (rootIsContainer && intermediateChain.length > 0) {
                base.reactionChain = intermediateChain;
                try {
                  await Promise.all(
                    base.reactionChain
                      .filter((step) => step.type === 'video')
                      .map(async (step) => {
                        if (step.shortPermlink) return;
                        const found = await findShortByEmbedUrl(step.author, step.permlink);
                        if (found) {
                          step.shortAuthor = found.owner;
                          step.shortPermlink = found.permlink;
                        }
                      }),
                  );
                } catch (e) {
                  console.warn('Failed to resolve chain step permlinks:', e.message);
                }
                base.reactionChain[0].isRoot = true;
              }
            }
          } catch (err) {
            console.warn('Failed to fetch parent video:', err.message);
          }
        }

        // Load direct child reactions (replies to this short that are themselves shorts)
        try {
          const replies = await hiveRpc("condenser_api.get_content_replies", [post.author, post.permlink]);
          if (replies?.length > 0) {
            const videoReplies = replies.filter(reply => {
              const rJm = typeof reply.json_metadata === 'string'
                ? JSON.parse(reply.json_metadata || '{}') : (reply.json_metadata || {});
              return rJm.video?.url || rJm.video?.platform === '3speak';
            });
            const childReactions = (await Promise.all(
              videoReplies.map(async (reply) => {
                const rJm = typeof reply.json_metadata === 'string'
                  ? JSON.parse(reply.json_metadata || '{}') : (reply.json_metadata || {});
                const found = await findShortByEmbedUrl(reply.author, reply.permlink);
                if (found) {
                  return {
                    author: reply.author,
                    permlink: reply.permlink,
                    shortAuthor: found.owner,
                    shortPermlink: found.permlink,
                    title: reply.title || '',
                    type: 'video',
                    thumbnail: rJm?.image?.[0] || null,
                    duration: rJm.video?.info?.duration || rJm.video?.duration || 0,
                    children: reply.children || 0,
                  };
                }
                return null;
              })
            )).filter(Boolean);
            if (childReactions.length > 0) base.childReactions = childReactions;
          }
        } catch (err) {
          console.warn('Failed to load child reactions:', err.message);
        }
      }
    }
  } catch (err) {
    console.warn(`Failed to enrich short ${author}/${hivePermlink}:`, err.message);
  }

  return base;
}

/* -----------------------------
   Fetch comments for a post
------------------------------ */

export async function fetchPostComments(author, hivePermlink, loggedInUser = null) {
  try {
    // Use condenser_api.get_content_replies like the CommentSection component
    const replies = await hiveRpc("condenser_api.get_content_replies", [author, hivePermlink]);

    if (!replies || replies.length === 0) return [];

    // Load nested comments recursively
    const commentsWithChildren = await loadNestedComments(replies, loggedInUser);

    return commentsWithChildren;
  } catch (err) {
    console.error('Error fetching comments:', err);
    return [];
  }
}

// Recursively load nested comments
async function loadNestedComments(comments, loggedInUser = null) {
  const result = await Promise.all(
    comments.map(async (comment) => {
      // Fetch child comments
      let children = [];
      try {
        const childReplies = await hiveRpc("condenser_api.get_content_replies", [comment.author, comment.permlink]);
        if (childReplies && childReplies.length > 0) {
          children = await loadNestedComments(childReplies, loggedInUser);
        }
      } catch (err) {
        console.warn(`Failed to fetch children for ${comment.author}/${comment.permlink}`);
      }

      // Check if user has voted
      const has_voted = loggedInUser
        ? comment.active_votes?.some(v => v.voter === loggedInUser) ?? false
        : false;

      return {
        id: `${comment.author}-${comment.permlink}`,
        author: comment.author,
        permlink: comment.permlink,
        body: comment.body,
        createdAt: comment.created,
        timeAgo: timeAgo(comment.created),
        netVotes: comment.net_votes || 0,
        activeVotes: comment.active_votes || [],
        children: children,
        childrenCount: children.length,
        has_voted,
        stats: {
          num_likes: comment.active_votes?.filter((v) => v.percent > 0).length || 0,
          num_dislikes: comment.active_votes?.filter((v) => v.percent < 0).length || 0,
          total_hive_reward: parseFloat(comment.pending_payout_value) || 0
        },
        user: {
          username: `@${comment.author}`,
          avatar: `https://images.hive.blog/u/${comment.author}/avatar/small`
        }
      };
    })
  );

  return result;
}

/* -----------------------------
   Find a short by its Hive embed_url (e.g. "@author/permlink")
------------------------------ */

export async function findShortByEmbedUrl(author, hivePermlink) {
  const target = `@${author}/${hivePermlink}`;

  // Fast path: check in-memory index first (populated by every fetchShortsList call)
  const cached = _shortsByEmbedUrl.get(target);
  if (cached) return cached;

  // Try the user-specific shorts endpoint first (much faster than paginating global feed)
  try {
    const url = appendNsfw(`${USER_SHORTS_API}/${encodeURIComponent(author)}?page=1&limit=100`, useAppStore.getState().showNsfw);
    const response = await axios.get(url);
    if (response.data?.shorts) {
      for (const s of response.data.shorts) {
        if (s.embed_url) _shortsByEmbedUrl.set(s.embed_url, s);
        if (s.permlink) _shortsByPermlink.set(s.permlink, s);
      }
      const found = _shortsByEmbedUrl.get(target);
      if (found) return found;
    }
  } catch (e) {
    console.warn('findShortByEmbedUrl: user endpoint failed:', e.message);
  }

  // Fallback: paginate the global feed
  let page = 1;
  const limit = 50;
  const maxPages = 10;

  while (page <= maxPages) {
    const data = await fetchShortsList(page, limit);
    if (!data?.shorts) break;

    const found = _shortsByEmbedUrl.get(target);
    if (found) return found;

    if (page >= (data.totalPages || 1)) break;
    page++;
  }

  return null;
}

/* -----------------------------
   Find a short by player permlink
------------------------------ */

export async function findShortByPermlink(permlink) {
  // Fast path: check in-memory index first
  const cached = _shortsByPermlink.get(permlink);
  if (cached) return cached;

  // Slow fallback: paginate the API
  let page = 1;
  const limit = 50;
  const maxPages = 10;

  while (page <= maxPages) {
    const data = await fetchShortsList(page, limit);
    if (!data?.shorts) break;

    const found = _shortsByPermlink.get(permlink);
    if (found) return found;

    if (page >= (data.totalPages || 1)) break;
    page++;
  }

  return null;
}

/* -----------------------------
   Bulk shorts fetch
------------------------------ */

export async function fetchShortsWithDetails(page = 1, limit = 10, loggedInUser = null) {
  const shortsList = await fetchShortsList(page, limit, loggedInUser);

  if (!shortsList?.shorts) {
    throw new Error("Failed to fetch shorts list");
  }

  // Fast path: format directly from the list API data (no per-short RPC)
  const shorts = shortsList.shorts.map((s) => {
    const { author, permlink: hivePermlink } = parseEmbedUrl(s.embed_url);
    const finalAuthor = author || s.owner;

    return {
      id: `${finalAuthor}-${s.permlink}`,
      author: finalAuthor,
      permlink: s.permlink,
      hivePermlink: hivePermlink,
      embedUrl: s.embed_url,
      thumbnailUrl: s.thumbnail_url,
      views: s.views || 0,
      createdAt: s.createdAt,
      timeAgo: timeAgo(s.createdAt),
      title: s.hive_title || s.embed_title || "",
      caption: bodyToPlaintext(s.hive_body) || s.hive_title || s.embed_title || "",
      tags: Array.isArray(s.hive_tags) ? s.hive_tags : [],
      user: {
        username: `@${finalAuthor}`,
        avatar: `https://images.hive.blog/u/${finalAuthor}/avatar/small`,
        isSubscribed: false,
        followersCount: s.hive_followers ?? null,
        reputation: s.hive_author_reputation ?? null,
      },
      stats: {
        likes: s.hive_votes || 0,
        dislikes: 0,
        comments: s.hive_comments || 0,
        shares: 0,
        remixes: 0,
        payout: s.hive_reward != null ? String(s.hive_reward) : "0.00"
      },
      comments: [],
      commentsLoaded: false,
      isLiked: false,
      isDisliked: false,
      // Mark as not yet enriched — reaction chain & vote status loaded lazily
      _enriched: false,
    };
  });

  return {
    success: true,
    page: shortsList.page,
    total: shortsList.total,
    totalPages: shortsList.totalPages,
    shorts
  };
}

/* -----------------------------
   User-specific shorts feed
------------------------------ */

export async function fetchUserShortsList(username, page = 1, limit = 20, includeUnlisted = false) {
  let url = appendNsfw(`${USER_SHORTS_API}/${username}?page=${page}&limit=${limit}`, useAppStore.getState().showNsfw);
  if (includeUnlisted) url += '&include_unlisted=1';
  const response = await axios.get(url);

  // Index results in the same maps so findShortByPermlink works
  if (response.data?.shorts) {
    for (const s of response.data.shorts) {
      if (s.embed_url) _shortsByEmbedUrl.set(s.embed_url, s);
      if (s.permlink) _shortsByPermlink.set(s.permlink, s);
    }
  }

  return response.data;
}

export async function fetchUserShortsWithDetails(username, page = 1, limit = 20, includeUnlisted = false) {
  const shortsList = await fetchUserShortsList(username, page, limit, includeUnlisted);

  if (!shortsList?.shorts) {
    throw new Error("Failed to fetch user shorts list");
  }

  const shorts = shortsList.shorts.map((s) => {
    const { author, permlink: hivePermlink } = parseEmbedUrl(s.embed_url);
    const finalAuthor = author || s.owner;

    return {
      id: `${finalAuthor}-${s.permlink}`,
      author: finalAuthor,
      permlink: s.permlink,
      hivePermlink: hivePermlink,
      embedUrl: s.embed_url,
      thumbnailUrl: s.thumbnail_url,
      views: s.views || 0,
      createdAt: s.createdAt,
      timeAgo: timeAgo(s.createdAt),
      title: s.hive_title || s.embed_title || "",
      caption: bodyToPlaintext(s.hive_body) || s.hive_title || s.embed_title || "",
      tags: Array.isArray(s.hive_tags) ? s.hive_tags : [],
      user: {
        username: `@${finalAuthor}`,
        avatar: `https://images.hive.blog/u/${finalAuthor}/avatar/small`,
        isSubscribed: false,
        followersCount: s.hive_followers ?? null,
        reputation: s.hive_author_reputation ?? null,
      },
      stats: {
        likes: s.hive_votes || 0,
        dislikes: 0,
        comments: s.hive_comments || 0,
        shares: 0,
        remixes: 0,
        payout: s.hive_reward != null ? String(s.hive_reward) : "0.00"
      },
      comments: [],
      commentsLoaded: false,
      isLiked: false,
      isDisliked: false,
      unlisted: s.unlisted === true, // owner's own profile can badge + re-list
      _enriched: false,
    };
  });

  return {
    success: true,
    page: shortsList.page,
    total: shortsList.total,
    totalPages: shortsList.totalPages,
    shorts
  };
}

/* -----------------------------
   3Speak helpers
------------------------------ */

// Player backend that serves the embeddable iframe player — resolved at USE-time so
// it reflects the health-picked fallback (getPlayerUrl), not the primary captured at
// module load. Falls back to the production player if nothing is configured.
const playerBase = () => getPlayerUrl() || 'https://play.3speak.tv';

// NOTE: uses the /play route (not /embed) — /play never increments the view
// counter but still runs the server-measured watch-duration tracking. This
// keeps embedded-in-post videos from polluting view counts on preview.
export function get3SpeakEmbedUrl(embedUrl, layout = "mobile", controls = true) {
  if (!embedUrl) return null;

  const cleanedPath = embedUrl.startsWith('@') ? embedUrl.slice(1) : embedUrl;
  const controlsParam = controls ? '' : '&controls=0';
  return `${playerBase()}/play?v=${cleanedPath}&mode=iframe&layout=${layout}${controlsParam}`;
}

export function build3SpeakEmbedUrl(author, permlink, layout = "mobile", controls = true) {
  if (!author || !permlink) return null;

  const controlsParam = controls ? '' : '&controls=0';
  return `${playerBase()}/play?v=${author}/${permlink}&mode=iframe&layout=${layout}${controlsParam}`;
}

/* -----------------------------
   Shorts preload cache
------------------------------ */

let _preloadedShorts = null;
let _preloadPromise = null;

/**
 * Preloads the first page of shorts in the background.
 * Safe to call multiple times — only runs once until consumed.
 */
export function preloadShorts(limit = 5, currentuser = null) {
  if (_preloadedShorts || _preloadPromise) return; // already preloading or done
  _preloadPromise = fetchShortsWithDetails(1, limit, currentuser)
    .then((data) => {
      _preloadedShorts = data;
      _preloadPromise = null;
    })
    .catch((err) => {
      console.warn('Shorts preload failed:', err.message);
      _preloadPromise = null;
    });
}

/**
 * Synchronous check: returns true if preloaded data is already available
 * (finished loading, not just in-flight).
 */
export function hasShortsPreloaded() {
  return _preloadedShorts != null;
}

/**
 * Returns preloaded shorts data and clears the cache (one-time consumption).
 * If preload is still in flight, waits for it.
 * Returns null if nothing was preloaded.
 */
export async function consumePreloadedShorts() {
  if (_preloadPromise) await _preloadPromise;
  const data = _preloadedShorts;
  _preloadedShorts = null;
  return data;
}

/* -----------------------------
   Default export
------------------------------ */

export default {
  fetchShortsList,
  findShortByPermlink,
  findShortByEmbedUrl,
  getPostDetails,
  getComments,
  getAccounts,
  parseEmbedUrl,
  parseUserAvatar,
  formatNumber,
  timeAgo,
  fetchCompleteShortData,
  fetchShortsWithDetails,
  fetchPostComments,
  get3SpeakEmbedUrl,
  build3SpeakEmbedUrl,
  preloadShorts,
  hasShortsPreloaded,
  consumePreloadedShorts,
  HIVE_API_URL,
  SHORTS_API
};