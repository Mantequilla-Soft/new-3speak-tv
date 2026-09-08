import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import './UpvoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { X, ChevronUp } from 'lucide-react';
import { toastIn } from '../../utils/toast';
import { getUersContent, getVotePower, getDynamicProps, votingPower, accountVestingShares, calculateVoteRshares } from '../../utils/hiveUtils';
import { TailChase } from 'ldrs/react';
import 'ldrs/react/TailChase.css';
import { Orbit } from 'ldrs/react';
import 'ldrs/react/Orbit.css';
import { voteWithAioha, tagVideoWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { recordViewerTag, getViewerTags, getMyViewerTag } from '../../utils/viewerTag';
import { getVideoTagsV2, getCachedTagsV2, getTagLabel, getCategoryOf } from '../../utils/tagsV2';
import { getSavedVoteWeight, saveVoteWeight } from '../../utils/voteWeight';
import TagsV2Picker from './TagsV2Picker';

// Every toast from this module is headed "Vote"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Vote');

// Hive posts pay out (and voting stops mattering) 7 days after creation.
const PAYOUT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Pure-math vote estimation — no API calls
function estimateLocal(account, dynamicProps, percent) {
  if (!account || !dynamicProps) return '0.000';
  const { fundRecentClaims, fundRewardBalance, base, quote } = dynamicProps;
  if (!fundRecentClaims || !fundRewardBalance || !base || !quote) return '0.000';

  const sign = percent < 0 ? -1 : 1;
  const userEffectiveVests = accountVestingShares(account);
  const userVotingPower = votingPower(account) * 100;
  const voteWeight = Math.abs(percent) * 100;
  const voteEffectiveShares = calculateVoteRshares(userEffectiveVests, userVotingPower * (voteWeight / 10000));
  const voteValue = (voteEffectiveShares / fundRecentClaims) * fundRewardBalance * (base / quote);
  return (Math.max(voteValue, 0) * sign).toFixed(3);
}

const CommentVoteTooltip = ({
  author,
  permlink,
  showTooltip,
  setShowTooltip,
  weight: parentWeight,
  setWeight: setParentWeight,
  setCommentList,
  voteValue: parentVoteValue,
  setVoteValue: setParentVoteValue,
  accountData,
  setAccountData,
  setActiveTooltipPermlink,
  onVoteSuccess,
  compact,
  cachedDynamicProps,
  onVoteDataRefresh,
  // Only the VIDEO vote (watch page + shorts) enables the topic dropdown; comment
  // votes pass this false/undefined so comments never get a tag selector.
  enableViewerTag = false,
  // The post's creation date — after the 7-day payout window, voting is hidden and
  // only tagging remains (interpreted as a 100% vote).
  postCreatedAt = null,
  // Which remembered vote weight this dialog uses. Posts and comments keep
  // separate values (see utils/voteWeight.js).
  voteKind = 'post',
}) => {
  const { user, authenticated } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  // "Don't vote — just tag": record the topic tag without casting a Hive vote,
  // even while the vote window is still open. Only offered when tagging is enabled.
  const [justTag, setJustTag] = useState(false);
  // Optional topic the viewer assigns to the video (interest taxonomy). '' = none.
  const [viewerTag, setViewerTag] = useState('');
  // Current crowd consensus (tag -> pct), so the dropdown can show each tag's share.
  const [tagPct, setTagPct] = useState({});
  // For the closed-voting tag-only path: the tag this user already gave (if any).
  const [myExistingTag, setMyExistingTag] = useState(undefined); // undefined=unknown
  // The v2 tags the background tagger assigned to this video. Non-empty = this
  // video is on the new taxonomy, so we show the v2 (category → topic) picker
  // instead of the v1 interest tiles. Empty = untagged/not processed → v1 picker.
  // `null` = we don't know YET — render neither picker rather than flashing the
  // wrong one. Seeded from the cache so a prefetched video knows immediately.
  const [autoTagsV2, setAutoTagsV2] = useState(() => getCachedTagsV2(author, permlink)?.tags ?? []);

  // After the payout window there's nothing to vote on — switch to tag-only.
  const votingClosed = !!postCreatedAt
    && (Date.now() - new Date(postCreatedAt).getTime()) > PAYOUT_WINDOW_MS;
  const tagOnlyMode = enableViewerTag && votingClosed;

  // Fetch the consensus when the video vote popup opens (not for comment votes).
  useEffect(() => {
    if (!enableViewerTag || !showTooltip || !author || !permlink) return;
    let alive = true;
    getViewerTags(author, permlink).then((data) => {
      if (!alive || !data?.counts) return;
      const map = {};
      for (const c of data.counts) map[c.tag] = c.pct;
      setTagPct(map);
    });
    return () => { alive = false; };
  }, [enableViewerTag, showTooltip, author, permlink]);

  // Does this video carry v2 tags? Decides which picker we show. A cache hit
  // (normally warmed by the page's prefetch) resolves synchronously — no flash.
  // Otherwise we go back to "unknown" so neither picker renders until we know.
  useEffect(() => {
    if (!enableViewerTag || !showTooltip || !author || !permlink) return;

    // Preselect the auto-tag's CATEGORY. When the tagger picked a topic (the
    // 2nd level), its parent category is the far more reliable signal — so we
    // default to the parent and let the viewer refine to a topic if they want.
    // A category auto-tag resolves to itself. Never clobbers an existing pick.
    const apply = (tags) => {
      setAutoTagsV2(tags);
      const parent = tags.length ? getCategoryOf(tags[0]) : null;
      if (parent) setViewerTag((cur) => cur || parent);
    };

    const cached = getCachedTagsV2(author, permlink);
    if (cached) { apply(cached.tags); return; }
    let alive = true;
    getVideoTagsV2(author, permlink).then(({ tags }) => {
      if (alive) apply(tags);
    });
    return () => { alive = false; };
  }, [enableViewerTag, showTooltip, author, permlink]);

  // Tag-only mode is ONE-SHOT — check whether this user already tagged the video.
  useEffect(() => {
    if (!tagOnlyMode || !showTooltip || !author || !permlink || !user) return;
    let alive = true;
    setMyExistingTag(undefined);
    getMyViewerTag(user, author, permlink).then((r) => {
      if (alive) setMyExistingTag(r?.tag || null);
    });
    return () => { alive = false; };
  }, [tagOnlyMode, showTooltip, author, permlink, user]);

  // Tag-only submit: broadcast just the custom_json (weight = 100% vote) + mirror.
  const handleTagOnly = async () => {
    if (!authenticated || !isLoggedIn()) {
      toast.error('Login to complete this operation');
      return;
    }
    if (!viewerTag) {
      toast.error('Pick a topic first');
      return;
    }
    setIsLoading(true);
    try {
      await tagVideoWithAioha(author, permlink, viewerTag, 10000);
      // Await the mirror so the consensus refresh below reflects this tag.
      await recordViewerTag(user, author, permlink, viewerTag, 10000);
      toast.success(`Tagged “${getTagLabel(viewerTag)}”`);
      // Refresh the watch-page topics row (isNewVote=false → no vote-count change).
      onVoteSuccess?.(author, permlink, false, 10000);
      setShowTooltip(false);
      setActiveTooltipPermlink?.(null);
    } catch (err) {
      console.error('Tag failed:', err);
      toast.error('Tag failed: ' + (err.message || 'please try again'));
    } finally {
      setIsLoading(false);
    }
  };
  const isLoadingRef = useRef(false);
  const tooltipRef = useRef(null);

  // DOM refs for custom slider
  const sliderContainerRef = useRef(null);
  const fillRef = useRef(null);
  const thumbRef = useRef(null);
  const labelRef = useRef(null);
  const valueRef = useRef(null);

  // Current weight lives in a ref — no React state during drag
  const weightRef = useRef(parentWeight);

  // Cached data for local estimation (fetched once on open)
  const cachedAccountRef = useRef(null);
  const cachedDynamicPropsRef = useRef(null);

  // Update all DOM elements for a given weight (no React re-render)
  const updateSliderDOM = useCallback((w) => {
    weightRef.current = w;
    if (labelRef.current) labelRef.current.textContent = `Vote Weight: ${w}%`;
    if (fillRef.current) fillRef.current.style.width = `${w}%`;
    if (thumbRef.current) thumbRef.current.style.left = `${w}%`;
    if (valueRef.current && cachedAccountRef.current && cachedDynamicPropsRef.current) {
      valueRef.current.textContent = `$${estimateLocal(cachedAccountRef.current, cachedDynamicPropsRef.current, w)}`;
    }
  }, []);

  // Build the custom div-based slider when popup opens
  useEffect(() => {
    if (!showTooltip) return;
    const container = sliderContainerRef.current;
    if (!container) return;

    // Open on the weight this user last voted with for THIS kind (posts and
    // comments remember separate values), not a hardcoded 100%.
    const startWeight = getSavedVoteWeight(voteKind);
    weightRef.current = startWeight;
    if (labelRef.current) labelRef.current.textContent = `Vote Weight: ${startWeight}%`;
    // Keep the parent's state in step so the rendered label and the estimate
    // agree with the slider we just built.
    if (startWeight !== parentWeight) setParentWeight(startWeight);

    // Build track → fill + thumb
    const track = document.createElement('div');
    track.className = 'vote-slider-track';

    const fill = document.createElement('div');
    fill.className = 'vote-slider-fill';
    fill.style.width = `${startWeight}%`;

    const thumb = document.createElement('div');
    thumb.className = 'vote-slider-thumb';
    thumb.style.left = `${startWeight}%`;

    track.appendChild(fill);
    track.appendChild(thumb);

    fillRef.current = fill;
    thumbRef.current = thumb;

    // Convert mouse/touch clientX → 1–100 percent
    const getPct = (clientX) => {
      const rect = track.getBoundingClientRect();
      const raw = ((clientX - rect.left) / rect.width) * 100;
      return Math.round(Math.max(1, Math.min(100, raw)));
    };

    let dragging = false;

    const onPointerDown = (clientX) => {
      if (isLoadingRef.current) return;
      dragging = true;
      const pct = getPct(clientX);
      updateSliderDOM(pct);
    };

    const onPointerMove = (clientX) => {
      if (!dragging) return;
      const pct = getPct(clientX);
      updateSliderDOM(pct);
    };

    const onPointerUp = () => { dragging = false; };

    // Mouse events
    const onMouseDown = (e) => { e.preventDefault(); onPointerDown(e.clientX); };
    const onMouseMove = (e) => { onPointerMove(e.clientX); };
    const onMouseUp = () => { onPointerUp(); };

    // Touch events
    const onTouchStart = (e) => { onPointerDown(e.touches[0].clientX); };
    const onTouchMove = (e) => { if (dragging) { e.preventDefault(); onPointerMove(e.touches[0].clientX); } };
    const onTouchEnd = () => { onPointerUp(); };

    track.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    track.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd);

    container.appendChild(track);

    return () => {
      track.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      track.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      if (container.contains(track)) container.removeChild(track);
      fillRef.current = null;
      thumbRef.current = null;
    };
  }, [showTooltip]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  // Close on Escape key
  useEffect(() => {
    if (!showTooltip) return;
    const handleKey = (e) => {
      if (e.key === 'Escape' && !isLoadingRef.current) {
        setShowTooltip(false);
        setActiveTooltipPermlink?.(null);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [showTooltip, setShowTooltip, setActiveTooltipPermlink]);

  // Use pre-cached data if available, otherwise fetch on open
  useEffect(() => {
    if (!user || !showTooltip) return;

    // If parent already pre-fetched account + dynamic props, use them instantly
    if (accountData && cachedDynamicProps) {
      cachedAccountRef.current = accountData;
      cachedDynamicPropsRef.current = cachedDynamicProps;
      updateSliderDOM(weightRef.current);
      setInitializing(false);
      return;
    }

    // Fallback: fetch if not pre-cached (e.g. used outside Shorts)
    let cancelled = false;
    const init = async () => {
      setInitializing(true);
      try {
        const [acctResult, dynProps] = await Promise.all([
          getVotePower(user),
          getDynamicProps(),
        ]);

        if (cancelled) return;

        const acct = acctResult?.account;
        if (acct) {
          setAccountData(acct);
          cachedAccountRef.current = acct;
        }
        if (dynProps) {
          cachedDynamicPropsRef.current = dynProps;
        }

        if (acct && dynProps) {
          updateSliderDOM(weightRef.current);
        }
      } catch (err) {
        console.error('Error fetching vote data:', err);
        if (!cancelled && valueRef.current) valueRef.current.textContent = '$0.000';
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [user, showTooltip]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVote = async () => {
    if (!authenticated || !isLoggedIn()) {
      toast.error('Login to complete this operation');
      return;
    }

    setIsLoading(true);
    const currentWeight = weightRef.current;
    const voteWeight = Math.round(currentWeight * 100);

    try {
      const data = await getUersContent(author, permlink);

      if (!data) {
        toast.error('Could not fetch post data');
        setIsLoading(false);
        return;
      }

      const existingVote = data.active_votes?.find((vote) => vote.voter === user);

      // Video vote → vote + viewer-tag custom_json in ONE signed transaction.
      const tag = enableViewerTag ? (viewerTag || null) : null;

      if (existingVote && existingVote.percent === voteWeight) {
        // Re-voting the same weight is a no-op on chain. If they ALSO picked a
        // tag, submit that on its own rather than dropping it — otherwise the
        // tag is silently lost, which is easy to hit now that the slider
        // reopens on the weight you last voted with.
        if (tag) {
          await tagVideoWithAioha(author, permlink, tag, voteWeight);
          await recordViewerTag(user, author, permlink, tag, voteWeight);
          saveVoteWeight(voteKind, currentWeight);
          toast.success(`Tagged “${getTagLabel(tag)}” — your ${currentWeight}% vote was already cast.`);
          onVoteSuccess?.(author, permlink, false, voteWeight);
          setShowTooltip(false);
          setActiveTooltipPermlink?.(null);
          setIsLoading(false);
          return;
        }
        toast.info('You already voted with this weight. Choose a different value.');
        setIsLoading(false);
        return;
      }

      await voteWithAioha(author, permlink, voteWeight, tag);

      // Mirror the tag into the checker's queryable index (best-effort; the signed
      // on-chain custom_json is the source of truth). AWAIT it so the consensus
      // refresh in onVoteSuccess reads the just-written vote, not a stale tally.
      if (tag) await recordViewerTag(user, author, permlink, tag, voteWeight);

      const finalValue = cachedAccountRef.current && cachedDynamicPropsRef.current
        ? estimateLocal(cachedAccountRef.current, cachedDynamicPropsRef.current, currentWeight)
        : '0.000';

      toast.success(`Vote successful!${tag ? ` Tagged “${getTagLabel(tag)}”.` : ''} Value: $${finalValue}`);

      // Sync back to parent + remember this weight for the next vote of this kind.
      setParentWeight(currentWeight);
      saveVoteWeight(voteKind, currentWeight);
      setParentVoteValue(finalValue);

      const isNewVote = !existingVote;
      if (setCommentList) {
        setCommentList(prev => updateCommentsRecursively(prev, permlink, false, isNewVote));
      }

      if (onVoteSuccess) {
        onVoteSuccess(author, permlink, isNewVote, voteWeight);
      }

      // Refresh cached vote data for next vote (account VP changed)
      if (onVoteDataRefresh) onVoteDataRefresh();

      setShowTooltip(false);
      setActiveTooltipPermlink?.(null);
    } catch (err) {
      console.error('Vote failed:', err);
      toast.error('Vote failed: ' + (err.message || 'please try again'));
    } finally {
      setIsLoading(false);
    }
  };

  const updateCommentsRecursively = (comments, targetPermlink, isRollback = false, isNewVote = true) => {
    return comments.map(comment => {
      if (comment.permlink === targetPermlink) {
        return {
          ...comment,
          has_voted: !isRollback,
          stats: {
            ...comment.stats,
            num_likes: isRollback
              ? Math.max(0, (comment.stats.num_likes || 0) - 1)
              : isNewVote
                ? (comment.stats.num_likes || 0) + 1
                : comment.stats.num_likes || 0,
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
    <>
      {showTooltip && createPortal(
        <div className="vote-popup-overlay" onMouseDown={(e) => {
          if (!isLoadingRef.current) {
            setShowTooltip(false);
            setActiveTooltipPermlink?.(null);
          }
        }}>
          <div
            className={`vote-popup${compact ? ' vote-popup--compact' : ''}`}
            ref={tooltipRef}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="vote-popup-close"
              onClick={() => {
                if (!isLoading) {
                  setShowTooltip(false);
                  setActiveTooltipPermlink?.(null);
                }
              }}
              disabled={isLoading}
            >
              <X size={18} />
            </button>

            {tagOnlyMode ? (
              // ── Payout window closed: no voting, tag-only (one-shot) ──
              <>
                <p className="vote-popup-label">Voting closed — tag this video</p>
                {myExistingTag === undefined ? (
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <Orbit size="24" speed="1.5" color="red" />
                  </div>
                ) : myExistingTag ? (
                  <p className="vote-popup-note">
                    You tagged this as <b>{getTagLabel(myExistingTag)}</b>.
                  </p>
                ) : (
                  <>
                    <div className="viewer-tag-select" onClick={(e) => e.stopPropagation()}>
                      <span>Pick a topic (counts as a 100% vote)</span>
                      <TagsV2Picker
                        value={viewerTag}
                        onChange={setViewerTag}
                        tagPct={tagPct}
                        disabled={isLoading}
                        suggested={autoTagsV2 || []}
                        searchable
                      />
                    </div>
                    <button
                      className="vote-popup-submit"
                      onClick={handleTagOnly}
                      disabled={isLoading || !viewerTag}
                    >
                      {isLoading ? <TailChase size="18" speed="1.5" color="white" /> : 'Submit tag'}
                    </button>
                  </>
                )}
              </>
            ) : (
              // ── Normal vote (optionally with a tag), or tag-only via the checkbox ──
              <>
                {/* Vote-weight UI — kept mounted (so the slider effect stays intact)
                    but hidden when "just tag" is on, since there's no vote then. */}
                <div style={justTag ? { display: 'none' } : undefined}>
                  <p className="vote-popup-label" ref={labelRef}>
                    Vote Weight: {parentWeight}%
                  </p>

                  {/* Container for custom div-based slider — no <input> at all */}
                  <div ref={sliderContainerRef} />

                  <p className="vote-popup-value" ref={valueRef}>
                    {initializing ? '' : `$${parentVoteValue}`}
                  </p>
                  {initializing && (
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Orbit size="24" speed="1.5" color="red" />
                    </div>
                  )}
                </div>

                {enableViewerTag && (
                  <>
                    <div className="viewer-tag-select" onClick={(e) => e.stopPropagation()}>
                      <span>Tag this video{justTag ? ' (counts as a 100% vote)' : ''}</span>
                      <TagsV2Picker
                        value={viewerTag}
                        onChange={setViewerTag}
                        tagPct={tagPct}
                        disabled={isLoading}
                        suggested={autoTagsV2 || []}
                        searchable
                      />
                    </div>

                    <label className="vote-just-tag" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={justTag}
                        onChange={(e) => setJustTag(e.target.checked)}
                        disabled={isLoading}
                      />
                      <span>Don&rsquo;t vote &mdash; just tag</span>
                    </label>
                  </>
                )}

                <button
                  className="vote-popup-submit"
                  onClick={justTag ? handleTagOnly : handleVote}
                  disabled={isLoading || (justTag ? !viewerTag : initializing)}
                >
                  {isLoading ? (
                    <TailChase size="18" speed="1.5" color="white" />
                  ) : justTag ? (
                    'Submit tag'
                  ) : (
                    <>
                      <ChevronUp size={20} /> Vote
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default CommentVoteTooltip;
