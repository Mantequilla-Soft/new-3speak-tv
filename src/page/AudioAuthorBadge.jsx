import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getRelationshipBetweenAccounts } from '../hive-api/api';
import { followWithAioha, isLoggedIn } from '../hive-api/aioha';
import { useAppStore } from '../lib/store';
import { toastIn } from '../utils/toast';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';
import { Button } from '../components/v2/ui';

// Every toast from this module is headed "Profile"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Profile');

/**
 * Creator chip of the Audio page's Creators row (28e, v2): a surface tile with
 * the avatar, @name, the track count in mono and a Follow button.
 * Layout: avatar left | username + track count, follow on the right
 */
function AudioAuthorBadge({ author, tracks, isFollowing: isFollowingProp, onClick }) {
  const { t } = useTranslation();
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
      .then(() => toast.success(willFollow ? t('audio.author.followed', { author }) : t('audio.author.unfollowed', { author })))
      .catch(err => { setFollowing(!willFollow); toast.error(err.message || t('audio.author.failed')); })
      .finally(() => setLoading(false));
  }, [author, following, loading, user, t]);

  const showFollowBtn = user && author !== user;

  return (
    <div
      className="audio-author-badge"
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onClick?.(); } }}
    >
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
        {tracks != null && <span className="audio-author-tracks num">{t('audio.author.tracks', { count: tracks })}</span>}
      </div>
      {showFollowBtn && (
        <Button
          size={28}
          variant={following ? 'secondary' : 'inverse'}
          className={`audio-author-follow-btn${following ? ' following' : ''}`}
          onClick={handleFollow}
          disabled={loading}
          loading={loading}
        >
          {following ? t('common.actions.following') : t('common.actions.follow')}
        </Button>
      )}
    </div>
  );
}

export default AudioAuthorBadge;
