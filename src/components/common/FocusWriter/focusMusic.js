// Background music of the comment focus mode (FocusWriter.jsx), made on the
// spot with Web Audio: no sound files to load or credit, and it never repeats
// the same way twice. Three moods, quiet under the typing:
//   1 Rain: rain on the window, drops left and right, slow soft chords.
//   2 Night piano: sparse notes of a minor pentatonic over a low drone, with
//     an echo.
//   3 Fireplace: a fire's rumble and crackles under warm, slow chords.
// Separate from the typewriter keys (focusWriterTools.js typewriterSound).

export const MUSIC_TRACKS = [1, 2, 3];
const MUSIC_KEY = 'focusWriterMusic';
const FADE = 1.5;

/** The track the viewer last chose (0 = off), a setting kept on this device. */
export function readMusicPref() {
  try {
    const n = Number(localStorage.getItem(MUSIC_KEY));
    return MUSIC_TRACKS.includes(n) ? n : 0;
  } catch { return 0; }
}

export function saveMusicPref(n) {
  try { localStorage.setItem(MUSIC_KEY, String(n || 0)); } catch { /* private mode */ }
}

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

function noiseBuffer(ctx, seconds, brown = false) {
  const buf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < d.length; i += 1) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
  }
  return buf;
}

// A room: a stereo impulse of decaying noise.
function reverb(ctx, seconds = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  const node = ctx.createConvolver();
  node.buffer = buf;
  return node;
}

/**
 * The music player: `play(track)` fades the old track out and the new one in,
 * `play(0)` is off, `close()` lets go of the audio. Null where Web Audio is
 * missing. Create it from a click or a key (browsers start audio only then).
 */
export function createFocusMusic() {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return null;
  let ctx;
  try { ctx = new Ctx(); } catch { return null; }

  const master = ctx.createGain();
  master.gain.value = 0.5;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  const room = reverb(ctx, 3.2);
  const roomOut = ctx.createGain();
  roomOut.gain.value = 0.6;
  room.connect(roomOut).connect(master);
  const white = noiseBuffer(ctx, 3);
  const brown = noiseBuffer(ctx, 4, true);

  let current = null; // { bus, timers, nodes }

  // A track's own bus (faded in and out) and its loops, all stopped together.
  function makeTrack() {
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0, ctx.currentTime);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + FADE);
    bus.connect(master);
    const wet = ctx.createGain();
    wet.connect(room);
    const track = { bus, wet, timers: [], sources: [] };
    track.loop = (fn, delay) => {
      const run = () => { fn(); track.timers.push(setTimeout(run, delay())); };
      track.timers.push(setTimeout(run, delay()));
    };
    track.source = (node) => { track.sources.push(node); return node; };
    return track;
  }

  function noise(track, buffer, filters, gain) {
    const src = track.source(ctx.createBufferSource());
    src.buffer = buffer;
    src.loop = true;
    let node = src;
    for (const [type, freq, q = 0.7] of filters) {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.value = gain;
    node.connect(g).connect(track.bus);
    src.start();
    return g;
  }

  // A short filtered burst (a drop, a crackle), placed left or right.
  function burst(track, { freq, q, gain, length, type = 'bandpass' }) {
    const at = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + length);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = rand(-0.8, 0.8);
    src.connect(f).connect(g);
    (pan ? g.connect(pan) : g).connect(track.bus);
    src.start(at, rand(0, 2));
    src.stop(at + length + 0.05);
  }

  // A chord held for `seconds`: soft oscillators, slow in and out, into the room.
  function chord(track, notes, seconds, { type = 'triangle', cutoff = 900, gain = 0.035 } = {}) {
    const at = ctx.currentTime;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + seconds * 0.35);
    g.gain.linearRampToValueAtTime(0, at + seconds * 1.05);
    f.connect(g);
    g.connect(track.bus);
    g.connect(track.wet);
    for (const n of notes) {
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = hz(n);
        o.detune.value = detune;
        o.connect(f);
        o.start(at);
        o.stop(at + seconds * 1.1);
      }
    }
  }

  // A piano-ish note: a sine and its octave, struck and dying away.
  function note(track, midi, gain, echo) {
    const at = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 3.2);
    g.connect(track.bus);
    g.connect(track.wet);
    if (echo) g.connect(echo);
    for (const [mult, level] of [[1, 1], [2, 0.25], [3, 0.08]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = hz(midi) * mult;
      const lg = ctx.createGain();
      lg.gain.value = level;
      o.connect(lg).connect(g);
      o.start(at);
      o.stop(at + 3.3);
    }
  }

  function drone(track, midis, gain) {
    for (const m of midis) {
      const o = track.source(ctx.createOscillator());
      o.type = 'sine';
      o.frequency.value = hz(m);
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = track.source(ctx.createOscillator());
      lfo.frequency.value = rand(0.03, 0.08);
      const depth = ctx.createGain();
      depth.gain.value = gain * 0.6;
      lfo.connect(depth).connect(g.gain);
      o.connect(g);
      g.connect(track.bus);
      g.connect(track.wet);
      o.start();
      lfo.start();
    }
  }

  const TRACKS = {
    1: (track) => {
      noise(track, white, [['highpass', 500], ['lowpass', 6500]], 0.07);
      noise(track, brown, [['lowpass', 380]], 0.18);
      track.loop(() => burst(track, { freq: rand(1800, 5200), q: 4, gain: rand(0.02, 0.07), length: rand(0.02, 0.05) }), () => rand(40, 160));
      const chords = [[57, 60, 64, 67], [53, 57, 60, 64], [48, 55, 60, 64], [55, 59, 62, 64]];
      let i = 0;
      const next = () => { chord(track, chords[i % chords.length], 9); i += 1; };
      next();
      track.loop(next, () => 8000);
    },
    2: (track) => {
      drone(track, [38, 45], 0.035);
      const echo = ctx.createDelay(1);
      echo.delayTime.value = 0.42;
      const fb = ctx.createGain();
      fb.gain.value = 0.32;
      const echoOut = ctx.createGain();
      echoOut.gain.value = 0.35;
      echo.connect(fb).connect(echo);
      echo.connect(echoOut).connect(track.bus);
      const scale = [62, 65, 67, 69, 72, 74, 77, 79, 81];
      let last = 69;
      track.loop(() => {
        // Small steps mostly, so it sings rather than jumps.
        const near = scale.filter((m) => Math.abs(m - last) <= 5 && m !== last);
        last = pick(near.length ? near : scale);
        note(track, last, rand(0.05, 0.09), echo);
        if (Math.random() < 0.2) note(track, last - 12, 0.04, null);
      }, () => rand(700, 2200));
    },
    3: (track) => {
      const rumble = noise(track, brown, [['lowpass', 520]], 0.22);
      track.loop(() => {
        rumble.gain.linearRampToValueAtTime(rand(0.14, 0.28), ctx.currentTime + 0.8);
      }, () => 900);
      track.loop(() => {
        const pops = Math.random() < 0.15 ? Math.floor(rand(2, 5)) : 1;
        for (let k = 0; k < pops; k += 1) {
          setTimeout(() => burst(track, { freq: rand(1500, 4000), q: 1, gain: rand(0.05, 0.25), length: rand(0.006, 0.025), type: 'highpass' }), k * rand(20, 70));
        }
      }, () => rand(60, 520));
      const chords = [[53, 57, 60, 64], [52, 55, 59, 62], [50, 53, 57, 60], [48, 52, 55, 59]];
      let i = 0;
      const next = () => { chord(track, chords[i % chords.length], 11, { type: 'sawtooth', cutoff: 520, gain: 0.022 }); i += 1; };
      next();
      track.loop(next, () => 10000);
    },
  };

  function stopTrack(track) {
    if (!track) return;
    for (const tm of track.timers) clearTimeout(tm);
    track.timers.length = 0;
    track.loop = () => {};
    const at = ctx.currentTime;
    track.bus.gain.cancelScheduledValues(at);
    track.bus.gain.setValueAtTime(track.bus.gain.value, at);
    track.bus.gain.linearRampToValueAtTime(0, at + FADE);
    setTimeout(() => {
      for (const s of track.sources) { try { s.stop(); } catch { /* already stopped */ } }
      track.bus.disconnect();
      track.wet.disconnect();
    }, FADE * 1000 + 100);
  }

  return {
    play(n) {
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      stopTrack(current);
      current = null;
      if (!TRACKS[n]) return;
      current = makeTrack();
      TRACKS[n](current);
    },
    resume() { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); },
    close() {
      stopTrack(current);
      current = null;
      setTimeout(() => ctx.close().catch(() => {}), FADE * 1000 + 200);
    },
  };
}
