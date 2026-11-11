import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Progress } from '../v2/ui';
import { sttEnabledFor } from '../../utils/config';
import { transcriptLanguages } from '../../utils/transcribe';

// Language names in the language itself, for the picker (only shown when the
// speech server has more than one)
const langName = (tag) => {
  try {
    const n = new Intl.DisplayNames([tag], { type: 'language' }).of(tag.split('-')[0]);
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : tag;
  } catch { return tag; }
};

/**
 * "Make a transcript" for one track: the button, the language (when there is
 * a choice), the progress with Cancel, and how it went. The job itself runs in
 * useTranscriptJobs (passed in as `job`, `onStart`, `onCancel`).
 */
export default function TranscriptControl({ user, track, job, hasTranscript, onStart, onCancel, disabled = false }) {
  const { t, i18n } = useTranslation();
  const [langs, setLangs] = useState([]);
  const [picked, setLang] = useState('');
  const enabled = sttEnabledFor(user);

  useEffect(() => {
    let alive = true;
    if (enabled) transcriptLanguages().then((l) => { if (alive) setLangs(l); });
    return () => { alive = false; };
  }, [enabled]);

  // Until one is picked: the site's language when the server has it
  const base = String(i18n?.language || '').split('-')[0];
  const lang = langs.includes(picked) ? picked : (langs.find((l) => l.split('-')[0] === base) || langs[0] || '');

  if (!enabled || !langs.length || !track?.blob) return null;

  const busy = job && (job.phase === 'decoding' || job.phase === 'listening');
  const pct = Math.round((job?.done || 0) * 100);

  return (
    <div className="audio-transcript">
      {busy ? (
        <div className="audio-transcript-progress" role="status">
          <div className="audio-transcript-progress-head">
            <Icon name="progress_activity" size={16} className="v2-spin audio-transcript-spin" />
            <span>{job.phase === 'decoding' ? t('audio.upload.transcript.reading') : t('audio.upload.transcript.writing', { percent: pct })}</span>
            <Button variant="ghost" size={28} icon="close" onClick={onCancel}>
              {t('common.actions.cancel')}
            </Button>
          </div>
          <div className="audio-transcript-bar"><Progress value={pct} tone="cyan" thin label={t('audio.upload.transcript.heading')} /></div>
        </div>
      ) : (
        <div className="audio-transcript-row">
          <Button
            variant="secondary"
            size={36}
            icon="subtitles"
            className="audio-transcript-btn"
            onClick={() => onStart(lang)}
            disabled={disabled}
          >
            {hasTranscript ? t('audio.upload.transcript.again') : t('audio.upload.transcript.make')}
          </Button>
          {langs.length > 1 && (
            <select
              className="audio-transcript-lang v2-input is-select h32"
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label={t('audio.upload.transcript.language')}
            >
              {langs.map((l) => <option key={l} value={l}>{langName(l)}</option>)}
            </select>
          )}
        </div>
      )}
      {!busy && (
        <small className={`audio-transcript-note${job?.phase === 'error' ? ' error' : ''}`}>
          {job?.phase === 'error' ? t('audio.upload.transcript.failed')
            : job?.phase === 'done' && job.empty ? t('audio.upload.transcript.empty')
              : job?.phase === 'done' && job.shortened ? t('audio.upload.transcript.shortened')
                : job?.phase === 'done' ? t('audio.upload.transcript.added')
                  : t('audio.upload.transcript.hint', { language: langName(lang || langs[0]) })}
        </small>
      )}
    </div>
  );
}
