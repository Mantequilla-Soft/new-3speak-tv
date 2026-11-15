/**
 * The shape of what the editor made, and so how it goes to 3Speak. The editor
 * (`editor-ready` says `canFormat: true`) sends it with `post-to-3speak`:
 *   format: { aspect: '9:16' | '16:9' | '4:3' | '1:1', short: boolean, durationSec? }
 * A 9:16 render is a Short (the Shorts uploader, as before); a 16:9, 4:3 or 1:1
 * one, and the audio editor's video podcast (`mediaType: 'video'`), is a normal
 * 3Speak video (the video uploader, with title, tags and chapters). An editor
 * that says nothing about the shape only makes Shorts.
 *
 * The editor opens in a shape with ?aspect= (editorAspect): the share menu's
 * Video editor and a normal upload's "Edit video" open it landscape.
 */
export const EDITOR_ASPECTS = ['9:16', '16:9', '4:3', '1:1'];
// The editor's limit for anything that is not a Short (the owner's rule)
export const EDITOR_VIDEO_MAX_SEC = 10 * 60;

/** 'short' or 'video': how a post-to-3speak from the editor is published. */
export function editorPostKind(data) {
  if (!data || typeof data !== 'object') return 'short';
  const f = data.format && typeof data.format === 'object' ? data.format : null;
  if (f && typeof f.short === 'boolean') return f.short ? 'short' : 'video';
  if (f && EDITOR_ASPECTS.includes(f.aspect)) return f.aspect === '9:16' ? 'short' : 'video';
  if (data.mediaType === 'video') return 'video';
  return 'short';
}

/** A shape the editor knows, else null (the editor then opens as a Short). */
export function editorAspect(value) {
  return EDITOR_ASPECTS.includes(value) ? value : null;
}

/** The video's title the editor suggests (the video podcast: the episode's), checked. */
export function editorTitle(value) {
  if (typeof value !== 'string') return '';
  // control characters and runs of spaces become one space
  return [...value].map((ch) => (ch.charCodeAt(0) < 32 ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * The editor's chapters ([{ start, end?, title }], seconds) as the video
 * uploader's timeline chapters ([{ start, title, _k }]; utils/videoTimeline.js
 * checks them again on publish). Nothing when they do not start at 0:00.
 */
export function editorChapters(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw.slice(0, 200)) {
    const start = Math.round(Number(c?.start));
    const title = editorTitle(c?.title);
    if (!Number.isFinite(start) || start < 0 || !title) continue;
    if (out.length && start <= out[out.length - 1].start) continue;
    out.push({ start, title, _k: `ed${out.length}` });
  }
  return out.length && out[0].start === 0 ? out : [];
}
