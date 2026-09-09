import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchIncubationFeed, handleAvatar } from '../../lib/incubation';
import './NewOn3SpeakRail.scss';

/**
 * Recent posts from people who are on 3Speak but not yet on Hive.
 *
 * A LABELLED RAIL, deliberately, rather than mixing these into the ranked feed.
 * Two reasons, and both matter:
 *
 *  - This content has not been through the same gates as everything else. The
 *    ranked feed is where trust is spent; a rail with its own heading is where
 *    it is earned. Nothing here is hidden, it is just not presented as though a
 *    ranking system vouched for it.
 *  - These posts have no votes, no payout and no view history, so they have
 *    nothing the ranking pipeline actually ranks on. Interleaving them would
 *    mean inventing scores for them, and an invented score is a thumb on the
 *    scale that nobody can later reason about.
 *
 * Renders NOTHING when there is nothing to show, so it costs an empty request
 * and no layout until incubating users actually exist.
 */
export default function NewOn3SpeakRail({ limit = 8 }) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let alive = true;
    fetchIncubationFeed(limit)
      .then(d => { if (alive) setItems((d.items || []).filter(i => i.author?.handle)); })
      .catch(() => { /* the rail is optional; the feed must not depend on it */ });
    return () => { alive = false; };
  }, [limit]);

  if (!items.length) return null;

  return (
    <section className="new3s-rail" aria-label="New on 3Speak">
      <header className="new3s-rail-head">
        <h3>Just getting started</h3>
        <p>New here, not on Hive yet. These posts live on 3Speak.</p>
      </header>
      <ul className="new3s-rail-list">
        {items.map(item => (
          <li key={`${item.handle}/${item.permlink}`} className="new3s-card">
            <Link to={`/p/${item.author.handle}`} className="new3s-card-author">
              <img src={handleAvatar(item.author.handle)} alt="" />
              <span>@{item.author.handle}</span>
            </Link>
            <p className="new3s-card-title">{item.title || '(untitled)'}</p>
            <p className="new3s-card-date">
              {item.created ? new Date(item.created).toLocaleDateString() : ''}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
