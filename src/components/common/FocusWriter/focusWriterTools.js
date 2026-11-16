// Helpers of the comment focus mode (FocusWriter.jsx), kept apart so they test
// without a DOM layout or an AudioContext.

const SOUND_KEY = 'focusWriterSound';

/** Words in a text: runs of non-space, so "a  b\nc" is 3 and "" is 0. */
export function countWords(text) {
  const m = String(text || '').match(/\S+/g);
  return m ? m.length : 0;
}

/** The typewriter sound, a setting the viewer chose (off until switched on). */
export function readSoundPref() {
  try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; }
}

export function saveSoundPref(on) {
  try { localStorage.setItem(SOUND_KEY, on ? '1' : '0'); } catch { /* private mode */ }
}

/**
 * Where the caret is inside the textarea, in px from its top-left corner:
 * `top` of the caret's line, `left` of the caret, `height` of a line. A hidden
 * copy of the textarea with the same font, width and padding holds the text up
 * to the caret, and a marker after it shows where that is.
 */
export function caretPos(el) {
  const cs = getComputedStyle(el);
  const copy = document.createElement('div');
  for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize', 'textIndent']) {
    copy.style[p] = cs[p];
  }
  Object.assign(copy.style, {
    position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', borderStyle: 'solid',
  });
  copy.textContent = el.value.slice(0, el.selectionEnd ?? el.value.length);
  const mark = document.createElement('span');
  mark.textContent = '\u200b';
  copy.appendChild(mark);
  document.body.appendChild(copy);
  const pos = { top: mark.offsetTop, left: mark.offsetLeft, height: parseFloat(cs.lineHeight) || mark.offsetHeight };
  copy.remove();
  return pos;
}

/**
 * Typewriter keys made on the spot with Web Audio (no sound files): a short
 * filtered click per key, a duller one for space and backspace, and the bell
 * of the carriage return on Enter. Null where Web Audio is missing.
 */
export function typewriterSound() {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return null;
  let ctx;
  try { ctx = new Ctx(); } catch { return null; }
  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 3;

  const out = (gain, at, length) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + length);
    g.connect(ctx.destination);
    return g;
  };

  return {
    key(dull) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const at = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.playbackRate.value = 0.9 + Math.random() * 0.25;
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = dull ? 900 : 2200 + Math.random() * 900;
      band.Q.value = 1.2;
      src.connect(band).connect(out(dull ? 0.5 : 0.35, at, 0.05));
      src.start(at);
    },
    bell() {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      const at = ctx.currentTime;
      for (const [f, gain] of [[2093, 0.12], [4186, 0.04]]) {
        const osc = ctx.createOscillator();
        osc.frequency.value = f;
        osc.connect(out(gain, at, 0.9));
        osc.start(at);
        osc.stop(at + 0.9);
      }
    },
  };
}
