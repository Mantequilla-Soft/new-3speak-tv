// The Spotlight's video goes first (owner 2026-11-12: the landing page should
// load faster). While the hero holds this, the cards' hover previews wait
// before they resolve and warm their streams (hooks/useHoverPreview.jsx), so
// the hero's first segment isn't sharing the line with a dozen others. The
// hero lets go once its video plays, and a hold never lasts past HOLD_MS.
const HOLD_MS = 3500;

let gate = null;      // { promise, release, timer } while held
let holders = 0;

export function holdForHero() {
  holders += 1;
  if (!gate) {
    let release;
    const promise = new Promise((resolve) => { release = resolve; });
    const timer = setTimeout(() => releaseHero(true), HOLD_MS);
    gate = { promise, release, timer };
  }
  return () => releaseHero(false);
}

export function releaseHero(all = false) {
  if (!gate) return;
  holders = all ? 0 : Math.max(0, holders - 1);
  if (holders > 0 && !all) return;
  clearTimeout(gate.timer);
  gate.release();
  gate = null;
  holders = 0;
}

// Resolves at once when nothing is held.
export function heroReady() {
  return gate ? gate.promise : Promise.resolve();
}
