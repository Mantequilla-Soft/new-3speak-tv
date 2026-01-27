import React, { useEffect, useState, useRef } from 'react';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { IoChevronUpCircleOutline } from 'react-icons/io5';
import { toast } from 'sonner';
import { estimate, getUersContent, getVotePower } from '../../utils/hiveUtils';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { Orbit } from 'ldrs/react';
import 'ldrs/react/Orbit.css';
import { voteWithAioha, isLoggedIn } from '../../hive-api/aioha';

const CommentVoteTooltip = ({
  author,
  permlink,
  showTooltip,
  setShowTooltip,
  weight,
  setWeight,
  setCommentList,
  voteValue,
  setVoteValue,
  accountData,
  setAccountData,
  setActiveTooltipPermlink
}) => {
  const { user, authenticated } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const tooltipRef = useRef(null);

  // Close tooltip on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        setShowTooltip(false);
        setActiveTooltipPermlink?.(null);
      }
    };

    if (showTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTooltip, setShowTooltip, setActiveTooltipPermlink]);

  // Fetch account data when tooltip opens
  useEffect(() => {
    if (!user || !showTooltip) return;

    const fetchAccountData = async () => {
      try {
        setIsCalculating(true);
        const result = await getVotePower(user);
        
        if (result && result.account) {
          setAccountData(result.account);
          // Calculate initial vote value with the fetched account data
          await calculateVoteValue(result.account, weight);
        } else {
          console.error('No account data returned');
          setVoteValue('0.000');
        }
      } catch (err) {
        console.error('Error fetching account:', err);
        setVoteValue('0.000');
      } finally {
        setIsCalculating(false);
      }
    };

    fetchAccountData();
  }, [user, showTooltip]);

  // Recalculate vote value when weight changes
  useEffect(() => {
    if (!accountData) return;
    
    const debounceTimer = setTimeout(() => {
      calculateVoteValue(accountData, weight);
    }, 100); // Small debounce to avoid too many calculations

    return () => clearTimeout(debounceTimer);
  }, [weight, accountData]);

  const calculateVoteValue = async (account, percent) => {
    try {
      setIsCalculating(true);
      const estimatedValue = await estimate(account, percent);
      setVoteValue(estimatedValue || '0.000');
    } catch (err) {
      console.error('Error calculating vote value:', err);
      setVoteValue('0.000');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleVote = async () => {
    if (!authenticated || !isLoggedIn()) {
      toast.error('Login to complete this operation');
      return;
    }

    setIsLoading(true);
    const voteWeight = Math.round(weight * 100); // Convert 1-100 to 100-10000

    try {
      const data = await getUersContent(author, permlink);

      if (!data) {
        toast.error('Could not fetch post data');
        setIsLoading(false);
        return;
      }

      const existingVote = data.active_votes?.find((vote) => vote.voter === user);

      if (existingVote && existingVote.percent === voteWeight) {
        toast.info('You already voted with this weight. Choose a different value.');
        setIsLoading(false);
        return;
      }

      // Use aioha for client-side voting
      await voteWithAioha(author, permlink, voteWeight);

      toast.success(`Vote successful! Value: $${voteValue}`);

      // Update comment list optimistically
      const isNewVote = !existingVote;
      setCommentList(prev => updateCommentsRecursively(prev, permlink, false, isNewVote));

      setShowTooltip(false);
      setActiveTooltipPermlink?.(null);
    } catch (err) {
      console.error('Vote failed:', err);
      toast.error('Vote failed: ' + (err.message || 'please try again'));
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to recursively update comments
  const updateCommentsRecursively = (comments, targetPermlink, isRollback = false, isNewVote = true) => {
    return comments.map(comment => {
      if (comment.permlink === targetPermlink) {
        return {
          ...comment,
          has_voted: !isRollback, // true for vote, false for rollback
          stats: {
            ...comment.stats,
            num_likes: isRollback 
              ? Math.max(0, (comment.stats.num_likes || 0) - 1)
              : isNewVote 
                ? (comment.stats.num_likes || 0) + 1
                : comment.stats.num_likes || 0, // Re-vote: don't increment
          },
        };
      }

      if (comment.children && comment.children.length > 0) {
        return {
          ...comment,
          children: updateCommentsRecursively(comment.children, targetPermlink, isRollback, isNewVote),
        };
      }

      return comment;
    });
  };

  return (
    <div 
      className="upvote-tooltip-wrap" 
      ref={tooltipRef} 
      onClick={(e) => e.preventDefault()}
    >
      {showTooltip && (
        <div className="tooltip-box comment">
          <p>Vote Weight: {weight}%</p>
          <div className="wrap">
            {isLoading ? (
              <div className='wrap-circle'>
                <TailChase 
                  className="loader-circle" 
                  size="15" 
                  speed="1.5" 
                  color="red" 
                />
              </div>
            ) : (
              <IoChevronUpCircleOutline 
                size={30} 
                onClick={handleVote}
                style={{ cursor: 'pointer' }}
              />
            )}
            <input
              type="range"
              min="1"
              max="100"
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              disabled={isLoading}
            />
            <p>
              {isCalculating ? (
                <Orbit size="30" speed="1.5" color="red" />
              ) : (
                `$${voteValue}`
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommentVoteTooltip;