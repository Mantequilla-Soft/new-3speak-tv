import { useState, useEffect, useMemo, useCallback } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useParams, Navigate, Link, useLocation } from 'react-router-dom';
import axios from 'axios';
import { toastIn } from '../utils/toast';
import { useAppStore } from '../lib/store';
import BlogContent from '../components/playVideo/BlogContent';
import CommentSection from '../components/playVideo/CommentSection';
import UpvoteCount from '../components/UpvoteCount/UpvoteCount';
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
import { LuTimer } from 'react-icons/lu';
import { Repeat2 } from 'lucide-react';
import { MdAttachMoney, MdComment, MdFlag, MdShare } from 'react-icons/md';
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
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function PostView() {
  const params = useParams();
  const { state } = useLocation();
  const { authenticated, user: currentUser } = useAppStore();

  // Support both `:author` and `:user` param names defensively
  const author = (params.author || params.user || '').replace(/^@/, '');
  const permlink = params.permlink || '';

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
          setHasReshared(reshares.some(r => r.username === currentUser));
        }
      } catch (err) {
        console.warn('Failed to fetch post reshares:', err);
      }
    })();

    return () => { cancelled = true; };
  }, [author, permlink, currentUser]);

  const requireLogin = useCallback((action) => {
    if (authenticated && currentUser && isLoggedIn()) return true;
    toast.error(`Log in to ${action}`);
    return false;
  }, [authenticated, currentUser]);

  const toggleVoteTooltip = useCallback(() => {
    if (!requireLogin('vote')) return;
    setShowTooltip(prev => !prev);
  }, [requireLogin]);

  const handleShare = useCallback(async () => {
    const shareUrl = `${window.location.origin}/post/${author}/${permlink}`;
    const shareData = { title: post?.title || '3Speak Post', url: shareUrl };
    try {
      if (navigator.share && navigator.canShare?.(shareData)) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success('Link copied to clipboard!');
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(shareUrl);
          toast.success('Link copied to clipboard!');
        } catch {
          toast.error('Failed to share');
        }
      }
    }
  }, [author, permlink, post?.title]);

  const handleReshare = useCallback(async () => {
    if (!requireLogin('reblog')) return;
    if (hasReshared) {
      toast.info('Already reblogged');
      return;
    }

    const result = await recordReshare(currentUser, author, permlink);
    if (result) {
      setHasReshared(true);
      setReshareCount(prev => prev + 1);
      toast.success('Reblogged!');
    } else {
      toast.error('Failed to reblog');
    }
  }, [requireLogin, hasReshared, currentUser, author, permlink]);

  const handleReply = useCallback(() => {
    const commentBox = document.querySelector('.post-view-comments .add-comment-wrap .textarea-box');
    if (commentBox) {
      commentBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => commentBox.focus(), 350);
    }
  }, []);

  const handleTip = useCallback(() => {
    if (!requireLogin('tip')) return;
    setIsTipModalOpen(true);
  }, [requireLogin]);

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
        profile: { name: post.author, images: { avatar: `https://images.hive.blog/u/${post.author}/avatar/small` } },
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
    return <Navigate to={`/watch?v=${author}/${permlink}`} replace />;
  }

  if (loading) return <BarLoader />;

  if (error || !post) {
    return (
      <div className="post-view-page">
        <div className="post-view-error">
          <p>Could not load this post.</p>
          <Link to="/notifications">← Back to notifications</Link>
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

  return (
    <div className="post-view-page">
      {resolvedThumbnail && (
        <img src={resolvedThumbnail} alt={post.title} className="post-view-thumbnail" />
      )}

      {isComment && (
        <div className="post-view-nav-buttons">
          {resolvingRoot && (
            <span className="post-view-nav-btn post-view-nav-btn-secondary">
              <i className="fa-solid fa-spinner fa-spin" /> Resolving…
            </span>
          )}
          {!resolvingRoot && rootPost && (
            rootPost.is3Speak ? (
              <Link to={`/watch?v=${rootPost.author}/${rootPost.permlink}`} className="post-view-nav-btn">
                <i className="fa-solid fa-play" /> Show Video
              </Link>
            ) : (
              <Link to={`/post/${rootPost.author}/${rootPost.permlink}`} className="post-view-nav-btn">
                <i className="fa-solid fa-file-lines" /> Show Post
              </Link>
            )
          )}
          {!resolvingRoot && rootPost && post.parent_author && !(post.parent_author === rootPost.author && post.parent_permlink === rootPost.permlink) && (
            <Link
              to={`/post/${post.parent_author}/${post.parent_permlink}`}
              className="post-view-nav-btn post-view-nav-btn-secondary"
            >
              <i className="fa-solid fa-reply" /> Show Parent Comment
            </Link>
          )}
        </div>
      )}

      <div className="post-view-inner">
        <h1 className="post-view-title">{post.title || '(untitled reply)'}</h1>

        <div className="post-view-author-row">
          <AuthorBadge author={post.author} showFollow />
          {videoDetails.community && (
            <Link to={`/c/${videoDetails.community._id}`} className="post-view-community">
              in {videoDetails.community.title}
            </Link>
          )}
        </div>

        <div className="post-view-meta-row">
          <span className="post-view-meta-item">
            <LuTimer /> {formatRelativeTime(post.created)}
          </span>
          <span className="post-view-meta-item">
            <PayoutAmount amount={videoDetails.stats.total_hive_reward} size={13} />
          </span>
          <span className="post-view-meta-item">
            {videoDetails.stats.num_votes} votes
          </span>
          <span className="post-view-meta-item">
            {videoDetails.stats.num_comments} comments
          </span>
        </div>

        {tags.length > 0 && (
          <div className="post-view-tags">
            {tags.map((t) => (
              <Link key={t} to={`/t/${t}`} className="post-view-tag">#{t}</Link>
            ))}
          </div>
        )}

        <div className="post-view-body">
          {post._prefilledBody
            ? <BlogContent description={post._prefilledBody} alwaysExpanded />
            : <BlogContent author={author} permlink={permlink} alwaysExpanded />
          }
        </div>

        <div className="post-view-actions">
          <div className="post-view-actions-primary">
            <button
              type="button"
              className={`post-action-btn post-action-btn-vote${isVoted ? ' active' : ''}`}
              onClick={toggleVoteTooltip}
              title={isVoted ? 'Adjust vote' : 'Upvote'}
            >
              <UpvoteCount
                count={voteCount}
                voted={isVoted}
                size={15}
              />
            </button>
            <button type="button" className="post-action-btn" onClick={handleReply} title="Reply">
              <MdComment size={17} />
              <span>Reply</span>
            </button>
          </div>

          <div className="post-view-actions-secondary">
            <button type="button" className="post-icon-action" onClick={handleShare} title="Share">
              <MdShare size={17} />
            </button>
            <button
              type="button"
              className={`post-icon-action post-reshare-action${hasReshared ? ' active' : ''}`}
              onClick={handleReshare}
              disabled={!authenticated || !isLoggedIn()}
              title={!authenticated ? 'Log in to reblog' : hasReshared ? 'Reblogged' : 'Reblog'}
            >
              <Repeat2 size={16} />
              {reshareCount > 0 && <span>{reshareCount}</span>}
            </button>
            {authenticated && currentUser !== post.author && (
              <button type="button" className="post-icon-action post-tip-action" onClick={handleTip} title="Tip creator">
                <MdAttachMoney size={17} />
              </button>
            )}
            <button
              type="button"
              className={`post-icon-action post-report-action${isReported('post', `${author}/${permlink}`) ? ' reported' : ''}`}
              onClick={() => setIsReportOpen(true)}
              title="Report post"
            >
              <MdFlag size={17} />
            </button>
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
        </div>

        <div className="post-view-comments">
          <CommentSection
            videoDetails={videoDetails}
            author={author}
            permlink={permlink}
            setIsVoted={() => {}}
          />
        </div>
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
