import React, { useEffect, useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import DialogShell from '../modal/DialogShell';
import VoteWeightPanel from './VoteWeightPanel';
import { estimate, getUersContent, getVotePower } from '../../utils/hiveUtils';
import { toastIn } from '../../utils/toast';
import { voteWithAioha, isLoggedIn } from '../../hive-api/aioha';

// Every toast from this module is headed "Vote"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Vote');

const isMobile = () => window.matchMedia('(max-width: 767px)').matches;


const CardVoteTooltip = ({
  author,
  permlink,
  showTooltip,
  setShowTooltip,
  voteValue,
  setVoteValue,
  setVoteStatus,
  tooltipVariant = "default"
}) => {
  const { t } = useTranslation();
  const { user, authenticated } = useAppStore();
  const [weight, setWeight] = useState(100);
  const [accountData, setAccountData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
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
    } catch (error) {
      console.error('Error calculating vote value:', error);
      setVoteValue('0.000');
    } finally {
      setIsCalculating(false);
    }
  };

  const handleVote = async () => {
    if (!authenticated || !isLoggedIn()) {
      toast.error(t('engagement.vote.loginRequired'));
      return;
    }

    setIsLoading(true);
    const voteWeight = Math.round(weight * 100); // Convert 1-100 to 100-10000

    try {
      const data = await getUersContent(author, permlink);
      
      if (!data) {
        toast.error(t('engagement.vote.fetchPostFailed'));
        setIsLoading(false);
        return;
      }

      const existingVote = data.active_votes?.find((vote) => vote.voter === user);

      if (existingVote) {
        if (existingVote.percent === voteWeight) {
          toast.info(t('engagement.vote.sameWeight'));
          setIsLoading(false);
          return;
        }
      }

      // Use aioha for client-side voting
      await voteWithAioha(author, permlink, voteWeight);

      toast.success(t('engagement.vote.success', { value: voteValue }));
      const postKey = `${author}/${permlink}`;
      // Optimistically mark as voted
      setVoteStatus((prev) => ({
        ...prev,
        [postKey]: true,
      }));

      setShowTooltip(false);
    } catch (err) {
      console.error('Vote failed:', err);
      toast.error(t('engagement.vote.failed', { message: err.message || t('engagement.vote.pleaseTryAgain') }));
    } finally {
      setIsLoading(false);
    }
  };

  const panel = (
    <VoteWeightPanel
      weight={weight}
      setWeight={setWeight}
      voteValue={voteValue}
      isCalculating={isCalculating}
      isLoading={isLoading}
      onVote={handleVote}
    />
  );

  // Mobile: the v2 bottom sheet (design 17b)
  if (showTooltip && isMobile()) {
    return (
      <DialogShell
        onClose={() => setShowTooltip(false)}
        busy={isLoading}
        title={t('engagement.vote.vote')}
        width={420}
        zIndex={1100}
        isolate
        overlayClassName="vote-popup-overlay"
        className="vote-popup"
      >
        {panel}
      </DialogShell>
    );
  }

  // Desktop: a floating v2 card over the vote button
  return (
    <div className="upvote-tooltip-wrap" ref={tooltipRef} onClick={(e) => e.preventDefault()}>
      {showTooltip && (
        <div className={`tooltip-box cap ${tooltipVariant}`} role="dialog" aria-label={t('engagement.vote.weight', { weight })}>
          {panel}
        </div>
      )}
    </div>
  );
};

export default CardVoteTooltip;
