import { Icon } from '../components/v2/Icon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getHiveUrl } from '../utils/hiveNode';
import { useParams, Link, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { formatTimeAgo } from '../i18n';
import { toastIn } from '../utils/toast';
import { useAppStore } from '../lib/store';
import { CHECKER_URL } from '../utils/config';
import BlogContent from '../components/playVideo/BlogContent';
import CommentSection from '../components/playVideo/CommentSection';
import BarLoader from '../components/Loader/BarLoader';
import PayoutAmount from '../components/PayoutAmount/PayoutAmount';
import UpvoteCount from '../components/UpvoteCount/UpvoteCount';
import CommentVoteTooltip from '../components/tooltip/CommentVoteTooltip';
import TipModal from '../components/tip-reward/TipModal';
import AddToPlaylistModal from '../components/AddToPlaylistModal/AddToPlaylistModal';
import AccountImg from '../components/HiveAvatar/AccountImg';
import Waveform from '../components/GlobalAudioPlayer/Waveform';
import AudioHypeButton from '../components/GlobalAudioPlayer/AudioHypeButton';
import FollowChip from '../components/GlobalAudioPlayer/FollowChip';
import useAudioComments from '../components/GlobalAudioPlayer/useAudioComments';
import { AudioShareDropdown } from '../components/GlobalAudioPlayer/GlobalAudioPlayer';
import { SKIP_BACK, SKIP_FORWARD } from '../components/GlobalAudioPlayer/playerMath';
import { Button, DockTile, Segmented } from '../components/v2/ui';
import { cx } from '../components/v2/helpers';
import { canSubscribe, setCommunitySubscription } from '../components/Communities/communitySubscribe';
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
  const audioQueue = useAppStore((s) => s.audioQueue);
  const audioPlayAt = useAppStore((s) => s.audioPlayAt);
  const user = useAppStore((s) => s.user);
  const incubationHandle = useAppStore((s) => s.incubationHandle);
  const navigate = useNavigate();
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
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // The panel beside the player (18b): the queue, or the notes (comments).
  const [sideTab, setSideTab] = useState('queue');
  // The community it was posted in, for the strip on top (18b).
  const [communityState, setCommunity] = useState(null);
  const [joinBusy, setJoinBusy] = useState(false);
  const commentsRef = useRef(null);

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
              } catch { /* not indexed yet */ }
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

  // The community it was posted in: its title, members and whether you joined.
  const communityId = post?.community || (/^hive-\d+$/.test(post?.category || '') ? post.category : null);
  useEffect(() => {
    if (!communityId) return undefined;
    let live = true;
    axios.post(getHiveUrl(), {
      jsonrpc: '2.0', id: 1, method: 'bridge.get_community', params: { name: communityId, observer: user || '' },
    }).then(({ data }) => {
      const c = data?.result;
      if (live && c) setCommunity({ id: communityId, title: c.title, subscribers: c.subscribers, subscribed: !!c.context?.subscribed });
    }).catch(() => {});
    return () => { live = false; };
  }, [communityId, user]);

  // Comments tied to a moment: pins on the waveform and the Notes panel.
  const comments = useAudioComments(author, permlink, !!post);

  // The waveform reads the playhead from the global player's state.
  const docId = audioDoc?._id || null;
  const clockRef = useMemo(() => ({
    current: {
      get currentTime() {
        const st = useAppStore.getState();
        return docId && st.audioCurrent?._id === docId ? st.audioCurrentTime : 0;
      },
    },
  }), [docId]);

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
  const title = post.title || (audioDoc?.title) || t('audio.post.untitled');
  const samples = audioDoc?.waveform?.[0]?.length ? audioDoc.waveform[0] : null;
  const isOwner = !!user && user === author;
  const community = communityState?.id === communityId ? communityState : null;
  const communityLabel = community?.title || post.community_title || communityId;

  const seekFraction = (f) => {
    if (!audioDoc || !(total > 0)) return;
    if (isThisCurrent) audioRequestSeek(f * total);
    else audioPlayAt(audioDoc, f * total);
  };
  const skip = (delta) => {
    if (!isThisCurrent) return;
    audioRequestSeek(Math.max(0, Math.min(total || Infinity, elapsed + delta)));
  };
  const seekTo = (sec) => {
    if (!audioDoc) return;
    if (isThisCurrent) audioRequestSeek(sec); else audioPlayAt(audioDoc, sec);
  };

  // Eyebrow: KIND · GENRE · LENGTH (18b).
  const CATEGORY_KEYS = { podcast: 'audio.categories.podcast', voice_message: 'audio.categories.voice', song: 'audio.categories.music', music: 'audio.categories.music', audiobook: 'audio.categories.audiobook', interview: 'audio.categories.interview' };
  const eyebrow = [
    t(CATEGORY_KEYS[audioDoc?.category] || 'audio.categories.voice'),
    audioDoc?.genre ? String(audioDoc.genre) : null,
    total > 0 ? fmt(total) : null,
  ].filter(Boolean).join(' · ');

  const timed = comments.items.filter((c) => c.at != null);
  const pins = total > 0 ? timed.filter((c) => c.at <= total).map((c) => ({
    key: c.permlink, f: c.at / total, at: c.at, label: c.author.slice(0, 1).toUpperCase(),
    title: `@${c.author} ${fmt(c.at)}: ${c.text.slice(0, 80)}`,
  })) : [];
  const commentCount = Math.max(comments.items.length, videoDetails?.stats?.num_comments || 0);

  const joinCommunity = async () => {
    if (!communityId || joinBusy) return;
    if (!canSubscribe({ authenticated, incubationHandle })) { toast.error(t('communities.page.loginToSubscribe')); return; }
    const next = !community?.subscribed;
    const label = communityLabel;
    setJoinBusy(true);
    try {
      const { onChain } = await setCommunitySubscription({
        id: communityId,
        next,
        incubationHandle,
        prompt: next ? t('communities.page.subscribeTo', { label }) : t('communities.page.unsubscribeFrom', { label }),
      });
      setCommunity((c) => ({
        ...(c || {}),
        id: communityId,
        subscribed: next,
        subscribers: onChain && typeof c?.subscribers === 'number' ? Math.max(0, c.subscribers + (next ? 1 : -1)) : c?.subscribers,
      }));
      toast.success(next ? t('communities.page.subscribedTo', { label }) : t('communities.page.unsubscribedFrom', { label }));
    } catch (err) {
      toast.error(t('communities.page.subscriptionFailed', { error: err?.message || t('communities.page.unknownError') }));
    } finally {
      setJoinBusy(false);
    }
  };

  const openVote = () => {
    if (!loggedIn) { toast.error(t('audio.post.signInToVote')); return; }
    setShowVoteTooltip((v) => !v);
  };
  const queued = !!audioDoc && audioQueue.some((i) => i._id === audioDoc._id);
  const addToQueue = () => {
    if (!audioDoc) return;
    audioAddToQueue(audioDoc);
    toast.success(t('audio.post.addedToQueue'));
  };
  const showComments = () => commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="audio-post-page">
      {/* Where it was posted, and its album (18b community strip). */}
      {(communityId || audioDoc?.playlist_name) && (
        <div className="audio-post-strip">
          {communityId ? (
            <button type="button" className="audio-post-strip__link" onClick={() => navigate(`/community/${communityId}`)}>
              <span className="audio-post-strip__mark" aria-hidden="true">
                {String(communityLabel || '').replace(/^hive-/, '').slice(0, 1).toUpperCase()}
                <AccountImg account={communityId} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              </span>
              <span className="audio-post-strip__text">
                <span className="is-muted">{t('watch.community.postedIn')}</span>{' '}
                <b>{communityLabel}</b>
                {community?.subscribers != null && <span className="is-muted"> · {t('watch.community.members', { count: community.subscribers })}</span>}
              </span>
            </button>
          ) : <span className="audio-post-strip__space" />}
          {audioDoc?.playlist_name && (
            <Link className="audio-post-strip__album" to={audioDoc.playlist_id ? `/playlist/${audioDoc.playlist_id}` : '#'}>
              <span>{t('audio.post.albumLabel')} <b>{audioDoc.playlist_name}</b></span>
            </Link>
          )}
          {communityId && (
            <Button
              variant={community?.subscribed ? 'secondary' : 'cyan'}
              size={32}
              className="audio-post-strip__join"
              onClick={joinCommunity}
              loading={joinBusy}
              aria-pressed={!!community?.subscribed}
            >
              {community?.subscribed ? t('communities.page.subscribed') : t('chat.channels.join')}
            </Button>
          )}
        </div>
      )}

      <div className="audio-post-grid">
        {/* The player (18b): cover, title, the waveform with its notes, the dock. */}
        <section className="audio-post-card">
          <div className="audio-post-hero">
            <img className="audio-post-cover" src={cover} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
            <div className="audio-post-hero-body">
              <div className="v2-eyebrow is-cyan audio-post-eyebrow">{eyebrow}</div>
              <h1 className="audio-post-title">{title}</h1>
              <div className="audio-post-by">
                <Link to={`/@${author}?tab=audio`} className="audio-post-by__who">
                  <img className="audio-post-by__avatar" src={`/img/u/${author}/avatar/small`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  <b>{author}</b>
                </Link>
                <span className="audio-post-by__meta">
                  {audioDoc?.plays > 0 && <span>· {t('audio.tile.plays', { count: audioDoc.plays })}</span>}
                  <span>· {formatRelativeTime(post.created)}</span>
                </span>
                <span className="audio-post-by__money"><PayoutAmount amount={videoDetails.stats.total_hive_reward} size={12} /></span>
                <span className="audio-post-by__votes"><UpvoteCount count={voteCount} voted={voted} onClick={openVote} size={12} /></span>
                {!isOwner && loggedIn && <FollowChip author={author} size={32} className="audio-post-follow" />}
              </div>
            </div>
          </div>

          {audioDoc ? (
            <>
              <div className="audio-post-wave">
                {samples ? (
                  <Waveform
                    className="audio-post-wave__canvas"
                    barPx={6}
                    samples={samples}
                    audioRef={clockRef}
                    duration={total}
                    playhead={isThisCurrent}
                    pins={pins}
                    onPin={(p) => { seekTo(p.at); setSideTab('notes'); }}
                    onSeek={seekFraction}
                  />
                ) : (
                  <div className="audio-post-progress" onClick={onSeek}>
                    <div className="audio-post-progress-fill" style={{ width: `${total > 0 ? (elapsed / total) * 100 : 0}%` }} />
                  </div>
                )}
              </div>
              <div className="audio-post-times num">
                <span>{fmt(elapsed)}</span>
                <span>{fmt(total)}</span>
              </div>

              <div className="audio-post-controls">
                <button
                  type="button"
                  className="audio-post-play-btn"
                  onClick={onTogglePlay}
                  aria-label={isThisPlaying ? t('common.actions.pause') : t('common.actions.play')}
                >
                  <Icon name={isThisPlaying ? 'pause' : 'play_arrow'} size={40} fill />
                </button>
                <button type="button" className="audio-post-skip" onClick={() => skip(-SKIP_BACK)} disabled={!isThisCurrent} aria-label={t('audio.player.skipBack', { seconds: SKIP_BACK })} title={t('audio.player.skipBack', { seconds: SKIP_BACK })}>
                  <Icon name={`replay_${SKIP_BACK}`} size={24} />
                </button>
                <button type="button" className="audio-post-skip" onClick={() => skip(SKIP_FORWARD)} disabled={!isThisCurrent} aria-label={t('audio.player.skipForward', { seconds: SKIP_FORWARD })} title={t('audio.player.skipForward', { seconds: SKIP_FORWARD })}>
                  <Icon name={`forward_${SKIP_FORWARD}`} size={24} />
                </button>
                <span className="audio-post-controls__space" />
                <div className="audio-post-dock">
                  <AudioHypeButton author={author} permlink={permlink} variant="tile" />
                  <DockTile icon="chat_bubble" label={String(commentCount)} fill={false} onClick={showComments} aria-label={t('audio.item.comments')} title={t('audio.item.comments')} />
                  {loggedIn && <DockTile icon="playlist_add" label={t('common.actions.save')} fill={false} onClick={() => setPlaylistOpen(true)} title={t('engagement.cardMenu.addToPlaylist')} />}
                  {!isOwner && <DockTile icon="volunteer_activism" label={t('audio.post.tip')} fill={false} onClick={() => setIsTipOpen(true)} />}
                  <DockTile icon="ios_share" label={t('common.actions.share')} fill={false} active={shareOpen} tone="cyan" onClick={() => setShareOpen(true)} aria-haspopup="dialog" />
                </div>
              </div>
            </>
          ) : (
            <p className="audio-post-no-audio">{t('audio.post.stillIndexing')}</p>
          )}
        </section>

        {/* Beside it (18b): what plays next, and the notes left at a moment. */}
        <aside className="audio-post-side">
          <Segmented
            className="audio-post-side__tabs"
            size={36}
            label={t('audio.player.queue')}
            value={sideTab}
            onChange={setSideTab}
            options={[
              { value: 'queue', label: t('audio.player.queue'), count: audioQueue.length || undefined },
              { value: 'notes', label: t('audio.post.notes'), count: comments.items.length || undefined },
            ]}
          />
          <div className="audio-post-side__body">
            {sideTab === 'queue' ? (
              <>
                {audioQueue.length === 0 ? (
                  <p className="audio-post-side__note"><Icon name="queue_music" size={20} />{t('audio.player.queueEmpty')}</p>
                ) : (
                  <ul className="audio-post-queue">
                    {audioQueue.map((item) => {
                      const current = audioCurrent?._id === item._id;
                      return (
                        <li key={item._id}>
                          <button type="button" className={cx('audio-post-queue__row', current && 'is-current')} onClick={() => audioPlay(item, audioQueue)}>
                            <span className="audio-post-queue__thumb">
                              <img src={audioCover(item)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                              {current && <span className="audio-post-queue__now" aria-hidden="true"><Icon name="graphic_eq" size={20} /></span>}
                            </span>
                            <span className="audio-post-queue__text">
                              <b>{item.title || t('audio.untitled')}</b>
                              <span>@{item.owner}</span>
                            </span>
                            <span className="audio-post-queue__dur num">{fmt(item.duration)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {audioDoc && !queued && (
                  <Button size={40} icon="queue_music" block className="audio-post-side__add" onClick={addToQueue}>
                    {t('audio.podcasts.addToQueue')}
                  </Button>
                )}
              </>
            ) : comments.items.length ? (
              <ul className="audio-post-notes">
                {comments.items.map((c) => (
                  <li key={c.permlink} className="audio-post-note">
                    <img className="audio-post-note__avatar" src={`/img/u/${c.author}/avatar/small`} alt="" loading="lazy" />
                    <div className="audio-post-note__body">
                      <div className="audio-post-note__who">
                        <b>{c.author}</b>
                        {c.at != null && <button type="button" className="audio-post-note__time num" onClick={() => seekTo(c.at)}>{fmt(c.at)}</button>}
                      </div>
                      <p>{c.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="audio-post-side__note">{comments.loading ? t('common.status.loading') : t('comments.section.empty')}</p>
            )}
          </div>
        </aside>
      </div>

      {tags.length > 0 && (
        <div className="audio-post-tags">
          {tags.map((tag) => (
            <Link key={tag} to={`/t/${tag}`} className="v2-chip h28 audio-post-tag">#{tag}</Link>
          ))}
        </div>
      )}

      <div className="audio-post-body">
        <BlogContent author={author} permlink={permlink} description={post.body} defaultExpanded />
      </div>

      <div className="audio-post-comments" ref={commentsRef}>
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
        <TipModal recipient={author} permlink={permlink} memoLink={`https://3speak.tv/audio/${author}/${permlink}`} isOpen={isTipOpen} onClose={() => setIsTipOpen(false)} />
      )}

      {playlistOpen && (
        <AddToPlaylistModal
          isOpen={playlistOpen}
          onClose={() => setPlaylistOpen(false)}
          author={author}
          permlink={permlink}
          videoTitle={title}
          audioCategory={audioDoc?.category || ''}
        />
      )}

      {shareOpen && audioDoc && (
        <div className="audio-share-overlay" onClick={() => setShareOpen(false)}>
          <div className="audio-share-popup" onClick={(e) => e.stopPropagation()}>
            <AudioShareDropdown
              item={{ ...audioDoc, post_permlink: audioDoc.post_permlink || permlink }}
              onClose={() => setShareOpen(false)}
              title={t('audio.share.title')}
              at={isThisCurrent ? elapsed : undefined}
              duration={total}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default AudioPost;
