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
 * `post({ url, room, host, clipper, offsetSec })`; `busy` while fetching.
 */
export function usePostClipAsShort() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const {
    isPremium, setVideoFile, setPrevVideoFile, setVideoDuration, setGeneratedThumbnail,
    setFromStories, setIsStory, setVideoMode, setOriginalAuthor, setOriginalPermlink,
    setOriginalShortPermlink, setRemixChain, setList, setRemaingPercent, setStreamClip,
  } = useEmbedUpload();
  const [busy, setBusy] = useState(false);

  const post = useCallback(async ({ url, room, host, clipper, offsetSec = null }) => {
    setBusy(true);
    try {
      const file = await fetchClipFile(url);
      setVideoDuration(await fileDuration(file));
      let thumbs = [];
      try {
        thumbs = await Promise.race([
          generateVideoThumbnailsAt(file),
          new Promise((_, reject) => setTimeout(() => reject(new Error('thumbnail timeout')), 15000)),
        ]);
      } catch { /* the thumbnail step can still capture one */ }
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
      const share = clipShareFor({ poster: user, host, clipper });
      setStreamClip({ room, host: host || null, clipper: clipper || null, offsetSec, share });
      const locked = getLockedBeneficiaries({ isPremium, username: user, includeEncoder: true });
      if (share) locked.push({ account: share.account, percent: share.percent, locked: true, minPercent: share.percent });
      setList(locked);
      setRemaingPercent(100 - locked.reduce((sum, b) => sum + b.percent, 0));
      navigate('/embed-studio/thumbnail?from=stories');
      return true;
    } finally {
      setBusy(false);
    }
  }, [user, isPremium, navigate, setVideoFile, setPrevVideoFile, setVideoDuration, setGeneratedThumbnail, setFromStories, setIsStory, setVideoMode, setOriginalAuthor, setOriginalPermlink, setOriginalShortPermlink, setRemixChain, setList, setRemaingPercent, setStreamClip]);

  return { post, busy };
}
