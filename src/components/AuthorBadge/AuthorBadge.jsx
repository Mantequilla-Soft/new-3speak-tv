import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toastIn } from '../../utils/toast';
import { getFollowers, getRelationshipBetweenAccounts } from '../../hive-api/api';
import { followWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { useAppStore } from '../../lib/store';
import PremiumBadge from '../PremiumBadge/PremiumBadge';
import './AuthorBadge.scss';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

// `subtitle` replaces the followers line — used by rails that describe the
// creator by something other than their follower count ("3 shorts / 2 videos").
function AuthorBadge({ author, onClick, followersCount, fetchFollowers, showFollow, isFollowing: isFollowingProp, onFollow, noLink, compact, reputation, color, tabHint, subtitle }) {
  const navigate = useNavigate();
  const { user } = useAppStore();
  const [localFollowers, setLocalFollowers] = useState(null);
  const [following, setFollowing] = useState(isFollowingProp ?? false);
  const [followLoading, setFollowLoading] = useState(false);

  // Sync from prop when it changes
  useEffect(() => {
    if (isFollowingProp != null) setFollowing(isFollowingProp);
  }, [isFollowingProp]);

  // Check actual follow status from blockchain when showFollow is true
  useEffect(() => {
    if (!showFollow || !author || !user || author === user || isFollowingProp != null) return;
    let cancelled = false;
    getRelationshipBetweenAccounts(user, author).then((relation) => {
      if (!cancelled && relation?.follows != null) {
        setFollowing(relation.follows);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [author, user, showFollow, isFollowingProp]);

  useEffect(() => {
    if (!fetchFollowers || followersCount != null || !author) return;
    let cancelled = false;
    getFollowers(author).then((data) => {
      if (!cancelled && data?.follower_count != null) {
        setLocalFollowers(data.follower_count);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [author, fetchFollowers, followersCount]);

  const displayFollowers = followersCount ?? localFollowers;

  const handleClick = (e) => {
    e.stopPropagation();
    if (onClick) {
      e.preventDefault();
      onClick(author);
    }
    if (noLink) {
      e.preventDefault();
      navigate(`/p/${author}`);
    }
  };

  const handleFollow = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isLoggedIn()) {
      toast.error('Please login to follow users');
      return;
    }

    if (followLoading) return;

    const willFollow = !following;
    setFollowLoading(true);
    setFollowing(willFollow);

    try {
      await followWithAioha(author, willFollow);
      toast.success(willFollow ? `Followed @${author}` : `Unfollowed @${author}`);
      if (onFollow) onFollow(author, willFollow);
    } catch (err) {
      setFollowing(!willFollow);
      toast.error(`Failed to ${willFollow ? 'follow' : 'unfollow'}: ${err.message}`);
    } finally {
      setFollowLoading(false);
    }
  }, [author, following, followLoading, onFollow]);

  const inner = (
    <>
      <img src={`https://images.hive.blog/u/${author}/avatar/small`} alt="" />
      <div className="author-text">
        <span className="author-name-row">
          <span className="author-name">@{author}{reputation != null ? ` (${Math.round(reputation)})` : ''}</span>
          <PremiumBadge username={author} size={11} />
        </span>
        {subtitle ? (
          <span className="followers-count">{subtitle}</span>
        ) : displayFollowers != null && (
          <span className="followers-count">{displayFollowers} Followers</span>
        )}
      </div>
    </>
  );

  const showFollowBtn = showFollow && author !== user;

  return (
    <div className={`author-badge${compact ? ' compact' : ''}`}>
      {noLink ? (
        <span className="author-badge-link" onClick={handleClick}>
          {inner}
        </span>
      ) : (
        <Link to={tabHint ? `/p/${author}?tab=${tabHint}` : `/p/${author}`} className="author-badge-link" onClick={handleClick}>
          {inner}
        </Link>
      )}
      {showFollowBtn && (
        <button
          className={`follow-btn ${following ? 'following' : ''}`}
          onClick={handleFollow}
          disabled={followLoading}
          style={color && following ? { color } : undefined}
        >
          {followLoading ? '...' : following ? 'Following' : 'Follow'}
        </button>
      )}
    </div>
  );
}

export default AuthorBadge;
