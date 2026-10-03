import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { usePlayer } from '@mantequilla-soft/3speak-player/react';
import { ThreeSpeakApi } from '@mantequilla-soft/3speak-player';
import { resolveVideoMeta } from '../../lib/videoMetaCache';
import { CHECKER_URL } from '../../utils/config';
import { getPlayerUrl } from '../../utils/playerUrl';
import { fetchVideoDetails } from '../../lib/videoData';
import { bodyToPlaintext } from '../../hive-api/hiveApi';
import { fetchSnaps } from '../../lib/snaps';
import { SnapCard } from './CommunitySnaps';
import TimeAgo from '../TimeAgo/TimeAgo';
import { useTranslation } from 'react-i18next';
import { formatNumber } from '../../i18n';
import './ChannelTrailer.scss';

/**
 * The video a creator pinned as their channel trailer, at the top of Overview.
 *
 * Deliberately unlabelled — a title above it would just say "trailer" to someone
 * who can already see a video playing.
 *
 * Autoplays MUTED, because that's the only kind of autoplay browsers allow
 * without a gesture; an unmute control sits on top so sound is one click away.
 * Renders nothing at all when the creator hasn't set one, so profiles without a
 * trailer don't carry an empty frame.
 */
export function useChannelTrailer(username) {
  return useQuery({
    queryKey: ['channel-trailer', username],
    enabled: !!username,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data } = await axios.get(`${CHECKER_URL}/user/${encodeURIComponent(username)}/trailer`);
      return data?.trailer || null;
    },
  });
}

export default function ChannelTrailer({ username, isOwnProfile = false, onOpenCommunityTab }) {
  const { t } = useTranslation();
  const { data: trailer } = useChannelTrailer(username);
  const [attached, setAttached] = useState(false);
  const [muted, setMuted] = useState(true);

  const author = String(trailer?.author || username || '').toLowerCase();
  const permlink = String(trailer?.permlink || '').toLowerCase();
  const valid = !!permlink
    && /^[a-z][a-z0-9.\-]{2,15}$/.test(author)
    && /^[a-z0-9-]{1,255}$/.test(permlink);

  // Title + description of the trailer post, shown beside the player.
  const { data: post } = useQuery({
    queryKey: ['channel-trailer-post', author, permlink],
    enabled: valid,
    staleTime: 10 * 60 * 1000,
    retry: 1,
    queryFn: () => fetchVideoDetails(author, permlink),
  });

  // Newest community note, shown beside the trailer. Same one-item fetch the
  // profile already makes for the Community tab count, so it's a cache hit.
  const { data: snapData } = useQuery({
    queryKey: ['community-snaps-count', username],
    enabled: !!username,
    staleTime: 60 * 1000,
    retry: 1,
    queryFn: () => fetchSnaps(username, 1, 1),
  });
  const latestSnap = snapData?.snaps?.[0] || null;

  const { ref: sdkVideoRef, state: playerState, player, load: loadVideo } = usePlayer({
    apiBase: getPlayerUrl(),
    muted: true,
    poster: true,
  });

  const videoRef = useCallback((el) => {
    // React calls a ref callback with null while unmounting, and by then the
    // player may already have torn itself down — detaching from a destroyed one
    // throws. An error thrown from a ref callback is not contained: it unmounts
    // the tree, which is why navigating from the profile to a watch page
    // sometimes left a blank screen.
    try {
      sdkVideoRef(el);
    } catch {
      /* player already destroyed — nothing left to detach from */
    }
    setAttached(!!el);
  }, [sdkVideoRef]);

  useEffect(() => {
    if (!valid || !player || !attached) return;
    loadVideo(`${author}/${permlink}`)
      .then(() => player.play?.().catch(() => {}))   // blocked autoplay is not an error worth surfacing
      .catch(() => {});
  }, [valid, author, permlink, player, attached, loadVideo]);

  // Count a view once the trailer actually starts playing — the same
  // `/api/view` call the watch page makes, so a trailer play is worth the same
  // as any other play. Deliberately WITHOUT the watch-duration session: the
  // retention/heatmap data is about how far into a video people get, and an
  // autoplaying muted loop on a profile page would poison that.
  const sdkApiRef = useRef(null);
  if (!sdkApiRef.current) sdkApiRef.current = new ThreeSpeakApi(getPlayerUrl());
  const recordedViewRef = useRef(new Set());
  useEffect(() => {
    if (!valid) return;
    if (playerState?.paused !== false) return; // only once it is really playing
    const key = `${author}/${permlink}`;
    if (recordedViewRef.current.has(key)) return;
    recordedViewRef.current.add(key);
    (async () => {
      // The URL permlink is the HIVE permlink; /api/view matches the embed
      // ASSET permlink, so sending the Hive one 404s and never counts. Shared
      // session cache, so this costs no extra /api/embed request.
      let owner = author;
      let viewPermlink = permlink;
      const meta = await resolveVideoMeta(sdkApiRef.current, author, permlink);
      if (meta?.owner) owner = meta.owner;
      if (meta?.permlink) viewPermlink = meta.permlink;
      // A video lives in exactly one collection — try embed, then legacy, and
      // stop at whichever owns it.
      for (const type of ['embed', 'legacy']) {
        try {
          const res = await fetch(`${getPlayerUrl()}/api/view`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ owner, permlink: viewPermlink, type }),
          });
          const data = await res.json().catch(() => ({}));
          if (data?.counted) break;
        } catch { /* try next type */ }
      }
    })();
  }, [valid, author, permlink, playerState?.paused]);

  // View count for the trailer post. The feeds carry `views` already, but this
  // post is fetched straight from Hive, which doesn't know about them.
  const { data: views } = useQuery({
    queryKey: ['channel-trailer-views', author, permlink],
    enabled: valid,
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data } = await axios.post(`${CHECKER_URL}/views`, { videos: [{ author, permlink }] });
      const row = (data?.views || data?.data || [])[0];
      return Number(row?.views ?? row?.count ?? 0) || 0;
    },
  });

  // No trailer yet. A visitor sees nothing; the owner gets a way to set one,
  // since the feature is invisible otherwise — there's no empty frame to click.
  if (!valid) {
    if (!isOwnProfile) return null;
    return (
      <div className="channel-trailer-empty">
        <div className="cte-text">
          <strong>{t('profile.trailer.addTitle')}</strong>
          <span>{t('profile.trailer.addBody')}</span>
        </div>
        {/* trailer=1 preselects "Mark as channel trailer" on the upload. */}
        <Link className="cte-btn" to="/embed-studio?trailer=1">{t('profile.trailer.upload')}</Link>
      </div>
    );
  }

  const fmtViews = (n) => formatNumber(n, { compact: true });

  const toggleMute = (e) => {
    const video = e.currentTarget.closest('.channel-trailer')?.querySelector('video');
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
    if (!video.muted) video.play?.().catch(() => {});
  };

  const description = bodyToPlaintext(post?.body || '');


  return (
    <div className="channel-trailer-row">
      <div className="channel-trailer">
        <video ref={videoRef} playsInline controls muted autoPlay />
        {muted && (
          <button type="button" className="channel-trailer-unmute" onClick={toggleMute}>
            🔇 {t('profile.trailer.tapForSound')}
          </button>
        )}
      </div>

      {/* Text column, clipped to the player's height — however long the post is,
          the pair stays one tidy block instead of the words running past the
          video. Anything cut off is one click away on the watch page. */}
      <div className="channel-trailer-meta">
        {post?.title ? (
          <Link className="ct-title" to={`/watch?v=${author}/${permlink}`}>{post.title}</Link>
        ) : null}
        {(views != null || post?.created_at) ? (
          <div className="ct-sub">
            {views != null ? <span>{t('profile.trailer.views', { count: views, num: fmtViews(views) })}</span> : null}
            {views != null && post?.created_at ? <span className="ct-dot">·</span> : null}
            {post?.created_at ? <TimeAgo date={post.created_at} /> : null}
          </div>
        ) : null}
        {description ? <p className="ct-desc">{description}</p> : null}
        {/* The description clips (CSS mask-fade) at the player's height, so a
            long post always has a way out to the full text on the watch page —
            same destination as clicking the title. */}
        {description ? (
          <Link className="ct-readmore" to={`/watch?v=${author}/${permlink}`}>{t('profile.trailer.readMore')}</Link>
        ) : null}
      </div>

      {/* Newest community note fills the other half beside the player. Desktop
          only (hidden on phones via CSS). Wrapped in .community-snaps so the
          SnapCard picks up the same card styling the Community tab gives it —
          those styles are scoped under that class. Clamped tighter than the
          Community tab's own cards (maxVh 0.16 vs 0.33) so the card fits the
          trailer row without being cropped. onOpenCommunityTab makes "Read
          more" and the comment button hand off to the Community tab instead
          of expanding/opening inline — there's no room for that here. */}
      {latestSnap ? (
        <div className="channel-trailer-snap">
          <div className="community-snaps">
            <SnapCard snap={latestSnap} maxVh={0.16} onOpenTab={onOpenCommunityTab} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
