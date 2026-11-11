import React, { useRef, useState, useEffect, useMemo } from 'react'
import "../legacy-studio/VideoUploadStep1.scss"
import { generateVideoThumbnailsAt } from "../../utils/videoThumbnails";
import { toastIn } from '../../utils/toast';
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { useNavigate } from 'react-router-dom';
import { getCurrentProvider, Providers } from '../../hive-api/aioha';
import { hasThreespeakPostingAuth, addThreespeakToPostingAuth } from '../../utils/postingAuthority';
import { useAppStore } from '../../lib/store';
import { canUseUploadFaults, getUploadFaults, setUploadFaults, initUploadFaults } from '../../utils/uploadFaults';
import { checkPostingRc } from '../../utils/rcCheck';
import RcInsufficientModal from './RcInsufficientModal';
import useCanImportVideos from '../../hooks/useCanImportVideos';
import StepActions from './StepActions';
import { StepProgress } from '../legacy-studio/StepProgress';
import EmbedUploadProgressBar from './EmbedUploadProgressBar';
import { Button, Icon, SettingRow, StatusPill, Toggle } from '../v2/ui';
import { SHORTS_MAX_DURATION_SEC, shortsMaxDurationLabel, cameraRecordEnabledFor, VIDEO_IMPORT_ENABLED, FEATURE_EDITOR, storiesEnabledFor } from '../../utils/config';
import { isChromium } from '../../utils/browser';
import { useTranslation, Trans } from 'react-i18next';

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

function EmbedVideoUploadStep1() {
  const { t } = useTranslation();
  const {
    setVideoDuration,
    videoFile,
    setVideoFile,
    setPrevVideoFile,
    setGeneratedThumbnail,
    setVideoMode,
    clearVideoSelection,
    fromStories,
    isStory,
    setIsStory,
    generatedThumbnail,
    pickFirstThumbnail,
    user,
    step,
  } = useEmbedUpload()

  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [previewError, setPreviewError] = useState(false)
  // The last file refused here (not a video, too big, a Short too long or not
  // vertical). The toast says it once; this keeps it beside the picker, as a
  // check row (design 35b), until a file is taken.
  const [rejected, setRejected] = useState('')
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  // @threespeak posting gate: embed posts are broadcast by @threespeak, which
  // requires the user to have granted @threespeak posting authority before they
  // can pick a file (applies to every aioha login).
  const [needsAuth, setNeedsAuth] = useState(false)
  const [authChecking, setAuthChecking] = useState(true)
  const [authorizing, setAuthorizing] = useState(false)
  // RC gate: a Hive post costs Resource Credits, which a low-Hive-Power account
  // may not have. Check before any upload so the user doesn't upload a whole
  // video only to fail at broadcast. (RC is charged to the post author — the
  // user — even though @threespeak signs the broadcast.)
  const [rcStatus, setRcStatus] = useState(null)
  const [rcChecking, setRcChecking] = useState(false)
  const [rcModalOpen, setRcModalOpen] = useState(false)
  const rcInsufficient = rcStatus ? rcStatus.ok === false : false
  const navigate = useNavigate()
  const canImport = useCanImportVideos(VIDEO_IMPORT_ENABLED ? user : null, fromStories ? 'shorts' : 'videos')

  // Upload fault injection — badadib only. These failure modes (a carrier eating
  // PATCH, a middlebox black-holing a POST) cannot be reproduced on a healthy
  // connection, so they get simulated on demand instead.
  const faultUser = useAppStore((st) => st.user)
  const faultsAllowed = canUseUploadFaults(faultUser)
  const [faults, setFaults] = useState(() => getUploadFaults())
  const applyFault = (patch) => setFaults(setUploadFaults(faultUser, patch))
  // Re-arm after a reload: the flags survive in sessionStorage, but the XHR patch
  // has to be re-installed on the fresh page — otherwise a reload mid-upload
  // silently disarms the harness and the test quietly passes for the wrong reason.
  useEffect(() => { initUploadFaults(faultUser) }, [faultUser])

  const runRcCheck = async ({ openModalIfLow = false } = {}) => {
    if (!user) return null;
    setRcChecking(true);
    try {
      const result = await checkPostingRc(user);
      setRcStatus(result);
      if (result.ok === false && openModalIfLow) setRcModalOpen(true);
      if (result.ok === true) setRcModalOpen(false);
      return result;
    } catch {
      // Fail open — never block the upload on our own check failing.
      const open = { ok: true, unknown: true };
      setRcStatus(open);
      return open;
    } finally {
      setRcChecking(false);
    }
  };

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 767px)');
    const onChange = (e) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  // Every aioha login (Keychain/HiveAuth/PeakVault/Ledger/HiveSigner) posts via
  // @threespeak now, so they all need the @threespeak posting-authority grant
  // before picking a file. ButrAuth (getCurrentProvider() === null) keeps its own
  // cookie-authenticated path → no gate.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getCurrentProvider() || !user) {
        if (!cancelled) { setNeedsAuth(false); setAuthChecking(false); }
        return;
      }
      try {
        const ok = await hasThreespeakPostingAuth(user);
        if (!cancelled) setNeedsAuth(!ok);
      } catch {
        if (!cancelled) setNeedsAuth(true); // fail closed — require authorization
      } finally {
        if (!cancelled) setAuthChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // RC pre-flight — runs once we know the user. Pops the explainer modal if low.
  useEffect(() => {
    let cancelled = false;
    if (!user) { setRcStatus(null); return; }
    (async () => {
      setRcChecking(true);
      try {
        const result = await checkPostingRc(user);
        if (cancelled) return;
        setRcStatus(result);
        if (result.ok === false) setRcModalOpen(true);
      } catch {
        if (!cancelled) setRcStatus({ ok: true, unknown: true }); // fail open
      } finally {
        if (!cancelled) setRcChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleAuthorize = async () => {
    setAuthorizing(true);
    // Open the popup synchronously within the click so it isn't blocked; for
    // HiveSigner the account_update2 is signed in this window.
    const signWindow = getCurrentProvider() === Providers.HiveSigner ? window.open('', '_blank') : null;
    try {
      await addThreespeakToPostingAuth(user, { signWindow }); // HiveSigner signs in the popup; others sign with the active key
      setNeedsAuth(false);
      toast.success(t('upload.select.authorized'));
    } catch (e) {
      try { signWindow?.close(); } catch { /* ignore */ }
      toast.error(e?.message || t('upload.select.authorizationFailed'));
    } finally {
      setAuthorizing(false);
    }
  };

  const videoInputRef = useRef(null);
  const videoPreviewUrl = useMemo(() => videoFile ? URL.createObjectURL(videoFile) : null, [videoFile]);

  // Reset the "can't preview" flag whenever a new file is chosen.
  useEffect(() => { setPreviewError(false); }, [videoPreviewUrl]);

  // Best-effort metadata read. Some files (e.g. a metadata-less .MOV) never fire
  // loadedmetadata or error in some browsers, so we also time out — and we resolve
  // (never reject) with NaN/0 so a failure here can't block the upload.
  const getVideoMetadata = (file) => {
    return new Promise((resolve) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      let settled = false;
      const finish = (meta) => {
        if (settled) return;
        settled = true;
        try { window.URL.revokeObjectURL(video.src); } catch { /* ignore */ }
        resolve(meta);
      };
      video.onloadedmetadata = () => finish({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      video.onerror = () => finish({ duration: NaN, width: 0, height: 0 });
      setTimeout(() => finish({ duration: NaN, width: 0, height: 0 }), 8000);
      video.src = URL.createObjectURL(file);
    });
  };

  const handleVideoSelect = (e) => {
    processVideoFile(e.target.files[0]);
  };

  const processVideoFile = async (file) => {
    if (!file) return;

    // Don't let a video be picked while RC is too low to ever publish it.
    if (rcInsufficient) {
      setRcModalOpen(true);
      return;
    }

    if (!file.type.startsWith("video/")) {
      toast.error(t("upload.select.invalidVideo"));
      setRejected(t("upload.select.invalidVideo"));
      return;
    }

    // Embed uploads are capped at 5GB (enforced server-side too).
    const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("upload.select.tooLarge"));
      setRejected(t("upload.select.tooLarge"));
      return;
    }

    setLoading(true);

    try {
      const { duration, width, height } = await getVideoMetadata(file);
      const hasDuration = isFinite(duration) && duration > 0;
      const hasDimensions = width > 0 && height > 0;

      // Shorts checks only run when we could actually read the metadata — a
      // metadata-less file shouldn't be blocked here (the server validates too).
      if (fromStories && hasDuration && duration > SHORTS_MAX_DURATION_SEC) {
        toast.error(t('upload.select.shortTooLong', { max: shortsMaxDurationLabel(), seconds: Math.round(duration) }));
        setRejected(t('upload.select.shortTooLong', { max: shortsMaxDurationLabel(), seconds: Math.round(duration) }));
        setLoading(false);
        return;
      }
      if (fromStories && hasDimensions && width > height) {
        toast.error(t("upload.select.shortNotVertical"));
        setRejected(t("upload.select.shortNotVertical"));
        setLoading(false);
        return;
      }

      // Generate thumbnails — best effort. Some files (e.g. metadata-less .MOV)
      // can't be decoded for frames in the browser; that must NOT block the
      // upload — the user can add a custom thumbnail on the next step.
      let thumbs = [];
      try {
        thumbs = await generateVideoThumbnailsAt(file);
      } catch (thumbErr) {
        console.warn("Thumbnail generation failed; continuing without a preview", thumbErr);
        toast(t("upload.select.thumbnailGenFailed"));
      }
      // A different file replacing one picked earlier (now also reachable with
      // Back from the later steps): drop what belonged to the old one, i.e. the
      // chosen thumbnail (it would stay selected over the new frames), the
      // timeline times and any background upload of the old bytes. Only here,
      // once the new file passed every check, so a rejected pick keeps the old one.
      if (videoFile && videoFile !== file) clearVideoSelection();
      setGeneratedThumbnail(thumbs);
      setRejected('');

      // Store video for next step
      setVideoFile(file);
      setPrevVideoFile(file);
      setVideoDuration(hasDuration ? duration : 0);
      setVideoMode(fromStories ? 'shorts' : 'longform');

      // A story goes straight to Post: the first frame is its cover and the
      // caption is optional, so there is nothing for the two steps between to ask.
      if (isStory && pickFirstThumbnail(thumbs)) navigate('/embed-studio/preview');

    } catch (err) {
      console.error(err);
      toast.error(err.message || t("upload.select.processFailed"));
    }

    setLoading(false);
  };

  const uploadVideo = () => {
    if (!videoFile) {
      toast.error(t("upload.select.selectFirst"));
      return;
    }

    if (isStory && pickFirstThumbnail(generatedThumbnail)) {
      navigate("/embed-studio/preview");
      return;
    }
    navigate("/embed-studio/thumbnail");
  };

  // Rendered above and below the picker from this one object. No Back: this is
  // the first step. Proceed waits for a processed file.
  const actions = {
    primary: [{
      key: 'proceed',
      label: t("upload.select.proceed"),
      onClick: uploadVideo,
      disabled: !videoFile || loading,
      title: !videoFile ? t("upload.select.selectFirst") : undefined,
    }],
  };

  // The file input itself is hidden (display:none); these real buttons open it,
  // so the picker is reachable from the keyboard too.
  const openPicker = () => videoInputRef.current?.click();

  // Drag & drop onto the upload box (gated behind the same @threespeak auth check)
  const handleDragOver = (e) => {
    if (needsAuth || rcInsufficient || loading) return;
    e.preventDefault();
    setDragging(true);
  };
  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragging(false);
  };
  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (needsAuth || rcInsufficient || loading) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) processVideoFile(file);
  };

  // Spinner while a check runs. role=status so assistive tech (and the tests)
  // can tell "still checking" from "ready".
  const spinner = (
    <span className="upload-select__spinner" role="status" aria-label={t('upload.rc.checking')}>
      <Icon name="progress_activity" size={28} className="v2-spin" />
    </span>
  );

  return (
    <div className="upload-select">
      <StepProgress step={step} short={fromStories} actions={actions} />
      {/* Hidden until the background upload runs (it starts on Details), so it
          only shows after coming Back here, where it keeps going. */}
      <EmbedUploadProgressBar />

      {/* A short can go out as a 24h story instead: it leads the shorts feed and
          reaches followers as a notification, and the creator can still keep it. */}
      {fromStories && storiesEnabledFor(user) && (
        <div className={`v2-card upload-story-card${isStory ? ' is-on' : ''}`}>
          <SettingRow
            icon={<Icon name="history_toggle_off" size={20} className="upload-story-card__icon" />}
            title={t("upload.select.asStory")}
            sub={t("upload.select.asStoryHint")}
            control={<Toggle checked={!!isStory} onChange={setIsStory} label={t("upload.select.asStory")} />}
          />
        </div>
      )}

      <div className="upload-step">
        <div
          className={`file-upload${dragging ? ' is-dragging' : ''}${videoFile ? ' has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept="video/mp4, video/x-m4v, video/*, .mkv, .flv, .mov, .avi, .wmv"
            ref={videoInputRef}
            onChange={handleVideoSelect}
            className="input"
            id="embed-video-upload"
            tabIndex={-1}
            disabled={needsAuth || rcInsufficient}
          />

          {videoFile ? (
            // Picked: the clip on the left, what happens next on the right.
            <div className="upload-picked">
              {videoPreviewUrl && (
                <div className="video-preview-container">
                  {previewError ? (
                    <div className="video-preview-fallback">
                      <Icon name="info" size={20} className="video-preview-fallback-icon" />
                      <p>{t("upload.preview.cannotPreviewHevc")}</p>
                    </div>
                  ) : (
                    <video
                      src={videoPreviewUrl}
                      controls
                      muted
                      playsInline
                      className="video-preview"
                      onError={() => setPreviewError(true)}
                    />
                  )}
                </div>
              )}

              <div className='isselected-wrap'>
                <span className="upload-picked__check"><Icon name="check" size={24} /></span>
                <h3 className="upload-picked__title">{t("upload.select.selected")}</h3>
                <p className="video-preview-name num">{videoFile.name}</p>
                <div className="upload-info-note">
                  <Icon name="cloud_upload" size={18} />
                  <span>{t("upload.select.backgroundInfo")}</span>
                </div>

                {faultsAllowed && (
                  <div className="upload-fault-panel v2-admin" onClick={(e) => e.stopPropagation()}>
                    <b className="upload-fault-panel__title"><Icon name="science" size={18} /> Upload test mode</b>

                    <label className="v2-check upload-fault-panel__row">
                      <input
                        type="checkbox"
                        checked={!!faults.blockPatch}
                        onChange={(e) => applyFault({ blockPatch: e.target.checked })}
                      />
                      <span>Block resumable (PATCH) — simulates the carrier that eats TUS. Expect: watchdog trips, &ldquo;switching to a more compatible method&rdquo;, chunked fallback takes over.</span>
                    </label>

                    <label className="v2-check upload-fault-panel__row">
                      <input
                        type="checkbox"
                        checked={!!faults.blackholeChunks}
                        onChange={(e) => applyFault({ blackholeChunks: e.target.checked })}
                      />
                      <span>Black-hole the chunk protocol — the reported bug. Swallows the session <em>create</em> POST too, not just the data chunks. Expect: &ldquo;Starting upload…&rdquo;, ~50s of &ldquo;Connection unstable — retrying… (n/3)&rdquo;, then it gives up on chunks and <strong>the single-request last resort takes over and finishes the upload</strong>. Before the fix, create had no deadline at all and the bar sat at 0% forever with nothing on screen.</span>
                    </label>

                    <label className="v2-check upload-fault-panel__row">
                      <input
                        type="checkbox"
                        checked={!!faults.blackholeSimple}
                        onChange={(e) => applyFault({ blackholeSimple: e.target.checked })}
                      />
                      <span>Black-hole the single-request fallback too — total blackout, every transport dead. Only useful with the box above ticked. Expect: all three tiers tried in order, then a clean <em>Request timed out</em> failure. Nothing can upload under this by construction; it verifies we FAIL LOUDLY rather than hang.</span>
                    </label>

                    <label className="v2-check upload-fault-panel__row">
                      <input
                        type="checkbox"
                        checked={faults.chunkFailRate > 0}
                        onChange={(e) => applyFault({ chunkFailRate: e.target.checked ? 0.5 : 0 })}
                      />
                      <span>Flaky link — drop 50% of chunks. Expect: retries + /status resync, upload still completes.</span>
                    </label>

                    <label className="v2-check upload-fault-panel__row">
                      <input
                        type="checkbox"
                        checked={!!faults.forceWeakLink}
                        onChange={(e) => applyFault({ forceWeakLink: e.target.checked })}
                      />
                      <span>Weak-link profile — pretend the phone reports a thin uplink. Expect: the chunked path switches to <strong>256KB chunks across 5 parallel POSTs</strong> instead of one at a time (watch the Network tab: five <code>/upload/chunk</code> in flight together). This does <em>not</em> slow anything down; it selects the profile that a real mobile link would get, which is otherwise unreachable on a healthy line. Tick <em>Flaky link</em> too to also exercise retry + resync with several workers running.</span>
                    </label>

                    <p className="upload-fault-panel__note">
                      Tick the first two together to reproduce the exact user report — it should now RECOVER via the
                      single-request tier instead of hanging. Add the third for a total blackout. Clears when the tab closes.
                      <br />
                      These simulate 100% loss, not a slow link: under a black-hole nothing gets through no matter how
                      long you wait, so &ldquo;upload anyway, just slowly&rdquo; is only meaningful for the flaky/throttled cases below.
                      <br />
                      For a genuinely SLOW upload (the 408s), DevTools throttling does <strong>not</strong> work —
                      browser throttling is request-level, so the request body already went out at full speed.
                      Throttle the socket instead: <code>sudo scripts/throttle-upload.sh on 50kbit</code> on your own machine.
                    </p>
                  </div>
                )}

                {/* The way on sits right beside Replace, not only in the action rows
                    above and below: with a file picked, this box is where people look,
                    and "Replace Video" alone read as the only thing to do next. */}
                <div className="button-group button-group--row">
                  <Button variant="secondary" size={44} icon="swap_horiz" onClick={openPicker}>
                    {t("upload.select.replace")}
                  </Button>
                  {/* Shorts: open the picked clip in the shorts editor, already on
                      the timeline. A render posted from there replaces this file. */}
                  {fromStories && FEATURE_EDITOR && (
                    <Button
                      variant="secondary"
                      size={44}
                      icon="content_cut"
                      onClick={() => window.dispatchEvent(new CustomEvent('open-shorts-editor', { detail: { file: videoFile } }))}
                    >
                      {t("upload.select.editVideo")}
                    </Button>
                  )}
                  <Button variant="inverse" size={44} next onClick={uploadVideo}>
                    {t("upload.select.proceed")}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="content">
              {(authChecking || rcChecking) ? (
                spinner
              ) : rcInsufficient ? (
                // Not enough Resource Credits to publish: say so, and why on request.
                <div className="threespeak-auth-gate is-blocked">
                  <span className="upload-gate__icon is-accent"><Icon name="bolt" size={24} fill /></span>
                  <b className="upload-gate__title">{t('upload.select.iconTitleNoRc')}</b>
                  <p className="formats">
                    <Trans i18nKey="upload.select.noRc" components={{ b: <strong /> }} />
                  </p>
                  <Button variant="secondary" size={44} icon="help" onClick={() => setRcModalOpen(true)}>
                    {t("upload.select.whyCantUpload")}
                  </Button>
                </div>
              ) : needsAuth ? (
                // 35b: authorize @threespeak first, once.
                <div className="threespeak-auth-gate">
                  <span className="upload-gate__icon"><Icon name="verified_user" size={24} /></span>
                  <b className="upload-gate__title">{t('upload.select.iconTitleNeedsAuth')}</b>
                  <p className="formats">
                    <Trans i18nKey="upload.select.needsAuth" components={{ b: <strong /> }} />
                  </p>
                  <Button variant="cyan" size={48} trailing="key" className="is-next upload-gate__btn" onClick={handleAuthorize} disabled={authorizing} loading={authorizing}>
                    {authorizing ? t('upload.select.authorizing') : t('upload.select.authorize')}
                  </Button>
                </div>
              ) : (
                <>
                  <div
                    className="icon"
                    onClick={() => {
                      if (rcInsufficient) { setRcModalOpen(true); return; }
                      if (!needsAuth) videoInputRef.current?.click();
                    }}
                    title={t('upload.select.iconTitle')}
                  >
                    <Icon name="upload" size={32} />
                  </div>

                  <div className="text">
                    <h3 className="title">{isMobile ? t("upload.select.pickOrRecord") : t("upload.select.chooseFile")}</h3>
                    {!isMobile && (
                      <p className="formats drag-hint">{t("upload.select.dragHint")}</p>
                    )}
                    <p className="formats">
                      {t("upload.select.formats")}
                    </p>
                  </div>

                  {/* What the file has to be (35b checks): the Shorts rules, and the
                      last file refused here. */}
                  {(fromStories || rejected) && (
                    <div className="upload-checks">
                      {fromStories && (
                        <div className="upload-check is-info">
                          <Icon name="screen_rotation" size={18} />
                          <span className="formats short-hint">{t("upload.select.shortHint", { max: shortsMaxDurationLabel() })}</span>
                        </div>
                      )}
                      {rejected && (
                        <div className="upload-check is-error">
                          <Icon name="error" size={18} />
                          <span>{rejected}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {loading ? spinner : (cameraRecordEnabledFor(faultUser) && isMobile && isChromium()) ? (
                    // Mobile + Chromium only (Web Speech API): record straight from
                    // the front camera with a voice-driven teleprompter, or pick a file.
                    <div className="button-group">
                      <Button variant="inverse" size={48} icon="video_library" onClick={openPicker}>
                        {t("upload.select.selectVideo")}
                      </Button>
                      <Button
                        variant="secondary"
                        size={48}
                        icon="videocam"
                        onClick={() => navigate(fromStories ? `/embed-studio/record?from=${isStory ? 'story' : 'stories'}` : '/embed-studio/record')}
                        trailing={<StatusPill tone="cyan">{t("upload.select.beta")}</StatusPill>}
                      >
                        {t("upload.select.selfieTeleprompter")}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="inverse" size={48} icon="video_library" onClick={openPicker}>
                      {isMobile ? t("upload.select.selectVideo") : t("upload.select.browseFiles")}
                    </Button>
                  )}

                  {/* ▶️ Import from the creator's own verified YouTube / TikTok. The mode
                      makes the import page offer only what fits this uploader:
                      Shorts → YouTube Shorts + TikTok, videos → YouTube videos + streams.
                      Only shown with a verified link to a platform that fits the mode. */}
                  {VIDEO_IMPORT_ENABLED && canImport && (
                    <Button
                      variant="secondary"
                      size={44}
                      icon="download"
                      className="yt-import-entry"
                      onClick={() => navigate(`/youtube-import?mode=${fromStories ? 'shorts' : 'videos'}`)}
                    >
                      {t('ytimport.entry')}
                    </Button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <StepActions placement="bottom" {...actions} />

      <RcInsufficientModal
        isOpen={rcModalOpen}
        status={rcStatus}
        rechecking={rcChecking}
        onClose={() => setRcModalOpen(false)}
        onRecheck={() => runRcCheck({ openModalIfLow: true })}
      />
    </div>
  );
}

export default EmbedVideoUploadStep1;
