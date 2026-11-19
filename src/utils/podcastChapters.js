/**
 * Chapters of a live show recorded as a podcast (H23), from the hangouts server's
 * structured list ({ start, kind, identity?, title? }; kind is start, join or marker)
 * to the audio upload's { start, title } in the viewer's language. The upload
 * re-checks them (utils/audioChapters.js sanitizeChapters).
 */
export function podcastChapters(raw, showTitle, t) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && Number.isFinite(Number(c.start)))
    .map((c) => {
      const start = Number(c.start);
      if (c.kind === 'marker') return { start, title: String(c.title || '') || t('podcastRecord.chapters.marker') };
      // A speaker joining the stage (the only kind that carries an identity).
      if (c.kind !== 'start' && c.identity) return { start, title: t('podcastRecord.chapters.join', { user: c.identity }) };
      return { start, title: showTitle ? String(showTitle) : t('podcastRecord.chapters.intro') };
    });
}
