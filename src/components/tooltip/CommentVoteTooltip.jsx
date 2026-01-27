import React, { useEffect, useState, useRef } from 'react';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { IoChevronUpCircleOutline } from 'react-icons/io5';
import {  toast } from 'sonner'
import { estimate, getUersContent, getVotePower } from '../../utils/hiveUtils';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { voteWithAioha, isLoggedIn } from '../../hive-api/aioha';

const CommentVoteTooltip = ({ author, permlink, showTooltip, setShowTooltip,weight,setWeight, setCommentList,voteValue,setVoteValue,accountData,setAccountData, setActiveTooltipPermlink }) => {
  const { user, authenticated } = useAppStore();
  const [votingPower, setVotingPower] = useState(100);
  const [isLoading, setIsLoading] = useState(false);
  const tooltipRef = useRef(null);

  // Close tooltip on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (tooltipRef.current && !tooltipRef.current.contains(e.target)) {
        setShowTooltip(false);
      }
    };

    if (showTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showTooltip, setShowTooltip,  ]);

  // Fetch account & VP
  useEffect(() => {
    if (!user || !showTooltip) return;

    const fetchAccountData = async () => {
      try {
        const result = await getVotePower(user);
        if (result) {
          const { vp, account } = result;
          setVotingPower((vp / 100).toFixed(2));
          setAccountData(account);
          calculateVoteValue(account, weight, vp);
        }
      } catch (err) {
        console.error('Error fetching account:', err);
      }
    };

    fetchAccountData();
  }, [user, showTooltip]);

  // Recalculate when weight changes
  useEffect(() => {
    if (!accountData || !votingPower) return;
    const vp = parseFloat(votingPower) * 100;
    calculateVoteValue(accountData, weight, vp);
  }, [weight]);

  const calculateVoteValue = async (account, percent) => {
      try{
        const data = await estimate(account, percent)
        setVoteValue(data)
      }catch(err){
        console.log(err)
  
      }
      
    };


const handleVote = async () => {
  if (!authenticated || !isLoggedIn()) {
    toast.error('Login to complete this operation');
    return;
  }

  setIsLoading(true);
  const voteWeight = Math.round(weight * 100);

  try {
    const data = await getUersContent(author, permlink);
    if (!data) {
      toast.error('Could not fetch post data');
      setIsLoading(false);
      return;
    }
    const existingVote = data.active_votes?.find((vote) => vote.voter === user);

    if (existingVote && existingVote.percent === voteWeight) {
      toast.info('Previous value is not acceptable. Vote with a different value.');
      setIsLoading(false);
      return;
    }

    // Use aioha for client-side voting
    await voteWithAioha(author, permlink, voteWeight);

    toast.success('Vote successful');
    setCommentList(prev => updateCommentsRecursively(prev, permlink));

    setIsLoading(false);
    setShowTooltip(false);
    setActiveTooltipPermlink(null);

  } catch (err) {
    console.error('Vote failed:', err);
    toast.error('Vote failed: ' + (err.message || 'please try again'));
    setIsLoading(false);
    setShowTooltip(false);
  }
};

// Helper function to recursively update comments
const updateCommentsRecursively = (comments, targetPermlink, isRollback = false) => {
  return comments.map(comment => {
    if (comment.permlink === targetPermlink) {
      return {
        ...comment,
        has_voted: !isRollback, // true for vote, false for rollback
        stats: {
          ...comment.stats,
          num_likes: isRollback 
            ? Math.max(0, (comment.stats.num_likes || 0) - 1)
            : (comment.stats.num_likes || 0) + 1,
        },
      };
    }

    if (comment.children && comment.children.length > 0) {
      return {
        ...comment,
        children: updateCommentsRecursively(comment.children, targetPermlink, isRollback),
      };
    }

    return comment;
  });
};


  return (
    <div className="upvote-tooltip-wrap" ref={tooltipRef} onClick={(e) =>{ e.preventDefault()}}>
      {showTooltip && (
        <div className="tooltip-box comment ">
          <p>Vote Weight: {weight}%</p>
          <div className="wrap">
            {isLoading ? (
<div className='wrap-circle'><TailChase className="loader-circle" size="15" speed="1.5" color="red" /></div>            ) : (
              <IoChevronUpCircleOutline size={30} onClick={handleVote} />
            )}
            <input
              type="range"
              min="1"
              max="100"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
            />
            <p>${voteValue}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CommentVoteTooltip;
