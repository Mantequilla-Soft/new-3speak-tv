import { useState, useEffect, useMemo, useCallback } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useParams, Navigate, Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import { toastIn } from '../utils/toast';
import { useAppStore } from '../lib/store';
import BlogContent from '../components/playVideo/BlogContent';
import CommentSection from '../components/playVideo/CommentSection';
import CommentVoteTooltip from '../components/tooltip/CommentVoteTooltip';
import BarLoader from '../components/Loader/BarLoader';
import AuthorBadge from '../components/AuthorBadge/AuthorBadge';
import PayoutAmount from '../components/PayoutAmount/PayoutAmount';
import TipModal from '../components/tip-reward/TipModal';
import ReportModal, { isReported } from '../components/modal/ReportModal';
import { HIVE_API_URL } from '../utils/config';
import { resolveRootPost, ensure3SpeakStatus } from '../utils/threeSpeakDetection';
import { recordReshare, getResharesForVideo } from '../utils/reshares';
import { isLoggedIn } from '../hive-api/aioha';
import useReblog from '../hooks/useReblog';
import { Button, DockTile, EmptyState } from '../components/v2/ui';
import { cx } from '../components/v2/helpers';
import AccountImg from '../components/HiveAvatar/AccountImg';
import { useTranslation } from 'react-i18next';
import { formatTimeAgo } from '../i18n';
import './PostView.scss';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

function parseAudioPermlink(audioUrl) {
  try {
    const u = new URL(audioUrl);
    const a = u.searchParams.get('a'); // "user/permlink"
    return a ? { base: u.origin, perm: a } : null;
  } catch { return null; }
}

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString.endsWith('Z') ? dateString : dateString + 'Z');
  // "3m ago" / "2d ago" in the current language.
  return formatTimeAgo(date, { style: 'narrow' });
}

// Props on /@author/permlink (App.jsx's HivePostRoute), route params on /post/.
function PostView({ author: authorProp, permlink: permlinkProp }) {
  const { t } = useTranslation();
  const params = useParams();
  const { state } = useLocation();
  const { authenticated, user: currentUser } = useAppStore();
  // Reshares are 3Speak's own store, not a chain op, so a handle works. Kept
  // separate from requireLogin, which also gates voting and replying -- those
  // DO need an account and must stay shut.
  const incubationHandle = useAppStore((st) => st.incubationHandle);

  // Support both `:author` and `:user` param names defensively
  const author = (authorProp || params.author || params.user || '').replace(/^@/, '');
  const permlink = permlinkProp || params.permlink || '';

  // Fresh-publish state from OpenPodPublish navigation
  const prefilled = (state?.author === author && state?.permlink === permlink) ? state : null;

  const [post, setPost] = useState(prefilled ? {
    title:          prefilled.title,
    author:         prefilled.author,
    permlink:       prefilled.permlink,
    created:        prefilled.created,
    active_votes:   [],
    _prefilledBody: prefilled.body,
    _tags:          prefilled.tags,
    _thumbnailUrl:  prefilled.thumbnailUrl,
    _audioUrl:      prefilled.audioUrl,
  } : null);
  const [loading, setLoading]   = useState(!prefilled);
  const [error, setError]       = useState(null);
  const [thumbnailUrl, setThumbnailUrl] = useState(prefilled?.thumbnailUrl || null);

  // Vote state
  const [isVoted, setIsVoted]         = useState(false);
  const [voteCount, setVoteCount]     = useState(0);
  const [showTooltip, setShowTooltip] = useState(false);
  const [weight, setWeight]           = useState(100);
  const [voteValue, setVoteValue]     = useState(0);
  const [accountData, setAccountData] = useState(null);
  const [reshareCount, setReshareCount] = useState(0);
  const [hasReshared, setHasReshared] = useState(false);
  const [isTipModalOpen, setIsTipModalOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);

  // Fetch the post via bridge.get_post (unless prefilled from navigation state)
  useEffect(() => {
    if (prefilled || !author || !permlink) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        let p = null;
        try {
          const res = await axios.post(getHiveUrl(), {
            jsonrpc: '2.0',
            method: 'bridge.get_post',
            params: { author, permlink, observer: '' },
            id: 1,
          });
          if (!res.data?.error) p = res.data?.result || null;
        } catch { /* fall through */ }

        if (!p || !p.author) {
          const res2 = await axios.post(getHiveUrl(), {
            jsonrpc: '2.0',
            method: 'condenser_api.get_content',
            params: [author, permlink],
            id: 1,
          });
          if (res2.data?.error) throw new Error(res2.data.error.message);
          p = res2.data?.result || null;
        }

        if (cancelled) return;
        if (!p || !p.author) throw new Error('Post not found');
        setPost(p);
        setVoteCount(p.active_votes?.length || 0);
        if (currentUser) {
          setIsVoted(p.active_votes?.some(v => v.voter === currentUser) || false);
        }
      } catch (err) {
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [author, permlink]);

  useEffect(() => {
    if (!author || !permlink) return;
    let cancelled = false;
    setReshareCount(0);
    setHasReshared(false);

    (async () => {
      try {
        const { reshares, count } = await getResharesForVideo(author, permlink);
        if (cancelled) return;
        setReshareCount(count);
        if (currentUser) {
          setHasReshared(reshares.some(r => r.username === (currentUser || incubationHandle)));
        }
      } catch (err) {
        console.warn('Failed to fetch post reshares:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [author, permlink, currentUser, incubationHandle]);

  // `action` is a key suffix ('vote'), not display text.
  const requireLogin = useCallback((action) => {
    if (authenticated && currentUser && isLoggedIn()) return true;
    toast.error(t(`posts.view.loginTo.${action}`));
    return false;
  }, [authenticated, currentUser, t]);

  const toggleVoteTooltip = useCallback(() => {
    if (!requireLogin('vote')) return;
    setShowTooltip(prev => !prev);
  }, [requireLogin]);

  const handleShare = useCallback(async () => {
    const shareUrl = `${window.location.origin}/post/${author}/${permlink}`;
    const shareData = { title: post?.title || t('posts.view.shareTitleFallback'), url: shareUrl };
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success(t('posts.view.linkCopied'));
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast.success(t('posts.view.linkCopied'));
        } catch {
          toast.error(t('posts.view.shareFailed'));
        }
      }
    }
  }, [author, permlink, post?.title, t]);

  // The real Hive reblog, next to the 3Speak "Hype" below.
  const reblog = useReblog(author, permlink, toast);

  // "Hype" in the UI: 3Speak's own reshare row, not a Hive reblog.
  const handleReshare = useCallback(async () => {
    const asWho = currentUser || incubationHandle;
    if (!authenticated || !asWho) {
      toast.error(t('common.hype.loginRequired'));
      return;
    }
    if (hasReshared) {
      toast.info(t('common.hype.hyped'));
      return;
    }

    const result = await recordReshare(asWho, author, permlink);
    if (result) {
      setHasReshared(true);
      setReshareCount(prev => prev + 1);
      toast.success(t('common.hype.success'));
    } else {
      toast.error(t('common.hype.failed'));
    }
  }, [authenticated, hasReshared, currentUser, incubationHandle, author, permlink, t]);

  const handleReply = useCallback(() => {
    const commentBox = document.querySelector('.post-view-comments .add-comment-wrap .textarea-box');
    if (commentBox) {
      commentBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => commentBox.focus(), 350);
    }
  }, []);

  // Signed out, the tip window opens on Lightning, which needs no Hive account.
  const handleTip = useCallback(() => {
    setIsTipModalOpen(true);
  }, []);

  // Fetch thumbnail from audio backend for OpenPod posts
  useEffect(() => {
    if (!post || thumbnailUrl) return;
    const parsedMeta = (() => {
      try {
        return typeof post.json_metadata === 'string'
          ? JSON.parse(post.json_metadata)
          : (post.json_metadata || {});
      } catch { return {}; }
    })();
    const audioSrc = parsedMeta.audio || post._audioUrl;
    if (!audioSrc) return;
    const parsed = parseAudioPermlink(audioSrc);
    if (!parsed) return;
    fetch(`${parsed.base}/api/audio?a=${parsed.perm}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.thumbnail_url) setThumbnailUrl(data.thumbnail_url); })
      .catch(() => {});
  }, [post]);

  // Detect content type synchronously — skip for prefilled OpenPod posts
  const { is3Speak, isShort } = useMemo(() => {
    if (!post || post._prefilledBody) return { is3Speak: false, isShort: false };

    let meta = {};
    try {
      meta = typeof post.json_metadata === 'string'
        ? JSON.parse(post.json_metadata || '{}')
        : (post.json_metadata || {});
    } catch { /* ignore */ }

    const app = (meta.app || '').toLowerCase();
    const tags = Array.isArray(meta.tags) ? meta.tags.map((t) => String(t).toLowerCase()) : [];
    const sourceMap = meta.video?.info?.sourceMap;

    const is3SpeakVideo = !post.parent_author && (
      (Array.isArray(sourceMap) && sourceMap.some((s) => s && (s.type === 'video' || (typeof s.url === 'string' && s.url.includes('3speak'))))) ||
      (typeof meta.video?.info?.video_v2 === 'string' && meta.video.info.video_v2.length > 0) ||
      (typeof meta.video?.info?.file === 'string' && meta.video.info.file.length > 0) ||
      (meta.video?.platform === '3speak' && (meta.video?.info?.duration || meta.video?.url))
    );

    const has3SpeakEmbed = typeof meta.video?.url === 'string' && meta.video.url.includes('3speak.tv/embed');
    const isShortPost = !!post.parent_author && (
      meta.video?.short === 'true' ||
      has3SpeakEmbed ||
      (tags.includes('short') && (app.startsWith('3speak') || meta.video?.platform === '3speak'))
    );

    return { is3Speak: is3SpeakVideo, isShort: isShortPost };
  }, [post]);

  const videoDetails = useMemo(() => {
    if (!post) return null;
    const payout = parseFloat(post.payout || 0) || (
      parseFloat(post.total_payout_value || '0') +
      parseFloat(post.curator_payout_value || '0') +
      parseFloat(post.pending_payout_value || '0')
    );
    return {
      title: post.title,
      body: post._prefilledBody || post.body,
      author: {
        id: post.author,
        username: post.author,
        profile: { name: post.author, images: { avatar: `/img/u/${post.author}/avatar/small` } },
      },
      stats: {
        num_comments: post.children || 0,
        num_votes: post.stats?.total_votes || post.active_votes?.length || 0,
        total_hive_reward: payout || 0,
      },
      created_at: post.created,
      community: post.category ? { _id: post.category, title: post.community_title || post.category } : null,
      tags: post._tags || (() => {
        try {
          const m = typeof post.json_metadata === 'string' ? JSON.parse(post.json_metadata) : post.json_metadata;
          return Array.isArray(m?.tags) ? m.tags : [];
        } catch { return []; }
      })(),
    };
  }, [post]);

  const [rootPost, setRootPost]         = useState(null);
  const [resolvingRoot, setResolvingRoot] = useState(false);
  const isComment = !!post?.parent_author;

  useEffect(() => {
    if (!isComment || !post?.parent_author) {
      setRootPost(null);
      return;
    }
    let cancelled = false;
    setResolvingRoot(true);
    (async () => {
      try {
        const rootKey = await resolveRootPost(`${author}/${permlink}`);
        const [rootAuthor, rootPermlink] = rootKey.split('/');
        const rootIs3Speak = await ensure3SpeakStatus(rootKey);
        if (!cancelled) {
          setRootPost({ author: rootAuthor, permlink: rootPermlink, is3Speak: rootIs3Speak });
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setResolvingRoot(false); }
    })();
    return () => { cancelled = true; };
  }, [author, permlink, isComment, post?.parent_author]);

  // Redirect shorts to /shorts player
  if (isShort && post) {
    let shortAuthor = author;
    let shortPermlink = permlink;
    try {
      const meta = typeof post.json_metadata === 'string' ? JSON.parse(post.json_metadata) : post.json_metadata;
      const embedUrl = meta?.video?.url || '';
      const vMatch = embedUrl.match(/[?&]v=([^&/]+)\/([^&]+)/);
      if (vMatch) {
        shortAuthor = vMatch[1];
        shortPermlink = vMatch[2];
      }
    } catch { /* use hive author/permlink as fallback */ }
    return <Navigate to={`/shorts?v=${shortAuthor}/${shortPermlink}`} replace />;
  }

  if (is3Speak === true && !isComment) {
    return <Navigate to={`/@${author}/${permlink}`} replace />;
  }

  if (loading) return <BarLoader />;

  if (error || !post) {
    return (
      <div className="post-view-page">
        <div className="post-view-error">
          <EmptyState
            icon="article"
            title={t('posts.view.loadFailed')}
            action={<Button as={Link} to="/notifications" variant="secondary" next>{t('posts.view.backToNotifications')}</Button>}
          />
        </div>
      </div>
    );
  }

  const parsedMeta = (() => {
    try {
      return typeof post.json_metadata === 'string'
        ? JSON.parse(post.json_metadata)
        : (post.json_metadata || {});
    } catch { return {}; }
  })();

  const tags = videoDetails?.tags?.slice(0, 7) || [];
  const resolvedThumbnail = thumbnailUrl || parsedMeta.image?.[0] || null;

  const compact = (n) => {
    try { return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0); } catch { return String(n || 0); }
  };
  const isOwnPost = currentUser === post.author;
  const reported = isReported('post', `${author}/${permlink}`);

  // The action dock (19b): a column of tiles beside the text on a wide screen,
  // a row under it on a phone. Same handlers as before.
  const dock = [
    {
      id: 'vote', icon: 'arrow_upward', label: voteCount > 0 ? compact(voteCount) : t('watch.actions.vote'),
      active: isVoted, title: isVoted ? t('posts.view.adjustVote') : t('posts.view.upvote'), onClick: toggleVoteTooltip,
    },
    {
      id: 'reply', icon: 'chat_bubble', label: videoDetails.stats.num_comments > 0 ? compact(videoDetails.stats.num_comments) : t('common.actions.reply'),
      title: t('common.actions.reply'), onClick: handleReply,
    },
    reblog.canReblog && {
      id: 'reblog', icon: 'repeat', label: reblog.armed ? reblog.label : t('common.reblog.reblog'),
      active: reblog.reblogged || reblog.armed, tone: reblog.armed ? 'cyan' : 'accent', disabled: reblog.busy,
      title: reblog.reblogged ? t('common.reblog.reblogged') : t('common.reblog.title'), onClick: reblog.press,
    },
    {
      // isLoggedIn() is the wallet check, which an incubating user never
      // passes. The reshare itself does not need one.
      id: 'hype', icon: 'local_fire_department', label: reshareCount > 0 ? compact(reshareCount) : t('common.hype.hype'),
      active: hasReshared, disabled: !authenticated || (!isLoggedIn() && !incubationHandle),
      title: !authenticated ? t('common.hype.loginRequired') : hasReshared ? t('common.hype.hyped') : t('common.hype.title'), onClick: handleReshare,
    },
    authenticated && !isOwnPost && {
      id: 'tip', icon: 'volunteer_activism', label: t('watch.actions.tip'), title: t('posts.view.tipCreator'), onClick: handleTip,
    },
    { id: 'share', icon: 'share', label: t('common.actions.share'), title: t('common.actions.share'), onClick: handleShare },
    {
      id: 'report', icon: 'flag', label: t('common.actions.report'), title: t('posts.view.reportPost'),
      active: reported, onClick: () => setIsReportOpen(true),
    },
  ].filter(Boolean);

  return (
    <div className="post-view-page">
      {isComment && (
        <div className="post-view-nav-buttons">
          {resolvingRoot && (
            <Button variant="secondary" size={36} loading disabled>{t('posts.view.resolving')}</Button>
          )}
          {!resolvingRoot && rootPost && (
            rootPost.is3Speak ? (
              <Button as={Link} to={`/@${rootPost.author}/${rootPost.permlink}`} variant="primary" size={36} icon="play_arrow">
                {t('posts.view.showVideo')}
              </Button>
            ) : (
              <Button as={Link} to={`/post/${rootPost.author}/${rootPost.permlink}`} variant="primary" size={36} icon="article">
                {t('posts.view.showPost')}
              </Button>
            )
          )}
          {!resolvingRoot && rootPost && post.parent_author && !(post.parent_author === rootPost.author && post.parent_permlink === rootPost.permlink) && (
            <Button as={Link} to={`/post/${post.parent_author}/${post.parent_permlink}`} variant="secondary" size={36} icon="reply">
              {t('posts.view.showParent')}
            </Button>
          )}
        </div>
      )}

      {videoDetails.community && (
        <Link to={`/c/${videoDetails.community._id}`} className="post-view-community">
          <span className="post-view-community__mark" aria-hidden="true">
            {String(videoDetails.community.title || '').slice(0, 1).toUpperCase()}
            <AccountImg account={videoDetails.community._id} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          </span>
          <span className="post-view-community__text">{t('posts.view.inCommunity', { community: videoDetails.community.title })}</span>
        </Link>
      )}

      <div className="post-view-grid">
        <article className="post-view-main">
          <h1 className="post-view-title">{post.title || t('posts.view.untitledReply')}</h1>

          <div className="post-view-byline">
            <AuthorBadge author={post.author} showFollow />
            <span className="post-view-byline__meta">
              <span>{formatRelativeTime(post.created)}</span>
              <span aria-hidden="true">·</span>
              <PayoutAmount amount={videoDetails.stats.total_hive_reward} size={13} />
            </span>
          </div>

          {resolvedThumbnail && (
            <img src={resolvedThumbnail} alt={post.title} className="post-view-hero" />
          )}

          <div className="post-view-body">
            {post._prefilledBody
              ? <BlogContent description={post._prefilledBody} alwaysExpanded />
              : <BlogContent author={author} permlink={permlink} alwaysExpanded />
            }
          </div>

          {tags.length > 0 && (
            <div className="post-view-tags">
              {tags.map((tag) => (
                <Link key={tag} to={`/t/${tag}`} className="post-view-tag">#{tag}</Link>
              ))}
            </div>
          )}
        </article>

        <aside className="post-view-dock" aria-label={t('watch.side.label')}>
          {dock.map((d) => (
            <DockTile
              key={d.id}
              icon={d.icon}
              label={d.label}
              active={!!d.active}
              tone={d.tone}
              title={d.title}
              aria-label={d.title}
              disabled={d.disabled}
              className={cx(`post-view-dock__${d.id}`, d.id === 'report' && d.active && 'is-reported')}
              onClick={d.onClick}
            />
          ))}
        </aside>
      </div>

      {authenticated && showTooltip && (
        <CommentVoteTooltip
          showTooltip={showTooltip}
          setShowTooltip={setShowTooltip}
          author={post.author}
          permlink={post.permlink}
          weight={weight}
          setWeight={setWeight}
          voteValue={voteValue}
          setVoteValue={setVoteValue}
          accountData={accountData}
          setAccountData={setAccountData}
          compact
          onVoteSuccess={(a, p, isNewVote) => {
            setIsVoted(true);
            if (isNewVote) setVoteCount(c => c + 1);
            setShowTooltip(false);
          }}
        />
      )}

      <div className="post-view-comments">
        <CommentSection
          videoDetails={videoDetails}
          author={author}
          permlink={permlink}
          setIsVoted={() => {}}
        />
      </div>

      {isTipModalOpen && (
        <TipModal
          recipient={post.author}
          isOpen={isTipModalOpen}
          onClose={() => setIsTipModalOpen(false)}
        />
      )}

      <ReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        type="post"
        target={{ author, permlink }}
      />
    </div>
  );
}

export default PostView;
