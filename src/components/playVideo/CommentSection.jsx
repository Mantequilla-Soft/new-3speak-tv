import React, { useEffect, useState } from 'react';
import './CommentSection.scss';
import './BlogContent.scss';
import { GiTwoCoins } from 'react-icons/gi';
import { BiDislike, BiLike } from 'react-icons/bi';
import dayjs from 'dayjs';
import { useAppStore } from '../../lib/store';
import { renderPostBody } from '@ecency/render-helper';
import { Client } from '@hiveio/dhive';
import UpvoteTooltip from '../tooltip/UpvoteTooltip';
import CommentVoteTooltip from '../tooltip/CommentVoteTooltip';

const client = new Client(['https://api.hive.blog']);

function CommentSection({ videoDetails, author, permlink }) {
  const { user } = useAppStore();
  const [commentInfo, setCommentInfo] = useState('');
  const [activeReply, setActiveReply] = useState(null);
  const [replyToComment, setReplyToComment] = useState(null);
  const [commentList, setCommentList] = useState([]);
  const [selectedPost, setSelectedPost] = useState({ author: '', permlink: '' });
  const [showTooltip, setShowTooltip] = useState(false);
  const [activeTooltipPermlink, setActiveTooltipPermlink] = useState(null);
  const [commemtStyle, setCommentStyle] = useState(true);

  useEffect(() => {
    const fetchComments = async () => {
      try {
        const replies = await client.call('condenser_api', 'get_content_replies', [author, permlink]);
        console.log('Replies:', replies);
        const commentsWithChildren = await loadNestedComments(replies);
        setCommentList(commentsWithChildren);
      } catch (error) {
        console.error('Failed to fetch comments from Hive:', error);
      }
    };

    fetchComments();
  }, [author, permlink]);

  const loadNestedComments = async (comments) => {
    const result = await Promise.all(
      comments.map(async (comment) => {
        const children = await client.call('condenser_api', 'get_content_replies', [comment.author, comment.permlink]);
        const has_voted = comment.active_votes?.some(v => v.voter === user) ?? false;
        return {
          author: {
            username: comment.author,
            profile: {
              images: {
                avatar: `https://images.hive.blog/u/${comment.author}/avatar`,
              },
            },
          },
          permlink: comment.permlink,
          created_at: comment.created,
          body: comment.body,
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

  const processedBody = (content) => {
    if (!content) return '';
    return renderPostBody(content, false);
  };

  const handlePostComment = async () => {
    if (!commentInfo.trim()) return;

    // Determine if we're replying to the main post or a comment
    const isReplyingToMainPost = !replyToComment;
    
    const parent_author = isReplyingToMainPost ? author : replyToComment.author.username;
    const parent_permlink = isReplyingToMainPost ? permlink : replyToComment.permlink;
    const new_permlink = `re-${parent_permlink}-${Date.now()}`;

    if (window.hive_keychain) {
      window.hive_keychain.requestBroadcast(
        user,
        [
          [
            'comment',
            {
              parent_author,
              parent_permlink,
              author: user,
              permlink: new_permlink,
              title: '',
              body: commentInfo,
              json_metadata: '{"app":"3speak/new-version"}',
            },
          ],
        ],
        'Posting',
        async (response) => {
          if (response.success) {
            const newComment = {
              author: {
                username: user,
                profile: {
                  images: {
                    avatar: `https://images.hive.blog/u/${user}/avatar`,
                  },
                },
              },
              permlink: new_permlink,
              created_at: new Date().toISOString(),
              body: commentInfo,
              stats: {
                num_likes: 0,
                num_dislikes: 0,
                total_hive_reward: 0,
              },
              children: [],
            };

            if (isReplyingToMainPost) {
              // Add the new comment to the top level comments
              setCommentList(prev => [newComment, ...prev]);
            } else {
              // Add the reply to the appropriate comment
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

              setCommentList((prev) => addReply(prev));
            }

            setCommentInfo('');
            setActiveReply(null);
            setReplyToComment(null);
          } else {
            alert(`Comment failed: ${response.message}`);
          }
        }
      );
    } else {
      alert('Hive Keychain is not installed. Please install the extension.');
    }
  };

  const handleVote = (username, permlink, weight = 10000) => {
    if (window.hive_keychain) {
      window.hive_keychain.requestBroadcast(
        user,
        [
          [
            'vote',
            {
              voter: user,
              author: username,
              permlink,
              weight,
            },
          ],
        ],
        'Posting',
        (response) => {
          if (response.success) {
            alert('Vote successful!');
          } else {
            alert(`Vote failed: ${response.message}`);
          }
        }
      );
    } else {
      alert('Hive Keychain is not installed. Please install the extension.');
    }
  };

  const toggleTooltip = (author, permlink, index) => {
    console.log('Toggle Tooltip:', author, permlink, index);
    setSelectedPost({ author, permlink });
    console.log('Selected Post:', selectedPost);
    setShowTooltip(prev => !prev || activeTooltipPermlink !== permlink);
    setActiveTooltipPermlink((prev) => (prev === permlink ? null : permlink));
  };

  return (
    <div className="vid-comment-wrap">
      
      
      {/* Main comment form */}
      <div className="add-comment-wrap">
        <span>Add a comment:</span>
        <textarea
          placeholder="Write your comment here..."
          className="textarea-box"
          value={commentInfo}
          onChange={(e) => setCommentInfo(e.target.value)}
        />
        <div className="btn-wrap">
          <button onClick={() => {
            setCommentInfo('');
            setReplyToComment(null);
          }}>Cancel</button>
          <button onClick={() => {
            setReplyToComment(null);
            handlePostComment();
          }}>Comment</button>
        </div>
      </div>

      <h4>{commentList.length} Comments</h4>
      
      {commentList.map((comment, index) => (
        <Comment
          commentIndex={index}
          comment={comment}
          setCommentList={setCommentList}
          activeReply={activeReply}
          setActiveReply={setActiveReply}
          setReplyToComment={setReplyToComment}
          setCommentInfo={setCommentInfo}
          commentInfo={commentInfo}
          handlePostComment={handlePostComment}
          depth={0}
          handleVote={handleVote}
          processedBody={processedBody}
          toggleTooltip={toggleTooltip}
          selectedPost={selectedPost}
          showTooltip={showTooltip}
          setShowTooltip={setShowTooltip}
          activeTooltipPermlink={activeTooltipPermlink}
          setActiveTooltipPermlink={setActiveTooltipPermlink}
          commemtStyle={commemtStyle}
          
        />
      ))}
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
  commemtStyle
}) {
  const isReplying = activeReply === comment.permlink;

  return (
    <div className="comment-container" style={{ marginLeft: depth > 0 ? '40px' : '0px' }} >
      <div className="comment">
        <img src={comment?.author?.profile?.images?.avatar || 'https://via.placeholder.com/40'} alt="Author Avatar" />
        <div>
          <h3>
            {comment?.author?.username}
            <span>{dayjs(comment?.created_at).fromNow()}</span>
          </h3>
          <p className="markdown-view" dangerouslySetInnerHTML={{ __html: processedBody(comment?.body || '') }} />
          <div className="comment-action">
            <div className="wrap">
              <BiLike style={{ color: comment.has_voted ? 'red' : '' }}
              onClick={() => toggleTooltip(comment?.author?.username, comment.permlink, commentIndex)}
               />
              <span>{comment?.stats?.num_likes ?? 0}</span>
            </div>
            {/* <div className="wrap">
              <BiDislike />
              <span>{comment?.stats?.num_dislikes ?? 0}</span>
            </div> */}
            <div className="wrap">
              <GiTwoCoins />
              <span>${comment?.stats?.total_hive_reward?.toFixed(2) ?? '0.00'}</span>
            </div>
            <span
              className="main-reply"
              onClick={() => {
                setActiveReply(comment.permlink);
                setReplyToComment(comment);
              }}
            >
              Reply
            </span>
            <CommentVoteTooltip
             author={comment?.author?.username}
             permlink={comment.permlink}
             showTooltip={showTooltip && activeTooltipPermlink === comment.permlink}
             setShowTooltip={setShowTooltip}
             setCommentList={setCommentList}
             setActiveTooltipPermlink={setActiveTooltipPermlink}
             commemtStyle={commemtStyle}
            />
          </div>
        </div>
      </div>

      {isReplying && (
        <div className="add-comment-wrap sub">
          <span>Reply:</span>
          <textarea
            placeholder="Write your reply here..."
            className="textarea-box sub"
            value={commentInfo}
            onChange={(e) => setCommentInfo(e.target.value)}
          />
          <div className="btn-wrap">
            <button onClick={() => setActiveReply(null)}>Cancel</button>
            <button onClick={handlePostComment}>Comment</button>
          </div>
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
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default CommentSection;