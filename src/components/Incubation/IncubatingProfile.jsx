import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MdCheckCircle, MdRadioButtonUnchecked, MdVerified, MdExpandMore, MdEdit,
} from 'react-icons/md';
import {
  FaFilm, FaRocket, FaUnlockAlt, FaVideo, FaMobileAlt, FaComments, FaUserPlus,
  FaClock, FaCoins, FaCloudUploadAlt, FaThumbsUp, FaKey, FaGlobeAmericas, FaUserCheck,
} from 'react-icons/fa';
import Card3 from '../Cards/Card3';
import { useAppStore } from '../../lib/store';
import ProfileEditModal from '../WelcomePrompt/ProfileEditModal';
import {
  fetchIncubationProfile, fetchIncubationPosts, fetchIncubationProgress, handleAvatar,
  fetchMyIncubationProfile, saveIncubationProfile, followIncubationUser,
} from '../../lib/incubation';
import './IncubatingProfile.scss';

const TASK_COPY = {
  video: { Icon: FaVideo, label: 'Upload a video', hint: 'Share something about you and what your channel will be about.' },
  short: { Icon: FaMobileAlt, label: 'Post 2 shorts', hint: 'Participate in 3Speak Shorts and upload some moments of your daily life or some stories you want to share.' },
  // No hint here: the comment one states the length floor, which is the
  // server's number, so it is built in taskHint below rather than written twice.
  comment: { Icon: FaComments, label: 'Write 5 comments' },
  follow: { Icon: FaUserPlus, label: 'Follow 10 creators', hint: 'Build up a network of likeminded people, or creators you find exciting.' },
  watch: { Icon: FaClock, label: 'Watch an hour on 3Speak', hint: 'Any videos. Counted while you are really watching.' },
};

// The unlock tiles, as data: the icon belongs beside its own heading, and the
// list was long enough that repeating the markup five times hid the copy.
const UNLOCKS = [
  { Icon: FaCoins, title: 'Your posts start earning.', body: 'Videos on Hive can be rewarded in HIVE and HBD by anyone who watches them, and they can carry ads you take a share of.' },
  { Icon: FaCloudUploadAlt, title: 'Publish everything you made here.', body: 'The videos, shorts and follows on this page can be posted to the chain under your own name, and you choose which.' },
  { Icon: FaThumbsUp, title: 'Vote, tip, follow and build playlists.', body: 'All the buttons that are greyed out for you today.' },
  { Icon: FaKey, title: 'Keys only you hold.', body: 'Nobody can lock you out, and the same login works across every Hive app, not just 3Speak.' },
  { Icon: FaGlobeAmericas, title: 'Be part of the global Hive ecosystem.', body: '3Speak is one app on a whole network of them: blogs, communities, games, marketplaces and more, all sharing the one account and the same following list.' },
];

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
 * True below the app's mobile breakpoint (767px, as in App.jsx).
 *
 * The feed needs this in JS, not CSS: above it videos and shorts share one
 * justified row, and below it they split into two grids with different card
 * shapes. That is a different component tree, not a different rule.
 */
function useIsNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(max-width: 767px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return narrow;
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
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // Which half is on screen at phone/tablet width, where the two columns stack.
  // Ignored above that: both are visible side by side and the tabs are hidden.
  const [mobileTab, setMobileTab] = useState('progress');
  const isNarrow = useIsNarrow();
  const [error, setError] = useState('');
  // Saving REPLACES the stored profile object, interests included, so the ones
  // already set have to be sent back with it or picking a new avatar silently
  // clears them.
  const interestsRef = useRef([]);

  useEffect(() => {
    let alive = true;
    const viewer = useAppStore.getState().user || useAppStore.getState().incubationHandle || null;
    Promise.all([fetchIncubationProfile(handle, viewer), fetchIncubationPosts(handle)])
      .then(([p, list]) => {
        if (!alive) return;
        setProfile(p);
        setFollowing(!!p.viewerFollows);
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
    // The card footer reads these from `stats`, the same shape a Hive feed
    // supplies, so the counts render through the existing components instead of
    // sitting at the placeholder they would otherwise never leave.
    stats: { num_votes: p.likeCount || 0, num_comments: p.replyCount || 0 },
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
  const videoCards = useMemo(() => cards.filter((c) => !c._short), [cards]);
  const shortCards = useMemo(() => cards.filter((c) => c._short), [cards]);

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
      {/* has-cover, so the name is only given a shadow when there is actually an
          image under it. On the plain tinted header a shadow just looks smudged. */}
      <header className={`inc-hero${p.cover_image ? ' has-cover' : ''}`}>
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
            <span><strong>{profile.counts?.followers ?? 0}</strong>followers</span>
            <span><strong>{profile.counts?.following ?? 0}</strong>following</span>
          </div>
          {!own && !graduated && (
            // Someone can finally follow back. Until now this was impossible:
            // the account does not exist on chain, so the ordinary follow was
            // broadcast at nothing. These are stored off-chain, and the creator
            // is told about them.
            <button
              type="button"
              className={`inc-follow-btn${following ? ' is-following' : ''}`}
              onClick={async () => {
                if (followBusy) return;
                const next = !following;
                setFollowBusy(true);
                setFollowing(next);
                try {
                  await followIncubationUser(handle, next);
                  setProfile((p2) => (p2 ? {
                    ...p2,
                    counts: {
                      ...p2.counts,
                      followers: Math.max(0, (p2.counts?.followers || 0) + (next ? 1 : -1)),
                    },
                  } : p2));
                } catch {
                  setFollowing(!next);
                } finally {
                  setFollowBusy(false);
                }
              }}
            >
              {following ? <FaUserCheck size={13} aria-hidden="true" /> : <FaUserPlus size={13} aria-hidden="true" />}
              {following ? 'Following' : 'Follow'}
            </button>
          )}
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
          <>This is how others see you. Your posts live on 3Speak and are not on the Hive blockchain yet, so they do not earn rewards. That changes when you get your account after completing all the tasks below.</>
        ) : (
          <>New here. These posts live on 3Speak and are not on the Hive blockchain yet, so they do not earn rewards.</>
        )}
      </p>

      {showSidebar && (
        // Only rendered when there IS a second panel to switch to. Below the
        // split the goals sit above the feed, so reaching your own videos meant
        // scrolling past the whole checklist every time.
        <div className="inc-tabs" role="tablist" aria-label="Profile sections">
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'progress'}
            className={mobileTab === 'progress' ? 'is-active' : ''}
            onClick={() => setMobileTab('progress')}
          >
            Your goals
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mobileTab === 'posts'}
            className={mobileTab === 'posts' ? 'is-active' : ''}
            onClick={() => setMobileTab('posts')}
          >
            Videos and Shorts
          </button>
        </div>
      )}

      <div className={`inc-cols${showSidebar ? ` inc-cols--split inc-show-${mobileTab}` : ''}`}>
        {showSidebar && (
          <aside className="inc-side">
            {progress && (
              <section className="inc-panel inc-progress">
                <header>
                  <h2><FaRocket size={14} aria-hidden="true" /> Your path to a Hive account</h2>
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
                            <strong>
                              {TASK_COPY[t.type]?.Icon
                                ? (() => { const I = TASK_COPY[t.type].Icon; return <I size={12} aria-hidden="true" />; })()
                                : null}
                              {TASK_COPY[t.type]?.label || t.type}
                            </strong>
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

          </aside>
        )}

        <main className="inc-main">
          {nothingYet && (
            <p className="desc">
              {own ? 'Nothing yet. Your first upload ticks off the list beside this.' : 'Nothing published yet.'}
            </p>
          )}

          {/* Deliberately NOT linkPrefix="/shorts" on the shorts anywhere below:
              that viewer reads its feed from Hive and can only fail on a post
              that is not there. The watch page already falls back to the
              incubation service, so every card opens somewhere that works. */}
          {cards.length > 0 && (isNarrow ? (
            // A phone has no room for the justified row, so the mixed grid falls
            // back to equal boxes and a short becomes a letterboxed sliver of a
            // 16:9 card. Split them there instead, and each kind gets the grid
            // built for its shape: shorts in proper portrait tiles, two up.
            <>
              {videoCards.length > 0 && (
                <>
                  <h2 className="inc-subhead"><FaFilm size={15} aria-hidden="true" /> Videos</h2>
                  <Card3 videos={videoCards} />
                </>
              )}
              {shortCards.length > 0 && (
                <>
                  <h2 className="inc-subhead">Shorts</h2>
                  <Card3 videos={shortCards} shortsGrid />
                </>
              )}
            </>
          ) : (
            <>
              {/* Names the two things in the feed, since they share one grid
                  rather than sitting under separate headings. */}
              <h2 className="inc-subhead"><FaFilm size={15} aria-hidden="true" /> Videos and Shorts</h2>
              <Card3 videos={cards} />
            </>
          ))}
          {/* Below the feed rather than in the sidebar: it is the reward for
              the checklist, so it reads better after the work than beside it,
              and it leaves the goals alone at the top of the column. */}
          {showSidebar && (
            <section className="inc-panel inc-unlocks">
              <h2><FaUnlockAlt size={14} aria-hidden="true" /> What a Hive account gets you</h2>
              <ul>
                {UNLOCKS.map(({ Icon, title, body }) => (
                  <li key={title}>
                    <strong><Icon size={13} aria-hidden="true" />{title}</strong>
                    {body}
                  </li>
                ))}
              </ul>
            </section>
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
