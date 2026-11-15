/**
 * The shorts editor's auto captions, as it sends them with `post-to-3speak`:
 * `subtitles: { language, vttUrl, srtUrl, cues: [{ start, end, text }], burnedIn }`.
 *
 * After the Short is published they become its 3Speak subtitles in that
 * language (lib/captionEdit.js saveCaptionEdit, the checker's POST
 * /subtitles/edit, which lets the author add a language). `burnedIn`: the words
 * are in the picture too ("Show in the video" in the editor), so the track is
 * stored with that flag and CC stays off for it by default (hooks/useSubtitles.js);
 * the transcript and search still use it.
 *
 * The editor is a separate site, so everything is checked here: a plain
 * language code, at most 6000 lines of finite times, text as a string.
 */
const LANG_RE = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})?$/;
const MAX_CUES = 6000;
const MAX_SECONDS = 24 * 3600;

/** The editor's subtitles -> { language, cues, burnedIn } or null when unusable. */
export function sanitizeEditorSubtitles(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cues)) return null;
  const rawLang = typeof raw.language === 'string' ? raw.language.trim().toLowerCase() : '';
  // whisper's "auto" (or nothing) is not a language: English, like the generator
  const language = LANG_RE.test(rawLang) ? rawLang : 'en';
  const cues = [];
  for (const c of raw.cues.slice(0, MAX_CUES)) {
    if (!c || typeof c !== 'object' || typeof c.text !== 'string') continue;
    const start = Number(c.start);
    const end = Number(c.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || end > MAX_SECONDS) continue;
    const text = c.text.slice(0, 2000);
    if (!text.trim()) continue;
    cues.push({ start, end, text });
  }
  if (!cues.length) return null;
  return { language, cues, burnedIn: raw.burnedIn === true };
}

/**
 * The languages CC may switch on by itself: not the ones burnt into the
 * picture (the viewer would read every word twice). The viewer can still pick
 * one in the CC menu, and the transcript lists them all.
 */
export const autoCaptionLanguages = (list) => (Array.isArray(list) ? list.filter((l) => l && l.burnedIn !== true) : []);
