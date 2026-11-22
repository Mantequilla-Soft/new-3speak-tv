import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useEmbedUpload } from '../context/EmbedUploadContext';
import { useAppStore } from '../lib/store';
import { getLockedBeneficiaries } from '../utils/beneficiaries';
import { generateVideoThumbnailsAt } from '../utils/videoThumbnails';
import { clipShareFor, fetchClipFile } from '../lib/streamClips';

/** Seconds of a video file, 0 when the browser cannot tell. */
function fileDuration(file) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    const done = (d) => { URL.revokeObjectURL(url); resolve(Number.isFinite(d) ? d : 0); };
    v.onloadedmetadata = () => done(v.duration);
    v.onerror = () => done(0);
    v.src = url;
  });
}

/**
 * Post a live-stream clip as a 3Speak Short (H13) through the normal Shorts
 * upload: the clip goes in as the picked file, the thumbnail step opens, and
 * the other side of the clip (clipper or host) is a locked beneficiary, shown
 * in the list and enforced at publish (EmbedUploadContext `streamClip`).
 *
 * The clip starts a clean upload (resetUploadState): nothing of an earlier,
 * unfinished one (title, schedule, another clip's share) carries over. While a
 * publish is still running it refuses instead, so that upload is not cut off.
 *
 * `post({ url, room, host, clipper, offsetSec, recap })`; `busy` while fetching.
 * `recap`: the host's recap of the stream (several clips, no share), which
 * names the stream's VOD as a recap instead of a clip (lib/derived.js).
 */
export function usePostClipAsShort() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const {
    isPremium, setVideoFile, setPrevVideoFile, setVideoDuration, setGeneratedThumbnail,
    setFromStories, setIsStory, setVideoMode, setOriginalAuthor, setOriginalPermlink,
    setOriginalShortPermlink, setRemixChain, setList, setRemaingPercent, setStreamClip,
    uploading, resetUploadState,
  } = useEmbedUpload();
  const [busy, setBusy] = useState(false);

  const post = useCallback(async ({ url, room, host, clipper, offsetSec = null, recap = false }) => {
    if (uploading) throw new Error('an upload is still publishing');
    setBusy(true);
    try {
      const file = await fetchClipFile(url);
      const duration = await fileDuration(file);
      let thumbs = [];
      try {
        thumbs = await Promise.race([
          generateVideoThumbnailsAt(file),
          new Promise((_, reject) => setTimeout(() => reject(new Error('thumbnail timeout')), 15000)),
        ]);
      } catch { /* the thumbnail step can still capture one */ }
      // Only now that the clip is here: a failed fetch leaves the form alone.
      resetUploadState();
      setVideoDuration(duration);
      setGeneratedThumbnail(thumbs);
      setVideoFile(file);
      setPrevVideoFile(file);
      // A Short of its own, not a remix of someone's post.
      setOriginalAuthor(null);
      setOriginalPermlink(null);
      setOriginalShortPermlink(null);
      setRemixChain([]);
      setFromStories(true);
      setIsStory(false);
      setVideoMode?.(null);
      // A recap is the host's own: several clips joined, no one clipper to share with.
      const share = recap ? null : clipShareFor({ poster: user, host, clipper });
      setStreamClip({ room, host: host || null, clipper: recap ? null : (clipper || null), offsetSec, share, ...(recap ? { recap: true } : {}) });
      const locked = getLockedBeneficiaries({ isPremium, username: user, includeEncoder: true });
      if (share) locked.push({ account: share.account, percent: share.percent, locked: true, minPercent: share.percent });
      setList(locked);
      setRemaingPercent(100 - locked.reduce((sum, b) => sum + b.percent, 0));
      navigate('/embed-studio/thumbnail?from=stories');
      return true;
    } finally {
      setBusy(false);
    }
  }, [user, isPremium, uploading, resetUploadState, navigate, setVideoFile, setPrevVideoFile, setVideoDuration, setGeneratedThumbnail, setFromStories, setIsStory, setVideoMode, setOriginalAuthor, setOriginalPermlink, setOriginalShortPermlink, setRemixChain, setList, setRemaingPercent, setStreamClip]);

  return { post, busy };
}
