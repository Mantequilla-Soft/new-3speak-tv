import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  loadThree, hasWebGL, prefersReducedMotion, createRenderer, disposeTree, PALETTE,
} from '../../lib/three3d';

// Calm on purpose: gentle settling, nothing bouncing or flying.
// One scene behind the whole recap; each slide picks a `mode` and a `count`.
// Desktop: the scene only moves with the mouse (parallax), never by itself, so
// the two don't fight. Touch screens have no pointer to follow, so there the
// scenes turn slowly by themselves instead.
//   ring    — the creator's thumbnails on a slowly turning ring (intro, top video, outro)
//   gallery — every video of a list as a big tile, shorts on top (uploads, watched)
//   pillars — income by source, one labelled pillar each (optionally stacked)
//   helix   — the creator's thumbnails climbing a slow helix (outro)
//   graph   — watch time per week as 3D bars (watch time; `values`)
//   tower   — one block per hour watched, stacking up (watch time without a series)
//   orbit   — one dot per play circling (audience)
//   fan     — the top three videos as a hand of big cards (top videos + supporters)
//   stars   — accounts followed this year, linked to a red centre
//   islands — communities posted in, one floating disc each (`values` = posts)
//   ladder  — the best leaderboard spot as a staircase from #1, the account on its step

const MEDAL = [0xe6b800, 0xa8b3bd, 0xc8834d];
const EMPTY = [];
const NO_META = {};
const NO_PRELOAD = { long: [], short: [] };
const NO_THUMBS = { long: [], short: [], top: [], watched: [] };
const TILE_COLORS = [PALETTE.red, PALETTE.white, PALETTE.grey];
// How far (world units) the camera follows the pointer at the stage's edge.
const PARALLAX_X = 1.2;
const PARALLAX_Y = 0.7;
const CAMERA_RISE = 0.35; // share of the vertical parallax allowed upwards
const RING_TILT = 0.42; // the ring's steepest tilt either way (radians)
const GALLERY_PAD = 0.8; // how far past a gallery's outer tiles the camera may go
// Pointer steering of the ring (radians per second at the stage's edge) and
// the graph's tilt range (radians at the top / bottom edge).
const STEER_SPEED = 0.9;
const TILT_RANGE = 0.3;
const IN_MS = 900; // how long a mode takes to settle in
const OUT_MS = 350;

// Pointer position -> -1..1 along one axis, tracked over the WHOLE window:
// across the stage it runs to ±INSIDE_REACH at the stage's edges, and beyond
// them on to ±1 at the window's edges, so the effect keeps following the
// mouse outside the stage without a jump at its border.
const INSIDE_REACH = 0.8;
function towardEdge(p, lo, hi, max) {
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2 || 1;
  const d = p - mid;
  if (Math.abs(d) <= half) return (d / half) * INSIDE_REACH;
  const room = d < 0 ? lo : max - hi; // window space beyond the stage on that side
  const beyond = room > 0 ? Math.min(1, (Math.abs(d) - half) / room) : 1;
  return Math.sign(d) * (INSIDE_REACH + (1 - INSIDE_REACH) * beyond);
}

const easeOut = (k) => 1 - (1 - k) ** 3;
const clamp01 = (k) => Math.min(1, Math.max(0, k));

// Deterministic "random" so a slide looks the same every time it is shown.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A video tile: a thin box in one of the tile colours (its edges stay that
// colour, the "grid"), whose two big faces show one of the creator's real
// thumbnails once it has loaded (see thumbs in RecapScene).
// Shorts tiles are portrait and take the shorts' own (portrait) thumbnails.
const TILE_ASPECT = 16 / 9;
const SHORT_ASPECT = 9 / 16;

function tileMesh(THREE, geo, color, slot, kind = 'long') {
  const edge = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
  const face = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, [edge, edge, edge, edge, face, face]);
  mesh.userData.thumbSlot = slot;
  mesh.userData.thumbKind = kind;
  mesh.userData.face = face;
  return mesh;
}

// Bar graph geometry, shared with the hover picking below.
const GRAPH_WIDTH = 10;
const GRAPH_SLOT = 0.42; // per week when a whole year is shown (pans)
const PILLAR_MAX = 2.3; // tallest income pillar (world units)
const LADDER_MAX = 1.9; // tallest leaderboard step (world units)
const GRAPH_HEIGHT = 3.1;

// A short grey text label that always faces the camera (graph months).
// A text label that always faces the camera. One grey line by default (graph
// months); `lines` gives centred lines, the first bold (island names).
function textSprite(THREE, text, { lines = null, width = 1.1, onTop = false } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  if (lines) {
    canvas.width = 512;
    canvas.height = 64 * lines.length + 16;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Dark edge so the label reads over anything behind it.
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 10;
    lines.forEach((line, i) => {
      ctx.font = font(i === 0 ? 700 : 500, i === 0 ? 40 : 30);
      ctx.fillStyle = i === 0 ? '#f5f5f5' : '#bdbdbd';
      const fitted = ctx.measureText(line).width > 490 ? `${line.slice(0, 22)}…` : line;
      ctx.fillText(fitted, 256, 40 + i * 60);
    });
  } else {
    canvas.width = 256;
    canvas.height = 64;
    ctx.fillStyle = '#9e9e9e';
    ctx.font = font(600, 34);
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 4, 34);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // onTop: never hidden behind the scene's own objects (island names).
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: !onTop }));
  sprite.scale.set(width, width * (canvas.height / canvas.width), 1);
  if (onTop) sprite.renderOrder = 10;
  return sprite;
}

function buildMode(THREE, mode, count, values = [], meta = {}) {
  const group = new THREE.Group();
  const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05 });
  const items = []; // { obj, from, to, delay } for the settle-in
  const rand = rng(count * 31 + mode.length);

  if (mode === 'ring') {
    const n = 16;
    const geo = new THREE.BoxGeometry(1.6, 0.9, 0.06);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const m = tileMesh(THREE, geo, TILE_COLORS[i % 3], i);
      m.position.set(Math.cos(a) * 4.6, 0, Math.sin(a) * 4.6);
      m.lookAt(0, 0, 0);
      group.add(m);
    }
    group.rotation.x = 0.28;
    group.position.set(0, -0.6, -4);
    group.userData.spin = (t) => { group.rotation.y = t * 0.08; };
    // Desktop: the pointer steers it (left half turns it one way, right the
    // other) and tips it towards / away from you as it moves up and down.
    group.userData.steer = true;
    // Mouse low: seen from above, mouse high: from below, both at most
    // RING_TILT (the angle the user picked); centred = level.
    group.userData.tiltBase = 0;
    group.userData.tiltRange = RING_TILT;
    group.userData.tiltDown = RING_TILT;
    return { group, items };
  }

  if (mode === 'gallery') {
    // Every video of a list as a big tile: shorts (portrait) in the rows on
    // top, videos (16:9) below. Far bigger than the view: on desktop the mouse
    // slides the camera across it and the wheel zooms (see RecapScene); on
    // touch a drag moves across. meta = { longThumbs, shortThumbs } (URLs,
    // one per tile, in order); each tile reports { type: 'tile', kind, index }.
    const longs = meta.longThumbs || [];
    const shorts = meta.shortThumbs || [];
    const nV = longs.length;
    const nS = shorts.length;
    const vW = 2.3; const vH = 1.29; const vGap = 0.25;
    const sW = 0.95; const sH = 1.69; const sGap = 0.2;
    const colsV = Math.max(1, Math.min(nV, 16, Math.ceil(Math.sqrt(nV * 1.8))));
    const widthV = colsV * (vW + vGap);
    const colsS = Math.max(1, Math.min(nS, Math.floor(Math.max(widthV, 9) / (sW + sGap))));
    const rowsV = Math.ceil(nV / colsV);
    const rowsS = Math.ceil(nS / colsS);
    const height = rowsS * (sH + sGap) + (nV && nS ? 0.6 : 0) + rowsV * (vH + vGap);
    const width = Math.max(widthV, Math.min(nS, colsS) * (sW + sGap));
    const top = height / 2;
    const geoV = new THREE.BoxGeometry(vW, vH, 0.06);
    const geoS = new THREE.BoxGeometry(sW, sH, 0.06);
    let k = 0;
    const place = (n, cols, w, h, gap, y0, geo, kind, urls) => {
      for (let i = 0; i < n; i += 1) {
        const r = Math.floor(i / cols);
        const inRow = Math.min(cols, n - r * cols);
        const c = i % cols;
        const m = tileMesh(THREE, geo, TILE_COLORS[(i + (kind === 'short' ? 1 : 0)) % 3], i, kind);
        m.userData.thumbUrl = urls[i] || null;
        m.userData.pick = { type: 'tile', kind, index: i };
        const to = new THREE.Vector3((c - (inRow - 1) / 2) * (w + gap), y0 - h / 2 - r * (h + gap), 0);
        m.position.copy(to);
        items.push({ obj: m, from: new THREE.Vector3(to.x, to.y - 1.2, to.z), to, delay: Math.min((k += 1) * 6, 900) });
        group.add(m);
      }
    };
    place(nS, colsS, sW, sH, sGap, top, geoS, 'short', shorts);
    place(nV, colsV, vW, vH, vGap, top - rowsS * (sH + sGap) - (nV && nS ? 0.6 : 0), geoV, 'long', longs);
    group.position.set(0, 0, -6);
    group.userData.gallery = { halfW: width / 2, halfH: height / 2, zoomStart: meta.zoomStart ?? 0.5 };
    group.userData.spin = (t) => { group.rotation.y = Math.sin(t * 0.25) * 0.03; };
    return { group, items };
  }

  if (mode === 'pillars') {
    // Income by source: one pillar each (identity is the label under it and
    // its place in the row), height = its amount, which also stands on top.
    // A pillar can be stacked: meta.stacks[i] = [part, part, part?] (bottom
    // first), drawn red, dark grey, light grey (post rewards: on 3Speak /
    // elsewhere; ads: as creator / as viewer / combined). Inside a pillar the
    // parts keep their true shares; only the pillar's height is logarithmic.
    // values = amounts (one currency); meta.labels = [{ title, value }].
    const vals = values.length ? values : [0];
    const labels = meta.labels || [];
    const stacks = meta.stacks || [];
    const n = vals.length;
    // Log scale (of cents): tips of a few cents and rewards in the hundreds
    // both stay visible. The exact amounts ride on top of the pillars.
    const logOf = (v) => Math.log10(1 + Math.max(0, v) * 100);
    const maxLog = Math.max(...vals.map(logOf), 1e-9);
    // Closer together on a narrow (phone) screen: the row fits the view.
    const fit = meta.viewWidth ? (meta.viewWidth * 0.86) / Math.max(n, 1) : Infinity;
    const spacing = Math.min(2.6, 9 / Math.max(n, 1), fit);
    const radius = Math.min(0.62, spacing * 0.3);
    const bars = [];
    vals.forEach((v, i) => {
      const h = Math.max(0.12, (logOf(v) / maxLog) * PILLAR_MAX);
      const x = (i - (n - 1) / 2) * spacing;
      // The pillar is a group of unit-height segments, scaled to h as it rises.
      const pillar = new THREE.Group();
      const parts = stacks[i] && stacks[i].some((p) => p > 0) ? stacks[i] : [v];
      const sum = parts.reduce((a2, b2) => a2 + b2, 0) || 1;
      const segColors = [PALETTE.red, PALETTE.grey, 0x6b6b6b];
      let y = 0;
      const meshes = [];
      parts.forEach((p, j) => {
        const frac = p / sum;
        if (frac <= 0) return;
        const geo = new THREE.CylinderGeometry(radius, radius, frac, 48);
        geo.translate(0, y + frac / 2, 0);
        const base = segColors[j] ?? PALETTE.red;
        const m = new THREE.Mesh(geo, mat(base));
        pillar.add(m);
        meshes.push({ mesh: m, base, part: j, top: y + frac });
        y += frac;
      });
      pillar.position.x = x;
      pillar.scale.y = 0.001;
      items.push({ obj: pillar, grow: true, h, delay: i * 140 });
      bars.push({ mesh: pillar, meshes, h, index: i });
      group.add(pillar);

      const cap = new THREE.Mesh(new THREE.RingGeometry(radius * 0.78, radius, 48), mat(PALETTE.white));
      cap.rotation.x = -Math.PI / 2;
      cap.position.set(x, h + 0.005, 0);
      cap.scale.set(0.001, 0.001, 0.001);
      items.push({ obj: cap, grow: true, h: 1, delay: i * 140 + IN_MS * 0.8, ring: true });
      group.add(cap);
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.35, radius * 1.45, 0.08, 48), mat(PALETTE.dark));
      plinth.position.set(x, -0.04, 0);
      group.add(plinth);
      if (labels[i]) {
        // Name under the pillar, amount riding up on top of it.
        const name = textSprite(THREE, '', { lines: [labels[i].title], width: Math.min(2.2, spacing * 0.95), onTop: true });
        name.position.set(x, -0.42, radius + 0.3);
        group.add(name);
        const amount = textSprite(THREE, '', { lines: [labels[i].value], width: Math.min(2.4, spacing), onTop: true });
        const to = new THREE.Vector3(x, h + 0.45, 0);
        amount.position.copy(to);
        items.push({ obj: amount, from: new THREE.Vector3(x, 0.3, 0), to, delay: i * 140 });
        group.add(amount);
      }
    });
    // Low enough that the tallest pillar and its amount stay under the
    // slide's text block (headline, legends, notes).
    group.position.set(0, -2.75, -1.5);
    group.rotation.x = 0.14;
    group.userData.tiltBase = 0.14;
    group.userData.tiltRange = 0.18;
    group.userData.tiltDown = 0.12;
    group.userData.bars = bars;
    group.userData.slot = spacing;
    group.userData.barColors = { base: PALETTE.red, hover: PALETTE.white };
    group.userData.spin = (t) => { group.rotation.y = Math.sin(t * 0.3) * 0.12; };
    return { group, items };
  }

  if (mode === 'helix') {
    // Outro: the creator's thumbnails climbing a slow helix. Desktop: the
    // pointer turns it (left / right) like the intro ring, but it is a tower,
    // not a wheel.
    const n = 30;
    const geo = new THREE.BoxGeometry(1.5, 0.84, 0.05);
    const radius = 3.2;
    const turns = 2.2;
    for (let i = 0; i < n; i += 1) {
      const k = i / (n - 1);
      const a = k * turns * Math.PI * 2;
      const m = tileMesh(THREE, geo, TILE_COLORS[i % 3], i, 'long');
      const to = new THREE.Vector3(Math.cos(a) * radius, -3.2 + k * 6.4, Math.sin(a) * radius);
      m.position.copy(to);
      m.lookAt(0, to.y, 0);
      m.rotateY(Math.PI); // faces outwards, towards the viewer when in front
      items.push({ obj: m, from: new THREE.Vector3(to.x, to.y - 2, to.z), to, delay: i * 35 });
      group.add(m);
    }
    group.position.set(0, -0.3, -4.5);
    group.rotation.x = 0.08;
    group.userData.spin = (t) => { group.rotation.y = t * 0.12; };
    group.userData.steer = true;
    group.userData.tiltBase = 0.08;
    group.userData.tiltRange = 0.2;
    group.userData.tiltDown = 0.2;
    return { group, items };
  }

  if (mode === 'tower') {
    const n = Math.min(Math.max(count, 1), 48);
    const h = 0.26;
    const geo = new THREE.BoxGeometry(1.5, h, 1.5);
    for (let i = 0; i < n; i += 1) {
      const m = new THREE.Mesh(geo, mat(i % 2 ? PALETTE.grey : PALETTE.red));
      const to = new THREE.Vector3(0, i * (h + 0.04), 0);
      m.position.copy(to);
      m.rotation.y = i * 0.06;
      items.push({ obj: m, from: new THREE.Vector3(0, to.y + 1.2, 0), to, delay: Math.min(i * 40, 1600) });
      group.add(m);
    }
    const height = n * (h + 0.04);
    const fit = Math.min(1, 6.4 / height);
    group.scale.setScalar(fit);
    group.position.set(2.6, -3.2, -2);
    group.userData.spin = (t) => { group.rotation.y = t * 0.12; };
    return { group, items };
  }

  if (mode === 'graph') {
    // One series, one colour: white bars, and the week under the pointer turns
    // 3Speak red (the best week is named in the slide's text). Thin gaps between
    // bars (about 18% of a slot), a recessive grey floor as the baseline.
    // A whole year is wider than the view: it pans (wheel / drag, see
    // RecapScene) and opens on meta.focus, the current week. `null` values are
    // weeks still to come: floor only, no bar.
    const vals = values.length ? values : [0];
    const n = vals.length;
    const max = Math.max(...vals.map((v) => v || 0), 1);
    const slot = n > 20 ? GRAPH_SLOT : Math.min(GRAPH_WIDTH / n, 0.9);
    const width = slot * n;
    const barW = slot * 0.82;
    const floor = new THREE.Mesh(new THREE.BoxGeometry(width + 0.4, 0.04, 1.1), mat(PALETTE.grey));
    floor.position.y = -0.02;
    group.add(floor);
    const geo = new THREE.BoxGeometry(barW, 1, 0.55);
    geo.translate(0, 0.5, 0);
    const bars = [];
    const xAt = (i) => -width / 2 + slot * (i + 0.5);
    vals.forEach((v, i) => {
      if (v == null) return;
      const m = new THREE.Mesh(geo, mat(PALETTE.white));
      const h = Math.max(0.03, (v / max) * GRAPH_HEIGHT);
      m.position.x = xAt(i);
      m.scale.y = 0.001;
      items.push({ obj: m, grow: true, h, delay: Math.min(i * 18, 1200) });
      bars.push({ mesh: m, h, index: i });
      group.add(m);
    });
    // Month names under the floor, at each month's first week.
    (meta.marks || []).forEach(({ index, label }) => {
      const sprite = textSprite(THREE, label);
      sprite.position.set(xAt(index) - slot / 2 + 0.45, -0.38, 0.4);
      group.add(sprite);
    });
    group.position.set(0, -3.3, -1);
    group.rotation.x = 0.12;
    group.userData.tiltBase = 0.12; // desktop: tilts with the pointer's height
    group.userData.bars = bars;
    group.userData.slot = slot;
    group.userData.pan = { width, focusX: meta.focus != null ? xAt(meta.focus) : 0 };
    group.userData.spin = (t) => { group.rotation.y = Math.sin(t * 0.3) * 0.05; };
    return { group, items };
  }

  if (mode === 'fan') {
    // The top videos as a hand of three big cards, the best in the middle and
    // in front. Their faces take the `top` thumbnails.
    const n = Math.min(Math.max(count, 1), 3);
    const geo = new THREE.BoxGeometry(2.6, 1.46, 0.07);
    const layout = n === 1
      ? [[0, 0, 0.3, 0, 0]]
      : n === 2
        ? [[-1.45, -0.05, 0, 0.22, 0.06], [1.45, -0.05, 0, -0.22, -0.06]]
        : [[-2.6, -0.25, -0.3, 0.32, 0.1], [0, 0.05, 0.35, 0, 0], [2.6, -0.25, -0.3, -0.32, -0.1]];
    // Order on screen: 2nd, 1st, 3rd, like a podium.
    const slots = n === 3 ? [1, 0, 2] : [0, 1];
    layout.forEach(([x, y, z, ry, rz], i) => {
      const m = tileMesh(THREE, geo, TILE_COLORS[i % 3], slots[i], 'top');
      m.position.set(x, y, z);
      m.rotation.set(0, ry, rz);
      items.push({ obj: m, from: new THREE.Vector3(x, y - 1.2, z), to: new THREE.Vector3(x, y, z), delay: [120, 0, 240][i] || 0 });
      group.add(m);
    });
    group.position.set(0, -0.35, -2);
    group.userData.spin = (t) => { group.rotation.y = Math.sin(t * 0.35) * 0.15; };
    return { group, items };
  }

  if (mode === 'stars') {
    // Accounts followed this year: stars around a red centre (you), each
    // joined to it by a faint line. Desktop: the pointer steers it.
    const n = Math.min(Math.max(count, 1), 70);
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const centre = new THREE.Mesh(geo, mat(PALETTE.red));
    centre.scale.setScalar(0.35);
    group.add(centre);
    const pts = [];
    for (let i = 0; i < n; i += 1) {
      const u = rand() * 2 - 1;
      const a = rand() * Math.PI * 2;
      const r = 2.2 + rand() * 2.6;
      const q = Math.sqrt(1 - u * u);
      const to = new THREE.Vector3(Math.cos(a) * q * r, u * r * 0.6, Math.sin(a) * q * r);
      const m = new THREE.Mesh(geo, mat(PALETTE.white));
      m.scale.setScalar(0.07 + rand() * 0.07);
      m.position.copy(to);
      items.push({ obj: m, from: new THREE.Vector3(0, 0, 0), to, delay: Math.min(i * 20, 1200) });
      group.add(m);
      pts.push(new THREE.Vector3(), to);
    }
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: PALETTE.grey, transparent: true, opacity: 0.6 }),
    );
    group.add(lines);
    group.position.set(0, -0.2, -2.5); // centred behind the slide's cards
    group.rotation.x = 0.2;
    group.userData.spin = (t) => { group.rotation.y = t * 0.1; };
    group.userData.steer = true;
    return { group, items };
  }

  if (mode === 'islands') {
    // Communities posted in: a slim dark disc each (a thin red ring on top),
    // sized a little by posts, with the community's picture standing on it as
    // a round standee and its name + post count in front, always readable.
    // values = post counts, biggest first; meta.items = [{ name, avatar, title,
    // label }] in the same order.
    const vals = (values.length ? values : [1]).slice(0, 5);
    const infos = meta.items || [];
    const max = Math.max(...vals, 1);
    const n = vals.length;
    const islands = [];
    // Fit the row: 4-5 communities sit closer, with smaller labels.
    const spacing = Math.min(3.1, 8.4 / Math.max(n, 1));
    vals.forEach((v, i) => {
      const k = Math.sqrt(v / max);
      const fit = Math.min(1, spacing / 3.1); // smaller discs when they sit closer
      const r = (0.75 + 0.3 * k) * fit;
      const island = new THREE.Group();
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.04, 0.12, 64), [
        mat(PALETTE.dark), mat(PALETTE.grey), mat(PALETTE.dark), // side, top, bottom
      ]);
      island.add(disc);
      const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.84, r * 0.9, 64), mat(PALETTE.red));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.062;
      island.add(ring);

      // Standee: a short post, then the round picture in a white rim.
      const pic = (0.7 + 0.12 * k) * Math.max(0.8, fit);
      const lift = 0.32;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, lift + 0.1, 12), mat(PALETTE.grey));
      post.position.y = (lift + 0.1) / 2;
      island.add(post);
      const cy = lift + pic;
      const rim = new THREE.Mesh(new THREE.CircleGeometry(pic + 0.05, 64), mat(PALETTE.white));
      rim.position.set(0, cy, -0.01);
      island.add(rim);
      const face = new THREE.Mesh(new THREE.CircleGeometry(pic, 64), new THREE.MeshStandardMaterial({ color: PALETTE.grey, roughness: 0.8 }));
      face.position.set(0, cy, 0.005);
      face.userData.avatarUrl = infos[i]?.avatar || null;
      face.userData.avatarLetter = infos[i]?.title || infos[i]?.name || '?';
      face.userData.pick = infos[i]?.name ? { type: 'community', name: infos[i].name } : null;
      island.add(face);
      const back = new THREE.Mesh(new THREE.CircleGeometry(pic + 0.05, 64), mat(PALETTE.dark));
      back.rotation.y = Math.PI;
      back.position.set(0, cy, -0.02);
      island.add(back);

      if (infos[i]) {
        const label = textSprite(THREE, '', { lines: [infos[i].title, infos[i].label], width: Math.min(2.3, spacing * 0.95), onTop: true });
        label.position.set(0, -0.45, r + 0.2); // in front of the disc's rim
        island.add(label);
      }

      const x = (i - (n - 1) / 2) * spacing;
      const to = new THREE.Vector3(x, 0, 0);
      island.position.copy(to);
      items.push({ obj: island, from: new THREE.Vector3(x, -1.4, 0), to, delay: i * 120 });
      islands.push({ g: island, phase: i * 1.3 });
      group.add(island);
    });
    group.position.set(0, -2.2, -1.5);
    group.rotation.x = 0.18; // a slight look down onto the discs
    // Wider than a phone: drag it sideways (see setupPan), opening centred.
    group.userData.pan = { width: (n - 1) * spacing + 2.6, focusX: 0, centred: true };
    group.userData.spin = (t) => {
      islands.forEach((d) => { d.g.position.y = Math.sin(t * 0.8 + d.phase) * 0.08; });
    };
    group.userData.tiltBase = 0.18;
    group.userData.tiltRange = 0.12;
    return { group, items };
  }

  if (mode === 'orbit') {
    const n = Math.min(Math.max(count, 3), 160);
    const geo = new THREE.SphereGeometry(1, 12, 8);
    const dots = [];
    for (let i = 0; i < n; i += 1) {
      const m = new THREE.Mesh(geo, mat(i % 9 === 0 ? PALETTE.red : PALETTE.white));
      m.scale.setScalar(0.05 + rand() * 0.07);
      dots.push({ m, r: 2.2 + rand() * 3.2, a: rand() * Math.PI * 2, speed: 0.05 + rand() * 0.12, tilt: (rand() - 0.5) * 0.9 });
      group.add(m);
    }
    group.position.z = -3;
    group.rotation.x = 0.35;
    group.userData.spin = (t) => {
      dots.forEach((d) => {
        const a = d.a + t * d.speed;
        d.m.position.set(Math.cos(a) * d.r, Math.sin(a) * d.r * d.tilt * 0.4, Math.sin(a) * d.r);
      });
    };
    group.userData.spin(0);
    return { group, items };
  }

  // ladder: the leaderboard the account placed best on, as real steps: one per
  // creator from #1 down, height = their number on that board. #1-3 wear their
  // medal colours; the account's own step is red with its picture standing on
  // it (set a little apart when it comes after a gap in the ranking).
  // values = the steps' numbers; meta = { mine: index of the account's step,
  // gapBeforeMine, avatar, rank }. Hovering a step reports it (onBarHover).
  const vals = values.length ? values : [1];
  const n = vals.length;
  const max = Math.max(...vals, 1);
  const mine = Math.min(Math.max(meta.mine ?? 0, 0), n - 1);
  const rank = meta.rank || mine + 1;
  const stepW = 0.62;
  const gap = 0.08;
  const extra = meta.gapBeforeMine ? 0.5 : 0;
  const width = n * (stepW + gap) + extra;
  const xOf = (i) => -width / 2 + (stepW + gap) * (i + 0.5) + (meta.gapBeforeMine && i >= mine ? extra : 0);
  const steps = [];
  for (let i = 0; i < n; i += 1) {
    const h = Math.max(0.25, (vals[i] / max) * LADDER_MAX);
    const geo = new THREE.BoxGeometry(stepW, 1, 1.1);
    geo.translate(0, 0.5, 0);
    const top = i === mine ? PALETTE.red : i < 3 && !(meta.gapBeforeMine && i >= mine) ? MEDAL[i] : PALETTE.grey;
    const side = i === mine ? PALETTE.redDark : PALETTE.dark;
    const m = new THREE.Mesh(geo, [mat(side), mat(side), mat(top), mat(side), mat(i === mine ? PALETTE.red : PALETTE.grey), mat(side)]);
    m.position.x = xOf(i);
    m.scale.y = 0.001;
    items.push({ obj: m, grow: true, h, delay: i * 45 });
    steps.push({ m, h, mesh: m, index: i });
    group.add(m);
  }
  const label = (text, i) => {
    const sp = textSprite(THREE, '', { lines: [text], width: 1.4, onTop: true });
    sp.position.set(steps[i].m.position.x, -0.35, 0.7);
    group.add(sp);
  };
  label('#1', 0);
  if (mine !== 0) label(`#${rank}`, mine);
  // Gap marker between the top of the board and the account's own step.
  if (meta.gapBeforeMine) {
    const dots = textSprite(THREE, '', { lines: ['…'], width: 1.2, onTop: true });
    dots.position.set((xOf(mine - 1) + xOf(mine)) / 2, 0.25, 0.7);
    group.add(dots);
  }

  // The account's picture on its step (rises with it).
  const pic = 0.42;
  const stand = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.CircleGeometry(pic + 0.05, 48), mat(PALETTE.white));
  const face = new THREE.Mesh(new THREE.CircleGeometry(pic, 48), new THREE.MeshStandardMaterial({ color: PALETTE.grey, roughness: 0.8 }));
  face.position.z = 0.005;
  face.userData.avatarUrl = meta.avatar || null;
  face.userData.avatarLetter = meta.letter || '?';
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10), mat(PALETTE.grey));
  post.position.y = -pic - 0.12;
  stand.add(rim, face, post);
  const standTo = new THREE.Vector3(steps[mine].m.position.x, steps[mine].h + pic + 0.27, 0);
  stand.position.copy(standTo);
  items.push({ obj: stand, from: new THREE.Vector3(standTo.x, 0.3, 0), to: standTo, delay: mine * 45 + 200 });
  group.add(stand);

  // Low enough that the tallest step, with the picture standing on it, stays
  // under the slide's text and rank cards.
  group.position.set(0, -3.05, -1.5);
  group.rotation.set(0.12, -0.22, 0);
  group.userData.tiltBase = 0.12;
  group.userData.tiltRange = 0.15;
  group.userData.tiltDown = 0.1;
  group.userData.spin = (t) => { group.rotation.y = -0.22 + Math.sin(t * 0.3) * 0.1; };
  // Hover reports the step under the pointer (same picking as the graph bars),
  // but keeps the steps' own colours.
  group.userData.bars = steps;
  group.userData.slot = stepW + gap;
  group.userData.keepColors = true;
  // Wider than the screen (long boards, phones): drag / scroll it sideways,
  // opening with the account's own step in the middle.
  group.userData.pan = { width: width + 1.5, focusX: xOf(mine), centreOnFocus: true };
  return { group, items };
}

/**
 * The 3D backdrop of the yearly recap. Renders nothing (the slide text stands
 * on its own) without WebGL or if three.js fails to load.
 */
const RecapScene = forwardRef(function RecapScene({ mode, count, values = EMPTY, meta = NO_META, thumbs = NO_THUMBS, preload = NO_PRELOAD, frozen = false, onPreloadProgress, onBarHover, onPick, onPickHover }, ref) {
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  // The slide's mode, read by the scene when it finishes loading.
  const modeRef = useRef({ mode, count, values, meta });
  const hoverRef = useRef(onBarHover);
  hoverRef.current = onBarHover;
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const pickHoverRef = useRef(onPickHover);
  pickHoverRef.current = onPickHover;
  const thumbsRef = useRef(thumbs);
  const preloadRef = useRef(preload);
  // While the page has something locked open, the scene ignores the pointer.
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;
  const preloadProgressRef = useRef(onPreloadProgress);
  preloadProgressRef.current = onPreloadProgress;

  // Scene: built once.
  useEffect(() => {
    if (!hasWebGL()) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let cleanup = () => {};

    loadThree().then((THREE) => {
      if (cancelled) return;
      const { renderer, dispose } = createRenderer(THREE, host, { pixelRatioCap: 1.5 });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
      camera.position.set(0, 0, 10);
      scene.add(new THREE.AmbientLight(0xffffff, 1.3));
      const key = new THREE.DirectionalLight(0xffffff, 1.8);
      key.position.set(3, 5, 6);
      scene.add(key);

      const reduced = prefersReducedMotion();
      // A real mouse: follow it, and keep the scene still otherwise.
      const mouse = !!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches;
      const parallax = mouse && !reduced;
      const autoMove = !mouse && !reduced;
      let current = null; // { group, items, born }
      let hovered = -1; // graph bar under the pointer
      let hoveredSeg = null; // and, on a stacked bar, which segment
      let leaving = []; // { group, since }

      // Thumbnails, loaded once and shared by every tile that shows them.
      const loader = new THREE.TextureLoader();
      loader.setCrossOrigin('anonymous');
      const textures = new Map(); // url -> Promise<Texture | null>
      const texture = (url, tileAspect) => {
        const cacheKey = `${url}|${tileAspect}`;
        if (!textures.has(cacheKey)) {
          textures.set(cacheKey, new Promise((resolve) => {
            loader.load(url, (tex) => {
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.userData.shared = true;
              // Cover-fit into the tile's shape.
              const img = tex.image;
              const aspect = img && img.height ? img.width / img.height : tileAspect;
              if (aspect > tileAspect) {
                tex.repeat.x = tileAspect / aspect;
                tex.offset.x = (1 - tex.repeat.x) / 2;
              } else {
                tex.repeat.y = aspect / tileAspect;
                tex.offset.y = (1 - tex.repeat.y) / 2;
              }
              resolve(tex);
            }, undefined, () => resolve(null)); // a dead image keeps the plain tile
          }));
        }
        return textures.get(cacheKey);
      };
      const dressTiles = (group) => {
        const { long = [], short = [], top = [], watched = [] } = thumbsRef.current || {};
        group.traverse((obj) => {
          const slot = obj.userData?.thumbSlot;
          if (slot == null) return;
          if (obj.userData.thumbUrl !== undefined) {
            // Gallery tiles: their own video's thumbnail, nothing else.
            if (!obj.userData.thumbUrl) return;
            const face = obj.userData.face;
            texture(obj.userData.thumbUrl, obj.userData.thumbKind === 'short' ? SHORT_ASPECT : TILE_ASPECT).then((tex) => {
              if (!tex || !face) return;
              face.map = tex;
              face.color.set(0xffffff);
              face.needsUpdate = true;
            });
            return;
          }
          const kind = obj.userData.thumbKind;
          const isShort = kind === 'short';
          // A creator with only one kind still gets pictures on every tile.
          const list = kind === 'top'
            ? top
            : kind === 'watched'
              ? watched
            : (isShort ? short : long).length ? (isShort ? short : long) : (isShort ? long : short);
          if (!list.length) return;
          const face = obj.userData.face;
          if ((kind === 'top' || kind === 'watched') && slot >= list.length) return;
          // A thumbnail that won't load (old img.3speak.tv ones are gone) hands
          // over to the next one in the list, so tiles don't stay blank.
          const aspect = isShort ? SHORT_ASPECT : TILE_ASPECT;
          const fixed = kind === 'top' || kind === 'watched'; // slot = that exact video
          const attempt = (tries) => {
            if (tries >= (fixed ? 1 : Math.min(list.length, 6))) return;
            texture(list[(slot + tries) % list.length], aspect).then((tex) => {
              if (!face) return;
              if (!tex) { attempt(tries + 1); return; }
              face.map = tex;
              face.color.set(0xffffff);
              face.needsUpdate = true;
            });
          };
          attempt(0);
        });
      };

      // Panning a wide graph: how much is visible decides how far it may move.
      const viewWidthAt = (z) => {
        const dist = camera.position.z - z;
        return 2 * dist * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
      };
      const pan = { x: 0, target: 0, min: 0, max: 0 };
      const setupPan = (group) => {
        const p = group.userData.pan;
        if (!p) { pan.x = 0; pan.target = 0; pan.min = 0; pan.max = 0; return; }
        const view = viewWidthAt(group.position.z) * 0.92;
        const spare = Math.max(0, (p.width - view) / 2);
        pan.min = -spare;
        pan.max = spare;
        // Open with the focus (this week) at three quarters of the view, or
        // centred (a row that is only wider than a phone).
        const want = p.centred ? 0 : p.centreOnFocus ? -p.focusX : view * 0.25 - p.focusX;
        pan.target = Math.min(pan.max, Math.max(pan.min, want));
        pan.x = pan.target;
        group.position.x = pan.x;
      };

      // Standees (islands, ladder): pictures drawn onto a white disc first.
      // A logo with a transparent background (corners see-through, like
      // 3Speak's) is fitted WHOLE inside the circle; a photo is cropped round
      // the way Hive shows avatars. Transparent pixels end up white, not black.
      const avatars = new Map(); // url -> Promise<Texture | null>
      // A list of addresses: the first that loads wins; none = a lettered disc.
      const avatarFrom = async (urls, letter) => {
        for (const u of [].concat(urls || [])) {
          if (!u) continue;
          // eslint-disable-next-line no-await-in-loop
          const tex = await avatarTexture(u);
          if (tex) return tex;
        }
        return letterTexture(letter);
      };
      const letterTexture = (letter) => {
        const size = 256;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.fillStyle = '#e53935';
        ctx.font = '800 140px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(letter || '?').slice(0, 1).toUpperCase(), size / 2, size / 2 + 8);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        return tex;
      };
      const avatarTexture = (url) => {
        if (!avatars.has(url)) {
          avatars.set(url, new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
              const size = 512;
              const canvas = document.createElement('canvas');
              canvas.width = size;
              canvas.height = size;
              const ctx = canvas.getContext('2d');
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, size, size);
              let logo = false;
              try {
                const probe = document.createElement('canvas');
                probe.width = 32;
                probe.height = 32;
                const pc = probe.getContext('2d');
                pc.drawImage(img, 0, 0, 32, 32);
                const corners = [[1, 1], [30, 1], [1, 30], [30, 30]].map(([x, y]) => pc.getImageData(x, y, 1, 1).data[3]);
                logo = corners.filter((a) => a < 40).length >= 3;
              } catch {
                // Unreadable pixels: treat it as a photo.
              }
              // Cover-crop to a square first, then (logos) shrink so the whole
              // square fits inside the circle.
              const side = Math.min(img.width, img.height);
              const sx = (img.width - side) / 2;
              const sy = (img.height - side) / 2;
              const drawn = logo ? size * 0.68 : size;
              const off = (size - drawn) / 2;
              ctx.drawImage(img, sx, sy, side, side, off, off, drawn, drawn);
              const tex = new THREE.CanvasTexture(canvas);
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.userData.shared = true;
              resolve(tex);
            };
            img.onerror = () => resolve(null);
            img.src = url;
          }));
        }
        return avatars.get(url);
      };
      const dressAvatars = (group) => {
        group.traverse((obj) => {
          const url = obj.userData?.avatarUrl;
          if (!url) return;
          avatarFrom(url, obj.userData.avatarLetter).then((tex) => {
            if (!tex) return;
            obj.material.map = tex;
            obj.material.color.set(0xffffff);
            obj.material.needsUpdate = true;
          });
        });
      };

      // Gallery: how far the camera stands back (wheel zoom), within limits
      // that run from close-up to the whole gallery in view.
      const zoom = { d: 10, target: 10, min: 3.5, max: 10 };
      // Touch: where the camera stands over a gallery, in world units, moved
      // 1:1 with the finger (the grid stays under it, at any zoom).
      const touchCam = { x: 0, y: 0 };
      const galRange = { x: 0, up: 0, down: 0 }; // limits, worked out each frame
      const halfFov = (camera.fov * Math.PI) / 360;
      const setupZoom = (group) => {
        const g = group.userData.gallery;
        if (!g) return;
        const fit = Math.max(g.halfH / Math.tan(halfFov), g.halfW / (Math.tan(halfFov) * camera.aspect)) * 1.08;
        zoom.max = Math.max(zoom.min + 1, fit);
        // Start where the slide asks: 0 = close-up, 1 = the whole gallery.
        const startAt = g.zoomStart ?? 0;
        zoom.target = zoom.min + (zoom.max - zoom.min) * Math.min(1, Math.max(0, startAt));
        zoom.d = zoom.target;
        touchCam.x = 0;
        touchCam.y = 0;
      };

      let touchActionFor = () => {}; // set once the pointer handlers exist (below)
      let clearHover = () => {}; // likewise
      const setMode = (m, n, vals, meta) => {
        if (current) leaving.push({ group: current.group, since: performance.now() });
        hoverRef.current?.(null);
        pickHoverRef.current?.(null);
        hovered = -1;
        hoveredSeg = null;
        // Pillars fit the visible width at their depth (phones are narrow),
        // measured from the resting camera, not a gallery's zoomed one.
        const fitMeta = m === 'pillars'
          ? { ...meta, viewWidth: 2 * (baseZ + 1.5) * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect }
          : meta;
        const built = buildMode(THREE, m, n, vals, fitMeta);
        setupPan(built.group);
        setupZoom(built.group);
        touchActionFor(built.group);
        current = { ...built, born: performance.now() };
        dressTiles(built.group);
        dressAvatars(built.group);
        scene.add(built.group);
      };
      // Warm the texture cache for galleries still to come, with the same
      // keys their tiles will ask for, so they show filled in at once.
      // Each one is downloaded, then decoded and uploaded to the GPU right
      // away (initTexture), during the page's loading screen: done the first
      // time a gallery draws, hundreds of uploads froze the page. Progress is
      // reported so the loading screen can wait for it.
      const warmed = new Set();
      let warmedDone = 0;
      const warm = () => {
        const { long = [], short = [] } = preloadRef.current || {};
        const jobs = [...long.map((u) => [u, TILE_ASPECT]), ...short.map((u) => [u, SHORT_ASPECT])]
          .filter(([u, a]) => u && !warmed.has(`${u}|${a}`));
        jobs.forEach(([u, a]) => warmed.add(`${u}|${a}`));
        const report = () => preloadProgressRef.current?.({ done: warmedDone, total: warmed.size });
        report();
        jobs.forEach(([u, a]) => {
          texture(u, a).then((tex) => {
            if (tex) {
              try { renderer.initTexture(tex); } catch { /* uploaded on first draw instead */ }
            }
            warmedDone += 1;
            report();
          });
        });
      };
      apiRef.current = { setMode, setThumbs: () => current && dressTiles(current.group), warm, clearHover: () => clearHover() };

      let baseZ = 10;
      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // Keep the scene's width on narrow (phone) screens.
        baseZ = w / h < 0.8 ? 10 / Math.max(0.55, w / h / 0.8) : 10;
        camera.position.z = baseZ;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      // Parallax: the camera drifts a little towards the pointer, wherever it
      // is in the window (towardEdge). Off with reduced motion.
      const pointer = { x: 0, y: 0 }; // target, -1..1
      const look = { x: 0, y: 0 }; // eased
      const tmp = new THREE.Vector3();
      // Graph hover: the bar whose slot is under the pointer (screen space,
      // so the whole column counts, not just the bar's thin top).
      const pickBar = (x, y, r) => {
        const bars = current?.group.userData.bars;
        let hit = -1;
        let hitSeg = null;
        let at = null;
        if (bars) {
          current.group.updateMatrixWorld();
          const half = (current.group.userData.slot / 2) * 1.0;
          for (let i = 0; i < bars.length; i += 1) {
            const b = bars[i].mesh;
            const left = tmp.set(b.position.x - half, 0, 0).applyMatrix4(current.group.matrixWorld).project(camera).x;
            const right = tmp.set(b.position.x + half, 0, 0).applyMatrix4(current.group.matrixWorld).project(camera).x;
            const px = ((x - r.left) / r.width) * 2 - 1;
            if (px >= Math.min(left, right) && px <= Math.max(left, right)) {
              tmp.set(b.position.x, bars[i].h, 0).applyMatrix4(current.group.matrixWorld).project(camera);
              const topY = (-tmp.y * 0.5 + 0.5) * r.height;
              // Only from the floor up to a little above the bar.
              const floorY = (-tmp.set(b.position.x, 0, 0).applyMatrix4(current.group.matrixWorld).project(camera).y * 0.5 + 0.5) * r.height;
              if (y - r.top <= floorY + 8 && y - r.top >= topY - 60) {
                hit = i;
                const sx = (tmp.set(b.position.x, bars[i].h, 0).applyMatrix4(current.group.matrixWorld).project(camera).x * 0.5 + 0.5) * r.width;
                at = { x: sx, y: topY };
                // Stacked bar: the segment under the pointer (the lowest one
                // whose top is above it; above the whole stack = the top one).
                const segs = bars[i].meshes;
                if (segs && segs.length > 1) {
                  const screenY = (frac) => (-tmp.set(b.position.x, bars[i].h * frac, 0).applyMatrix4(current.group.matrixWorld).project(camera).y * 0.5 + 0.5) * r.height;
                  const py = y - r.top;
                  const seg = segs.find((sg) => py >= screenY(sg.top)) || segs[segs.length - 1];
                  hitSeg = seg.part;
                  at = { x: sx, y: screenY(seg.top) };
                }
              }
              break;
            }
          }
        }
        if (hit !== hovered || hitSeg !== hoveredSeg) {
          const recolor = !current?.group.userData.keepColors;
          const colors = current?.group.userData.barColors || { base: PALETTE.white, hover: PALETTE.red };
          // A bar is one mesh or a stack of them, each with its own base
          // colour; on a stack only the hovered segment lights up.
          const paint = (bar, on, seg) => (bar.meshes || [{ mesh: bar.mesh, base: colors.base }])
            .forEach(({ mesh, base, part }) => mesh.material.color.setHex(on && (seg == null || part === seg) ? colors.hover : base));
          if (recolor && bars?.[hovered]) paint(bars[hovered], false);
          if (recolor && bars?.[hit]) paint(bars[hit], true, hitSeg);
          hovered = hit;
          hoveredSeg = hitSeg;
          hoverRef.current?.(hit >= 0 ? { index: bars[hit].index, segment: hitSeg, ...at } : null);
        }
      };
      clearHover = () => {
        const bars = current?.group.userData.bars;
        if (bars?.[hovered] && !current.group.userData.keepColors) {
          const colors = current.group.userData.barColors || { base: PALETTE.white, hover: PALETTE.red };
          (bars[hovered].meshes || [{ mesh: bars[hovered].mesh, base: colors.base }])
            .forEach(({ mesh, base }) => mesh.material.color.setHex(base));
        }
        hovered = -1;
        hoveredSeg = null;
      };
      const onPointer = (e) => {
        if (frozenRef.current) return;
        const r = host.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        pointer.x = towardEdge(e.clientX, r.left, r.right, window.innerWidth);
        pointer.y = towardEdge(e.clientY, r.top, r.bottom, window.innerHeight);
        pickBar(inside ? e.clientX : -1e6, e.clientY, r);
      };
      // Only leaving the browser window recentres it.
      const onLeave = (e) => {
        if (e.relatedTarget) return; // moved onto another element, still in the window
        pointer.x = 0;
        pointer.y = 0;
      };
      // Wheel and drag pan a graph that is wider than the view.
      const worldPerPx = () => (current ? viewWidthAt(current.group.position.z) / (host.clientWidth || 1) : 0);
      const onWheel = (e) => {
        if (current?.group.userData.gallery) {
          e.preventDefault();
          zoom.target = Math.min(zoom.max, Math.max(zoom.min, zoom.target * (1 + e.deltaY * 0.0015)));
          return;
        }
        if (!current?.group.userData.pan || pan.max === pan.min) return;
        e.preventDefault();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        pan.target = Math.min(pan.max, Math.max(pan.min, pan.target - d * worldPerPx()));
      };
      let drag = null;
      let press = null; // where a press started, to tell a click from a drag
      const raycaster = new THREE.Raycaster();
      // Touch: every finger on the stage, for pinch-to-zoom (galleries).
      const touches = new Map(); // pointerId -> { x, y }
      let pinch = null; // { dist, target }
      const fingerGap = () => {
        const [a, b] = [...touches.values()];
        return Math.hypot(a.x - b.x, a.y - b.y) || 1;
      };
      const onDown = (e) => {
        if (e.pointerType === 'touch') {
          touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (touches.size === 2 && current?.group.userData.gallery) {
            // A second finger: pinch from here on; this is no tap or drag.
            pinch = { dist: fingerGap(), target: zoom.target };
            press = null;
            drag = null;
            return;
          }
        }
        press = { x: e.clientX, y: e.clientY, px: pointer.x, py: pointer.y, rot: current?.group.userData.dragOffset || 0, cx: touchCam.x, cy: touchCam.y };
        if (!current?.group.userData.pan || pan.max === pan.min) return;
        drag = { x: e.clientX, start: pan.target };
        host.setPointerCapture?.(e.pointerId);
      };
      // A click on something pickable (a community standee) reports its name.
      // A tap the scene handled must count once: the browser follows a touch
      // with its own click at the same spot a moment later, which would land
      // on whatever the tap just opened (a card, a panel) and open that too.
      // That one click is swallowed, wherever it lands.
      let swallow = null; // { x, y, until }
      const swallowClick = (e) => {
        if (!swallow || performance.now() > swallow.until) return;
        if (Math.hypot(e.clientX - swallow.x, e.clientY - swallow.y) > 30) return;
        swallow = null;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      };
      window.addEventListener('click', swallowClick, true);
      const onClick = (e) => {
        if (!press || Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6 || !current) return;
        if (e.pointerType !== 'mouse') swallow = { x: e.clientX, y: e.clientY, until: performance.now() + 700 };
        const r = host.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hit = raycaster.intersectObject(current.group, true).find((h) => h.object.userData.pick);
        const bars = current.group.userData.bars;
        // Touch has no hover: find the bar under the finger now.
        if (bars && !hit) pickBar(e.clientX, e.clientY, r);
        if (hit) pickRef.current?.(hit.object.userData.pick);
        else if (bars && hovered >= 0) pickRef.current?.({ type: 'bar', index: bars[hovered].index });
        else pickRef.current?.(null);
      };
      const onDrag = (e) => {
        if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
        // Pinch: fingers apart = closer in, together = further out.
        if (pinch && touches.size >= 2) {
          zoom.target = Math.min(zoom.max, Math.max(zoom.min, pinch.target * (pinch.dist / fingerGap())));
          return;
        }
        // Touch: dragging the ring / helix turns it.
        if (press && !mouse && current?.group.userData.steer && !frozenRef.current) {
          current.group.userData.dragOffset = press.rot + (e.clientX - press.x) * 0.008;
          return;
        }
        // Touch: dragging a gallery moves it with the finger, 1:1: one pixel
        // of finger = one pixel of grid at the current zoom (a mouse just points).
        if (press && !mouse && current?.group.userData.gallery && !frozenRef.current) {
          const perPx = (2 * zoom.d * Math.tan(halfFov)) / (host.clientHeight || 1);
          touchCam.x = Math.max(-galRange.x, Math.min(galRange.x, press.cx - (e.clientX - press.x) * perPx));
          touchCam.y = Math.max(-galRange.down, Math.min(galRange.up, press.cy + (e.clientY - press.y) * perPx));
          return;
        }
        if (!drag) return;
        pan.target = Math.min(pan.max, Math.max(pan.min, drag.start + (e.clientX - drag.x) * worldPerPx()));
      };
      const onUp = (e) => {
        touches.delete(e.pointerId);
        if (pinch) {
          // The pinch ends when the last finger lifts; never a tap.
          if (!touches.size) pinch = null;
          return;
        }
        drag = null;
        onClick(e);
        press = null;
      };
      host.addEventListener('wheel', onWheel, { passive: false });
      host.addEventListener('pointerdown', onDown);
      host.addEventListener('pointermove', onDrag);
      host.addEventListener('pointerup', onUp);
      // A cancelled pointer (the browser took the gesture) is never a tap.
      const onCancel = (e) => {
        touches.delete(e.pointerId);
        press = null;
        drag = null;
        if (!touches.size) pinch = null;
      };
      host.addEventListener('pointercancel', onCancel);
      // Pointer cursor over pickable things.
      let overName = null;
      const onHoverPick = (e) => {
        if (!current || !mouse || frozenRef.current) return;
        const r = host.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hit = raycaster.intersectObject(current.group, true).find((h) => h.object.userData.pick);
        const pick = hit ? hit.object.userData.pick : null;
        const key = pick ? `${pick.type}:${pick.name || ''}:${pick.kind || ''}:${pick.index ?? ''}` : null;
        host.style.cursor = pick || hovered >= 0 ? 'pointer' : '';
        if (key !== overName) {
          overName = key;
          pickHoverRef.current?.(pick ? { ...pick, x: e.clientX - r.left, y: e.clientY - r.top } : null);
        }
      };
      host.addEventListener('pointermove', onHoverPick);
      // Horizontal drags are ours on touch screens; vertical ones still scroll.
      host.style.touchAction = 'pan-y';
      // Galleries take every gesture (pinch, two-way drag); the rest keep
      // vertical page scrolling.
      touchActionFor = (group) => { host.style.touchAction = group.userData.gallery ? 'none' : 'pan-y'; };

      if (mouse) {
        window.addEventListener('pointermove', onPointer, { passive: true });
        window.addEventListener('mouseout', onLeave);
      }

      const t0 = performance.now();
      let last = t0;
      let raf = 0;
      const frame = (now) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        if (document.hidden) return;
        const t = (now - t0) / 1000;

        if (parallax || current?.group.userData.gallery) {
          look.x += (pointer.x - look.x) * 0.08;
          look.y += (pointer.y - look.y) * 0.08;
        }
        const gal = current?.group.userData.gallery;
        if (gal) {
          // Gallery: stand back by the zoom, and slide so the pointer at the
          // window's edge brings the gallery's edge into view.
          zoom.d += (zoom.target - zoom.d) * 0.15;
          const visH = zoom.d * Math.tan(halfFov);
          const visW = visH * camera.aspect;
          const gz = current.group.position.z;
          // The stage's own edge (towardEdge: ±INSIDE_REACH) is already full
          // reach, and the camera may go past the outer tiles by a margin, more
          // at the top (the slide text covers it) and the bottom (the arrows),
          // so the first and last rows and columns come fully into view.
          const reachX = Math.max(-1, Math.min(1, look.x / INSIDE_REACH));
          const reachY = Math.max(-1, Math.min(1, look.y / INSIDE_REACH));
          const rangeX = Math.max(0, gal.halfW - visW + GALLERY_PAD + visW * 0.1);
          const rangeUp = Math.max(0, gal.halfH - visH + GALLERY_PAD + visH * 0.38);
          const rangeDown = Math.max(0, gal.halfH - visH + GALLERY_PAD + visH * 0.18);
          galRange.x = rangeX;
          galRange.up = rangeUp;
          galRange.down = rangeDown;
          if (mouse) {
            camera.position.set(reachX * rangeX, -reachY * (reachY < 0 ? rangeUp : rangeDown), gz + zoom.d);
          } else {
            // Touch: the finger placed it; zooming out can shrink the range.
            touchCam.x = Math.max(-rangeX, Math.min(rangeX, touchCam.x));
            touchCam.y = Math.max(-rangeDown, Math.min(rangeUp, touchCam.y));
            camera.position.set(touchCam.x, touchCam.y, gz + zoom.d);
          }
          camera.lookAt(camera.position.x, camera.position.y, gz);
        } else {
          camera.position.z = baseZ;
          camera.position.x = look.x * PARALLAX_X;
          // Pointer near the top lifts the camera only a little (looking down
          // from high up flattened the scenes); towards the bottom it moves fully.
          camera.position.y = -look.y * PARALLAX_Y * (look.y < 0 ? CAMERA_RISE : 1);
          camera.lookAt(0, 0, -3);
        }

        if (current) {
          const age = now - current.born;
          current.items.forEach((it) => {
            const k = reduced ? 1 : easeOut(clamp01((age - it.delay) / IN_MS));
            if (it.ring) it.obj.scale.setScalar(Math.max(0.001, k));
            else if (it.grow) it.obj.scale.y = Math.max(0.001, k * (it.h || 1));
            else it.obj.position.lerpVectors(it.from, it.to, k);
          });
          const k = reduced ? 1 : easeOut(clamp01(age / IN_MS));
          current.group.scale.setScalar((current.group.userData.baseScale ??= current.group.scale.x) * (0.92 + 0.08 * k));
          if (autoMove) {
            current.group.userData.spin?.(t);
            // A finger's turn (ring / helix) adds to the slow turn.
            if (current.group.userData.dragOffset) current.group.rotation.y += current.group.userData.dragOffset;
          }
          if (current.group.userData.pan) {
            pan.x += (pan.target - pan.x) * 0.15;
            current.group.position.x = pan.x;
          }
          if (parallax) {
            const ud = current.group.userData;
            // Steer: the further from the centre, the faster it turns.
            if (ud.steer) current.group.rotation.y += look.x * STEER_SPEED * dt;
            if (ud.tiltBase != null) {
              // Pointer low tips the far side down (= looking from above):
              // capped by tiltDown so the view never climbs high over a scene.
              const range = look.y > 0 ? (ud.tiltDown ?? ud.tiltRange ?? TILT_RANGE) : (ud.tiltRange ?? TILT_RANGE);
              current.group.rotation.x = ud.tiltBase + look.y * range;
            }
          }
        }

        leaving = leaving.filter((l) => {
          const k = clamp01((now - l.since) / OUT_MS);
          l.group.scale.multiplyScalar(0.94);
          l.group.position.y -= 0.02;
          if (k >= 1) {
            scene.remove(l.group);
            disposeTree(l.group);
            return false;
          }
          return true;
        });

        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener('pointermove', onPointer);
        window.removeEventListener('mouseout', onLeave);
        host.removeEventListener('wheel', onWheel);
        host.removeEventListener('pointerdown', onDown);
        host.removeEventListener('pointermove', onDrag);
        host.removeEventListener('pointerup', onUp);
        host.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('click', swallowClick, true);
        host.removeEventListener('pointermove', onHoverPick);
        apiRef.current = null;
        disposeTree(scene);
        textures.forEach((p) => p.then((tex) => tex?.dispose()));
        avatars.forEach((p) => p.then((tex) => tex?.dispose()));
        dispose();
      };
      setMode(modeRef.current.mode, modeRef.current.count, modeRef.current.values, modeRef.current.meta);
      warm();
    }).catch(() => {});

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  // Gallery thumbnails to fetch ahead of their slides.
  useEffect(() => {
    if (preloadRef.current === preload) return;
    preloadRef.current = preload;
    apiRef.current?.warm();
  }, [preload]);

  // Thumbnails arrive after the first slide: dress the tiles already up.
  useEffect(() => {
    if (thumbsRef.current === thumbs) return;
    thumbsRef.current = thumbs;
    apiRef.current?.setThumbs();
  }, [thumbs]);

    // Slide changes: swap the mode.
  useEffect(() => {
    const prev = modeRef.current;
    modeRef.current = { mode, count, values, meta };
    if (prev.mode === mode && prev.count === count && prev.values === values && prev.meta === meta) return;
    apiRef.current?.setMode(mode, count, values, meta);
  }, [mode, count, values, meta]);

  // The page can drop the scene's hover (a closed panel must not reopen on it).
  useImperativeHandle(ref, () => ({ clearHover: () => apiRef.current?.clearHover() }), []);

  return <div className="recap-scene" ref={hostRef} aria-hidden="true" />;
});

RecapScene.propTypes = {
  mode: PropTypes.oneOf(['ring', 'gallery', 'graph', 'tower', 'orbit', 'fan', 'stars', 'islands', 'ladder', 'pillars', 'helix']).isRequired,
  count: PropTypes.number,
  values: PropTypes.arrayOf(PropTypes.number), // graph: per bar; stack: [videos, shorts]; islands: posts
  // graph / ladder / pillars: ({ index, segment, x, y }) | null, desktop only;
  // `segment` = which part of a stacked pillar (0 = bottom), else null.
  onBarHover: PropTypes.func,
  // graph: { marks: [{ index, label }] month names, focus: index to open on }
  // islands: { items: [{ name, avatar, title, label }] }; ladder: { avatar, mine, gapBeforeMine, rank }
  meta: PropTypes.shape({
    marks: PropTypes.array,
    focus: PropTypes.number,
    items: PropTypes.array,
    avatar: PropTypes.string,
    mine: PropTypes.number,
    gapBeforeMine: PropTypes.bool,
    rank: PropTypes.number,
    labels: PropTypes.array, // pillars: [{ title, value }]
    stacks: PropTypes.array, // pillars: [[bottom, top] | null] per pillar
    zoomStart: PropTypes.number, // gallery: 0 close-up .. 1 whole gallery
  }),
  onPickHover: PropTypes.func, // the same objects plus { x, y } while hovering one (desktop)
  frozen: PropTypes.bool, // something is locked open: ignore pointer moves
  onPreloadProgress: PropTypes.func, // ({ done, total }) as preloaded thumbnails reach the GPU
  // A click: { type: 'community', name } | { type: 'tile', kind, index } |
  // { type: 'bar', index } | null (clicked nothing).
  onPick: PropTypes.func,
  // The creator's thumbnail URLs: landscape for videos, portrait for shorts.
  // top: the top videos' thumbnails, in rank order (fan mode).
  // Gallery thumbnails to load ahead (same URLs the gallery tiles will use).
  preload: PropTypes.shape({ long: PropTypes.arrayOf(PropTypes.string), short: PropTypes.arrayOf(PropTypes.string) }),
  thumbs: PropTypes.shape({
    long: PropTypes.arrayOf(PropTypes.string),
    short: PropTypes.arrayOf(PropTypes.string),
    top: PropTypes.arrayOf(PropTypes.string),
    watched: PropTypes.arrayOf(PropTypes.string),
  }),
};

export default RecapScene;
