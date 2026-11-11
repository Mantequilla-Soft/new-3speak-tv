import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getRelationshipBetweenAccounts } from '../../hive-api/api';
import { followWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { useAppStore } from '../../lib/store';
import { toastIn } from '../../utils/toast';
import { Button } from '../v2/ui';

const toast = toastIn('Profile');

/**
 * Follow beside the creator in the full player and on the audio page (27a,
 * 18b): an inverse 36px button, "Following" quiet once followed. The same Hive
 * follow as the Audio page's creator chips (page/AudioAuthorBadge.jsx). Shows
 * nothing signed out or on your own track.
 */
export default function FollowChip({ author, size = 36, className }) {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const [following, setFollowing] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFollowing(null);
    if (!author || !user || author === user) return undefined;
    let live = true;
    getRelationshipBetweenAccounts(user, author).then((r) => {
      if (live && r?.follows != null) setFollowing(!!r.follows);
    }).catch(() => {});
    return () => { live = false; };
  }, [author, user]);

  const toggle = useCallback((e) => {
    e.stopPropagation();
    if (!isLoggedIn() || busy || !user || author === user) return;
    const willFollow = !following;
    setBusy(true);
    setFollowing(willFollow);
    followWithAioha(author, willFollow)
      .then(() => toast.success(willFollow ? t('audio.author.followed', { author }) : t('audio.author.unfollowed', { author })))
      .catch((err) => { setFollowing(!willFollow); toast.error(err?.message || t('audio.author.failed')); })
      .finally(() => setBusy(false));
  }, [author, following, busy, user, t]);

  if (!author || !user || author === user) return null;
  return (
    <Button
      size={size}
      variant={following ? 'secondary' : 'inverse'}
      className={className}
      onClick={toggle}
      disabled={busy}
      aria-pressed={!!following}
    >
      {following ? t('common.actions.following') : t('common.actions.follow')}
    </Button>
  );
}
