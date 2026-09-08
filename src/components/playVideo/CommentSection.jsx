import MarkdownView from '../common/MarkdownView';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import './CommentSection.scss';
import './BlogContent.scss';
import { BiDislike } from 'react-icons/bi';
import { ImSpinner9 } from 'react-icons/im';
import { TailChase } from 'ldrs/react';
import { MdVideocam, MdComment, MdKeyboardArrowUp, MdTranslate, MdFlag } from 'react-icons/md';
import ReportModal, { isReported } from '../modal/ReportModal';
import useTranslation from '../../hooks/useTranslation';
import TranslateButton from '../TranslateButton/TranslateButton';
import ReactVideoTab from '../ReactVideoModal/ReactVideoModal';
import dayjs from 'dayjs';
import { useAppStore } from '../../lib/store';
import { Client } from '@hiveio/dhive';
import UpvoteTooltip from '../tooltip/UpvoteTooltip';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import { toastIn } from '../../utils/toast';
import { estimate, getVotePower } from '../../utils/hiveUtils';
import { markByReputation, getUserReputation } from '../../utils/reputation';
import { markByHidden } from '../../utils/hiddenCreators';
import Button from '../Button/Button';
import AuthorBadge from '../AuthorBadge/AuthorBadge';
import UpvoteCount from '../UpvoteCount/UpvoteCount';
import PayoutAmount from '../PayoutAmount/PayoutAmount';
import { commentWithAioha } from '../../hive-api/aioha';
import { HIVE_API_NODES } from '../../utils/config';
import TimeAgo from '../TimeAgo/TimeAgo';
import { Link } from 'react-router-dom';
import EmojiGifPicker from '../common/EmojiGifPicker/EmojiGifPicker';
import { insertAtCursor, gifMarkdown } from '../../utils/composerInsert';
import { getHiveRenderer } from '../../lib/hiveRenderer';

// Every toast from this module is headed "Comment"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Comment');

const client = getHiveClient();

function formatTimeInput(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseTimeInput(str) {
  if (!str) return 0;
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return null;
}

function CommentSection({ videoDetails, author, permlink, currentTime, duration, onSeek, onPause, onRefreshReactions }) {
  const { user } = useAppStore();
  const { translate, getTranslation, clearTranslation, translating } = useTranslation();
  const [commentInfo, setCommentInfo] = useState('');
  const [activeTab, setActiveTab] = useState('comment'); // 'comment' | 'react'
  const [replyText, setReplyText] = useState("");
  const [activeReply, setActiveReply] = useState(null);
  const [replyToComment, setReplyToComment] = useState(null);
  const [commentList, setCommentList] = useState([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [selectedPost, setSelectedPost] = useState({ author: '', permlink: '' });
  const [showTooltip, setShowTooltip] = useState(false);
  const [activeTooltipPermlink, setActiveTooltipPermlink] = useState(null);
  const accessToken = localStorage.getItem("access_token");
    const [weight, setWeight] = useState(100);
    const [voteValue, setVoteValue] = useState(0.0);
      const [accountData, setAccountData] = useState(null);
  // Cache for rendered comment bodies
  const [renderedBodies, setRenderedBodies] = useState({});
  const commentInputRef = useRef(null);

  // Timeline position state — auto-follows playhead unless manually edited
  const [timelineInput, setTimelineInput] = useState('0:00');
  const [timelineOverride, setTimelineOverride] = useState(false);
  const prevTimeRef = useRef(0);

  // Auto-update timeline input from playhead position (unless user overrode it)
  useEffect(() => {
    if (timelineOverride) return;
    const rounded = Math.floor(currentTime || 0);
    if (rounded !== prevTimeRef.current) {
      prevTimeRef.current = rounded;
      setTimelineInput(formatTimeInput(rounded));
    }
  }, [currentTime, timelineOverride]);

  const handleTimelineInputChange = useCallback((e) => {
    setTimelineInput(e.target.value);
    setTimelineOverride(true);
  }, []);

  const handleTimelineInputBlur = useCallback(() => {
    // Validate and normalize on blur
    const parsed = parseTimeInput(timelineInput);
    if (parsed === null || (duration && parsed > duration)) {
      // Invalid or out of range — reset to current playhead
      setTimelineInput(formatTimeInput(Math.floor(currentTime || 0)));
      setTimelineOverride(false);
    } else {
      setTimelineInput(formatTimeInput(parsed));
    }
  }, [timelineInput, currentTime, duration]);

  // Reset override when user focuses back on textarea (start following again)
  const handleTextareaFocus = useCallback(() => {
    setTimelineOverride(false);
  }, []);

  // Listen for 3speak player ready messages to detect vertical videos in comments
  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.data || event.data.type !== '3speak-player-ready') return;
      if (!event.data.isVertical) return;

      // Find the iframe in comment containers that sent this message
      const wrap = document.querySelector('.vid-comment-wrap');
      if (!wrap) return;

      const iframes = wrap.querySelectorAll('.video-container iframe');
      for (const iframe of iframes) {
        if (iframe.contentWindow === event.source) {
          iframe.parentElement.classList.add('vertical');
          break;
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const fetchComments = async () => {
      setLoadingComments(true);
      try {
        const replies = await client.call('condenser_api', 'get_content_replies', [author, permlink]);
        const commentsWithChildren = await loadNestedComments(replies);
        // Mark low-reputation accounts (rep < 15) — also caches reputations
        const markedComments = await markByHidden(await markByReputation(commentsWithChildren));
        // Attach cached reputations to comment authors (all cache hits after marking)
        const attachRep = async (comments) => {
          for (const c of comments) {
            if (c.author?.username) c.author.reputation = await getUserReputation(c.author.username);
            if (c.children?.length) await attachRep(c.children);
          }
        };
        await attachRep(markedComments);
        setCommentList(markedComments);
        
        // Pre-render all comment bodies (createHiveRenderer returns a function directly)
        const render = await getHiveRenderer();
        const rendered = {};
        // Replace timestamp-linked 3speak URLs so the renderer doesn't embed them
        // Matches [0:00] or [1:23:45] style text linking to 3speak/play.3speak URLs
        const stripTimestampEmbeds = (body) =>
          body.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]\((https?:\/\/(?:3speak\.tv|play\.3speak\.tv)[^)]*)\)/g, '$1');

        const renderComment = (comment) => {
          if (comment?.body) {
            try {
              rendered[comment.permlink] = render(stripTimestampEmbeds(comment.body));
            } catch (err) {
              rendered[comment.permlink] = '';
            }
          }
          if (comment.children) {
            comment.children.forEach(renderComment);
          }
        };
        markedComments.forEach(renderComment);
        setRenderedBodies(rendered);
      } catch (error) {
        console.error('Failed to fetch comments from Hive:', error);
      } finally {
        setLoadingComments(false);
      }
    };

    fetchComments();
  }, [author, permlink]);

  useEffect(() => {
  
      const fetchAccountData = async () => {
        try {
          const result = await getVotePower(user);
          if (result) {
            const { account } = result;
            setAccountData(account);
            calculateVoteValue(account, weight);
          }
        } catch (err) {
          console.error('Error fetching account:', err);
        }
      };
  
      fetchAccountData();
    }, []);

    const calculateVoteValue = async (account, percent) => {
        try{
          const data = await estimate(account, percent)
          setVoteValue(data)
        }catch(err){
          console.log(err)
    
        } 
      };

  const loadNestedComments = async (comments) => {
    const result = await Promise.all(
      comments.map(async (comment) => {
        const children = await client.call('condenser_api', 'get_content_replies', [comment.author, comment.permlink]);
        const has_voted = comment.active_votes?.some(v => v.voter === user) ?? false;
        let parentTimestamp = null;
        let hasVideo = false;
        let shortAuthor = null;
        let shortPermlink = null;
        try {
          const meta = typeof comment.json_metadata === 'string' ? JSON.parse(comment.json_metadata) : comment.json_metadata;
          if (meta?.parentTimestamp != null) parentTimestamp = meta.parentTimestamp;
          if (meta?.video?.url) {
            hasVideo = true;
            // Try extracting player permlink from video.url
            const videoUrl = meta.video.url;
            // Handle full URLs like https://3speak.tv/watch?v=author/perm or https://play.3speak.tv/embed?v=author/perm
            const urlMatch = videoUrl.match(/[?&]v=([^&\s"']+)/);
            if (urlMatch) {
              const cleaned = urlMatch[1].startsWith('@') ? urlMatch[1].slice(1) : urlMatch[1];
              const parts = cleaned.split('/');
              if (parts.length >= 2 && parts[0] && parts[1]) {
                shortAuthor = parts[0];
                shortPermlink = parts[1];
              }
            }
            // Handle simple @author/permlink format
            if (!shortAuthor) {
              const cleaned = videoUrl.startsWith('@') ? videoUrl.slice(1) : videoUrl;
              const parts = cleaned.split('/');
              if (parts.length >= 2 && parts[0] && parts[1]) {
                shortAuthor = parts[0];
                shortPermlink = parts[1];
              }
            }
          }

        } catch (_) {}
        return {
          author: {
            username: comment.author,
            profile: {
              images: {
                avatar: `https://images.hive.blog/u/${comment.author}/avatar/small`,
              },
            },
          },
          permlink: comment.permlink,
          created_at: comment.created,
          body: comment.body,
          parentTimestamp,
          hasVideo,
          shortAuthor,
          shortPermlink,
          stats: {
            num_likes: comment.active_votes?.filter((v) => v.percent > 0).length || 0,
            num_dislikes: comment.active_votes?.filter((v) => v.percent < 0).length || 0,
            total_hive_reward: parseFloat(comment.pending_payout_value),
          },
          has_voted,
          children: await loadNestedComments(children),
        };
      })
    );
    return result;
  };

  const processedBody = (content, permlink) => {
    if (!content) return '';
    let html;
    // Use pre-rendered body if available
    if (permlink && renderedBodies[permlink]) {
      html = renderedBodies[permlink];
    } else {
      // Fallback - return raw content (will be rendered on next fetch)
      html = content;
    }
    // Strip "replied to [timestamp](link)" lines (raw markdown or rendered HTML)
    html = html
      .replace(/<p>\s*<sup>\s*replied to\s*<a[^>]*>.*?<\/a>\s*<\/sup>\s*<\/p>/gi, '')
      .replace(/<sup>\s*replied to\s*<a[^>]*>.*?<\/a>\s*<\/sup>/gi, '')
      .replace(/\n?<sup>replied to \[.*?\]\([^)]*\)<\/sup>/g, '');

    return html;
  };

  const handlePostComment = async (replyTimestamp) => {
    const textToPost = replyToComment ? replyText : commentInfo;

    if (!textToPost.trim()) return;

    // Determine if we're replying to the main post or a comment
    const isReplyingToMainPost = !replyToComment;

    const parent_author = isReplyingToMainPost ? author : replyToComment.author.username;
    const parent_permlink = isReplyingToMainPost ? permlink : replyToComment.permlink;
    const new_permlink = `re-${parent_permlink}-${Date.now()}`;

    try {
      // Build json_metadata with optional timestamp
      const metadata = { app: '3speak/new-version' };
      if (isReplyingToMainPost) {
        const timestampSec = parseTimeInput(timelineInput);
        if (timestampSec !== null && timestampSec > 0) {
          metadata.parentTimestamp = timestampSec;
        }
      } else if (replyTimestamp != null) {
        const timestampSec = typeof replyTimestamp === 'string' ? parseTimeInput(replyTimestamp) : replyTimestamp;
        if (timestampSec !== null && timestampSec > 0) {
          metadata.parentTimestamp = timestampSec;
        }
      }

      // Append "replied to" timestamp reference if we have a timestamp
      let body = textToPost;
      if (metadata.parentTimestamp > 0) {
        const ts = metadata.parentTimestamp;
        const tsLabel = formatTimeInput(ts);
        const baseUrl = window.location.origin;
        const host = window.location.host;
        body += `\n<br><sup>replied to [${tsLabel}](${baseUrl}/watch?v=${author}/${permlink}&t=${ts}) on [${host}](${baseUrl})</sup>`;
      }

      // Use aioha for comment broadcasting (works with all providers: Keychain, HiveAuth, etc.)
      const result = await commentWithAioha(
        parent_author,
        parent_permlink,
        new_permlink,
        '', // title (empty for comments)
        body,
        metadata
      );

      if (result.success) {
        toast.success('Comment posted successfully!');
        const newComment = {
          author: {
            username: user,
            profile: {
              images: {
                avatar: `https://images.hive.blog/u/${user}/avatar/small`,
              },
            },
          },
          permlink: new_permlink,
          created_at: new Date().toISOString(),
          body: textToPost,
          parentTimestamp: metadata.parentTimestamp ?? null,
          has_voted: false,
          stats: {
            num_likes: 0,
            num_dislikes: 0,
            total_hive_reward: 0,
          },
          children: [],
        };

        // Pre-render the optimistic comment body so images/GIFs/markdown show
        // immediately — without it, processedBody falls back to the raw markdown
        // (e.g. a literal `![gif](url)`) until the next fetch/reload.
        try {
          const render = await getHiveRenderer();
          setRenderedBodies(prev => ({ ...prev, [new_permlink]: render(textToPost) }));
        } catch (_) { /* fall back to raw body until refetch */ }

        if (isReplyingToMainPost) {
          setCommentList(prev => [newComment, ...prev]);
        } else {
          const addReply = (comments) =>
            comments.map((comment) => {
              if (comment.permlink === parent_permlink) {
                return {
                  ...comment,
                  children: [...(comment.children || []), newComment],
                };
              } else if (comment.children) {
                return {
                  ...comment,
                  children: addReply(comment.children),
                };
              }
              return comment;
            });

          setCommentList(prev => addReply(prev));
        }

        setCommentInfo('');
        setReplyText('');
        setActiveReply(null);
        setReplyToComment(null);
        onRefreshReactions?.();
      } else {
        toast.error('Comment failed, please try again');
      }
    } catch (err) {
      console.error('Comment failed:', err);
      toast.error(err.message || 'Comment failed, please try again');
    }
  };

  // const handleVote = (username, permlink, weight = 10000) => {
  //   if (window.hive_keychain) {
  //     window.hive_keychain.requestBroadcast(
  //       user,
  //       [
  //         [
  //           'vote',
  //           {
  //             voter: user,
  //             author: username,
  //             permlink,
  //             weight,
  //           },
  //         ],
  //       ],
  //       'Posting',
  //       (response) => {
  //         if (response.success) {
  //           alert('Vote successful!');
  //         } else {
  //           alert(`Vote failed: ${response.message}`);
  //         }
  //       }
  //     );
  //   } else {
  //     alert('Hive Keychain is not installed. Please install the extension.');
  //   }
  // };

  const toggleTooltip = (author, permlink, index) => {
    // console.log('Toggle Tooltip:', author, permlink, index);
    setSelectedPost({ author, permlink });
    setShowTooltip(prev => !prev || activeTooltipPermlink !== permlink);
    setActiveTooltipPermlink((prev) => (prev === permlink ? null : permlink));
  };

  // Count total comments including nested children (exclude low-rep authors)
  const countComments = (comments) => {
    if (!comments || comments.length === 0) return 0;
    return comments.reduce((sum, c) => {
      if (c.isLowReputation || c.isHidden) return sum + countComments(c.children || []);
      return sum + 1 + countComments(c.children || []);
    }, 0);
  };

  return (
    <div className="vid-comment-wrap">
      
      
      {/* Tab headers + shared timestamp */}
      <div className="comment-tabs-bar">
        <div className="comment-tabs">
          <button
            className={`comment-tab${activeTab === 'comment' ? ' active' : ''}`}
            onClick={() => setActiveTab('comment')}
          >
            <MdComment size={14} />
            Comment
          </button>
          <button
            className={`comment-tab${activeTab === 'react' ? ' active' : ''}`}
            onClick={() => setActiveTab('react')}
          >
            <MdVideocam size={14} />
            React
          </button>
        </div>
        <div className="comment-timestamp">
          <span className="comment-timestamp-label">at</span>
          <input
            type="text"
            className="comment-timestamp-input"
            value={timelineInput}
            onChange={handleTimelineInputChange}
            onBlur={handleTimelineInputBlur}
            placeholder="0:00"
          />
        </div>
      </div>

      {/* Comment tab */}
      {activeTab === 'comment' && (
        <div className="add-comment-wrap">
          <textarea
            ref={commentInputRef}
            placeholder="Write your comment here..."
            className="textarea-box"
            value={commentInfo}
            onChange={(e) => {
              setCommentInfo(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            onFocus={handleTextareaFocus}
          />
          <div className="comment-form-row">
            <EmojiGifPicker
              onPickEmoji={(em) => insertAtCursor(commentInputRef.current, commentInfo, em, setCommentInfo)}
              onPickGif={(url) => insertAtCursor(commentInputRef.current, commentInfo, gifMarkdown(url), setCommentInfo)}
            />
            <div className="btn-wrap">
              <Button text="Cancel" onClick={() => {
                setCommentInfo('');
                setReplyToComment(null);
              }} />
              <Button text="Comment" prominent onClick={() => {
                setReplyToComment(null);
                handlePostComment();
              }} />
            </div>
          </div>
        </div>
      )}

      {/* React tab */}
      {activeTab === 'react' && (
        <div className="add-comment-wrap">
          <ReactVideoTab
            author={author}
            permlink={permlink}
            currentTime={currentTime}
            formatTime={formatTimeInput}
            onPosted={() => { setActiveTab('comment'); onRefreshReactions?.(); }}
            onRecordStart={onPause}
          />
        </div>
      )}

      <h4>{countComments(commentList)} Comments</h4>

      {loadingComments ? (
        <div className="comments-loading">
          <div className="loader-center"> 
            <TailChase size={16} speed={1.5} color="var(--accent-primary)" />
          </div>
        </div>
      ) : (
        commentList.map((comment, index) => (
        <Comment
        key={`${comment.author?.username}-${comment.permlink || index}`}
          commentIndex={index}
          comment={comment}
          setCommentList={setCommentList}
          activeReply={activeReply}
          setActiveReply={setActiveReply}
          setReplyToComment={setReplyToComment}
          setCommentInfo={setCommentInfo}
          setReplyText={setReplyText}
          replyText={replyText}
          commentInfo={commentInfo}
          handlePostComment={handlePostComment}
          depth={0}
          // handleVote={handleVote}
          processedBody={processedBody}
          toggleTooltip={toggleTooltip}
          selectedPost={selectedPost}
          showTooltip={showTooltip}
          setShowTooltip={setShowTooltip}
          activeTooltipPermlink={activeTooltipPermlink}
          setActiveTooltipPermlink={setActiveTooltipPermlink}
          weight={weight}
      setWeight={setWeight}
      voteValue={voteValue}
      setVoteValue={setVoteValue}
      accountData={accountData}
      setAccountData={setAccountData}
      onSeek={onSeek}
      currentTime={currentTime}
      duration={duration}
      onRefreshReactions={onRefreshReactions}
      onTranslate={translate}
      getTranslation={getTranslation}
      clearTranslation={clearTranslation}
      translating={translating}
        />
      )) )}
    </div>
  );
}

function Comment({
  commentIndex,
  comment,
  setCommentList,
  activeReply,
  setActiveReply,
  setReplyToComment,
  processedBody,
  setCommentInfo,
  setReplyText,
  replyText,
  commentInfo,
  handlePostComment,
  depth,
  handleVote,
  toggleTooltip,
  selectedPost,
  showTooltip,
  setShowTooltip,
  activeTooltipPermlink,
  setActiveTooltipPermlink,
  commemtStyle,
  weight,
      setWeight,
      voteValue,
      setVoteValue,
      accountData,
      setAccountData,
      onSeek,
      currentTime,
      duration,
      onRefreshReactions,
      onTranslate,
      getTranslation,
      clearTranslation,
      translating,
}) {
  const isReplying = activeReply === comment.permlink;
  const replyInputRef = useRef(null);
  const [replyTab, setReplyTab] = useState('comment');
  const [collapsed, setCollapsed] = useState(false);
  const [translatedText, setTranslatedText] = useState(null);
  const [translateError, setTranslateError] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);

  const handleTranslate = async (langCode) => {
    if (!comment?.body) return;
    setTranslateError(false);
    try {
      const result = await onTranslate?.(comment.permlink, comment.body, langCode);
      if (result) setTranslatedText(result);
    } catch {
      setTranslateError(true);
    }
  };

  const handleDismissTranslation = () => {
    setTranslatedText(null);
    clearTranslation?.(comment.permlink);
  };

  // Inherit timestamp from the parent comment (not editable)
  const replyTimestamp = comment?.parentTimestamp ?? null;

  // Reset reply tab when reply opens
  useEffect(() => {
    if (isReplying) setReplyTab('comment');
  }, [isReplying]);

  if (comment.isLowReputation || comment.isHidden) return null;

  if (collapsed) {
    return (
      <div className="comment-container" style={{ marginLeft: depth > 0 ? '40px' : '0px' }}>
        <div className="comment-collapsed-bar" onClick={() => setCollapsed(false)}>
          <AuthorBadge author={comment?.author?.username} reputation={comment?.author?.reputation} noLink compact />
          <MdKeyboardArrowUp size={18} className="comment-collapsed-chevron" />
        </div>
      </div>
    );
  }

  return (
    <div className="comment-container" style={{ marginLeft: depth > 0 ? '40px' : '0px' }} >
      <div className="comment">
        <div className="comment-content">
          <div className="comment-header">
            <AuthorBadge author={comment?.author?.username} reputation={comment?.author?.reputation} noLink />
            <span className="comment-date"><TimeAgo date={comment?.created_at} /></span>
            {comment?.parentTimestamp != null && (
              <span className="comment-timestamp-badge" onClick={() => onSeek?.(comment.parentTimestamp)}>at {formatTimeInput(comment.parentTimestamp)}</span>
            )}
            <span className="comment-collapse-chevron" onClick={() => setCollapsed(true)}><MdKeyboardArrowUp size={18} /></span>
          </div>
          <MarkdownView html={processedBody(comment?.body || '', comment?.permlink)} />
          {translatedText && (
            <div className="comment-translation">
              <div className="comment-translation-header">
                <MdTranslate size={13} />
                <span>Translation</span>
                <button className="comment-translation-dismiss" onClick={handleDismissTranslation}>&times;</button>
              </div>
              <p>{translatedText}</p>
            </div>
          )}
          {translateError && (
            <div className="comment-translation comment-translation--error">
              <p>Translation failed. Is the translation service running?</p>
            </div>
          )}
          <div className="comment-action">
            <UpvoteCount
              count={comment?.stats?.num_likes ?? 0}
              voted={comment.has_voted}
              onClick={() => toggleTooltip(comment?.author?.username, comment.permlink, commentIndex)}
            />
            <PayoutAmount amount={comment?.stats?.total_hive_reward} />
            <div className="comment-action-right">
              <button
                type="button"
                className={`comment-report-btn${isReported('comment', `${comment.author?.username}/${comment.permlink}`) ? ' reported' : ''}`}
                onClick={() => setIsReportOpen(true)}
                title="Report comment"
              >
                <MdFlag size={14} />
              </button>
              <TranslateButton
                onTranslate={handleTranslate}
                isTranslating={!!translating?.[comment.permlink]}
              />
              {comment.hasVideo && (
                <Link
                  to={`/shorts?v=${comment.shortAuthor || comment.author?.username}/${comment.shortPermlink || comment.permlink}`}
                  className="comment-shorts-link"
                >
                  <MdVideocam size={13} />
                  <span className="comment-btn-label">Open in Shorts</span>
                </Link>
              )}
              <Button text="Reply" onClick={() => {
                  setCommentInfo("");
                  setReplyText("")
                  setActiveReply(comment.permlink);
                  setReplyToComment(comment);
                }} />
            </div>
            <ReportModal
              isOpen={isReportOpen}
              onClose={() => setIsReportOpen(false)}
              type="comment"
              target={{ author: comment.author?.username, permlink: comment.permlink }}
            />
            <CommentVoteTooltip
             voteKind="comment"
             author={comment?.author?.username}
             permlink={comment.permlink}
             showTooltip={showTooltip && activeTooltipPermlink === comment.permlink}
             setShowTooltip={setShowTooltip}
             setCommentList={setCommentList}
             setActiveTooltipPermlink={setActiveTooltipPermlink}
             commemtStyle={commemtStyle}
             weight={weight}
             setWeight={setWeight}      
      voteValue={voteValue}
      setVoteValue={setVoteValue}
      accountData={accountData}
      setAccountData={setAccountData}
          
            />
          </div>
        </div>
      </div>
      {isReplying && (
        <div className="add-comment-wrap sub" style={{ marginLeft: '40px' }}>
          {/* Tab headers + timestamp */}
          <div className="comment-tabs-bar">
            <div className="comment-tabs">
              <button
                className={`comment-tab${replyTab === 'comment' ? ' active' : ''}`}
                onClick={() => setReplyTab('comment')}
              >
                <MdComment size={14} />
                Comment
              </button>
              <button
                className={`comment-tab${replyTab === 'react' ? ' active' : ''}`}
                onClick={() => setReplyTab('react')}
              >
                <MdVideocam size={14} />
                React
              </button>
            </div>
            {replyTimestamp != null && (
              <div className="comment-timestamp">
                <span className="comment-timestamp-label">at {formatTimeInput(replyTimestamp)}</span>
              </div>
            )}
          </div>

          {/* Comment tab */}
          {replyTab === 'comment' && (
            <>
              <textarea
                ref={replyInputRef}
                placeholder="Write your reply here..."
                className="textarea-box sub"
                value={replyText}
                onChange={(e) => {
                  setReplyText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
              />
              <div className="comment-form-row">
                <EmojiGifPicker
                  onPickEmoji={(em) => insertAtCursor(replyInputRef.current, replyText, em, setReplyText)}
                  onPickGif={(url) => insertAtCursor(replyInputRef.current, replyText, gifMarkdown(url), setReplyText)}
                />
                <div className="btn-wrap">
                  <Button text="Cancel" onClick={() => {setReplyText(""); setActiveReply(null)}} />
                  <Button text="Comment" prominent onClick={() => handlePostComment(replyTimestamp)} />
                </div>
              </div>
            </>
          )}

          {/* React tab */}
          {replyTab === 'react' && (
            <ReactVideoTab
              author={comment?.author?.username}
              permlink={comment.permlink}
              currentTime={replyTimestamp ?? currentTime}
              formatTime={formatTimeInput}
              onPosted={() => { setReplyTab('comment'); setActiveReply(null); onRefreshReactions?.(); }}
              onRecordStart={onPause}
            />
          )}
        </div>
      )}

      {comment.children && comment.children.length > 0 && (
        <div className="nested-comments">
          {comment.children.map((child, index) => (
            <Comment
              key={`${child.permlink}-${index}`}
              commentIndex={index}
              comment={child}
              setCommentList={setCommentList}
              activeReply={activeReply}
              setActiveReply={setActiveReply}
              setReplyToComment={setReplyToComment}
              setCommentInfo={setCommentInfo}
              setReplyText={setReplyText}
              commentInfo={commentInfo}
              handlePostComment={handlePostComment}
              depth={depth + 1}
              handleVote={handleVote}
              processedBody={processedBody}
              toggleTooltip={toggleTooltip}
              selectedPost={selectedPost}
              showTooltip={showTooltip}
              setShowTooltip={setShowTooltip}
              activeTooltipPermlink={activeTooltipPermlink}
              setActiveTooltipPermlink={setActiveTooltipPermlink}
              weight={weight}
             setWeight={setWeight}
      voteValue={voteValue}
      setVoteValue={setVoteValue}
      accountData={accountData}
      setAccountData={setAccountData}
      onSeek={onSeek}
      currentTime={currentTime}
      duration={duration}
      onRefreshReactions={onRefreshReactions}
      onTranslate={onTranslate}
      getTranslation={getTranslation}
      clearTranslation={clearTranslation}
      translating={translating}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default CommentSection;