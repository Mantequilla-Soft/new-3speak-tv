import { lazy } from "react";
import { reloadOnceForChunk } from "./staleChunk";

/* Drop-in replacement for React.lazy() for route components.
 *
 * A dynamic import is a network fetch, and when it fails React.lazy() simply
 * suspends forever — the Suspense fallback stays on screen with nothing ever
 * replacing it. On the shorts route that fallback is a full-bleed dark panel, so
 * the whole thing reads as "the site showed me a black screen".
 *
 * It fails for two mundane reasons, neither of them a bug in the page:
 *
 *   - In production, a deploy replaced the content-hashed chunk files while a tab
 *     was still holding the previous index.html. Every chunk that tab has not
 *     downloaded yet is already 404, so the FIRST navigation after a deploy breaks
 *     and stays broken until the user reloads by hand.
 *   - On the dev server, Vite rebuilt its module graph while a navigation was in
 *     flight. This is what happened on preview: a save burst at 21:05:14 and a
 *     failed /shorts import seven seconds later.
 *
 * 🚨 Retrying the import in place does NOT work, and it is worth being explicit
 * about why, because the code for it looks perfectly reasonable. A module URL that
 * failed to load is poisoned for the lifetime of the document: the browser records
 * the rejection in its module map, so a second import() of the same specifier
 * returns that cached rejection WITHOUT issuing another request. Measured on
 * preview — one network attempt per page load, never two, no matter how long the
 * delay before the retry. A cache-busting query string would dodge it, but the
 * specifier is baked in at build time and there is no way back to the resolved URL
 * from here.
 *
 * So the only real recovery is a fresh document. Reload once, then stop and let the
 * error boundary say something the user can act on.
 */

export default function lazyRoute(factory, name) {
  return lazy(() =>
    factory().catch(async (err) => {
      if (await reloadOnceForChunk(name)) {
        // The reload navigates away; nothing after this runs. Hand back a promise
        // that never settles so React holds the fallback during teardown instead
        // of flashing an error on the way out.
        return await new Promise(() => {});
      }

      console.error(`[route] chunk failed to load: ${name}`, err);
      throw err;
    }),
  );
}
