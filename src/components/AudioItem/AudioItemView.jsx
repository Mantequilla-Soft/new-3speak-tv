import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  MdArrowBack, MdPlayArrow, MdPause, MdPlaylistAdd, MdPlaylistAddCheck, MdLink, MdShare,
  MdPlaylistPlay, MdForum, MdAlbum, MdThumbUp,
} from 'react-icons/md';
import { BiDollar } from 'react-icons/bi';
import { useAppStore } from '../../lib/store';
import { CHECKER_URL } from '../../utils/config';
import { toastIn } from '../../utils/toast';
import { isLoggedIn } from '../../hive-api/aioha';
import { fixVideoThumbnail, fallbackImg } from '../../utils/fixThumbnails';
import { fmtClock, episodeShareUrl } from '../../lib/podcastLibrary';
import { parseTimeParam } from '../GlobalAudioPlayer/playerMath';
import { fmtDuration, useDateFormat } from '../../lib/podcastFormat';
import { getUersContent } from '../../utils/hiveUtils';
import { DownloadButton } from '../Podcasts/PodcastBits';
import PayoutAmount from '../PayoutAmount/PayoutAmount';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import BlogContent from '../playVideo/BlogContent';
import TipModal from '../tip-reward/TipModal';
import AddToPlaylistModal from '../AddToPlaylistModal/AddToPlaylistModal';
import '../Podcasts/PodcastsTab.scss';

/** The audio page's own link to one 3Speak audio: `/audio?play=<owner>/<id>`. */
export const audioItemPath = (item) => `/audio?play=${item.owner}/${item.permlink}`;

function coverOf(item) {
  const fixed = fixVideoThumbnail({ thumbnail_url: item.thumbnail_url, thumbnail: item.thumbnail_url });
  return !fixed || fixed === fallbackImg || fixed === '/images/speak.jpg' ? `/img/u/${item.owner}/avatar/large` : fixed;
}

async function copyLink(url, t) {
  try {
    await navigator.clipboard.writeText(url);
    toastIn('Post').success(t('audio.podcasts.share.copied'));
  } catch {
    toastIn('Post').error(t('audio.podcasts.share.failed'));
  }
}

/**
 * One 3Speak audio on the audio page (/audio?play=<owner>/<id>), laid out like
 * an outside podcast episode (components/Podcasts/EpisodeView.jsx): cover,
 * creator, title, the same actions, and its description (the Hive post) below.
 * This is where a shared player link and a click on an audio card land.
 *
 * A shared link may carry &t= (start there) and &end= (stop there, a clip): the
 * Play button then says "Play from 12:34". Never on its own: browsers block
 * sound that starts without a click.
 */
export default function AudioItemView({ owner, id, onBack }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const fmtDate = useDateFormat();
  const [params] = useSearchParams();
  // Seconds, "1:23" or "1h2m3s", like the player's own links.
  const deep = useMemo(() => {
    const from = parseTimeParam(params.get('t'));
    const to = parseTimeParam(params.get('end'));
    return { t: from, end: to != null && to > (from || 0) ? to : null };
  }, [params]);
  const authenticated = useAppStore((s) => s.authenticated);
  const user = useAppStore((s) => s.user);
  const loggedIn = authenticated && isLoggedIn();
  const audioCurrent = useAppStore((s) => s.audioCurrent);
  const audioIsPlaying = useAppStore((s) => s.audioIsPlaying);
  const audioPlay = useAppStore((s) => s.audioPlay);
  const audioPlayAt = useAppStore((s) => s.audioPlayAt);
  const audioAddToQueue = useAppStore((s) => s.audioAddToQueue);
  const audioRequestToggle = useAppStore((s) => s.audioRequestToggle);
  const [deepUsed, setDeepUsed] = useState(false);
  const [tipping, setTipping] = useState(false);
  const [listing, setListing] = useState(false);
  const [voting, setVoting] = useState(false);
  const [votedNow, setVotedNow] = useState(false);
  const [weight, setWeight] = useState(100);
  const [voteValue, setVoteValue] = useState(0);
  const [accountData, setAccountData] = useState(null);

  const { data: item, isLoading, error } = useQuery({
    queryKey: ['audio-item', owner, id],
    queryFn: async () => {
      const { data } = await axios.get(`${CHECKER_URL}/audio?owner=${encodeURIComponent(owner)}&permlink=${encodeURIComponent(id)}&limit=1`);
      return (data?.audio || []).find((a) => a.owner === owner && a.permlink === id) || null;
    },
    staleTime: 5 * 60 * 1000,
  });
  const postPermlink = String(item?.post_permlink || '').split('/').pop();
  // The Hive post behind the audio: its votes, payout and comments.
  const { data: post } = useQuery({
    queryKey: ['audio-item-post', owner, postPermlink],
    enabled: !!postPermlink,
    queryFn: () => getUersContent(owner, postPermlink),
    staleTime: 60 * 1000,
  });
  const inQueue = useAppStore((s) => !!item && s.audioQueue.some((i) => i._id === item._id));
  const isCurrent = !!item && audioCurrent?._id === item._id;
  // Whole seconds only, so the share button does not re-render the page at every tick.
  const currentSec = useAppStore((s) => (item && s.audioCurrent?._id === item._id ? Math.floor(s.audioCurrentTime || 0) : 0));

  const back = (
    <button type="button" className="pod-back" onClick={onBack}>
      <MdArrowBack size={18} /> {t('audio.item.back')}
    </button>
  );
  if (isLoading) return <div className="pod-empty">{t('common.status.loading')}</div>;
  if (error || !item || (item.status && item.status !== 'published')) {
    return <div className="pod-show">{back}<p className="pod-empty">{t('audio.item.missing')}</p></div>;
  }

  const playing = isCurrent && audioIsPlaying;
  const deepOpen = deep.t != null && !deepUsed && !isCurrent;
  const deepLabel = deep.end != null
    ? t('audio.podcasts.deepLink.playClip', { from: fmtClock(deep.t), to: fmtClock(deep.end) })
    : t('audio.podcasts.deepLink.playFrom', { time: fmtClock(deep.t) });
  const play = () => {
    if (isCurrent) { audioRequestToggle(); return; }
    if (deepOpen) { setDeepUsed(true); audioPlayAt(item, deep.t, deep.end); return; }
    audioPlay(item, [item]);
  };
  const shareAt = isCurrent && currentSec > 0 ? currentSec : 0;
  const link = (from) => episodeShareUrl(window.location.origin, audioItemPath(item), from);
  const genre = item.category === 'song' && item.genre ? item.genre : '';
  const votes = post?.active_votes || [];
  const voted = votedNow || (!!user && votes.some((v) => v.voter === user));
  const voteCount = votes.length + (votedNow && !votes.some((v) => v.voter === user) ? 1 : 0);
  const payout = post
    ? (parseFloat(post.pending_payout_value || 0) > 0
      ? parseFloat(post.pending_payout_value)
      : parseFloat(post.total_payout_value || 0) + parseFloat(post.curator_payout_value || 0))
    : 0;

  return (
    <div className="pod-show pod-episode audio-item">
      {back}

      <header className="pod-show-head">
        <img className="pod-show-cover" src={coverOf(item)} alt="" onError={(e) => { e.currentTarget.src = fallbackImg; }} />
        <div className="pod-show-info">
          <button type="button" className="pod-show-kicker pod-episode-show" onClick={() => navigate(`/@${item.owner}?tab=audio`)}>
            <img className="audio-item-avatar" src={`/img/u/${item.owner}/avatar/small`} alt="" /> @{item.owner}
          </button>
          <h2 className="pod-show-title">{item.title || t('audio.untitled')}</h2>
          <div className="pod-show-meta">
            {item.createdAt && <span>{fmtDate(item.createdAt)}</span>}
            {item.duration > 0 && <span className="pod-chip">{fmtDuration(item.duration)}</span>}
            {genre && <span className="pod-chip">{genre}</span>}
            {item.plays > 0 && <span>{t('audio.tile.plays', { count: item.plays })}</span>}
            {post && <PayoutAmount amount={payout} size={13} />}
          </div>
          {item.playlist_id && item.playlist_name && (
            <button type="button" className="pod-show-kicker pod-episode-show" onClick={() => navigate(`/playlist/${item.playlist_id}`)}>
              <MdAlbum size={14} /> {t('audio.item.album', { name: item.playlist_name })}
            </button>
          )}
          <div className="pod-show-actions">
            <button type="button" className={`pod-btn ${deepOpen ? 'pod-btn--primary' : 'pod-btn--solid'}`} onClick={play}>
              {playing ? <MdPause size={18} /> : <MdPlayArrow size={18} />}
              {playing ? t('audio.podcasts.pause') : deepOpen ? deepLabel : t('audio.podcasts.play')}
            </button>
            <button
              type="button"
              className={`pod-btn${inQueue ? ' pod-btn--on' : ''}`}
              onClick={() => { if (!inQueue) audioAddToQueue(item); }}
              disabled={inQueue}
            >
              {inQueue ? <MdPlaylistAddCheck size={18} /> : <MdPlaylistAdd size={18} />}
              {inQueue ? t('audio.podcasts.inQueue') : t('audio.podcasts.addToQueue')}
            </button>
            {postPermlink && (
              <button
                type="button"
                className={`pod-btn${voted ? ' pod-btn--on' : ''}`}
                onClick={() => {
                  if (!loggedIn) { toastIn('Post').error(t('audio.post.signInToVote')); return; }
                  setVoting((v) => !v);
                }}
              >
                <MdThumbUp size={16} /> {voted ? t('audio.post.voted') : t('audio.post.vote')}
                {voteCount > 0 && <span className="pod-btn-count">{voteCount}</span>}
              </button>
            )}
            <DownloadButton track={item} variant="button" />
            <button type="button" className="pod-btn" onClick={() => copyLink(link(shareAt), t)}>
              {shareAt ? <MdShare size={16} /> : <MdLink size={16} />}
              {shareAt ? t('audio.podcasts.share.copyAt', { time: fmtClock(shareAt) }) : t('audio.podcasts.share.copy')}
            </button>
            {/* Signed out, the tip window opens on Lightning: no Hive account needed. */}
            {postPermlink && user !== item.owner && (
              <button type="button" className="pod-btn" onClick={() => setTipping(true)}>
                <BiDollar size={16} /> {t('audio.post.tip')}
              </button>
            )}
            {loggedIn && (
              <button type="button" className="pod-btn" onClick={() => setListing(true)}>
                <MdPlaylistPlay size={16} /> {t('audio.player.playlist')}
              </button>
            )}
            {postPermlink && (
              <button type="button" className="pod-btn" onClick={() => navigate(`/audio/${item.owner}/${postPermlink}`)}>
                <MdForum size={16} /> {t('audio.item.comments')}
                {post?.children > 0 && <span className="pod-btn-count">{post.children}</span>}
              </button>
            )}
          </div>
        </div>
      </header>

      <section className="pod-section">
        <h2 className="pod-section-title">{t('audio.item.description')}</h2>
        {postPermlink
          ? <div className="pod-notes"><BlogContent author={item.owner} permlink={postPermlink} alwaysExpanded hideAudioPlayers /></div>
          : <div className="pod-notes"><p className={item.description ? undefined : 'pod-empty'}>{item.description || t('audio.item.noDescription')}</p></div>}
      </section>

      {voting && (
        <CommentVoteTooltip
          author={item.owner}
          permlink={postPermlink}
          showTooltip={voting}
          setShowTooltip={setVoting}
          weight={weight} setWeight={setWeight}
          voteValue={voteValue} setVoteValue={setVoteValue}
          accountData={accountData} setAccountData={setAccountData}
          compact
          onVoteSuccess={() => { setVoting(false); setVotedNow(true); }}
        />
      )}
      {tipping && (
        <TipModal
          recipient={item.owner}
          permlink={postPermlink}
          memoLink={`https://3speak.tv/audio/${item.owner}/${postPermlink}`}
          isOpen
          onClose={() => setTipping(false)}
        />
      )}
      {listing && (
        <AddToPlaylistModal
          isOpen
          onClose={() => setListing(false)}
          author={item.owner}
          permlink={postPermlink || item.permlink}
          videoTitle={item.title}
        />
      )}
    </div>
  );
}
