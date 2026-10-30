import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  loadThree, hasWebGL, prefersReducedMotion, createRenderer, disposeTree, isDarkTheme,
} from '../../lib/three3d';
import './PodiumStage.scss';

// Medal colours the leaderboard already uses for ranks 1-3 (Leaderboard.scss).
const MEDAL = { 1: '#e6b800', 2: '#a8b3bd', 3: '#c8834d' };
// Step heights in CSS px (phones get 75%). The winner stands tallest.
const STEP = { 1: 72, 2: 50, 3: 34 };
const DEPTH = 70;
const TILT = (20 * Math.PI) / 180; // camera looks down this much
const PAD = 4;
// Rise: 3rd, then 2nd, then the winner. Mirrored by the cards in PodiumStage.scss.
const RISE_MS = 700;
const RISE_DELAY = { 3: 0, 2: 120, 1: 240 };

const easeOutBack = (k) => {
  const c = 1.4;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
};

// Front of a step: its body colour with the rank in its medal colour.
function frontTexture(THREE, rank, w, h, body) {
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(w * scale));
  canvas.height = Math.max(2, Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = MEDAL[rank];
  ctx.font = `800 ${Math.round(canvas.height * 0.62)}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(rank), canvas.width / 2, canvas.height / 2 + canvas.height * 0.04);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The leaderboard podium's 3D steps. Drawn behind the existing top-3 cards
 * (which stay plain links), one step under each card, rising out of the floor
 * when the board loads.
 *
 * Works in CSS pixels: an orthographic camera tilted down by TILT, so a point
 * (x, y, z) lands at screen height y·cos(TILT) − z·sin(TILT). That makes the
 * card offsets exact: onSteps({ rank: px }) reports how high each card must
 * stand to sit in the middle of its step's top. It is only called once the
 * scene is up, so without WebGL (or if three.js fails to load) the podium
 * keeps its flat layout.
 */
function PodiumStage({ podiumRef, onSteps, riseKey }) {
  const hostRef = useRef(null);
  const onStepsRef = useRef(onSteps);
  onStepsRef.current = onSteps;

  useEffect(() => {
    if (!hasWebGL()) return undefined;
    const host = hostRef.current;
    const podium = podiumRef.current;
    if (!host || !podium) return undefined;
    let cancelled = false;
    let cleanup = () => {};

    loadThree().then((THREE) => {
      if (cancelled) return;
      const { renderer, dispose } = createRenderer(THREE, host);
      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(0, 1, 1, 0, 1, 4000);
      camera.rotation.x = -TILT;
      camera.position.set(0, 1000 * Math.sin(TILT), 1000 * Math.cos(TILT));

      scene.add(new THREE.AmbientLight(0xffffff, 1.6));
      const key = new THREE.DirectionalLight(0xffffff, 1.6);
      key.position.set(-0.4, 1, 0.8);
      scene.add(key);

      const steps = new THREE.Group();
      scene.add(steps);
      const reduced = prefersReducedMotion();
      let built = []; // [{ mesh, rank, h }]
      let t0 = performance.now();
      let raf = 0;
      let running = false;

      const build = () => {
        disposeTree(steps);
        steps.clear();
        built = [];
        const width = podium.clientWidth;
        const phone = width < 520;
        const dark = isDarkTheme();
        const body = dark ? '#262626' : '#e9e9e9';
        const side = dark ? 0x1b1b1b : 0xd6d6d6;
        const heights = {};

        podium.querySelectorAll('.lb-podium-slot').forEach((slot) => {
          const rank = Number((slot.className.match(/lb-rank-(\d)/) || [])[1]);
          if (!STEP[rank]) return;
          const h = Math.round(STEP[rank] * (phone ? 0.75 : 1));
          const w = slot.offsetWidth;
          const x = slot.offsetLeft + w / 2;
          heights[rank] = h;
          const front = frontTexture(THREE, rank, w, h, body);
          const mats = [
            new THREE.MeshStandardMaterial({ color: side, roughness: 0.8 }), // +x
            new THREE.MeshStandardMaterial({ color: side, roughness: 0.8 }), // -x
            new THREE.MeshStandardMaterial({ color: new THREE.Color(MEDAL[rank]), roughness: 0.7 }), // top
            new THREE.MeshStandardMaterial({ color: side, roughness: 0.8 }), // bottom
            new THREE.MeshStandardMaterial({ map: front, roughness: 0.85 }), // front
            new THREE.MeshStandardMaterial({ color: side, roughness: 0.8 }), // back
          ];
          const geo = new THREE.BoxGeometry(w, h, DEPTH);
          geo.translate(0, h / 2, -DEPTH / 2); // grow up from the floor, front at z = 0
          const mesh = new THREE.Mesh(geo, mats);
          mesh.position.x = x;
          steps.add(mesh);
          built.push({ mesh, rank });
        });

        const tallest = Math.max(0, ...Object.values(heights));
        const top = tallest * Math.cos(TILT) + DEPTH * Math.sin(TILT) + PAD;
        const cssHeight = Math.ceil(top + PAD);
        host.style.height = `${cssHeight}px`;
        renderer.setSize(width, cssHeight, false);
        camera.left = 0;
        camera.right = width;
        camera.bottom = -PAD;
        camera.top = top;
        camera.updateProjectionMatrix();

        // Card bottom = middle of its step's top face, plus the canvas's floor pad.
        const offsets = {};
        Object.entries(heights).forEach(([rank, h]) => {
          offsets[rank] = Math.round(h * Math.cos(TILT) + (DEPTH / 2) * Math.sin(TILT) + PAD);
        });
        onStepsRef.current?.(offsets);
      };

      const render = (now) => {
        const t = now - t0;
        let moving = false;
        built.forEach(({ mesh, rank }) => {
          const k = reduced ? 1 : Math.min(1, Math.max(0, (t - RISE_DELAY[rank]) / RISE_MS));
          if (k < 1) moving = true;
          mesh.scale.y = Math.max(0.001, easeOutBack(k));
        });
        renderer.render(scene, camera);
        return moving;
      };

      // Only animates while rising; otherwise renders once per change.
      const loop = (now) => {
        if (render(now)) raf = requestAnimationFrame(loop);
        else running = false;
      };
      const kick = () => {
        if (running) return;
        running = true;
        raf = requestAnimationFrame(loop);
      };

      build();
      t0 = performance.now();
      kick();

      const ro = new ResizeObserver(() => { build(); kick(); });
      ro.observe(podium);
      // Theme switches recolour the steps.
      const mo = new MutationObserver(() => { build(); kick(); });
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        mo.disconnect();
        disposeTree(scene);
        dispose();
        onStepsRef.current?.(null);
      };
    }).catch(() => {});

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [podiumRef, riseKey]);

  return <div className="lb-podium-stage" ref={hostRef} aria-hidden="true" />;
}

PodiumStage.propTypes = {
  podiumRef: PropTypes.shape({ current: PropTypes.any }).isRequired,
  onSteps: PropTypes.func.isRequired,
  riseKey: PropTypes.string,
};

export default PodiumStage;
