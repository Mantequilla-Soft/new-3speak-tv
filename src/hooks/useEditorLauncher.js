import { useCallback, useEffect, useState } from 'react';

/**
 * Which editor the global EditorModal (App.jsx) shows, driven by two window events:
 *   open-shorts-editor  the share menu's Shorts editor (no detail), or the shorts
 *                       uploader's "Edit this video" (detail.file)
 *   open-audio-editor   the share menu's Audio editor (no detail), or the audio
 *                       upload's "Edit audio" on a track (detail.file + detail.trackId)
 * `mode` is 'video' or 'audio'; `file` is what the editor opens with; `audioTrackId`
 * names the audio upload's track an edited audio goes back to (null: a new upload).
 */
export function useEditorLauncher() {
  const [state, setState] = useState({ open: false, mode: 'video', file: null, audioTrackId: null });

  useEffect(() => {
    const fileOf = (e) => (e?.detail?.file instanceof Blob ? e.detail.file : null);
    const onShorts = (e) => setState({ open: true, mode: 'video', file: fileOf(e), audioTrackId: null });
    const onAudio = (e) => {
      const trackId = e?.detail?.trackId;
      setState({ open: true, mode: 'audio', file: fileOf(e), audioTrackId: typeof trackId === 'string' ? trackId : null });
    };
    window.addEventListener('open-shorts-editor', onShorts);
    window.addEventListener('open-audio-editor', onAudio);
    return () => {
      window.removeEventListener('open-shorts-editor', onShorts);
      window.removeEventListener('open-audio-editor', onAudio);
    };
  }, []);

  // The mode stays, so the popup does not switch looks while it closes
  const close = useCallback(() => setState((s) => ({ ...s, open: false, file: null, audioTrackId: null })), []);

  return { ...state, close };
}
