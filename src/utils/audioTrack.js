// Who a track in the audio player is by: an outside podcast episode names its
// show, a 3Speak upload its @account (as the player itself shows them).
export function trackArtist(item) {
  if (!item) return '';
  if (item.external) return item.show || '';
  return item.owner ? `@${item.owner}` : '';
}

/** "Title · Artist" for the tab of the audio pages, '' when nothing is loaded. */
export function nowPlayingLabel(item) {
  if (!item?.title) return '';
  const artist = trackArtist(item);
  return artist ? `${item.title} · ${artist}` : item.title;
}
