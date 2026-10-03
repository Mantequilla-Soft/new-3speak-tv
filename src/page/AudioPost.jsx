import { useEffect, useMemo, useState } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { formatTimeAgo } from '../i18n';
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
  return formatTimeAgo(date, { style: 'narrow' });
}

function audioCover(item) {
  if (!item) return fallbackImg;
  const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
  if (!fixed || fixed === fallbackImg || fixed === '/images/speak.jpg') {
    return `/img/u/${item.owner}/avatar/small`;
  }
  return fixed;
}

function AudioPost() {
  const { t } = useTranslation();
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
        if (!p?.author) throw new Error(t('audio.post.notFound'));

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
        if (!cancelled) setError(err?.message || t('audio.post.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [author, permlink, t]);

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
    const time = ((e.clientX - rect.left) / rect.width) * total;
    audioRequestSeek(time);
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
        profile: { name: post.author, images: { avatar: `/img/u/${post.author}/avatar/small` } },
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
          <p>{error || t('audio.post.loadFailedFull')}</p>
          <Link to="/audio">{t('audio.post.backToAudio')}</Link>
        </div>
      </div>
    );
  }

  const tags = videoDetails?.tags?.slice(0, 7) || [];
  const cover = audioDoc ? audioCover(audioDoc) : `/img/u/${author}/avatar/small`;
  const pct = total > 0 ? (elapsed / total) * 100 : 0;

  return (
    <div className="audio-post-page">
      {/* Hero player */}
      <div className="audio-post-hero">
        <img className="audio-post-cover" src={cover} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
        <div className="audio-post-hero-body">
          <h1 className="audio-post-title">{post.title || (audioDoc?.title) || t('audio.post.untitled')}</h1>
          <div className="audio-post-author-row">
            <AuthorBadge author={author} showFollow tabHint="audio" />
          </div>
          <div className="audio-post-meta-row">
            <span className="audio-post-meta-item"><LuTimer /> {formatRelativeTime(post.created)}</span>
            <span className="audio-post-meta-item"><PayoutAmount amount={videoDetails.stats.total_hive_reward} size={13} /></span>
            <span className="audio-post-meta-item">{t('common.units.votes', { count: videoDetails.stats.num_votes })}</span>
            <span className="audio-post-meta-item">{t('common.units.comments', { count: videoDetails.stats.num_comments })}</span>
            {audioDoc?.plays > 0 && <span className="audio-post-meta-item">{t('audio.tile.plays', { count: audioDoc.plays })}</span>}
          </div>

          {audioDoc ? (
            <>
              <div className="audio-post-controls">
                <button
                  className={`audio-post-play-btn${isThisPlaying ? ' is-playing' : ''}`}
                  onClick={onTogglePlay}
                  aria-label={isThisPlaying ? t('common.actions.pause') : t('common.actions.play')}
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
                    toast.success(t('audio.post.addedToQueue'));
                  }}
                >
                  <MdQueueMusic size={18} /> {t('audio.player.queue')}
                </button>
                <button
                  type="button"
                  className={`audio-post-action-btn${voted ? ' is-voted' : ''}`}
                  onClick={() => {
                    if (!loggedIn) { toast.error(t('audio.post.signInToVote')); return; }
                    setShowVoteTooltip((v) => !v);
                  }}
                >
                  <MdThumbUp size={16} /> {voted ? t('audio.post.voted') : t('audio.post.vote')}
                  {voteCount > 0 && <span className="audio-post-action-count">{voteCount}</span>}
                </button>
                <button
                  type="button"
                  className="audio-post-action-btn"
                  onClick={() => {
                    if (!loggedIn) { toast.error(t('audio.post.signInToTip')); return; }
                    setIsTipOpen(true);
                  }}
                >
                  <BiDollar size={18} /> {t('audio.post.tip')}
                </button>
              </div>
            </>
          ) : (
            <p className="audio-post-no-audio">{t('audio.post.stillIndexing')}</p>
          )}

          {tags.length > 0 && (
            <div className="audio-post-tags">
              {tags.map((tag) => (
                <Link key={tag} to={`/t/${tag}`} className="audio-post-tag">#{tag}</Link>
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
