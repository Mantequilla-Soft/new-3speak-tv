import { useCallback, useEffect, useState } from 'react';
import { editorAspect } from '../utils/editorFormat';

/**
 * Which editor the global EditorModal (App.jsx) shows, driven by two window events:
 *   open-shorts-editor  the share menu's Shorts editor (no detail), the shorts
 *                       uploader's "Edit this video" (detail.file), or a sound
 *                       page's "Use this sound" (detail.sound: { url, name, credit })
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
 * the published episode a video podcast is made of (null: none).
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

export function useEditorLauncher() {
  const [state, setState] = useState({ open: false, mode: 'video', file: null, audioTrackId: null, sound: null, aspect: null, episode: null });

  useEffect(() => {
    const fileOf = (e) => (e?.detail?.file instanceof Blob ? e.detail.file : null);
    const onShorts = (e) => setState({ open: true, mode: 'video', file: fileOf(e), audioTrackId: null, sound: soundOf(e), aspect: null, episode: null });
    const onVideo = (e) => setState({ open: true, mode: 'video', file: fileOf(e), audioTrackId: null, sound: null, aspect: editorAspect(e?.detail?.aspect) || '16:9', episode: null });
    const onAudio = (e) => {
      const trackId = e?.detail?.trackId;
      setState({ open: true, mode: 'audio', file: fileOf(e), audioTrackId: typeof trackId === 'string' ? trackId : null, sound: null, aspect: null, episode: episodeOf(e) });
    };
    window.addEventListener('open-shorts-editor', onShorts);
    window.addEventListener('open-video-editor', onVideo);
    window.addEventListener('open-audio-editor', onAudio);
    return () => {
      window.removeEventListener('open-shorts-editor', onShorts);
      window.removeEventListener('open-video-editor', onVideo);
      window.removeEventListener('open-audio-editor', onAudio);
    };
  }, []);

  // The mode stays, so the popup does not switch looks while it closes
  const close = useCallback(() => setState((s) => ({ ...s, open: false, file: null, audioTrackId: null, sound: null, episode: null })), []);

  return { ...state, close };
}
