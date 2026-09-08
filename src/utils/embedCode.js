/**
 * Embed code for a 3Speak video — the snippet the watch page's share menu hands
 * to someone putting the video on their own site.
 *
 * Two decisions worth keeping:
 *
 * 1. The origin is ALWAYS the public player (EMBED_PLAYER_BASE), never
 *    getPlayerUrl(). That resolves to whichever backend answered the session's
 *    health probe — on preview, or during a play.3speak.tv outage, that is a
 *    private/fallback box, and baking it into someone else's page would leave a
 *    permanent link to a host that isn't meant to serve the public.
 *
 * 2. The path is `/watch?v=…`, not `/embed?v=…`. On the player backend
 *    `/api/watch` resolves BOTH collections (legacy `videos` first, then the
 *    embed-video one, which also matches `hive_permlink`), while `/api/embed`
 *    only knows embed assets and 404s on the legacy back catalogue. So /watch is
 *    the one form that works for every video, taking the Hive author/permlink
 *    straight from the watch URL — no asset lookup, nothing to get wrong.
 *
 * `mode=iframe` drops the player's header/info panel, leaving just the video.
 */
import { EMBED_PLAYER_BASE } from './config';

const ALLOW = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';

// Offered in the share menu. `responsive` is first because it is what a blog or
// CMS almost always wants: the 56.25% padding box keeps 16:9 at any width.
export const EMBED_SIZES = [
  { id: 'responsive', label: 'Responsive' },
  { id: 'small', label: '560 × 315', width: 560, height: 315 },
  { id: 'medium', label: '854 × 480', width: 854, height: 480 },
  { id: 'large', label: '1280 × 720', width: 1280, height: 720 },
];

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The iframe src for a video, by its HIVE author/permlink (what /watch shows). */
export function buildEmbedSrc(author, permlink) {
  const v = `${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`;
  return `${EMBED_PLAYER_BASE}/watch?v=${v}&mode=iframe`;
}

/** Ready-to-paste HTML. `size` is an EMBED_SIZES id. */
export function buildEmbedHtml(author, permlink, { size = 'responsive', title = '' } = {}) {
  const src = buildEmbedSrc(author, permlink);
  // A quote or an ampersand in a video title would otherwise break out of the
  // title attribute and mangle the snippet the moment it is pasted.
  const label = escapeAttr(String(title || '').trim() || '3Speak video');
  const spec = EMBED_SIZES.find((s) => s.id === size) || EMBED_SIZES[0];

  if (spec.id === 'responsive') {
    return [
      '<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden;max-width:100%">',
      `  <iframe src="${src}"`,
      '    style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"',
      `    allowfullscreen allow="${ALLOW}"`,
      `    title="${label}"></iframe>`,
      '</div>',
    ].join('\n');
  }

  return [
    `<iframe src="${src}"`,
    `  width="${spec.width}" height="${spec.height}" style="border:0"`,
    `  allowfullscreen allow="${ALLOW}"`,
    `  title="${label}"></iframe>`,
  ].join('\n');
}
