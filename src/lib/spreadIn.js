// Mixes `extras` (the warm-up videos) into a ranked feed at spread-out spots
// instead of stacking them at the top (owner 2026-11-12: "mix the warmup videos
// somewhere in the discover feed and not at the top").
//
// The first one goes in after `start` cards (about two rows on a desktop grid),
// then one every `gap` cards, each spot nudged by up to `jitter` cards either
// way so the pattern does not look mechanical. The nudges come from `seed`
// (the feed's session seed, utils/feedSeed.js), so the spots stay put while the
// page is open and change on a reload.
//
// A spot further down than the feed has loaded so far waits for the page that
// reaches it, so a card never sits at the bottom and then jumps up as more
// pages arrive. When the feed is `complete` (no more pages), what is left goes
// at the end.

// mulberry32: tiny deterministic PRNG from a 32-bit seed.
function rng(seed) {
  let a = (Number(seed) || 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function spreadIn(videos, extras, { start = 8, gap = 6, jitter = 1, seed = 0, complete = false } = {}) {
  const feed = Array.isArray(videos) ? videos : [];
  if (!Array.isArray(extras) || !extras.length) return feed;
  const rand = rng(seed);
  const out = [];
  let next = 0; // index into feed
  let slot = start + Math.round((rand() * 2 - 1) * jitter);
  for (const extra of extras) {
    // Feed cards up to this slot, counted in the OUTPUT (so earlier extras count).
    while (out.length < slot && next < feed.length) out.push(feed[next++]);
    if (out.length < slot) {
      // The feed has not loaded this far yet.
      if (!complete) break;
    }
    out.push(extra);
    slot = out.length + gap + Math.round((rand() * 2 - 1) * jitter);
  }
  while (next < feed.length) out.push(feed[next++]);
  return out;
}
