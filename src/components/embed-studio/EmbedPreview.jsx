import React from "react";
import "../legacy-studio/Preview.scss";
import "./EmbedPreview.scss";
import { Navigate, useNavigate } from "react-router-dom";
import { CheckCircle, Upload, FileText, Info, Users, Coins, Gift, Repeat2, Tag, ShieldAlert } from "lucide-react";
import { StepProgress } from "../legacy-studio/StepProgress";
import EmbedUploadProgressBar from "./EmbedUploadProgressBar";
import { useEmbedUpload } from "../../context/EmbedUploadContext";
import "../legacy-studio/VideoUploadStatus.scss";
import BlogContent from "../playVideo/BlogContent";
import EmbedPreviewPlayer from "./EmbedPreviewPlayer";
import PromoteModal from "../Promote/PromoteModal";
import { Rocket, Star } from "lucide-react";
import { useReviewModal } from "../../lib/reviewStore";
import UploadGate from "../ads/UploadGate";
import { fetchUploadGateAd, confirmUploadGatePost, gateSessionId } from "../../lib/uploadGate";

function EmbedPreview() {
  const {
    step,
    title,
    description,
    tagsPreview,
    videoFile,
    prevVideoFile,
    selectedThumbnail,
    uploading, setUploading,
    completed,
    uploadProgress,
    statusText,
    statusMessages,
    publishToEmbed,
    user,
    fromStories,
    community,
    beneficiaries,
    declineRewards,
    rewardPowerup,
    reusable,
    originalAuthor,
    originalPermlink,
    isNsfw,
    publishedPermlink,
  } = useEmbedUpload();

  const navigate = useNavigate();
  const [promoteOpen, setPromoteOpen] = React.useState(false);

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
  if (!completed && (!description || (!fromStories && !title))) {
    return <Navigate to="/embed-studio" replace />;
  }

  // --- Derived display values for the publish-settings panel ---
  const isDefaultCommunity = !community || community === "hive-181335";
  const communityDisplay = isDefaultCommunity
    ? { name: "hive-181335", title: "Threespeak" }
    : { name: community.name, title: community.title || community.name };

  const payoutLabel = declineRewards
    ? "Declined (rewards burned)"
    : rewardPowerup
      ? "100% Hive Power"
      : "50% HBD / 50% HP";

  const isRemix = !!(originalAuthor && originalPermlink);
  const remixLabel = isRemix ? "On (this is a remix)" : reusable ? "Allowed" : "Not allowed";

  // The body the viewer will actually read = description (+ remix credit). The
  // published body also prepends the embed URL and appends a "Watch on 3Speak"
  // footer, but BlogContent strips both on render — so rendering this through the
  // same BlogContent the watch page uses gives a faithful preview. The player is
  // shown separately above, standing in for that leading embed URL.
  const previewBody = isRemix
    ? `${description}\n\n---\n*Based on a video by [@${originalAuthor}](${
        fromStories
          ? `${window.location.origin}/shorts?v=${originalAuthor}/${originalPermlink}`
          : `${window.location.origin}/@${originalAuthor}/${originalPermlink}`
      })*`
    : description;

  // `beneficiaries` is an array initially but the beneficiary modal stores it as
  // a JSON string — normalise both shapes before rendering.
  let beneList = [];
  try {
    beneList = Array.isArray(beneficiaries)
      ? beneficiaries
      : beneficiaries
        ? JSON.parse(beneficiaries)
        : [];
  } catch (_) {
    beneList = [];
  }
  const userBeneficiaries = beneList.filter((b) => b && b.account);


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

  const handlePostVideo = () => {
    // Belt and braces: the button is disabled while a spot is outstanding, but a
    // disabled button is a presentation detail and this is the publish path.
    if (!gateSatisfied) return;
    publishToEmbed();
  };


  return (
    <>
      {gateAd && <UploadGate ad={gateAd} onWatched={onGateWatched} />}
      {/* PREVIEW & PUBLISH BUTTON */}
      {!uploading && !completed && (
        <div className="studio-main-container">
          <div className="studio-page-header">
            <h1>{fromStories ? "Share a Short" : "Share a Video"}</h1>
          </div>

          <StepProgress step={step} />
          <EmbedUploadProgressBar />

          <div className="studio-page-content">
            <div className="ep-review">
              {/* POST PREVIEW — rendered like the final post: player (standing in
                  for the leading embed URL) → title → description body. */}
              <div className="ep-post">
                {title && <h2 className="ep-title">{title}</h2>}

                {/* One card wrapping the player + description so the video reads
                    as part of the post body, not a detached element. */}
                <div className="ep-post-card">
                  <EmbedPreviewPlayer
                    file={prevVideoFile}
                    poster={selectedThumbnail}
                    portrait={fromStories}
                  />

                  <div className="ep-body">
                    <BlogContent description={previewBody} alwaysExpanded />
                  </div>
                </div>
              </div>

              {/* Everything that isn't the post body, shown below it. */}
              <div className="ep-settings">
                <div className="ep-settings__head">Publish settings</div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><Users size={18} /></span>
                  <span className="ep-setting__label">Community</span>
                  <span className="ep-setting__value ep-setting__value--community">
                    <img src={`https://images.hive.blog/u/${communityDisplay.name}/avatar/small`} alt="" />
                    {communityDisplay.title}
                  </span>
                </div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><Coins size={18} /></span>
                  <span className="ep-setting__label">Payout</span>
                  <span className="ep-setting__value">{payoutLabel}</span>
                </div>

                <div className="ep-setting ep-setting--top">
                  <span className="ep-setting__icon"><Gift size={18} /></span>
                  <span className="ep-setting__label">Beneficiaries</span>
                  <span className="ep-setting__value">
                    {userBeneficiaries.length === 0 ? (
                      <span className="ep-muted">None</span>
                    ) : (
                      <span className="ep-benes">
                        {userBeneficiaries.map((b, i) => (
                          <span className="ep-bene" key={i}>@{b.account} · {(Number(b.weight) / 100).toFixed(0)}%</span>
                        ))}
                      </span>
                    )}
                  </span>
                </div>

                <div className="ep-setting ep-setting--top">
                  <span className="ep-setting__icon"><Tag size={18} /></span>
                  <span className="ep-setting__label">Tags</span>
                  <span className="ep-setting__value">
                    {tagsPreview && tagsPreview.length > 0 ? (
                      <span className="ep-tags">
                        {tagsPreview.map((tag, index) => (
                          <span className="ep-tag" key={index}>{tag}</span>
                        ))}
                      </span>
                    ) : <span className="ep-muted">None</span>}
                  </span>
                </div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><Repeat2 size={18} /></span>
                  <span className="ep-setting__label">Remix / clip</span>
                  <span className="ep-setting__value">{remixLabel}</span>
                </div>

                <div className="ep-setting">
                  <span className="ep-setting__icon"><ShieldAlert size={18} /></span>
                  <span className="ep-setting__label">Adult / NSFW</span>
                  <span className="ep-setting__value">
                    {isNsfw ? <span className="ep-nsfw-on">Yes</span> : <span className="ep-muted">No</span>}
                  </span>
                </div>
              </div>

              <div className="ep-actions">
                <button
                  type="button"
                  className="ep-btn ep-btn--secondary"
                  onClick={() => navigate('/embed-studio/details')}
                >
                  Edit Post
                </button>
                {/* Two steps, shown as two buttons, so what is being asked for is never
                    in doubt: watch the spot, then publish. The publish button stays
                    visible and disabled rather than hidden, so the destination is
                    obvious from the start. */}
                {!gateSatisfied && (
                  <button
                    type="button"
                    className="ep-btn ep-btn--primary"
                    onClick={startGateAd}
                  >
                    Watch ad to publish
                  </button>
                )}
                <button
                  type="button"
                  className="ep-btn ep-btn--primary"
                  onClick={handlePostVideo}
                  disabled={!gateSatisfied}
                  title={gateSatisfied ? undefined : 'Watch the sponsor message first'}
                >
                  {fromStories ? 'Post Short' : 'Post Video'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STATUS CONTAINER — during upload & Hive posting */}
      {uploading && (
        <div className="status-container">
          <div className="upload-status-container embed-status">
            <div className="upload-icon">
              <Upload size={30} strokeWidth={1.5} />
            </div>

            <h2 className="upload-title">
              {fromStories ? 'Publishing Short' : 'Publishing Video'}
            </h2>
            <p className="upload-subtitle">Please wait while we process your content...</p>

            <div className="progress-section">
              <div className="progress-bar-container">
                <div className="progress-bar">
                  <div
                    className="progress-fill embed-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
              <div className="progress-header">
                <span className="progress-label">{statusText || 'Starting...'}</span>
                <span className="progress-percentage">{uploadProgress}%</span>
              </div>
            </div>

            <div className="caution-wrap">
              Please stay on this page until publishing is finished.
            </div>

            <div className="activity-log">
              <div className="activity-log-header">
                <div className="wrapin">
                  <FileText size={18} />
                  <span>Activity Log</span>
                </div>
                <div className="discord">
                  For Support reach out to us on{" "}
                  <a href="https://discord.com/invite/NSFS2VGj83" target="_blank" rel="noopener noreferrer" className="discord-link">Discord</a>
                </div>
              </div>
              <div className="activity-log-content">
                {statusMessages.map((msg, i) => (
                  <div key={i} className={`activity-item ${msg.type === 'error' ? 'error' : msg.type === 'success' ? 'success' : 'info'}`}>
                    <div className="activity-icon">
                      {msg.type === 'success' ? <CheckCircle size={20} /> : <Info size={20} />}
                    </div>
                    <div className="activity-details">
                      <p className="activity-message">{msg.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* COMPLETED */}
      {completed && (
        <div className="success-container">
          <div className="success-box">
            <div className="success-icon">
              <CheckCircle size={34} strokeWidth={2} />
            </div>
            <h3>Upload Finished!</h3>
            <p>
              {fromStories
                ? 'Your short has been published on 3Speak. It will take around 5 minutes to show up on your profile.'
                : (
                  <>
                    Your video has been published!<br />
                    It&apos;s now encoding in the background, which can take a few minutes.
                  </>
                )}
            </p>

            <div className="success-actions">
              {!fromStories && publishedPermlink && (
                <button className="promote-success-btn" onClick={() => setPromoteOpen(true)}>
                  <Rocket size={18} /> Promote this video
                </button>
              )}
              <button
                // Just navigate. The reset used to run 50ms later, which sent the
                // user straight back to the uploader instead: ProfilePage is lazy,
                // so this component is still mounted while its chunk loads, and
                // clearing title/description tripped the redirect guard above —
                // with `replace`, so it overwrote the pending /profile navigation.
                // EmbedStudioPage already resets on mount when `completed`, which
                // is the right moment for it anyway.
                onClick={() => navigate("/profile")}
                className="profile-btn"
              >
                Go To My Profile →
              </button>
            </div>

            <button
              className="review-success-btn"
              onClick={() => openReview({ area: 'upload', username: user || null, permlink: publishedPermlink || null })}
            >
              <Star size={18} /> How was your upload</button>
          </div>
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
