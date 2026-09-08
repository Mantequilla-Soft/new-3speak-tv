import React, { useEffect, useRef, useState } from 'react'
import { toastIn } from '../../utils/toast';
import { StepProgress } from '../legacy-studio/StepProgress';
import { IoIosArrowDropdownCircle } from 'react-icons/io';
import { MdPeopleAlt } from 'react-icons/md';
import CommunityModal from "../modal/Community_modal";
import Beneficiary_modal from '../modal/Beneficiary_modal';
import { Navigate } from 'react-router-dom';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import MarkdownComposer from '../studio/MarkdownComposer';
import { getMinMaxDates } from '../../utils/schedulingHelpers';
import EmbedUploadProgressBar from './EmbedUploadProgressBar';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { isTestUser } from '../../utils/config';
import { getHiveClient } from '../../utils/hiveNode';
// This route renders on its own, so it imports the studio stylesheet rather
// than relying on EmbedStudioPage having mounted first and pulled it in.
// ScheduledPostEditor already does the same for the same reason; Vite dedupes.
import '../legacy-studio/StudioPage.scss';
import SettingInfo, { SettingSheet } from './SettingInfo';
import './EmbedDetails.scss';

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

const REWARD_LABELS = {
  default: 'Default 50% 50%',
  powerup: 'Power up 100%',
  decline: 'Decline payout',
};

function EmbedDetails() {
  const {
    title, setTitle,
    description, setDescription,
    tagsInputValue, setTagsInputValue,
    tagsPreview, setTagsPreview,
    community, setCommunity, setBeneficiaries,
    SetDeclineRewards,
    setRewardPowerup,
    communitiesData,
    navigate,
    BeneficiaryList, setBeneficiaryList,
    list, setList,
    remaingPercent, setRemaingPercent,
    step, setStep,
    isOpen, setIsOpen,
    benficaryOpen, setBeneficiaryOpen,
    selectedThumbnail,
    isScheduled, setIsScheduled,
    scheduleDateTime, setScheduleDateTime,
    fromStories,
    reusable, setReusable,
    isNsfw, setIsNsfw,
    gated, setGated,
    gatedAllowlist, setGatedAllowlist,
    user,
    isChannelTrailer, setIsChannelTrailer,
    originalAuthor, originalPermlink,
    startEarlyUpload,
  } = useEmbedUpload();

  // 🔐 Pro status decides whether the supporters-only control is offered. The
  // hook returns null while loading, so the toggle stays hidden until we have a
  // definite yes rather than flashing in and out.
  const premiumStatus = usePremiumStatus(user);
  const isPro = premiumStatus?.premium === true;

  // Never leave a stale gated intent behind: if Pro lapses mid-session, or the
  // user switches to a short, the flag must not survive into the token request.
  useEffect(() => {
    if (gated && (!isPro || fromStories || !isTestUser(user))) setGated(false);
  }, [gated, isPro, fromStories, user, setGated]);

  // Turning the paywall off drops the guest list with it, so a list cannot be
  // silently attached to an ungated upload.
  useEffect(() => {
    if (!gated && gatedAllowlist.length) setGatedAllowlist([]);
  }, [gated, gatedAllowlist, setGatedAllowlist]);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  // The sheet edits a draft; only OK writes it back, so closing or pressing
  // Escape leaves the previously chosen time alone.
  const [scheduleDraft, setScheduleDraft] = useState('');
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [rewardChoice, setRewardChoice] = useState('default');
  const [allowlistDraft, setAllowlistDraft] = useState('');
  const [allowlistChecking, setAllowlistChecking] = useState(false);
  // Same check the beneficiary dialog uses: the name has to be shaped like a
  // Hive account AND actually exist. A typo here silently means the person you
  // meant to invite cannot watch, and you would not find out until they told
  // you, so it is worth the lookup.
  const addAllowlistNames = async () => {
    const names = [...new Set(allowlistDraft
      .split(/[\s,]+/)
      .map((n) => n.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean))];
    if (!names.length) return;

    const malformed = names.filter((n) => !/^[a-z][a-z0-9.-]{2,15}$/.test(n));
    const candidates = names.filter((n) => !malformed.includes(n));

    let existing = [];
    let missing = [];
    if (candidates.length) {
      setAllowlistChecking(true);
      try {
        const accounts = await getHiveClient().database.getAccounts(candidates);
        const found = new Set(accounts.map((a) => a.name));
        existing = candidates.filter((n) => found.has(n));
        missing = candidates.filter((n) => !found.has(n));
      } catch (err) {
        // A node hiccup must not silently drop the names: say so and add nothing.
        console.error('[allowlist] account lookup failed:', err?.message || err);
        toast.error('Could not verify those accounts right now. Try again in a moment.');
        setAllowlistChecking(false);
        return;
      }
      setAllowlistChecking(false);
    }

    if (malformed.length) toast.error(`Not valid Hive names: ${malformed.join(', ')}`);
    if (missing.length) toast.error(`No such Hive account: ${missing.join(', ')}`);

    if (existing.length) {
      setGatedAllowlist([...new Set([...gatedAllowlist, ...existing])]);
      setAllowlistDraft('');
    }
  };

  const isRemix = !!(originalAuthor && originalPermlink);
  const descLimitToastRef = useRef(null);

  // Start uploading the video in the background as soon as the user reaches this
  // "Add details" step, so it's usually done by the time they hit publish.
  // startEarlyUpload is idempotent (only runs once per selected video).
  useEffect(() => {
    startEarlyUpload();
  }, [startEarlyUpload]);

  const handleDescriptionChange = (val) => {
    if (fromStories) {
      if (val.length > 240) {
        // Only fire a toast if one isn't already showing (3-second throttle)
        if (!descLimitToastRef.current) {
          descLimitToastRef.current = toast.error(
            'Maximum 240 characters reached for short descriptions.',
            { duration: 3000 }
          );
          setTimeout(() => { descLimitToastRef.current = null; }, 3000);
        }
        return; // block the update
      }
    }
    setDescription(val);
  };

  useEffect(() => {
    setStep(3)
  }, [])

  // 🔧 TEMPORARY DEV HACK — remove with the other ?devstep handling.
  // /embed-studio/details?devstep=3 renders the form with no upload behind it,
  // purely so the layout can be worked on. Publishing from here will not work.
  const devStep = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('devstep');

  if (!selectedThumbnail && !devStep) {
    return <Navigate to="/embed-studio" replace />;
  }

  const closeCommunityModal = () => {
    setIsOpen(false);
  };

  const toggleBeneficiaryModal = () => {
    setBeneficiaryOpen((prev) => !prev)
  }
  const openCommunityModal = () => {
    setIsOpen(true);
  };

  const handleSelect = (e) => {
    const value = typeof e === 'string' ? e : e.target.value;
    setRewardChoice(value);
    if (value === "powerup") {
      setRewardPowerup(true)
      SetDeclineRewards(false)
    } else if (value === "decline") {
      SetDeclineRewards(true)
      setRewardPowerup(false)
    } else {
      SetDeclineRewards(false)
      setRewardPowerup(false)
    }
  }

  const process = () => {
    if (!fromStories && !title?.trim()) {
      toast.error("Title is required");
      return;
    }

    if (!description?.trim()) {
      toast.error("Description is required");
      return;
    }

    if (!fromStories && (!tagsPreview || tagsPreview.length === 0)) {
      toast.error("Please add at least one tag");
      return;
    }

    navigate("/embed-studio/preview");
    setStep(4);
  };


  // Auto taxonomy tags that we add + show in the list and count toward the
  // 10-tag limit. Only the community tag is added automatically — no '3speak',
  // no 'short' (shorts are identified by the embed-video `short` DB field).
  // The community tag counts so the total can't exceed 10.
  const communityTag = typeof community === 'string'
    ? (community || 'hive-181335')
    : (community?.name || 'hive-181335');
  const autoTags = fromStories ? ['hive-181335'] : [communityTag];
  const maxUserTags = Math.max(0, 10 - autoTags.length);
  const allTags = [...autoTags, ...tagsPreview.filter((t) => !autoTags.includes(t))];

  const handleTagChange = (e) => {
    const value = e.target.value.toLowerCase();

    const tags = value
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const uniqueTags = [...new Set(tags)].filter((t) => !autoTags.includes(t));

    if (uniqueTags.length > maxUserTags) {
      toast.error(`You can add up to ${maxUserTags} tags — the community tag is added automatically.`);
      return;
    }

    setTagsInputValue(value);
    setTagsPreview(uniqueTags);
  };

  return (
    <>
      <div className="studio-main-container embed-details-page">
        <div className="studio-page-header">
          <h1>{fromStories ? "Share a Short" : "Share a Video"}</h1>
        </div>
        <StepProgress step={step} />
        <EmbedUploadProgressBar />
        <div className="studio-page-content">

          <div className="video-detail-wrap">
            <div className="video-items">
              {!fromStories && (
                <div className="input-group">
                  <label htmlFor="">Title</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
              )}
              <div className="input-group">
                <label htmlFor="">Description</label>
                <div className={`wrap-dec${fromStories ? ' wrap-dec--short' : ''}`}>
                  <MarkdownComposer
                    value={description}
                    onChange={handleDescriptionChange}
                    placeholder={fromStories ? "Describe your short..." : "Write your video description here... Supports markdown formatting!"}
                  />
                </div>
                {fromStories && (
                  <div
                    className="char-counter"
                    style={{
                      textAlign: 'right',
                      marginTop: '4px',
                      color: description.length >= 240 ? '#e05252' : description.length >= 200 ? '#e0a852' : 'var(--text-muted, #888)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {description.length} / 240
                  </div>
                )}
              </div>

              <div className="input-group">
                <label htmlFor="">
                  Tag
                  <span
                    className="tag-count"
                    style={{ marginLeft: 8, color: allTags.length >= 10 ? '#e0a852' : 'var(--text-muted, #888)' }}
                  >
                    {allTags.length}/10 tags{!fromStories ? ' · at least 1 required' : ''}
                  </span>
                </label>
                <input type="text" value={tagsInputValue} onChange={handleTagChange} />

                <div className="wrap">
                  <span>Separate multiple tags with </span> <span>Space</span>
                </div>
                {/* The community (and 'short' for shorts) is added automatically —
                    shown here as a pinned tag and counted toward the 10-tag limit. */}
                <div className="preview-tags">
                  <span>{allTags.map((item, index) => (
                    <span
                      className={`item${index < autoTags.length ? ' item--auto' : ''}`}
                      key={index}
                      style={index < autoTags.length ? { opacity: 0.75, fontStyle: 'italic' } : undefined}
                      title={index < autoTags.length ? 'Added automatically' : undefined}
                    >
                      {item}
                    </span>
                  ))}</span>
                </div>
              </div>
              <div className="advance-option">
                {!fromStories && (
                  <div className="beneficiary-wrap community-tile is-clickable" onClick={openCommunityModal}>
                    <div className="wrap">
                      <span>Community<SettingInfo title="Community">Which Hive community this video is posted to. It becomes the post&apos;s category, so community feeds and moderation follow it.</SettingInfo></span>
                      <span>Where this video is posted.</span>
                    </div>
                    <div className="tile-value community-value">
                      {community ? <span>{community === "hive-181335" ? <div className="wrap"><img src={`https://images.hive.blog/u/hive-181335/avatar/small`} alt="" /><span></span>Threespeak</div> : <div className="wrap"><img src={`https://images.hive.blog/u/${community.name}/avatar/small`} alt="" /><span></span>{community.title}</div>}</span> : <span> Select Community </span>}
                      <IoIosArrowDropdownCircle size={16} />
                    </div>
                  </div>
                )}
                <div className="beneficiary-wrap is-clickable" onClick={() => setRewardsOpen(true)}>
                  <div className="wrap">
                    <span>Rewards<SettingInfo title="Rewards">Optional &quot;Hive Reward Pool&quot; distribution method. Choose the default 50/50 split, power up 100% of the payout, or decline rewards entirely.</SettingInfo></span>
                      <span>How rewards are paid out.</span>
                  </div>
                  <div className="tile-value">{REWARD_LABELS[rewardChoice] || REWARD_LABELS.default}</div>
                </div>
                <div className="beneficiary-wrap is-clickable" onClick={toggleBeneficiaryModal}>
                  <div className="wrap">
                    <span>Beneficiaries<SettingInfo title="Beneficiaries">Other accounts that should get a percentage of this post's rewards. Useful for co-creators, editors, or the original author of a clip.</SettingInfo></span>
                      <span>Share rewards with others.</span>
                  </div>
                  <div className="tile-value">{list.length > 0
                    ? `${list.length} account${list.length === 1 ? '' : 's'}`
                    : 'None'}</div>
                </div>
                <div className="beneficiary-wrap" onClick={() => setIsRemix(!isRemix)}>
                  <div className="wrap">
                    <span>Allow Remix/Clip<SettingInfo title="Allow Remix/Clip">Allow others to create remixes and clips from this video. You will be credited as original author and receive a minimum of 5% in beneficiaries.</SettingInfo></span>
                      <span>Let others remix this.</span>
                  </div>
                  <label className={`toggle-switch${isRemix ? ' disabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={isRemix ? true : reusable}
                      disabled={isRemix}
                      onChange={(e) => setReusable(e.target.checked)}
                    />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                  </label>
                </div>
                <div className="beneficiary-wrap" onClick={() => setIsNsfw(!isNsfw)}>
                  <div className="wrap">
                    <span>Mark as NSFW<SettingInfo title="Mark as NSFW">Flags this video as adult content. It will be hidden from feeds and search for viewers who have not enabled NSFW, and tagged <code>nsfw</code> across Hive.</SettingInfo></span>
                      <span>Adult content.</span>
                  </div>
                  <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={!!isNsfw}
                      onChange={(e) => setIsNsfw(e.target.checked)}
                    />
                    <span className="toggle-track"><span className="toggle-thumb" /></span>
                  </label>
                </div>
                {/* 🔐 Supporters-only. Pro-gated in the UI, but the backend
                    re-checks Pro status when it mints the upload token, so
                    hiding this control is presentation, not enforcement. Not
                    offered for shorts: a paywalled short is a worse product
                    than a free one, and the preview would be most of the clip. */}
                {/* Still under test: visible only to the team's test accounts, the
                    same list that gates OpenPods and the camera recorder. Drop
                    `isTestUser` here to open it to every Pro user. */}
                {!fromStories && isPro && isTestUser(user) && (
                  <div className="beneficiary-wrap" onClick={() => setGated(!gated)}>
                    <div className="wrap">
                      <span>Supporters only<SettingInfo title="Supporters only">
                          Encrypts this video so only 3Speak Pro subscribers can play it.
                          A <strong>10 second unencrypted preview</strong> is published alongside
                          it, so the post still shows a trailer everywhere on Hive.
                          {' '}Your title, description and tags are ordinary Hive post content and
                          are <strong>not encrypted</strong> — only the video is.
                          {' '}<strong>This cannot be changed after upload.</strong>
                        </SettingInfo></span>
                      <span>{gated && gatedAllowlist.length
                        ? `Pro subscribers + ${gatedAllowlist.length} guest${gatedAllowlist.length === 1 ? '' : 's'}.`
                        : 'Pro subscribers only.'}</span>
                    </div>
                    <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!gated}
                        onChange={(e) => setGated(e.target.checked)}
                      />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                    {/* 🔐 Guest list. Named accounts watch without needing Pro, which
                        is what makes this usable for sending a video to specific
                        people. Stored on our servers only — never in the Hive post,
                        so the recipient list is not published on-chain. */}
                    {gated && isPro && (
                      <button
                        type="button"
                        className="schedule-tile__change"
                        onClick={(e) => { e.stopPropagation(); setGuestsOpen(true); }}
                      >
                        Guest list
                      </button>
                    )}
                  </div>
                )}
                {/* Not offered for shorts: the Overview trailer frame is 16:9. */}
                {!fromStories && (
                  <div className="beneficiary-wrap" onClick={() => setIsChannelTrailer(!isChannelTrailer)}>
                    <div className="wrap">
                      <span>Channel trailer<SettingInfo title="Channel trailer">Plays automatically at the top of your profile&apos;s <strong>Overview</strong> tab, replacing any trailer you set before.</SettingInfo></span>
                      <span>Autoplays on your profile.</span>
                    </div>
                    <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!isChannelTrailer}
                        onChange={(e) => setIsChannelTrailer(e.target.checked)}
                      />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                  </div>
                )}
                {/* Schedule — only for regular videos, not shorts. When on, the post
                    is queued on the checker backend and broadcast at the chosen time
                    by @threespeak (the user grants that posting auth once). The
                    picker lives in a sheet so the tile stays the size of its
                    neighbours instead of growing an input inline. */}
                {!fromStories && (
                  <div className="beneficiary-wrap schedule-tile" onClick={() => { const next = !isScheduled; setIsScheduled(next); if (next) { if (!scheduleDateTime) { const { minFormatted, minDate } = getMinMaxDates(); setScheduleDateTime(minFormatted || minDate?.toISOString().slice(0, 16)); } setScheduleDraft(scheduleDateTime || ''); setScheduleOpen(true); } }}>
                    <div className="wrap">
                      <span>Schedule this post<SettingInfo title="Schedule this post">Queues the post and publishes it automatically at the time you choose, at least 15 minutes from now and up to 90 days out. It is broadcast by @threespeak on your behalf, so you will be asked to authorize that once.</SettingInfo></span>
                      <span>{isScheduled && scheduleDateTime
                        ? new Date(scheduleDateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                        : 'Publish immediately.'}</span>
                    </div>
                    <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isScheduled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setIsScheduled(checked);
                          if (checked) {
                            if (!scheduleDateTime) {
                              // Prefill with the minimum so the picker is never empty.
                              const { minFormatted, minDate } = getMinMaxDates();
                              setScheduleDateTime(minFormatted || minDate?.toISOString().slice(0, 16));
                            }
                            // Turning it on is a request to pick a time, so ask now.
                            setScheduleDraft(scheduleDateTime || '');
                            setScheduleOpen(true);
                          }
                        }}
                      />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                    {isScheduled && (
                      <button type="button" className="schedule-tile__change" onClick={(e) => { e.stopPropagation(); setScheduleDraft(scheduleDateTime || ''); setScheduleOpen(true); }}>
                        Change time
                      </button>
                    )}
                  </div>
                )}
              </div>

              <SettingSheet title="Rewards" open={rewardsOpen} onClose={() => setRewardsOpen(false)}>
                <div className="option-sheet">
                  {[
                    { value: 'default', label: 'Default 50% 50%', hint: 'Half HBD, half Hive Power.' },
                    { value: 'powerup', label: 'Power up 100%', hint: 'All rewards as Hive Power.' },
                    { value: 'decline', label: 'Decline payout', hint: 'Take no rewards for this post.' },
                  ].map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      className={`option-sheet__item${rewardChoice === opt.value ? ' is-active' : ''}`}
                      onClick={() => { handleSelect(opt.value); setRewardsOpen(false); }}
                    >
                      <strong>{opt.label}</strong>
                      <span>{opt.hint}</span>
                    </button>
                  ))}
                </div>
              </SettingSheet>

              <SettingSheet title="Guest list" open={guestsOpen} onClose={() => setGuestsOpen(false)}>
                <p className="schedule-sheet__note" style={{ marginTop: 0 }}>
                  These Hive accounts can watch without 3Speak Pro. The list is kept private on
                  our servers and is never published to your post, so nobody can see who you
                  shared it with.
                </p>
                <div className="gated-guests__editor">
                  <div className="gated-guests__input-row">
                    <input
                      type="text"
                      value={allowlistDraft}
                      placeholder="username, another.user"
                      onChange={(e) => setAllowlistDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAllowlistNames(); } }}
                    />
                    <button type="button" onClick={addAllowlistNames} disabled={allowlistChecking}>{allowlistChecking ? 'Checking…' : 'Add'}</button>
                  </div>
                  {gatedAllowlist.length > 0 && (
                    <div className="gated-guests__chips">
                      {gatedAllowlist.map((name) => (
                        <span className="gated-guests__chip" key={name}>
                          @{name}
                          <button
                            type="button"
                            aria-label={`Remove ${name}`}
                            onClick={() => setGatedAllowlist(gatedAllowlist.filter((n) => n !== name))}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </SettingSheet>

              <SettingSheet title="Schedule this post" open={scheduleOpen} onClose={() => setScheduleOpen(false)}>
                {(() => {
                  const { minFormatted, maxFormatted } = getMinMaxDates();
                  return (
                    <>
                      <input
                        type="datetime-local"
                        className="schedule-sheet__input"
                        value={scheduleDraft}
                        min={minFormatted}
                        max={maxFormatted}
                        onChange={(e) => setScheduleDraft(e.target.value)}
                      />
                      <p className="schedule-sheet__note">
                        At least 15 minutes from now, up to 90 days. Posted automatically by
                        @threespeak on your behalf — you will be asked to authorize this once.
                      </p>
                      <div className="sheet-actions">
                        <button
                          type="button"
                          className="sheet-actions__ok"
                          disabled={!scheduleDraft}
                          onClick={() => { setScheduleDateTime(scheduleDraft); setScheduleOpen(false); }}
                        >
                          OK
                        </button>
                      </div>
                    </>
                  );
                })()}
              </SettingSheet>

              <div className="submit-btn-wrap">
                <button
                  onClick={() => {
                    process();
                  }}
                >
                  Proceed
                </button>
              </div>

            </div>

          </div>


        </div>
      </div>
      {isOpen && <CommunityModal isOpen={isOpen} data={communitiesData} close={closeCommunityModal} setCommunity={setCommunity} selected={community} />}
      {benficaryOpen && <Beneficiary_modal
        close={toggleBeneficiaryModal}
        isOpen={benficaryOpen}
        setBeneficiaries={setBeneficiaries}
        setBeneficiaryList={setBeneficiaryList}
        setList={setList}
        list={list}
        setRemaingPercent={setRemaingPercent}
        remaingPercent={remaingPercent}
        variant="embed"
      />}

    </>
  )
}

export default EmbedDetails
