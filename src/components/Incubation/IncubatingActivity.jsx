import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  fetchIncubationUserComments, fetchIncubationFollowers, fetchIncubationFollowing,
  fetchIncubationUserContent,
} from '../../lib/incubation';
import { batchGetContent } from '../../utils/hiveUtils';
import './IncubatingActivity.scss';

const LOADERS = {
  comments: fetchIncubationUserComments,
  followers: fetchIncubationFollowers,
  following: fetchIncubationFollowing,
};

// How many DISTINCT authors we will ask the incubation service about when Hive
// did not know a parent. One request each, so this is the ceiling on the second
// pass; a page of replies is realistically two or three people.
const MAX_OFFCHAIN_AUTHORS = 6;

const EMPTY = {
  comments: 'Nothing said yet.',
  followers: 'Nobody follows them yet.',
  following: 'They are not following anyone yet.',
};

/**
 * A comment body as one line of plain text.
 *
 * Rendered as a TEXT node, never as HTML: these bodies are written by users, and
 * the composer already appends its own `<br><sup>replied to …</sup>` footer, so
 * "it is only our own markup" was never true here. Stripping tags and markdown
 * link syntax leaves the sentence the person actually wrote, which is the only
 * part a list row has space for anyway.
 */
function plainPreview(body) {
  return String(body || '')
    // The composer's own footer, CONTENT AND ALL: it appends
    // `<sup>replied to [0:34](…) on [preview.3speak.tv](…)</sup>` to every
    // reply, and merely stripping tags left the words "replied to 0:34 on
    // preview.3speak.tv" glued to the end of every preview. The row already
    // says what was replied to, above, and says it better.
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const when = (d) => (d ? new Date(d).toLocaleDateString() : '');

/**
 * The three tabs of a visitor's view of an incubating profile: what they have
 * said, who follows them, who they follow.
 *
 * All three read the incubation service through our own proxy, because none of
 * this is on chain and none of it is in the checker: an off-chain comment and a
 * follow of an account that does not exist yet live nowhere else.
 *
 * One tab is loaded at a time, when it is opened. Fetching all three up front
 * would put three requests on every profile view to fill two panels nobody
 * looked at.
 */
export default function IncubatingActivity({ handle, tab, onCount }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // author/permlink -> what they replied TO. Filled in after the comments
  // render, so the list never waits on a Hive round trip to appear.
  const [parents, setParents] = useState(new Map());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    LOADERS[tab](handle)
      .then((d) => {
        if (!alive) return;
        setItems(d.items || []);
        if (typeof d.total === 'number') onCount?.(tab, d.total);
      })
      .catch(() => { if (alive) setError('Could not load that.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // onCount is deliberately out: the parent passes a fresh closure on every
    // render, and including it would refetch the tab in a loop.
  }, [handle, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // What each comment was a reply to, so a row can say "on «Single hand rows»"
  // instead of "on @meno".
  //
  // ONE request for the whole tab: batchGetContent sends the lot as a single
  // batched JSON-RPC call, and the pairs are de-duplicated first, so five
  // replies to the same video cost one lookup rather than five. Anything Hive
  // does not have -- a reply to another incubating user's off-chain post -- is
  // simply absent from the map and the row falls back to the permlink. The link
  // still works either way: the watch page reads Hive and falls back to the
  // incubation service.
  useEffect(() => {
    if (tab !== 'comments' || items.length === 0) return undefined;
    const pairs = [...new Map(
      items
        .filter((c) => c.parentAuthor && c.parentPermlink)
        .map((c) => [`${c.parentAuthor}/${c.parentPermlink}`,
          { author: c.parentAuthor, permlink: c.parentPermlink }]),
    ).values()];
    if (pairs.length === 0) return undefined;

    let alive = true;
    (async () => {
      let onChain = new Map();
      try {
        onChain = await batchGetContent(pairs);
      } catch {
        /* titles are a nicety; the rows and their links work without them */
      }
      if (!alive) return;
      // Painted as soon as Hive answers, rather than held back for the second
      // pass below: most parents resolve here, and the off-chain ones filling
      // in a moment later is a better page than a blank one that waits.
      setParents(onChain);

      // Whatever Hive did not have is either a reply to another incubating
      // user's off-chain post -- which is most of them on this page, because
      // incubating users mostly talk to each other -- or a post that has since
      // been deleted. The first kind IS resolvable, and grouped by author it
      // costs one request per author instead of one per post.
      const missing = [...new Set(
        pairs.filter((p) => !onChain.has(`${p.author}/${p.permlink}`)).map((p) => p.author),
      )].slice(0, MAX_OFFCHAIN_AUTHORS);
      if (missing.length === 0) return;

      const merged = new Map(onChain);
      await Promise.all(missing.map(async (author) => {
        try {
          const d = await fetchIncubationUserContent(author);
          for (const post of d.items || []) {
            // No thumbnail in this payload; the row's placeholder keeps the
            // same shape a loaded one would, so nothing reflows.
            merged.set(`${author}/${post.permlink}`, { title: post.title || '', image: null });
          }
        } catch {
          /* 404 here just means that author is not one of ours */
        }
      }));
      if (alive) setParents(merged);
    })();

    return () => { alive = false; };
  }, [tab, items]);

  if (loading) return <p className="desc">Loading…</p>;
  if (error) return <p className="desc">{error}</p>;
  if (items.length === 0) return <p className="desc">{EMPTY[tab]}</p>;

  if (tab === 'comments') {
    return (
      <ul className="inc-activity">
        {items.map((c) => {
          const key = `${c.parentAuthor}/${c.parentPermlink}`;
          const parent = c.parentAuthor && c.parentPermlink ? parents.get(key) : null;
          return (
            <li key={c.permlink} className="inc-activity-row inc-comment">
              {/* The thing they replied to, on top: a comment out of context is
                  half a sentence, and the whole reason somebody opens this tab
                  is to see what this person engages with. */}
              {c.parentAuthor && c.parentPermlink && (
                <Link to={`/watch?v=${key}`} className="inc-comment-parent">
                  {parent?.image
                    ? <img src={parent.image} alt="" loading="lazy" />
                    : <span className="inc-comment-thumb-blank" aria-hidden="true" />}
                  <span className="inc-comment-parent-text">
                    {/* The permlink is the fallback, not an empty box: it is
                        the slug of a real title and reads close enough. */}
                    <span className="inc-comment-title">{parent?.title || c.parentPermlink}</span>
                    <span className="inc-comment-author">@{c.parentAuthor}</span>
                  </span>
                </Link>
              )}
              <p className="inc-comment-body">{plainPreview(c.body)}</p>
              <p className="inc-activity-meta">
                {when(c.createdAt)}
                {c.published && c.publishedAs ? ' · published to Hive' : ''}
              </p>
            </li>
          );
        })}
      </ul>
    );
  }

  // Followers and following are the same row: a name that links to a profile.
  return (
    <ul className="inc-activity inc-activity--people">
      {items.map((f) => (
        <li key={`${f.name}-${f.since}`} className="inc-activity-row">
          <Link to={`/@${f.name}`} className="inc-activity-name">@{f.name}</Link>
          {/* Only on followers, and only for the ones who are already on Hive:
              it is the interesting half of the answer. Somebody incubating
              being followed by real accounts says something a raw count does
              not. */}
          {f.kind === 'hive' && <span className="inc-activity-tag">on Hive</span>}
          <span className="inc-activity-meta">{when(f.since)}</span>
        </li>
      ))}
    </ul>
  );
}
