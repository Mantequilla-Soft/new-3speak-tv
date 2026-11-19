// Fullscreen for a stream on a phone (WatchStream's rail button). The WHOLE
// page goes fullscreen, not the player box, so dialogs opened from the stream
// (Boost, Report) still show over it, and the phone is turned sideways where
// the browser allows it. An iPhone cannot fullscreen a page: there the stream's
// <video> opens in the system player instead.

/** Enter, or leave when already fullscreen. */
export function toggleStreamFullscreen(doc = document, scr = globalThis.screen) {
  if (doc.fullscreenElement) {
    doc.exitFullscreen?.()?.catch?.(() => { /* already left */ });
    return 'exit';
  }
  const root = doc.documentElement;
  if (doc.fullscreenEnabled && root?.requestFullscreen) {
    root.requestFullscreen({ navigationUI: 'hide' })
      .then(() => scr?.orientation?.lock?.('landscape'))
      .catch(() => { /* refused, or the phone cannot turn: fullscreen as it is */ });
    return 'page';
  }
  const video = doc.querySelector('.ws-shorts .hh-stream-video video, .ws-shorts .videoContainer video');
  if (video?.webkitEnterFullscreen) {
    video.webkitEnterFullscreen();
    return 'video';
  }
  return 'none';
}

/** After leaving fullscreen: let the phone turn freely again. */
export function releaseStreamOrientation(scr = globalThis.screen) {
  try { scr?.orientation?.unlock?.(); } catch { /* it never locked */ }
}
