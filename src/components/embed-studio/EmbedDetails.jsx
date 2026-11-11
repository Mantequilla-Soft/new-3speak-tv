import React, { useEffect, useRef, useState } from 'react'
import { toastIn } from '../../utils/toast';
import { StepProgress } from '../legacy-studio/StepProgress';
import CommunityModal from "../modal/Community_modal";
import Beneficiary_modal from '../modal/Beneficiary_modal';
import { Navigate } from 'react-router-dom';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { useAppStore } from '../../lib/store';
import MarkdownComposer from '../studio/MarkdownComposer';
import { getMinMaxDates } from '../../utils/schedulingHelpers';
import ScheduleCalendar from '../studio/ScheduleCalendar';
import EmbedUploadProgressBar from './EmbedUploadProgressBar';
import StepActions from './StepActions';
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
import AccountImg from '../HiveAvatar/AccountImg';
import { SHORT_TITLE_MAX } from '../../utils/shortTitle';
import { Button, Icon, IconButton, Toggle } from '../v2/ui';

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

/**
 * One publish option as a tile (design 35c): a tinted icon box and the control
 * (a switch, or a chevron for a picker) on top, the name with its (i) and a
 * short line at the bottom. `tone` cyan for community and reach, accent for
 * money and content rules; the border takes the tone while the option is on.
 * Module level on purpose: defined inside the page it would remount on every
 * keystroke and close an open (i).
 */
function OptTile({ icon, tone = 'cyan', on, label, info, hint, onClick, control, value, extra, className = '', picker = false }) {
  const onKey = picker ? (e) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  } : undefined;
  return (
    <div
      className={`beneficiary-wrap opt-tile tone-${tone}${on ? ' is-on' : ''}${onClick ? ' is-clickable' : ''} ${className}`.trim()}
      onClick={onClick}
      onKeyDown={onKey}
      role={picker ? 'button' : undefined}
      tabIndex={picker ? 0 : undefined}
    >
      <div className="opt-tile__head">
        <span className="opt-tile__icon"><Icon name={icon} size={20} /></span>
        <span className="opt-tile__spacer" />
        {control}
      </div>
      <div className="wrap">
        <span>{label}<SettingInfo title={label}>{info}</SettingInfo></span>
        {hint && <span>{hint}</span>}
      </div>
      {value}
      {extra}
    </div>
  );
}

// The switch inside a tile. The tile toggles on a click too, so the switch's
// own click must not reach it (that would toggle twice).
const tileSwitch = (checked, onChange, label, disabled = false) => (
  <span className="opt-tile__switch" onClick={(e) => e.stopPropagation()}>
    <Toggle checked={!!checked} onChange={onChange} label={label} disabled={disabled} />
  </span>
);
const chevron = <Icon name="chevron_right" size={20} className="opt-tile__chev" />;

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
    declineRewards, SetDeclineRewards,
    rewardPowerup, setRewardPowerup,
    communitiesData,
    navigate,
    BeneficiaryList, setBeneficiaryList,
    list, setList,
    remaingPercent, setRemaingPercent,
    step, setStep,
    isOpen, setIsOpen,
    benficaryOpen, setBeneficiaryOpen,
    selectedThumbnail,
    editedThumbnail,
    isScheduled, setIsScheduled,
    scheduleDateTime, setScheduleDateTime,
    fromStories,
    isStory,
    reusable, setReusable,
    isNsfw, setIsNsfw,
    addToBlog, setAddToBlog,
    videoAdsEnabled, setVideoAdsEnabled,
    videoRollsEnabled, setVideoRollsEnabled,
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
  // The rolls switch likewise only when the account takes rolls at all: with
  // the account on banners and tickers only, this video already gets no rolls.
  const [accountRollsOn, setAccountRollsOn] = useState(false);
  useEffect(() => {
    if (!user || incubationHandle) { setAccountAdsOn(false); setAccountRollsOn(false); return undefined; }
    let alive = true;
    fetchCreatorAdPrefs(user)
      .then((p) => {
        if (!alive) return;
        setAccountAdsOn(p?.adsEnabled === true);
        setAccountRollsOn(p?.adsEnabled === true && p?.rollsEnabled !== false);
      })
      .catch(() => { if (alive) { setAccountAdsOn(false); setAccountRollsOn(false); } });
    return () => { alive = false; };
  }, [user, incubationHandle]);

  // Never carry a stale "no ads" into the post if the switch is not on screen.
  useEffect(() => {
    if (!accountAdsOn && !videoAdsEnabled) setVideoAdsEnabled(true);
  }, [accountAdsOn, videoAdsEnabled, setVideoAdsEnabled]);
  useEffect(() => {
    if ((!accountRollsOn || !videoAdsEnabled) && !videoRollsEnabled) setVideoRollsEnabled(true);
  }, [accountRollsOn, videoAdsEnabled, videoRollsEnabled, setVideoRollsEnabled]);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  // The sheet edits a draft; only OK writes it back, so closing or pressing
  // Escape leaves the previously chosen time alone.
  const [scheduleDraft, setScheduleDraft] = useState('');
  const [rewardsOpen, setRewardsOpen] = useState(false);
  const [guestsOpen, setGuestsOpen] = useState(false);
  // From the upload state, not 'default': this page is revisited (Back from
  // Timeline/Preview), and the tile must show what will actually be published.
  const [rewardChoice, setRewardChoice] = useState(() => (declineRewards ? 'decline' : rewardPowerup ? 'powerup' : 'default'));
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

    // A story may go without a caption (publishToEmbed gives it a plain one).
    if (!description?.trim() && !(isStory && fromStories)) {
      toast.error(t("upload.details.errors.descriptionRequired"));
      return;
    }

    if (!fromStories && (!tagsPreview || tagsPreview.length === 0)) {
      toast.error(t("upload.details.errors.tagRequired"));
      return;
    }

    // Long-form videos get the Timeline step (chapters + link toasters) before
    // the preview; shorts go straight on, they have no such step.
    if (fromStories) {
      navigate("/embed-studio/preview");
    } else {
      navigate("/embed-studio/timeline");
    }
    setStep(4);
  };

  // Rendered above and below the form from this one object; validation stays in
  // process(), so either Next shows the same single message. Back keeps every
  // field: they live in the upload state, not in this page.
  const actions = {
    back: { label: t('common.actions.back'), onClick: () => navigate('/embed-studio/thumbnail') },
    primary: [{ key: 'proceed', label: t('upload.details.proceed'), onClick: process }],
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

  const openSchedule = () => {
    const next = !isScheduled;
    setIsScheduled(next);
    if (next) {
      if (!scheduleDateTime) {
        // Prefill with the minimum so the picker is never empty.
        const { minFormatted, minDate } = getMinMaxDates();
        setScheduleDateTime(minFormatted || minDate?.toISOString().slice(0, 16));
      }
      // Turning it on is a request to pick a time, so ask now.
      setScheduleDraft(scheduleDateTime || '');
      setScheduleOpen(true);
    }
  };

  const descLen = description?.length || 0;
  const poster = editedThumbnail || selectedThumbnail;
  const pageTitle = fromStories ? t(isStory ? "upload.page.shareStory" : "upload.page.shareShort") : t("upload.page.shareVideo");

  return (
    <>
      <div className="studio-main-container embed-wizard embed-details-page">
        <div className="studio-page-header">
          <h1>{pageTitle}</h1>
        </div>
        <StepProgress step={step} short={fromStories} actions={actions} />
        <div className="studio-page-content">
          <div className={`embed-details-layout${fromStories ? ' is-short' : ''}`}>
            <div className="embed-details-main">
              {/* Shorts and stories: optional, posted as a `## Title` line on top of
                  the post and then shown as the short's title on 3Speak
                  (utils/shortTitle.js). */}
              <section className="v2-card details-card input-group">
                <label htmlFor="ed-title">
                  <span>{fromStories ? t("upload.details.titleShort") : t("upload.details.title")}</span>
                  {fromStories && <span className="details-count num">{title.length}/{SHORT_TITLE_MAX}</span>}
                </label>
                <input
                  id="ed-title"
                  type="text"
                  className="details-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  {...(fromStories ? { maxLength: SHORT_TITLE_MAX } : {})}
                />
              </section>

              <section className="v2-card details-card input-group">
                <label htmlFor="">{t("upload.details.description")}</label>
                <div className={`wrap-dec${fromStories ? ' wrap-dec--short' : ''}`}>
                  <MarkdownComposer
                    value={description}
                    onChange={handleDescriptionChange}
                    placeholder={fromStories ? t("upload.details.descriptionPlaceholderShort") : t("upload.details.descriptionPlaceholder")}
                  />
                </div>
                {fromStories && (
                  <div className={`char-counter num${descLen >= 240 ? ' is-max' : descLen >= 200 ? ' is-near' : ''}`}>
                    {descLen} / 240
                  </div>
                )}
              </section>

              <section className="v2-card details-card input-group">
                <label htmlFor="ed-tags">
                  <span>{t("upload.details.tag")}</span>
                  <span className={`tag-count num${allTags.length >= 10 ? ' is-full' : ''}`}>
                    {!fromStories ? t('upload.details.tagCountRequired', { n: allTags.length }) : t('upload.details.tagCount', { n: allTags.length })}
                  </span>
                </label>
                <input id="ed-tags" type="text" value={tagsInputValue} onChange={handleTagChange} />

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
                      title={index < autoTags.length ? t('upload.details.addedAutomatically') : undefined}
                    >
                      {index < autoTags.length && <Icon name="groups" size={14} />}
                      {item}
                    </span>
                  ))}</span>
                </div>
              </section>

              {/* Hidden, not removed, for someone with no Hive account. Community is a
                  Hive category, and Rewards, Beneficiaries and Remix all divide a payout
                  that an off-chain post does not have. Showing them would ask the user to
                  configure things that cannot apply, and quietly imply their post earns.
                  They come back by themselves once the user graduates. */}
              {!incubationHandle && (
              <section className="details-options">
                <div className="v2-eyebrow">{t('upload.review.publishSettings')}</div>
                <div className="advance-option">
                  {!fromStories && (
                    <OptTile
                      className="community-tile"
                      icon="groups"
                      tone="cyan"
                      on
                      picker
                      onClick={openCommunityModal}
                      label={t('upload.details.community.label')}
                      info={t('upload.details.community.info')}
                      hint={t('upload.details.community.hint')}
                      control={chevron}
                      value={(
                        <div className="tile-value community-value">
                          {community
                            ? (community === "hive-181335"
                              ? <div className="wrap"><AccountImg account="hive-181335" alt="" /><span>Threespeak</span></div>
                              : <div className="wrap"><AccountImg account={community.name} alt="" /><span>{community.title}</span></div>)
                            : <span>{t('upload.details.community.select')}</span>}
                        </div>
                      )}
                    />
                  )}
                  <OptTile
                    icon="payments"
                    tone="accent"
                    on={rewardChoice !== 'decline'}
                    picker
                    onClick={() => setRewardsOpen(true)}
                    label={t('upload.details.rewards.label')}
                    info={t('upload.details.rewards.info')}
                    hint={t('upload.details.rewards.hint')}
                    control={chevron}
                    value={<div className="tile-value">{t(REWARD_LABELS[rewardChoice] || REWARD_LABELS.default)}</div>}
                  />
                  <OptTile
                    icon="call_split"
                    tone="accent"
                    on={list.length > 0}
                    picker
                    onClick={toggleBeneficiaryModal}
                    label={t('upload.details.beneficiaries.label')}
                    info={t('upload.details.beneficiaries.info')}
                    hint={t('upload.details.beneficiaries.hint')}
                    control={chevron}
                    value={(
                      <div className="tile-value">{list.length > 0
                        ? t('upload.details.beneficiaries.accounts', { count: list.length })
                        : t('upload.details.beneficiaries.none')}</div>
                    )}
                  />
                  <OptTile
                    icon="content_cut"
                    tone="cyan"
                    on={isRemix || reusable}
                    onClick={() => { if (!isRemix) setReusable(!reusable); }}
                    label={t('upload.details.remix.label')}
                    info={t('upload.details.remix.info')}
                    hint={t('upload.details.remix.hint')}
                    control={tileSwitch(isRemix ? true : reusable, setReusable, t('upload.details.remix.label'), isRemix)}
                  />
                  <OptTile
                    icon="explicit"
                    tone="accent"
                    on={!!isNsfw}
                    onClick={() => setIsNsfw(!isNsfw)}
                    label={t('upload.details.nsfw.label')}
                    info={<Trans i18nKey="upload.details.nsfw.info" components={{ code: <code /> }} />}
                    hint={t('upload.details.nsfw.hint')}
                    control={tileSwitch(isNsfw, setIsNsfw, t('upload.details.nsfw.label'))}
                  />
                  {/* Regular videos only: a short is a reply, not a post, so there
                      is nothing to put on a blog. */}
                  {!fromStories && (
                    <OptTile
                      icon="article"
                      tone="cyan"
                      on={!!addToBlog}
                      onClick={() => setAddToBlog(!addToBlog)}
                      label={t('upload.details.addToBlog.label')}
                      info={t('upload.details.addToBlog.info')}
                      hint={t('upload.details.addToBlog.hint')}
                      control={tileSwitch(addToBlog, setAddToBlog, t('upload.details.addToBlog.label'))}
                    />
                  )}
                  {/* Shorts and stories never carry ads, so there is nothing to switch. */}
                  {accountAdsOn && !fromStories && (
                    <OptTile
                      icon="ads_click"
                      tone="accent"
                      on={!!videoAdsEnabled}
                      onClick={() => setVideoAdsEnabled(!videoAdsEnabled)}
                      label={t('upload.details.ads.label')}
                      info={t('upload.details.ads.info')}
                      hint={videoAdsEnabled ? t('upload.details.ads.hintOn') : t('upload.details.ads.hintOff')}
                      control={tileSwitch(videoAdsEnabled, setVideoAdsEnabled, t('upload.details.ads.label'))}
                    />
                  )}
                  {accountAdsOn && accountRollsOn && videoAdsEnabled && !fromStories && (
                    <OptTile
                      icon="smart_display"
                      tone="accent"
                      on={!!videoRollsEnabled}
                      onClick={() => setVideoRollsEnabled(!videoRollsEnabled)}
                      label={t('upload.details.rolls.label')}
                      info={t('upload.details.rolls.info')}
                      hint={videoRollsEnabled ? t('upload.details.rolls.hintOn') : t('upload.details.rolls.hintOff')}
                      control={tileSwitch(videoRollsEnabled, setVideoRollsEnabled, t('upload.details.rolls.label'))}
                    />
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
                    <OptTile
                      icon="lock"
                      tone="cyan"
                      on={!!gated}
                      onClick={() => setGated(!gated)}
                      label={t('upload.details.gated.label')}
                      info={<Trans i18nKey="upload.details.gated.info" components={{ b: <strong /> }} />}
                      hint={gated && gatedAllowlist.length
                        ? t('upload.details.gated.withGuests', { count: gatedAllowlist.length })
                        : t('upload.details.gated.hint')}
                      control={tileSwitch(gated, setGated, t('upload.details.gated.label'))}
                    />
                  )}
                  {/* 🔐 Guest list. Named accounts watch without needing Pro, which
                      is what makes this usable for sending a video to specific
                      people. Stored on our servers only — never in the Hive post,
                      so the recipient list is not published on-chain. */}
                  {!fromStories && gated && isPro && isTestUser(user) && (
                    <div
                      className="beneficiary-wrap opt-tile guest-tile tone-cyan is-on is-clickable"
                      role="button"
                      tabIndex={0}
                      onClick={() => setGuestsOpen(true)}
                      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setGuestsOpen(true); } }}
                    >
                      <div className="guest-tile__head">
                        <Icon name="group" size={20} />
                        <b>{t('upload.details.guests.title')}</b>
                        <span className="num">{gatedAllowlist.length}</span>
                      </div>
                      {gatedAllowlist.length > 0 && (
                        <div className="gated-guests__chips">
                          {gatedAllowlist.map((name) => <span className="gated-guests__chip" key={name}>@{name}</span>)}
                        </div>
                      )}
                      <span className="guest-tile__note">{t('upload.details.guests.note')}</span>
                    </div>
                  )}
                  {/* Not offered for shorts: the Overview trailer frame is 16:9. */}
                  {!fromStories && (
                    <OptTile
                      icon="play_circle"
                      tone="cyan"
                      on={!!isChannelTrailer}
                      onClick={() => setIsChannelTrailer(!isChannelTrailer)}
                      label={t('upload.details.trailer.label')}
                      info={<Trans i18nKey="upload.details.trailer.info" components={{ b: <strong /> }} />}
                      hint={t('upload.details.trailer.hint')}
                      control={tileSwitch(isChannelTrailer, setIsChannelTrailer, t('upload.details.trailer.label'))}
                    />
                  )}
                  {/* Schedule — only for regular videos, not shorts. When on, the post
                      is queued on the checker backend and broadcast at the chosen time
                      by @threespeak (the user grants that posting auth once). The
                      picker lives in a sheet so the tile stays the size of its
                      neighbours instead of growing an input inline. */}
                  {!fromStories && (
                    <OptTile
                      className="schedule-tile"
                      icon="event"
                      tone="cyan"
                      on={!!isScheduled}
                      onClick={openSchedule}
                      label={t('upload.details.schedule.label')}
                      info={t('upload.details.schedule.info')}
                      hint={isScheduled && scheduleDateTime
                        ? new Date(scheduleDateTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                        : t('upload.details.schedule.immediately')}
                      control={tileSwitch(isScheduled, () => openSchedule(), t('upload.details.schedule.label'))}
                      extra={isScheduled && (
                        <button type="button" className="schedule-tile__change" onClick={(e) => { e.stopPropagation(); setScheduleDraft(scheduleDateTime || ''); setScheduleOpen(true); }}>
                          <Icon name="edit_calendar" size={16} />
                          {t('upload.details.schedule.changeTime')}
                        </button>
                      )}
                    />
                  )}
                </div>
              </section>
              )}
            </div>

            {/* Side column (21c): the thumbnail as it will show, the background
                upload, and the way back to change the picture. */}
            <aside className="embed-details-aside">
              <div className="v2-card details-preview">
                <div className={`details-preview__thumb v2-thumb${fromStories ? ' is-portrait' : ''}`}>
                  {poster && <img src={poster} alt="" />}
                </div>
                <div className="details-preview__body">
                  <b className="details-preview__title">{title || pageTitle}</b>
                  <EmbedUploadProgressBar compact />
                  <Button variant="secondary" size={40} icon="image" onClick={() => navigate('/embed-studio/thumbnail')}>
                    {t('upload.steps.chooseThumbnail')}
                  </Button>
                </div>
              </div>
            </aside>
          </div>

          <SettingSheet title={t('upload.details.rewards.label')} open={rewardsOpen} onClose={() => setRewardsOpen(false)}>
            <div className="option-sheet" role="radiogroup" aria-label={t('upload.details.rewards.label')}>
              {[
                { value: 'default', label: t('upload.details.rewards.default'), hint: t('upload.details.rewards.defaultHint') },
                { value: 'powerup', label: t('upload.details.rewards.powerup'), hint: t('upload.details.rewards.powerupHint') },
                { value: 'decline', label: t('upload.details.rewards.decline'), hint: t('upload.details.rewards.declineHint') },
              ].map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  role="radio"
                  aria-checked={rewardChoice === opt.value}
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
                  className="v2-input"
                  value={allowlistDraft}
                  placeholder={t('upload.details.guests.placeholder')}
                  aria-label={t('upload.details.guests.title')}
                  onChange={(e) => setAllowlistDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAllowlistNames(); } }}
                />
                <Button variant="primary" size={40} icon="person_add" onClick={addAllowlistNames} disabled={allowlistChecking} loading={allowlistChecking}>
                  {allowlistChecking ? t('upload.details.guests.checking') : t('common.actions.add')}
                </Button>
              </div>
              {gatedAllowlist.length > 0 && (
                <div className="gated-guests__chips">
                  {gatedAllowlist.map((name) => (
                    <span className="gated-guests__chip" key={name}>
                      @{name}
                      <IconButton
                        icon="close"
                        size={24}
                        variant="ghost"
                        label={t('upload.details.guests.remove', { name })}
                        onClick={() => setGatedAllowlist(gatedAllowlist.filter((n) => n !== name))}
                      />
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
                  <ScheduleCalendar
                    value={scheduleDraft}
                    min={minFormatted}
                    max={maxFormatted}
                    onChange={setScheduleDraft}
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

          <StepActions placement="bottom" {...actions} />
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
