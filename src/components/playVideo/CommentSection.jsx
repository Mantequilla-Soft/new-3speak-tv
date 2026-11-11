import MarkdownView from '../common/MarkdownView';
import React, { useEffect, useId, useState, useRef, useCallback, useMemo } from 'react';
import { getHiveClient } from '../../utils/hiveNode';
import './CommentSection.scss';
import './BlogContent.scss';
import { Icon } from '../v2/Icon';
import { Button, IconButton, Segmented, EmptyState } from '../v2/ui';
import { cx } from '../v2/helpers';
import ReportModal, { isReported } from '../modal/ReportModal';
import useTranslation from '../../hooks/useTranslation';
import { useTranslation as useI18n } from 'react-i18next';
import TranslateButton from '../TranslateButton/TranslateButton';
import ReactVideoTab from '../ReactVideoModal/ReactVideoModal';
import { useAppStore } from '../../lib/store';
import { handleAvatar, postIncubationContent } from '../../lib/incubation';
import { mergeOffChainReplies, applyOffChainLikes } from '../../utils/offChainReplies';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';
import { toastIn } from '../../utils/toast';
import { estimate, getVotePower } from '../../utils/hiveUtils';
import { markByReputation, getUserReputation } from '../../utils/reputation';
import { markByHidden } from '../../utils/hiddenCreators';
import AuthorBadge from '../AuthorBadge/AuthorBadge';
import AccountImg from '../HiveAvatar/AccountImg';
import PayoutAmount from '../PayoutAmount/PayoutAmount';
import { commentWithAioha } from '../../hive-api/aioha';
import { HIVE_API_NODES } from '../../utils/config';
import TimeAgo from '../TimeAgo/TimeAgo';
import { Link } from 'react-router-dom';
import EmojiGifPicker from '../common/EmojiGifPicker/EmojiGifPicker';
import { insertAtCursor, gifMarkdown } from '../../utils/composerInsert';
import useEmojiShortcodes from '../../hooks/useEmojiShortcodes';
import { getHiveRenderer } from '../../lib/hiveRenderer';
import { setCommentPinned } from '../../lib/commentPins';
import {
  readCommentSort, saveCommentSort, sortComments, pinnedFirst, useCommentImageUpload, CommentImageButton, CommentDropZone,
} from './commentTools';
import {
  linkifyTimestamps, handleTimestampClick, linkTimestampsInMarkdown, unlinkTimestampsInMarkdown,
} from '../../utils/timestamps';

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

// Replace timestamp-linked 3speak URLs so the renderer doesn't embed them
// Matches [0:00] or [1:23:45] style text linking to 3speak/play.3speak URLs
const stripTimestampEmbeds = (body) =>
  body.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]\((https?:\/\/(?:3speak\.tv|play\.3speak\.tv)[^)]*)\)/g, '$1');

// A timestamped comment's body ENDS with the "replied to [0:42](…) on [host](…)"
// line that handlePostComment appends. It is ours, not the author's words, so an
// edit keeps it out of the text box and puts it back unchanged on save; losing it
// would silently drop the comment's link back to its moment in the video.
const REPLIED_TO_RE = /\n?<br><sup>replied to \[[^\]]*\]\([^)]*\) on \[[^\]]*\]\([^)]*\)<\/sup>\s*$/;
function splitRepliedTo(body) {
  const m = REPLIED_TO_RE.exec(body || '');
  return m
    ? { text: body.slice(0, m.index), suffix: m[0] }
    : { text: body || '', suffix: '' };
}

// The Comment / React switch at the head of every composer: a segmented track,
// never underlined tabs (STYLE_GUIDE 43a).
function ComposerModeTabs({ value, onChange }) {
  const { t } = useI18n();
  return (
    <Segmented
      size={28}
      block={false}
      className="comment-mode-seg"
      value={value}
      onChange={onChange}
      options={[
        { value: 'comment', label: t('comments.section.commentTab') },
        { value: 'react', label: t('comments.section.reactTab') },
      ]}
    />
  );
}

/**
 * `panel`: the watch page's side panel gives this a fixed height. The list then
 * scrolls inside it and the composer is pinned at the bottom, as in a chat
 * (design 02 / 43a). Without it (posts, audio) the composer sits on top and the
 * list flows with the page.
 */
function CommentSection({ videoDetails, author, permlink, currentTime, duration, onSeek, onPause, onRefreshReactions, pinnedComments, pinnable = false, panel = false }) {
  const { t } = useI18n();
  const { user, incubationHandle } = useAppStore();
  // The name to SHOW. For an incubating user there is no Hive account, so
  // `user` is null and the handle is all there is.
  const displayName = user || incubationHandle;
  const { translate, getTranslation, clearTranslation, translating } = useTranslation();
  const [commentInfo, setCommentInfo] = useState('');
  const [activeTab, setActiveTab] = useState('comment'); // 'comment' | 'react'
  // The side panel's composer rests as one line (02: the moment, "Join the
  // discussion…", send) and opens into the full one (43a) when used.
  const [composerOpen, setComposerOpen] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [activeReply, setActiveReply] = useState(null);
  const [replyToComment, setReplyToComment] = useState(null);
  const [commentList, setCommentList] = useState([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [selectedPost, setSelectedPost] = useState({ author: '', permlink: '' });
  const [showTooltip, setShowTooltip] = useState(false);
  const [activeTooltipPermlink, setActiveTooltipPermlink] = useState(null);
    const [weight, setWeight] = useState(100);
    const [voteValue, setVoteValue] = useState(0.0);
      const [accountData, setAccountData] = useState(null);
  // Cache for rendered comment bodies
  const [renderedBodies, setRenderedBodies] = useState({});
  const commentInputRef = useRef(null);
  // ":fire:" → 🔥 and the ":" emoji list, as in the chat.
  const commentEmoji = useEmojiShortcodes(commentInputRef, commentInfo, setCommentInfo);
  const commentImages = useCommentImageUpload(commentInputRef, commentInfo, setCommentInfo, user);

  // Write / Preview: the preview goes through what a posted comment goes
  // through (handlePostComment's linkTimestampsInMarkdown, then the fetch's
  // render(stripTimestampEmbeds(...)), then processedBody's linkifyTimestamps),
  // so it shows exactly what will be posted.
  const canSeek = !!onSeek;
  const toPreviewHtml = useCallback((render, text) => {
    const html = render(stripTimestampEmbeds(linkTimestampsInMarkdown(text, { author, permlink, duration })));
    return canSeek ? linkifyTimestamps(html, duration) : html;
  }, [author, permlink, duration, canSeek]);
  const onSeekLatest = useRef(onSeek);
  useEffect(() => { onSeekLatest.current = onSeek; }, [onSeek]);
  const onPreviewClick = useCallback((e) => handleTimestampClick(e, onSeekLatest.current), []);

  const [sort, setSort] = useState(readCommentSort);
  const changeSort = (v) => { setSort(v); saveCommentSort(v); };

  // Comments the video's author pinned to the top (permlinks, newest pin first),
  // stored on the video row by the checker (routes/commentPins.js).
  const [pinned, setPinned] = useState(() => (Array.isArray(pinnedComments) ? pinnedComments : []));
  useEffect(() => { setPinned(Array.isArray(pinnedComments) ? pinnedComments : []); }, [pinnedComments, author, permlink]);
  // Only the author of the video, signed in with a Hive account.
  const canPin = pinnable && !!user && !incubationHandle && user === author;
  const [pinBusy, setPinBusy] = useState(null);
  const handleTogglePin = async (comment) => {
    if (!canPin || pinBusy) return;
    const isPinned = pinned.includes(comment.permlink);
    setPinBusy(comment.permlink);
    try {
      const next = await setCommentPinned({ author, permlink, comment: comment.permlink, pinned: !isPinned });
      setPinned(next);
      toast.success(isPinned ? t('comments.section.unpinned') : t('comments.section.pinned'));
    } catch (err) {
      console.error('Comment pin failed:', err);
      toast.error(err?.message || t('comments.section.pinFailed'));
    } finally {
      setPinBusy(null);
    }
  };

  // Pinned first (in pin order), then the rest in the viewer's order.
  const displayList = useMemo(() => pinnedFirst(sortComments(commentList, sort), pinned), [commentList, sort, pinned]);

  // Timeline position state — auto-follows playhead unless manually edited
  const [timelineInput, setTimelineInput] = useState('0:00');
  const momentId = useId();
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

  // The textarea grows with an inline height while typing; drop it once the text
  // is cleared (posted or cancelled) so the box shrinks back to its CSS size.
  useEffect(() => {
    if (!commentInfo && commentInputRef.current) commentInputRef.current.style.height = '';
  }, [commentInfo]);

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
        // The Hive thread, in its OWN try: an off-chain post does not exist on
        // chain, and get_content_replies ANSWERS THAT BY THROWING ("Post a/p
        // does not exist") rather than returning an empty list. That threw out
        // of the whole function, so the off-chain merge below never ran and a
        // post whose only comments are off-chain showed none of them.
        let markedComments = [];
        try {
          const replies = await client.call('condenser_api', 'get_content_replies', [author, permlink]);
          const commentsWithChildren = await loadNestedComments(replies);
          // Mark low-reputation accounts (rep < 15) — also caches reputations
          markedComments = await markByHidden(await markByReputation(commentsWithChildren));
        } catch (err) {
          // Normal for an off-chain post; anything else is worth a line.
          console.warn('[comments] no Hive thread:', err?.message);
        }
        // Attach cached reputations to comment authors (all cache hits after marking)
        const attachRep = async (comments) => {
          for (const c of comments) {
            if (c.author?.username) c.author.reputation = await getUserReputation(c.author.username);
            if (c.children?.length) await attachRep(c.children);
          }
        };
        await attachRep(markedComments);

        // Off-chain replies and off-chain likes, merged into the Hive thread.
        //
        // Both halves used to live inline here, which is why no other view had
        // them: shorts and snaps would have had to copy a hundred lines to show
        // a reply written under their own content. Shared now, so the three
        // surfaces cannot drift into disagreeing about what a thread contains.
        const withOffChain = await applyOffChainLikes(
          await mergeOffChainReplies(permlink, markedComments),
          displayName,
        );
        setCommentList(withOffChain);
        
        // Pre-render all comment bodies (createHiveRenderer returns a function directly)
        const render = await getHiveRenderer();
        const rendered = {};
        const renderComment = (comment) => {
          if (comment?.body) {
            try {
              rendered[comment.permlink] = render(stripTimestampEmbeds(comment.body));
            } catch {
              rendered[comment.permlink] = '';
            }
          }
          if (comment.children) {
            comment.children.forEach(renderComment);
          }
        };
        // withOffChain, not markedComments: the off-chain replies are what this
        // whole merge exists for, and a comment with no entry here renders as an
        // empty bubble -- present in the list and invisible on the page.
        withOffChain.forEach(renderComment);
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
        if (!user) return;   // guests have no voting power to show
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
        let jsonMetadata = null;
        try {
          const meta = typeof comment.json_metadata === 'string' ? JSON.parse(comment.json_metadata) : comment.json_metadata;
          if (meta && typeof meta === 'object') jsonMetadata = meta;
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

        } catch { /* not JSON: no metadata */ }
        return {
          author: {
            username: comment.author,
            profile: {
              images: {
                avatar: `/img/u/${comment.author}/avatar/small`,
              },
            },
          },
          permlink: comment.permlink,
          created_at: comment.created,
          // Hive edits the comment in place when the SAME author/permlink is
          // broadcast again under the same parent, so an edit needs all of these,
          // plus the original metadata so it keeps its timestamp and app tag.
          parentAuthor: comment.parent_author,
          parentPermlink: comment.parent_permlink,
          jsonMetadata,
          edited: !!comment.last_update && comment.last_update !== comment.created,
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

    // "4:12" in a comment seeks there, if the video is that long.
    return onSeek ? linkifyTimestamps(html, duration) : html;
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

      // Timestamps in the text become real 3speak.tv links to that moment, so
      // they work on every Hive frontend. Rendered here, they turn back into the
      // in-page seek link (stripTimestampEmbeds + linkifyTimestamps).
      let body = linkTimestampsInMarkdown(textToPost, { author, permlink, duration });

      // Append "replied to" timestamp reference if we have a timestamp
      if (metadata.parentTimestamp > 0) {
        const ts = metadata.parentTimestamp;
        const tsLabel = formatTimeInput(ts);
        const baseUrl = window.location.origin;
        const host = window.location.host;
        body += `\n<br><sup>replied to [${tsLabel}](${baseUrl}/watch?v=${author}/${permlink}&t=${ts}) on [${host}](${baseUrl})</sup>`;
      }

      // Two different reasons a comment cannot be broadcast, and only one of
      // them is about the commenter.
      //
      // The PARENT being off-chain is decided here, because only the caller
      // knows it: Hive rejects a comment whose parent does not exist, so a
      // reply to an off-chain post has to be stored no matter who is writing it
      // — including a Hive user with a perfectly good account.
      //
      // The same goes for a reply to an off-chain COMMENT (a warm-up user's, or
      // one stored under a warm-up post) on an otherwise on-chain post.
      //
      // The AUTHOR having no Hive account is handled inside commentWithAioha,
      // at the one choke point every posting path already passes through.
      let result;
      if (videoDetails?._incubation || replyToComment?.onChain === false) {
        const stored = await postIncubationContent({
          body,
          parentAuthor: parent_author,
          parentPermlink: parent_permlink,
          jsonMetadata: metadata,
        });
        result = { success: true, incubation: true, permlink: stored.permlink };
      } else {
        result = await commentWithAioha(
          parent_author,
          parent_permlink,
          new_permlink,
          '', // title (empty for comments)
          body,
          metadata
        );
      }

      if (result.success) {
        toast.success(t('comments.section.posted'));
        // A stored comment gets the store's permlink; replying to it must use that.
        const postedPermlink = (result.incubation && result.permlink) || new_permlink;
        const newComment = {
          author: {
            username: displayName,
            profile: {
              images: {
                // images.hive.blog answers an unknown name with a 500, not a
                // placeholder, so an incubating handle needs a local avatar or
                // it renders broken.
                avatar: incubationHandle
                  ? handleAvatar(incubationHandle)
                  : `/img/u/${user}/avatar/small`,
              },
            },
          },
          // Marks this as off-chain so the thread can show it differently and
          // so nothing tries to build a Hive permalink for it.
          onChain: !incubationHandle && !result.incubation,
          permlink: postedPermlink,
          created_at: new Date().toISOString(),
          parentAuthor: parent_author,
          parentPermlink: parent_permlink,
          jsonMetadata: metadata,
          // The full broadcast body, "replied to" line included, as a fetched
          // comment carries it, so editing a just-posted comment keeps that line.
          // processedBody strips it for display.
          body,
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
          setRenderedBodies(prev => ({ ...prev, [postedPermlink]: render(textToPost) }));
        } catch { /* fall back to raw body until refetch */ }

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
        toast.error(t('comments.section.postFailed'));
      }
    } catch (err) {
      console.error('Comment failed:', err);
      toast.error(err.message || t('comments.section.postFailed'));
    }
  };

  // Only a signed-in Hive account edits, and only its own on-chain comments. An
  // incubating user has no chain comments to edit, and commentWithAioha would
  // divert their broadcast to the off-chain store instead of editing anything.
  const editableBy = user && !incubationHandle ? user : null;

  /**
   * Edit one of your own comments: broadcast the same author/permlink again,
   * under the same parent, with the new body. No comment_options, which can
   * only be set once per comment and would fail the whole transaction.
   * Resolves true when the edit landed, so the editor knows to close.
   */
  // What the edit box starts with: the author's words, with the 3speak links we
  // made of their timestamps turned back into plain "4:12" (re-linked on save).
  const editableText = (body) => unlinkTimestampsInMarkdown(splitRepliedTo(body).text, { author, permlink });

  const handleEditComment = async (comment, newText) => {
    const text = (newText || '').trim();
    if (!text) return false;
    if (!editableBy || comment?.author?.username !== editableBy) return false;
    const { suffix } = splitRepliedTo(comment.body);
    const body = linkTimestampsInMarkdown(text, { author, permlink, duration }) + suffix;
    try {
      const result = await commentWithAioha(
        comment.parentAuthor,
        comment.parentPermlink,
        comment.permlink,
        '', // title (empty for comments)
        body,
        comment.jsonMetadata || { app: '3speak/new-version' },
      );
      if (!result?.success) {
        toast.error(t('comments.section.editFailed'));
        return false;
      }
      const applyEdit = (comments) =>
        comments.map((c) => {
          if (c.permlink === comment.permlink && c.author?.username === editableBy) {
            return { ...c, body, edited: true };
          }
          return c.children ? { ...c, children: applyEdit(c.children) } : c;
        });
      setCommentList((prev) => applyEdit(prev));
      try {
        const render = await getHiveRenderer();
        setRenderedBodies((prev) => ({ ...prev, [comment.permlink]: render(stripTimestampEmbeds(body)) }));
      } catch { /* falls back to the raw body until the next fetch */ }
      toast.success(t('comments.section.updated'));
      return true;
    } catch (err) {
      console.error('Comment edit failed:', err);
      toast.error(err.message || t('comments.section.editFailed'));
      return false;
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

  const toggleTooltip = (author, permlink) => {
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

  const commentCount = countComments(commentList);

  const composerCompact = panel && !composerOpen && !commentInfo && activeTab === 'comment'
    && !(commentImages.pending?.length) && !commentImages.uploading;
  const openComposer = useCallback(() => setComposerOpen(true), []);
  // Opened from the one-line box: the full box takes the focus over.
  const wasCompact = useRef(composerCompact);
  useEffect(() => {
    if (wasCompact.current && !composerCompact && activeTab === 'comment') {
      commentInputRef.current?.focus({ preventScroll: true });
    }
    wasCompact.current = composerCompact;
  }, [composerCompact, activeTab]);
  // Back to one line once focus leaves an empty box (not into its own popovers).
  const onComposerBlur = (e) => {
    if (!panel || commentInfo || activeTab !== 'comment') return;
    const next = e.relatedTarget;
    if (next && (e.currentTarget.contains(next) || next.closest?.('.egp-emoji-popover, .egp-gif-popover'))) return;
    setTimeout(() => {
      const el = commentInputRef.current;
      if (el && document.activeElement === el) return;
      if (document.activeElement?.closest?.('.egp-emoji-popover, .egp-gif-popover, .add-comment-wrap')) return;
      setComposerOpen(false);
    }, 0);
  };

  const compactComposer = (
    // The same hooks as the full box: `add-comment-wrap .textarea-box` (focused
    // by the dock's Comment tile) and the Comment / React switch (pressed by the
    // player's "React to this moment"), kept in the DOM while hidden.
    <div className="comment-composer add-comment-wrap is-compact">
      <div hidden><ComposerModeTabs value={activeTab} onChange={(v) => { setActiveTab(v); setComposerOpen(true); }} /></div>
      <button type="button" className="comment-moment-chip num" onClick={openComposer} title={t('comments.section.at')}>
        {timelineInput || '0:00'}
      </button>
      <textarea
        ref={commentInputRef}
        rows={1}
        readOnly
        placeholder={t('comments.section.joinPlaceholder')}
        aria-label={t('comments.section.commentPlaceholder')}
        className="textarea-box"
        value=""
        onFocus={() => { handleTextareaFocus(); openComposer(); }}
        onClick={openComposer}
      />
      <IconButton icon="send" round size={40} variant="primary" className="comment-send" label={t('comments.section.commentButton')} onClick={openComposer} />
    </div>
  );

  const composer = composerCompact ? compactComposer : (
    // `add-comment-wrap` stays: PostView's Reply button finds the box through it.
    <div className={cx('comment-composer add-comment-wrap', activeTab === 'react' && 'is-react')} onBlur={onComposerBlur}>
      {activeTab === 'comment' ? (
        <>
          <CommentDropZone
            images={commentImages}
            value={commentInfo}
            setValue={setCommentInfo}
            toHtml={toPreviewHtml}
            previewClassName="comment-content"
            onPreviewClick={onPreviewClick}
            tabsLead={<ComposerModeTabs value={activeTab} onChange={setActiveTab} />}
          >
            <textarea
              ref={commentInputRef}
              placeholder={t('comments.section.commentPlaceholder')}
              className="textarea-box"
              value={commentInfo}
              onChange={(e) => {
                setCommentInfo(commentEmoji.change(e));
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onKeyDown={commentEmoji.keyDown}
              onBlur={commentEmoji.blur}
              onFocus={handleTextareaFocus}
              onPaste={commentImages.onPaste}
            />
            {commentEmoji.popup}
          </CommentDropZone>
          <div className="comment-form-row">
            <div className="comment-compose-tools">
              <EmojiGifPicker
                portal={panel}
                onPickEmoji={(em) => insertAtCursor(commentInputRef.current, commentInfo, em, setCommentInfo)}
                onPickGif={(url) => insertAtCursor(commentInputRef.current, commentInfo, gifMarkdown(url), setCommentInfo)}
              />
              <CommentImageButton uploading={commentImages.uploading} onFiles={commentImages.upload} />
              {/* The moment of the video this comment is about: follows the
                  playhead until typed in by hand. */}
              <div className="comment-timestamp">
                <label className="comment-timestamp-label" htmlFor={momentId}>{t('comments.section.at')}</label>
                <input
                  id={momentId}
                  type="text"
                  inputMode="numeric"
                  className="comment-timestamp-input"
                  value={timelineInput}
                  onChange={handleTimelineInputChange}
                  onBlur={handleTimelineInputBlur}
                  placeholder="0:00"
                />
              </div>
            </div>
            <div className="btn-wrap">
              {(commentInfo || panel) && (
                <Button variant="ghost" size={32} onClick={() => {
                  setCommentInfo('');
                  setReplyToComment(null);
                  setComposerOpen(false);
                }}>{t('common.actions.cancel')}</Button>
              )}
              <Button variant="primary" size={32} trailing="send" onClick={() => {
                setReplyToComment(null);
                handlePostComment();
              }}>{t('comments.section.commentButton')}</Button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="comment-write-tabs">
            <ComposerModeTabs value={activeTab} onChange={setActiveTab} />
          </div>
          <div className="comment-react-pane">
            <ReactVideoTab
              author={author}
              permlink={permlink}
              currentTime={currentTime}
              formatTime={formatTimeInput}
              onPosted={() => { setActiveTab('comment'); onRefreshReactions?.(); }}
              onRecordStart={onPause}
            />
          </div>
        </>
      )}
    </div>
  );

  const list = (
    <div className="comment-list">
      {loadingComments ? (
        <div className="comments-loading" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="comment-skeleton" aria-hidden="true">
              <span className="v2-skeleton comment-skeleton-avatar" />
              <span className="comment-skeleton-lines">
                <span className="v2-skeleton is-line" />
                <span className="v2-skeleton is-line" />
              </span>
            </div>
          ))}
        </div>
      ) : displayList.length === 0 ? (
        <EmptyState icon="forum" title={t('comments.section.empty')} className="comments-empty">
          {t('comments.section.emptyHint')}
        </EmptyState>
      ) : (
        displayList.map((comment, index) => (
          <Comment
            key={`${comment.author?.username}-${comment.permlink || index}`}
            commentIndex={index}
            comment={comment}
            videoAuthor={author}
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
            editableBy={editableBy}
            onEditComment={handleEditComment}
            editableText={editableText}
            isPinned={pinned.includes(comment.permlink)}
            onTogglePin={canPin && comment.onChain !== false ? handleTogglePin : null}
            pinBusy={pinBusy === comment.permlink}
            currentUser={user}
            onPause={onPause}
            toPreviewHtml={toPreviewHtml}
            panel={panel}
          />
        ))
      )}
    </div>
  );

  return (
    <div className={cx('vid-comment-wrap', panel ? 'is-panel' : 'is-page')}>
      <div className="comments-header-row">
        {/* The panel's tab already carries the count (02). */}
        <h4 className={cx(panel && 'is-sr')}>{t('comments.section.count', { count: commentCount })}</h4>
        <label className="comment-sort">
          <Icon name="sort" size={16} />
          <span className="comment-sort-label">{t('comments.section.sortBy')}</span>
          <select className="v2-input is-select h32" value={sort} onChange={(e) => changeSort(e.target.value)}>
            <option value="newest">{t('comments.section.sortNewest')}</option>
            <option value="oldest">{t('comments.section.sortOldest')}</option>
            <option value="popular">{t('comments.section.sortPopular')}</option>
          </select>
        </label>
      </div>
      {panel ? <>{list}{composer}</> : <>{composer}{list}</>}
    </div>
  );
}

function Comment({
  commentIndex,
  comment,
  videoAuthor,
  panel = false,
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
      editableBy,
      onEditComment,
      editableText,
      isPinned = false,
      onTogglePin = null,
      pinBusy = false,
      currentUser = null,
      // The reply box's React tab pauses the video while recording, as the
      // top-level one does. It was used here without ever being passed down.
      onPause,
      toPreviewHtml,
}) {
  const { t } = useI18n();
  const isReplying = activeReply === comment.permlink;
  const replyInputRef = useRef(null);
  // One click handler for the life of the comment: MarkdownView is memoised, and
  // a new arrow per render (every playhead tick) defeated it and rebuilt the body
  // each second (selection lost, code blocks' scrollbars flashing).
  const onSeekRef = useRef(onSeek);
  useEffect(() => { onSeekRef.current = onSeek; }, [onSeek]);
  const onBodyClick = useCallback((e) => handleTimestampClick(e, onSeekRef.current), []);
  const editInputRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const editEmoji = useEmojiShortcodes(editInputRef, editText, setEditText);
  const editImages = useCommentImageUpload(editInputRef, editText, setEditText, currentUser);
  const replyImages = useCommentImageUpload(replyInputRef, replyText, setReplyText, currentUser);
  const [savingEdit, setSavingEdit] = useState(false);
  // Off-chain replies (onChain: false) live in our own store, not on Hive, so a
  // Hive edit cannot reach them.
  const canEdit = !!editableBy && comment.onChain !== false
    && comment?.author?.username === editableBy && !!comment.parentPermlink;

  const startEdit = () => {
    setEditText((editableText ? editableText(comment.body) : splitRepliedTo(comment.body).text).trim());
    setEditing(true);
  };

  const saveEdit = async () => {
    if (savingEdit || !editText.trim()) return;
    setSavingEdit(true);
    const ok = await onEditComment?.(comment, editText);
    setSavingEdit(false);
    if (ok) setEditing(false);
  };

  // Size the box to its content when it opens, as typing does afterwards.
  useEffect(() => {
    const el = editInputRef.current;
    if (!editing || !el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    el.focus();
  }, [editing]);
  const [replyTab, setReplyTab] = useState('comment');
  const [collapsed, setCollapsed] = useState(false);
  const [showReplies, setShowReplies] = useState(false);
  // Replying here opens the thread, so the new reply lands in view.
  useEffect(() => { if (isReplying) setShowReplies(true); }, [isReplying]);
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

  const username = comment?.author?.username;
  // The video's own creator, marked like the 28a "CREATOR" pill.
  const isCreator = !!videoAuthor && username === videoAuthor;
  const reported = isReported('comment', `${username}/${comment.permlink}`);

  if (collapsed) {
    return (
      <div className={cx('comment-container', depth > 0 && 'is-reply')}>
        <div
          className="comment-collapsed-bar"
          role="button"
          tabIndex={0}
          aria-expanded="false"
          aria-label={t('comments.section.showComment', { user: username || '' })}
          onClick={() => setCollapsed(false)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            setCollapsed(false);
          }}
        >
          <AuthorBadge author={username} reputation={comment?.author?.reputation} noLink compact />
          <Icon name="expand_more" size={18} className="comment-collapsed-chevron" />
        </div>
      </div>
    );
  }

  // Panel (02): replies fold under an "N replies" link; on a page they show.
  const visibleReplies = (comment.children || []).filter((c) => !c.isLowReputation && !c.isHidden).length;

  return (
    <div className={cx('comment-container', depth > 0 && 'is-reply')}>
      <div className={cx('comment', isPinned && 'is-pinned', isCreator && 'is-creator')}>
        {/* The avatar in its own column, the text beside it (02, 28a). */}
        <Link to={`/@${username}`} className="comment-avatar" tabIndex={-1} aria-hidden="true">
          <AccountImg account={username} alt="" loading="lazy" />
        </Link>
        <div className="comment-content">
          {isPinned && (
            <span className="comment-pinned-badge"><Icon name="push_pin" size={12} fill />{t('comments.section.pinnedByCreator')}</span>
          )}
          <div className="comment-header">
            <Link to={`/@${username}`} className="comment-author">{username}</Link>
            {isCreator && <span className="v2-pill is-accent comment-creator-pill">{t('comments.section.creator')}</span>}
            <span className="comment-date"><TimeAgo date={comment?.created_at} /></span>
            {comment?.edited && <span className="comment-edited">{t('comments.section.edited')}</span>}
            {comment?.parentTimestamp != null && (
              <button
                type="button"
                className="comment-timestamp-badge"
                aria-label={t('comments.section.atTime', { time: formatTimeInput(comment.parentTimestamp) })}
                title={t('comments.section.atTime', { time: formatTimeInput(comment.parentTimestamp) })}
                onClick={() => onSeek?.(comment.parentTimestamp)}
              >{formatTimeInput(comment.parentTimestamp)}</button>
            )}
            <button
              type="button"
              className="btn-reset comment-collapse-chevron"
              aria-expanded="true"
              aria-label={t('comments.section.hideComment')}
              title={t('comments.section.hideComment')}
              onClick={() => setCollapsed(true)}
            ><Icon name="expand_less" size={18} /></button>
          </div>
          {editing ? (
            <div className="comment-composer comment-edit-wrap">
              <CommentDropZone
                images={editImages}
                value={editText}
                setValue={setEditText}
                disabled={savingEdit}
                toHtml={toPreviewHtml}
                previewClassName="comment-content"
                onPreviewClick={onBodyClick}
              >
              <textarea
                ref={editInputRef}
                className="textarea-box"
                value={editText}
                disabled={savingEdit}
                onChange={(e) => {
                  setEditText(editEmoji.change(e));
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onKeyDown={editEmoji.keyDown}
                onBlur={editEmoji.blur}
                onPaste={editImages.onPaste}
              />
              {editEmoji.popup}
              </CommentDropZone>
              <div className="comment-form-row">
                <div className="comment-compose-tools">
                  <EmojiGifPicker
                    portal={panel}
                    onPickEmoji={(em) => insertAtCursor(editInputRef.current, editText, em, setEditText)}
                    onPickGif={(url) => insertAtCursor(editInputRef.current, editText, gifMarkdown(url), setEditText)}
                  />
                  <CommentImageButton uploading={editImages.uploading} onFiles={editImages.upload} />
                </div>
                <div className="btn-wrap">
                  <Button variant="ghost" size={32} onClick={() => setEditing(false)}>{t('common.actions.cancel')}</Button>
                  <Button variant="primary" size={32} loading={savingEdit} onClick={saveEdit}>
                    {savingEdit ? t('comments.section.saving') : t('common.actions.save')}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <MarkdownView
              html={processedBody(comment?.body || '', comment?.permlink)}
              onClick={onBodyClick}
            />
          )}
          {translatedText && (
            <div className="comment-translation">
              <div className="comment-translation-header">
                <Icon name="translate" size={14} />
                <span>{t('comments.section.translation')}</span>
                <button
                  type="button"
                  className="comment-translation-dismiss"
                  onClick={handleDismissTranslation}
                  aria-label={t('common.actions.close')}
                  title={t('common.actions.close')}
                ><Icon name="close" size={16} /></button>
              </div>
              <p>{translatedText}</p>
            </div>
          )}
          {translateError && (
            <div className="comment-translation comment-translation--error" role="alert">
              <p>{t('comments.section.translationFailed')}</p>
            </div>
          )}
          <div className="comment-action">
            <button
              type="button"
              className={cx('comment-vote', comment.has_voted && 'is-voted')}
              aria-label={t('engagement.vote.vote')}
              aria-pressed={!!comment.has_voted}
              title={t('engagement.vote.vote')}
              onClick={() => toggleTooltip(username, comment.permlink, commentIndex)}
            >
              <Icon name="arrow_upward" size={16} fill={!!comment.has_voted} />
              <span className="num">{comment?.stats?.num_likes ?? 0}</span>
            </button>
            {Number(comment?.stats?.total_hive_reward) > 0 && <PayoutAmount amount={comment?.stats?.total_hive_reward} />}
            <Button variant="ghost" size={28} icon="reply" className="comment-act" onClick={() => {
              setCommentInfo("");
              setReplyText("");
              setActiveReply(comment.permlink);
              setReplyToComment(comment);
            }}>{t('common.actions.reply')}</Button>
            {canEdit && !editing && (
              <Button variant="ghost" size={28} icon="edit" className="comment-act" onClick={startEdit}>{t('common.actions.edit')}</Button>
            )}
            {onTogglePin && depth === 0 && (
              <Button
                variant="ghost"
                size={28}
                icon="push_pin"
                className={cx('comment-act', isPinned && 'is-on')}
                onClick={() => onTogglePin(comment)}
                disabled={pinBusy}
              >{isPinned ? t('comments.section.unpin') : t('comments.section.pin')}</Button>
            )}
            {panel && visibleReplies > 0 && (
              <button
                type="button"
                className="comment-replies-toggle"
                aria-expanded={showReplies}
                onClick={() => setShowReplies((v) => !v)}
              >
                {t('comments.section.replies', { count: visibleReplies })}
              </button>
            )}
            <div className="comment-action-right">
              {comment.hasVideo && (
                <Link
                  to={`/shorts?v=${comment.shortAuthor || username}/${comment.shortPermlink || comment.permlink}`}
                  className="comment-shorts-link"
                  title={t('comments.section.openInShorts')}
                >
                  <Icon name="smart_display" size={16} />
                  <span className="comment-btn-label">{t('comments.section.openInShorts')}</span>
                </Link>
              )}
              <TranslateButton
                compact
                onTranslate={handleTranslate}
                isTranslating={!!translating?.[comment.permlink]}
              />
              <IconButton
                icon="flag"
                size={28}
                variant="ghost"
                className={cx('comment-report-btn', reported && 'reported')}
                label={t('comments.section.reportComment')}
                fill={reported}
                onClick={() => setIsReportOpen(true)}
              />
            </div>
            <ReportModal
              isOpen={isReportOpen}
              onClose={() => setIsReportOpen(false)}
              type="comment"
              target={{ author: username, permlink: comment.permlink }}
            />
            <CommentVoteTooltip
              voteKind="comment"
              author={username}
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
        <div className="comment-composer is-reply">
          {/* Comment tab */}
          {replyTab === 'comment' ? (
            <>
              <CommentDropZone
                images={replyImages}
                value={replyText}
                setValue={setReplyText}
                toHtml={toPreviewHtml}
                previewClassName="comment-content"
                onPreviewClick={onBodyClick}
                tabsLead={<ComposerModeTabs value={replyTab} onChange={setReplyTab} />}
              >
              <textarea
                ref={replyInputRef}
                placeholder={t('comments.section.replyPlaceholder')}
                className="textarea-box sub"
                value={replyText}
                onChange={(e) => {
                  setReplyText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onPaste={replyImages.onPaste}
              />
              </CommentDropZone>
              <div className="comment-form-row">
                <div className="comment-compose-tools">
                  <EmojiGifPicker
                    portal={panel}
                    onPickEmoji={(em) => insertAtCursor(replyInputRef.current, replyText, em, setReplyText)}
                    onPickGif={(url) => insertAtCursor(replyInputRef.current, replyText, gifMarkdown(url), setReplyText)}
                  />
                  <CommentImageButton uploading={replyImages.uploading} onFiles={replyImages.upload} />
                  {replyTimestamp != null && (
                    <span className="comment-timestamp comment-timestamp--fixed">{t('comments.section.atTime', { time: formatTimeInput(replyTimestamp) })}</span>
                  )}
                </div>
                <div className="btn-wrap">
                  <Button variant="ghost" size={32} onClick={() => { setReplyText(""); setActiveReply(null); }}>{t('common.actions.cancel')}</Button>
                  <Button variant="primary" size={32} trailing="send" onClick={() => handlePostComment(replyTimestamp)}>{t('comments.section.commentButton')}</Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="comment-write-tabs">
                <ComposerModeTabs value={replyTab} onChange={setReplyTab} />
                {replyTimestamp != null && (
                  <span className="comment-timestamp comment-timestamp--fixed">{t('comments.section.atTime', { time: formatTimeInput(replyTimestamp) })}</span>
                )}
              </div>
              <div className="comment-react-pane">
                <ReactVideoTab
                  author={username}
                  permlink={comment.permlink}
                  currentTime={replyTimestamp ?? currentTime}
                  formatTime={formatTimeInput}
                  onPosted={() => { setReplyTab('comment'); setActiveReply(null); onRefreshReactions?.(); }}
                  onRecordStart={onPause}
                />
              </div>
            </>
          )}
        </div>
      )}

      {comment.children && comment.children.length > 0 && (!panel || showReplies) && (
        <div className="nested-comments">
          {comment.children.map((child, index) => (
            <Comment
              key={`${child.permlink}-${index}`}
              commentIndex={index}
              comment={child}
              videoAuthor={videoAuthor}
              panel={panel}
              setCommentList={setCommentList}
              activeReply={activeReply}
              setActiveReply={setActiveReply}
              setReplyToComment={setReplyToComment}
              setCommentInfo={setCommentInfo}
              setReplyText={setReplyText}
              // Without the value a nested reply box is UNCONTROLLED: typing shows
              // in the box, but a picked GIF or emoji only lands in state, which
              // this box never displays, and replaces what was typed there.
              replyText={replyText}
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
              editableBy={editableBy}
              onEditComment={onEditComment}
              editableText={editableText}
              currentUser={currentUser}
              onPause={onPause}
              toPreviewHtml={toPreviewHtml}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default CommentSection;