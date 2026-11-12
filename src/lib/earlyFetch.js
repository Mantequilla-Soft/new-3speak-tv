// Requests started by the inline script in index.html, before the app's
// JavaScript has even downloaded (window.__early, keyed by name). The home
// page's Spotlight is the largest thing on the first screen and waited ~0.5 s
// for the app to boot before it could ask for its videos; now the request is
// already on its way.
//
// takeEarly(key) hands such a request's promise (of the parsed JSON body) over
// ONCE; later calls get null, as do requests older than maxAgeMs (a visitor
// who comes back to the home page much later gets fresh data instead).

const DEFAULT_MAX_AGE_MS = 60 * 1000;

export function takeEarly(key, maxAgeMs = DEFAULT_MAX_AGE_MS) {
  const early = typeof window !== 'undefined' ? window.__early : null;
  const promise = early?.[key];
  if (!promise) return null;
  delete early[key];
  const age = typeof performance !== 'undefined' ? performance.now() : 0;
  return age <= maxAgeMs ? promise : null;
}

// The key the index.html script stores the Spotlight's pages under. Keep the
// two in step: same page size, same nsfw flag.
export const featuredEarlyKey = (page, showNsfw) => `featured:${page}:${showNsfw ? 1 : 0}`;
