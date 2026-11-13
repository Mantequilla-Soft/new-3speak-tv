import { useState, useRef, useCallback, useEffect } from 'react';
import { Button, DockTile, Segmented } from '../v2/ui';
import * as tus from 'tus-js-client';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { EMBED_UPLOAD_URL, EMBED_API_URL, EMBED_API_KEY, SHORTS_MAX_DURATION_SEC, shortsMaxDurationLabel } from '../../utils/config';
import { commentWithAioha, broadcastViaThreespeak, getCurrentProvider, Providers } from '../../hive-api/aioha';
import { hasThreespeakPostingAuth, addThreespeakToPostingAuth } from '../../utils/postingAuthority';
import { useAppStore } from '../../lib/store';
import { oaEnvelope, threespeakVideo, probeVideoOrientation, OA_COMMENT } from '../../utils/openAttribute';
import './ReactVideoModal.scss';

// Every toast from this module is headed "Video"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Video');

/**
 * Inline "React" tab panel — sits inside the comment input container, beside
 * the original (the watch page's player). Lets users record from the webcam or
 * pick a file, add a description, then uploads via TUS and publishes as a
 * comment under the parent post.
 *
 * Design 48b "Post a video reaction" (Record Video / Upload Video, Start
 * Recording, the description, Show in 3Speak Shorts, the @threespeak
 * authorization as a cyan wash) and 22b while recording (the camera in an
 * accent frame with a REC timer, Mic / Camera / Restart tiles, Stop and review).
 */
const fmtClock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function ReactVideoTab({ author, permlink, currentTime, onPosted, onRecordStart }) {
  const { t } = useTranslation();
  const { user } = useAppStore();

  // Source selection
  const [source, setSource] = useState(null); // 'upload' | 'record' | null
  const [videoFile, setVideoFile] = useState(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);

  // Webcam / recording
  const [stream, setStream] = useState(null);
  const [recording, setRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [recordedUrl, setRecordedUrl] = useState(null);
  // "Start Recording" before the camera is open: open it, then start.
  const [autoStart, setAutoStart] = useState(false);
  // Seconds since the recorder started (the REC pill, 22b).
  const [recSeconds, setRecSeconds] = useState(0);
  // Mic / Camera tiles: enable or mute the live tracks.
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  // Description & options
  const [description, setDescription] = useState('');
  const [isShort, setIsShort] = useState(true);

  // Upload state
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [statusText, setStatusText] = useState('');

  // @threespeak posting gate — reactions are broadcast by @threespeak, so the
  // user must have granted @threespeak posting authority (every aioha login;
  // ButrAuth → getCurrentProvider() null → keeps its own cookie path, no gate).
  const [needsAuth, setNeedsAuth] = useState(false);
  const [authorizing, setAuthorizing] = useState(false);

  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const webcamRef = useRef(null);
  const tusUploadRef = useRef(null);
  // Restart: stop the recorder without keeping what it recorded.
  const discardRef = useRef(false);
  // The Mic / Camera / Restart / Stop row, brought into view when recording starts.
  const recRowRef = useRef(null);

  // -- Cleanup helpers --
  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    }
  }, [stream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (stream) stream.getTracks().forEach(track => track.stop());
    };
  }, []);

  // Attach stream to webcam video element
  useEffect(() => {
    if (webcamRef.current && stream) {
      webcamRef.current.srcObject = stream;
    }
  }, [stream]);

  // A new camera starts with the mic and the picture on.
  useEffect(() => {
    if (!stream) return;
    setMicOn(true);
    setCamOn(true);
  }, [stream]);

  // The REC timer runs while the recorder does.
  useEffect(() => {
    if (!recording) return undefined;
    // In the side panel the tab scrolls: keep Stop and review in reach.
    recRowRef.current?.scrollIntoView?.({ block: 'nearest' });
    setRecSeconds(0);
    const started = Date.now();
    const id = setInterval(() => setRecSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(id);
  }, [recording]);

  // Check the @threespeak posting-auth grant for aioha logins (eagerly, so the
  // gate is resolved by the time a video is ready to post).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getCurrentProvider() || !user) { if (!cancelled) setNeedsAuth(false); return; }
      try {
        const ok = await hasThreespeakPostingAuth(user);
        if (!cancelled) setNeedsAuth(!ok);
      } catch {
        if (!cancelled) setNeedsAuth(true); // fail closed — require authorization
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  const handleAuthorize = useCallback(async () => {
    setAuthorizing(true);
    // Open the popup synchronously within the click so it isn't blocked; for
    // HiveSigner the account_update2 is signed in this window.
    const signWindow = getCurrentProvider() === Providers.HiveSigner ? window.open('', '_blank') : null;
    try {
      await addThreespeakToPostingAuth(user, { signWindow });
      setNeedsAuth(false);
      toast.success(t('player.reactionUpload.authorized'));
    } catch (e) {
      try { signWindow?.close(); } catch { /* ignore */ }
      toast.error(e?.message || t('player.reactionUpload.authFailed'));
    } finally {
      setAuthorizing(false);
    }
  }, [user]);

  // Calculate video duration from file
  const calcDuration = useCallback((file) => {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(video.src);
        resolve(video.duration);
      };
      video.onerror = () => resolve(0);
      video.src = URL.createObjectURL(file);
    });
  }, []);

  // -- Upload card click --
  const handleUploadClick = useCallback(() => {
    stopStream();
    setRecordedBlob(null);
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    setRecording(false);
    setSource('upload');
    setTimeout(() => fileInputRef.current?.click(), 0);
  }, [stopStream, recordedUrl]);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setVideoFile(file);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(URL.createObjectURL(file));
    const dur = await calcDuration(file);
    setVideoDuration(dur);
    if (dur > SHORTS_MAX_DURATION_SEC) {
      setIsShort(false);
    } else {
      setIsShort(true);
    }
  }, [videoPreviewUrl, calcDuration]);

  // -- Record card click --
  const handleRecordClick = useCallback(async () => {
    setVideoFile(null);
    if (videoPreviewUrl) { URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(null); }
    setRecordedBlob(null);
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    setSource('record');
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setStream(mediaStream);
    } catch (err) {
      console.error('Webcam access denied:', err);
      toast.error(t('player.reactionUpload.webcamDenied'));
      setAutoStart(false);
      setSource(null);
    }
  }, [videoPreviewUrl, recordedUrl]);

  // The Record Video / Upload Video track (48b). Record shows Start Recording;
  // the camera opens when recording starts. Upload opens the file picker.
  const handleSourceChange = useCallback((next) => {
    if (next === 'upload') { handleUploadClick(); return; }
    if (source === 'record') return;
    setVideoFile(null);
    if (videoPreviewUrl) { URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(null); }
    setSource('record');
  }, [source, videoPreviewUrl, handleUploadClick]);

  const startRecording = useCallback(() => {
    if (!stream) return;
    chunksRef.current = [];
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : '';
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = async () => {
      // Restart: drop this take and record again on the same camera.
      if (discardRef.current) {
        discardRef.current = false;
        chunksRef.current = [];
        setAutoStart(true);
        return;
      }
      const blob = new Blob(chunksRef.current, { type: mimeType || 'video/webm' });
      setRecordedBlob(blob);
      setRecordedUrl(URL.createObjectURL(blob));
      // Convert blob to File for TUS upload
      const file = new File([blob], `reaction-${Date.now()}.webm`, { type: blob.type });
      setVideoFile(file);
      const dur = await calcDuration(file);
      setVideoDuration(dur);
      setIsShort(dur <= SHORTS_MAX_DURATION_SEC);
      // Stop webcam
      stream.getTracks().forEach(track => track.stop());
      setStream(null);
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    onRecordStart?.();
  }, [stream, calcDuration, onRecordStart]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    setRecording(false);
  }, []);

  // Start Recording: on the open camera, or open it first and start once it is live.
  const handleStartClick = useCallback(() => {
    if (stream) { startRecording(); return; }
    setAutoStart(true);
    handleRecordClick();
  }, [stream, startRecording, handleRecordClick]);

  useEffect(() => {
    if (!autoStart || !stream || recording) return;
    setAutoStart(false);
    startRecording();
  }, [autoStart, stream, recording, startRecording]);

  // Restart (22b): while recording, throw the take away and start over; after
  // a take, record a new one.
  const handleRestart = useCallback(() => {
    if (recording) {
      discardRef.current = true;
      stopRecording();
      return;
    }
    setAutoStart(true);
    handleRecordClick();
  }, [recording, stopRecording, handleRecordClick]);

  const toggleMic = useCallback(() => {
    const next = !micOn;
    stream?.getAudioTracks().forEach((track) => { track.enabled = next; });
    setMicOn(next);
  }, [micOn, stream]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    stream?.getVideoTracks().forEach((track) => { track.enabled = next; });
    setCamOn(next);
  }, [camOn, stream]);

  // -- TUS Upload to embed.3speak.tv + Hive comment --
  const handleSubmit = useCallback(async () => {
    const file = videoFile;
    if (!file || !user) return;

    if (isShort && videoDuration > SHORTS_MAX_DURATION_SEC) {
      toast.error(t('player.reactionUpload.shortTooLong', { max: shortsMaxDurationLabel() }));
      return;
    }

    setUploading(true);
    setStatusText(t('player.reactionUpload.uploadingVideo'));
    setUploadProgress(0);

    try {
      // 1. Upload video via TUS to embed.3speak.tv
      //    The X-Embed-URL response header gives us the embed URL
      let embedUrl = '';

      await new Promise((resolve, reject) => {
        const upload = new tus.Upload(file, {
          endpoint: EMBED_UPLOAD_URL,
          chunkSize: 5 * 1024 * 1024, // 5 MB
          retryDelays: [0, 2000, 5000, 10000],
          headers: {
            ...(EMBED_API_KEY ? { 'X-API-Key': EMBED_API_KEY } : {}),
          },
          metadata: {
            filename: file.name,
            filetype: file.type,
            frontend_app: '3speak-tv',
            owner: user,
            short: isShort ? 'true' : 'false',
            duration: String(Math.round(videoDuration)),
          },
          onError: (err) => {
            console.error('TUS upload error:', err);
            reject(err);
          },
          onProgress: (bytesUploaded, bytesTotal) => {
            setUploadProgress(Math.round((bytesUploaded / bytesTotal) * 100));
          },
          onSuccess: () => {
            // Try to get embed URL from the upload URL
            // The upload.url is the TUS resource URL; the embed URL
            // may come from X-Embed-URL header captured during upload
            resolve();
          },
          onAfterResponse: (req, res) => {
            // Capture X-Embed-URL from any TUS response
            const header = res.getHeader('X-Embed-URL') || res.getHeader('x-embed-url');
            if (header) embedUrl = header;
          },
        });
        tusUploadRef.current = upload;
        upload.start();
      });

      // If no embed URL from header, construct one from the upload URL
      if (!embedUrl && tusUploadRef.current?.url) {
        const uploadUrl = tusUploadRef.current.url;
        const assetId = uploadUrl.split('/').pop();
        // Fallback: the embed URL pattern may be like play.3speak.tv/embed?v=user/assetId
        embedUrl = uploadUrl;
        console.log('No X-Embed-URL header, using upload URL as reference:', assetId);
      }

      if (!embedUrl) {
        throw new Error(t('player.reactionUpload.noEmbedUrl'));
      }

      setStatusText(t('player.reactionUpload.publishingComment'));

      // 2. Post Hive comment with video embed URL
      const timestampSec = currentTime ? Math.round(currentTime) : 0;
      const commentText = description.trim() || 'Video reaction';
      // Body: description text + embed URL on its own line
      let commentBody = `${commentText}\n${embedUrl}`;
      // Append "replied to" timestamp reference
      if (timestampSec > 0) {
        const mins = Math.floor(timestampSec / 60);
        const secs = Math.floor(timestampSec % 60);
        const tsLabel = `${mins}:${secs.toString().padStart(2, '0')}`;
        const baseUrl = window.location.origin;
        const host = window.location.host;
        commentBody += `\n<sup>replied to [${tsLabel}](${baseUrl}/watch?v=${author}/${permlink}&t=${timestampSec}) on [${host}](${baseUrl})</sup>`;
      }
      const newPermlink = `re-${permlink}-${Date.now()}`;

      // OpenAttribute: a reaction is a reply carrying its own video, so it is a
      // Comment that still gets the video attribute. Orientation comes off the
      // recorded blob when the reaction was filmed here rather than uploaded.
      const oaOrientation = await probeVideoOrientation(videoFile || recordedBlob);

      const metadata = {
        app: '3speak/new-version',
        format: 'markdown',
        tags: ['3speak', 'reaction'],
        ...(timestampSec > 0 ? { parentTimestamp: timestampSec } : {}),
        video: {
          platform: '3speak',
          url: embedUrl,
        },
        ...oaEnvelope(OA_COMMENT),
        ...threespeakVideo({
          surface: isShort ? 'shorts' : 'watch',
          orientation: oaOrientation,
          duration: videoDuration,
        }),
      };

      // Broadcast the reaction. Every aioha login posts via @threespeak (the
      // server signs on the user's behalf); ButrAuth keeps its own cookie path
      // through commentWithAioha.
      const result = getCurrentProvider()
        ? await broadcastViaThreespeak([
            ['comment', {
              parent_author: author,
              parent_permlink: permlink,
              author: user,
              permlink: newPermlink,
              title: '',
              body: commentBody,
              json_metadata: JSON.stringify(metadata),
            }],
          ])
        : await commentWithAioha(author, permlink, newPermlink, '', commentBody, metadata);

      if (result.success) {
        // Link the embed video to the Hive post
        try {
          // Extract embed permlink from embedUrl (format: .../embed?v=owner/permlink)
          const vParam = new URL(embedUrl).searchParams.get('v');
          const embedPermlink = vParam ? vParam.split('/').pop() : null;
          if (embedPermlink && EMBED_API_URL) {
            await fetch(`${EMBED_API_URL}/video/${embedPermlink}/hive`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(EMBED_API_KEY ? { 'X-API-Key': EMBED_API_KEY } : {}),
              },
              body: JSON.stringify({
                hive_author: user,
                hive_permlink: newPermlink,
                hive_title: '',
                hive_body: commentBody,
                hive_tags: ['3speak', 'reaction'],
              }),
            });
          }
        } catch (linkErr) {
          console.warn('Failed to link embed video to Hive post:', linkErr);
        }

        toast.success(t('player.reactionUpload.posted'));
        setStatusText(t('common.status.success'));
        if (onPosted) onPosted();
        // Reset
        setVideoFile(null);
        setDescription('');
        setSource(null);
        setUploadProgress(0);
        if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
        if (recordedUrl) URL.revokeObjectURL(recordedUrl);
        setVideoPreviewUrl(null);
        setRecordedUrl(null);
        setRecordedBlob(null);
      } else {
        throw new Error(t('player.reactionUpload.postFailed'));
      }
    } catch (err) {
      console.error('React upload failed:', err);
      toast.error(err.message || t('player.reactionUpload.uploadFailed'));
      setStatusText('');
    } finally {
      setUploading(false);
    }
  }, [videoFile, user, videoDuration, currentTime, description, isShort, author, permlink, onPosted, videoPreviewUrl, recordedUrl, recordedBlob]);

  const hasVideo = !!(videoFile || recordedBlob);
  const canSubmit = hasVideo && !uploading;
  const mode = source || 'record';
  const cameraLive = mode === 'record' && !!stream && !recordedBlob;

  return (
    <div className="react-video-tab">
      <b className="rvt-title">{t('player.reactionUpload.title')}</b>

      {/* Record Video / Upload Video (48b) */}
      <Segmented
        className="rvt-source"
        size={32}
        label={t('player.reactionUpload.title')}
        value={mode}
        onChange={uploading ? undefined : handleSourceChange}
        options={[
          { value: 'record', label: t('player.reactionUpload.recordVideo') },
          { value: 'upload', label: t('player.reactionUpload.uploadVideo') },
        ]}
      />

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Upload: the picked file, or the way to pick one */}
      {mode === 'upload' && (videoFile && videoPreviewUrl ? (
        <div className="rvt-preview">
          <video src={videoPreviewUrl} controls muted className="rvt-video" />
          <p className="rvt-filename">{videoFile.name}</p>
        </div>
      ) : (
        <Button variant="secondary" size={32} icon="upload_file" className="rvt-pick" onClick={handleUploadClick} disabled={uploading}>
          {t('player.reactionUpload.uploadVideo')}
        </Button>
      ))}

      {/* Record: the camera in an accent frame with the REC timer while it runs (22b) */}
      {cameraLive && (
        <div className={`rvt-cam${recording ? ' is-rec' : ''}`}>
          <video ref={webcamRef} autoPlay muted playsInline className="rvt-video" />
          {recording && (
            <span className="rvt-rec" role="status">
              <span className="rvt-rec__dot" aria-hidden="true" />
              {t('player.reactionUpload.rec', { time: fmtClock(recSeconds) })}
            </span>
          )}
        </div>
      )}

      {mode === 'record' && recordedBlob && recordedUrl && (
        <div className="rvt-preview">
          <video src={recordedUrl} controls className="rvt-video" />
          <p className="rvt-filename">{t('player.reactionUpload.recordedVideo')}</p>
        </div>
      )}

      {/* While recording (22b): Mic / Camera / Restart, then Stop and review on the
          same row. After a take: Restart to record a new one. */}
      {mode === 'record' && (recording || recordedBlob) && (
        <div className="rvt-row" ref={recRowRef}>
          {recording && (
            <>
              <DockTile iconSize={24} icon={micOn ? 'mic' : 'mic_off'} label={t('player.reactionUpload.mic')} active={!micOn} onClick={toggleMic} aria-label={micOn ? t('player.controls.mute') : t('player.controls.unmute')} />
              <DockTile iconSize={24} icon={camOn ? 'videocam' : 'videocam_off'} label={t('player.reactionUpload.camera')} active={!camOn} onClick={toggleCam} />
            </>
          )}
          <DockTile iconSize={24} icon="replay" label={t('player.reactionUpload.restart')} onClick={handleRestart} disabled={uploading} />
          {recording && (
            <Button variant="primary" size={64} trailing="stop_circle" className="rvt-rec-btn rvt-rec-btn--stop" onClick={stopRecording}>
              {t('player.reactionUpload.stopRecording')}
            </Button>
          )}
        </div>
      )}

      {mode === 'record' && !recordedBlob && !recording && (
        <Button variant="primary" size={32} block icon="fiber_manual_record" className="rvt-rec-btn rvt-rec-btn--start" onClick={handleStartClick} disabled={autoStart}>
          {t('player.reactionUpload.startRecording')}
        </Button>
      )}

      {!recording && (
      <>
      {/* Description */}
      <textarea
        className="v2-input is-area rvt-description"
        placeholder={t('player.reactionUpload.descriptionPlaceholder')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={uploading}
      />

      {/* Short toggle */}
      <label className="v2-check rvt-toggle">
        <input
          type="checkbox"
          checked={isShort}
          onChange={(e) => setIsShort(e.target.checked)}
          disabled={uploading}
        />
        <span className="rvt-toggle-label">{t('player.reactionUpload.showInShorts')}</span>
      </label>

      {/* Upload progress */}
      {uploading && (
        <div className="rvt-progress">
          <div className="v2-progress is-thin rvt-progress-bar" role="progressbar" aria-valuenow={uploadProgress} aria-valuemin={0} aria-valuemax={100}>
            <span className="is-cyan rvt-progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
          <span className="rvt-progress-text">{statusText} {uploadProgress > 0 && uploadProgress < 100 ? `${uploadProgress}%` : ''}</span>
        </div>
      )}

      {/* @threespeak authorization (48b: a cyan wash with the link inline), or Post */}
      {needsAuth ? (
        <div className="rvt-auth-gate" role="note">
          <Trans i18nKey="player.reactionUpload.authNote" components={{ b: <strong /> }} />{' '}
          <button type="button" className="rvt-auth-link" onClick={handleAuthorize} disabled={authorizing} aria-busy={authorizing || undefined}>
            {authorizing ? t('player.reactionUpload.authorizing') : t('player.reactionUpload.authorize')}
          </button>
        </div>
      ) : hasVideo && (
        <Button variant="primary" size={40} block next className="rvt-submit" onClick={handleSubmit} disabled={!canSubmit} loading={uploading}>
          {uploading ? t('player.reactionUpload.uploading') : t('player.reactionUpload.postReaction')}
        </Button>
      )}
      </>
      )}
    </div>
  );
}

export default ReactVideoTab;
