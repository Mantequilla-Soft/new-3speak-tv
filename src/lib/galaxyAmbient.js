// Background music for the Hive galaxy (page/Galaxy.jsx), made on the spot
// with the Web Audio API: no files to load, nothing to license. Slow pads
// drift through a few calm chords and wander left and right, under a long
// reverb, with now and then a faint high chime like a star coming out.
//
// const music = createAmbient(); music.start(); music.stop(); music.dispose();
// start() has to follow a click or key press (browsers block sound before one).

const VOLUME = 0.16;
const CHORD_MS = 11000; // each chord's turn
const FADE_S = 6; // pads swell in and out this slowly

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// D Lydian-ish voicings: open fifths and ninths, nothing that resolves.
const CHORDS = [
  [50, 57, 64, 66, 69], // D  A  E  F# A
  [47, 54, 62, 66, 73], // B  F# D  F# C#
  [43, 50, 59, 64, 66], // G  D  B  E  F#
  [45, 52, 61, 64, 68], // A  E  C# E  G#
];
const CHIMES = [74, 76, 78, 81, 83, 86, 88]; // D major pentatonic-ish, up high

// A few seconds of fading stereo noise: a big, soft room for everything.
function makeReverb(ctx, seconds = 5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.5;
  }
  const node = ctx.createConvolver();
  node.buffer = buf;
  return node;
}

export function createAmbient() {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!Ctx) return { start() {}, stop() {}, dispose() {}, supported: false };

  let ctx = null;
  let master;
  let bus;
  let filter;
  let voices = []; // { oscs, gain }
  let chordTimer = 0;
  let chimeTimer = 0;
  let chord = 0;
  let playing = false;

  const build = () => {
    ctx = new Ctx();
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);

    const reverb = makeReverb(ctx);
    const wet = ctx.createGain();
    wet.gain.value = 0.85;
    const dry = ctx.createGain();
    dry.gain.value = 0.35;
    reverb.connect(wet).connect(master);
    dry.connect(master);

    // Everything goes through one soft low-pass that slowly breathes.
    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.4;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.04;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 450;
    lfo.connect(lfoDepth).connect(filter.frequency);
    lfo.start();

    bus = ctx.createGain();
    bus.connect(filter);
    filter.connect(dry);
    filter.connect(reverb);
  };

  // One pad note: two slightly detuned oscillators, drifting in the stereo field.
  const voice = (midi, when) => {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.11 / (1 + (midi - 45) / 24), when + FADE_S);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const oscs = [-7, 7].map((cents, i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'triangle' : 'sine';
      o.frequency.value = hz(midi);
      o.detune.value = cents;
      o.connect(gain);
      o.start(when);
      return o;
    });
    if (pan) {
      const drift = ctx.createOscillator();
      drift.frequency.value = 0.02 + Math.random() * 0.05;
      const depth = ctx.createGain();
      depth.gain.value = 0.7;
      drift.connect(depth).connect(pan.pan);
      drift.start(when);
      oscs.push(drift);
      gain.connect(pan).connect(bus);
    } else {
      gain.connect(bus);
    }
    return { oscs, gain };
  };

  const release = (list, when) => {
    list.forEach(({ oscs, gain }) => {
      gain.gain.cancelScheduledValues(when);
      gain.gain.setValueAtTime(gain.gain.value, when);
      gain.gain.linearRampToValueAtTime(0, when + FADE_S);
      oscs.forEach((o) => o.stop(when + FADE_S + 0.1));
    });
  };

  const nextChord = () => {
    const now = ctx.currentTime;
    release(voices, now);
    voices = CHORDS[chord % CHORDS.length].map((m) => voice(m, now));
    chord += 1;
    chordTimer = setTimeout(nextChord, CHORD_MS);
  };

  const chime = () => {
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz(CHIMES[Math.floor(Math.random() * CHIMES.length)]);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.035, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 3.5);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; o.connect(g).connect(pan).connect(bus); } else o.connect(g).connect(bus);
    o.start(now);
    o.stop(now + 3.6);
    chimeTimer = setTimeout(chime, 2500 + Math.random() * 5500);
  };

  return {
    supported: true,
    start() {
      if (playing) return;
      playing = true;
      if (!ctx) build();
      ctx.resume();
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(VOLUME, now + 3);
      nextChord();
      chimeTimer = setTimeout(chime, 4000);
    },
    stop() {
      if (!playing || !ctx) return;
      playing = false;
      clearTimeout(chordTimer);
      clearTimeout(chimeTimer);
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(master.gain.value, now);
      master.gain.linearRampToValueAtTime(0, now + 1.5);
      release(voices, now);
      voices = [];
    },
    dispose() {
      clearTimeout(chordTimer);
      clearTimeout(chimeTimer);
      playing = false;
      voices = [];
      if (ctx) ctx.close();
      ctx = null;
    },
  };
}
