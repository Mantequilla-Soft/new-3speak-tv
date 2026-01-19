import React, { useEffect, useState, useRef } from 'react';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { IoChevronUpCircleOutline } from 'react-icons/io5';
import { toast } from 'sonner';
import 'react-toastify/dist/ReactToastify.css';
import { estimate, getUersContent, getVotePower } from '../../utils/hiveUtils';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import axios from 'axios';
import { Orbit } from 'ldrs/react'
import 'ldrs/react/Orbit.css'

const UpvoteTooltip = ({ 
  author, 
  permlink, 
  showTooltip, 
  setShowTooltip, 
  voteValue, 
  setVoteValue, 
  setIsVoted, 
  weight, 
  setWeight, 
  accountData, 
  setAccountData, 
  setOptimisticVoteCount 
}) => {
  const { user, authenticated } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const tooltipRef = useRef(null);
  const accessToken = localStorage.getItem("access_token");

  // Handle click outside to close tooltip
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
    if (!authenticated) {
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

      if (existingVote) {
        if (existingVote.percent === voteWeight) {
          toast.info('You already voted with this weight. Choose a different value.');
          setIsLoading(false);
          return;
        }
      }

      const response = await axios.post(
        'https://studio.3speak.tv/mobile/vote',
        {
          author,
          permlink,
          weight: voteWeight
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          }
        }
      );

      console.log('Vote response:', response.data);

      if (response.data.success) {
        // If this is a new vote (not a re-vote), increment vote count
        if (!existingVote) {
          setOptimisticVoteCount((prevCount) => prevCount + 1);
        }

        toast.success(`Vote successful! Value: $${voteValue}`);
        setIsVoted(true);
        setShowTooltip(false);
      } else {
        toast.error('Vote failed, please try again');
      }
    } catch (err) {
      console.error('Vote failed:', err);
      
      if (err.response?.data?.message) {
        toast.error(`Vote failed: ${err.response.data.message}`);
      } else if (err.message === 'Network Error') {
        toast.error('Network error. Please check your connection.');
      } else {
        toast.error('Vote failed, please try again');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="upvote-tooltip-wrap" 
      ref={tooltipRef} 
      onClick={(e) => e.preventDefault()}
    >
      {showTooltip && (
        <div className="tooltip-box">
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
                className='circle-vote-btn'
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

export default UpvoteTooltip;