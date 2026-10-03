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
import { useTranslation, Trans } from 'react-i18next';
import { formatDate } from '../../i18n';
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
function friendlyError(detail, t) {
  if (isRcError(detail)) {
    return t('incubation.backfill.rcError');
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
function dayLabel(key, t) {
  const d = new Date(`${key}T00:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  const today = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(today) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return t('incubation.backfill.today');
  if (diffDays === 1) return t('incubation.backfill.yesterday');
  return formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' });
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
  { id: 'video', titleKey: 'incubation.backfill.groups.video', Icon: FaFilm, match: i => i.contentType === 'video',
    noteKey: 'incubation.backfill.groups.videoNote' },
  { id: 'short', titleKey: 'incubation.backfill.groups.short', Icon: FaBolt, match: i => i.contentType === 'short' },
  { id: 'comment', titleKey: 'incubation.backfill.groups.comment', Icon: FaRegCommentDots, match: i => i.contentType === 'comment' },
  { id: 'vote', titleKey: 'incubation.backfill.groups.vote', Icon: FaThumbsUp, match: i => i.type === 'vote' },
  { id: 'follow', titleKey: 'incubation.backfill.groups.follow', Icon: FaUserPlus, match: i => i.type === 'follow' },
];

const STATUS_KEY = {
  done: 'incubation.backfill.status.done',
  publishing: 'incubation.backfill.status.publishing',
  error: 'incubation.backfill.status.error',
  idle: 'incubation.backfill.status.idle',
};

function fmtWait(ms, t) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? t('incubation.backfill.wait.ms', { m, s: s % 60 }) : t('incubation.backfill.wait.s', { s });
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
  const { t } = useTranslation();
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
    if (rest.length) out.push({ id: 'other', titleKey: 'incubation.backfill.groups.other', Icon: FaCheck, rows: rest });
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
      title: key === 'unknown' ? t('incubation.backfill.noDate') : dayLabel(key, t),
      Icon: FaRegClock,
      rows: buckets.get(key).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    }));
  }, [items, t]);

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
        setErrors(prev => ({ ...prev, [item.id]: friendlyError(detail, t) }));
        // A refusal for RC is not a per-item problem: everything after it will
        // fail the same way, so re-read and let the banner explain.
        if (isRcError(detail)) refreshRc();
      }
      if (s === 'waiting') {
        setWait(detail);
        setStatus(prev => ({ ...prev, [item.id]: undefined }));
        toast.info(t('incubation.backfill.waitToast', { wait: fmtWait(detail, t) }));
      }
    });
    setRunning(false);
    refreshRc();
    if (published) {
      toast.success(t('incubation.backfill.publishedToast', { count: published }));
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
        <p className="desc">{t('incubation.backfill.loading')}</p>
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
          <h2>{t('incubation.backfill.emptyTitle')}</h2>
          <p className="desc">
            {t('incubation.backfill.emptyText')}
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
        <h2>{t('incubation.backfill.title')}</h2>
        <p className="desc">
          <Trans i18nKey="incubation.backfill.intro" values={{ user }} components={{ b: <strong /> }} />
        </p>
        </div>
      </header>

      {/* The cost, stated before they click rather than discovered as errors.
          Both limits are consensus rules, not our policy. */}
      <div className="backfill-note">
        <Trans i18nKey="incubation.backfill.note" components={{ b: <strong /> }} />
      </div>

      {/* Sticky: the list is long enough to scroll past, and the count and the
          publish button are what the reader is scrolling in service of. */}
      <div className="backfill-modes" role="tablist" aria-label={t('incubation.backfill.groupBy')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'day'}
          className={`backfill-mode${mode === 'day' ? ' is-on' : ''}`}
          onClick={() => chooseMode('day')}
        >
          <FaRegClock aria-hidden="true" /> {t('incubation.backfill.timeline')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'type'}
          className={`backfill-mode${mode === 'type' ? ' is-on' : ''}`}
          onClick={() => chooseMode('type')}
        >
          <FaLayerGroup aria-hidden="true" /> {t('incubation.backfill.byType')}
        </button>
      </div>

      {rcBlocked ? (
        <div className="backfill-rc">
          {rcWait
            ? <Trans i18nKey="incubation.backfill.rcBlockedIn" values={{ wait: rcWait }} components={{ b: <strong /> }} />
            : <Trans i18nKey="incubation.backfill.rcBlockedLater" components={{ b: <strong /> }} />}
        </div>
      ) : (
      <div className="backfill-bar">
        <div className="backfill-bar-count">
          <Trans i18nKey="incubation.backfill.selected" values={{ count: chosen.length }} components={{ b: <strong /> }} />
          {chosenRootPosts > 1 && (
            <span className="backfill-bar-sub">
              {t('incubation.backfill.rootPostsTime', { count: chosenRootPosts, minutes: chosenRootPosts * 5 })}
            </span>
          )}
          {wait > 0 && (
            <span className="backfill-bar-sub">
              {t('incubation.backfill.nextVideo', { wait: fmtWait(wait, t) })}
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
            {t('incubation.backfill.selectAll')}
          </button>
          <button
            type="button"
            className="btn-ghost btn-small"
            onClick={() => setSelected(new Set())}
            disabled={running || !selected.size}
          >
            {t('incubation.backfill.clear')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={run}
            disabled={running || !chosen.length}
          >
            {running ? t('incubation.backfill.status.publishing') : t('incubation.backfill.publishSelected')}
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
              <h3>{group.titleKey ? t(group.titleKey) : group.title}</h3>
              <span className="backfill-group-count">{group.rows.length}</span>
              {group.noteKey && <span className="backfill-group-note">{t(group.noteKey)}</span>}
              {selectable.length > 0 && (
                <button
                  type="button"
                  className="btn-ghost btn-small backfill-group-all"
                  onClick={() => setGroup(selectable, !allOn)}
                  disabled={running}
                >
                  {allOn ? t('incubation.backfill.clear') : t('incubation.backfill.selectAll')}
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
                        aria-label={t('incubation.backfill.selectItem', { label: item.label })}
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
                          {item.isRootPost && <span className="backfill-tag">{t('incubation.backfill.fiveMin')}</span>}
                        </span>
                        {errors[item.id] && (
                          <span className="backfill-row-error">{errors[item.id]}</span>
                        )}
                      </span>
                      <span className={`backfill-status is-${st}`}>
                        {done && <FaCheck aria-hidden="true" />}
                        {t(STATUS_KEY[st])}
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
  const { t } = useTranslation();
  return (
    <div className="backfill-excluded">
      <h3>{t('incubation.backfill.waitingTitle')}</h3>
      <p className="desc">
        {t('incubation.backfill.waitingText')}
      </p>
      <ul>
        {waiting.slice(0, 10).map(w => (
          <li key={w.id}>
            <Trans i18nKey="incubation.backfill.waitingFor" values={{ label: w.label, target: w.waitingFor }} components={{ b: <strong /> }} />
          </li>
        ))}
        {waiting.length > 10 && <li>{t('incubation.backfill.andMore', { count: waiting.length - 10 })}</li>}
      </ul>
    </div>
  );
}

/* Said out loud rather than left as an absence. Someone who cast 40 likes will
   notice they are gone and should not have to guess why. */
function Excluded({ excluded }) {
  const { t } = useTranslation();
  return (
    <div className="backfill-excluded">
      <h3>{t('incubation.backfill.excludedTitle')}</h3>
      <ul>
        {excluded.map(e => (
          <li key={e.type}>
            <strong>{e.type === 'vote' ? t('incubation.graduation.items.like', { count: e.count }) : `${e.count} ${e.type}`}</strong>
            {' — '}{e.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
