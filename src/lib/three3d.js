// Shared plumbing for the few 3D touches on the site (leaderboard podium,
// yearly recap).
//
// three.js is ~150 KB gzipped, so it is never in the main bundle: every scene
// asks for it through loadThree(), which Vite splits into its own chunk the
// first time a 3D piece is actually shown. A chunk that fails to load (a deploy
// swapped the hashes, a flaky phone connection) must never take the page with
// it, so callers always keep a flat fallback and switch to it when this
// rejects or WebGL is missing.

let threePromise = null;

export function loadThree() {
  if (!threePromise) {
    threePromise = import('three').catch((err) => {
      // Let the next caller try again rather than caching the failure.
      threePromise = null;
      throw err;
    });
  }
  return threePromise;
}

// WebGL can be missing (old devices, some privacy browsers, GPU blocklists).
let webglOk = null;
export function hasWebGL() {
  if (webglOk !== null) return webglOk;
  try {
    const c = document.createElement('canvas');
    webglOk = !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    webglOk = false;
  }
  return webglOk;
}

export function prefersReducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

// The site's flat palette, as three.js colours. Matte and solid on purpose:
// no gradients, glass or glow (3Speak corporate identity).
export const PALETTE = {
  red: 0xe53935,
  redDark: 0xb71c1c,
  white: 0xf5f5f5,
  dark: 0x1e1e1e,
  darker: 0x121212,
  grey: 0x3a3a3a,
};

// Reads the current theme so scenes match light and dark mode.
export function isDarkTheme() {
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme') || root.className;
  if (/light/.test(theme)) return false;
  if (/dark/.test(theme)) return true;
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

/**
 * Renderer sized to `host`, following its size, with a transparent background
 * so the page colour shows through. Returns { renderer, dispose }.
 */
export function createRenderer(THREE, host, { pixelRatioCap = 2 } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  return {
    renderer,
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss?.();
      renderer.domElement.remove();
    },
  };
}

// Frees every geometry, material and texture under `root`.
export function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose?.();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    mats.forEach((m) => {
      // Textures marked `userData.shared` belong to a cache that outlives this tree.
      Object.values(m).forEach((v) => v?.isTexture && !v.userData?.shared && v.dispose());
      m.dispose?.();
    });
  });
}
