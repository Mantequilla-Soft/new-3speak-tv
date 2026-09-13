import {
  fetchIncubationRepliesFor, fetchIncubationLikesFor, handleAvatar,
} from '../lib/incubation';

/**
 * Merge off-chain replies into a Hive comment tree.
 *
 * Extracted from CommentSection, which was the only place that did this. A reply
 * written by someone with no Hive account is stored off-chain, so any view that
 * reads Hive alone shows a thread with holes in it -- including to the person who
 * wrote the reply, which reads as "my comment vanished". The watch page handled
 * it; shorts and snaps did not, and had no way to without copying all of this.
 *
 * Best-effort by contract: if the store is unreachable the Hive thread is
 * returned untouched. A comment section that fails entirely because an optional
 * enrichment call timed out would be a bad trade.
 *
 * @param rootPermlink the post's own permlink
 * @param comments     the Hive comment tree (each node: permlink, children[])
 * @returns a new tree with the off-chain replies attached where they were written
 */
export async function mergeOffChainReplies(rootPermlink, comments) {
  const onChain = comments || [];
  try {
    // Every permlink in the thread, not just the post's. An off-chain reply
    // hangs off whatever it answered, so asking only about the post returns the
    // top level and silently drops every reply to a comment.
    const known = new Set([rootPermlink]);
    const walk = (list) => list.forEach((c) => {
      if (!c?.permlink) return;
      known.add(c.permlink);
      if (c.children?.length) walk(c.children);
    });
    walk(onChain);

    // Loop, because an off-chain reply can itself be replied to off-chain, and
    // those parents are only known once the first round comes back. Bounded:
    // threads are not deep, and this stops as soon as a round finds nothing new.
    const collected = [];
    const seen = new Set();
    let ask = [...known];
    for (let round = 0; round < 4 && ask.length; round += 1) {
      const { items } = await fetchIncubationRepliesFor(ask);
      const fresh = (items || []).filter((it) => it.permlink && !seen.has(it.permlink));
      if (!fresh.length) break;
      fresh.forEach((it) => seen.add(it.permlink));
      collected.push(...fresh);
      ask = fresh.map((f) => f.permlink);
    }
    if (!collected.length) return onChain;

    const mapped = collected.map((it) => {
      // A reply is stored off-chain for either of two reasons, and they render
      // differently: its writer has no Hive account (show the handle and the
      // 3Speak mark), or the POST is off-chain while the writer is an ordinary
      // Hive user (show their real account, so their avatar and reputation
      // resolve as they should anywhere).
      const isHiveAuthor = !!it.hiveAuthor;
      const name = it.hiveAuthor || it.author?.handle || it.handle;
      return {
        author: {
          username: name,
          profile: {
            images: {
              avatar: isHiveAuthor
                ? `https://images.hive.blog/u/${name}/avatar/small`
                : handleAvatar(name),
            },
          },
        },
        permlink: it.permlink,
        // Kept so the nesting below knows what this answered.
        parentPermlink: it.parentPermlink,
        created_at: it.created,
        body: it.body,
        parentTimestamp: it.jsonMetadata?.parentTimestamp ?? null,
        has_voted: false,
        stats: { num_likes: 0, num_dislikes: 0, total_hive_reward: 0 },
        children: [],
        // Nothing downstream should try to build a Hive permalink, fetch votes,
        // or offer a Hive vote button for these.
        onChain: false,
      };
    });

    // Attach each one under what it actually replied to. Anything answering the
    // POST itself is top level; anything answering a comment becomes that
    // comment's child, so a reply reads where it was written.
    const byPermlink = new Map();
    const index = (list) => list.forEach((c) => {
      if (!c?.permlink) return;
      byPermlink.set(c.permlink, c);
      if (c.children?.length) index(c.children);
    });
    index(onChain);
    // Registered before attaching, so a reply to an off-chain reply finds its
    // parent too.
    mapped.forEach((m) => byPermlink.set(m.permlink, m));

    const roots = [];
    mapped.forEach((m) => {
      const parent = m.parentPermlink && m.parentPermlink !== rootPermlink
        ? byPermlink.get(m.parentPermlink)
        : null;
      if (parent && parent !== m) parent.children = [...(parent.children || []), m];
      else roots.push(m);
    });

    return [...roots, ...onChain].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );
  } catch (err) {
    console.warn('[incubation] replies unavailable:', err?.message);
    return onChain;
  }
}

/**
 * Add off-chain likes to a Hive comment tree's counts.
 *
 * A like from someone with no Hive account is stored off-chain, so a thread that
 * counts `active_votes` alone shows it as zero -- including to the person who
 * just pressed the heart, which reads as the button not working. This is the
 * read half of the vote diversion that already exists on the write side.
 *
 * ONE request for the whole tree. Counts are ADDED to the Hive ones rather than
 * replacing them, because a post can carry both kinds at once, and `has_voted`
 * is true if EITHER store knows this viewer.
 *
 * @param tree   the comment tree (nodes: author, permlink, stats, children[])
 * @param viewer the reader's Hive username or warm-up handle, for `has_voted`
 */
export async function applyOffChainLikes(tree, viewer) {
  const nodes = [];
  const walk = (list) => (list || []).forEach((c) => {
    if (c?.permlink) nodes.push(c);
    if (c?.children?.length) walk(c.children);
  });
  walk(tree);
  if (!nodes.length) return tree;

  const authorOf = (c) => (typeof c.author === 'string' ? c.author : c.author?.username);

  try {
    const map = await fetchIncubationLikesFor(
      nodes.map((c) => ({ author: authorOf(c), permlink: c.permlink })),
      viewer,
    );
    if (!map || !Object.keys(map).length) return tree;

    const patch = (list) => (list || []).map((c) => {
      const hit = map[`${authorOf(c)}/${c.permlink}`];
      const next = hit && (hit.count || hit.liked)
        ? {
          ...c,
          stats: {
            ...(c.stats || {}),
            num_likes: (c.stats?.num_likes || 0) + (hit.count || 0),
          },
          has_voted: c.has_voted || !!hit.liked,
        }
        : c;
      return next.children?.length ? { ...next, children: patch(next.children) } : next;
    });
    return patch(tree);
  } catch (err) {
    // Best-effort, same contract as the replies merge: a thread that renders with
    // Hive-only counts beats a thread that does not render.
    console.warn('[incubation] likes unavailable:', err?.message);
    return tree;
  }
}
