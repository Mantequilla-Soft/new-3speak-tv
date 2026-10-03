import React, { useEffect, useRef, useState } from 'react'
import { toastIn } from '../../utils/toast';
import { StepProgress } from '../legacy-studio/StepProgress';
import { IoIosArrowDropdownCircle } from 'react-icons/io';
import { MdPeopleAlt } from 'react-icons/md';
import CommunityModal from "../modal/Community_modal";
import Beneficiary_modal from '../modal/Beneficiary_modal';
import { Navigate } from 'react-router-dom';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { useAppStore } from '../../lib/store';
import MarkdownComposer from '../studio/MarkdownComposer';
import { getMinMaxDates } from '../../utils/schedulingHelpers';
import EmbedUploadProgressBar from './EmbedUploadProgressBar';
import { usePremiumStatus } from '../../hooks/usePremiumStatus';
import { isTestUser } from '../../utils/config';
import { getHiveClient } from '../../utils/hiveNode';
import { fetchCreatorAdPrefs } from '../../lib/advertiseData';
// This route renders on its own, so it imports the studio stylesheet rather
// than relying on EmbedStudioPage having mounted first and pulled it in.
// ScheduledPostEditor already does the same for the same reason; Vite dedupes.
import '../legacy-studio/StudioPage.scss';
import SettingInfo, { SettingSheet } from './SettingInfo';
import './EmbedDetails.scss';
import { useTranslation, Trans } from 'react-i18next';

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

const REWARD_LABELS = {
  default: 'upload.details.rewards.default',
  powerup: 'upload.details.rewards.powerup',
  decline: 'upload.details.rewards.decline',
};

function EmbedDetails() {
  const { t } = useTranslation();
  // Someone with no Hive account yet. Their upload is stored off-chain, so
  // every Hive payout concept below is inapplicable rather than merely unset.
  const incubationHandle = useAppStore((s) => s.incubationHandle);
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
    videoAdsEnabled, setVideoAdsEnabled,
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

  // Per-video ad opt-out is only offered to a creator whose account carries ads.
  // Read from the checker, the same row the ad server decides on. Hidden until a
  // definite yes: a failed read (or ads switched off platform-wide, which 404s)
  // must not offer a switch that would do nothing.
  const [accountAdsOn, setAccountAdsOn] = useState(false);
  useEffect(() => {
    if (!user || incubationHandle) { setAccountAdsOn(false); return undefined; }
    let alive = true;
    fetchCreatorAdPrefs(user)
      .then((p) => { if (alive) setAccountAdsOn(p?.adsEnabled === true); })
      .catch(() => { if (alive) setAccountAdsOn(false); });
    return () => { alive = false; };
  }, [user, incubationHandle]);

  // Never carry a stale "no ads" into the post if the switch is not on screen.
  useEffect(() => {
    if (!accountAdsOn && !videoAdsEnabled) setVideoAdsEnabled(true);
  }, [accountAdsOn, videoAdsEnabled, setVideoAdsEnabled]);

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
        toast.error(t('upload.details.guests.verifyFailed'));
        setAllowlistChecking(false);
        return;
      }
      setAllowlistChecking(false);
    }

    if (malformed.length) toast.error(t('upload.details.guests.invalidNames', { names: malformed.join(', ') }));
    if (missing.length) toast.error(t('upload.details.guests.missingAccounts', { names: missing.join(', ') }));

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
            t('upload.details.shortDescLimit'),
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
      toast.error(t("upload.details.errors.titleRequired"));
      return;
    }

    if (!description?.trim()) {
      toast.error(t("upload.details.errors.descriptionRequired"));
      return;
    }

    if (!fromStories && (!tagsPreview || tagsPreview.length === 0)) {
      toast.error(t("upload.details.errors.tagRequired"));
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
  const allTags = [...autoTags, ...tagsPreview.filter((tag) => !autoTags.includes(tag))];

  const handleTagChange = (e) => {
    const value = e.target.value.toLowerCase();

    const tags = value
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const uniqueTags = [...new Set(tags)].filter((tag) => !autoTags.includes(tag));

    if (uniqueTags.length > maxUserTags) {
      toast.error(t('upload.details.errors.tooManyTags', { max: maxUserTags }));
      return;
    }

    setTagsInputValue(value);
    setTagsPreview(uniqueTags);
  };

  return (
    <>
      <div className="studio-main-container embed-details-page">
        <div className="studio-page-header">
          <h1>{fromStories ? t("upload.page.shareShort") : t("upload.page.shareVideo")}</h1>
        </div>
        <StepProgress step={step} />
        <EmbedUploadProgressBar />
        <div className="studio-page-content">

          <div className="video-detail-wrap">
            <div className="video-items">
              {!fromStories && (
                <div className="input-group">
                  <label htmlFor="">{t("upload.details.title")}</label>
                  <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
              )}
              <div className="input-group">
                <label htmlFor="">{t("upload.details.description")}</label>
                <div className={`wrap-dec${fromStories ? ' wrap-dec--short' : ''}`}>
                  <MarkdownComposer
                    value={description}
                    onChange={handleDescriptionChange}
                    placeholder={fromStories ? t("upload.details.descriptionPlaceholderShort") : t("upload.details.descriptionPlaceholder")}
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
                  {t("upload.details.tag")}
                  <span
                    className="tag-count"
                    style={{ marginLeft: 8, color: allTags.length >= 10 ? '#e0a852' : 'var(--text-muted, #888)' }}
                  >
                    {!fromStories ? t('upload.details.tagCountRequired', { n: allTags.length }) : t('upload.details.tagCount', { n: allTags.length })}
                  </span>
                </label>
                <input type="text" value={tagsInputValue} onChange={handleTagChange} />

                <div className="wrap">
                  <Trans i18nKey="upload.details.tagsSeparator" components={{ text: <span />, space: <span /> }} />
                </div>
                {/* The community (and 'short' for shorts) is added automatically —
                    shown here as a pinned tag and counted toward the 10-tag limit. */}
                <div className="preview-tags">
                  <span>{allTags.map((item, index) => (
                    <span
                      className={`item${index < autoTags.length ? ' item--auto' : ''}`}
                      key={index}
                      style={index < autoTags.length ? { opacity: 0.75, fontStyle: 'italic' } : undefined}
                      title={index < autoTags.length ? t('upload.details.addedAutomatically') : undefined}
                    >
                      {item}
                    </span>
                  ))}</span>
                </div>
              </div>
              {/* Hidden, not removed, for someone with no Hive account. Community is a
                  Hive category, and Rewards, Beneficiaries and Remix all divide a payout
                  that an off-chain post does not have. Showing them would ask the user to
                  configure things that cannot apply, and quietly imply their post earns.
                  They come back by themselves once the user graduates. */}
              {!incubationHandle && (
              <div className="advance-option">
                {!fromStories && (
                  <div className="beneficiary-wrap community-tile is-clickable" onClick={openCommunityModal}>
                    <div className="wrap">
                      <span>{t('upload.details.community.label')}<SettingInfo title={t('upload.details.community.label')}>{t('upload.details.community.info')}</SettingInfo></span>
                      <span>{t('upload.details.community.hint')}</span>
                    </div>
                    <div className="tile-value community-value">
                      {community ? <span>{community === "hive-181335" ? <div className="wrap"><img src={`/img/u/hive-181335/avatar/small`} alt="" /><span></span>Threespeak</div> : <div className="wrap"><img src={`/img/u/${community.name}/avatar/small`} alt="" /><span></span>{community.title}</div>}</span> : <span> {t('upload.details.community.select')} </span>}
                      <IoIosArrowDropdownCircle size={16} />
                    </div>
                  </div>
                )}
                <div className="beneficiary-wrap is-clickable" onClick={() => setRewardsOpen(true)}>
                  <div className="wrap">
                    <span>{t('upload.details.rewards.label')}<SettingInfo title={t('upload.details.rewards.label')}>{t('upload.details.rewards.info')}</SettingInfo></span>
                      <span>{t('upload.details.rewards.hint')}</span>
                  </div>
                  <div className="tile-value">{t(REWARD_LABELS[rewardChoice] || REWARD_LABELS.default)}</div>
                </div>
                <div className="beneficiary-wrap is-clickable" onClick={toggleBeneficiaryModal}>
                  <div className="wrap">
                    <span>{t('upload.details.beneficiaries.label')}<SettingInfo title={t('upload.details.beneficiaries.label')}>{t('upload.details.beneficiaries.info')}</SettingInfo></span>
                      <span>{t('upload.details.beneficiaries.hint')}</span>
                  </div>
                  <div className="tile-value">{list.length > 0
                    ? t('upload.details.beneficiaries.accounts', { count: list.length })
                    : t('upload.details.beneficiaries.none')}</div>
                </div>
                <div className="beneficiary-wrap" onClick={() => setIsRemix(!isRemix)}>
                  <div className="wrap">
                    <span>{t('upload.details.remix.label')}<SettingInfo title={t('upload.details.remix.label')}>{t('upload.details.remix.info')}</SettingInfo></span>
                      <span>{t('upload.details.remix.hint')}</span>
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
                    <span>{t('upload.details.nsfw.label')}<SettingInfo title={t('upload.details.nsfw.label')}><Trans i18nKey="upload.details.nsfw.info" components={{ code: <code /> }} /></SettingInfo></span>
                      <span>{t('upload.details.nsfw.hint')}</span>
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
                {accountAdsOn && (
                  <div className="beneficiary-wrap" onClick={() => setVideoAdsEnabled(!videoAdsEnabled)}>
                    <div className="wrap">
                      <span>{t('upload.details.ads.label')}<SettingInfo title={t('upload.details.ads.label')}>{t('upload.details.ads.info')}</SettingInfo></span>
                      <span>{videoAdsEnabled ? t('upload.details.ads.hintOn') : t('upload.details.ads.hintOff')}</span>
                    </div>
                    <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={!!videoAdsEnabled}
                        onChange={(e) => setVideoAdsEnabled(e.target.checked)}
                      />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                  </div>
                )}
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
                      <span>{t('upload.details.gated.label')}<SettingInfo title={t('upload.details.gated.label')}>
                          <Trans i18nKey="upload.details.gated.info" components={{ b: <strong /> }} />
                        </SettingInfo></span>
                      <span>{gated && gatedAllowlist.length
                        ? t('upload.details.gated.withGuests', { count: gatedAllowlist.length })
                        : t('upload.details.gated.hint')}</span>
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
                        {t('upload.details.guests.title')}
                      </button>
                    )}
                  </div>
                )}
                {/* Not offered for shorts: the Overview trailer frame is 16:9. */}
                {!fromStories && (
                  <div className="beneficiary-wrap" onClick={() => setIsChannelTrailer(!isChannelTrailer)}>
                    <div className="wrap">
                      <span>{t('upload.details.trailer.label')}<SettingInfo title={t('upload.details.trailer.label')}><Trans i18nKey="upload.details.trailer.info" components={{ b: <strong /> }} /></SettingInfo></span>
                      <span>{t('upload.details.trailer.hint')}</span>
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
                      <span>{t('upload.details.schedule.label')}<SettingInfo title={t('upload.details.schedule.label')}>{t('upload.details.schedule.info')}</SettingInfo></span>
                      <span>{isScheduled && scheduleDateTime
                        ? new Date(scheduleDateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                        : t('upload.details.schedule.immediately')}</span>
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
                        {t('upload.details.schedule.changeTime')}
                      </button>
                    )}
                  </div>
                )}
              </div>
              )}

              <SettingSheet title={t('upload.details.rewards.label')} open={rewardsOpen} onClose={() => setRewardsOpen(false)}>
                <div className="option-sheet">
                  {[
                    { value: 'default', label: t('upload.details.rewards.default'), hint: t('upload.details.rewards.defaultHint') },
                    { value: 'powerup', label: t('upload.details.rewards.powerup'), hint: t('upload.details.rewards.powerupHint') },
                    { value: 'decline', label: t('upload.details.rewards.decline'), hint: t('upload.details.rewards.declineHint') },
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

              <SettingSheet title={t('upload.details.guests.title')} open={guestsOpen} onClose={() => setGuestsOpen(false)}>
                <p className="schedule-sheet__note" style={{ marginTop: 0 }}>
                  {t('upload.details.guests.note')}
                </p>
                <div className="gated-guests__editor">
                  <div className="gated-guests__input-row">
                    <input
                      type="text"
                      value={allowlistDraft}
                      placeholder={t('upload.details.guests.placeholder')}
                      onChange={(e) => setAllowlistDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAllowlistNames(); } }}
                    />
                    <button type="button" onClick={addAllowlistNames} disabled={allowlistChecking}>{allowlistChecking ? t('upload.details.guests.checking') : t('common.actions.add')}</button>
                  </div>
                  {gatedAllowlist.length > 0 && (
                    <div className="gated-guests__chips">
                      {gatedAllowlist.map((name) => (
                        <span className="gated-guests__chip" key={name}>
                          @{name}
                          <button
                            type="button"
                            aria-label={t('upload.details.guests.remove', { name })}
                            onClick={() => setGatedAllowlist(gatedAllowlist.filter((n) => n !== name))}
                          >×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </SettingSheet>

              <SettingSheet title={t('upload.details.schedule.label')} open={scheduleOpen} onClose={() => setScheduleOpen(false)}>
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
                        {t('upload.details.schedule.note')}
                      </p>
                      <div className="sheet-actions">
                        <button
                          type="button"
                          className="sheet-actions__ok"
                          disabled={!scheduleDraft}
                          onClick={() => { setScheduleDateTime(scheduleDraft); setScheduleOpen(false); }}
                        >
                          {t('common.actions.ok')}
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
                  {t('upload.details.proceed')}
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
