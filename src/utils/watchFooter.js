// 3Speak's own footer lines in a post body: "▶ [Watch on 3speak.tv](...)" (and the
// older "Watch on 3Speak" / "[3Speak]" ones) and the creator banner image under it.
// Never caption text: the shorts player, stories and cards show the caption, and a
// link back to the site the viewer is already on is noise (owner, 2026-11-05).
const WATCH_FOOTER_LINE_RE = /^[ \t]*(?:▶|\uFE0F|[ \t])*\[\s*(?:Watch on 3speak\.tv|Watch on 3Speak|3Speak)\s*\]\([^)\n]*\)[ \t]*$/gim;
const BANNER_LINE_RE = /^[ \t]*\[!\[[^\]\n]*\]\(https:\/\/3speak\.tv\/banners\/[^)\n]*\)\]\([^)\n]*\)[ \t]*$/gim;

export function stripWatchFooter(body) {
  if (!body) return "";
  return String(body)
    .replace(WATCH_FOOTER_LINE_RE, '')
    .replace(BANNER_LINE_RE, '')
    // The "---" that separated the footer, now left dangling at the end.
    .replace(/(?:\s*\n[ \t]*-{3,}[ \t]*)+\s*$/, '')
    .replace(/^\s*-{3,}\s*$/, '');
}
