import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FaFilm, FaBolt, FaRegCommentDots, FaThumbsUp, FaUserPlus, FaCheck, FaRegClock, FaLayerGroup,
  FaCloudUploadAlt,
} from 'react-icons/fa';
import BarLoader from '../Loader/BarLoader';
import HiveAvatar from '../HiveAvatar/HiveAvatar';
import { toastIn } from '../../utils/toast';
import { checkPostingRc, formatDuration } from '../../utils/rcCheck';
import { useAppStore } from '../../lib/store';
import {
  fetchBackfillItems, publishBackfill, rootPostWaitMs, claimAssetsOnce
} from '../../lib/incubation';
import './BackfillTable.scss';

const toast = toastIn('Publish to Hive');


/**
 * Is this failure the chain saying "you cannot afford it yet"?
 *
 * Hive refuses on resource credits with an assert that means nothing to a
 * reader: "Account: x has 0 RC, needs 4 RC. Please wait to transact...". Match
 * on RC in the shapes the node and the wallets wrap it in before it reaches us.
 */
function isRcError(detail) {
  return /\brc\b|resource credit|insufficient.*mana/i.test(String(detail || ''));
}

/** The same failure, said to a person. */
function friendlyError(detail) {
  if (isRcError(detail)) {
    return 'Not enough resource credits yet. They refill on their own; try again shortly.';
  }
  return detail;
}


/**
 * Where a row can be previewed, or null for the ones with nothing to open.
 *
 * These posts are not on Hive yet -- that is the whole point of this page -- so
 * the link points at 3Speak's own view of the off-chain copy, which resolves by
 * the account name the post was made under. After graduation that name IS the
 * Hive username, because graduation creates the account from the handle.
 */
function previewHref(item, username) {
  if (!username || !item?.permlink) return null;
  if (item.contentType === 'video') return `/watch?v=${username}/${item.permlink}`;
  if (item.contentType === 'short') return `/shorts?v=${username}/${item.permlink}`;
  return null;   // a reply or a like has no page of its own worth opening
}

const MODE_KEY = 'backfill_group_mode';

/** "Today" / "Yesterday" / "4 September 2026" for a YYYY-MM-DD key. */
function dayLabel(key) {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  const today = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(today) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}

/**
 * The sections of the page, in the order somebody would think about them.
 *
 * Grouped rather than listed because the decision is not row by row: "do I want
 * my videos on my record" is one question asked once, and a flat table made the
 * reader re-derive the grouping in their head on every line. It also stops the
 * expensive thing hiding among the cheap ones -- videos are the only rows that
 * cost five minutes each, and now they sit together under a heading that says
 * so.
 *
 * `match` reads `contentType` for content, which the server derives from the
 * post's own envelope. A short is stored as a reply to the @peak.snaps
 * container, so anything keying off `kind` files shorts under comments.
 */
const GROUPS = [
  { id: 'video', title: 'Videos', Icon: FaFilm, match: i => i.contentType === 'video',
    note: 'One every 5 minutes — this is the slow part.' },
  { id: 'short', title: 'Shorts', Icon: FaBolt, match: i => i.contentType === 'short' },
  { id: 'comment', title: 'Comments', Icon: FaRegCommentDots, match: i => i.contentType === 'comment' },
  { id: 'vote', title: 'Likes', Icon: FaThumbsUp, match: i => i.type === 'vote' },
  { id: 'follow', title: 'Follows', Icon: FaUserPlus, match: i => i.type === 'follow' },
];

const STATUS_TEXT = {
  done: 'Published',
  publishing: 'Publishing…',
  error: 'Failed',
  idle: 'On 3Speak only',
};

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
  // Rows that WILL publish, but not until the thing they answer is up.
  const [waiting, setWaiting] = useState([]);
  // Timeline by default. Remembered, because which view suits you is a standing
  // preference, not a per-visit decision.
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) === 'type' ? 'type' : 'day'; } catch { return 'day'; }
  });
  const chooseMode = (next) => {
    setMode(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* private mode */ }
  };

  const [selected, setSelected] = useState(() => new Set());
  const [status, setStatus] = useState({});      // id -> 'publishing'|'done'|'error'
  const [errors, setErrors] = useState({});
  // Resource credits. A brand new account has very few, and publishing spends
  // them — so the honest thing is to say so BEFORE the button is pressed rather
  // than after a broadcast comes back with "Broadcast failed".
  const [rc, setRc] = useState(null);
  const refreshRc = useCallback(() => {
    if (!user) return;
    checkPostingRc(user).then(setRc).catch(() => setRc(null));
  }, [user]);
  useEffect(() => { refreshRc(); }, [refreshRc]);
  const [running, setRunning] = useState(false);
  const [wait, setWait] = useState(rootPostWaitMs());
  const timer = useRef(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      // Also here, not only in the prompt: someone can reach this page directly
      // without the prompt ever having run.
      claimAssetsOnce().catch(() => { /* not fatal to listing the backlog */ });
      const data = await fetchBackfillItems();
      setItems(data.items || []);
      setExcluded(data.excluded || []);
      setWaiting(data.waiting || []);
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

  // Items in their sections, empty sections dropped. The trailing catch-all is
  // not decoration: if this service ever grows an op type the list above does
  // not name, the rows still appear somewhere instead of silently vanishing
  // from the one screen that decides what gets published.
  const byType = useMemo(() => {
    const seen = new Set();
    const out = GROUPS.map(g => {
      const rows = items.filter(i => g.match(i));
      rows.forEach(r => seen.add(r.id));
      return { ...g, rows };
    }).filter(g => g.rows.length > 0);
    const rest = items.filter(i => !seen.has(i.id));
    if (rest.length) out.push({ id: 'other', title: 'Everything else', Icon: FaCheck, rows: rest });
    return out;
  }, [items]);

  /**
   * The same rows as a timeline, one section per day, oldest first.
   *
   * This is the default because it is the order the work actually happened in,
   * and the order it will be republished in. Grouping by type answers "how many
   * comments do I have"; grouping by day answers "what did I do here", which is
   * the question somebody deciding what goes on their permanent record is
   * really asking.
   */
  const byDay = useMemo(() => {
    const buckets = new Map();
    for (const item of items) {
      const d = item.createdAt ? new Date(item.createdAt) : null;
      const key = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : 'unknown';
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(item);
    }
    // Undated rows last: they are the odd ones, not the beginning of the story.
    const keys = [...buckets.keys()].sort((a, b) => (
      a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b)
    ));
    return keys.map(key => ({
      id: key,
      title: key === 'unknown' ? 'No date' : dayLabel(key),
      Icon: FaRegClock,
      rows: buckets.get(key).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    }));
  }, [items]);

  const grouped = mode === 'day' ? byDay : byType;

  // Only a definite "cannot afford it" blocks. Unknown stays out of the way.
  const rcBlocked = !!rc && rc.unknown === false && rc.ok === false;
  const rcWait = rcBlocked && Number.isFinite(rc.secondsUntilEnough) && rc.secondsUntilEnough > 0
    ? formatDuration(rc.secondsUntilEnough)
    : null;

  // Select or clear a whole section: the unit people actually decide in.
  const setGroup = (rows, on) => setSelected(prev => {
    const next = new Set(prev);
    rows.forEach(r => {
      if (status[r.id] === 'done') return;
      if (on) next.add(r.id); else next.delete(r.id);
    });
    return next;
  });

  async function run() {
    if (!chosen.length || running) return;
    setRunning(true);
    setErrors({});
    let published = 0;
    await publishBackfill(chosen, (item, s, detail) => {
      setStatus(prev => ({ ...prev, [item.id]: s }));
      if (s === 'done') { published += 1; setWait(rootPostWaitMs()); }
      if (s === 'error') {
        setErrors(prev => ({ ...prev, [item.id]: friendlyError(detail) }));
        // A refusal for RC is not a per-item problem: everything after it will
        // fail the same way, so re-read and let the banner explain.
        if (isRcError(detail)) refreshRc();
      }
      if (s === 'waiting') {
        setWait(detail);
        setStatus(prev => ({ ...prev, [item.id]: undefined }));
        toast.info(`Hive allows one post every 5 minutes. Next one in ${fmtWait(detail)}.`);
      }
    });
    setRunning(false);
    refreshRc();
    if (published) {
      toast.success(published === 1 ? 'Published to Hive' : `Published ${published} items to Hive`);
      setSelected(new Set());
    }
  }

  // Both of these used to render bare, OUTSIDE the .backfill wrapper, so they
  // escaped the page's own centring and sat hard against the left edge with no
  // sign of which app they belonged to.
  if (state === 'loading') {
    return (
      <div className="backfill backfill-state">
        <BarLoader />
        <p className="desc">Loading your posts…</p>
      </div>
    );
  }
  if (state === 'error') {
    return (
      <div className="backfill backfill-state">
        <p className="backfill-error">{errors._load}</p>
      </div>
    );
  }

  if (state === 'empty') {
    return (
      <div className="backfill">
        <header className="backfill-hero">
          <span className="backfill-hero-icon is-done" aria-hidden="true">
            <FaCheck />
          </span>
          <div className="backfill-hero-text">
          <h2>Nothing left to publish</h2>
          <p className="desc">
            Everything you made before you had a Hive account has either been published
            or was not something that can be republished.
          </p>
          </div>
        </header>
        {excluded.length > 0 && <Excluded excluded={excluded} />}
        {waiting.length > 0 && <Waiting waiting={waiting} />}
      </div>
    );
  }

  return (
    <div className="backfill">
      <header className="backfill-hero">
        <span className="backfill-hero-icon" aria-hidden="true">
          <FaCloudUploadAlt />
        </span>
        <div className="backfill-hero-text">
        <h2>Publish what you made earlier</h2>
        <p className="desc">
          You made these on 3Speak before you had a Hive account, so they only exist here.
          Pick what you want on your public record as <strong>@{user}</strong> and publish it.
          Anything you leave stays on 3Speak exactly as it is.
        </p>
        </div>
      </header>

      {/* The cost, stated before they click rather than discovered as errors.
          Both limits are consensus rules, not our policy. */}
      <div className="backfill-note">
        <strong>Publishing takes a while, and that is normal.</strong> Hive allows one
        post every 5 minutes per account, and a brand new account has a small posting
        allowance that refills over a few days. Follows, likes and your profile are cheap
        and go through quickly. Publish a few at a time and come back.
      </div>

      {/* Sticky: the list is long enough to scroll past, and the count and the
          publish button are what the reader is scrolling in service of. */}
      <div className="backfill-modes" role="tablist" aria-label="Group the list by">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'day'}
          className={`backfill-mode${mode === 'day' ? ' is-on' : ''}`}
          onClick={() => chooseMode('day')}
        >
          <FaRegClock aria-hidden="true" /> Timeline
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'type'}
          className={`backfill-mode${mode === 'type' ? ' is-on' : ''}`}
          onClick={() => chooseMode('type')}
        >
          <FaLayerGroup aria-hidden="true" /> By type
        </button>
      </div>

      {rcBlocked ? (
        <div className="backfill-rc">
          <strong>Your account is out of resource credits for the moment.</strong>
          {' '}Hive gives every account a small allowance for posting, and it refills
          on its own. Nothing is lost: come back
          {rcWait ? ` in about ${rcWait}` : ' a little later'} and carry on where you
          left off.
        </div>
      ) : (
      <div className="backfill-bar">
        <div className="backfill-bar-count">
          <strong>{chosen.length}</strong> selected
          {chosenRootPosts > 1 && (
            <span className="backfill-bar-sub">
              {chosenRootPosts} videos, so this needs about {chosenRootPosts * 5} minutes
            </span>
          )}
          {wait > 0 && (
            <span className="backfill-bar-sub">
              Next video can go out in {fmtWait(wait)}. Follows, likes and profile are not affected.
            </span>
          )}
        </div>
        <div className="backfill-bar-actions">
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
          <button
            type="button"
            className="btn-primary"
            onClick={run}
            disabled={running || !chosen.length}
          >
            {running ? 'Publishing…' : 'Publish selected'}
          </button>
        </div>
      </div>
      )}

      {grouped.map(group => {
        const selectable = group.rows.filter(r => status[r.id] !== 'done');
        const allOn = selectable.length > 0 && selectable.every(r => selected.has(r.id));
        return (
          <section key={group.id} className="backfill-group">
            <header className="backfill-group-head">
              <group.Icon aria-hidden="true" />
              <h3>{group.title}</h3>
              <span className="backfill-group-count">{group.rows.length}</span>
              {group.note && <span className="backfill-group-note">{group.note}</span>}
              {selectable.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost btn-small backfill-group-all"
                  onClick={() => setGroup(selectable, !allOn)}
                  disabled={running}
                >
                  {allOn ? 'Clear' : 'Select all'}
                </button>
              )}
            </header>

            <ul className="backfill-rows">
              {group.rows.map(item => {
                const st = status[item.id] || 'idle';
                const done = st === 'done';
                return (
                  <li key={item.id} className={`backfill-row is-${st}`}>
                    {/* The whole row is the click target, not a 13px box. */}
                    <label className="backfill-row-inner">
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                        disabled={running || done}
                        aria-label={`Select ${item.label}`}
                      />
                      {/* A face beats another line of "Follow @name": the
                          decision is about a person, and people are recognised
                          by picture far faster than by handle. */}
                      {item.account && (
                        <HiveAvatar
                          username={item.account}
                          size="small"
                          className="backfill-row-avatar"
                          alt=""
                        />
                      )}
                      <span className="backfill-row-main">
                        {/* Videos and shorts link to themselves. Deciding what
                            belongs on a permanent record is hard from a title
                            alone, and until it is published this page is the
                            only way to reach the post at all.
                            stopPropagation: the whole row is a <label> that
                            toggles the checkbox, so a bare link would select the
                            row on the way out. */}
                        {previewHref(item, user) ? (
                          <Link
                            className="backfill-row-label is-link"
                            to={previewHref(item, user)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {item.label}
                          </Link>
                        ) : (
                          <span className="backfill-row-label">{item.label}</span>
                        )}
                        {/* What the reply actually said. "Reply to @someone" is
                            not enough to decide whether you want it on your
                            permanent record. */}
                        {item.excerpt && (
                          <span className="backfill-row-excerpt">{item.excerpt}</span>
                        )}
                        <span className="backfill-row-meta">
                          {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : '—'}
                          {item.isRootPost && <span className="backfill-tag">5 min</span>}
                        </span>
                        {errors[item.id] && (
                          <span className="backfill-row-error">{errors[item.id]}</span>
                        )}
                      </span>
                      <span className={`backfill-status is-${st}`}>
                        {done && <FaCheck aria-hidden="true" />}
                        {STATUS_TEXT[st]}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      {excluded.length > 0 && <Excluded excluded={excluded} />}
      {waiting.length > 0 && <Waiting waiting={waiting} />}
    </div>
  );
}

/* Different from Excluded, and the difference matters: these ARE coming, just
   not yet. A reply or a like aimed at another incubating user's post cannot be
   broadcast until that post exists on Hive, because the chain rejects an op
   whose parent is not there. Listing them as "not coming across" would be a
   lie; leaving them out entirely would look like data loss. */
function Waiting({ waiting }) {
  return (
    <div className="backfill-excluded">
      <h3>Waiting on someone else</h3>
      <p className="desc">
        These publish by themselves once the post they point at goes up on Hive.
        Nothing is lost in the meantime.
      </p>
      <ul>
        {waiting.slice(0, 10).map(w => (
          <li key={w.id}>
            <strong>{w.label}</strong>{' — waiting for '}{w.waitingFor}
          </li>
        ))}
        {waiting.length > 10 && <li>and {waiting.length - 10} more</li>}
      </ul>
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
