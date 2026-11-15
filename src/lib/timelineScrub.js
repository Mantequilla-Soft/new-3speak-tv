/**
 * Press-and-drag scrubbing on the audio timelines (the full player's progress bar
 * and waveform, the docked bar's line, the audio page): the pure parts, so the
 * hook (hooks/useTimelineScrub.js) stays small and the math can be tested alone.
 */

/** Where a pointer at `clientX` sits along `rect`, as a fraction in [0, 1]. */
export function fractionAt(clientX, rect) {
  if (!rect || !(rect.width > 0) || !Number.isFinite(clientX)) return 0;
  return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
}

// While dragging, seek live at most this often (local or cached files only:
// over the network each seek is a new range request, so those wait for release).
export const LIVE_SEEK_MS = 150;

/** Should a drag move seek right away? Only for a file in this browser, throttled. */
export function shouldLiveSeek({ local, now, lastAt, everyMs = LIVE_SEEK_MS }) {
  return !!local && now - (lastAt || 0) >= everyMs;
}

/** A source played from this browser (a download, a blob), cheap to seek in. */
export function isLocalSource(src) {
  return /^(blob:|data:|filesystem:)/i.test(String(src || ''));
}
