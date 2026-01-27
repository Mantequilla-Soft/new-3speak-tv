import React, { useEffect, useState, useRef } from 'react';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { IoChevronUpCircleOutline } from 'react-icons/io5';
import {  toast } from 'sonner'
import { estimate, getUersContent, getVotePower } from '../../utils/hiveUtils';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { voteWithAioha, isLoggedIn } from '../../hive-api/aioha';




const UpvoteTooltip = ({ author, permlink, showTooltip, setShowTooltip,voteValue,setVoteValue, setIsVoted,weight, setWeight,accountData, setAccountData, setOptimisticVoteCount }) => {
  const { user, authenticated } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const tooltipRef = useRef(null);



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
  }, [showTooltip, setShowTooltip,]);

  // Fetch account & VP
  useEffect(() => {
    if (!user || !showTooltip) return;

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
  }, [user, showTooltip]);

  //Recalculate when weight changes
  useEffect(() => {
    if (!accountData ) return;
    calculateVoteValue(accountData, weight);
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

      if (existingVote) {
        if (existingVote.percent === voteWeight) {
          toast.info('Previous value is not acceptable. Vote with a different value.');
          setIsLoading(false);
          return;
        }
      }

      // Use aioha for client-side voting
      await voteWithAioha(author, permlink, voteWeight);

      // Success case
      if (!existingVote) {
        setOptimisticVoteCount((prevCount) => prevCount + 1);
      }

      toast.success('Vote successful');
      setIsVoted(true);
      setIsLoading(false);
      setShowTooltip(false);
    } catch (err) {
      console.error('Vote failed:', err);
      toast.error('Vote failed: ' + (err.message || 'please try again'));
      setIsLoading(false);
      setShowTooltip(false);
    }
  };

  return (
    <div className="upvote-tooltip-wrap" ref={tooltipRef} onClick={(e) => { e.preventDefault() }}>
      {showTooltip && (
        <div className="tooltip-box" >
          <p>Vote Weight: {weight}%</p>
          <div className="wrap">
            {isLoading ? (
              <div className='wrap-circle'><TailChase className="loader-circle" size="15" speed="1.5" color="red" /></div>
            ) : (
              <IoChevronUpCircleOutline size={30}   onClick={handleVote} className='circle-vote-btn' />
            )}

            {/* {isLoading ? (
              <TailChase className="loader-circle" size="15" speed="1.5" color="red" />
              // <TailChase className="loader-circle" size="15" speed="1.5" color="red" />
            ) : (
              // <IoChevronUpCircleOutline size={30} onClick={handleVote} />
              <TailChase className="loader-circle" size="15" speed="1.5" color="red" />
            )} */}
            
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

export default UpvoteTooltip;
