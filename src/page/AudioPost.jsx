import { useEffect, useMemo, useState } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { MdPlayArrow, MdPause, MdQueueMusic, MdThumbUp } from 'react-icons/md';
import { BiDollar } from 'react-icons/bi';
import { LuTimer } from 'react-icons/lu';
import { toastIn } from '../utils/toast';
import { useAppStore } from '../lib/store';
import { CHECKER_URL, HIVE_API_URL } from '../utils/config';
import BlogContent from '../components/playVideo/BlogContent';
import CommentSection from '../components/playVideo/CommentSection';
import BarLoader from '../components/Loader/BarLoader';
import AuthorBadge from '../components/AuthorBadge/AuthorBadge';
import PayoutAmount from '../components/PayoutAmount/PayoutAmount';
import CommentVoteTooltip from '../components/tooltip/CommentVoteTooltip';
import TipModal from '../components/tip-reward/TipModal';
import { fixVideoThumbnail, fallbackImg } from '../utils/fixThumbnails';
import { isLoggedIn } from '../hive-api/aioha';
import './AudioPost.scss';

// Every toast from this module is headed "Post"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Post');

function fmt(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const s = Math.floor(sec);
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatRelativeTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString + (dateString.endsWith('Z') ? '' : 'Z'));
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

function audioCover(item) {
  if (!item) return fallbackImg;
  const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
  if (!fixed || fixed === fallbackImg || fixed === '/images/speak.jpg') {
    return `https://images.hive.blog/u/${item.owner}/avatar/small`;
  }
  return fixed;
}

function AudioPost() {
  const params = useParams();
  const author = (params.author || '').replace(/^@/, '');
  const permlink = params.permlink || '';

  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioCurrentTime = useAppStore((s) => s.audioCurrentTime);
  const audioDuration = useAppStore((s) => s.audioDuration);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const audioRequestSeek = useAppStore((s) => s.audioRequestSeek);
  const authenticated = useAppStore((s) => s.authenticated);
  const loggedIn = authenticated && isLoggedIn();

  const [post, setPost] = useState(null);
  const [audioDoc, setAudioDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Vote tooltip + tip modal state
  const [showVoteTooltip, setShowVoteTooltip] = useState(false);
  const [weight, setWeight] = useState(100);
  const [voteValue, setVoteValue] = useState(0);
  const [accountData, setAccountData] = useState(null);
  const [voted, setVoted] = useState(false);
  const [voteCount, setVoteCount] = useState(0);
  const [isTipOpen, setIsTipOpen] = useState(false);

  // Once the post loads, seed vote count + voted-by-me flag
  useEffect(() => {
    if (!post) return;
    setVoteCount(post.active_votes?.length || post.stats?.total_votes || 0);
    const me = useAppStore.getState().user;
    setVoted(!!post.active_votes?.some((v) => v.voter === me));
  }, [post]);

  // Fetch the Hive post + the linked audio doc
  useEffect(() => {
    if (!author || !permlink) return;
    let cancelled = false;
    setLoading(true); setError(null);

    (async () => {
      try {
        const [postRes, audioRes] = await Promise.all([
          // Bridge first; fall back to condenser if bridge errors
          axios.post(getHiveUrl(), {
            jsonrpc: '2.0', method: 'bridge.get_post',
            params: { author, permlink, observer: '' }, id: 1,
          }).catch(() => null),
          axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(author)}&limit=100`).catch(() => ({ data: {} })),
        ]);

        let p = postRes?.data?.result;
        if (!p) {
          const fb = await axios.post(getHiveUrl(), {
            jsonrpc: '2.0', method: 'condenser_api.get_content',
            params: [author, permlink], id: 1,
          });
          p = fb.data?.result;
        }
        if (!p?.author) throw new Error('Post not found');

        // Find the audio doc whose post_permlink matches this Hive permlink.
        // Prefer that, else extract from the body (handles cases the audioHiveSync
        // hasn't reconciled yet).
        const owned = audioRes?.data?.audio || [];
        let doc = owned.find((a) => a.post_permlink === permlink);
        if (!doc) {
          const m = (p.body || '').match(/audio\.3speak\.tv\/play\?a=([^\s)]+)/);
          if (m) {
            doc = owned.find((a) => a.permlink === m[1]) || null;
            if (!doc) {
              try {
                const { data } = await axios.get(
                  `${CHECKER_URL}/audio?owner=${encodeURIComponent(author)}&permlink=${encodeURIComponent(m[1])}&limit=1`
                );
                doc = data?.audio?.[0] || null;
              } catch {}
            }
          }
        }

        if (cancelled) return;
        setPost(p);
        setAudioDoc(doc || null);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Could not load this audio post');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [author, permlink]);

  const isThisCurrent = audioDoc && audioCurrent?._id === audioDoc._id;
  const isThisPlaying = isThisCurrent && audioIsPlaying;
  const elapsed = isThisCurrent ? audioCurrentTime : 0;
  const total = isThisCurrent && audioDuration > 0 ? audioDuration : (audioDoc?.duration || 0);

  const onTogglePlay = () => {
    if (!audioDoc) return;
    if (isThisCurrent) audioRequestToggle();
    else audioPlay(audioDoc, [audioDoc]);
  };

  const onSeek = (e) => {
    if (!isThisCurrent || !total) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * total;
    audioRequestSeek(t);
  };

  // Build a videoDetails-shaped object so CommentSection can consume it
  const videoDetails = useMemo(() => {
    if (!post) return null;
    const payout = parseFloat(post.payout || 0) || (
      parseFloat(post.total_payout_value || 0) +
      parseFloat(post.curator_payout_value || 0) +
      parseFloat(post.pending_payout_value || '0')
    );
    return {
      title: post.title,
      body: post.body,
      author: {
        id: post.author, username: post.author,
        profile: { name: post.author, images: { avatar: `https://images.hive.blog/u/${post.author}/avatar/small` } },
      },
      stats: {
        num_comments: post.children || 0,
        num_votes: post.stats?.total_votes || post.active_votes?.length || 0,
        total_hive_reward: payout || 0,
      },
      created_at: post.created,
      community: post.category ? { _id: post.category, title: post.community_title || post.category } : null,
      tags: (() => {
        try {
          const m = typeof post.json_metadata === 'string' ? JSON.parse(post.json_metadata) : post.json_metadata;
          return Array.isArray(m?.tags) ? m.tags : [];
        } catch { return []; }
      })(),
    };
  }, [post]);

  if (loading) return <BarLoader />;
  if (error || !post) {
    return (
      <div className="audio-post-page">
        <div className="audio-post-error">
          <p>{error || 'Could not load this audio post.'}</p>
          <Link to="/audio">← Back to Audio</Link>
        </div>
      </div>
    );
  }

  const tags = videoDetails?.tags?.slice(0, 7) || [];
  const cover = audioDoc ? audioCover(audioDoc) : `https://images.hive.blog/u/${author}/avatar/small`;
  const pct = total > 0 ? (elapsed / total) * 100 : 0;

  return (
    <div className="audio-post-page">
      {/* Hero player */}
      <div className="audio-post-hero">
        <img className="audio-post-cover" src={cover} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
        <div className="audio-post-hero-body">
          <h1 className="audio-post-title">{post.title || (audioDoc?.title) || '(untitled)'}</h1>
          <div className="audio-post-author-row">
            <AuthorBadge author={author} showFollow tabHint="audio" />
          </div>
          <div className="audio-post-meta-row">
            <span className="audio-post-meta-item"><LuTimer /> {formatRelativeTime(post.created)}</span>
            <span className="audio-post-meta-item"><PayoutAmount amount={videoDetails.stats.total_hive_reward} size={13} /></span>
            <span className="audio-post-meta-item">{videoDetails.stats.num_votes} votes</span>
            <span className="audio-post-meta-item">{videoDetails.stats.num_comments} comments</span>
            {audioDoc?.plays > 0 && <span className="audio-post-meta-item">{audioDoc.plays} plays</span>}
          </div>

          {audioDoc ? (
            <>
              <div className="audio-post-controls">
                <button
                  className={`audio-post-play-btn${isThisPlaying ? ' is-playing' : ''}`}
                  onClick={onTogglePlay}
                  aria-label={isThisPlaying ? 'Pause' : 'Play'}
                >
                  {isThisPlaying ? <MdPause size={36} /> : <MdPlayArrow size={36} />}
                </button>
                <div className="audio-post-time-track">
                  <span className="audio-post-time">{fmt(elapsed)}</span>
                  <div className="audio-post-progress" onClick={onSeek}>
                    <div className="audio-post-progress-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="audio-post-time">{fmt(total)}</span>
                </div>
              </div>

              <div className="audio-post-actions">
                <button
                  type="button"
                  className="audio-post-action-btn"
                  onClick={() => {
                    audioAddToQueue(audioDoc);
                    toast.success('Added to queue');
                  }}
                >
                  <MdQueueMusic size={18} /> Queue
                </button>
                <button
                  type="button"
                  className={`audio-post-action-btn${voted ? ' is-voted' : ''}`}
                  onClick={() => {
                    if (!loggedIn) { toast.error('Sign in to vote'); return; }
                    setShowVoteTooltip((v) => !v);
                  }}
                >
                  <MdThumbUp size={16} /> {voted ? 'Voted' : 'Vote'}
                  {voteCount > 0 && <span className="audio-post-action-count">{voteCount}</span>}
                </button>
                <button
                  type="button"
                  className="audio-post-action-btn"
                  onClick={() => {
                    if (!loggedIn) { toast.error('Sign in to tip'); return; }
                    setIsTipOpen(true);
                  }}
                >
                  <BiDollar size={18} /> Tip
                </button>
              </div>
            </>
          ) : (
            <p className="audio-post-no-audio">Audio for this post is still being indexed — try again in a few minutes.</p>
          )}

          {tags.length > 0 && (
            <div className="audio-post-tags">
              {tags.map((t) => (
                <Link key={t} to={`/t/${t}`} className="audio-post-tag">#{t}</Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="audio-post-body">
        <BlogContent author={author} permlink={permlink} description={post.body} defaultExpanded />
      </div>

      <div className="audio-post-comments">
        <CommentSection
          videoDetails={videoDetails}
          author={author}
          permlink={permlink}
          setIsVoted={() => {}}
        />
      </div>

      {showVoteTooltip && (
        <CommentVoteTooltip
          author={author}
          permlink={permlink}
          showTooltip={showVoteTooltip}
          setShowTooltip={setShowVoteTooltip}
          weight={weight} setWeight={setWeight}
          voteValue={voteValue} setVoteValue={setVoteValue}
          accountData={accountData} setAccountData={setAccountData}
          compact
          onVoteSuccess={() => {
            setShowVoteTooltip(false);
            setVoted(true);
            setVoteCount((c) => c + 1);
          }}
        />
      )}

      {isTipOpen && (
        <TipModal recipient={author} isOpen={isTipOpen} onClose={() => setIsTipOpen(false)} />
      )}
    </div>
  );
}

export default AudioPost;
