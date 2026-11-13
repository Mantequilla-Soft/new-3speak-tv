import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '../v2/ui';
import { toastIn } from '../../utils/toast';
import {
  usePodcastSubscriptions, useInvalidatePodcasts, followFeeds, unfollowFeed, followErrorText, feedKey, podcastPath,
} from '../../lib/podcasts';
import './PodcastsTab.scss';

/** A playlist's podcast feed (checker routes/rss.js), always on 3speak.tv so every follower shares one show. */
export const playlistFeedUrl = (playlistId) => `https://3speak.tv/rss/playlist/${encodeURIComponent(playlistId)}.xml`;

/**
 * Follow an all-audio playlist (an album, a 3Speak podcast) the way an outside
 * podcast is followed: by its RSS feed. It then sits under Podcasts > Mine with
 * the other shows: new episodes, the bell, the filters, auto-queue.
 */
export default function PlaylistFollowButton({ playlistId, name, user }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const invalidate = useInvalidatePodcasts();
  const { data: subscriptions } = usePodcastSubscriptions(user);
  const [busy, setBusy] = useState(false);
  const url = playlistFeedUrl(playlistId);
  const sub = useMemo(() => {
    const key = feedKey(url);
    return (subscriptions || []).find((s) => s.url && (feedKey(s.url) === key || (s.keys || []).includes(key))) || null;
  }, [subscriptions, url]);

  const toggle = async () => {
    const toast = toastIn('Podcasts');
    if (!user) { toast.error(t('audio.podcasts.signInToFollow')); return; }
    setBusy(true);
    try {
      if (sub) {
        await unfollowFeed(user, sub.id);
        toast.success(t('audio.podcasts.unfollowed'));
      } else {
        const [r] = await followFeeds(user, [url], [name || '']);
        if (r?.ok || r?.already) toast.success(r.already ? t('audio.podcasts.alreadyFollowing') : t('audio.podcasts.followed'));
        else toast.error(followErrorText(r?.code, r));
      }
      invalidate();
    } catch (err) {
      toast.error(err.message || followErrorText());
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="playlist-follow">
      {/* 28d: Follow is a cyan choice; once on, a cyan tint. */}
      <Button
        variant={sub ? 'secondary' : 'cyan'}
        size={36}
        icon={sub ? 'bookmark_added' : 'bookmark_add'}
        className={`pod-btn playlist-follow__btn${sub ? ' is-on' : ''}`}
        onClick={toggle}
        disabled={busy}
        loading={busy}
        aria-pressed={!!sub}
      >
        {sub ? t('audio.podcasts.following') : t('audio.podcasts.follow')}
      </Button>
      {sub && (
        <Button variant="secondary" size={36} icon="podcasts" className="pod-btn" onClick={() => navigate(podcastPath(sub.id))}>
          {t('audio.podcasts.openShow')}
        </Button>
      )}
    </span>
  );
}
