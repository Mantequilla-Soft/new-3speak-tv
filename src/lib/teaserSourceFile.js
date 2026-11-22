// "Make a Short from this video" (the finished upload's screen): the video that
// opened the Shorts editor, kept in memory for this tab only, so the Short's own
// finished screen can open it again for another moment. The Short itself names
// the video through EmbedUploadContext's teaserOf; this keeps only the local
// file, which the upload state forgets once the Short starts clean.
//
// The editor gets the whole video on its track and the creator picks the moment;
// it renders once the timeline fits a Short.

// Which uploads get the button (owner 2026-11-22): 5 to 30 minutes and at most
// 1 GB. Shorter ones are nearly Shorts already; longer or bigger ones are a long
// second upload to the editor (it takes at most 2 GB anyway).
export const TEASER_MIN_SECONDS = 5 * 60;
export const TEASER_MAX_SECONDS = 30 * 60;
export const TEASER_MAX_BYTES = 1024 * 1024 * 1024;

/** Whether a video ({ file, duration } in seconds) can get "Make a Short": unknown length = no. */
export function teaserEligible({ file, duration } = {}) {
  const d = Number(duration);
  return file instanceof Blob
    && file.size > 0 && file.size <= TEASER_MAX_BYTES
    && Number.isFinite(d) && d >= TEASER_MIN_SECONDS && d <= TEASER_MAX_SECONDS;
}

let source = null; // { file, author, permlink }

/** Remember the uploaded video (a File/Blob) as the source of teaser Shorts. */
export function rememberTeaserSource({ file, author, permlink }) {
  if (!(file instanceof Blob) || !author || !permlink) return null;
  source = { file, author: String(author).toLowerCase(), permlink: String(permlink) };
  return source;
}

/** The remembered source when it is the video `ref` ({ author, permlink }) names, else null. */
export function teaserSourceFor(ref) {
  if (!source || !ref) return null;
  return String(ref.author || '').toLowerCase() === source.author && ref.permlink === source.permlink ? source : null;
}

/** Open the Shorts editor with the whole of `src` (useEditorLauncher detail.teaser). */
export function openTeaserEditor(src, target = window) {
  if (!src) return false;
  target.dispatchEvent(new CustomEvent('open-shorts-editor', {
    detail: { file: src.file, teaser: { author: src.author, permlink: src.permlink } },
  }));
  return true;
}

/** Tests only. */
export function _resetTeaserSource() { source = null; }
