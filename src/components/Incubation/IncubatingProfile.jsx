import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MdCheckCircle, MdRadioButtonUnchecked, MdVerified, MdExpandMore,
} from 'react-icons/md';
import Card3 from '../Cards/Card3';
import {
  fetchIncubationProfile, fetchIncubationPosts, fetchIncubationProgress, handleAvatar,
} from '../../lib/incubation';
import './IncubatingProfile.scss';

const TASK_COPY = {
  video: { label: 'Upload a video', hint: 'A proper upload, however short.' },
  short: { label: 'Post 2 shorts', hint: 'Vertical clips from the shorts camera.' },
  comment: { label: 'Write 5 comments', hint: 'Real ones, on videos you actually watched.' },
  watch: { label: 'Watch an hour of 3Speak', hint: 'Any videos. Counted while you are really watching.' },
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
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    Promise.all([fetchIncubationProfile(handle), fetchIncubationPosts(handle)])
      .then(([p, list]) => {
        if (!alive) return;
        setProfile(p);
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
    _incubation: true,
  });

  // Split by the type the server derived, so a short is laid out as a short.
  // Anything older than that field is a video, which is what those rows are.
  const videos = useMemo(
    () => posts.filter((p) => p.contentType !== 'short').map(toCard),
    [posts, handle], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const shorts = useMemo(
    () => posts.filter((p) => p.contentType === 'short').map(toCard),
    [posts, handle], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (error) return <p className="inc-profile-error">{error}</p>;
  if (!profile) return <p className="desc" style={{ padding: 32 }}>Loading…</p>;

  const p = profile.profile || {};
  const graduated = profile.status === 'graduated' && profile.hiveUsername;
  const showSidebar = own && !graduated;
  const doneCount = progress ? progress.tasks.filter((t) => t.done).length : 0;
  const totalTasks = progress ? progress.tasks.length : 0;
  const nothingYet = videos.length === 0 && shorts.length === 0;

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
                        <li key={t.type} className={t.done ? 'is-done' : ''}>
                          {t.done ? <MdCheckCircle size={20} className="inc-task-icon done" />
                            : <MdRadioButtonUnchecked size={20} className="inc-task-icon" />}
                          <span className="inc-task-text">
                            <strong>{TASK_COPY[t.type]?.label || t.type}</strong>
                            <span>{TASK_COPY[t.type]?.hint}</span>
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
                    {progress.minCommentChars > 0 && !progress.tasks.find((t) => t.type === 'comment')?.done && (
                      <p className="inc-review-fine">
                        Comments count once they are at least {progress.minCommentChars} characters. A real thought, not just “nice”.
                      </p>
                    )}
                  </div>
                )}
              </section>
            )}

            <section className="inc-panel inc-unlocks">
              <h2>What a Hive account gets you</h2>
              <ul>
                <li><strong>Your posts start earning.</strong> Videos on Hive can be rewarded in HIVE and HBD by anyone who watches them.</li>
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

          {videos.length > 0 && (
            <>
              <h2 className="inc-subhead">Videos</h2>
              <Card3 videos={videos} />
            </>
          )}

          {shorts.length > 0 && (
            <>
              <h2 className="inc-subhead">Shorts</h2>
              {/* shortsGrid for the portrait layout, but deliberately NOT
                  linkPrefix="/shorts": that viewer reads its feed from Hive and
                  can only fail on a post that is not there. The watch page
                  already falls back to the incubation service, so these open
                  somewhere that works. */}
              <Card3 videos={shorts} shortsGrid />
            </>
          )}
        </main>
      </div>
    </div>
  );
}
