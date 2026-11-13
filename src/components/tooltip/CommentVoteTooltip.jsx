import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { usePortalDoc } from '../../utils/portalDocument';
import { useTranslation, Trans } from 'react-i18next';
import './CommentVoteTooltip.scss';
import { useAppStore } from '../../lib/store';
import { Icon } from '../v2/Icon';
import { cx } from '../v2/helpers';
import { toastIn } from '../../utils/toast';
import { getUersContent, getVotePower, getDynamicProps, votingPower, accountVestingShares, calculateVoteRshares } from '../../utils/hiveUtils';
import { voteWithAioha, tagVideoWithAioha, isLoggedIn } from '../../hive-api/aioha';
import { recordViewerTag, getViewerTags, getMyViewerTag } from '../../utils/viewerTag';
import { getVideoTagsV2, getCachedTagsV2, getTagLabel, getCategoryOf } from '../../utils/tagsV2';
import { getSavedVoteWeight, saveVoteWeight } from '../../utils/voteWeight';
import TagsV2Picker from './TagsV2Picker';
import ModalHeader from '../ModalHeader/ModalHeader';

// Every toast from this module is headed "Vote"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Vote');

// One-tap weights under the slider: 10 / 25 / 50 / 100 on a comment (28a),
// 25 / 50 / 75 / 100 on a video (17b).
const PRESETS = [10, 25, 50, 100];
const POST_PRESETS = [25, 50, 75, 100];

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
  // The video being voted on (17b): { title, thumbnail, payout, votes }. Shown
  // as a card on top; the dialog is then a side sheet with the voting power.
  post = null,
}) => {
  const { t } = useTranslation();
  const presets = post ? POST_PRESETS : PRESETS;
  const doc = usePortalDoc();
  const { user, authenticated } = useAppStore();
  const [isLoading, setIsLoading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  // "Don't vote — just tag": record the topic tag without casting a Hive vote,
  // even while the vote window is still open. Only offered when tagging is enabled.
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
      toast.error(t('engagement.vote.loginRequired'));
      return;
    }
    if (!viewerTag) {
      toast.error(t('engagement.vote.pickTopicFirst'));
      return;
    }
    setIsLoading(true);
    try {
      await tagVideoWithAioha(author, permlink, viewerTag, 10000);
      // Await the mirror so the consensus refresh below reflects this tag.
      await recordViewerTag(user, author, permlink, viewerTag, 10000);
      toast.success(t('engagement.vote.taggedNoDot', { tag: getTagLabel(viewerTag) }));
      // Refresh the watch-page topics row (isNewVote=false → no vote-count change).
      onVoteSuccess?.(author, permlink, false, 10000);
      setShowTooltip(false);
      setActiveTooltipPermlink?.(null);
    } catch (err) {
      console.error('Tag failed:', err);
      toast.error(t('engagement.vote.tagFailed', { message: err.message || t('engagement.vote.pleaseTryAgain') }));
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
  const presetsRef = useRef(null);

  // Current weight lives in a ref — no React state during drag
  const weightRef = useRef(parentWeight);

  // Cached data for local estimation (fetched once on open)
  const cachedAccountRef = useRef(null);
  const cachedDynamicPropsRef = useRef(null);

  // Update all DOM elements for a given weight (no React re-render)
  // "Vote 75%" on the video vote's button (17b), kept in step with the slider.
  const submitWeightRef = useRef(null);
  const updateSliderDOM = useCallback((w) => {
    weightRef.current = w;
    if (labelRef.current) labelRef.current.textContent = `${w}%`;
    if (submitWeightRef.current) submitWeightRef.current.textContent = `${w}%`;
    if (fillRef.current) fillRef.current.style.width = `${w}%`;
    if (thumbRef.current) {
      thumbRef.current.style.left = `${w}%`;
      thumbRef.current.setAttribute('aria-valuenow', String(w));
    }
    presetsRef.current?.querySelectorAll('[data-weight]').forEach((b) => {
      const on = Number(b.dataset.weight) === w;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (valueRef.current && cachedAccountRef.current && cachedDynamicPropsRef.current) {
      valueRef.current.textContent = t('engagement.vote.addsAbout', { value: `$${estimateLocal(cachedAccountRef.current, cachedDynamicPropsRef.current, w)}` });
    }
  }, [t]);

  // Build the custom div-based slider when popup opens
  useEffect(() => {
    if (!showTooltip) return;
    const container = sliderContainerRef.current;
    if (!container) return;

    // Open on the weight this user last voted with for THIS kind (posts and
    // comments remember separate values), not a hardcoded 100%.
    const startWeight = getSavedVoteWeight(voteKind);
    weightRef.current = startWeight;
    if (labelRef.current) labelRef.current.textContent = `${startWeight}%`;
    if (submitWeightRef.current) submitWeightRef.current.textContent = `${startWeight}%`;
    // Keep the parent's state in step so the rendered label and the estimate
    // agree with the slider we just built.
    if (startWeight !== parentWeight) setParentWeight(startWeight);

    // Build track → fill + thumb
    const track = doc.createElement('div');
    track.className = 'cvt-track';

    const fill = doc.createElement('div');
    fill.className = 'cvt-fill';
    fill.style.width = `${startWeight}%`;

    // The thumb is the keyboard handle: arrows step 1, PageUp/Down 10,
    // Home/End jump to the ends (a drawn slider still has to be operable).
    const thumb = doc.createElement('div');
    thumb.className = 'cvt-thumb';
    thumb.style.left = `${startWeight}%`;
    thumb.tabIndex = 0;
    thumb.setAttribute('role', 'slider');
    thumb.setAttribute('aria-valuemin', '1');
    thumb.setAttribute('aria-valuemax', '100');
    thumb.setAttribute('aria-valuenow', String(startWeight));
    thumb.setAttribute('aria-label', t('engagement.vote.weight', { weight: '' }).replace(/[:\s%]+$/, ''));

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

    const onKeyDown = (e) => {
      if (isLoadingRef.current) return;
      const steps = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
      let next = null;
      if (e.key in steps) next = weightRef.current + steps[e.key];
      else if (e.key === 'Home') next = 1;
      else if (e.key === 'End') next = 100;
      if (next == null) return;
      e.preventDefault();
      updateSliderDOM(Math.max(1, Math.min(100, next)));
    };
    thumb.addEventListener('keydown', onKeyDown);

    track.addEventListener('mousedown', onMouseDown);
    doc.addEventListener('mousemove', onMouseMove);
    doc.addEventListener('mouseup', onMouseUp);

    track.addEventListener('touchstart', onTouchStart, { passive: true });
    doc.addEventListener('touchmove', onTouchMove, { passive: false });
    doc.addEventListener('touchend', onTouchEnd);

    container.appendChild(track);

    return () => {
      track.removeEventListener('mousedown', onMouseDown);
      doc.removeEventListener('mousemove', onMouseMove);
      doc.removeEventListener('mouseup', onMouseUp);
      track.removeEventListener('touchstart', onTouchStart);
      doc.removeEventListener('touchmove', onTouchMove);
      doc.removeEventListener('touchend', onTouchEnd);
      thumb.removeEventListener('keydown', onKeyDown);
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
    doc.addEventListener('keydown', handleKey);
    return () => doc.removeEventListener('keydown', handleKey);
  }, [showTooltip, setShowTooltip, setActiveTooltipPermlink]);

  // The value line is rendered from the parent's voteValue once loading ends,
  // which would put the stale (often $0) value back over what updateSliderDOM
  // wrote. Hand the estimate for the opening weight to the parent as well.
  const showEstimate = () => {
    if (!cachedAccountRef.current || !cachedDynamicPropsRef.current) return;
    setParentVoteValue?.(estimateLocal(cachedAccountRef.current, cachedDynamicPropsRef.current, weightRef.current));
  };

  // Use pre-cached data if available, otherwise fetch on open
  useEffect(() => {
    if (!user || !showTooltip) return;

    // If parent already pre-fetched account + dynamic props, use them instantly
    if (accountData && cachedDynamicProps) {
      cachedAccountRef.current = accountData;
      cachedDynamicPropsRef.current = cachedDynamicProps;
      updateSliderDOM(weightRef.current);
      showEstimate();
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
          showEstimate();
        }
      } catch (err) {
        console.error('Error fetching vote data:', err);
        if (!cancelled && valueRef.current) valueRef.current.textContent = t('engagement.vote.addsAbout', { value: '$0.000' });
      } finally {
        if (!cancelled) setInitializing(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [user, showTooltip]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVote = async () => {
    if (!authenticated || !isLoggedIn()) {
      toast.error(t('engagement.vote.loginRequired'));
      return;
    }

    setIsLoading(true);
    const currentWeight = weightRef.current;
    const voteWeight = Math.round(currentWeight * 100);

    try {
      const data = await getUersContent(author, permlink);

      if (!data) {
        toast.error(t('engagement.vote.fetchPostFailed'));
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
          toast.success(t('engagement.vote.taggedAlreadyVoted', { tag: getTagLabel(tag), weight: currentWeight }));
          onVoteSuccess?.(author, permlink, false, voteWeight);
          setShowTooltip(false);
          setActiveTooltipPermlink?.(null);
          setIsLoading(false);
          return;
        }
        toast.info(t('engagement.vote.sameWeight'));
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

      toast.success(tag ? t('engagement.vote.successTagged', { tag: getTagLabel(tag), value: finalValue }) : t('engagement.vote.success', { value: finalValue }));

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
      toast.error(t('engagement.vote.failed', { message: err.message || t('engagement.vote.pleaseTryAgain') }));
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

  const spinner = <Icon name="progress_activity" size={24} className="v2-spin cvt-spinner" />;
  const close = () => {
    setShowTooltip(false);
    setActiveTooltipPermlink?.(null);
  };

  return (
    <>
      {showTooltip && createPortal(
        <div className="cvt-overlay" onMouseDown={() => {
          if (!isLoadingRef.current) close();
        }}>
          <div
            className={cx('cvt-dialog', compact && 'is-compact', post && 'is-post')}
            ref={tooltipRef}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <ModalHeader closeOnEscape={false}
              className="cvt-header"
              tone="accent"
              title={tagOnlyMode
                ? t('engagement.vote.votingClosed')
                : t('engagement.vote.vote')}
              onClose={isLoading ? undefined : close}
            />

            {/* No card of the video here any more (owner 2026-11-12): it pushed the
                Vote button below the fold of a phone's sheet, so voting took a scroll. */}

            {tagOnlyMode ? (
              // ── Payout window closed: no voting, tag-only (one-shot) ──
              <>
                {myExistingTag === undefined ? (
                  <div className="cvt-loading">{spinner}</div>
                ) : myExistingTag ? (
                  <p className="cvt-note">
                    <Trans i18nKey="engagement.vote.youTagged" values={{ tag: getTagLabel(myExistingTag) }} components={{ b: <b /> }} />
                  </p>
                ) : (
                  <>
                    <div className="cvt-tag" onClick={(e) => e.stopPropagation()}>
                      <span className="cvt-tag__sub">{t('engagement.vote.pickTopic')}</span>
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
                      type="button"
                      className="v2-btn v2-btn--primary h48 is-block is-next cvt-submit"
                      onClick={handleTagOnly}
                      disabled={isLoading || !viewerTag}
                      aria-busy={isLoading || undefined}
                    >
                      {isLoading
                        ? <Icon name="progress_activity" size={20} className="v2-spin" />
                        : <><span className="v2-btn__label">{t('engagement.vote.submitTag')}</span><Icon name="sell" size={20} /></>}
                    </button>
                  </>
                )}
              </>
            ) : (
              // ── Normal vote (optionally with a tag), or tag-only via the checkbox ──
              <>
                {/* Vote-weight UI: kept mounted (so the slider effect stays intact)
                    but hidden when "just tag" is on, since there's no vote then. */}
                <div className="cvt-weight">
                  <div className="cvt-big">
                    <b className="cvt-pct" ref={labelRef}>{parentWeight}%</b>
                    <span className="cvt-value" ref={valueRef}>
                      {initializing ? '' : t('engagement.vote.addsAbout', { value: `$${parentVoteValue}` })}
                    </span>
                    {initializing && spinner}
                  </div>

                  {/* Container for custom div-based slider: no <input> at all */}
                  <div ref={sliderContainerRef} className="cvt-slider" />

                  <div className="cvt-presets" ref={presetsRef}>
                    {presets.map((p) => (
                      <button
                        key={p}
                        type="button"
                        data-weight={p}
                        className={cx('cvt-preset', p === parentWeight && 'is-on')}
                        aria-pressed={p === parentWeight}
                        disabled={isLoading}
                        onClick={() => updateSliderDOM(p)}
                      >{p}%</button>
                    ))}
                  </div>
                </div>

                {enableViewerTag && (
                  <>
                    {/* Vote with a topic (40a): "Tag this video", what a topic
                        counts as, the chips, then Just tag / Vote and tag. */}
                    <div className="cvt-tag" onClick={(e) => e.stopPropagation()}>
                      <b className="cvt-tag__title">{t('engagement.vote.tagThisVideo')}</b>
                      <span className="cvt-tag__sub">{t('engagement.vote.pickTopic')}</span>
                      <TagsV2Picker
                        value={viewerTag}
                        onChange={setViewerTag}
                        tagPct={tagPct}
                        disabled={isLoading}
                        suggested={autoTagsV2 || []}
                        searchable
                      />
                    </div>

                  </>
                )}

                {post && accountData && (() => {
                  const vp = (() => { try { return votingPower(accountData); } catch { return null; } })();
                  return vp != null && Number.isFinite(vp) ? (
                    <div className="cvt-vp">
                      <Icon name="battery_horiz_075" size={20} />
                      <span>{t('nav.profile.votingPower')}</span>
                      <b className="num">{Math.round(vp)}%</b>
                    </div>
                  ) : null;
                })()}

                {/* With a topic picked (40a): "Just tag" (no vote) beside "Vote and tag". */}
                <div className={cx('cvt-actions', enableViewerTag && viewerTag && 'is-split')}>
                  {enableViewerTag && viewerTag && (
                    <button
                      type="button"
                      className="v2-btn v2-btn--secondary h48 cvt-just-tag"
                      onClick={handleTagOnly}
                      disabled={isLoading}
                      title={t('engagement.vote.justTag')}
                    >
                      <span className="v2-btn__label">{t('engagement.vote.justTagShort')}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="v2-btn v2-btn--primary h48 is-block is-next cvt-submit"
                    onClick={handleVote}
                    disabled={isLoading || initializing}
                    aria-busy={isLoading || undefined}
                  >
                    {isLoading ? (
                      <Icon name="progress_activity" size={20} className="v2-spin" />
                    ) : enableViewerTag && viewerTag ? (
                      <><span className="v2-btn__label">{t('engagement.vote.voteAndTag')}</span><Icon name="arrow_upward" size={20} /></>
                    ) : (
                      <><span className="v2-btn__label">{t('engagement.vote.vote')}{post && <> <span className="num" ref={submitWeightRef}>{parentWeight}%</span></>}</span><Icon name="arrow_upward" size={20} /></>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        doc.body
      )}
    </>
  );
};

export default CommentVoteTooltip;
