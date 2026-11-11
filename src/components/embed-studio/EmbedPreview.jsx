import React from "react";
import "./EmbedPreview.scss";
import { Navigate, useNavigate } from "react-router-dom";
import { StepProgress } from "../legacy-studio/StepProgress";
import EmbedUploadProgressBar from "./EmbedUploadProgressBar";
import StepActions from "./StepActions";
import { useEmbedUpload } from "../../context/EmbedUploadContext";
import { enforceLockedBeneficiaries } from "../../utils/beneficiaries";
import { remixChainAuthors, remixChainMarkdown } from "../../utils/remixChain";
import { soundCreditsMarkdown, soundAuthorsOf } from '../../utils/soundCredits';
import BlogContent from "../playVideo/BlogContent";
import EmbedPreviewPlayer from "./EmbedPreviewPlayer";
import PromoteModal from "../Promote/PromoteModal";
import { Button, Icon, Progress, StatusPill, StepList } from "../v2/ui";
import { useReviewModal } from "../../lib/reviewStore";
import UploadGate from "../ads/UploadGate";
import { fetchUploadGateAd, confirmUploadGatePost, gateSessionId } from "../../lib/uploadGate";
import { useTranslation, Trans } from "react-i18next";
import AccountImg from "../HiveAvatar/AccountImg";
import { timelineMeta, applyTimelineToDescription } from "../../utils/videoTimeline";
import { getFollowers } from "../../hive-api/api";
import { useStoryStreak, STREAK_MIN } from "../../lib/stories";

// Same cap as a short's description on the details step.
const STORY_CAPTION_MAX = 240;

function EmbedPreview() {
  const { t } = useTranslation();
  const {
    step,
    title,
    description,
    tagsPreview,
    videoFile,
    prevVideoFile,
    selectedThumbnail,
    editedThumbnail,
    uploading,
    completed,
    uploadProgress,
    statusText,
    statusMessages,
    publishToEmbed,
    user,
    fromStories,
    isStory,
    setDescription,
    startEarlyUpload,
    community,
    beneficiaries,
    declineRewards,
    rewardPowerup,
    reusable,
    originalAuthor,
    originalPermlink,
    remixChain,
    musicCredits,
    isNsfw,
    publishedPermlink,
    isPremium,
    setStep,
    chapters,
    timelineLinks,
    videoDuration,
  } = useEmbedUpload();

  // Last step: 5 for a long-form video (after Timeline), 4 for a short.
  React.useEffect(() => {
    if (!completed && !uploading) setStep(fromStories ? 4 : 5);
  }, [fromStories]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = useNavigate();

  // A story arrives here straight from picking or recording the clip (no
  // thumbnail or details step), so this screen is where its caption is typed and
  // where the creator sees what the story gets them.
  const quickStory = isStory && fromStories;
  // The details step normally starts the background upload; a story skips it.
  React.useEffect(() => {
    if (quickStory) startEarlyUpload();
  }, [quickStory, startEarlyUpload]);
  const [followers, setFollowers] = React.useState(null);
  React.useEffect(() => {
    if (!quickStory || !user) return undefined;
    let alive = true;
    getFollowers(user).then((r) => { if (alive && r) setFollowers(Number(r.follower_count) || 0); });
    return () => { alive = false; };
  }, [quickStory, user]);
  const { streak, postedToday } = useStoryStreak(quickStory ? user : null);
  // What this story makes the streak: today already counted, or one day more.
  const nextStreak = postedToday ? streak : streak + 1;

  const [promoteOpen, setPromoteOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const publishingRef = React.useRef(false);

  /* The pre-upload spot, if this account is being shown one.
   *
   * Asked for ONCE when the preview mounts, not when the button is pressed: a request
   * in the click handler puts a network round trip between the press and anything
   * happening, and the button that publishes your video is the last place to add a
   * pause of unknown length.
   *
   * Everything here fails open. No ad, a request that errors, a spot that will not
   * play — all of them post immediately. It is somebody's finished video; an ad problem
   * of ours must never become their problem.
   */
  /* The spot this visit owes, if any. Fetched on arrival but NOT played: knowing
   * whether a gate applies is what lets the page show the right button, and somebody
   * with no gate must never be shown one. Nothing plays until they ask for it.
   *
   * Fetching early is safe now that a session costs nothing until it is watched — the
   * checker's frequency cap counts completed impressions, not requests — and the
   * session lives four hours, far longer than anybody spends on this screen. */
  const [pendingAd, setPendingAd] = React.useState(null);
  const [gateAd, setGateAd] = React.useState(null);
  const [gateWatched, setGateWatched] = React.useState(false);
  const gateSidRef = React.useRef(null);

  React.useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    fetchUploadGateAd(user)
      .then((ad) => { if (alive && ad) setPendingAd(ad); })
      .catch(() => { /* fail open: no gate, Post Video stays live */ });
    return () => { alive = false; };
  }, [user]);

  /* Watched. The button unlocks; it does NOT publish on its own.
   *
   * They pressed "Watch ad to publish", which is consent to watch, not consent to
   * publish. Publishing on the spot's own end would take the last look away from
   * somebody whose finished video is about to go out under their name. */
  const onGateWatched = React.useCallback((played) => {
    /* Only a spot that actually played is an impression.
     *
     * 🚨 The gate unlocks either way — a spot that will not load must never cost
     * somebody their upload — but the session id is what later tells the checker to
     * complete the impression, bill the advertiser and pay the creator. Keeping it
     * after a bail would charge for a spot that never rendered a frame.
     *
     * A ref, not state: nothing renders from it, and setting state here only to clear
     * it later is a render loop waiting to happen. */
    if (played) gateSidRef.current = gateSessionId(gateAd);
    setGateWatched(true);
    setGateAd(null);
    setPendingAd(null);
  }, [gateAd]);

  /* Completed on the POST, not on the watch: the checker will not take the claim
   * without a video to point at, so it has to wait for one to exist. */
  React.useEffect(() => {
    if (!gateSidRef.current || !publishedPermlink) return;
    confirmUploadGatePost(gateSidRef.current, publishedPermlink);
    gateSidRef.current = null;   // once only
  }, [publishedPermlink]);
  // On the success screen we offer feedback (area:'upload'), rather than opening
  // the popup automatically — see the "Give feedback" button below.
  const openReview = useReviewModal((s) => s.openReview);

  // `completed` first: once the upload has finished this screen is the
  // destination, not a half-filled form to bounce out of. Without that, anything
  // clearing the draft while this is mounted redirects the user away from their
  // own success screen.
  if (!completed && ((!description && !quickStory) || (!fromStories && !title) || (quickStory && !videoFile && !prevVideoFile))) {
    return <Navigate to="/embed-studio" replace />;
  }

  // --- Derived display values for the publish-settings panel ---
  const isDefaultCommunity = !community || community === "hive-181335";
  const communityDisplay = isDefaultCommunity
    ? { name: "hive-181335", title: "Threespeak" }
    : { name: community.name, title: community.title || community.name };

  const payoutLabel = declineRewards
    ? t("upload.review.payoutDeclined")
    : rewardPowerup
      ? t("upload.review.payoutPowerup")
      : t("upload.review.payoutDefault");

  const isRemix = !!(originalAuthor && originalPermlink);
  const remixLabel = isRemix ? t("upload.review.remixOn") : reusable ? t("upload.review.remixAllowed") : t("upload.review.remixNotAllowed");

  // The body the viewer will actually read = description (+ remix credit). The
  // published body also prepends the embed URL and appends a "Watch on 3Speak"
  // footer, but BlogContent strips both on render — so rendering this through the
  // same BlogContent the watch page uses gives a faithful preview. The player is
  // shown separately above, standing in for that leading embed URL.
  // The chapter and link sections the Timeline step writes into the description
  // on publish (same call as publishToEmbed), so what is shown here is what gets
  // posted, except that the chapter times link to the post once it exists.
  const shownTimeline = fromStories ? {} : timelineMeta(chapters, timelineLinks, { duration: Number(videoDuration) || 0 });
  const shownDescription = fromStories
    ? description
    : applyTimelineToDescription(description, shownTimeline);
  const previewBody = isRemix
    ? `${shownDescription}\n\n---\n*Based on a video by [@${originalAuthor}](${
        fromStories
          ? `${window.location.origin}/shorts?v=${originalAuthor}/${originalPermlink}`
          : `${window.location.origin}/@${originalAuthor}/${originalPermlink}`
      })*${remixChainMarkdown(remixChain)}${soundCreditsMarkdown(musicCredits)}`
    : `${shownDescription}${soundCreditsMarkdown(musicCredits)}`;

  // `beneficiaries` is an array initially but the beneficiary modal stores it as
  // a JSON string — normalise both shapes before rendering.
  let beneList = [];
  try {
    beneList = Array.isArray(beneficiaries)
      ? beneficiaries
      : beneficiaries
        ? JSON.parse(beneficiaries)
        : [];
  } catch {
    beneList = [];
  }
  // Show what publishing will actually set: the chosen list plus the locked
  // splits (3Speak fund, encoder, remix author), via the same rule publish uses.
  // Declining rewards publishes with no beneficiaries at all.
  const userBeneficiaries = (() => {
    if (declineRewards) return [];
    const beneMap = new Map();
    for (const b of beneList) {
      if (b && b.account) beneMap.set(b.account, Math.max(beneMap.get(b.account) || 0, Number(b.weight) || 0));
    }
    enforceLockedBeneficiaries(beneMap, {
      isPremium,
      username: user,
      includeEncoder: true,
      originalAuthor: originalAuthor && originalPermlink ? originalAuthor : null,
      remixAuthors: isRemix ? remixChainAuthors(remixChain, user) : [],
      soundAuthors: soundAuthorsOf(musicCredits, user),
    });
    return [...beneMap.entries()]
      .map(([account, weight]) => ({ account, weight }))
      .sort((a, b) => b.weight - a.weight);
  })();


  /* The spot plays only when they ask for it, on its own button.
   *
   * ⚠️ It used to play on arrival at the preview. That is the screen where people catch
   * their own mistakes — a wrong thumbnail, a typo in the title — and go back to fix
   * them, so an ad on arrival charged them for every one of those trips and punished
   * exactly the care we want them to take.
   *
   * Nothing here fails the upload. If the fetch found no spot there is no gate at all
   * and Post Video is live from the start. */
  const gateSatisfied = gateWatched || !pendingAd;

  const startGateAd = () => {
    if (!pendingAd || gateAd) return;
    setGateAd(pendingAd);
  };

  const handlePostVideo = async () => {
    // Belt and braces: the button is disabled while a spot is outstanding, but a
    // disabled button is a presentation detail and this is the publish path.
    if (!gateSatisfied) return;
    // There are two Post buttons (above and below the preview), and publish
    // awaits a creator-settings read before it flips `uploading`; a second
    // press in that window would start a second publish. One at a time.
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    try {
      await publishToEmbed();
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  // Rendered above and below the preview from this one object. Long-form: Back
  // is the Timeline step and "Edit post" jumps to Details; a short has no
  // Timeline, so "Edit post" is its Back.
  const editPost = { key: "edit", label: t("upload.review.editPost"), onClick: () => navigate('/embed-studio/details') };
  const actions = {
    back: quickStory
      ? { label: t('common.actions.back'), onClick: () => navigate('/embed-studio?from=story') }
      : fromStories
        ? editPost
        : { label: t("upload.review.backToTimeline"), onClick: () => navigate('/embed-studio/timeline') },
    secondary: quickStory
      ? [{ key: "more", label: t("upload.story.moreOptions"), onClick: () => navigate('/embed-studio/thumbnail') }]
      : fromStories ? [] : [editPost],
    // Two steps, shown as two buttons, so what is being asked for is never in
    // doubt: watch the spot, then publish. The publish button stays visible and
    // disabled rather than hidden, so the destination is obvious from the start.
    primary: [
      !gateSatisfied && { key: "watch", label: t("upload.review.watchAdToPublish"), onClick: startGateAd, icon: "play_circle" },
      {
        key: "post",
        icon: "send",
        label: fromStories ? t(isStory ? 'upload.review.postStory' : 'upload.review.postShort') : t('upload.review.postVideo'),
        onClick: handlePostVideo,
        disabled: !gateSatisfied || publishing,
        title: gateSatisfied ? undefined : t('upload.review.watchSponsorFirst'),
      },
    ],
  };


  // The publishing steps (31b, a StepList), read off the status line the
  // publish flow writes: uploading, the thumbnail, posting to Hive, linking.
  const PUBLISH_PHASES = [
    { label: t('upload.publishing.uploadingVideo'), match: [] },
    { label: t('upload.publishing.uploadingThumbnail'), match: [t('upload.publishing.uploadingThumbnail')] },
    {
      label: t('upload.publishing.postingToHive'),
      match: [
        t('upload.publishing.postingToHive'), t('upload.publishing.findingSnapsContainer'),
        t('upload.publishing.checkingAuthority'), t('upload.publishing.authorizingStatus'),
        t('upload.publishing.savingScheduled'),
      ],
    },
    { label: t('upload.publishing.linkingEmbed'), match: [t('upload.publishing.linkingEmbed'), t('upload.publishing.completed')] },
  ];
  const phaseIdx = Math.max(0, PUBLISH_PHASES.findIndex((ph) => ph.match.includes(statusText)));
  const publishSteps = PUBLISH_PHASES.map((ph, i) => ({
    label: ph.label,
    state: i < phaseIdx ? 'done' : i === phaseIdx ? 'current' : 'next',
  }));

  // A publish that failed leaves its error as the last log line: say so above
  // the review, which is where the creator lands again (31b, failed upload).
  const lastMessage = statusMessages[statusMessages.length - 1];
  const failedMessage = !uploading && !completed && lastMessage?.type === 'error' ? lastMessage.message : '';

  const logIcon = (msg, i) => {
    if (msg.type === 'success') return { name: 'check_circle', tone: 'is-cyan' };
    if (msg.type === 'error') return { name: 'error', tone: 'is-accent' };
    if (msg.type === 'warning') return { name: 'warning', tone: 'is-accent' };
    if (uploading && i === statusMessages.length - 1) return { name: 'progress_activity', tone: 'is-current' };
    return { name: 'check', tone: 'is-done' };
  };

  const pageTitle = fromStories ? t(isStory ? "upload.page.shareStory" : "upload.page.shareShort") : t("upload.page.shareVideo");

  return (
    <>
      {gateAd && <UploadGate ad={gateAd} onWatched={onGateWatched} />}
      {/* PREVIEW & PUBLISH BUTTON */}
      {!uploading && !completed && (
        <div className="studio-main-container embed-wizard">
          <div className="studio-page-header">
            <h1>{pageTitle}</h1>
          </div>

          {quickStory
            ? <div className="ep-story-actions"><StepActions placement="top" {...actions} /></div>
            : <StepProgress step={step} short={fromStories} actions={actions} />}
          <EmbedUploadProgressBar />

          <div className="studio-page-content">
            {failedMessage && (
              <div className="v2-failure ep-failed" role="alert">
                <div className="ep-failed__head">
                  <Icon name="error" size={24} />
                  <b>{failedMessage}</b>
                </div>
                <p className="ep-failed__help">
                  <Trans
                    i18nKey="upload.publishing.support"
                    components={{ discordLink: <a href="https://discord.com/invite/NSFS2VGj83" target="_blank" rel="noopener noreferrer" /> }}
                  />
                </p>
              </div>
            )}

            <div className={`ep-review${fromStories ? ' ep-review--portrait' : ''}`}>
              {/* POST PREVIEW — rendered like the final post: player (standing in
                  for the leading embed URL) → title → description body. */}
              <div className="ep-post">
                {/* One card wrapping the player + description so the video reads
                    as part of the post body, not a detached element. */}
                <div className="ep-post-card v2-card">
                  <EmbedPreviewPlayer
                    file={prevVideoFile}
                    poster={editedThumbnail || selectedThumbnail}
                    portrait={fromStories}
                    chapters={shownTimeline.chapters}
                    links={shownTimeline.links}
                    duration={Number(videoDuration) || 0}
                  />

                  {title && <h2 className="ep-title">{title}</h2>}

                  {quickStory ? (
                    <div className="ep-body ep-story">
                      <textarea
                        className="ep-story__caption v2-input is-area"
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, STORY_CAPTION_MAX))}
                        placeholder={t("upload.story.captionPlaceholder")}
                        aria-label={t("upload.story.captionPlaceholder")}
                        rows={3}
                      />
                      <p className="ep-story__reach">
                        <Icon name="notifications_active" size={18} />
                        {followers != null
                          ? t("upload.story.reach", { count: followers })
                          : t("upload.story.reachNoCount")}
                      </p>
                      <p className="ep-story__streak">
                        <Icon name="local_fire_department" size={28} fill />
                        <b>
                          {postedToday && streak >= STREAK_MIN
                            ? t("upload.story.streakOn", { count: streak })
                            : nextStreak >= STREAK_MIN
                              ? t("upload.story.streakNext", { count: nextStreak })
                              : t("upload.story.streakStart")}
                        </b>
                      </p>
                    </div>
                  ) : (
                    <div className="ep-body">
                      <BlogContent description={previewBody} alwaysExpanded />
                    </div>
                  )}
                </div>
              </div>

              {/* Everything that isn't the post body (35d: Publish settings). */}
              <aside className="ep-settings v2-card">
                <div className="ep-settings__head">
                  <b className="ep-settings__title">{t("upload.review.publishSettings")}</b>
                  {!quickStory && (
                    <Button variant="ghost" size={32} icon="edit" onClick={() => navigate('/embed-studio/details')}>
                      {t("common.actions.edit")}
                    </Button>
                  )}
                </div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><Icon name="groups" size={18} /></span>
                  <span className="ep-setting__label">{t("upload.details.community.label")}</span>
                  <span className="ep-setting__value ep-setting__value--community">
                    <AccountImg account={communityDisplay.name} alt="" />
                    {communityDisplay.title}
                  </span>
                </div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><Icon name="payments" size={18} /></span>
                  <span className="ep-setting__label">{t("upload.review.payout")}</span>
                  <span className="ep-setting__value">{payoutLabel}</span>
                </div>

                <div className="ep-setting ep-setting--top">
                  <span className="ep-setting__icon"><Icon name="call_split" size={18} /></span>
                  <span className="ep-setting__label">{t("upload.details.beneficiaries.label")}</span>
                  <span className="ep-setting__value">
                    {userBeneficiaries.length === 0 ? (
                      <span className="ep-muted">{t("upload.details.beneficiaries.none")}</span>
                    ) : (
                      <span className="ep-benes">
                        {userBeneficiaries.map((b, i) => (
                          <span className="ep-bene" key={i}>@{b.account} · <span className="num">{(Number(b.weight) / 100).toFixed(0)}%</span></span>
                        ))}
                      </span>
                    )}
                  </span>
                </div>

                <div className="ep-setting ep-setting--top">
                  <span className="ep-setting__icon"><Icon name="tag" size={18} /></span>
                  <span className="ep-setting__label">{t("upload.review.tags")}</span>
                  <span className="ep-setting__value">
                    {tagsPreview && tagsPreview.length > 0 ? (
                      <span className="ep-tags">
                        {tagsPreview.map((tag, index) => (
                          <span className="ep-tag" key={index}>{tag}</span>
                        ))}
                      </span>
                    ) : <span className="ep-muted">{t("upload.details.beneficiaries.none")}</span>}
                  </span>
                </div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><Icon name="content_cut" size={18} /></span>
                  <span className="ep-setting__label">{t("upload.review.remix")}</span>
                  <span className="ep-setting__value">{remixLabel}</span>
                </div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><Icon name="explicit" size={18} /></span>
                  <span className="ep-setting__label">{t("upload.review.nsfw")}</span>
                  <span className="ep-setting__value">
                    {isNsfw ? <StatusPill tone="accent">{t("common.actions.yes")}</StatusPill> : <span className="ep-muted">{t("common.actions.no")}</span>}
                  </span>
                </div>

                {/* Watch-ad-to-publish (35d): the sponsor spot this account owes,
                    shown before the button that plays it. */}
                {!gateSatisfied && (
                  <div className="ep-gate">
                    <div className="ep-gate__thumb v2-thumb r12">
                      <span className="v2-media-pill is-tl">AD</span>
                    </div>
                    <span className="ep-gate__text">{t("upload.review.watchSponsorFirst")}</span>
                  </div>
                )}
              </aside>
            </div>
            <StepActions placement="bottom" {...actions} />
          </div>
        </div>
      )}

      {/* STATUS CONTAINER — during upload & Hive posting (31b + 35d) */}
      {uploading && (
        <div className="studio-main-container embed-wizard ep-status">
          <section className="v2-card ep-publishing">
            <div className="wizard-head is-cyan">
              <h2 className="wizard-head__title">
                {fromStories ? t(isStory ? 'upload.publishing.titleStory' : 'upload.publishing.titleShort') : t('upload.publishing.titleVideo')}
              </h2>
              <p className="wizard-head__sub">{t("upload.publishing.subtitle")}</p>
            </div>

            <div className="ep-publishing__progress">
              <div className="ep-publishing__progress-head">
                <span className="ep-publishing__status">{statusText || t('upload.publishing.starting')}</span>
                <span className="num">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} tone="cyan" label={statusText || t('upload.publishing.starting')} />
            </div>

            <StepList items={publishSteps} />

            <div className="v2-banner is-info ep-publishing__stay">
              <Icon name="info" size={18} className="v2-banner__icon" />
              <div className="v2-banner__body"><b>{t("upload.publishing.stayOnPage")}</b></div>
            </div>

            <div className="activity-log">
              <div className="v2-eyebrow">{t("upload.publishing.activityLog")}</div>
              <div className="activity-log-content">
                {statusMessages.map((msg, i) => {
                  const ic = logIcon(msg, i);
                  return (
                    <div key={i} className={`activity-item ${msg.type === 'error' ? 'error' : msg.type === 'success' ? 'success' : 'info'}`}>
                      <Icon name={ic.name} size={16} className={`activity-icon ${ic.tone}${ic.name === 'progress_activity' ? ' v2-spin' : ''}`} />
                      <p className="activity-message">{msg.message}</p>
                    </div>
                  );
                })}
              </div>
              <div className="discord">
                <Trans
                  i18nKey="upload.publishing.support"
                  components={{ discordLink: <a href="https://discord.com/invite/NSFS2VGj83" target="_blank" rel="noopener noreferrer" className="discord-link" /> }}
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {/* COMPLETED (35d: done, with feedback) */}
      {completed && (
        <div className="studio-main-container embed-wizard ep-status">
          <section className="v2-success ep-done">
            <span className="ep-done__icon"><Icon name="check" size={32} /></span>
            <h3 className="ep-done__title">{t("upload.done.title")}</h3>
            <p className="ep-done__text">
              {fromStories
                ? t(isStory ? 'upload.done.storyPublished' : 'upload.done.shortPublished')
                : (
                  <Trans i18nKey="upload.done.videoPublished" components={{ br: <br /> }} />
                )}
            </p>

            <div className="ep-done__actions">
              {!fromStories && publishedPermlink && (
                <Button variant="secondary" size={48} trailing="campaign" className="is-next promote-success-btn" onClick={() => setPromoteOpen(true)}>
                  {t("upload.done.promote")}
                </Button>
              )}
              <Button
                variant="inverse"
                size={48}
                // Just navigate. The reset used to run 50ms later, which sent the
                // user straight back to the uploader instead: ProfilePage is lazy,
                // so this component is still mounted while its chunk loads, and
                // clearing title/description tripped the redirect guard above —
                // with `replace`, so it overwrote the pending /profile navigation.
                // EmbedStudioPage already resets on mount when `completed`, which
                // is the right moment for it anyway.
                onClick={() => navigate("/profile")}
                className="is-next profile-btn"
                trailing="arrow_forward"
              >
                {t("upload.done.goToProfile").replace(/\s*→\s*$/, '')}
              </Button>
            </div>

            <div className="ep-done__feedback">
              <div className="v2-eyebrow">{t("upload.done.feedback")}</div>
              <Button
                variant="secondary"
                size={44}
                icon="sentiment_satisfied"
                className="review-success-btn"
                onClick={() => openReview({ area: 'upload', username: user || null, permlink: publishedPermlink || null })}
              >
                {t("upload.done.feedback")}
              </Button>
            </div>
          </section>
        </div>
      )}

      <PromoteModal
        open={promoteOpen}
        onClose={() => setPromoteOpen(false)}
        author={user}
        permlink={publishedPermlink}
        promotedUntil={null}
      />
    </>
  );
}

export default EmbedPreview;
