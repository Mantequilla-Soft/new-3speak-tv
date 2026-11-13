import { useCallback, useEffect, useRef, useState } from 'react';
import { transcribe, paragraphs, transcriptBlock } from '../utils/transcribe';

/**
 * Transcripts being made for the audio upload's tracks. They live with the
 * upload (not with the step showing the button), so moving between steps
 * does not stop one.
 *
 * jobs[trackId] = { phase: 'decoding'|'listening'|'done'|'error', done (0..1),
 *                   shortened?, empty?, error? }
 * start(track, { lang, heading }) -> onResult(trackId, block, info) when done.
 */
export function useTranscriptJobs(onResult) {
  const [jobs, setJobs] = useState({});
  const controllers = useRef(new Map());
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; });

  const setJob = (id, job) => setJobs((all) => {
    if (job === null) {
      if (!(id in all)) return all;
      const next = { ...all };
      delete next[id];
      return next;
    }
    return { ...all, [id]: job };
  });

  const cancel = useCallback((id) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setJob(id, null);
  }, []);

  const start = useCallback((track, { lang, heading }) => {
    if (!track?.blob) return;
    controllers.current.get(track.id)?.abort();
    const ctrl = new AbortController();
    controllers.current.set(track.id, ctrl);
    setJob(track.id, { phase: 'decoding', done: 0 });
    let shown = -1;
    transcribe(track.blob, {
      name: track.filename,
      lang,
      durationSec: track.durationSec,
      signal: ctrl.signal,
      onProgress: ({ phase, done }) => {
        // A whole percent at a time: the server sends many small updates
        const pct = Math.floor(done * 100);
        if (ctrl.signal.aborted || (pct === shown && phase === 'listening')) return;
        shown = pct;
        setJob(track.id, { phase, done });
      },
    }).then((sentences) => {
      if (ctrl.signal.aborted) return;
      controllers.current.delete(track.id);
      const { text, shortened } = transcriptBlock(paragraphs(sentences), heading);
      setJob(track.id, { phase: 'done', done: 1, shortened, empty: !text });
      if (text) onResultRef.current?.(track.id, text, { shortened });
    }).catch((err) => {
      if (err?.name === 'AbortError' || ctrl.signal.aborted) return;
      controllers.current.delete(track.id);
      setJob(track.id, { phase: 'error', done: 0, error: err?.code || err?.message || 'failed' });
    });
  }, []);

  const cancelAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
    setJobs({});
  }, []);

  // Leaving the upload stops them all
  useEffect(() => () => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
  }, []);

  const running = Object.values(jobs).some((j) => j.phase === 'decoding' || j.phase === 'listening');
  return { jobs, start, cancel, cancelAll, running };
}

export default useTranscriptJobs;
