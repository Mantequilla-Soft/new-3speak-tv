import { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import {
  loadThree, hasWebGL, prefersReducedMotion, createRenderer, disposeTree, PALETTE,
} from '../../lib/three3d';
import { clusterDirections, shell, seedOf } from '../../lib/galaxyLayout';
import { ringOnMap, scanGraph } from '../../lib/hiveGalaxy';
import { hiveAvatarUrl } from '../../utils/avatarCache';

// Layout radii: the centre account, its ring (follows / followers / mutuals)
// on an inner shell, and the suggested creators on an outer one.
const R_FOLLOW = 5;
const R_SUGGEST = 8.5;
const PICK_PX = 14; // how close the pointer must be to a star to hover it
const HOME_DISTANCE = 19;
const ZOOM_LABELS_AT = 12; // camera this close to what it looks at: label every suggestion
const MAX_LABELS = 60;
const INTRO_MS = 1400;
const FLY_MS = 900;
const DIM = 0.2; // colour factor for stars outside the current selection
const ONE_WAY = 0x8a8a8a; // ring members without a follow back: grey and smaller
const AVATAR_PX = 128;
const MAX_LINKED_FACES = 40; // faces for a selection's linked accounts, strongest first

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - ((-2 * k + 2) ** 3) / 2);

// A round avatar with a red rim, drawn once into a canvas for a sprite.
function avatarCanvas(img) {
  const c = document.createElement('canvas');
  c.width = AVATAR_PX;
  c.height = AVATAR_PX;
  const g = c.getContext('2d');
  const r = AVATAR_PX / 2;
  g.fillStyle = '#e53935';
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill();
  g.save();
  g.beginPath(); g.arc(r, r, r - 7, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#1e1e1e';
  g.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
  const s = Math.max(AVATAR_PX / img.width, AVATAR_PX / img.height);
  g.drawImage(img, r - (img.width * s) / 2, r - (img.height * s) / 2, img.width * s, img.height * s);
  g.restore();
  return c;
}

/**
 * The 3D star map. Drag to turn it, scroll or pinch to zoom; it turns slowly
 * by itself until touched. Hover a star for its name (onHover), click to pick
 * it (onSelect).
 *
 * `shown` is the suggestions the filters let through (the rest are hidden, but
 * keep their place, so filtering never reshuffles the sky); `top` the few of
 * them drawn as avatars with a name. `selected` (any star's name) flies the
 * camera there, dims everything unrelated and draws its links: for a
 * suggestion, the ring members that lead to it; for a ring member, the
 * suggestions it leads to. `links` (the selection's own follows that are on
 * the map, loaded by the page) adds a line to each of those accounts.
 * `circles` (groups found by findCircles) get an outline and a clickable name;
 * `circle` (one id) puts that group in focus instead of a single star.
 * `onMoved(from, to)` reports a finished drag or zoom as two camera poses
 * ({ t: target, c: camera }); `cameraRef.current` gets getPose() and
 * flyTo(pose), for the page's undo/redo.
 */
function GalaxyScene({
  data, shown, top, selected, links, circles, circle, onHover, onSelect, onCircle, onMoved, cameraRef,
}) {
  const hostRef = useRef(null);
  const apiRef = useRef(null);
  const cbRef = useRef({ onHover, onSelect, onCircle, onMoved });
  cbRef.current = { onHover, onSelect, onCircle, onMoved };
  // Read by the scene when it finishes loading.
  const latest = useRef({ shown, top, selected, links, circles, circle });
  latest.current = { shown, top, selected, links, circles, circle };

  useEffect(() => {
    if (!data || !hasWebGL()) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    let cleanup = () => {};
    const still = prefersReducedMotion();

    Promise.all([loadThree(), import('three/examples/jsm/controls/OrbitControls.js')]).then(([THREE, { OrbitControls }]) => {
      if (cancelled) return;
      const { renderer, dispose } = createRenderer(THREE, host, { pixelRatioCap: 1.5 });
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 260);
      camera.position.set(0, 4, HOME_DISTANCE);

      scene.add(new THREE.AmbientLight(0xffffff, 1.5));
      const key = new THREE.DirectionalLight(0xffffff, 1.5);
      key.position.set(5, 8, 10);
      scene.add(key);

      // Far, faint, flat dots so turning the map reads as moving through space.
      const fieldRnd = (() => { let s = 99; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
      const field = new Float32Array(1100 * 3);
      for (let i = 0; i < 1100; i += 1) {
        const u = fieldRnd() * 2 - 1;
        const a = fieldRnd() * Math.PI * 2;
        const r = 70 + fieldRnd() * 50;
        const w = Math.sqrt(1 - u * u);
        field.set([Math.cos(a) * w * r, u * r, Math.sin(a) * w * r], i * 3);
      }
      const fieldGeo = new THREE.BufferGeometry();
      fieldGeo.setAttribute('position', new THREE.BufferAttribute(field, 3));
      scene.add(new THREE.Points(fieldGeo, new THREE.PointsMaterial({ color: 0x5c5c5c, size: 0.4, sizeAttenuation: true })));

      const world = new THREE.Group();
      scene.add(world);
      const mat = (color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
      const sphere = new THREE.SphereGeometry(1, 16, 12);
      const q0 = new THREE.Quaternion();
      const m4 = new THREE.Matrix4();
      const v1 = new THREE.Vector3();
      const zero = new THREE.Vector3(0, 0, 0);

      // Centre account
      const centre = new THREE.Mesh(sphere, mat(PALETTE.red));
      centre.scale.setScalar(0.55);
      world.add(centre);

      // Stars: [{ name, kind, pos: Vector3, size, ... }]
      const stars = [{ name: data.center, kind: 'center', pos: new THREE.Vector3(), size: 0.55 }];
      const byName = new Map([[data.center, stars[0]]]);

      // Linked ring members and all candidates are placed together by the
      // force layout, so linked accounts sit side by side; the unlinked rest
      // of the ring is an even cloud on the inner shell.
      const ring = ringOnMap(data);
      const scannedSet = new Set(data.sampled);
      const sugg = data.suggestions;
      const graph = scanGraph(data);
      const dirs = clusterDirections(graph.n, graph.edges, { seed: graph.seed, groups: graph.group });
      const jitterRnd = (() => { let s = seedOf(data.center) || 3; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; })();
      const onShell = (i, radius, jitter) => {
        const rad = radius * (1 + (jitterRnd() - 0.5) * jitter);
        return new THREE.Vector3(dirs[i * 3] * rad, dirs[i * 3 + 1] * rad * 0.8, dirs[i * 3 + 2] * rad);
      };
      const rest = ring.filter((n) => !graph.index.has(n));
      const restPts = shell(rest.length, R_FOLLOW, 0.35, rest.length + 11);
      const restIdx = new Map(rest.map((n, i) => [n, i]));

      const followSet = new Set(data.following);
      const followerSet = new Set(data.followers);
      const fMesh = new THREE.InstancedMesh(sphere, mat(0xffffff), Math.max(1, ring.length));
      fMesh.frustumCulled = false;
      const fStars = ring.map((name, i) => {
        const scanned = scannedSet.has(name);
        const pos = graph.index.has(name) ? onShell(graph.index.get(name), R_FOLLOW, 0.3) : new THREE.Vector3(...restPts[restIdx.get(name)]);
        const centerFollows = followSet.has(name);
        const followsCenter = followerSet.has(name);
        const mutual = !data.followersKnown || (centerFollows && followsCenter);
        const star = {
          name, kind: 'follow', pos, idx: i, scanned, centerFollows, followsCenter,
          mutual, size: mutual ? 0.085 : 0.06, color: mutual ? PALETTE.white : ONE_WAY,
        };
        stars.push(star);
        byName.set(name, star);
        return star;
      });
      fMesh.count = ring.length;
      world.add(fMesh);

      const topCount = sugg[0]?.count || 1;
      const sMesh = new THREE.InstancedMesh(sphere, mat(0xffffff), Math.max(1, sugg.length));
      sMesh.frustumCulled = false;
      const sStars = sugg.map((s, k) => {
        const size = 0.1 + 0.18 * (s.count / topCount);
        const star = {
          name: s.name, kind: 'suggestion', pos: onShell(graph.index.get(s.name), R_SUGGEST, 0.2),
          idx: k, size, via: s.via, count: s.count, color: PALETTE.red,
        };
        stars.push(star);
        byName.set(s.name, star);
        return star;
      });
      sMesh.count = sugg.length;
      world.add(sMesh);

      // ---- State the page drives: visible suggestions, avatars, selection.
      let visible = new Set();
      let topList = []; // the strongest suggestions, always shown with a face
      let selectedName = null;
      let hoveredName = null;
      let related = null; // Set of names kept bright, or null = everything bright
      let faces = new Set(); // names drawn as avatars right now
      let circles = []; // [{ id, label, members: [names] }] from the page
      let activeCircle = null; // id of the circle in focus, if no star is

      // Avatars: loaded once per name, drawn in place of the ball. Faces go
      // where the viewer is looking: the top suggestions, the selection and
      // its linked accounts, and whatever the pointer is on.
      const avatars = new Map(); // name -> Sprite | 'loading' | 'failed'
      const avatarSize = (s) => (s.kind === 'follow' ? 0.45 : Math.max(0.6, s.size * 3.2));
      const loadAvatar = (s) => {
        avatars.set(s.name, 'loading');
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          if (cancelled) return;
          let tex;
          try {
            tex = new THREE.CanvasTexture(avatarCanvas(img));
          } catch {
            avatars.set(s.name, 'failed');
            return;
          }
          tex.colorSpace = THREE.SRGBColorSpace;
          const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex }));
          sprite.position.copy(s.pos);
          sprite.scale.setScalar(avatarSize(s));
          world.add(sprite);
          avatars.set(s.name, sprite);
          refresh();
        };
        img.onerror = () => { avatars.set(s.name, 'failed'); };
        img.src = hiveAvatarUrl(s.name, 'medium');
      };
      const hasAvatar = (name) => faces.has(name) && avatars.get(name)?.isSprite;
      const onMapNow = (name) => byName.get(name)?.kind !== 'suggestion' || visible.has(name);

      const pickFaces = () => {
        const next = new Set(topList.filter((n) => visible.has(n)));
        if (selectedName) next.add(selectedName);
        if (related) {
          let linked = 0;
          related.forEach((n) => {
            if (n === data.center || n === selectedName || linked >= MAX_LINKED_FACES) return;
            next.add(n);
            linked += 1;
          });
        }
        if (hoveredName && hoveredName !== data.center && onMapNow(hoveredName)) next.add(hoveredName);
        faces = next;
        faces.forEach((n) => { if (!avatars.has(n)) loadAvatar(byName.get(n)); });
      };

      const color = new THREE.Color();
      const paint = (mesh, list) => {
        list.forEach((s) => {
          color.setHex(s.color);
          if (related && !related.has(s.name)) color.multiplyScalar(DIM);
          mesh.setColorAt(s.idx, color);
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      };

      const writeStars = () => {
        fStars.forEach((s) => {
          m4.compose(s.pos, q0, hasAvatar(s.name) ? zero : v1.setScalar(s.size));
          fMesh.setMatrixAt(s.idx, m4);
        });
        fMesh.instanceMatrix.needsUpdate = true;
        sStars.forEach((s) => {
          const show = visible.has(s.name) && !hasAvatar(s.name);
          m4.compose(s.pos, q0, show ? v1.setScalar(s.size) : zero);
          sMesh.setMatrixAt(s.idx, m4);
        });
        sMesh.instanceMatrix.needsUpdate = true;
        avatars.forEach((sprite, name) => {
          if (!sprite?.isSprite) return;
          sprite.visible = faces.has(name) && onMapNow(name);
          sprite.material.color.setScalar(related && !related.has(name) ? DIM * 1.5 : 1);
        });
      };

      // Faint links, only for the selection: all of them at once is a hairball.
      // Red: the scan's paths (centre -> ring -> suggestion). White / grey: the
      // selection's own follows on the map, once loaded (setLinks): white where
      // it follows them, grey where they only follow it.
      const lineMat = new THREE.LineBasicMaterial({ color: PALETTE.red, transparent: true, opacity: 0.55 });
      const linkMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4 });
      const OUT_COLOR = new THREE.Color(PALETTE.white);
      const IN_COLOR = new THREE.Color(0x8a8a8a);
      let lines = null;
      let linkLines = null;
      let linkData = null; // { name, out: [names], in: [names] } for the selection
      const linksOf = (name) => (linkData?.name === name ? linkData : null);
      const drawLines = () => {
        if (lines) { world.remove(lines); lines.geometry.dispose(); lines = null; }
        if (linkLines) { world.remove(linkLines); linkLines.geometry.dispose(); linkLines = null; }
        const s = selectedName && byName.get(selectedName);
        if (!s || s.kind === 'center') return;
        const pts = [];
        const redTo = new Set(); // already joined to the selection in red
        if (s.kind === 'suggestion') {
          s.via.forEach((v) => {
            const f = byName.get(v);
            if (f) { pts.push(new THREE.Vector3(), f.pos, f.pos, s.pos); redTo.add(v); }
          });
        } else {
          pts.push(new THREE.Vector3(), s.pos);
          redTo.add(data.center);
          (data.leads[s.name] || []).forEach((n) => {
            if (visible.has(n)) { pts.push(s.pos, byName.get(n).pos); redTo.add(n); }
          });
        }
        if (pts.length >= 2) {
          lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat);
          world.add(lines);
        }

        const l = linksOf(s.name);
        if (!l) return;
        const outSet = new Set(l.out);
        const lpts = [];
        const cols = [];
        new Set([...l.out, ...l.in]).forEach((n) => {
          const o = byName.get(n);
          if (!o || n === s.name || redTo.has(n) || !onMapNow(n)) return;
          lpts.push(s.pos, o.pos);
          const c = outSet.has(n) ? OUT_COLOR : IN_COLOR;
          cols.push(c.r, c.g, c.b, c.r, c.g, c.b);
        });
        if (!lpts.length) return;
        const geo = new THREE.BufferGeometry().setFromPoints(lpts);
        geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        linkLines = new THREE.LineSegments(geo, linkMat);
        world.add(linkLines);
      };

      const relatedTo = (name) => {
        const s = name && byName.get(name);
        if (!s || s.kind === 'center') return null;
        const set = new Set([data.center, name]);
        if (s.kind === 'suggestion') s.via.forEach((v) => set.add(v));
        else (data.leads[name] || []).forEach((n) => { if (visible.has(n)) set.add(n); });
        const l = linksOf(name);
        if (l) [...l.out, ...l.in].forEach((n) => { if (byName.has(n) && onMapNow(n)) set.add(n); });
        return set;
      };

      const circleRelated = () => {
        const c = activeCircle && circles.find((x) => x.id === activeCircle);
        if (!c) return null;
        const set = new Set([data.center]);
        c.members.forEach((n) => { if (byName.has(n) && onMapNow(n)) set.add(n); });
        return set;
      };

      // ---- Circles: a thin outline around each group's patch on the outer
      // shell, and a clickable name label at its middle. Grey, the focused one
      // light: no new colours, the outline and name do the telling apart.
      const circleMat = new THREE.LineBasicMaterial({ color: 0x4a4a4a });
      const circleActiveMat = new THREE.LineBasicMaterial({ color: 0xbdbdbd });
      const shapes = new Map(); // id -> { line, el, anchor, dir, on, far }
      const squash = (v, r) => new THREE.Vector3(v.x * r, v.y * r * 0.8, v.z * r);
      const dirOf = (s) => new THREE.Vector3(s.pos.x, s.pos.y / 0.8, s.pos.z).normalize();
      const drawCircles = () => {
        const keep = new Set(circles.map((c) => c.id));
        shapes.forEach((sh, id) => {
          if (sh.line) { world.remove(sh.line); sh.line.geometry.dispose(); sh.line = null; }
          if (!keep.has(id)) { sh.el.remove(); shapes.delete(id); }
        });
        circles.forEach((c) => {
          // Members on the map; a circle of followed accounts only sits on
          // the inner shell, so its outline and name go there too.
          const on = c.members.map((n) => byName.get(n)).filter((s) => s && s.kind !== 'center' && onMapNow(s.name));
          const dirs = on.map(dirOf);
          const radius = on.some((s) => s.kind === 'suggestion') ? R_SUGGEST : R_FOLLOW;
          let sh = shapes.get(c.id);
          if (!sh) {
            const el = document.createElement('button');
            el.type = 'button';
            el.className = 'galaxy-circle-label';
            el.addEventListener('click', () => cbRef.current.onCircle?.(c.id));
            labelHost.appendChild(el);
            sh = { el, line: null, anchor: null, dir: null, on: false, far: false };
            shapes.set(c.id, sh);
          }
          sh.el.textContent = c.label;
          sh.el.classList.toggle('is-active', c.id === activeCircle);
          if (dirs.length < 3) { sh.anchor = null; return; }
          const mid = dirs.reduce((a, d) => a.add(d), new THREE.Vector3()).normalize();
          const angles = dirs.map((d) => Math.acos(Math.min(1, Math.max(-1, d.dot(mid))))).sort((a, b) => a - b);
          const spread = angles[Math.floor(angles.length * 0.8)] + 0.08;
          sh.dir = mid;
          sh.anchor = squash(mid, radius * 1.14);
          // A patch wider than ~60 degrees is not a patch; name it, don't ring it.
          if (spread > 1.05) return;
          const u = new THREE.Vector3(0, 1, 0).cross(mid);
          if (u.lengthSq() < 1e-6) u.set(1, 0, 0);
          u.normalize();
          const w = mid.clone().cross(u).normalize();
          const pts = [];
          for (let i = 0; i < 64; i += 1) {
            const a = (i / 64) * Math.PI * 2;
            const p = mid.clone().multiplyScalar(Math.cos(spread))
              .add(u.clone().multiplyScalar(Math.cos(a) * Math.sin(spread)))
              .add(w.clone().multiplyScalar(Math.sin(a) * Math.sin(spread)));
            pts.push(squash(p, radius * 1.03));
          }
          sh.line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), c.id === activeCircle ? circleActiveMat : circleMat);
          world.add(sh.line);
        });
      };

      // Pulsing ring around the selection: flat, the same red, no glow.
      const pulse = new THREE.Mesh(
        new THREE.RingGeometry(1.3, 1.4, 48),
        new THREE.MeshBasicMaterial({ color: PALETTE.red, side: THREE.DoubleSide }),
      );
      pulse.visible = false;
      world.add(pulse);

      // ---- Name labels: plain DOM over the canvas, crisp at any zoom.
      const labelHost = document.createElement('div');
      labelHost.className = 'galaxy-labels';
      host.appendChild(labelHost);
      const labels = new Map(); // name -> { el, star, on, far }
      let labelled = [];
      let zoomed = false;
      const refreshLabels = () => {
        const want = [];
        const add = (n) => { if (want.length < MAX_LABELS && byName.has(n) && !want.includes(n)) want.push(n); };
        if (selectedName && selectedName !== data.center) add(selectedName);
        topList.forEach((n) => { if (visible.has(n)) add(n); });
        if (related) related.forEach((n) => { if (n !== data.center) add(n); });
        if (zoomed) sStars.forEach((s) => { if (visible.has(s.name)) add(s.name); });
        labels.forEach((l) => { if (l.on) { l.el.style.display = 'none'; l.on = false; } });
        labelled = want.map((n) => {
          let l = labels.get(n);
          if (!l) {
            const el = document.createElement('span');
            el.className = 'galaxy-label';
            el.textContent = `@${n}`;
            labelHost.appendChild(el);
            l = { el, star: byName.get(n), on: false, far: false };
            labels.set(n, l);
          }
          l.el.classList.toggle('is-selected', n === selectedName);
          return l;
        });
      };
      function refresh() {
        related = selectedName ? relatedTo(selectedName) : circleRelated();
        pickFaces();
        paint(fMesh, fStars);
        paint(sMesh, sStars);
        writeStars();
        drawLines();
        refreshLabels();
      }

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.minDistance = 2.5;
      controls.maxDistance = 34;
      // Right-drag, Shift+drag or two fingers move the view, and the wheel
      // zooms toward the pointer, so a selection is a starting point to drift
      // from rather than a pivot you can only circle. The target stays near
      // the galaxy so nobody pans off into empty space.
      controls.enablePan = true;
      controls.zoomToCursor = true;
      controls.maxTargetRadius = 14;
      controls.autoRotate = !still;
      controls.autoRotateSpeed = 0.35;
      let fly = null;
      // Hand-made moves are history steps for the page's undo/redo: a drag,
      // or a burst of wheel turns, counts once it has been still for a
      // moment. A glide started meanwhile (a click that picked) cancels it.
      let moveFrom = null;
      let moveTimer = 0;
      const poseNow = () => ({ t: controls.target.toArray(), c: camera.position.toArray() });
      controls.addEventListener('start', () => {
        controls.autoRotate = false;
        fly = null;
        if (!moveFrom) moveFrom = poseNow();
        clearTimeout(moveTimer);
      });
      controls.addEventListener('end', () => {
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
          const from = moveFrom;
          moveFrom = null;
          if (!from || cancelled) return;
          const to = poseNow();
          const moved = Math.hypot(...to.c.map((v, i) => v - from.c[i])) + Math.hypot(...to.t.map((v, i) => v - from.t[i]));
          if (moved > 0.05) cbRef.current.onMoved?.(from, to);
        }, 700);
      });

      // Glide the camera to a star (or back home): it ends up looking at the
      // star from just outside it, partly from where it already was.
      const focus = (name) => {
        const s = name && byName.get(name);
        const viewDir = v1.copy(camera.position).sub(controls.target).normalize().clone();
        let toT;
        let toC;
        if (!s || s.kind === 'center') {
          toT = new THREE.Vector3();
          toC = viewDir.multiplyScalar(HOME_DISTANCE);
        } else {
          toT = s.pos.clone();
          const out = s.pos.clone().normalize().multiplyScalar(0.55).add(viewDir.multiplyScalar(0.45)).normalize();
          toC = s.pos.clone().add(out.multiplyScalar(s.kind === 'follow' ? 5 : 6));
        }
        controls.autoRotate = false;
        fly = { t0: performance.now(), fromT: controls.target.clone(), toT, fromC: camera.position.clone(), toC };
        moveFrom = null;
      };

      // A circle is looked at from outside its patch, the whole patch in view.
      const focusCircle = (id) => {
        const sh = shapes.get(id);
        if (!sh?.dir) return;
        controls.autoRotate = false;
        fly = {
          t0: performance.now(),
          fromT: controls.target.clone(),
          toT: squash(sh.dir, R_SUGGEST * 0.7),
          fromC: camera.position.clone(),
          toC: squash(sh.dir, R_SUGGEST + 10),
        };
        moveFrom = null;
      };

      // Back to a view the page kept (undo/redo).
      const flyTo = (pose) => {
        controls.autoRotate = false;
        fly = {
          t0: performance.now(),
          fromT: controls.target.clone(),
          toT: new THREE.Vector3().fromArray(pose.t),
          fromC: camera.position.clone(),
          toC: new THREE.Vector3().fromArray(pose.c),
        };
        moveFrom = null;
      };

      const resize = () => {
        const w = host.clientWidth || 1;
        const h = host.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(host);

      // Picking in screen space. The pointer is ON a star when it is inside
      // the star's drawn disc (an avatar's, not the ball under it), and the
      // one nearest the camera wins, as on screen. Off every disc, the
      // closest star within PICK_PX counts, which is kind to tiny stars.
      const tmp = new THREE.Vector3();
      const pick = (clientX, clientY) => {
        const rect = renderer.domElement.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        // Pixels per world unit at distance 1 from the camera.
        const pxPerUnit = rect.height / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
        let front = null; // the nearest-to-camera star the pointer is ON
        let frontDist = Infinity;
        let near = null; // else the star closest to the pointer within PICK_PX
        let nearD = Infinity;
        world.updateMatrixWorld();
        for (const s of stars) {
          if (s.kind === 'suggestion' && !visible.has(s.name)) continue;
          tmp.copy(s.pos).applyMatrix4(world.matrixWorld);
          const camDist = tmp.distanceTo(camera.position);
          tmp.project(camera);
          if (tmp.z > 1) continue;
          const sx = (tmp.x * 0.5 + 0.5) * rect.width;
          const sy = (-tmp.y * 0.5 + 0.5) * rect.height;
          const d = (sx - x) ** 2 + (sy - y) ** 2;
          // Its drawn size on screen: an avatar is far wider than its ball.
          const r = (hasAvatar(s.name) ? avatarSize(s) / 2 : s.size) * world.scale.x;
          const rPx = (r / Math.max(camDist, 0.01)) * pxPerUnit;
          if (d <= rPx * rPx) {
            if (camDist < frontDist) { frontDist = camDist; front = { star: s, x: sx, y: sy }; }
          } else if (d < PICK_PX * PICK_PX && d < nearD) {
            nearD = d;
            near = { star: s, x: sx, y: sy };
          }
        }
        return front || near;
      };

      let downAt = null;
      const onMove = (e) => {
        const hit = pick(e.clientX, e.clientY);
        renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
        const name = hit && hit.star.kind !== 'center' ? hit.star.name : null;
        if (name !== hoveredName) {
          hoveredName = name;
          pickFaces();
          writeStars();
          refreshLabels();
        }
        cbRef.current.onHover?.(hit ? { name: hit.star.name, kind: hit.star.kind, x: hit.x, y: hit.y } : null);
      };
      // Only the main button picks; right and middle drags move the view.
      const onDown = (e) => { downAt = e.button === 0 ? [e.clientX, e.clientY] : null; };
      const onUp = (e) => {
        // A drag turns the galaxy; only a still click picks.
        if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
        const hit = pick(e.clientX, e.clientY);
        // The centre always flies home, even when nothing was selected.
        if (hit?.star.kind === 'center') focus(null);
        cbRef.current.onSelect?.(hit ? { name: hit.star.name, kind: hit.star.kind } : null);
      };
      const onLeave = () => {
        if (hoveredName) { hoveredName = null; pickFaces(); writeStars(); }
        cbRef.current.onHover?.(null);
      };
      const el = renderer.domElement;
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerdown', onDown);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointerleave', onLeave);
      el.style.touchAction = 'none';

      // Labels follow their stars every frame; the ones on the far side of
      // what the camera looks at fade back.
      const placeLabels = (rect, introDone) => {
        const viewDist = camera.position.distanceTo(controls.target);
        labelled.forEach((l) => {
          tmp.copy(l.star.pos).applyMatrix4(world.matrixWorld);
          const far = camera.position.distanceTo(tmp) > viewDist + 1;
          tmp.project(camera);
          const on = introDone && tmp.z <= 1;
          if (on !== l.on) { l.el.style.display = on ? '' : 'none'; l.on = on; }
          if (!on) return;
          if (far !== l.far) { l.el.classList.toggle('is-far', far); l.far = far; }
          const below = hasAvatar(l.star.name) ? 22 : 10;
          const x = (tmp.x * 0.5 + 0.5) * rect.width;
          const y = (-tmp.y * 0.5 + 0.5) * rect.height + below;
          l.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translateX(-50%)`;
        });
        // Circle names step aside while a single star has the stage, and
        // only the focused circle keeps its name while one is focused.
        shapes.forEach((sh, id) => {
          let on = introDone && !!sh.anchor && !selectedName && (!activeCircle || activeCircle === id);
          if (on) {
            tmp.copy(sh.anchor).applyMatrix4(world.matrixWorld);
            const far = camera.position.distanceTo(tmp) > viewDist + 1;
            tmp.project(camera);
            on = tmp.z <= 1;
            if (on && far !== sh.far) { sh.el.classList.toggle('is-far', far); sh.far = far; }
          }
          if (on !== sh.on) { sh.el.style.display = on ? '' : 'none'; sh.on = on; }
          if (!on) return;
          const x = (tmp.x * 0.5 + 0.5) * rect.width;
          const y = (-tmp.y * 0.5 + 0.5) * rect.height;
          sh.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
        });
      };

      const introStart = performance.now();
      let introDone = still;
      let raf = 0;
      const frame = (now) => {
        raf = requestAnimationFrame(frame);
        if (document.hidden) return;

        // Intro: the galaxy unfolds out of the centre with a half turn.
        if (!introDone) {
          const k = Math.min(1, (now - introStart) / INTRO_MS);
          const e = 1 - (1 - k) ** 3;
          world.scale.setScalar(Math.max(0.001, e));
          world.rotation.y = (1 - e) * 1.6;
          if (k >= 1) { introDone = true; world.scale.setScalar(1); world.rotation.y = 0; }
        }

        if (fly) {
          const k = still ? 1 : Math.min(1, (now - fly.t0) / FLY_MS);
          const e = ease(k);
          controls.target.lerpVectors(fly.fromT, fly.toT, e);
          camera.position.lerpVectors(fly.fromC, fly.toC, e);
          if (k >= 1) fly = null;
        }
        controls.update();

        const isZoomed = camera.position.distanceTo(controls.target) < ZOOM_LABELS_AT;
        if (isZoomed !== zoomed) { zoomed = isZoomed; refreshLabels(); }

        const sel = selectedName && byName.get(selectedName);
        if (sel && sel.kind !== 'center') {
          const r = hasAvatar(sel.name) ? avatarSize(sel) / 2 : sel.size;
          pulse.visible = true;
          pulse.position.copy(sel.pos);
          pulse.quaternion.copy(camera.quaternion);
          pulse.scale.setScalar(r * (still ? 1.1 : 1.1 + 0.2 * Math.sin(now * 0.005)));
        } else {
          pulse.visible = false;
        }

        world.updateMatrixWorld();
        placeLabels(renderer.domElement.getBoundingClientRect(), introDone);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(frame);

      apiRef.current = {
        setShown(shownNames, topNames) {
          visible = new Set(shownNames);
          topList = topNames.filter((n) => byName.has(n));
          drawCircles();
          refresh();
        },
        setCircles(list) {
          circles = list || [];
          drawCircles();
          refresh();
        },
        setCircle(id) {
          const next = id && circles.some((c) => c.id === id) ? id : null;
          if (next === activeCircle) return;
          activeCircle = next;
          drawCircles();
          refresh();
          if (next) focusCircle(next);
          else if (!selectedName) focus(null);
        },
        select(name) {
          const next = name && name !== data.center && byName.has(name) ? name : null;
          if (next === selectedName) return;
          selectedName = next;
          refresh();
          focus(next);
        },
        setLinks(next) {
          const l = next || null;
          if (l === linkData) return;
          linkData = l;
          refresh();
        },
        getPose: poseNow,
        flyTo,
      };
      if (cameraRef) cameraRef.current = apiRef.current;
      apiRef.current.setCircles(latest.current.circles);
      apiRef.current.setShown(latest.current.shown, latest.current.top);
      apiRef.current.setCircle(latest.current.circle);
      apiRef.current.select(latest.current.selected);
      apiRef.current.setLinks(latest.current.links);

      cleanup = () => {
        cancelAnimationFrame(raf);
        clearTimeout(moveTimer);
        if (cameraRef) cameraRef.current = null;
        ro.disconnect();
        controls.dispose();
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerdown', onDown);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointerleave', onLeave);
        apiRef.current = null;
        labelHost.remove();
        lineMat.dispose();
        linkMat.dispose();
        circleMat.dispose();
        circleActiveMat.dispose();
        shapes.forEach((sh) => sh.line?.geometry.dispose());
        if (lines) lines.geometry.dispose();
        if (linkLines) linkLines.geometry.dispose();
        disposeTree(scene);
        dispose();
      };
    }).catch((err) => {
      // The page keeps its list either way; say why the map is missing.
      console.error('[galaxy] scene failed', err);
    });

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [data, cameraRef]);

  useEffect(() => {
    apiRef.current?.setShown(shown, top);
  }, [shown, top]);

  useEffect(() => {
    apiRef.current?.select(selected);
  }, [selected]);

  useEffect(() => {
    apiRef.current?.setLinks(links);
  }, [links]);

  useEffect(() => {
    apiRef.current?.setCircles(circles);
  }, [circles]);

  useEffect(() => {
    apiRef.current?.setCircle(circle);
  }, [circle]);

  return <div className="galaxy-scene" ref={hostRef} />;
}

GalaxyScene.propTypes = {
  data: PropTypes.shape({
    center: PropTypes.string,
    mode: PropTypes.string,
    following: PropTypes.arrayOf(PropTypes.string),
    followers: PropTypes.arrayOf(PropTypes.string),
    followersKnown: PropTypes.bool,
    sampled: PropTypes.arrayOf(PropTypes.string),
    leads: PropTypes.object,
    suggestions: PropTypes.arrayOf(PropTypes.object),
  }),
  shown: PropTypes.arrayOf(PropTypes.string).isRequired,
  top: PropTypes.arrayOf(PropTypes.string).isRequired,
  selected: PropTypes.string,
  links: PropTypes.shape({
    name: PropTypes.string,
    out: PropTypes.arrayOf(PropTypes.string),
    in: PropTypes.arrayOf(PropTypes.string),
  }),
  circles: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    label: PropTypes.string,
    members: PropTypes.arrayOf(PropTypes.string),
  })),
  circle: PropTypes.string,
  onHover: PropTypes.func,
  onSelect: PropTypes.func,
  onCircle: PropTypes.func,
  onMoved: PropTypes.func,
  cameraRef: PropTypes.shape({ current: PropTypes.object }),
};

export default GalaxyScene;
