import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchIncubationProfile, fetchIncubationPosts, handleAvatar } from '../../lib/incubation';
import './IncubatingProfile.scss';

/**
 * The profile of someone who is on 3Speak but not yet on Hive.
 *
 * Its job is to be honest about that. A visitor arriving from a comment thread
 * needs to understand why there is no reputation, no follower count and no
 * wallet, without it reading as a broken or empty account.
 */
export default function IncubatingProfile({ handle, own = false }) {
  const [profile, setProfile] = useState(null);
  const [posts, setPosts] = useState([]);
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

  if (error) return <p className="inc-profile-error">{error}</p>;
  if (!profile) return <p className="desc" style={{ padding: 24 }}>Loading…</p>;

  const p = profile.profile || {};
  return (
    <div className="inc-profile">
      <header className="inc-profile-head">
        <img className="inc-profile-avatar" src={p.profile_image || handleAvatar(handle)} alt="" />
        <div>
          <h1>{p.name || `@${handle}`}</h1>
          <p className="inc-profile-handle">@{handle}</p>
          {p.about && <p className="inc-profile-about">{p.about}</p>}
        </div>
      </header>

      {/* Stated plainly rather than left as a set of missing widgets. */}
      <p className="inc-profile-note">
        {profile.status === 'graduated' && profile.hiveUsername ? (
          <>
            Now on Hive as <Link to={`/p/${profile.hiveUsername}`}>@{profile.hiveUsername}</Link>.
            Anything below was made before that and lives on 3Speak.
          </>
        ) : (
          own ? (
            <>
              This is how others see you while you get started. Your posts live on 3Speak
              and are not on the Hive blockchain yet, so they do not earn rewards. When
              you create your Hive account you can publish them, and everything after
              that goes straight to the chain.
            </>
          ) : (
            <>
              Getting started on 3Speak. Posts below are here on 3Speak and are not on the
              Hive blockchain yet, so they do not earn rewards.
            </>
          )
        )}
      </p>

      {profile.interests?.length > 0 && (
        <ul className="inc-profile-interests">
          {profile.interests.map(t => <li key={t}>{t}</li>)}
        </ul>
      )}

      <div className="inc-profile-stats">
        <span><strong>{profile.counts?.posts ?? 0}</strong> posts</span>
        <span><strong>{profile.counts?.following ?? 0}</strong> following</span>
        {/* followers is null, not 0: nobody can follow an account that does not
            exist yet, and "0 followers" would read as rejection rather than
            as not-applicable. */}
      </div>

      <h2 className="inc-profile-subhead">Posts</h2>
      {posts.length === 0 ? (
        <p className="desc">Nothing published yet.</p>
      ) : (
        <ul className="inc-profile-posts">
          {posts.map(post => (
            <li key={post.permlink}>
              <span className="inc-profile-post-title">{post.title || '(untitled)'}</span>
              <span className="inc-profile-post-date">
                {post.created ? new Date(post.created).toLocaleDateString() : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
