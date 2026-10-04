import React, { useRef, useState, useEffect, useMemo } from 'react'
import { Upload, FileVideo, Video } from "lucide-react";
import { FaFileImport } from "react-icons/fa";
import "../legacy-studio/VideoUploadStep1.scss"
import { generateVideoThumbnails } from "../../utils/videoThumbnails";
import { toastIn } from '../../utils/toast';
import Arrow from "./../../../public/images/arrow.png"
import { useEmbedUpload } from '../../context/EmbedUploadContext';
import { useNavigate } from 'react-router-dom';
import { TailChase } from 'ldrs/react'
import 'ldrs/react/TailChase.css'
import { getCurrentProvider, Providers } from '../../hive-api/aioha';
import { hasThreespeakPostingAuth, addThreespeakToPostingAuth } from '../../utils/postingAuthority';
import { useAppStore } from '../../lib/store';
import { canUseUploadFaults, getUploadFaults, setUploadFaults, initUploadFaults } from '../../utils/uploadFaults';
import { checkPostingRc } from '../../utils/rcCheck';
import RcInsufficientModal from './RcInsufficientModal';
import { SHORTS_MAX_DURATION_SEC, shortsMaxDurationLabel, cameraRecordEnabledFor } from '../../utils/config';
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
    fromStories,
    user,
  } = useEmbedUpload()

  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [previewError, setPreviewError] = useState(false)
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
      return;
    }

    // Embed uploads are capped at 5GB (enforced server-side too).
    const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
    if (file.size > MAX_FILE_SIZE) {
      toast.error(t("upload.select.tooLarge"));
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
        setLoading(false);
        return;
      }
      if (fromStories && hasDimensions && width > height) {
        toast.error(t("upload.select.shortNotVertical"));
        setLoading(false);
        return;
      }

      // Generate thumbnails — best effort. Some files (e.g. metadata-less .MOV)
      // can't be decoded for frames in the browser; that must NOT block the
      // upload — the user can add a custom thumbnail on the next step.
      let thumbs = [];
      try {
        thumbs = await generateVideoThumbnails(file, 2, "url");
      } catch (thumbErr) {
        console.warn("Thumbnail generation failed; continuing without a preview", thumbErr);
        toast(t("upload.select.thumbnailGenFailed"));
      }
      setGeneratedThumbnail(thumbs);

      // Store video for next step
      setVideoFile(file);
      setPrevVideoFile(file);
      setVideoDuration(hasDuration ? duration : 0);
      setVideoMode(fromStories ? 'shorts' : 'longform');

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

    navigate("/embed-studio/thumbnail");
  };

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

  return (
    <div>
      <div className="upload-step">

        <div className="content">
          <div
            className={`file-upload${dragging ? ' is-dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="content">
              <div
                className="icon"
                onClick={() => {
                  if (rcInsufficient) { setRcModalOpen(true); return; }
                  if (!needsAuth) videoInputRef.current?.click();
                }}
                style={{ cursor: (needsAuth || rcInsufficient) ? 'not-allowed' : 'pointer' }}
                title={
                  rcInsufficient
                    ? t('upload.select.iconTitleNoRc')
                    : needsAuth
                      ? t('upload.select.iconTitleNeedsAuth')
                      : t('upload.select.iconTitle')
                }
              >
                <Upload className="w-8 h-8" />
              </div>

              {!videoFile && !needsAuth && !rcInsufficient && (
                <div className="text">
                  <h3 className="title">{isMobile ? t("upload.select.pickOrRecord") : t("upload.select.chooseFile")}</h3>
                  {!isMobile && (
                    <p className="formats drag-hint">{t("upload.select.dragHint")}</p>
                  )}
                  <p className="formats">
                    {t("upload.select.formats")}
                  </p>
                  {fromStories && (
                    <p className="formats short-hint">
                      {t("upload.select.shortHint", { max: shortsMaxDurationLabel() })}
                    </p>
                  )}
                </div>
              )}

              {videoFile && (
                <div className='isselected-wrap'>
                  <span>{t("upload.select.selected")}</span>
                  <div className="upload-info-note">
                    {t("upload.select.backgroundInfo")}
                  </div>
                  {faultsAllowed && (
                    <div
                      className="upload-fault-panel"
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        marginTop: '10px', padding: '8px 10px', textAlign: 'left',
                        border: '1px dashed var(--border-light, #888)', borderRadius: '8px',
                        fontSize: '0.78rem', lineHeight: 1.35,
                      }}
                    >
                      <strong style={{ display: 'block', marginBottom: '6px' }}>🧪 Upload test mode</strong>

                      <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '5px' }}>
                        <input
                          type="checkbox"
                          checked={!!faults.blockPatch}
                          onChange={(e) => applyFault({ blockPatch: e.target.checked })}
                        />
                        <span>Block resumable (PATCH) — simulates the carrier that eats TUS. Expect: watchdog trips, &ldquo;switching to a more compatible method&rdquo;, chunked fallback takes over.</span>
                      </label>

                      <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '5px' }}>
                        <input
                          type="checkbox"
                          checked={!!faults.blackholeChunks}
                          onChange={(e) => applyFault({ blackholeChunks: e.target.checked })}
                        />
                        <span>Black-hole the chunk protocol — the reported bug. Swallows the session <em>create</em> POST too, not just the data chunks. Expect: &ldquo;Starting upload…&rdquo;, ~50s of &ldquo;Connection unstable — retrying… (n/3)&rdquo;, then it gives up on chunks and <strong>the single-request last resort takes over and finishes the upload</strong>. Before the fix, create had no deadline at all and the bar sat at 0% forever with nothing on screen.</span>
                      </label>

                      <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '5px' }}>
                        <input
                          type="checkbox"
                          checked={!!faults.blackholeSimple}
                          onChange={(e) => applyFault({ blackholeSimple: e.target.checked })}
                        />
                        <span>Black-hole the single-request fallback too — total blackout, every transport dead. Only useful with the box above ticked. Expect: all three tiers tried in order, then a clean <em>Request timed out</em> failure. Nothing can upload under this by construction; it verifies we FAIL LOUDLY rather than hang.</span>
                      </label>

                      <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer', marginBottom: '5px' }}>
                        <input
                          type="checkbox"
                          checked={faults.chunkFailRate > 0}
                          onChange={(e) => applyFault({ chunkFailRate: e.target.checked ? 0.5 : 0 })}
                        />
                        <span>Flaky link — drop 50% of chunks. Expect: retries + /status resync, upload still completes.</span>
                      </label>

                      <label style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={!!faults.forceWeakLink}
                          onChange={(e) => applyFault({ forceWeakLink: e.target.checked })}
                        />
                        <span>Weak-link profile — pretend the phone reports a thin uplink. Expect: the chunked path switches to <strong>256KB chunks across 5 parallel POSTs</strong> instead of one at a time (watch the Network tab: five <code>/upload/chunk</code> in flight together). This does <em>not</em> slow anything down; it selects the profile that a real mobile link would get, which is otherwise unreachable on a healthy line. Tick <em>Flaky link</em> too to also exercise retry + resync with several workers running.</span>
                      </label>

                      <p style={{ margin: '6px 0 0', opacity: 0.75 }}>
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

                  <img className="arrow-in" src={Arrow} alt="" />
                </div>
              )}

              <input
                type="file"
                accept="video/mp4, video/x-m4v, video/*, .mkv, .flv, .mov, .avi, .wmv"
                ref={videoInputRef}
                onChange={handleVideoSelect}
                className="input"
                id="embed-video-upload"
                disabled={needsAuth || rcInsufficient}
              />

              {(authChecking || rcChecking) && !videoFile ? (
                <TailChase size="30" speed="1.75" color="red" />
              ) : rcInsufficient ? (
                <div className="threespeak-auth-gate">
                  <p className="formats">
                    <Trans i18nKey="upload.select.noRc" components={{ b: <strong /> }} />
                  </p>
                  <button type="button" className="button" onClick={() => setRcModalOpen(true)}>
                    {t("upload.select.whyCantUpload")}
                  </button>
                </div>
              ) : needsAuth ? (
                <div className="threespeak-auth-gate">
                  <p className="formats">
                    <Trans i18nKey="upload.select.needsAuth" components={{ b: <strong /> }} />
                  </p>
                  <button type="button" className="button" onClick={handleAuthorize} disabled={authorizing}>
                    {authorizing ? t('upload.select.authorizing') : t('upload.select.authorize')}
                  </button>
                </div>
              ) : loading ? (
                <TailChase size="30" speed="1.75" color="red" />
              ) : !videoFile ? (
                (cameraRecordEnabledFor(faultUser) && isMobile && isChromium()) ? (
                  // Mobile + Chromium only (Web Speech API): record straight from
                  // the front camera with a voice-driven teleprompter, or pick a file.
                  <div className="button-group">
                    <label htmlFor="embed-video-upload" className="button">
                      {t("upload.select.selectVideo")}
                    </label>
                    <button
                      type="button"
                      className="button button--outline"
                      onClick={() => navigate(fromStories ? '/embed-studio/record?from=stories' : '/embed-studio/record')}
                    >
                      <Video className="w-4 h-4" style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                      {t("upload.select.selfieTeleprompter")}
                      <span className="beta-badge">{t("upload.select.beta")}</span>
                    </button>
                  </div>
                ) : (
                  <label htmlFor="embed-video-upload" className="button">
                    {isMobile ? t("upload.select.selectVideo") : t("upload.select.browseFiles")}
                  </label>
                )
              ) : (
                <div className="button-group">
                  <label onClick={uploadVideo} className="button">
                    {t("upload.select.proceed")}
                  </label>
                  <label htmlFor="embed-video-upload" className="button button--outline">
                    {t("upload.select.replace")}
                  </label>
                </div>
              )}

              {/* ▶️ Import from the creator's own verified YouTube / TikTok. The mode
                  makes the import page offer only what fits this uploader:
                  Shorts → YouTube Shorts + TikTok, videos → YouTube videos + streams. */}
              {!videoFile && !needsAuth && !rcInsufficient && !authChecking && !rcChecking && (
                <button
                  type="button"
                  className="button button--outline yt-import-entry"
                  style={{ marginTop: 12 }}
                  onClick={() => navigate(`/youtube-import?mode=${fromStories ? 'shorts' : 'videos'}`)}
                >
                  <FaFileImport style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                  {t('ytimport.entry')}
                </button>
              )}
            </div>
          </div>
        </div>

        {videoFile && videoPreviewUrl && (
          <div className="video-preview-container">
            {previewError ? (
              <div className="video-preview-fallback">
                <FileVideo className="video-preview-fallback-icon" />
                <p>
                  {t("upload.preview.cannotPreviewHevc")}
                </p>
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
            <p className="video-preview-name">{videoFile.name}</p>
          </div>
        )}

      </div>

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
