import { useEffect, useMemo, useState } from 'react';
import Card3 from '../Cards/Card3';
import { fetchIncubationFeed } from '../../lib/incubation';
import './NewOn3SpeakRail.scss';

/**
 * Recent posts from people who are on 3Speak but not yet on Hive.
 *
 * Renders through Card3, the same card every other feed uses, so these get the
 * real thumbnail, duration pill, hover preview and layout rather than a
 * second card implementation that would drift from it.
 *
 * A LABELLED SECTION, deliberately, rather than interleaving into the ranked
 * feed. This content has not been through the same gates, and it has no votes,
 * views or payout to rank on — interleaving would mean inventing scores, and an
 * invented score is a thumb on the scale nobody can reason about later. A
 * heading shows the content without implying the ranking vouched for it.
 *
 * Renders NOTHING when there is nothing to show, so it costs one empty request
 * and no layout until incubating users actually exist.
 */
export default function NewOn3SpeakRail({ limit = 8 }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    fetchIncubationFeed(limit)
      .then(d => { if (alive) setItems((d.items || []).filter(i => i.author?.handle || i.handle)); })
      .catch(() => { /* the section is optional; the feed must not depend on it */ });
    return () => { alive = false; };
  }, [limit]);

  // Card3 reads author/permlink/title/thumbnail/duration/created, so the shape
  // it wants is the shape it gets. `_incubation` marks these as off-chain for
  // anything downstream that needs to know.
  const videos = useMemo(() => items.map(it => ({
    author: it.author?.handle || it.handle,
    permlink: it.permlink,
    title: it.title || '',
    thumbnail: it.thumbnail || null,
    duration: it.duration || 0,
    created: it.created,
    _incubation: true,
  })), [items]);

  if (!videos.length) return null;

  return (
    <section className="new3s-rail" aria-label="New on 3Speak">
      <header className="new3s-rail-head">
        <h3>Just getting started</h3>
        <p>New here, not on Hive yet. These posts live on 3Speak.</p>
      </header>
      <Card3 videos={videos} />
    </section>
  );
}
