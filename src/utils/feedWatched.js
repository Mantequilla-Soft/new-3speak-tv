import { useAppStore } from '../lib/store';

/**
 * Drop a video the viewer just watched out of the already-loaded feeds, in place.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * "Hide watched" is enforced by the CHECKER, per request (`&hidewatched=1`), so a
 * video you just watched only disappeared when the feed was fetched again. The only
 * thing fetching it again was React Query's `refetchOnWindowFocus`, which refetched
 * EVERY loaded page of EVERY feed once the 5-minute staleTime had passed. That is
 * why coming back to the tab handed you a different feed: it was not refreshing to
 * hide the video you watched, it was rebuilding the whole list, and anything the
 * ranking had moved in the meantime moved with it.
 *
 * So the refetch is off (see main.jsx) and the one effect worth keeping is done
 * locally instead: remove exactly the video that was watched, leave every other row
 * exactly where it was. The server-side filter still applies on the next genuine
 * load, so this is a display shortcut, never the source of truth.
 *
 * Only the feeds that actually ASK the server to hide watched videos are touched,
 * and only when the viewer has the preference on. With it off, nothing is removed.
 */

// Feed caches that are built with `&hidewatched=`. Matched on the first key
// segment. Listed explicitly rather than pattern-matched: this mutates cached data,
// so it should only ever reach lists we know hold feed videos.
const FEED_KEYS = new Set([
  'home-grouped',
  'follow-feed',
  'discover-grouped',
  'interests-grouped',
  'feed-shorts',
  'trending',
]);

// ⚠️ NOT 'newcontent-grouped'. The New feed hardcodes `&hidewatched=0` because it
// has to stay purely chronological and complete — the server never hides a watched
// video there, so neither may we, or videos would start vanishing from the one feed
// that is supposed to show everything.

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * An embed's uploader (`owner`) is not always its Hive author (`author`), and the
 * watch page only knows the one it was opened with, so a card matches if EITHER
 * side lines up with it. The permlink must always match, so this cannot over-remove
 * across different videos by the same creator.
 */
const isSameVideo = (item, author, permlink) => (
  norm(item?.permlink) === permlink
  && (norm(item?.author) === author || norm(item?.owner) === author)
);

/**
 * @param {import('@tanstack/react-query').QueryClient} queryClient
 * @param {{author: string, permlink: string}} video
 */
export function dropWatchedFromFeeds(queryClient, { author, permlink } = {}) {
  if (!queryClient) return;
  const a = norm(author);
  const p = norm(permlink);
  if (!a || !p) return;

  // The preference is the viewer's. With hide-watched off, a video staying in the
  // feed after you watch it is the CORRECT behaviour, not a stale cache.
  const { hideWatched, watchHistoryEnabled } = useAppStore.getState();
  if (!hideWatched || watchHistoryEnabled === false) return;

  queryClient.setQueriesData(
    { predicate: (q) => FEED_KEYS.has(q.queryKey?.[0]) },
    (data) => {
      if (!data) return data;

      // Infinite queries: { pages: [[video, ...], ...], pageParams: [...] }.
      if (Array.isArray(data.pages)) {
        let changed = false;
        const pages = data.pages.map((page) => {
          if (!Array.isArray(page)) return page;
          const next = page.filter((item) => !isSameVideo(item, a, p));
          if (next.length === page.length) return page;
          changed = true;
          return next;
        });
        // Returning the same object when nothing matched keeps React Query from
        // notifying every subscriber, so unaffected feeds do not re-render.
        return changed ? { ...data, pages } : data;
      }

      if (Array.isArray(data)) {
        const next = data.filter((item) => !isSameVideo(item, a, p));
        return next.length === data.length ? data : next;
      }

      return data;
    },
  );
}

/* ── Shorts, within one page load ────────────────────────────────────────────
 *
 * The checker FREEZES its already-watched filter into the cached feed list, on
 * purpose: a live filter shrinks the list under a scrolling viewer, so page 2 is
 * fetched with skip=(page-1)*limit against a shorter list and lands past shorts
 * they never saw. That cached entry lives 15 minutes and is keyed by the viewer's
 * seed, which is stable for the whole page load. So leaving /shorts and coming
 * straight back hands you the same list, including the ones you just swiped past.
 *
 * This closes that window from the client, where it costs nothing and cannot cause
 * the drift the freeze exists to prevent: the server still builds and paginates
 * exactly the same list, we simply do not re-display what this viewer already saw.
 * Module state, so it survives leaving /shorts and returning, and is gone on reload
 * (by then the server's own filter has been re-evaluated).
 */
const watchedThisLoad = new Set();

const videoKey = (author, permlink) => `${norm(author)}/${norm(permlink)}`;

/**
 * Remember a short the viewer just watched. Both permlinks are stored because the
 * feed rows carry the ASSET id in `permlink` while a watch is recorded against the
 * HIVE permlink, and either can be the one that comes back.
 */
export function rememberWatchedShort({ author, permlink, hivePermlink } = {}) {
  if (!author) return;
  if (permlink) watchedThisLoad.add(videoKey(author, permlink));
  if (hivePermlink) watchedThisLoad.add(videoKey(author, hivePermlink));
}

/**
 * Drop shorts already watched this page load out of a freshly fetched feed page.
 * Call it at FETCH time only, never on already-rendered state: removing a row the
 * viewer is looking at is the drift this is meant to avoid.
 *
 * Never returns an empty list, because the caller is usually building the feed the
 * viewer is about to look at: if they really have seen everything on the page,
 * showing it again beats an empty screen telling them there are no shorts. Pass
 * `allowEmpty` when appending a later page, where dropping everything just means
 * the next page is fetched instead.
 */
export function dropWatchedShorts(list, { allowEmpty = false } = {}) {
  if (!Array.isArray(list) || list.length === 0 || watchedThisLoad.size === 0) return list;
  const { hideWatched, watchHistoryEnabled } = useAppStore.getState();
  if (!hideWatched || watchHistoryEnabled === false) return list;

  const next = list.filter((v) => !(
    watchedThisLoad.has(videoKey(v?.author, v?.permlink))
    || watchedThisLoad.has(videoKey(v?.author, v?.hivePermlink))
  ));
  return (next.length || allowEmpty) ? next : list;
}
