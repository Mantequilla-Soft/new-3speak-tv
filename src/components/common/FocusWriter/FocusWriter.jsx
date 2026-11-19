import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import '@fontsource/courier-prime/400.css';
import { Icon } from '../../v2/Icon';
import { countWords, caretPos, typewriterSound, readSoundPref, saveSoundPref } from './focusWriterTools';
import { createFocusMusic, readMusicPref, saveMusicPref, MUSIC_TRACKS } from './focusMusic';
import './FocusWriter.scss';

// Where the typing point sits on the screen: near the bottom, the typing
// line with room under it for the typehead and the platen only (above a
// phone's keyboard: the visible height), on wide screens also the middle, as
// the type guide of a typewriter. The paper under it is behind the platen.
const LINE_ROOM_BELOW = 64;
const CARRIAGE_MIN_WIDTH = 900;

/**
 * Focus mode of a comment box (FocusWriterButton): the text on a sheet of
 * paper in a typewriter face, in a dark room lit by a warm cone of light from
 * the typehead up over the written lines, fullscreen where the browser allows it.
 *
 * Like a typewriter, the typing point stays low and the paper moves: it starts
 * with its top edge at the typing point and goes up a line at each new line,
 * the written lines rising above, the blank rest behind the platen; and on wide screens sideways with each letter
 * (the carriage), back to the left at a line break. A little typehead marks
 * the point. The wheel or a swipe looks back over the text; the next key
 * brings the paper back.
 *
 * `backdrop`: the picture of what the comment is about (focusBackdrop.js),
 * blurred and dimmed behind the room, a little larger than the screen, and
 * drifting a touch against the mouse.
 *
 * Opening it pauses any video or audio playing on the page.
 *
 * Writes straight into the box's own text, so closing (Done, Esc, Ctrl+Enter,
 * leaving fullscreen) leaves the text in the box, ready to post.
 */
export default function FocusWriter({ value, onChange, placeholder, backdrop = null, onClose }) {
  const { t } = useTranslation();
  const rootRef = useRef(null);
  const sheetRef = useRef(null);
  const inputRef = useRef(null);
  const typingTimer = useRef(0);
  const lookBack = useRef(0);
  const touchY = useRef(null);
  const [typing, setTyping] = useState(false);
  const [sound, setSound] = useState(readSoundPref);
  const [point, setPoint] = useState(null); // { x, y, line, carriage }
  const [backdropOk, setBackdropOk] = useState(true);
  // Parallax of the backdrop: --mx / --my from -1 to 1, once a frame.
  const drift = useRef({ frame: 0, x: 0, y: 0 });
  const onMouseDrift = (e) => {
    const d = drift.current;
    d.x = (e.clientX / window.innerWidth) * 2 - 1;
    d.y = (e.clientY / window.innerHeight) * 2 - 1;
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      rootRef.current?.style.setProperty('--mx', d.x.toFixed(3));
      rootRef.current?.style.setProperty('--my', d.y.toFixed(3));
    });
  };
  useEffect(() => () => cancelAnimationFrame(drift.current.frame), []);
  const soundRef = useRef(null);
  // Background music (focusMusic.js), apart from the key sounds: 0 = off.
  const [music, setMusic] = useState(readMusicPref);
  const musicRef = useRef(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => { closeRef.current = onClose; });

  // Fullscreen (not on iPhone: the overlay already covers the page), the page
  // behind it held still, the caret on the paper at the end of the text.
  useEffect(() => {
    const root = rootRef.current;
    // Leaving fullscreen ends focus mode: Firefox and Chrome take Esc for
    // themselves in fullscreen, so that is the only Esc the page sees. Known
    // from the change events, not the request's promise: a second request
    // (React's dev double effect, a quick reopen) can be refused while the
    // first one put the page in fullscreen.
    let entered = !!root && document.fullscreenElement === root;
    if (!entered) root?.requestFullscreen?.().catch(() => {});
    const onFs = () => {
      if (document.fullscreenElement === root) entered = true;
      else if (entered && !document.fullscreenElement) closeRef.current();
    };
    document.addEventListener('fullscreenchange', onFs);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // What plays behind it (the video, a Short, the audio player) pauses: focus
    // mode is for writing. The players follow their element's pause event; they
    // stay paused after, to go on with the play button.
    document.querySelectorAll('video, audio').forEach((m) => {
      if (!m.paused) { try { m.pause(); } catch { /* not ours to stop */ } }
    });
    const el = inputRef.current;
    if (el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // The music chosen last time starts again (opening focus mode was a click).
    const track = readMusicPref();
    if (track) {
      musicRef.current = createFocusMusic();
      musicRef.current?.play(track);
    }
    return () => {
      musicRef.current?.close();
      musicRef.current = null;
      document.removeEventListener('fullscreenchange', onFs);
      document.body.style.overflow = overflow;
      if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
      clearTimeout(typingTimer.current);
    };
  }, []);

  // Moves the paper so the caret lands on the typing point.
  const follow = useCallback(() => {
    const el = inputRef.current;
    const sheet = sheetRef.current;
    if (!el || !sheet) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    const vw = window.innerWidth;
    const vh = window.visualViewport?.height || window.innerHeight;
    const c = caretPos(el);
    const caretX = el.offsetLeft + c.left;
    const caretY = el.offsetTop + c.top;
    const carriage = vw >= CARRIAGE_MIN_WIDTH;
    const x = carriage ? vw / 2 : (vw - sheet.offsetWidth) / 2 + caretX;
    const y = Math.round(vh - LINE_ROOM_BELOW - c.height / 2);
    const tx = carriage ? x - caretX : (vw - sheet.offsetWidth) / 2;
    const ty = y - caretY - c.height / 2 + lookBack.current;
    sheet.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
    setPoint({ x: Math.round(x), y, line: c.height, carriage });
  }, []);

  useLayoutEffect(() => { follow(); }, [follow]);
  useEffect(() => {
    const vv = window.visualViewport;
    window.addEventListener('resize', follow);
    vv?.addEventListener('resize', follow);
    document.fonts?.ready.then(follow).catch(() => {});
    return () => {
      window.removeEventListener('resize', follow);
      vv?.removeEventListener('resize', follow);
    };
  }, [follow]);

  const backToPoint = () => {
    if (lookBack.current) { lookBack.current = 0; rootRef.current?.classList.remove('is-looking'); }
  };

  const onInput = (e) => {
    onChange(e.target.value);
    backToPoint();
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 1500);
    requestAnimationFrame(follow);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      onClose();
      return;
    }
    // A browser that held the music back until a key was pressed lets it go now.
    musicRef.current?.resume();
    if (sound && !e.ctrlKey && !e.metaKey && !e.altKey) {
      soundRef.current ||= typewriterSound();
      if (e.key === 'Enter') soundRef.current?.bell();
      else if (e.key.length === 1 || e.key === 'Backspace') soundRef.current?.key(e.key === ' ' || e.key === 'Backspace');
    }
  };

  // Looking back over the text: the paper moves, the typing point stays.
  const look = (dy) => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const max = Math.max(0, sheet.offsetHeight);
    lookBack.current = Math.min(max, Math.max(-max, lookBack.current + dy));
    rootRef.current?.classList.toggle('is-looking', !!lookBack.current);
    follow();
  };

  const chooseMusic = (n) => {
    setMusic(n);
    saveMusicPref(n);
    if (n && !musicRef.current) musicRef.current = createFocusMusic();
    musicRef.current?.play(n);
    inputRef.current?.focus({ preventScroll: true });
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    saveSoundPref(next);
    inputRef.current?.focus({ preventScroll: true });
  };

  const words = countWords(value);
  return createPortal(
    <div
      ref={rootRef}
      className={`focus-writer${typing ? ' is-typing' : ''}${point?.carriage ? ' has-carriage' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={t('comments.focus.aria')}
      onMouseMove={(e) => { if (typing) setTyping(false); if (backdrop) onMouseDrift(e); }}
      // The room never scrolls (the paper moves instead); a browser bringing
      // the caret into view would shift it.
      onScroll={(e) => { e.currentTarget.scrollTop = 0; e.currentTarget.scrollLeft = 0; }}
      onWheel={(e) => look(-e.deltaY)}
      onTouchStart={(e) => { touchY.current = e.touches[0]?.clientY ?? null; }}
      onTouchMove={(e) => {
        const y = e.touches[0]?.clientY;
        if (touchY.current == null || y == null) return;
        look(y - touchY.current);
        touchY.current = y;
      }}
    >
      {backdrop && backdropOk && (
        <div className="focus-writer__backdrop" aria-hidden="true">
          <img src={backdrop} alt="" decoding="async" onError={() => setBackdropOk(false)} />
        </div>
      )}
      <div ref={sheetRef} className="focus-writer__sheet">
        <textarea
          ref={inputRef}
          className="focus-writer__input"
          value={value}
          placeholder={placeholder}
          spellCheck
          onChange={onInput}
          onKeyDown={onKeyDown}
          onSelect={() => { backToPoint(); follow(); }}
        />
      </div>

      {point && (
        <>
          <div className="focus-writer__platen" style={{ top: point.y + point.line / 2 + 6 }} aria-hidden="true" />
          <Light x={point.x} base={point.y + point.line / 2} line={point.line} />
          <div className="focus-writer__head" style={{ left: point.x, top: point.y + point.line / 2 - 2 }} aria-hidden="true">
            <svg viewBox="0 0 72 34" width="72" height="34">
              <path className="fw-pointer" d="M29 1h14v2.5h-5.75V16h-2.5V3.5H29z" />
              <rect className="fw-pill" x="4" y="14" width="64" height="18" rx="9" />
              <circle className="fw-dot" cx="15" cy="23" r="1.6" />
              <circle className="fw-dot" cx="21" cy="23" r="1.6" />
            </svg>
          </div>
        </>
      )}

      <div className="focus-writer__bar">
        <span className="focus-writer__count num" aria-live="polite">{t('comments.focus.words', { count: words })}</span>
        <div className="focus-writer__actions">
          <div className="focus-writer__music" role="group" aria-label={t('comments.focus.music')} title={t('comments.focus.music')}>
            <Icon name={music ? 'music_note' : 'music_off'} size={18} />
            <button type="button" aria-pressed={music === 0} onClick={() => chooseMusic(0)}>{t('comments.focus.musicOff')}</button>
            {MUSIC_TRACKS.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={music === n}
                aria-label={t(`comments.focus.track${n}`)}
                title={t(`comments.focus.track${n}`)}
                onClick={() => chooseMusic(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="focus-writer__icon"
            aria-pressed={sound}
            aria-label={t('comments.focus.sound')}
            title={t('comments.focus.sound')}
            onClick={toggleSound}
          >
            <Icon name={sound ? 'volume_up' : 'volume_off'} size={20} />
          </button>
          <button type="button" className="focus-writer__done" onClick={onClose}>
            <Icon name="close_fullscreen" size={18} />
            {t('comments.focus.done')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// The light: half its width at the typehead, how much wider it gets per
// pixel up, how many lines up it reaches, and how soft it is (in lines).
const CONE_HALF_BASE = 150;
const CONE_SPREAD = 1.5;
const CONE_LINES = 6;
const CONE_SOFTNESS = 1.3;

/**
 * The light, as a desk lamp on the typehead: a big, very soft warm glow
 * rising from the typing point, strongest on the line being typed and the
 * few above it; the rest of the page lies in a light shade, still readable.
 * One SVG mask, so the glow and the shade never stack into bands. Nothing is
 * drawn under the typing line.
 */
function Light({ x, base, line }) {
  const id = useId().replace(/:/g, '');
  const top = base - line * CONE_LINES;
  const foot = base + line * 3; // under the platen: the blur never dims the line
  const half = (y) => CONE_HALF_BASE + (base - y) * CONE_SPREAD;
  const cone = `${x - half(foot) * 0.6},${foot} ${x + half(foot) * 0.6},${foot} ${x + half(top)},${top} ${x - half(top)},${top}`;
  const blur = line * CONE_SOFTNESS;
  return (
    <>
    <svg className="focus-writer__light" aria-hidden="true">
      <defs>
        <filter id={`${id}b`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation={blur} />
        </filter>
        {/* In the mask black is lit: lit at the typehead, fading up. */}
        <linearGradient id={`${id}h`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#000" />
          <stop offset="0.7" stopColor="#000" />
          <stop offset="1" stopColor="#fff" />
        </linearGradient>
        <linearGradient id={`${id}w`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="rgb(255,214,150)" stopOpacity="0.75" />
          <stop offset="0.45" stopColor="rgb(255,222,170)" stopOpacity="0.4" />
          <stop offset="1" stopColor="rgb(255,226,180)" stopOpacity="0" />
        </linearGradient>
        <mask id={`${id}m`} maskUnits="userSpaceOnUse">
          <rect width="100%" height="100%" fill="#fff" />
          <polygon points={cone} fill={`url(#${id}h)`} filter={`url(#${id}b)`} />
        </mask>
        <clipPath id={`${id}c`}>
          <rect width="100%" height={base + 4} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="100%" height="100%" fill="rgb(20,18,28)" fillOpacity="0.46" mask={`url(#${id}m)`} />
      </g>
    </svg>
    {/* The lamp's warmth, multiplied into the paper: the paper turns cream,
        the letters stay dark. */}
    <svg className="focus-writer__light is-warm" aria-hidden="true">
      <g clipPath={`url(#${id}c)`}>
        <polygon points={cone} fill={`url(#${id}w)`} filter={`url(#${id}b)`} />
      </g>
    </svg>
    </>
  );
}
