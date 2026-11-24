import { useCallback, useEffect, useState } from 'react';
import { editorAspect, landscapeEditorAllowed } from '../utils/editorFormat';
import { useAppStore } from '../lib/store';
import { usePremiumStatus } from './usePremiumStatus';
import { blockIfUploadsPaused } from '../lib/uploadsPaused';

/**
 * Which editor the global EditorModal (App.jsx) shows, driven by two window events:
 *   open-shorts-editor  the share menu's Shorts editor (no detail), the shorts
 *                       uploader's "Edit this video" (detail.file), a sound
 *                       page's "Use this sound" (detail.sound: { url, name, credit }),
 *                       or a finished upload's "Make a Short from this video"
 *                       (detail.file + detail.teaser: { author, permlink }, the
 *                       video just published, whole on the track)
 *   open-video-editor   the share menu's Video editor (no detail), or a normal
 *                       upload's "Edit this video" (detail.file): a landscape
 *                       project (detail.aspect, default 16:9), posted as a video
 *   open-audio-editor   the share menu's Audio editor (no detail), the audio
 *                       upload's "Edit audio" on a track (detail.file + detail.trackId),
 *                       or the audio page's "Video podcast" (detail.episode:
 *                       { url, title, cover, durationSec }, straight into the video podcast)
 * `mode` is 'video' or 'audio'; `file` is what the editor opens with; `audioTrackId`
 * names the audio upload's track an edited audio goes back to (null: a new upload);
 * `sound` is the sound a new Short starts with (null: none); `aspect` the shape
 * the video editor starts in (null: a Short, utils/editorFormat.js); `episode`
 * the published episode a video podcast is made of (null: none); `teaser` the
 * video the Short teases (null: none).
 *
 * 🔒 The landscape video editor (open-video-editor) is 3Speak Pro (owner's call
 * 2026-11-20); the Shorts and audio editors stay free for everyone, warm-up
 * included. A free account (warm-up too: it is not Pro) gets `upsell` instead
 * of the editor. While the Pro status is still loading the request waits, so
 * neither the upsell nor the editor flashes up for the wrong account.
 * `open-pro-upsell` (EditorModal's own guard) opens the upsell too.
 */

// "Use this sound": what the editor needs, checked here (it comes in on an event).
function soundOf(e) {
  const s = e?.detail?.sound;
  if (!s || typeof s !== 'object' || typeof s.url !== 'string' || !/^https:\/\//.test(s.url)) return null;
  if (!s.credit || typeof s.credit !== 'object' || typeof s.credit.id !== 'string') return null;
  return { url: s.url, name: typeof s.name === 'string' ? s.name.slice(0, 120) : 'Sound', credit: s.credit };
}

// "Video podcast": a published episode, checked here (it comes in on an event).
export function episodeOf(e) {
  const ep = e?.detail?.episode;
  if (!ep || typeof ep !== 'object' || typeof ep.url !== 'string' || !/^https:\/\//.test(ep.url)) return null;
  const d = Number(ep.durationSec);
  return {
    url: ep.url,
    title: typeof ep.title === 'string' ? ep.title.slice(0, 120) : '',
    cover: typeof ep.cover === 'string' && /^https:\/\//.test(ep.cover) ? ep.cover : null,
    durationSec: Number.isFinite(d) && d > 0 ? d : null,
  };
}

// "Make a Short from this video": the published video, checked here (it comes in
// on an event). The author must be the uploader: EditorModal checks that against
// the signed-in user before the Short names it.
const PERMLINK_RE = /^[a-z0-9-]{1,255}$/;
const AUTHOR_RE = /^[a-z0-9.-]{3,16}$/;
export function teaserOf(e) {
  const t = e?.detail?.teaser;
  if (!t || typeof t !== 'object') return null;
  const author = String(t.author || '').toLowerCase();
  const permlink = String(t.permlink || '');
  if (!AUTHOR_RE.test(author) || !PERMLINK_RE.test(permlink)) return null;
  return { author, permlink };
}

export function useEditorLauncher() {
  const [state, setState] = useState({ open: false, mode: 'video', file: null, audioTrackId: null, sound: null, aspect: null, episode: null, teaser: null });
  // A landscape editor asked for, waiting for the Pro status: { file, aspect } | null
  const [pendingVideo, setPendingVideo] = useState(null);
  const [upsell, setUpsell] = useState(false);
  const user = useAppStore((s) => s.user);
  const allowed = landscapeEditorAllowed(user, usePremiumStatus(user));

  useEffect(() => {
    if (!pendingVideo || allowed === null) return;
    if (allowed) setState({ open: true, mode: 'video', file: pendingVideo.file, audioTrackId: null, sound: null, aspect: pendingVideo.aspect, episode: null, teaser: null });
    else setUpsell(true);
    setPendingVideo(null);
  }, [pendingVideo, allowed]);

  useEffect(() => {
    const fileOf = (e) => (e?.detail?.file instanceof Blob ? e.detail.file : null);
    // The editors end in an upload: none while uploads are paused (lib/uploadsPaused.jsx).
    const onShorts = (e) => {
      if (blockIfUploadsPaused()) return;
      const file = fileOf(e);
      // A teaser needs the video's own file: without one it is just the Shorts editor
      setState({ open: true, mode: 'video', file, audioTrackId: null, sound: soundOf(e), aspect: null, episode: null, teaser: file ? teaserOf(e) : null });
    };
    // Pro only: decided by the effect above, once the Pro status is known
    const onVideo = (e) => !blockIfUploadsPaused() && setPendingVideo({ file: fileOf(e), aspect: editorAspect(e?.detail?.aspect) || '16:9' });
    const onUpsell = () => setUpsell(true);
    const onAudio = (e) => {
      if (blockIfUploadsPaused()) return;
      const trackId = e?.detail?.trackId;
      setState({ open: true, mode: 'audio', file: fileOf(e), audioTrackId: typeof trackId === 'string' ? trackId : null, sound: null, aspect: null, episode: episodeOf(e), teaser: null });
    };
    window.addEventListener('open-shorts-editor', onShorts);
    window.addEventListener('open-video-editor', onVideo);
    window.addEventListener('open-audio-editor', onAudio);
    window.addEventListener('open-pro-upsell', onUpsell);
    return () => {
      window.removeEventListener('open-pro-upsell', onUpsell);
      window.removeEventListener('open-shorts-editor', onShorts);
      window.removeEventListener('open-video-editor', onVideo);
      window.removeEventListener('open-audio-editor', onAudio);
    };
  }, []);

  // The mode stays, so the popup does not switch looks while it closes
  const close = useCallback(() => setState((s) => ({ ...s, open: false, file: null, audioTrackId: null, sound: null, episode: null, teaser: null })), []);

  const closeUpsell = useCallback(() => setUpsell(false), []);

  return { ...state, close, upsell, closeUpsell };
}
