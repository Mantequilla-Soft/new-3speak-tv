// Positions for the Hive galaxy (components/Galaxy/GalaxyScene.jsx).
//
// Scanned ring members and the suggestions they lead to are laid out together
// on a sphere by a small force simulation: links pull accounts toward the
// accounts they are linked to, every pair pushes apart. Accounts that share followers end up side
// by side, so circles (a community, a language, a project) show as patches
// instead of a random sprinkle. Only directions come out of here; the scene
// puts them on their own radii.

function rng(seed) {
  let s = seed >>> 0 || 7;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function seedOf(text) {
  let s = 0;
  for (const ch of String(text)) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return s;
}

/**
 * n points spread evenly over a sphere (Fibonacci lattice) as [x, y, z]
 * arrays, `radius` jittered by +-jitter/2 and the poles squashed a little.
 */
export function shell(n, radius, jitter, seed) {
  const pts = [];
  const rnd = rng(seed);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i += 1) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    const rad = radius * (1 + (rnd() - 0.5) * jitter);
    pts.push([Math.cos(a) * r * rad, y * rad * 0.8, Math.sin(a) * r * rad]);
  }
  return pts;
}

/**
 * Unit directions (Float32Array, 3 per node) for `n` nodes linked by `edges`
 * ([[i, j], ...]). Deterministic for a given seed, so a galaxy keeps its shape
 * between visits. O(n^2) per step; n stays under ~500 here (scan depth plus
 * 200 candidates), which runs in well under 100 ms.
 *
 * `groups` (a group id per node, e.g. from louvain) adds a pull toward each
 * group's middle, so every group settles as one patch of sky.
 *
 * A node's link pull is the AVERAGE over its links, not the sum: in a deep
 * scan an account followed by 60 scanned accounts would otherwise be dragged
 * across every neighbouring group, and those well-followed accounts are
 * exactly the ones on the map. Summed, groups smeared over 60-130 degrees on
 * deep scans; averaged, 15-40 on every galaxy tried.
 */
export function clusterDirections(n, edges, { seed = 1, iterations = 200, groups = null } = {}) {
  const p = new Float32Array(n * 3);
  const f = new Float32Array(n * 3);
  if (!n) return p;

  // Start from an even spread in shuffled order, so rank doesn't decide place.
  const rnd = rng(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const golden = Math.PI * (3 - Math.sqrt(5));
  order.forEach((node, i) => {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    p[node * 3] = Math.cos(i * golden) * r;
    p[node * 3 + 1] = y;
    p[node * 3 + 2] = Math.sin(i * golden) * r;
  });

  const kRep = 0.6 / n;
  const kAtt = 0.3;
  const kGroup = 0.5;
  const deg = new Float32Array(n);
  edges.forEach(([a, b]) => { deg[a] += 1; deg[b] += 1; });
  let maxMove = 0.08;

  for (let it = 0; it < iterations; it += 1) {
    f.fill(0);
    for (let i = 0; i < n; i += 1) {
      const ix = i * 3;
      for (let j = i + 1; j < n; j += 1) {
        const jx = j * 3;
        const dx = p[ix] - p[jx];
        const dy = p[ix + 1] - p[jx + 1];
        const dz = p[ix + 2] - p[jx + 2];
        const k = kRep / (dx * dx + dy * dy + dz * dz + 0.004);
        f[ix] += dx * k; f[ix + 1] += dy * k; f[ix + 2] += dz * k;
        f[jx] -= dx * k; f[jx + 1] -= dy * k; f[jx + 2] -= dz * k;
      }
    }
    for (const [a, b] of edges) {
      const ax = a * 3;
      const bx = b * 3;
      const dx = p[bx] - p[ax];
      const dy = p[bx + 1] - p[ax + 1];
      const dz = p[bx + 2] - p[ax + 2];
      const ka = kAtt / deg[a];
      const kb = kAtt / deg[b];
      f[ax] += dx * ka; f[ax + 1] += dy * ka; f[ax + 2] += dz * ka;
      f[bx] -= dx * kb; f[bx + 1] -= dy * kb; f[bx + 2] -= dz * kb;
    }
    if (groups) {
      const mid = new Map(); // group -> [x, y, z, members]
      for (let i = 0; i < n; i += 1) {
        const c = mid.get(groups[i]) || [0, 0, 0, 0];
        c[0] += p[i * 3]; c[1] += p[i * 3 + 1]; c[2] += p[i * 3 + 2]; c[3] += 1;
        mid.set(groups[i], c);
      }
      for (let i = 0; i < n; i += 1) {
        const c = mid.get(groups[i]);
        if (c[3] < 3) continue;
        const len = Math.hypot(c[0], c[1], c[2]) || 1;
        f[i * 3] += (c[0] / len - p[i * 3]) * kGroup;
        f[i * 3 + 1] += (c[1] / len - p[i * 3 + 1]) * kGroup;
        f[i * 3 + 2] += (c[2] / len - p[i * 3 + 2]) * kGroup;
      }
    }
    for (let i = 0; i < n; i += 1) {
      const ix = i * 3;
      let mx = f[ix];
      let my = f[ix + 1];
      let mz = f[ix + 2];
      // Capped steps that shrink over time: no node is flung across the
      // sphere by a crowded start, and the shape settles instead of jittering.
      const len = Math.hypot(mx, my, mz);
      if (len > maxMove) { const s = maxMove / len; mx *= s; my *= s; mz *= s; }
      const x = p[ix] + mx;
      const y = p[ix + 1] + my;
      const z = p[ix + 2] + mz;
      const norm = Math.hypot(x, y, z) || 1;
      p[ix] = x / norm; p[ix + 1] = y / norm; p[ix + 2] = z / norm;
    }
    maxMove *= 0.975;
  }
  return p;
}

/**
 * Community detection (Louvain): splits a graph into groups that link far
 * more inside than out, by greedily moving nodes to the neighbouring group
 * that raises modularity most, then folding each group into one node and
 * repeating. Returns a group index per node. `edges` as for
 * clusterDirections; unweighted, undirected. Deterministic for a given seed.
 */
export function louvain(n, edges, { seed = 1 } = {}) {
  const rnd = rng(seed);
  // Symmetric adjacency; a self-loop holds twice the weight inside it, so a
  // node's degree is always the plain sum of its row.
  let adj = Array.from({ length: n }, () => new Map());
  edges.forEach(([a, b]) => {
    if (a === b) return;
    adj[a].set(b, (adj[a].get(b) || 0) + 1);
    adj[b].set(a, (adj[b].get(a) || 0) + 1);
  });
  let mapping = Array.from({ length: n }, (_, i) => i);

  for (let level = 0; level < 10; level += 1) {
    const size = adj.length;
    const deg = adj.map((row) => { let k = 0; row.forEach((w) => { k += w; }); return k; });
    const m2 = deg.reduce((a, b) => a + b, 0);
    if (!m2) break;
    const comm = Array.from({ length: size }, (_, i) => i);
    const tot = [...deg];
    let improved = false;

    for (let pass = 0; pass < 20; pass += 1) {
      let moved = false;
      const order = Array.from({ length: size }, (_, i) => i);
      for (let i = size - 1; i > 0; i -= 1) {
        const j = Math.floor(rnd() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      for (const i of order) {
        const ci = comm[i];
        const ki = deg[i];
        const links = new Map();
        adj[i].forEach((w, j) => { if (j !== i) links.set(comm[j], (links.get(comm[j]) || 0) + w); });
        tot[ci] -= ki;
        let best = ci;
        let bestGain = (links.get(ci) || 0) - (tot[ci] * ki) / m2;
        links.forEach((w, c) => {
          const gain = w - (tot[c] * ki) / m2;
          if (gain > bestGain + 1e-12) { bestGain = gain; best = c; }
        });
        tot[best] += ki;
        if (best !== ci) { comm[i] = best; moved = true; improved = true; }
      }
      if (!moved) break;
    }
    if (!improved) break;

    // Renumber, fold each group into a node, and go again one level up.
    const ids = new Map();
    comm.forEach((c) => { if (!ids.has(c)) ids.set(c, ids.size); });
    const next = Array.from({ length: ids.size }, () => new Map());
    adj.forEach((row, i) => row.forEach((w, j) => {
      const a = ids.get(comm[i]);
      const b = ids.get(comm[j]);
      next[a].set(b, (next[a].get(b) || 0) + w);
    }));
    mapping = mapping.map((s) => ids.get(comm[s]));
    adj = next;
  }
  return mapping;
}
