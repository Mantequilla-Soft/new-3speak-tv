/*
 * Songs picked from the shorts editor's music library arrive with the rendered
 * video as `musicCredits`. They end up in three places on the post:
 *   - a credit line in the body (CC BY songs must be credited),
 *   - `json_metadata.video.sound`, which the shorts soundtrack ticker shows
 *     instead of "Original Audio",
 *   - a locked 5% beneficiary for each 3Speak creator whose sound was used.
 * The editor is a separate site, so everything is re-checked here: plain text
 * only, https links only, real-looking Hive account names, a few entries at most.
 */

const MAX_CREDITS = 4;
// Every sound creator costs a beneficiary slot, and Hive allows only eight
export const MAX_SOUND_AUTHORS = 2;

const HIVE_ACCOUNT = /^[a-z][a-z0-9-]{1,14}[a-z0-9](\.[a-z][a-z0-9-]{1,14}[a-z0-9])*$/;

function cleanText(v, max = 100) {
  if (typeof v !== 'string') return '';
  // No markdown or HTML: these go into the post body
  return v.replace(/[\r\n\t]+/g, ' ').replace(/[[\]()*_`<>#|\\~]/g, '').trim().slice(0, max);
}

function cleanUrl(v) {
  if (typeof v !== 'string') return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

function cleanAccount(v) {
  if (typeof v !== 'string') return null;
  const a = v.trim().toLowerCase().replace(/^@/, '');
  return a.length >= 3 && a.length <= 16 && HIVE_ACCOUNT.test(a) ? a : null;
}

/** The credits as sent by the editor -> a safe list (may be empty). */
export function sanitizeMusicCredits(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const title = cleanText(c.title);
    if (!title) continue;
    const id = cleanText(c.id, 120) || title;
    if (seen.has(id)) continue;
    seen.add(id);
    const is3speak = c.source === '3speak';
    const account = is3speak ? cleanAccount(c.account) : null;
    if (is3speak && !account) continue;
    out.push({
      id,
      title,
      artist: cleanText(c.artist) || (account ? `@${account}` : ''),
      source: is3speak ? '3speak' : cleanText(c.source, 60) || null,
      sourceUrl: cleanUrl(c.sourceUrl),
      license: cleanText(c.license, 40) || null,
      licenseUrl: cleanUrl(c.licenseUrl),
      account,
    });
    if (out.length >= MAX_CREDITS) break;
  }
  return out;
}

/** 3Speak sound creators who get the locked split (never the poster themselves). */
export function soundAuthorsOf(credits, username) {
  const accounts = [];
  for (const c of credits || []) {
    if (c.account && c.account !== username && !accounts.includes(c.account)) accounts.push(c.account);
  }
  return accounts.slice(0, MAX_SOUND_AUTHORS);
}

const LICENSE_LABELS = {
  'CC BY 4.0': 'Creative Commons: By Attribution 4.0 License',
};

/** Markdown for the end of the post body, or '' when there are no songs. */
export function soundCreditsMarkdown(credits) {
  if (!credits || !credits.length) return '';
  const lines = credits.map((c) => {
    if (c.source === '3speak') {
      const who = `[@${c.account}](https://3speak.tv/user/${c.account})`;
      return c.sourceUrl
        ? `*Sound: ["${c.title}"](${c.sourceUrl}) by ${who}*`
        : `*Sound: "${c.title}" by ${who}*`;
    }
    const where = c.source ? (c.sourceUrl ? ` ([${c.source}](${c.sourceUrl}))` : ` (${c.source})`) : '';
    const licenseLabel = c.license ? LICENSE_LABELS[c.license] || c.license : '';
    const license = licenseLabel
      ? `. Licensed under ${c.licenseUrl ? `[${licenseLabel}](${c.licenseUrl})` : licenseLabel}`
      : '';
    return `*Music: "${c.title}" ${c.artist}${where}${license}*`;
  });
  return `\n\n---\n${lines.join('\n\n')}`;
}

/** `json_metadata.video.sound`: the first song, what the soundtrack ticker shows. */
export function primarySoundMetadata(credits) {
  const c = credits && credits[0];
  if (!c) return null;
  return {
    title: c.title,
    artist: c.artist,
    ...(c.account ? { account: c.account } : {}),
    ...(c.source ? { source: c.source } : {}),
    ...(c.sourceUrl ? { url: c.sourceUrl } : {}),
    ...(c.license ? { license: c.license } : {}),
  };
}

/** Ticker label for a short: the song if it has one, else the creator's original audio. */
export function soundLabel(sound, username) {
  if (sound && typeof sound === 'object' && typeof sound.title === 'string' && sound.title) {
    const artist = cleanText(sound.artist);
    return artist ? `${cleanText(sound.title)} - ${artist}` : cleanText(sound.title);
  }
  return `${username} - Original Audio`;
}
