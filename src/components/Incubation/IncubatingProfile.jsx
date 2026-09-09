import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MdCheckCircle, MdRadioButtonUnchecked, MdVerified, MdExpandMore, MdEdit,
} from 'react-icons/md';
import Card3 from '../Cards/Card3';
import ProfileEditModal from '../WelcomePrompt/ProfileEditModal';
import {
  fetchIncubationProfile, fetchIncubationPosts, fetchIncubationProgress, handleAvatar,
  fetchMyIncubationProfile, saveIncubationProfile,
} from '../../lib/incubation';
import './IncubatingProfile.scss';

const TASK_COPY = {
  video: { label: 'Upload a video', hint: 'Share something about you and what your channel will be about.' },
  short: { label: 'Post 2 shorts', hint: 'Participate in 3Speak Shorts and upload some moments of your daily life or some stories you want to share.' },
  // No hint here: the comment one states the length floor, which is the
  // server's number, so it is built in taskHint below rather than written twice.
  comment: { label: 'Write 5 comments' },
  watch: { label: 'Watch an hour on 3Speak', hint: 'Any videos. Counted while you are really watching.' },
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

/**
 * The profile of someone on 3Speak who is not yet on Hive.
 *
 * Two audiences in one page. A VISITOR needs to understand why there is no
 * reputation, no follower count and no payout, without it reading as a broken
 * account. The OWNER needs to know what to do next and what it gets them, so
 * they get a sidebar nobody else sees.
 */
export default function IncubatingProfile({ handle, own = false }) {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
  const [progress, setProgress] = useState(null);
  const [tasksOpen, setTasksOpen] = useState(readOpen);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  // Saving REPLACES the stored profile object, interests included, so the ones
  // already set have to be sent back with it or picking a new avatar silently
  // clears them.
  const interestsRef = useRef([]);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchIncubationProfile(handle), fetchIncubationPosts(handle)])
      .then(([p, list]) => {
        if (!alive) return;
        setProfile(p);
        interestsRef.current = p.interests || [];
        setPosts(list.items || []);
      })
      .catch(() => { if (alive) setError('Could not load this profile.'); });
    return () => { alive = false; };
  }, [handle]);

  // Only for the owner: progress is theirs to see, and the endpoint is scoped
  // to the signed-in identity anyway.
  useEffect(() => {
    if (!own) return undefined;
    let alive = true;
    fetchIncubationProgress()
      .then((p) => { if (alive) setProgress(p); })
      .catch(() => { /* the page still works without it */ });
    return () => { alive = false; };
  }, [own]);

  // Stable identities: ProfileEditModal reloads whenever `loadProfile` changes,
  // so a new function every render would refetch in a loop.
  const loadOwnProfile = useCallback(async () => {
    const mine = await fetchMyIncubationProfile();
    interestsRef.current = mine.interests || [];
    return mine.profile || {};
  }, []);

  const saveOwnProfile = useCallback(
    (form) => saveIncubationProfile(form, interestsRef.current),
    [],
  );

  const onProfileSaved = useCallback(() => {
    fetchIncubationProfile(handle).then(setProfile).catch(() => { /* keep what is shown */ });
  }, [handle]);

  function toggleTasks() {
    setTasksOpen((wasOpen) => {
      const next = !wasOpen;
      try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* private mode */ }
      return next;
    });
  }

  // Card3 wants author/permlink/title/thumbnail/duration/created, which is the
  // same shape the feed rail builds: one card component, one shape.
  const toCard = (p) => ({
    author: handle,
    permlink: p.permlink,
    title: p.title || '',
    thumbnail: p.thumbnail || null,
    duration: p.duration || 0,
    created: p.created,
    hive_body: p.body || '',
    // Keeps its portrait shape inside the mixed grid. Videos and shorts sit in
    // ONE grid here, newest first, because a new channel with three posts does
    // not need to be filed into sections.
    _short: p.contentType === 'short',
    _incubation: true,
  });

  // ONE grid, videos and shorts together, newest first as the checker returns
  // them. Splitting them into sections is a library view, and these channels
  // have a handful of posts: two headings over two and one card said far more
  // about our data model than about the person whose page it is.
  const cards = useMemo(
    () => posts.map(toCard),
    [posts, handle], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (error) return <p className="inc-profile-error">{error}</p>;
  if (!profile) return <p className="desc" style={{ padding: 32 }}>Loading…</p>;

  const p = profile.profile || {};
  const graduated = profile.status === 'graduated' && profile.hiveUsername;
  const showSidebar = own && !graduated;
  const doneCount = progress ? progress.tasks.filter((t) => t.done).length : 0;
  const totalTasks = progress ? progress.tasks.length : 0;
  const nothingYet = cards.length === 0;

  return (
    <div className="inc-profile">
      <header className="inc-hero">
        {p.cover_image && <div className="inc-hero-cover" style={{ backgroundImage: `url(${p.cover_image})` }} />}
        <div className="inc-hero-body">
          <img className="inc-hero-avatar" src={p.profile_image || handleAvatar(handle)} alt="" />
          <div className="inc-hero-text">
            <h1>{p.name || `@${handle}`}</h1>
            <p className="inc-hero-handle">
              {/* Only when a display name exists, or the heading already said it. */}
              {p.name && <span>@{handle}</span>}
              <span className="inc-badge">
                <MdVerified size={13} aria-hidden="true" />
                {graduated ? 'On Hive' : 'Getting started'}
              </span>
            </p>
            {p.about && <p className="inc-hero-about">{p.about}</p>}
            {profile.interests?.length > 0 && (
              <ul className="inc-chips">
                {profile.interests.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
          </div>
          <div className="inc-hero-stats">
            <span><strong>{profile.counts?.posts ?? 0}</strong>posts</span>
            <span><strong>{profile.counts?.following ?? 0}</strong>following</span>
          </div>
          {own && (
            <button type="button" className="inc-edit-btn" onClick={() => setEditing(true)}>
              <MdEdit size={15} aria-hidden="true" />
              Edit profile
            </button>
          )}
        </div>
      </header>

      <p className="inc-note">
        {graduated ? (
          <>Now on Hive as <Link to={`/p/${profile.hiveUsername}`}>@{profile.hiveUsername}</Link>. Anything below was made before that.</>
        ) : own ? (
          <>This is how others see you. Your posts live on 3Speak and are not on the Hive blockchain yet, so they do not earn rewards. That changes when you get your account.</>
        ) : (
          <>New here. These posts live on 3Speak and are not on the Hive blockchain yet, so they do not earn rewards.</>
        )}
      </p>

      <div className={`inc-cols${showSidebar ? ' inc-cols--split' : ''}`}>
        {showSidebar && (
          <aside className="inc-side">
            {progress && (
              <section className="inc-panel inc-progress">
                <header>
                  <h2>Your path to a Hive account</h2>
                  <span className="inc-progress-count">{doneCount} of {totalTasks} done</span>
                </header>
                {/* The bar stays put whatever the list does: it is the one thing
                    worth seeing at a glance, and collapsing it would leave the
                    panel saying nothing. */}
                <div
                  className="inc-progress-bar"
                  role="progressbar"
                  aria-label="Tasks completed"
                  aria-valuenow={doneCount}
                  aria-valuemin={0}
                  aria-valuemax={totalTasks}
                >
                  <span style={{ width: `${totalTasks ? (doneCount / totalTasks) * 100 : 0}%` }} />
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
                      {progress.tasks.map((t) => (
                        <li
                          key={t.type}
                          className={t.done ? 'is-done' : ''}
                          // Read by the fill behind the card, so "2 of 5" is
                          // visible as a quantity and not only as a number.
                          style={{ '--task-fill': `${taskPct(t)}%` }}
                        >
                          {t.done ? <MdCheckCircle size={20} className="inc-task-icon done" />
                            : <MdRadioButtonUnchecked size={20} className="inc-task-icon" />}
                          <span className="inc-task-text">
                            <strong>{TASK_COPY[t.type]?.label || t.type}</strong>
                            <span>{taskHint(t, progress.minCommentChars)}</span>
                          </span>
                          <span className="inc-task-count">{taskAmount(t)}</span>
                        </li>
                      ))}
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
            )}

            <section className="inc-panel inc-unlocks">
              <h2>What a Hive account gets you</h2>
              <ul>
                <li><strong>Your posts start earning.</strong> Videos on Hive can be rewarded in HIVE and HBD by anyone who watches them, and they can carry ads you take a share of.</li>
                <li><strong>Publish everything you made here.</strong> The videos, shorts and follows on this page can be posted to the chain under your own name, and you choose which.</li>
                <li><strong>Vote, tip, follow and build playlists.</strong> All the buttons that are greyed out for you today.</li>
                <li><strong>Keys only you hold.</strong> Nobody can lock you out, and the same login works across every Hive app, not just 3Speak.</li>
              </ul>
            </section>
          </aside>
        )}

        <main className="inc-main">
          {nothingYet && (
            <p className="desc">
              {own ? 'Nothing yet. Your first upload ticks off the list beside this.' : 'Nothing published yet.'}
            </p>
          )}

          {cards.length > 0 && (
            <>
              {/* Names the two things in the feed, since they share one grid
                  rather than sitting under separate headings. */}
              <h2 className="inc-subhead">Videos and Shorts</h2>
              {/* Deliberately NOT linkPrefix="/shorts" for the shorts in here:
                  that viewer reads its feed from Hive and can only fail on a
                  post that is not there. The watch page already falls back to
                  the incubation service, so every card opens somewhere that
                  works. */}
              <Card3 videos={cards} />
            </>
          )}
        </main>
      </div>

      {own && (
        <ProfileEditModal
          open={editing}
          username={null}
          onClose={() => setEditing(false)}
          loadProfile={loadOwnProfile}
          onSave={saveOwnProfile}
          onSaved={onProfileSaved}
          fineprint="Saved to your 3Speak profile. It goes to Hive with everything else when you get your account."
        />
      )}
    </div>
  );
}
