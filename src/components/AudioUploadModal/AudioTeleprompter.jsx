import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MdExpandLess, MdExpandMore, MdRemove, MdAdd, MdSubject } from 'react-icons/md';
import { useVoiceTeleprompter } from '../../hooks/useVoiceTeleprompter';
import { createSttStream } from '../../utils/sttClient';
import { detectScriptLang } from '../../utils/detectLang';
import { STT_WS_URL, sttEnabledFor } from '../../utils/config';
import { transcriptLanguages } from '../../utils/transcribe';

// Teleprompter for the audio upload's own recorder: write the script before
// recording, read it while recording. It follows your voice through the
// speech-to-text server, listening to the same mic track the recorder records
// (no second capture), when the server is there for you and knows the
// script's language; otherwise it moves on at a steady pace (words per
// minute, - / + to change it).

const SCRIPT_KEY = 'audio-tp-script';
const WPM_KEY = 'audio-tp-wpm';
const WPM_MIN = 60;
const WPM_MAX = 240;
const WPM_STEP = 10;
const WPM_DEFAULT = 130;

const load = (key, fallback) => { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, String(value)); } catch { /* storage unavailable */ } };

export default function AudioTeleprompter({ recording, streamRef, user }) {
  const { t } = useTranslation();
  const [script, setScript] = useState(() => load(SCRIPT_KEY, ''));
  const [open, setOpen] = useState(() => !!load(SCRIPT_KEY, '').trim());
  const [wpm, setWpm] = useState(() => {
    const v = parseInt(load(WPM_KEY, ''), 10);
    return Number.isFinite(v) ? Math.min(WPM_MAX, Math.max(WPM_MIN, v)) : WPM_DEFAULT;
  });
  const [langs, setLangs] = useState([]);
  useEffect(() => {
    let alive = true;
    if (sttEnabledFor(user)) transcriptLanguages().then((l) => { if (alive) setLangs(l); });
    return () => { alive = false; };
  }, [user]);
  useEffect(() => { save(SCRIPT_KEY, script); }, [script]);
  useEffect(() => { save(WPM_KEY, wpm); }, [wpm]);

  // Voice when the server knows the script's language (a German script with
  // only an English model would never match: steady pace then)
  const lang = useMemo(() => {
    const guess = langs.length ? detectScriptLang(script) : '';
    return langs.includes(guess) ? guess : '';
  }, [script, langs]);
  const tp = useVoiceTeleprompter(script, { lang: lang || 'en-US' });
  const hasScript = tp.totalWords > 0;
  const [voiceFailed, setVoiceFailed] = useState(false);
  const voice = !!lang && !voiceFailed;

  // Timed: from where it started (or where the voice left off) at `wpm`
  const [timedFrom, setTimedFrom] = useState({ at: 0, base: 0 });
  const [now, setNow] = useState(0);
  const matchedRef = useRef(0);
  useEffect(() => { matchedRef.current = tp.matchedCount; }, [tp.matchedCount]);

  // A new take starts at the top
  const { reset } = tp;
  useEffect(() => {
    if (!recording) return undefined;
    reset();
    setVoiceFailed(false);
    setTimedFrom({ at: Date.now(), base: 0 });
    return undefined;
  }, [recording, reset]);

  // Voice: stream the recorder's own mic track to the server
  const { ingestTranscript } = tp;
  useEffect(() => {
    if (!recording || !hasScript || !lang) return undefined;
    const track = streamRef?.current?.getAudioTracks?.()[0];
    if (!track) { setVoiceFailed(true); return undefined; }
    const stt = createSttStream({
      track,
      url: STT_WS_URL,
      lang,
      onTranscript: (text, isFinal) => ingestTranscript(text, isFinal),
      onStatus: (s) => {
        if (s !== 'error') return;
        // Carry on at the steady pace from where the voice got to
        setTimedFrom({ at: Date.now(), base: matchedRef.current });
        setVoiceFailed(true);
      },
    });
    return () => stt.stop();
  }, [recording, hasScript, lang, streamRef, ingestTranscript]);

  useEffect(() => {
    if (!recording || voice || !hasScript) return undefined;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [recording, voice, hasScript]);

  const timedIndex = timedFrom.base + Math.floor((Math.max(0, now - timedFrom.at) / 60000) * wpm);
  const current = Math.min(tp.totalWords, voice ? tp.matchedCount : (recording ? timedIndex : 0));

  // Changing the pace mid-take goes on from the current word
  const changeWpm = (next) => {
    const v = Math.min(WPM_MAX, Math.max(WPM_MIN, next));
    if (recording && !voice) setTimedFrom({ at: Date.now(), base: current });
    setWpm(v);
  };

  // Keep the current word in the upper third of the box (the box scrolls,
  // never the page around it)
  const boxRef = useRef(null);
  const wordRef = useRef(null);
  useEffect(() => {
    const box = boxRef.current;
    const word = wordRef.current;
    if (!recording || !box || !word) return;
    const top = word.offsetTop - box.clientHeight / 3;
    if (typeof box.scrollTo === 'function') box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    else box.scrollTop = Math.max(0, top);
  }, [current, recording]);

  // Nothing to show while recording without a script
  if (recording && !hasScript) return null;

  return (
    <div className={`audio-tp${recording ? ' recording' : ''}`}>
      {!recording && (
        <button
          type="button"
          className="audio-tp-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <MdSubject size={16} />
          <span>{t('audio.upload.teleprompter.title')}</span>
          <small>{t('audio.upload.teleprompter.subtitle')}</small>
          {open ? <MdExpandLess size={18} /> : <MdExpandMore size={18} />}
        </button>
      )}

      {!recording && open && (
        <textarea
          className="audio-upload-post-desc audio-tp-script"
          rows={5}
          value={script}
          onChange={(e) => setScript(e.target.value)}
          placeholder={t('audio.upload.teleprompter.placeholder')}
          aria-label={t('audio.upload.teleprompter.title')}
        />
      )}

      {recording && (
        <div className="audio-tp-read" ref={boxRef} aria-live="off">
          {tp.words.map((w, i) => (
            <Fragment key={i}>
              {w.br > 0 && Array.from({ length: Math.min(w.br, 2) }, (_, k) => <br key={k} />)}
              <span
                ref={i === current ? wordRef : null}
                className={i < current ? 'audio-tp-word read' : i === current ? 'audio-tp-word current' : 'audio-tp-word'}
              >
                {w.text}{' '}
              </span>
            </Fragment>
          ))}
        </div>
      )}

      {(open || recording) && hasScript && (
        <div className="audio-tp-status">
          {voice ? (
            <span>{t('audio.upload.teleprompter.followsVoice')}{recording ? ` · ${current}/${tp.totalWords}` : ''}</span>
          ) : (
            <>
              <span>{voiceFailed ? t('audio.upload.teleprompter.voiceStopped') : t('audio.upload.teleprompter.steady')}</span>
              <span className="audio-tp-wpm">
                <button type="button" onClick={() => changeWpm(wpm - WPM_STEP)} disabled={wpm <= WPM_MIN} aria-label={t('audio.upload.teleprompter.slower')}><MdRemove size={14} /></button>
                <span>{t('audio.upload.teleprompter.wpm', { n: wpm })}</span>
                <button type="button" onClick={() => changeWpm(wpm + WPM_STEP)} disabled={wpm >= WPM_MAX} aria-label={t('audio.upload.teleprompter.faster')}><MdAdd size={14} /></button>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
