import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MdCheckCircle, MdRadioButtonUnchecked, MdExpandMore } from 'react-icons/md';
import {
  FaRocket, FaVideo, FaMobileAlt, FaComments, FaUserPlus, FaClock, FaHourglassHalf,
  FaUsers, FaIdCard, FaEnvelope,
} from 'react-icons/fa';
import AdvertiserContactForm from './AdvertiserContactForm';
import AddSocialLink_modal from '../modal/AddSocialLink_modal';
import { warmupSocial, platformLabel } from '../../utils/socialVerifier';
import BrandProfileForm from './BrandProfileForm';
import { TRACK_QUESTION_ID } from './TrackQuestion';
import { trackTitleKey } from './tracks';
import { useTranslation } from 'react-i18next';
import { formatDate } from '../../i18n';
import {
  fetchIncubationProgress, progressHue, progressFraction, taskFraction, onIncubationProgress,
  fetchGraduationStatus, canCreateAccount,
} from '../../lib/incubation';

/* The goals panel, as its own component so that refreshing it refreshes IT.
 *
 * It used to be inline in IncubatingProfile, which meant the progress state
 * lived at the top of the page: every refresh re-rendered the header, the feed
 * and every card in it, so a bar that moved by two percent visibly reloaded the
 * whole profile. Owning its own state keeps a refresh inside these few hundred
 * pixels, which is all that has actually changed.
 */

// Plural wording from the goal's own number, which the server decides per track
// (a creator posts 1 short, say): so the label can never promise a different
// number from the one that is counted. Each `labelKey` has _one/_other forms
// and is translated with { count: need }.

// Watch time as a person would say it: "an hour", "20 minutes".
function watchLabel(seconds, t) {
  if (seconds >= 3600 && seconds % 3600 === 0) return t('incubation.progress.tasks.watch.labelHours', { count: seconds / 3600 });
  return t('incubation.progress.tasks.watch.labelMinutes', { count: Math.round(seconds / 60) });
}

// Text is stored as i18n keys (translated at render): `labelKey` takes the
// goal's `need` as its count, `countsKeys` are the "what counts" bullets.
const TASK_COPY = {
  video: {
    Icon: FaVideo,
    labelKey: 'incubation.progress.tasks.video.label',
    hintKey: 'incubation.progress.tasks.video.hint',
    whyKey: 'incubation.progress.tasks.video.why',
    countsKeys: [
      'incubation.progress.tasks.video.counts.0',
      'incubation.progress.tasks.video.counts.1',
    ],
    cta: { labelKey: 'incubation.progress.tasks.video.cta', to: '/embed-studio' },
  },
  short: {
    Icon: FaMobileAlt,
    labelKey: 'incubation.progress.tasks.short.label',
    hintKey: 'incubation.progress.tasks.short.hint',
    whyKey: 'incubation.progress.tasks.short.why',
    countsKeys: [
      'incubation.progress.tasks.short.counts.0',
      'incubation.progress.tasks.short.counts.1',
    ],
    cta: { labelKey: 'incubation.progress.tasks.short.cta', to: '/embed-studio?from=shorts' },
  },
  follow: {
    Icon: FaUserPlus,
    labelKey: 'incubation.progress.tasks.follow.label',
    hintKey: 'incubation.progress.tasks.follow.hint',
    whyKey: 'incubation.progress.tasks.follow.why',
    countsKeys: [
      'incubation.progress.tasks.follow.counts.0',
      'incubation.progress.tasks.follow.counts.1',
    ],
    cta: { labelKey: 'incubation.progress.tasks.follow.cta', to: '/discover' },
  },
  // No hint here: this one states the length floor, which is the server's
  // number, so it is built in taskHint below rather than written twice. Its
  // "what counts" list is built in taskCounts for the same reason.
  comment: {
    Icon: FaComments,
    labelKey: 'incubation.progress.tasks.comment.label',
    whyKey: 'incubation.progress.tasks.comment.why',
    cta: { labelKey: 'incubation.progress.tasks.comment.cta', to: '/discover' },
  },
  watch: {
    Icon: FaClock,
    // Label built by watchLabel (hours or minutes).
    hintKey: 'incubation.progress.tasks.watch.hint',
    whyKey: 'incubation.progress.tasks.watch.why',
    // Kept to the two rules a person acts on (owner 2026-10-06: too much info).
    // The tracker still enforces the rest (on 3Speak only, real playing time,
    // on screen, not in private mode); they are just not listed.
    countsKeys: [
      'incubation.progress.tasks.watch.counts.1',
      'incubation.progress.tasks.watch.counts.4',
    ],
    cta: { labelKey: 'incubation.progress.tasks.watch.cta', to: '/' },
  },
  // The only goal with no call to action, deliberately: there is nothing to go
  // and do, which is the whole point of it. Its "what counts" list is built in
  // taskCounts so it can name the actual date from the server.
  time: {
    Icon: FaHourglassHalf,
    labelKey: 'incubation.progress.tasks.time.label',
    hintKey: 'incubation.progress.tasks.time.hint',
    whyKey: 'incubation.progress.tasks.time.why',
  },
  subscription: {
    Icon: FaUsers,
    labelKey: 'incubation.progress.tasks.subscription.label',
    hintKey: 'incubation.progress.tasks.subscription.hint',
    whyKey: 'incubation.progress.tasks.subscription.why',
    countsKeys: [
      'incubation.progress.tasks.subscription.counts.0',
      'incubation.progress.tasks.subscription.counts.1',
    ],
    cta: { labelKey: 'incubation.progress.tasks.subscription.cta', to: '/groups' },
  },
  // For advertisers: a brand is judged by its profile. The three fields are the
  // ones server/warmup.cjs counts; whether they fit the brand is the team's call.
  // Filled in right inside the goal (BrandProfileForm).
  profile: {
    Icon: FaIdCard,
    labelKey: 'incubation.progress.tasks.profile.label',
    hintKey: 'incubation.progress.tasks.profile.hint',
    whyKey: 'incubation.progress.tasks.profile.why',
  },
  // For advertisers: how the team reaches the business. Email and address are
  // PRIVATE and off-chain; the form says so (AdvertiserContactForm).
  contact: {
    Icon: FaEnvelope,
    labelKey: 'incubation.progress.tasks.contact.label',
    hintKey: 'incubation.progress.tasks.contact.hint',
    whyKey: 'incubation.progress.tasks.contact.why',
    countsKeys: [
      'incubation.progress.tasks.contact.counts.0',
      'incubation.progress.tasks.contact.counts.1',
      'incubation.progress.tasks.contact.counts.2',
    ],
  },
};

// The goals in groups a person recognises, in the order the track lists them:
// a group sits where its first goal sits in the server's list, so the track
// still decides what comes first. A goal type this build does not know yet
// lands in an untitled group at the end rather than disappearing.
const GOAL_GROUPS = [
  { id: 'create', types: ['video', 'short'], titleKey: 'incubation.progress.groups.create' },
  { id: 'watch', types: ['watch', 'comment'], titleKey: 'incubation.progress.groups.watch' },
  { id: 'connect', types: ['follow', 'subscription'], titleKey: 'incubation.progress.groups.connect' },
  { id: 'brand', types: ['profile', 'contact'], titleKey: 'incubation.progress.groups.brand' },
  { id: 'time', types: ['time'], titleKey: 'incubation.progress.groups.time' },
];

function groupTasks(tasks) {
  const byId = new Map();
  tasks.forEach((task, i) => {
    const g = GOAL_GROUPS.find((x) => x.types.includes(task.type)) || { id: 'other', titleKey: null };
    if (!byId.has(g.id)) byId.set(g.id, { id: g.id, titleKey: g.titleKey, first: i, tasks: [] });
    byId.get(g.id).tasks.push(task);
  });
  return [...byId.values()].sort((a, b) => a.first - b.first);
}

const labelOf = (task, t) => {
  if (task.type === 'watch') return watchLabel(task.need, t);
  const key = TASK_COPY[task.type]?.labelKey;
  return key ? t(key, { count: task.need }) : task.type;
};

/**
 * Seconds as a duration a person would say out loud.
 *
 * Driven by the task's `unit`, not by its name, so the server decides which
 * numbers are durations and this only decides how they read.
 */
function asDuration(seconds, t) {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return t('incubation.progress.duration.s', { s: total });
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h && m) return t('incubation.progress.duration.hm', { h, m });
  if (h) return t('incubation.progress.duration.h', { h });
  return t('incubation.progress.duration.m', { m });
}

/**
 * The line under a task's name.
 *
 * The comment floor lives on the task itself rather than in fine print below
 * the list: it is the rule that decides whether a comment counts, and someone
 * reading "1/10" needs it right there, not in a footnote they have already
 * scrolled past.
 */
function taskHint(task, minCommentChars, t) {
  if (task.type === 'comment' && minCommentChars > 0) {
    return t('incubation.progress.tasks.comment.hint', { count: minCommentChars });
  }
  const key = TASK_COPY[task.type]?.hintKey;
  return key ? t(key) : '';
}

/**
 * The "what counts" bullets for one task.
 *
 * Comment rules are assembled here rather than sitting in TASK_COPY because
 * they quote the server's length floor, and because both of them are rules the
 * server actually enforces in the query -- someone who has written five replies
 * under their own video and sees 0/10 deserves to be able to find out why.
 */
function taskCounts(task, minCommentChars, t) {
  if (task.type === 'time') {
    const when = task.readyAt ? asDate(task.readyAt) : null;
    return [
      t('incubation.progress.tasks.time.counts.fullDays', { count: task.need }),
      when
        ? t('incubation.progress.tasks.time.counts.forYouWhen', { when })
        : t('incubation.progress.tasks.time.counts.otherGoals'),
      t('incubation.progress.tasks.time.counts.keepsCounting'),
    ];
  }
  if (task.type === 'comment') {
    return [
      minCommentChars > 0
        ? t('incubation.progress.tasks.comment.counts.minChars', { count: minCommentChars })
        : t('incubation.progress.tasks.comment.counts.realThought'),
      t('incubation.progress.tasks.comment.counts.othersPost'),
    ];
  }
  return (TASK_COPY[task.type]?.countsKeys || []).map((k) => t(k));
}

/** How far along one task is, 0-100, for the fill behind its card. */
function taskPct(t) {
  // Shared with the nav pill and the overall bar, so a goal cannot be drawn as
  // one amount here and counted as another there. It is also what makes the
  // time goal move smoothly instead of in thirds.
  return Math.max(0, Math.min(100, taskFraction(t) * 100));
}

function taskAmount(task, t) {
  if (task.unit === 'seconds') return `${asDuration(Math.min(task.have, task.need), t)} / ${asDuration(task.need, t)}`;
  // A percentage, not a day count. The server floors days so that "three days"
  // means three WHOLE days, which is right for deciding whether the goal is met
  // and useless for showing progress: it reads 0 of 3 for a whole day, then 1 of
  // 3 for another. The percentage comes off the clock, so it always reflects
  // where someone actually is.
  //
  // Rounded DOWN, and never to 100 until the server says done: rounding 99.7 up
  // would show a finished goal beside an unfinished tick.
  if (task.unit === 'days') {
    const pct = taskFraction(task) * 100;
    return task.done ? '100%' : `${Math.min(99, Math.floor(pct))}%`;
  }
  return `${Math.min(task.have, task.need)}/${task.need}`;
}

/**
 * "14 September" from an ISO date, in the reader's own locale.
 *
 * Date only, no time: the server floors to whole days, so naming an hour would
 * promise a precision the requirement does not have.
 */
function asDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatDate(d, { day: 'numeric', month: 'long' });
}

// Remembered per browser so the list does not spring open on every visit once
// someone has folded it away. Open is the default: it is the point of the page
// the first time you land on it.
const OPEN_KEY = 'inc_progress_open';

function readOpen() {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
}

export default function IncubationProgressPanel() {
  const { t } = useTranslation();
  const [progress, setProgress] = useState(null);
  const [tasksOpen, setTasksOpen] = useState(readOpen);
  // Which goals have their detail open. Several may be, and it is session-only
  // on purpose: folding the whole list away is a standing preference worth
  // remembering, opening one goal is a question you have finished asking.
  const [openTasks, setOpenTasks] = useState(() => new Set());

  /* An advertiser's two goals are forms, filled in right here. On the first load the
   * first one still to do opens, so the page starts at the thing to fill in rather
   * than at a list of closed rows. After that the person decides what is open. */
  const autoOpened = useRef(false);
  // Approved already: "the team will review you" is no longer true, and the way
  // forward is the "your account is ready" panel and popup instead.
  const [approved, setApproved] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchGraduationStatus()
      .then((s) => { if (alive) setApproved(canCreateAccount(s)); })
      .catch(() => { /* keep the line; it is only wrong after approval */ });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    const load = () => fetchIncubationProgress()
      .then((p) => {
        if (!alive) return;
        setProgress(p);
        if (!autoOpened.current && p?.tasks) {
          autoOpened.current = true;
          const first = p.tasks.find((task) => (task.type === 'profile' || task.type === 'contact') && !task.done);
          if (first) setOpenTasks(new Set([first.type]));
        }
      })
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

  // Nothing to count until they say what they are here for. The question itself
  // is in the main column (TrackQuestion): three tiles do not fit in here.
  if (progress.needsTrack) {
    return (
      <section className="inc-panel inc-progress">
        <header>
          <h2><FaRocket size={14} aria-hidden="true" /> {t('incubation.progress.title')}</h2>
        </header>
        <p className="inc-track-intro">
          {t('incubation.progress.needsTrack')}
        </p>
        <button
          type="button"
          className="inc-task-cta"
          onClick={() => document.getElementById(TRACK_QUESTION_ID)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
        >
          {t('incubation.progress.choosePath')}
        </button>
      </section>
    );
  }

  const doneCount = progress.tasks.filter((task) => task.done).length;
  const totalTasks = progress.tasks.length;
  // Each goal is worth an equal share and partial progress inside one counts, so
  // the bar creeps forward as they go rather than jumping a fifth at a time.
  const filled = progressFraction(progress.tasks);

  return (
    <section className="inc-panel inc-progress">
      <header>
        <h2><FaRocket size={14} aria-hidden="true" /> {t('incubation.progress.title')}</h2>
        {progress.track && (
          <span className="inc-track-current">{trackTitleKey(progress.track) ? t(trackTitleKey(progress.track)) : null}</span>
        )}
        <span
          className="inc-progress-count"
          style={{ '--bar-hue': progressHue(filled) }}
        >
          {t('incubation.progress.doneCount', { done: doneCount, total: totalTasks })}
        </span>
      </header>
      {/* The bar stays put whatever the list does: it is the one thing
          worth seeing at a glance, and collapsing it would leave the
          panel saying nothing. */}
      {/* One bar, filled to the SAME proportional figure the pill in
          the nav shows: an equal share per goal, and a part-finished
          goal counts for its part. So a single comment lengthens it.
          It is drawn as one track rather than one stub per goal,
          because stubs read as separate errands instead of one
          journey. The share per goal comes from the server's task
          list rather than a number written here, so adding a goal
          does not silently leave this bar measuring the wrong thing. */}
      <div
        className="inc-progress-bar"
        role="progressbar"
        aria-label={t('incubation.progress.overallAria')}
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
        {tasksOpen ? t('incubation.progress.hideDetails') : t('incubation.progress.showLeft')}
      </button>

      {tasksOpen && (
        <div id="inc-task-list">
          {/* Groups side by side on a wide screen, stacked on a phone (.inc-goal-groups). */}
          <div className="inc-goal-groups">
          {groupTasks(progress.tasks).map((group) => {
            const groupDone = group.tasks.filter((task) => task.done).length;
            return (
              <section key={group.id} className="inc-goal-group" aria-labelledby={`inc-goal-group-${group.id}`}>
                {group.titleKey && (
                  <h3 id={`inc-goal-group-${group.id}`}>
                    {t(group.titleKey)}
                    <span className="inc-goal-group-count">{groupDone}/{group.tasks.length}</span>
                  </h3>
                )}
                <ul className="inc-goal-tiles">
                  {group.tasks.map((task) => {
                    const copy = TASK_COPY[task.type] || {};
                    const Icon = copy.Icon;
                    const open = openTasks.has(task.type);
                    const counts = taskCounts(task, progress.minCommentChars, t);
                    return (
                      <li
                        key={task.type}
                        // An open tile spans the whole row: its rules, and an
                        // advertiser's form, need the width a tile does not have.
                        className={`inc-goal-tile${task.done ? ' is-done' : ''}${open ? ' is-open' : ''}`}
                      >
                        {/* The whole tile is the control: a phone needs a big target. */}
                        <button
                          type="button"
                          className="inc-goal-head"
                          onClick={() => toggleTask(task.type)}
                          aria-expanded={open}
                          aria-controls={`inc-task-${task.type}`}
                        >
                          <span className="inc-goal-top">
                            {Icon ? <Icon size={15} className="inc-goal-type" aria-hidden="true" /> : null}
                            <span className="inc-goal-count">{taskAmount(task, t)}</span>
                            {task.done ? <MdCheckCircle size={18} className="inc-task-icon done" aria-label={t('incubation.progress.goalDone')} />
                              : <MdRadioButtonUnchecked size={18} className="inc-task-icon" aria-hidden="true" />}
                          </span>
                          <strong className="inc-goal-label">{labelOf(task, t)}</strong>
                          <span className="inc-goal-hint">{taskHint(task, progress.minCommentChars, t)}</span>
                          {/* Neutral, not coloured (owner 2026-10-01: too many colours);
                              the count above says the same in numbers. */}
                          <span className="inc-goal-bar" aria-hidden="true"><span style={{ width: `${taskPct(task)}%` }} /></span>
                        </button>

                        {open && (
                          <div className="inc-task-detail inc-goal-detail" id={`inc-task-${task.type}`}>
                            {copy.whyKey && <p className="inc-task-why">{t(copy.whyKey)}</p>}
                            {counts.length > 0 && (
                              <>
                                <h5>{t('incubation.progress.whatCounts')}</h5>
                                <ul>
                                  {counts.map((c) => <li key={c}>{c}</li>)}
                                </ul>
                              </>
                            )}
                            {/* The contact goal is filled in right here: there is no
                                other page for private details. Kept open when done, so
                                they can still be corrected. */}
                            {task.type === 'profile' && <BrandProfileForm />}
                            {task.type === 'contact' && <AdvertiserContactForm />}
                            {/* No call to action on a finished goal: it would
                                invite work that earns nothing. */}
                            {copy.cta && !task.done && (
                              <Link className="inc-task-cta" to={copy.cta.to}>
                                {t(copy.cta.labelKey)}
                              </Link>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          </div>
          <WarmupSocialTask />
          {/* Said plainly, because "finish the list" without saying what
              happens next reads as a slot machine rather than a process. */}
          {!approved && (
          <p className="inc-review">
            {progress.complete
              ? t('incubation.progress.reviewDone')
              : t('incubation.progress.reviewPending')}
          </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Optional warm-up task: link your YouTube, TikTok or Instagram (owner 2026-10-06).
 * Not part of the ladder (the SDK has no optional goals, and it must never hold up
 * a review), so it sits under the list with its own state. Works with video import
 * and the profile link switches off: the API route and the checker carry their own
 * platform list. Linked channels move to the Hive account at graduation.
 */
function WarmupSocialTask() {
  const { t } = useTranslation();
  const [links, setLinks] = useState(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(false);
  const load = useCallback(() => {
    warmupSocial.load().then((d) => setLinks(d?.links || [])).catch(() => setLinks([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (links === null) return null;
  const verified = links.filter((l) => l.verified);
  const done = verified.length > 0;
  return (
    <>
      <h5 className="inc-optional-title">{t('incubation.progress.optional.title')}</h5>
      <ul className="inc-tasks inc-tasks--optional">
        <li className={`${done ? 'is-done' : ''}${open ? ' is-open' : ''}`.trim()} style={{ '--task-fill': done ? '100%' : '0%' }}>
          <button
            type="button"
            className="inc-task-head"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="inc-task-social"
          >
            {done ? <MdCheckCircle size={20} className="inc-task-icon done" />
              : <MdRadioButtonUnchecked size={20} className="inc-task-icon" />}
            <span className="inc-task-text">
              <strong>{t('incubation.progress.optional.social.label')}</strong>
              <span>
                {done
                  ? t('incubation.progress.optional.social.linked', { platforms: [...new Set(verified.map((l) => platformLabel(l.platform)))].join(', ') })
                  : t('incubation.progress.optional.social.hint')}
              </span>
            </span>
            <span className="inc-task-count">{done ? verified.length : 0}/1</span>
            <MdExpandMore size={18} className="inc-task-chevron" aria-hidden="true" />
          </button>
          {open && (
            <div className="inc-task-detail" id="inc-task-social">
              <p className="inc-task-why">{t('incubation.progress.optional.social.why')}</p>
              <button type="button" className="inc-task-cta" onClick={() => setDialog(true)}>
                {t('incubation.progress.optional.social.cta')}
              </button>
            </div>
          )}
        </li>
      </ul>
      <AddSocialLink_modal isOpen={dialog} onClose={() => setDialog(false)} onChange={load} warmup />
    </>
  );
}
