import { useState, useEffect, useCallback } from 'react';
import { getRelationshipBetweenAccounts } from '../hive-api/api';
import { followWithAioha, isLoggedIn } from '../hive-api/aioha';
import { useAppStore } from '../lib/store';
import { toastIn } from '../utils/toast';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

/**
 * Compact vertical author card for the Audio page creators row.
 * Layout: avatar left | username + follow button + track count right
 */
function AudioAuthorBadge({ author, tracks, isFollowing: isFollowingProp, onClick }) {
  const { user } = useAppStore();
  const [following, setFollowing] = useState(isFollowingProp ?? false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isFollowingProp != null) { setFollowing(isFollowingProp); return; }
    if (!author || !user || author === user) return;
    let cancelled = false;
    getRelationshipBetweenAccounts(user, author).then(r => {
      if (!cancelled && r?.follows != null) setFollowing(r.follows);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [author, user, isFollowingProp]);

  const handleFollow = useCallback((e) => {
    e.stopPropagation();
    if (!isLoggedIn() || loading || !user || author === user) return;

    const willFollow = !following;
    setLoading(true);
    setFollowing(willFollow);

    followWithAioha(author, willFollow)
      .then(() => toast.success(willFollow ? `Followed @${author}` : `Unfollowed @${author}`))
      .catch(err => { setFollowing(!willFollow); toast.error(err.message || 'Failed'); })
      .finally(() => setLoading(false));
  }, [author, following, loading, user]);

  const showFollowBtn = user && author !== user;

  return (
    <div className="audio-author-badge" onClick={onClick}>
      <HiveAvatar
        username={author}
        size="small"
        imgClassName="audio-author-avatar"
        alt={author}
        onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
        badgeSize={11}
      />
      <div className="audio-author-info">
        <span className="audio-author-name">@{author}</span>
        {showFollowBtn && (
          <button
            className={`audio-author-follow-btn${following ? ' following' : ''}`}
            onClick={handleFollow}
            disabled={loading}
          >
            {loading ? '...' : following ? 'Following' : 'Follow'}
          </button>
        )}
        {tracks != null && <span className="audio-author-tracks">{tracks} tracks</span>}
      </div>
    </div>
  );
}

export default AudioAuthorBadge;
