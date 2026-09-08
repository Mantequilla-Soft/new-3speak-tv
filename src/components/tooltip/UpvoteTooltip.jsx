import React, { useEffect, useState, useRef } from 'react';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { IoChevronUpCircleOutline } from 'react-icons/io5';
import { toastIn } from '../../utils/toast';
import { estimate, getUersContent, getVotePower } from '../../utils/hiveUtils';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { Orbit } from 'ldrs/react';
import 'ldrs/react/Orbit.css';
import { voteWithAioha, tagVideoWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { recordViewerTag, VIEWER_TAG_OPTIONS } from '../../utils/viewerTag';

// Every toast from this module is headed "Vote"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Vote');

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
  // Optional topic the viewer assigns to the video (interest taxonomy). Goes on
  // chain in the same tx as the vote + into the checker. '' = no tag.
  const [viewerTag, setViewerTag] = useState('');
  const tooltipRef = useRef(null);

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

      const tag = viewerTag || null;
      // active_votes is on-chain, so this finds the user's vote no matter which
      // frontend they cast it from.
      const existingVote = data.active_votes?.find((vote) => vote.voter === user);

      // Already voted at this exact weight → re-voting would be a no-op. But they
      // may just want to add a tag — and you can tag anything you've voted on, from
      // ANY frontend — so broadcast a TAG-ONLY op instead of blocking. With no tag
      // picked there's genuinely nothing to change.
      if (existingVote && existingVote.percent === voteWeight) {
        if (!tag) {
          toast.info('You already voted with this weight. Choose a different value.');
          setIsLoading(false);
          return;
        }
        await tagVideoWithAioha(author, permlink, tag, voteWeight);
        recordViewerTag(user, author, permlink, tag, voteWeight);
        toast.success(`Tagged “${tag}”.`);
        setIsVoted(true);
        setShowTooltip(false);
        return; // finally clears the loading state
      }

      // Vote + (optional) viewer-tag in ONE signed transaction.
      await voteWithAioha(author, permlink, voteWeight, tag);

      // Mirror the tag into the checker's queryable index (best-effort; the signed
      // on-chain custom_json is the source of truth).
      if (tag) recordViewerTag(user, author, permlink, tag, voteWeight);

      // Success case - If this is a new vote (not a re-vote), increment vote count
      if (!existingVote) {
        setOptimisticVoteCount((prevCount) => prevCount + 1);
      }

      toast.success(`Vote successful!${tag ? ` Tagged “${tag}”.` : ''} Value: $${voteValue}`);
      setIsVoted(true);
      setShowTooltip(false);
    } catch (err) {
      console.error('Vote failed:', err);
      toast.error('Vote failed: ' + (err.message || 'please try again'));
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

          {/* Optional: tag the video's topic. Highest combined vote weight wins. */}
          <label className="viewer-tag-select" onClick={(e) => e.stopPropagation()}>
            <span>Tag this video</span>
            <select
              value={viewerTag}
              onChange={(e) => setViewerTag(e.target.value)}
              disabled={isLoading}
            >
              <option value="">— optional —</option>
              {VIEWER_TAG_OPTIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.emoji ? `${t.emoji} ` : ''}{t.label}
                </option>
              ))}
            </select>
          </label>

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