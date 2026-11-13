// The newest videos for the home page's Spotlight, page by page until a page
// reaches back past `since` (used by fetchFeatured in page/HomeGrouped.jsx).
//
// Speed matters here: the Spotlight is the largest thing on the first screen.
//  - The first TWO pages are asked for at once. The 48 h window usually spans
//    more than one page of 100, and the checker takes ~0.5 s per page, so one
//    after the other cost an extra half second; a second page that turns out
//    not to be needed is simply ignored.
//  - A page the index.html script already started (lib/earlyFetch.js) is used
//    instead of asking again; if that early request failed, the page is asked
//    for normally.

import { featuredEarlyKey, takeEarly } from './earlyFetch';

export async function fetchFeaturedPages({ getPage, showNsfw, since, pageSize, maxPages, createdAt }) {
  const load = (page) => {
    const early = takeEarly(featuredEarlyKey(page, showNsfw));
    return early ? early.catch(() => getPage(page)) : getPage(page);
  };
  const ahead = [load(1), maxPages > 1 ? load(2) : null];
  // Page 2 may never be awaited (page 1 already reached back far enough).
  ahead[1]?.catch(() => {});

  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = page <= 2 ? await ahead[page - 1] : await load(page);
    const vids = data?.videos || [];
    all.push(...vids);
    if (vids.length < pageSize || createdAt(vids[vids.length - 1]) < since) break;
  }
  return all;
}
