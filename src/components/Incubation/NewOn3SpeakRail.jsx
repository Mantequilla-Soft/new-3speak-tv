import { useEffect, useMemo, useState } from 'react';
import Card3 from '../Cards/Card3';
import { fetchIncubationFeed } from '../../lib/incubation';
import { useAppStore } from '../../lib/store';
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
  // Their own posts are not a discovery: this rail exists to put NEW people in
  // front of everyone else, and seeing yourself in it is both useless and a
  // little odd on a row that asks for a warm welcome.
  const incubationHandle = useAppStore((s) => s.incubationHandle);

  useEffect(() => {
    let alive = true;
    fetchIncubationFeed(limit)
      .then(d => {
        if (!alive) return;
        const mine = incubationHandle ? String(incubationHandle).toLowerCase() : null;
        setItems((d.items || []).filter((i) => {
          const who = i.author?.handle || i.handle;
          if (!who) return false;
          return !mine || String(who).toLowerCase() !== mine;
        }));
      })
      .catch(() => { /* the section is optional; the feed must not depend on it */ });
    return () => { alive = false; };
  }, [limit, incubationHandle]);

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
        <p>New here, not on Hive yet. These posts live on 3Speak. Give them a warm welcome before they join Hive.</p>
      </header>
      <Card3 videos={videos} />
    </section>
  );
}
