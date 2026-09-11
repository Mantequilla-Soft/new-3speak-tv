import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MdCheckCircle, MdRadioButtonUnchecked, MdExpandMore } from 'react-icons/md';
import {
  FaRocket, FaVideo, FaMobileAlt, FaComments, FaUserPlus, FaClock,
} from 'react-icons/fa';
import {
  fetchIncubationProgress, progressHue, progressFraction, onIncubationProgress,
} from '../../lib/incubation';

/* The goals panel, as its own component so that refreshing it refreshes IT.
 *
 * It used to be inline in IncubatingProfile, which meant the progress state
 * lived at the top of the page: every refresh re-rendered the header, the feed
 * and every card in it, so a bar that moved by two percent visibly reloaded the
 * whole profile. Owning its own state keeps a refresh inside these few hundred
 * pixels, which is all that has actually changed.
 */

const TASK_COPY = {
  video: {
    Icon: FaVideo,
    label: 'Upload a video',
    hint: 'Share something about you and what your channel will be about.',
    why: 'This is the first thing the team looks at when they review you, and the first thing a visitor sees when they open your channel.',
    counts: [
      'Any video you publish from the upload studio.',
      'It stays yours. When you are upgraded you pick which of these posts get published to Hive under your own name.',
    ],
    cta: { label: 'Upload a video', to: '/embed-studio' },
  },
  short: {
    Icon: FaMobileAlt,
    label: 'Post 2 shorts',
    hint: 'Participate in 3Speak Shorts and upload some moments of your daily life or some stories you want to share.',
    why: 'Shorts are the fastest way to be found. They play in a feed of creators people do not follow yet, so a short reaches past your own channel.',
    counts: [
      'Vertical videos posted from the shorts uploader.',
      'Two of them, on any subject you like.',
    ],
    cta: { label: 'Post a short', to: '/embed-studio?from=shorts' },
  },
  follow: {
    Icon: FaUserPlus,
    label: 'Follow 5 creators',
    hint: 'Build up a network of likeminded people, or creators you find exciting.',
    why: 'Your following list is what turns the home feed into your feed. It travels with you to Hive when you are upgraded.',
    counts: [
      'Five creators you follow right now.',
      'Unfollowing someone lowers the count again, so this tracks who you actually follow rather than how many buttons you pressed.',
    ],
    cta: { label: 'Find creators', to: '/discover' },
  },
  // No hint here: this one states the length floor, which is the server's
  // number, so it is built in taskHint below rather than written twice. Its
  // "what counts" list is built in taskCounts for the same reason.
  comment: {
    Icon: FaComments,
    label: 'Write 10 comments',
    why: 'Comments are how people find you before you have an audience. One real reply under somebody else\u2019s video will do more for you than an upload nobody has seen yet.',
    cta: { label: 'Find something to reply to', to: '/discover' },
  },
  watch: {
    Icon: FaClock,
    label: 'Watch an hour on 3Speak',
    hint: 'Any videos. Counted while you are really watching.',
    why: 'The hour says you are here as a viewer and not only as an uploader. It is the goal most people finish without trying.',
    counts: [
      'Time on 3Speak itself. The same video embedded on another site cannot count.',
      'Once per video. Rewatching one raises its best time, it never adds to it, and no single video can supply the whole hour on its own.',
      'Real playing time, so speeding a video up is not punished and slowing it down does not stretch the hour.',
      'On screen. A video left playing in a background tab does not build the hour.',
      'Not your own videos.',
      'Nothing is recorded while you watch in private mode.',
    ],
    cta: { label: 'Watch something', to: '/' },
  },
};

/**
 * Seconds as a duration a person would say out loud.
 *
 * Driven by the task's `unit`, not by its name, so the server decides which
 * numbers are durations and this only decides how they read.
 */
function asDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/**
 * The line under a task's name.
 *
 * The comment floor lives on the task itself rather than in fine print below
 * the list: it is the rule that decides whether a comment counts, and someone
 * reading "1/5" needs it right there, not in a footnote they have already
 * scrolled past.
 */
function taskHint(t, minCommentChars) {
  if (t.type === 'comment' && minCommentChars > 0) {
    return `Comments count once they are at least ${minCommentChars} characters. A real thought, not just “nice”.`;
  }
  return TASK_COPY[t.type]?.hint || '';
}

/**
 * The "what counts" bullets for one task.
 *
 * Comment rules are assembled here rather than sitting in TASK_COPY because
 * they quote the server's length floor, and because both of them are rules the
 * server actually enforces in the query -- someone who has written five replies
 * under their own video and sees 0/10 deserves to be able to find out why.
 */
function taskCounts(t, minCommentChars) {
  if (t.type === 'comment') {
    return [
      minCommentChars > 0
        ? `At least ${minCommentChars} characters of your own words.`
        : 'A real thought rather than a single word.',
      'On somebody else\u2019s post. Replies under your own videos, or to your own comments, are a conversation with yourself and do not count.',
    ];
  }
  return TASK_COPY[t.type]?.counts || [];
}

/** How far along one task is, 0-100, for the fill behind its card. */
function taskPct(t) {
  if (!t.need) return 0;
  return Math.max(0, Math.min(100, (t.have / t.need) * 100));
}

function taskAmount(t) {
  if (t.unit !== 'seconds') return `${Math.min(t.have, t.need)}/${t.need}`;
  return `${asDuration(Math.min(t.have, t.need))} / ${asDuration(t.need)}`;
}

// Remembered per browser so the list does not spring open on every visit once
// someone has folded it away. Open is the default: it is the point of the page
// the first time you land on it.
const OPEN_KEY = 'inc_progress_open';

function readOpen() {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
}

export default function IncubationProgressPanel() {
  const [progress, setProgress] = useState(null);
  const [tasksOpen, setTasksOpen] = useState(readOpen);
  // Which goals have their detail open. Several may be, and it is session-only
  // on purpose: folding the whole list away is a standing preference worth
  // remembering, opening one goal is a question you have finished asking.
  const [openTasks, setOpenTasks] = useState(() => new Set());

  useEffect(() => {
    let alive = true;
    const load = () => fetchIncubationProgress()
      .then((p) => { if (alive) setProgress(p); })
      .catch(() => { /* the page still works without it */ });
    load();
    // Re-read when a write says a goal may have moved, rather than making the
    // user reload to see the bar catch up. Only this subtree re-renders.
    const off = onIncubationProgress(load);
    return () => { alive = false; off(); };
  }, []);

  const toggleTask = useCallback((type) => {
    setOpenTasks((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  function toggleTasks() {
    setTasksOpen((wasOpen) => {
      const next = !wasOpen;
      try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }

  if (!progress) return null;

  const doneCount = progress.tasks.filter((t) => t.done).length;
  const totalTasks = progress.tasks.length;
  // Each goal is worth an equal share and partial progress inside one counts, so
  // the bar creeps forward as they go rather than jumping a fifth at a time.
  const filled = progressFraction(progress.tasks);

  return (
    <section className="inc-panel inc-progress">
      <header>
        <h2><FaRocket size={14} aria-hidden="true" /> Your path to a Hive account</h2>
        <span
          className="inc-progress-count"
          style={{ '--bar-hue': progressHue(filled) }}
        >
          {doneCount} of {totalTasks} done
        </span>
      </header>
      {/* The bar stays put whatever the list does: it is the one thing
          worth seeing at a glance, and collapsing it would leave the
          panel saying nothing. */}
      {/* One bar, filled to the SAME proportional figure the pill in
          the nav shows: five goals, a fifth each, and a part-finished
          goal counts for its part. So a single comment lengthens it.
          It is drawn as one track rather than five because five stubs
          read as five separate errands instead of one journey. */}
      <div
        className="inc-progress-bar"
        role="progressbar"
        aria-label="Overall progress"
        aria-valuenow={Math.round(filled * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <span
          style={{
            width: `${Math.min(100, filled * 100)}%`,
            '--bar-hue': progressHue(filled),
          }}
        />
      </div>

      <button
        type="button"
        className={`inc-tasks-toggle${tasksOpen ? ' is-open' : ''}`}
        onClick={toggleTasks}
        aria-expanded={tasksOpen}
        aria-controls="inc-task-list"
      >
        <MdExpandMore size={18} aria-hidden="true" />
        {tasksOpen ? 'Hide the details' : 'Show what is left'}
      </button>

      {tasksOpen && (
        <div id="inc-task-list">
          <ul className="inc-tasks">
            {progress.tasks.map((t) => {
              const copy = TASK_COPY[t.type] || {};
              const Icon = copy.Icon;
              const open = openTasks.has(t.type);
              const counts = taskCounts(t, progress.minCommentChars);
              return (
                <li
                  key={t.type}
                  className={`${t.done ? 'is-done' : ''}${open ? ' is-open' : ''}`.trim()}
                  // Read by the fill behind the card, so "2 of 5" is
                  // visible as a quantity and not only as a number.
                  style={{ '--task-fill': `${taskPct(t)}%` }}
                >
                  {/* The whole row is the control, not just the
                      chevron: a 18px target is a poor one on a phone,
                      and the row already reads as a single thing. */}
                  <button
                    type="button"
                    className="inc-task-head"
                    onClick={() => toggleTask(t.type)}
                    aria-expanded={open}
                    aria-controls={`inc-task-${t.type}`}
                  >
                    {t.done ? <MdCheckCircle size={20} className="inc-task-icon done" />
                      : <MdRadioButtonUnchecked size={20} className="inc-task-icon" />}
                    <span className="inc-task-text">
                      <strong>
                        {Icon ? <Icon size={12} aria-hidden="true" /> : null}
                        {copy.label || t.type}
                      </strong>
                      <span>{taskHint(t, progress.minCommentChars)}</span>
                    </span>
                    <span className="inc-task-count">{taskAmount(t)}</span>
                    <MdExpandMore size={18} className="inc-task-chevron" aria-hidden="true" />
                  </button>

                  {open && (
                    <div className="inc-task-detail" id={`inc-task-${t.type}`}>
                      {copy.why && <p className="inc-task-why">{copy.why}</p>}
                      {counts.length > 0 && (
                        <>
                          <h5>What counts</h5>
                          <ul>
                            {counts.map((c) => <li key={c}>{c}</li>)}
                          </ul>
                        </>
                      )}
                      {/* No call to action on a finished goal: it would
                          invite work that earns nothing. */}
                      {copy.cta && !t.done && (
                        <Link className="inc-task-cta" to={copy.cta.to}>
                          {copy.cta.label}
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {/* Said plainly, because "finish the list" without saying what
              happens next reads as a slot machine rather than a process. */}
          <p className="inc-review">
            {progress.complete
              ? 'All done. The team will review your channel and upgrade you. Nothing more for you to do.'
              : 'Once you have completed all of these, the team will review your channel and upgrade you.'}
          </p>
        </div>
      )}
    </section>
  );
}
