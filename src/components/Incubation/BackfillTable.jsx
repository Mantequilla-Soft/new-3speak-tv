import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import {
  fetchBackfillItems, publishBackfill, rootPostWaitMs, ROOT_POST_INTERVAL_MS
} from '../../lib/incubation';
import './BackfillTable.scss';

const toast = toastIn('Publish to Hive');

const TYPE_LABEL = { comment: 'Post', follow: 'Follow', profile: 'Profile' };

function fmtWait(ms) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

/**
 * The backlog a graduated user made before they had a Hive account, and a table
 * to publish it from.
 *
 * Selective on purpose. Most of what someone makes while finding their feet is
 * not what they want as the first thing on their permanent public record, and
 * publishing all of it is slow and expensive besides. So this is a table with
 * checkboxes and an honest account of the cost, not a "migrate everything"
 * button.
 */
export default function BackfillTable() {
  const user = useAppStore((s) => s.user);

  const [state, setState] = useState('loading'); // loading | ready | empty | error
  const [items, setItems] = useState([]);
  const [excluded, setExcluded] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [status, setStatus] = useState({});      // id -> 'publishing'|'done'|'error'
  const [errors, setErrors] = useState({});
  const [running, setRunning] = useState(false);
  const [wait, setWait] = useState(rootPostWaitMs());
  const timer = useRef(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const data = await fetchBackfillItems();
      setItems(data.items || []);
      setExcluded(data.excluded || []);
      // Pre-select nothing. Publishing is permanent and costs resource credits;
      // the user should say what goes on their record, not un-say it.
      setSelected(new Set());
      setState((data.items || []).length ? 'ready' : 'empty');
    } catch (err) {
      setErrors({ _load: err.message });
      setState('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live countdown for the chain's five-minute root-post interval.
  useEffect(() => {
    timer.current = setInterval(() => setWait(rootPostWaitMs()), 1000);
    return () => clearInterval(timer.current);
  }, []);

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const pending = useMemo(() => items.filter(i => status[i.id] !== 'done'), [items, status]);
  const chosen = useMemo(
    () => pending.filter(i => selected.has(i.id)),
    [pending, selected]
  );
  const chosenRootPosts = chosen.filter(i => i.isRootPost).length;

  async function run() {
    if (!chosen.length || running) return;
    setRunning(true);
    setErrors({});
    let published = 0;
    await publishBackfill(chosen, (item, s, detail) => {
      setStatus(prev => ({ ...prev, [item.id]: s }));
      if (s === 'done') { published += 1; setWait(rootPostWaitMs()); }
      if (s === 'error') setErrors(prev => ({ ...prev, [item.id]: detail }));
      if (s === 'waiting') {
        setWait(detail);
        setStatus(prev => ({ ...prev, [item.id]: undefined }));
        toast.info(`Hive allows one post every 5 minutes. Next one in ${fmtWait(detail)}.`);
      }
    });
    setRunning(false);
    if (published) {
      toast.success(published === 1 ? 'Published to Hive' : `Published ${published} items to Hive`);
      setSelected(new Set());
    }
  }

  if (state === 'loading') return <p className="desc">Loading your posts…</p>;
  if (state === 'error') return <p className="backfill-error">{errors._load}</p>;

  if (state === 'empty') {
    return (
      <div className="backfill">
        <h2>Nothing left to publish</h2>
        <p className="desc">
          Everything you made before you had a Hive account has either been published
          or was not something that can be republished.
        </p>
        {excluded.length > 0 && <Excluded excluded={excluded} />}
      </div>
    );
  }

  return (
    <div className="backfill">
      <h2>Publish what you made earlier</h2>
      <p className="desc">
        You made these on 3Speak before you had a Hive account, so they only exist here.
        Pick what you want on your public record as <strong>@{user}</strong> and publish it.
        Anything you leave stays on 3Speak exactly as it is.
      </p>

      {/* The cost, stated before they click rather than discovered as errors.
          Both limits are consensus rules, not our policy. */}
      <div className="backfill-note">
        <strong>Publishing takes a while, and that is normal.</strong> Hive allows one
        post every 5 minutes per account, and a brand new account has a small posting
        allowance that refills over a few days. Follows and your profile are cheap and
        go through quickly. Publish a few at a time and come back.
      </div>

      <div className="backfill-actions">
        <button
          type="button"
          className="btn-ghost btn-small"
          onClick={() => setSelected(new Set(pending.map(i => i.id)))}
          disabled={running}
        >
          Select all
        </button>
        <button
          type="button"
          className="btn-ghost btn-small"
          onClick={() => setSelected(new Set())}
          disabled={running || !selected.size}
        >
          Clear
        </button>
        <span className="backfill-count">
          {chosen.length} selected
          {chosenRootPosts > 1 && ` · ${chosenRootPosts} posts, so this needs ${chosenRootPosts * 5} minutes`}
        </span>
        <button
          type="button"
          className="btn-primary"
          onClick={run}
          disabled={running || !chosen.length}
        >
          {running ? 'Publishing…' : 'Publish selected'}
        </button>
      </div>

      {wait > 0 && (
        <p className="backfill-wait">
          Next post can go out in {fmtWait(wait)}. Follows and profile updates are not affected.
        </p>
      )}

      <table className="backfill-table">
        <thead>
          <tr>
            <th aria-label="Select" />
            <th>What</th>
            <th>Kind</th>
            <th>Made</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {items.map(item => {
            const s = status[item.id];
            return (
              <tr key={item.id} className={s === 'done' ? 'is-done' : s === 'error' ? 'is-error' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                    disabled={running || s === 'done'}
                    aria-label={`Select ${item.label}`}
                  />
                </td>
                <td className="backfill-what">
                  {item.label}
                  {errors[item.id] && <span className="backfill-row-error">{errors[item.id]}</span>}
                </td>
                <td>
                  {item.detail || TYPE_LABEL[item.type] || item.type}
                  {item.isRootPost && <span className="backfill-tag">5 min</span>}
                </td>
                <td>{item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}</td>
                <td>
                  {s === 'done' ? 'Published'
                    : s === 'publishing' ? 'Publishing…'
                      : s === 'error' ? 'Failed'
                        : 'On 3Speak only'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {excluded.length > 0 && <Excluded excluded={excluded} />}
    </div>
  );
}

/* Said out loud rather than left as an absence. Someone who cast 40 likes will
   notice they are gone and should not have to guess why. */
function Excluded({ excluded }) {
  return (
    <div className="backfill-excluded">
      <h3>Not coming across</h3>
      <ul>
        {excluded.map(e => (
          <li key={e.type}>
            <strong>{e.count} {e.type === 'vote' ? (e.count === 1 ? 'like' : 'likes') : e.type}</strong>
            {' — '}{e.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
