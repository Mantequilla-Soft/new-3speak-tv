/*
 * Chapters of an episode made in the audio editor. They arrive with the edited
 * MP3 (`chapters: [{ start, end, title }]`, seconds) and go into the track's
 * description as a plain list ("0:00 Intro"), where the creator sees them and
 * can still change them. The editor is a separate site, so everything is
 * re-checked here: plain text only, in order, a hundred at most.
 */

const MAX_CHAPTERS = 100;
const MAX_TITLE = 80;

function cleanTitle(v) {
  if (typeof v !== 'string') return '';
  // No markdown or HTML: these go into the post body
  return v.replace(/[\r\n\t]+/g, ' ').replace(/[[\]()*_`<>#|\\~]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

/** The chapters as sent by the editor -> a safe list (may be empty). */
export function sanitizeChapters(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const start = Number(c.start);
    const title = cleanTitle(c.title);
    if (!Number.isFinite(start) || start < 0 || start > 24 * 3600 || !title) continue;
    if (out.length && start <= out[out.length - 1].start) continue;
    out.push({ start: Math.round(start * 1000) / 1000, title });
    if (out.length >= MAX_CHAPTERS) break;
  }
  return out;
}

/** 75 -> "1:15", 3723 -> "1:02:03" */
export function chapterTime(sec) {
  const s = Math.max(0, Math.floor(sec + 1e-6));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "0:00 Intro\n12:40 Questions" ('' without chapters) */
export function chaptersText(chapters) {
  return (chapters || []).map(c => `${chapterTime(c.start)} ${c.title}`).join('\n');
}

/**
 * The description with the new chapter list: the list it had from an earlier
 * edit (`previous`) is replaced, else the list goes under what was written.
 */
export function withChapters(desc, previous, next) {
  const text = desc || '';
  if (previous && text.includes(previous)) return text.replace(previous, next).replace(/\n{3,}/g, '\n\n').trim();
  if (!next) return text;
  return text.trim() ? `${text.trim()}\n\n${next}` : next;
}
