import MarkdownView from '../common/MarkdownView';
import { Fragment, useRef, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getHiveClient } from '../../utils/hiveNode';
import { Icon } from '../v2/Icon';
import ReportModal, { isReported } from '../modal/ReportModal';
import { Client } from '@hiveio/dhive';
import { HIVE_API_NODES } from '../../utils/config';
import './ReactionPlayer.scss';
import { markByReputation } from '../../utils/reputation';
import { markByHidden } from '../../utils/hiddenCreators';
import { translateText, getTargetLanguage } from '../../utils/translate';
import TranslateButton from '../TranslateButton/TranslateButton';
import { getHiveRenderer } from '../../lib/hiveRenderer';

const hiveClient = getHiveClient();

const SIZE_LABEL_KEYS = { small: 'player.reactions.sizes.small', medium: 'player.reactions.sizes.medium', standard: 'player.reactions.sizes.standard', big: 'player.reactions.sizes.big', cinema: 'player.reactions.sizes.cinema' };
const SIZE_NAME_KEYS = { small: 'player.reactions.sizeNames.small', medium: 'player.reactions.sizeNames.medium', standard: 'player.reactions.sizeNames.standard', big: 'player.reactions.sizeNames.big', cinema: 'player.reactions.sizeNames.cinema' };

function stripRepliedTo(html) {
  if (!html) return '';
  return html
    .replace(/<p>\s*<sup>\s*replied to[\s\S]*?<\/sup>\s*<\/p>/gi, '')
    .replace(/<sup>\s*replied to[\s\S]*?<\/sup>/gi, '')
    .replace(/\n?<sup>replied to \[.*?\]\([^)]*\)[^<]*<\/sup>/g, '');
}

function strip3SpeakEmbeds(html) {
  if (!html) return '';
  return stripRepliedTo(html)
    .replace(/<div[^>]*class="[^"]*video-container[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
    .replace(/<iframe[^>]*src="[^"]*3speak\.tv[^"]*"[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<iframe[^>]*src="[^"]*embed\.3speak\.tv[^"]*"[^>]*>[\s\S]*?<\/iframe>/gi, '');
}

function CommentNode({ comment, depth, collapsible = true }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  const [translatedText, setTranslatedText] = useState(null);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const bodyHtml = depth === 0 ? strip3SpeakEmbeds(comment.body) : stripRepliedTo(comment.body || '');

  const handleTranslate = async (langCode) => {
    if (!comment.body) return;
    setTranslateError(false);
    setIsTranslating(true);
    try {
      const result = await translateText(comment.body, langCode || getTargetLanguage());
      if (result) setTranslatedText(result);
    } catch { setTranslateError(true); }
    finally { setIsTranslating(false); }
  };

  if (comment.isLowReputation || comment.isHidden) return null;

  if (collapsible && collapsed) {
    return (
      <div className="rct-thread-comment" style={depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 16}px` } : undefined}>
        <div
          className="comment-collapsed-bar"
          role="button"
          tabIndex={0}
          aria-expanded="false"
          aria-label={t('comments.section.showComment', { user: comment.author })}
          onClick={() => setCollapsed(false)}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed(false); } }}
        >
          <img className="comment-collapsed-avatar" src={comment.avatar} alt="" />
          <span className="comment-collapsed-name">@{comment.author}</span>
          <Icon name="expand_more" size={18} className="comment-collapsed-chevron" />
        </div>
      </div>
    );
  }

  return (
    <div className="rct-thread-comment" style={depth > 0 ? { marginLeft: `${Math.min(depth, 4) * 16}px` } : undefined}>
      <div className="rct-thread-header">
        <img className="rct-thread-avatar" src={comment.avatar} alt="" />
        <span className="rct-thread-author">@{comment.author}</span>
        {collapsible && (
          <button type="button" className="comment-collapse-chevron" aria-expanded="true" aria-label={t('comments.section.hideComment')} title={t('comments.section.hideComment')} onClick={() => setCollapsed(true)}>
            <Icon name="expand_less" size={18} />
          </button>
        )}
      </div>
      <MarkdownView className="rct-thread-body" html={bodyHtml} />
      {translatedText && (
        <div className="comment-translation">
          <div className="comment-translation-header">
            <Icon name="translate" size={14} />
            <span>{t('player.reactions.translation')}</span>
            <button type="button" className="comment-translation-dismiss" onClick={() => setTranslatedText(null)} aria-label={t('common.actions.close')}><Icon name="close" size={16} /></button>
          </div>
          <p>{translatedText}</p>
        </div>
      )}
      {translateError && <div className="comment-translation comment-translation--error"><p>{t('player.reactions.translationFailed')}</p></div>}
      <div className="rct-comment-actions">
        <button
          type="button"
          className={`rct-report-btn${comment.permlink && isReported('comment', `${comment.author}/${comment.permlink}`) ? ' reported' : ''}`}
          onClick={() => setIsReportOpen(true)}
          title={t('common.actions.report')}
          aria-label={t('common.actions.report')}
        >
          <Icon name="flag" size={16} />
        </button>
        <TranslateButton onTranslate={handleTranslate} isTranslating={isTranslating} compact />
      </div>
      {isReportOpen && (
        <ReportModal
          isOpen={isReportOpen}
          onClose={() => setIsReportOpen(false)}
          type="comment"
          target={{ author: comment.author, permlink: comment.permlink }}
        />
      )}
      {comment.children?.map((child, i) => (
        <CommentNode key={i} comment={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function ReactionPlayer({
  reactions,
  selectedIndex,
  onSelectReaction,
  onClose,
  mobile,
  size,
  onCycleSize,
  currentTime: mainCurrentTime,
  duration: mainDuration,
  mainIsPlaying,
  onReactionPlay,
}) {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const itemRefs = useRef([]);
  const userScrolledRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const iframeRefs = useRef([]);
  const activeIdxRef = useRef(selectedIndex ?? 0);
  const trackRef = useRef(null);
  const playerRef = useRef(null);

  // Reaction player's own playback state
  const [rctTime, setRctTime] = useState(0);
  const [rctDuration, setRctDuration] = useState(0);
  const [rctPlaying, setRctPlaying] = useState(false);
  const [rctMuted, setRctMuted] = useState(false);
  const [rctFullscreen, setRctFullscreen] = useState(false);
  const [controlsHovering, setControlsHovering] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimerRef = useRef(null);

  // Mobile collapse — respect manual override from localStorage
  const [mobileCollapsed] = useState(() => {
    const stored = localStorage.getItem('rct-collapsed');
    if (stored !== null) return stored === '1';
    // Auto-collapse if only comments without timestamps
    if (!reactions || reactions.length === 0) return true;
    const hasVideo = reactions.some(r => r.type === 'video');
    const hasTimestamped = reactions.some(r => r.pct !== null);
    return !hasVideo && !hasTimestamped;
  });

  // Dynamic height for scroll area on mobile
  const [belowMaxHeight, setBelowMaxHeight] = useState(null);

  const idx = (selectedIndex ?? 0);
  activeIdxRef.current = idx;

  // Determine sizing mode: 'full' (has videos), 'half' (comments-only with timestamps)
  const hasVideoReactions = reactions?.some(r => r.type === 'video');

  // Calculate available vertical space once on mount (mobile only)
  useEffect(() => {
    if (!mobile || mobileCollapsed) {
      setBelowMaxHeight(null);
      return;
    }

    const rafId = requestAnimationFrame(() => {
      const player = playerRef.current;
      if (!player) return;

      const playerTop = player.getBoundingClientRect().top;
      const viewportH = window.innerHeight;
      const available = viewportH - playerTop;

      const header = player.querySelector('.reaction-player-header');
      const list = player.querySelector('.reaction-list');

      const headerH = header?.getBoundingClientRect().height || 0;
      const listH = list?.getBoundingClientRect().height || 0;

      const buffer = 16; // borders + padding
      let remaining = available - headerH - listH - buffer;

      // Comments-only with timestamps: half the space
      if (!hasVideoReactions) {
        remaining = Math.floor(remaining / 2);
      }

      setBelowMaxHeight(Math.max(50, Math.floor(remaining)));
    });

    return () => cancelAnimationFrame(rafId);
  }, [mobile, mobileCollapsed, hasVideoReactions]);

  // Nested comment tree for comment-type reactions
  const [nestedComments, setNestedComments] = useState([]);
  const [loadingComments, setLoadingComments] = useState(false);

  // Reset playback state when switching reactions
  const prevIdxRef = useRef(idx);
  useEffect(() => {
    if (prevIdxRef.current !== idx) {
      setRctTime(0);
      setRctDuration(0);
      setRctPlaying(false);
      prevIdxRef.current = idx;
    }
  }, [idx]);

  // Fetch nested replies when a reaction with a permlink is selected
  useEffect(() => {
    const current = reactions?.[idx];
    if (!current || !current.permlink) {
      setNestedComments([]);
      return;
    }

    let cancelled = false;
    setLoadingComments(true);

    (async () => {
      try {
        const render = await getHiveRenderer().catch(() => null);

        const buildTree = async (author, permlink, depth) => {
          if (depth > 3) return [];
          const replies = await hiveClient.call('condenser_api', 'get_content_replies', [author, permlink]);
          return Promise.all(replies.map(async (c) => {
            let bodyHtml;
            if (render && c.body) {
              // Strip timestamp-linked 3speak URLs so renderer doesn't embed them
              const cleaned = c.body.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]\((https?:\/\/(?:3speak\.tv|play\.3speak\.tv)[^)]*)\)/g, '$1');
              try { bodyHtml = render(cleaned); } catch { bodyHtml = c.body; }
            } else {
              bodyHtml = c.body || '';
            }
            const children = c.children > 0 ? await buildTree(c.author, c.permlink, depth + 1) : [];
            return {
              author: c.author,
              avatar: `/img/u/${c.author}/avatar/small`,
              body: bodyHtml,
              children,
            };
          }));
        };

        const tree = await buildTree(current.author, current.permlink, 0);
        const markedTree = await markByHidden(await markByReputation(tree));
        if (!cancelled) {
          setNestedComments(markedTree);
          setLoadingComments(false);
        }
      } catch (err) {
        console.error('Failed to fetch nested comments:', err);
        if (!cancelled) {
          setNestedComments([]);
          setLoadingComments(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [idx, reactions]);

  // Ref for onReactionPlay so the message handler can access it without re-registering
  const onReactionPlayRef = useRef(onReactionPlay);
  onReactionPlayRef.current = onReactionPlay;

  // Send commands to the active reaction player iframe
  const sendCmd = useCallback((msg) => {
    const iframe = iframeRefs.current[activeIdxRef.current];
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage(msg, '*');
    }
  }, []);

  // When main player starts playing, pause the reaction player
  const prevMainIsPlaying = useRef(false);
  useEffect(() => {
    if (mainIsPlaying && !prevMainIsPlaying.current) {
      sendCmd({ type: 'pause' });
      setRctPlaying(false);
    }
    prevMainIsPlaying.current = mainIsPlaying;
  }, [mainIsPlaying, sendCmd]);

  // Listen for postMessage from reaction player iframes
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || !event.data.type) return;

      const activeIframe = iframeRefs.current[activeIdxRef.current];

      // Handle player-ready: do NOT auto-play
      if (event.data.type === '3speak-player-ready') {
        return;
      }

      // For all other messages, only handle from the active iframe
      if (!activeIframe || event.source !== activeIframe.contentWindow) return;

      switch (event.data.type) {
        case '3speak-timeupdate':
          setRctTime(event.data.currentTime ?? 0);
          if (event.data.duration) setRctDuration(event.data.duration);
          break;
        case '3speak-playstate':
          setRctPlaying(event.data.isPlaying ?? false);
          break;
        case '3speak-durationchange':
          setRctDuration(event.data.duration ?? 0);
          break;
        case '3speak-ended':
          setRctPlaying(false);
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Fullscreen change listener
  useEffect(() => {
    const handleFsChange = () => {
      setRctFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const handleTogglePlay = useCallback(() => {
    sendCmd({ type: 'toggle-play' });
    setRctPlaying(prev => {
      const willPlay = !prev;
      if (willPlay) onReactionPlayRef.current?.();
      return willPlay;
    });
  }, [sendCmd]);
  const handleToggleMute = useCallback(() => {
    sendCmd({ type: 'toggle-mute' });
    setRctMuted(prev => !prev);
  }, [sendCmd]);
  const handleSeekBackward = useCallback(() => sendCmd({ type: 'seekBackward', seconds: 10 }), [sendCmd]);
  const handleSeekForward = useCallback(() => sendCmd({ type: 'seekForward', seconds: 10 }), [sendCmd]);
  const handleRctSeek = useCallback((time) => sendCmd({ type: 'seek', time }), [sendCmd]);

  const handleTrackClick = useCallback((e) => {
    if (!trackRef.current || !rctDuration) return;
    const rect = trackRef.current.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    handleRctSeek(fraction * rctDuration);
  }, [rctDuration, handleRctSeek]);

  const handleToggleFullscreen = useCallback(() => {
    const wrapper = document.querySelector('.reaction-video-wrap');
    if (!wrapper) return;
    if (!document.fullscreenElement) {
      wrapper.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  // Scroll the list to center a specific item
  const scrollToItem = useCallback((index) => {
    const item = itemRefs.current[index];
    const container = scrollRef.current;
    if (!item || !container) return;

    programmaticScrollRef.current = true;
    const containerRect = container.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    const scrollOffset = container.scrollLeft;
    const itemRelativeLeft = itemRect.left - containerRect.left + scrollOffset;
    const targetScroll = itemRelativeLeft - containerRect.width / 2 + itemRect.width / 2;
    container.scrollTo({ left: Math.max(0, targetScroll), behavior: 'smooth' });

    setTimeout(() => { programmaticScrollRef.current = false; }, 500);
  }, []);

  // When user clicks a reaction, reset manual scroll flag
  const handleItemClick = useCallback((index) => {
    userScrolledRef.current = false;
    onSelectReaction(index);
  }, [onSelectReaction]);

  // Detect manual scroll on the reaction list
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (!programmaticScrollRef.current) {
        userScrolledRef.current = true;
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // Timeline-based auto-scroll
  useEffect(() => {
    if (userScrolledRef.current) return;
    if (!reactions || reactions.length === 0 || !mainDuration || mainDuration <= 0) return;

    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < reactions.length; i++) {
      const r = reactions[i];
      const rTime = r.pct;
      const dist = Math.abs(rTime - mainCurrentTime);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    scrollToItem(closestIdx);
  }, [mainCurrentTime, mainDuration, reactions, scrollToItem]);

  // Also scroll when selectedIndex changes (from prev/next buttons)
  useEffect(() => {
    if (userScrolledRef.current) return;
    scrollToItem(selectedIndex ?? 0);
  }, [selectedIndex, scrollToItem]);

  if (!reactions || reactions.length === 0) return null;

  const current = reactions[idx] ?? reactions[0];
  const isVideo = current.type === 'video';
  const hasPrev = idx > 0;
  const hasNext = idx < reactions.length - 1;
  const rctProgress = rctDuration > 0 ? (rctTime / rctDuration) * 100 : 0;
  const showControls = controlsVisible || controlsHovering;

  // Only video-type reactions get iframes
  const videoReactions = reactions.filter(r => r.type === 'video');

  return (
    <div className={`reaction-player${mobile ? ' reaction-player--mobile' : ''}`} ref={playerRef}>
      {/* Header - top on mobile */}
      <div className="reaction-player-header">
        <div className="reaction-info">
          <img className="reactor-avatar" src={current.avatar} alt="" />
          <div className="reactor-text">
            <span className="reactor-name">@{current.author}</span>
            <span className="reaction-label">{isVideo ? t('player.reactions.videoReaction') : t('player.reactions.comment')}</span>
          </div>
        </div>
        <div className="reaction-controls">
          <button
            className="nav-btn"
            onClick={() => handleItemClick(idx - 1)}
            disabled={!hasPrev}
            title={t('player.reactions.previous')}
          >
            <Icon name="chevron_left" size={20} />
          </button>
          <span className="reaction-count">{idx + 1}/{reactions.length}</span>
          <button
            className="nav-btn"
            onClick={() => handleItemClick(idx + 1)}
            disabled={!hasNext}
            title={t('player.reactions.next')}
          >
            <Icon name="chevron_right" size={20} />
          </button>
          <button
            className="mobile-rct-toggle nav-btn"
            onClick={() => onClose?.()}
            title={t('player.reactions.hide')}
          >
            <Icon name="expand_less" size={20} />
          </button>
          <button className="close-btn" onClick={onClose} title={t('player.reactions.hideShort')}>
            <Icon name="expand_more" size={20} />
          </button>
        </div>
      </div>

      <div className={`rct-collapsible${mobileCollapsed ? ' collapsed' : ''}`}>
      {/* Scrollable area: video + comments scroll together on mobile */}
      <div className="rct-scroll-area" style={belowMaxHeight != null ? { height: `${belowMaxHeight}px` } : undefined}>
      {/* Content area — same 16:9 size for both video and comment */}
      <div
        className="reaction-video-wrap"
        onMouseMove={isVideo ? showControlsTemporarily : undefined}
        onMouseLeave={isVideo ? () => setControlsVisible(false) : undefined}
      >
        {/* Preloaded iframes for video reactions only */}
        {videoReactions.map((reaction) => {
          const originalIdx = reactions.indexOf(reaction);
          return (
            <iframe
              key={reaction.id}
              ref={el => { iframeRefs.current[originalIdx] = el; }}
              src={`${reaction.videoUrl}${reaction.videoUrl.includes('?') ? '&' : '?'}layout=desktop&mode=iframe&controls=0`}
              className={`rct-iframe${originalIdx === idx ? ' rct-iframe--active' : ''}`}
              loading="lazy"
              allowFullScreen
            />
          );
        })}

        {/* Comment display with nested reply tree */}
        {!isVideo && (
          <div className="rct-comment-panel">
            <div className="rct-comment-thread">
              <CommentNode comment={{ author: current.author, avatar: current.avatar, body: current.body, isLowReputation: current.isLowReputation, isHidden: current.isHidden, children: [] }} depth={0} collapsible={false} />
              {loadingComments && <div className="rct-thread-loading">{t('player.reactions.loadingReplies')}</div>}
              {nestedComments.map((reply, i) => (
                <CommentNode key={i} comment={reply} depth={1} />
              ))}
            </div>
          </div>
        )}

        {/* Invisible overlay for video items to capture mouse events */}
        {isVideo && <div className="rct-interact-overlay" onClick={handleTogglePlay} />}

        {/* Overlay buttons (top-right) */}
        <div className="overlay-buttons">
          {/* Mobile-only prev/next nav + count */}
          <div className="mobile-overlay-nav">
            <button className="size-overlay-btn size-overlay-btn--nav" onClick={() => handleItemClick(idx - 1)} disabled={!hasPrev} title={t('player.reactions.previous')}>
              <Icon name="chevron_left" size={20} />
            </button>
            <span className="overlay-count">{idx + 1}/{reactions.length}</span>
            <button className="size-overlay-btn size-overlay-btn--nav" onClick={() => handleItemClick(idx + 1)} disabled={!hasNext} title={t('player.reactions.next')}>
              <Icon name="chevron_right" size={20} />
            </button>
          </div>
          {onCycleSize && (
            <button className="size-overlay-btn size-overlay-btn--resize" onClick={onCycleSize} title={t('player.reactions.sizeTitle', { size: t(SIZE_NAME_KEYS[size] || SIZE_NAME_KEYS.small) })}>
              <Icon name="aspect_ratio" size={18} />
              <span>{t(SIZE_LABEL_KEYS[size] || SIZE_LABEL_KEYS.small)}</span>
            </button>
          )}
          <button className="size-overlay-btn size-overlay-btn--close" onClick={onClose} title={t('player.reactions.hide')}>
            <Icon name="expand_less" size={20} />
          </button>
        </div>

        {/* Custom player controls (video only) */}
        {isVideo && (
          <div
            className={`rct-controls${showControls ? ' visible' : ''}`}
            onMouseEnter={() => setControlsHovering(true)}
            onMouseLeave={() => setControlsHovering(false)}
          >
            <div className="rct-progress-row">
              <div className="rct-progress-track" ref={trackRef} onClick={handleTrackClick}>
                <div className="rct-progress-fill" style={{ width: `${rctProgress}%` }} />
              </div>
            </div>
            <div className="rct-controls-row">
              <div className="rct-controls-left">
                <button className="rct-btn" onClick={handleSeekBackward} title={t('player.controls.rewind10')}>
                  <Icon name="replay_10" size={18} />
                </button>
                <button className="rct-btn rct-btn--play" onClick={handleTogglePlay} title={rctPlaying ? t('common.actions.pause') : t('common.actions.play')}>
                  <Icon name={rctPlaying ? 'pause' : 'play_arrow'} size={20} fill />
                </button>
                <button className="rct-btn" onClick={handleSeekForward} title={t('player.controls.forward10')}>
                  <Icon name="forward_10" size={18} />
                </button>
                <div className="rct-time">
                  {formatTime(rctTime)} / {formatTime(rctDuration)}
                </div>
              </div>
              <div className="rct-controls-right">
                <button className="rct-btn" onClick={handleToggleMute} title={rctMuted ? t('player.controls.unmute') : t('player.controls.mute')}>
                  <Icon name={rctMuted ? 'volume_off' : 'volume_up'} size={18} />
                </button>
                <button className="rct-btn" onClick={handleToggleFullscreen} title={rctFullscreen ? t('player.controls.exitFullscreen') : t('player.controls.fullscreen')}>
                  <Icon name={rctFullscreen ? 'fullscreen_exit' : 'fullscreen'} size={18} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Comment thread below video reactions */}
      {isVideo && current.permlink && (
        <div className="rct-comment-panel rct-comment-panel--below">
          <div className="rct-comment-thread">
            <CommentNode comment={{ author: current.author, avatar: current.avatar, body: current.body, isLowReputation: current.isLowReputation, isHidden: current.isHidden, children: [] }} depth={0} collapsible={false} />
            {loadingComments && <div className="rct-thread-loading">{t('player.reactions.loadingReplies')}</div>}
            {nestedComments.map((reply, i) => (
              <CommentNode key={i} comment={reply} depth={1} />
            ))}
          </div>
        </div>
      )}
      </div>{/* end rct-scroll-area */}

      {/* Horizontal scrollable list */}
      <div className="reaction-list" ref={scrollRef}>
        {reactions.map((reaction, i) => {
          if (reaction.isLowReputation || reaction.isHidden) return null;
          // Insert divider before the first non-timestamped reaction
          const showDivider = reaction.pct === null && (i === 0 || reactions[i - 1].pct !== null);
          return (
            <Fragment key={reaction.id}>
              {showDivider && <div className="reaction-list-divider" />}
              <div
                className={`reaction-item${i === idx ? ' active' : ''}${reaction.type === 'video' ? ' reaction-item--video' : ' reaction-item--comment'}`}
                onClick={() => handleItemClick(i)}
                ref={el => { itemRefs.current[i] = el; }}
              >
                <div className="reaction-item-type-badge">
                  <Icon name={reaction.type === 'video' ? 'videocam' : 'chat_bubble'} size={12} fill />
                </div>
                <img className="reaction-item-avatar" src={reaction.avatar} alt="" />
                <span className="reaction-item-name">@{reaction.author}</span>
                {reaction.replyCount > 0 && (
                  <span className="reaction-item-count">{reaction.replyCount}</span>
                )}
              </div>
            </Fragment>
          );
        })}
      </div>
      </div>{/* end rct-collapsible */}
    </div>
  );
}

export default ReactionPlayer;
