import { useCallback, useEffect, useState } from 'react';

/**
 * Which editor the global EditorModal (App.jsx) shows, driven by two window events:
 *   open-shorts-editor  the share menu's Shorts editor (no detail), the shorts
 *                       uploader's "Edit this video" (detail.file), or a sound
 *                       page's "Use this sound" (detail.sound: { url, name, credit })
 *   open-audio-editor   the share menu's Audio editor (no detail), or the audio
 *                       upload's "Edit audio" on a track (detail.file + detail.trackId)
 * `mode` is 'video' or 'audio'; `file` is what the editor opens with; `audioTrackId`
 * names the audio upload's track an edited audio goes back to (null: a new upload);
 * `sound` is the sound a new Short starts with (null: none).
 */
// "Use this sound": what the editor needs, checked here (it comes in on an event).
function soundOf(e) {
  const s = e?.detail?.sound;
  if (!s || typeof s !== 'object' || typeof s.url !== 'string' || !/^https:\/\//.test(s.url)) return null;
  if (!s.credit || typeof s.credit !== 'object' || typeof s.credit.id !== 'string') return null;
  return { url: s.url, name: typeof s.name === 'string' ? s.name.slice(0, 120) : 'Sound', credit: s.credit };
}

export function useEditorLauncher() {
  const [state, setState] = useState({ open: false, mode: 'video', file: null, audioTrackId: null, sound: null });

  useEffect(() => {
    const fileOf = (e) => (e?.detail?.file instanceof Blob ? e.detail.file : null);
    const onShorts = (e) => setState({ open: true, mode: 'video', file: fileOf(e), audioTrackId: null, sound: soundOf(e) });
    const onAudio = (e) => {
      const trackId = e?.detail?.trackId;
      setState({ open: true, mode: 'audio', file: fileOf(e), audioTrackId: typeof trackId === 'string' ? trackId : null, sound: null });
    };
    window.addEventListener('open-shorts-editor', onShorts);
    window.addEventListener('open-audio-editor', onAudio);
    return () => {
      window.removeEventListener('open-shorts-editor', onShorts);
      window.removeEventListener('open-audio-editor', onAudio);
    };
  }, []);

  // The mode stays, so the popup does not switch looks while it closes
  const close = useCallback(() => setState((s) => ({ ...s, open: false, file: null, audioTrackId: null, sound: null })), []);

  return { ...state, close };
}
