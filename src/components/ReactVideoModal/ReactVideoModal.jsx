import { useState, useRef, useCallback, useEffect } from 'react';
import { MdUploadFile, MdVideocam, MdStop, MdFiberManualRecord } from 'react-icons/md';
import * as tus from 'tus-js-client';
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
 * Inline "React" tab panel — sits inside the comment input container.
 * Lets users pick a file or record from webcam, add a description,
 * then uploads via TUS and publishes as a comment under the parent post.
 */
function ReactVideoTab({ author, permlink, currentTime, formatTime, onPosted, onRecordStart }) {
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

  // -- Cleanup helpers --
  const stopStream = useCallback(() => {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      setStream(null);
    }
  }, [stream]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (stream) stream.getTracks().forEach(t => t.stop());
    };
  }, []);

  // Attach stream to webcam video element
  useEffect(() => {
    if (webcamRef.current && stream) {
      webcamRef.current.srcObject = stream;
    }
  }, [stream]);

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
      toast.success('@threespeak authorized — you can now post your reaction');
    } catch (e) {
      try { signWindow?.close(); } catch { /* ignore */ }
      toast.error(e?.message || 'Authorization failed. Please try again.');
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
      toast.error('Could not access webcam');
      setSource(null);
    }
  }, [videoPreviewUrl, recordedUrl]);

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
      stream.getTracks().forEach(t => t.stop());
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

  // -- TUS Upload to embed.3speak.tv + Hive comment --
  const handleSubmit = useCallback(async () => {
    const file = videoFile;
    if (!file || !user) return;

    if (isShort && videoDuration > SHORTS_MAX_DURATION_SEC) {
      toast.error(`Shorts must be ${shortsMaxDurationLabel()} or less. Uncheck "Show in 3Speak Shorts" or use a shorter video.`);
      return;
    }

    setUploading(true);
    setStatusText('Uploading video...');
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
        throw new Error('Upload succeeded but no embed URL was returned');
      }

      setStatusText('Publishing comment...');

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

        toast.success('Video reaction posted!');
        setStatusText('Done!');
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
        throw new Error('Failed to post comment');
      }
    } catch (err) {
      console.error('React upload failed:', err);
      toast.error(err.message || 'Upload failed');
      setStatusText('');
    } finally {
      setUploading(false);
    }
  }, [videoFile, user, videoDuration, currentTime, description, isShort, author, permlink, onPosted, videoPreviewUrl, recordedUrl, recordedBlob]);

  const hasVideo = !!(videoFile || recordedBlob);
  const canSubmit = hasVideo && !uploading;

  return (
    <div className="react-video-tab">
      {/* Source selection cards */}
      <div className="rvt-source-cards">
        <button
          className={`rvt-source-card${source === 'upload' ? ' active' : ''}`}
          onClick={handleUploadClick}
          disabled={uploading}
        >
          <MdUploadFile size={24} />
          <span>Upload Video</span>
        </button>
        <button
          className={`rvt-source-card${source === 'record' ? ' active' : ''}`}
          onClick={handleRecordClick}
          disabled={uploading}
        >
          <MdVideocam size={24} />
          <span>Record Video</span>
        </button>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Preview area */}
      {source === 'upload' && videoFile && videoPreviewUrl && (
        <div className="rvt-preview">
          <video src={videoPreviewUrl} controls muted className="rvt-video" />
          <p className="rvt-filename">{videoFile.name}</p>
        </div>
      )}

      {source === 'record' && stream && !recordedBlob && (
        <div className="rvt-preview">
          <video ref={webcamRef} autoPlay muted playsInline className="rvt-video" />
          <div className="rvt-record-controls">
            {!recording ? (
              <button className="rvt-rec-btn rvt-rec-btn--start" onClick={startRecording}>
                <MdFiberManualRecord size={16} />
                Start Recording
              </button>
            ) : (
              <button className="rvt-rec-btn rvt-rec-btn--stop" onClick={stopRecording}>
                <MdStop size={16} />
                Stop Recording
              </button>
            )}
          </div>
        </div>
      )}

      {source === 'record' && recordedBlob && recordedUrl && (
        <div className="rvt-preview">
          <video src={recordedUrl} controls className="rvt-video" />
          <p className="rvt-filename">Recorded video</p>
        </div>
      )}

      {/* Description */}
      {hasVideo && (
        <textarea
          className="rvt-description"
          placeholder="Add a description for your video reaction..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={uploading}
        />
      )}

      {/* Short toggle */}
      {hasVideo && (
        <label className="rvt-toggle">
          <input
            type="checkbox"
            checked={isShort}
            onChange={(e) => setIsShort(e.target.checked)}
            disabled={uploading}
          />
          <span className="rvt-toggle-label">Show in 3Speak Shorts</span>
        </label>
      )}

      {/* Upload progress */}
      {uploading && (
        <div className="rvt-progress">
          <div className="rvt-progress-bar">
            <div className="rvt-progress-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
          <span className="rvt-progress-text">{statusText} {uploadProgress > 0 && uploadProgress < 100 ? `${uploadProgress}%` : ''}</span>
        </div>
      )}

      {/* Submit / @threespeak authorization gate */}
      {hasVideo && (
        needsAuth ? (
          <div className="rvt-auth-gate">
            <p className="rvt-auth-note">
              Allow <strong>@threespeak</strong> to post your reaction on your behalf.
            </p>
            <button className="rvt-submit" onClick={handleAuthorize} disabled={authorizing}>
              {authorizing ? 'Authorizing…' : 'Authorize @threespeak'}
            </button>
          </div>
        ) : (
          <button className="rvt-submit" onClick={handleSubmit} disabled={!canSubmit}>
            {uploading ? 'Uploading...' : 'Post Reaction'}
          </button>
        )
      )}
    </div>
  );
}

export default ReactVideoTab;
