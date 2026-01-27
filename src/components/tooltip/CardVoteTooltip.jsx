import React, { useEffect, useState, useRef } from 'react';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { IoChevronUpCircleOutline } from 'react-icons/io5';
import { estimate, getUersContent, getVotePower } from '../../utils/hiveUtils';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import {  toast } from 'sonner'
import { voteWithAioha, isLoggedIn } from '../../hive-api/aioha';





const CardVoteTooltip = ({ author, permlink, showTooltip, setShowTooltip, voteValue, setVoteValue, setVoteStatus, tooltipVariant = "default"}) => {
  const { user, authenticated} = useAppStore();
  const [weight, setWeight] = useState(100);
  const [accountData, setAccountData] = useState(null);
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
  }, [showTooltip, setShowTooltip]);

  useEffect(() => {
    if (!user || !showTooltip) return;

    const fetchAccountData = async () => {
      try {
        const result = await getVotePower(user);
        if (result) {
          const { account } = result;
          setAccountData(account);

          // Wait until state is set before using
          getVotingDefaultValue(account, weight); // use fresh data directly here
        }
      } catch (err) {
        console.error('Error fetching account:', err);
      }
    };


    fetchAccountData();
  }, [user, showTooltip]);

  useEffect(() => {
    if (!accountData) return;
    getVotingDefaultValue(accountData, weight);
  }, [weight]);



const getVotingDefaultValue = async (account, percent)=>{
  const data = await estimate(account, percent)
  setVoteValue(data)
 }
  

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

      toast.success('Vote successful');
      const postKey = `${author}/${permlink}`;
      // Optimistically mark as voted
      setVoteStatus((prev) => ({
        ...prev,
        [postKey]: true,
      }));

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
    <div className="upvote-tooltip-wrap" ref={tooltipRef} onClick={(e) => e.preventDefault()} >
      {showTooltip && (
        <div className={`tooltip-box cap ${tooltipVariant }`}>
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
              onChange={(e) => setWeight(Number(e.target.value))}
            />
            <p>${voteValue}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default CardVoteTooltip;
