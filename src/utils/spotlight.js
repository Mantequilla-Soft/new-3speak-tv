// Spotlight — creator link pages ("linktree"). Shared client helpers: the API
// wrapper, the curated icon set, theme/section defaults, and a section factory.
import {
  FaLink, FaGlobe, FaYoutube, FaXTwitter, FaInstagram, FaTiktok, FaDiscord, FaTelegram,
  FaWhatsapp, FaGithub, FaTwitch, FaFacebook, FaLinkedin, FaSpotify, FaSoundcloud, FaPatreon,
  FaMedium, FaReddit, FaMastodon, FaThreads, FaBluesky, FaPinterest, FaSnapchat, FaVimeo,
  FaPodcast, FaApple, FaAndroid, FaGoogle, FaBitcoin, FaEthereum, FaPaypal, FaEnvelope,
  FaPhone, FaRss, FaQrcode, FaCartShopping, FaBagShopping, FaDollarSign, FaGift, FaHeart,
  FaStar, FaThumbsUp, FaFire, FaBolt, FaMusic, FaHeadphones, FaMicrophone, FaVideo,
  FaFilm, FaTv, FaPlay, FaCamera, FaImage, FaPalette, FaPen, FaBook,
  FaNewspaper, FaGraduationCap, FaCode, FaGamepad, FaBriefcase, FaHouse, FaLocationDot, FaMap,
  FaCalendarDays, FaClock, FaBell, FaTag, FaDownload, FaFile, FaUsers, FaComment,
  FaShareNodes, FaMugHot, FaWallet, FaPlus, FaCheck,
} from 'react-icons/fa6';

import { getAccounts } from '../hive-api/hiveApi';
import { broadcastWithAioha, KeyTypes } from '../hive-api/aioha';
import { t } from '../i18n';

// Spotlight lives ON-CHAIN in the user's posting_json_metadata under the shared
// `3speak` namespace (alongside interests) — no database. Writes go through the
// same posting-auth broadcast the interests picker uses, so delegated logins never
// re-sign; wallet logins sign once via the SIWH session.
const META_NS = '3speak';
const cleanUser = (u) => String(u || '').trim().replace(/^@/, '').toLowerCase();

function parsePostingMeta(account) {
  if (!account) return {};
  const raw = account.posting_json_metadata;
  try {
    if (typeof raw === 'string') return JSON.parse(raw || '{}') || {};
    if (raw && typeof raw === 'object') return raw;
  } catch { /* malformed metadata → empty */ }
  return {};
}

export function readSpotlightFromAccount(account) {
  const meta = parsePostingMeta(account);
  const sp = meta && meta[META_NS] && meta[META_NS].spotlight;
  return (sp && typeof sp === 'object') ? sp : null;
}

// Curated icon set. Backend stores only the slug (validated /^[a-z0-9-]{1,40}$/);
// unknown slugs fall back to the generic link icon.
export const SPOTLIGHT_ICONS = [
  { slug: 'link', labelKey: 'spotlight.icons.link', Icon: FaLink },
  { slug: 'globe', labelKey: 'spotlight.icons.globe', Icon: FaGlobe },
  { slug: 'youtube', label: 'YouTube', Icon: FaYoutube },
  { slug: 'x', label: 'X', Icon: FaXTwitter },
  { slug: 'instagram', label: 'Instagram', Icon: FaInstagram },
  { slug: 'tiktok', label: 'TikTok', Icon: FaTiktok },
  { slug: 'discord', label: 'Discord', Icon: FaDiscord },
  { slug: 'telegram', label: 'Telegram', Icon: FaTelegram },
  { slug: 'whatsapp', label: 'WhatsApp', Icon: FaWhatsapp },
  { slug: 'github', label: 'GitHub', Icon: FaGithub },
  { slug: 'twitch', label: 'Twitch', Icon: FaTwitch },
  { slug: 'facebook', label: 'Facebook', Icon: FaFacebook },
  { slug: 'linkedin', label: 'LinkedIn', Icon: FaLinkedin },
  { slug: 'spotify', label: 'Spotify', Icon: FaSpotify },
  { slug: 'soundcloud', label: 'SoundCloud', Icon: FaSoundcloud },
  { slug: 'patreon', label: 'Patreon', Icon: FaPatreon },
  { slug: 'medium', label: 'Medium', Icon: FaMedium },
  { slug: 'reddit', label: 'Reddit', Icon: FaReddit },
  { slug: 'mastodon', label: 'Mastodon', Icon: FaMastodon },
  { slug: 'threads', label: 'Threads', Icon: FaThreads },
  { slug: 'bluesky', label: 'Bluesky', Icon: FaBluesky },
  { slug: 'pinterest', label: 'Pinterest', Icon: FaPinterest },
  { slug: 'snapchat', label: 'Snapchat', Icon: FaSnapchat },
  { slug: 'vimeo', label: 'Vimeo', Icon: FaVimeo },
  { slug: 'podcast', labelKey: 'spotlight.icons.podcast', Icon: FaPodcast },
  { slug: 'apple', label: 'Apple', Icon: FaApple },
  { slug: 'android', label: 'Android', Icon: FaAndroid },
  { slug: 'google', label: 'Google', Icon: FaGoogle },
  { slug: 'bitcoin', label: 'Bitcoin', Icon: FaBitcoin },
  { slug: 'ethereum', label: 'Ethereum', Icon: FaEthereum },
  { slug: 'paypal', label: 'PayPal', Icon: FaPaypal },
  { slug: 'email', labelKey: 'spotlight.icons.email', Icon: FaEnvelope },
  { slug: 'phone', labelKey: 'spotlight.icons.phone', Icon: FaPhone },
  { slug: 'rss', labelKey: 'spotlight.icons.rss', Icon: FaRss },
  { slug: 'qrcode', labelKey: 'spotlight.icons.qrcode', Icon: FaQrcode },
  { slug: 'shop', labelKey: 'spotlight.icons.shop', Icon: FaCartShopping },
  { slug: 'bag', labelKey: 'spotlight.icons.bag', Icon: FaBagShopping },
  { slug: 'dollar', labelKey: 'spotlight.icons.dollar', Icon: FaDollarSign },
  { slug: 'gift', labelKey: 'spotlight.icons.gift', Icon: FaGift },
  { slug: 'heart', labelKey: 'spotlight.icons.heart', Icon: FaHeart },
  { slug: 'star', labelKey: 'spotlight.icons.star', Icon: FaStar },
  { slug: 'thumbsup', labelKey: 'spotlight.icons.thumbsup', Icon: FaThumbsUp },
  { slug: 'fire', labelKey: 'spotlight.icons.fire', Icon: FaFire },
  { slug: 'bolt', labelKey: 'spotlight.icons.bolt', Icon: FaBolt },
  { slug: 'music', labelKey: 'spotlight.icons.music', Icon: FaMusic },
  { slug: 'headphones', labelKey: 'spotlight.icons.headphones', Icon: FaHeadphones },
  { slug: 'mic', labelKey: 'spotlight.icons.mic', Icon: FaMicrophone },
  { slug: 'video', labelKey: 'spotlight.icons.video', Icon: FaVideo },
  { slug: 'film', labelKey: 'spotlight.icons.film', Icon: FaFilm },
  { slug: 'tv', labelKey: 'spotlight.icons.tv', Icon: FaTv },
  { slug: 'play', labelKey: 'spotlight.icons.play', Icon: FaPlay },
  { slug: 'camera', labelKey: 'spotlight.icons.camera', Icon: FaCamera },
  { slug: 'image', labelKey: 'spotlight.icons.image', Icon: FaImage },
  { slug: 'palette', labelKey: 'spotlight.icons.palette', Icon: FaPalette },
  { slug: 'pen', labelKey: 'spotlight.icons.pen', Icon: FaPen },
  { slug: 'book', labelKey: 'spotlight.icons.book', Icon: FaBook },
  { slug: 'newspaper', labelKey: 'spotlight.icons.newspaper', Icon: FaNewspaper },
  { slug: 'graduation', labelKey: 'spotlight.icons.graduation', Icon: FaGraduationCap },
  { slug: 'code', labelKey: 'spotlight.icons.code', Icon: FaCode },
  { slug: 'gamepad', labelKey: 'spotlight.icons.gamepad', Icon: FaGamepad },
  { slug: 'briefcase', labelKey: 'spotlight.icons.briefcase', Icon: FaBriefcase },
  { slug: 'home', labelKey: 'spotlight.icons.home', Icon: FaHouse },
  { slug: 'location', labelKey: 'spotlight.icons.location', Icon: FaLocationDot },
  { slug: 'map', labelKey: 'spotlight.icons.map', Icon: FaMap },
  { slug: 'calendar', labelKey: 'spotlight.icons.calendar', Icon: FaCalendarDays },
  { slug: 'clock', labelKey: 'spotlight.icons.clock', Icon: FaClock },
  { slug: 'bell', labelKey: 'spotlight.icons.bell', Icon: FaBell },
  { slug: 'tag', labelKey: 'spotlight.icons.tag', Icon: FaTag },
  { slug: 'download', labelKey: 'spotlight.icons.download', Icon: FaDownload },
  { slug: 'file', labelKey: 'spotlight.icons.file', Icon: FaFile },
  { slug: 'users', labelKey: 'spotlight.icons.users', Icon: FaUsers },
  { slug: 'comment', labelKey: 'spotlight.icons.comment', Icon: FaComment },
  { slug: 'share', labelKey: 'spotlight.icons.share', Icon: FaShareNodes },
  { slug: 'coffee', labelKey: 'spotlight.icons.coffee', Icon: FaMugHot },
  { slug: 'wallet', labelKey: 'spotlight.icons.wallet', Icon: FaWallet },
  { slug: 'plus', labelKey: 'spotlight.icons.plus', Icon: FaPlus },
  { slug: 'check', labelKey: 'spotlight.icons.check', Icon: FaCheck },
];

const ICON_BY_SLUG = new Map(SPOTLIGHT_ICONS.map((i) => [i.slug, i.Icon]));
export const iconForSlug = (slug) => ICON_BY_SLUG.get(slug) || FaLink;

// Guess an icon slug from a URL host, so a freshly-pasted link gets a sensible
// default icon without the user having to pick one.
export function guessIconFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    const map = {
      'youtube.com': 'youtube', 'youtu.be': 'youtube', 'twitter.com': 'x', 'x.com': 'x',
      'instagram.com': 'instagram', 'tiktok.com': 'tiktok', 'discord.gg': 'discord',
      'discord.com': 'discord', 't.me': 'telegram', 'telegram.me': 'telegram',
      'github.com': 'github', 'twitch.tv': 'twitch', 'facebook.com': 'facebook',
      'linkedin.com': 'linkedin', 'open.spotify.com': 'spotify', 'spotify.com': 'spotify',
      'patreon.com': 'patreon', 'medium.com': 'medium', 'reddit.com': 'reddit',
    };
    if (map[host]) return map[host];
    for (const key of Object.keys(map)) if (host.endsWith(key)) return map[key];
    if (url.startsWith('mailto:')) return 'email';
    return 'globe';
  } catch {
    return 'link';
  }
}

// Brand/platform icons are only offered when the user picks that platform as the
// link type — a brand icon always implies a link TO that platform. They're kept
// OUT of the free-form icon picker (Website mode), so nobody puts a YouTube icon
// on a non-YouTube link. Optional `base` pre-fills the URL when the platform is chosen.
export const LINK_PLATFORMS = [
  { slug: 'youtube', label: 'YouTube', base: 'https://youtube.com/@' },
  { slug: 'instagram', label: 'Instagram', base: 'https://instagram.com/' },
  { slug: 'x', label: 'X (Twitter)', base: 'https://x.com/' },
  { slug: 'tiktok', label: 'TikTok', base: 'https://tiktok.com/@' },
  { slug: 'facebook', label: 'Facebook', base: 'https://facebook.com/' },
  { slug: 'github', label: 'GitHub', base: 'https://github.com/' },
  { slug: 'linkedin', label: 'LinkedIn', base: 'https://linkedin.com/in/' },
  { slug: 'discord', label: 'Discord', base: 'https://discord.gg/' },
  { slug: 'telegram', label: 'Telegram', base: 'https://t.me/' },
  { slug: 'whatsapp', label: 'WhatsApp', base: 'https://wa.me/' },
  { slug: 'twitch', label: 'Twitch', base: 'https://twitch.tv/' },
  { slug: 'spotify', label: 'Spotify', base: 'https://open.spotify.com/' },
  { slug: 'soundcloud', label: 'SoundCloud', base: 'https://soundcloud.com/' },
  { slug: 'patreon', label: 'Patreon', base: 'https://patreon.com/' },
  { slug: 'medium', label: 'Medium', base: 'https://medium.com/@' },
  { slug: 'reddit', label: 'Reddit', base: 'https://reddit.com/user/' },
  { slug: 'mastodon', label: 'Mastodon', base: 'https://' },
  { slug: 'threads', label: 'Threads', base: 'https://threads.net/@' },
  { slug: 'bluesky', label: 'Bluesky', base: 'https://bsky.app/profile/' },
  { slug: 'pinterest', label: 'Pinterest', base: 'https://pinterest.com/' },
  { slug: 'snapchat', label: 'Snapchat', base: 'https://snapchat.com/add/' },
  { slug: 'vimeo', label: 'Vimeo', base: 'https://vimeo.com/' },
  { slug: 'paypal', label: 'PayPal', base: 'https://paypal.me/' },
  { slug: 'apple', label: 'Apple', base: 'https://' },
  { slug: 'google', label: 'Google', base: 'https://' },
  { slug: 'android', label: 'Android', base: 'https://' },
  { slug: 'bitcoin', label: 'Bitcoin', base: '' },
  { slug: 'ethereum', label: 'Ethereum', base: '' },
];
export const BRAND_SLUGS = new Set(LINK_PLATFORMS.map((p) => p.slug));
export const LINK_PLATFORM_BY_SLUG = new Map(LINK_PLATFORMS.map((p) => [p.slug, p]));
// Free-form icons for Website-mode links (brand icons excluded).
export const SPOTLIGHT_ICONS_GENERAL = SPOTLIGHT_ICONS.filter((i) => !BRAND_SLUGS.has(i.slug));

export const DEFAULT_THEME = {
  bg: {
    type: 'gradient', color: '#12121a', color2: '#241b33', angle: 160, image: null,
    overlayType: 'none', overlayColor: '#000000', overlayColor2: '#000000', overlayAngle: 160, overlayOpacity: 45,
  },
  text: '#f5f5f7',
  sectionBg: 'rgba(255,255,255,0.08)',
  sectionText: '#f5f5f7',
  radius: 16,
  buttonStyle: 'soft',
  font: 'system',
  fontScale: 100,
  fontStyle: 'normal',
  textShadow: 'none',
  textStroke: 0,
  textStrokeColor: '#000000',
  avatarPct: 100,
  avatarShadow: 30,
  avatarGlow: null,
  avatarGlowSize: 24,
  avatarAnimType: 'none',
  avatarAnimSpeed: 5,
  avatarAnimLoop: true,
  avatarAnimDur: 10,
  footerText: 'Open my Channel on 3Speak',
};

export const FONT_OPTIONS = [
  { value: 'system', labelKey: 'spotlight.fonts.system' },
  { value: 'rounded', labelKey: 'spotlight.fonts.rounded' },
  { value: 'serif', labelKey: 'spotlight.fonts.serif' },
  { value: 'mono', labelKey: 'spotlight.fonts.mono' },
  { value: 'display', labelKey: 'spotlight.fonts.display' },
  { value: 'condensed', labelKey: 'spotlight.fonts.condensed' },
  { value: 'handwriting', labelKey: 'spotlight.fonts.handwriting' },
  { value: 'grotesk', labelKey: 'spotlight.fonts.grotesk' },
  { value: 'humanist', labelKey: 'spotlight.fonts.humanist' },
  { value: 'geometric', labelKey: 'spotlight.fonts.geometric' },
  { value: 'slab', labelKey: 'spotlight.fonts.slab' },
  { value: 'elegant', labelKey: 'spotlight.fonts.elegant' },
  { value: 'typewriter', labelKey: 'spotlight.fonts.typewriter' },
  { value: 'marker', labelKey: 'spotlight.fonts.marker' },
  { value: 'brush', labelKey: 'spotlight.fonts.brush' },
  { value: 'palatino', labelKey: 'spotlight.fonts.palatino' },
  { value: 'wide', labelKey: 'spotlight.fonts.wide' },
];

// Looping "slight movement" animation types (shared by blocks + avatar).
export const ANIM_TYPES = [
  { value: 'none', labelKey: 'spotlight.motion.none' },
  { value: 'float', labelKey: 'spotlight.motion.float' },
  { value: 'sway', labelKey: 'spotlight.motion.sway' },
  { value: 'pulse', labelKey: 'spotlight.motion.pulse' },
  { value: 'wobble', labelKey: 'spotlight.motion.wobble' },
  { value: 'bounce', labelKey: 'spotlight.motion.bounce' },
  { value: 'tilt', labelKey: 'spotlight.motion.tilt' },
  { value: 'spin', labelKey: 'spotlight.motion.spin' },
  { value: 'shake', labelKey: 'spotlight.motion.shake' },
  { value: 'breathe', labelKey: 'spotlight.motion.breathe' },
];

export const emptyLayout = () => ({ headline: '', theme: { ...DEFAULT_THEME }, sections: [] });

// A stable-enough client id for a new section (server ignores it, but React keys
// + dnd-kit need one). No Date.now()/random dependence beyond the browser.
let _seq = 0;
const newId = () => `s_${Date.now().toString(36)}_${(_seq += 1)}`;

export function newSection(type) {
  const id = newId();
  switch (type) {
    case 'header': return { id, type: 'header', text: 'Section title', size: 'md', align: 'center' };
    case 'link': return { id, type: 'link', title: '', url: '', icon: 'link', iconColor: null, iconBg: null };
    case 'image': return { id, type: 'image', src: '', alt: '', url: null };
    case 'video': return { id, type: 'video', author: '', permlink: '', title: '', thumbnail: null, isShort: false };
    case 'embed': return { id, type: 'embed', source: 'link', url: '', title: '', description: '', image: null, siteName: '', imgSize: 55, count: 3, perRow: 1 };
    default: return { id, type: 'link', title: '', url: '', icon: 'link' };
  }
}

export const SECTION_TYPES = [
  { type: 'link', labelKey: 'spotlight.sectionTypes.link', Icon: FaLink },
  { type: 'video', labelKey: 'spotlight.sectionTypes.video', Icon: FaVideo },
  { type: 'embed', labelKey: 'spotlight.sectionTypes.embed', Icon: FaShareNodes },
  { type: 'image', labelKey: 'spotlight.sectionTypes.image', Icon: FaCamera },
  { type: 'header', labelKey: 'spotlight.sectionTypes.header', Icon: FaStar },
];

// Ensure every section has a client id (docs from the server have id:null).
export function withIds(layout) {
  const l = layout && typeof layout === 'object' ? layout : emptyLayout();
  return {
    headline: l.headline || '',
    theme: { ...DEFAULT_THEME, ...(l.theme || {}), bg: { ...DEFAULT_THEME.bg, ...((l.theme && l.theme.bg) || {}) } },
    sections: (Array.isArray(l.sections) ? l.sections : []).map((s) => ({ ...s, id: s.id || newId() })),
  };
}

// ── grid rows ↔ flat sections ────────────────────────────────────────────────
// The layout is stored as a flat, ordered array where each block has a `width`
// (full/half/third). For the drag-arrange grid we group it into ROWS: pack blocks
// left-to-right by their fractional width until a row is full (max 3 per row).
const WIDTH_FRAC = { full: 1, half: 0.5, third: 1 / 3 };
export function layoutToRows(sections) {
  const rows = [];
  let cur = [];
  let acc = 0;
  for (const s of (sections || [])) {
    const f = WIDTH_FRAC[s.width] || 1;
    if (cur.length && (acc + f > 1.0001 || cur.length >= 3)) { rows.push(cur); cur = []; acc = 0; }
    cur.push(s);
    acc += f;
    if (acc >= 0.999 || cur.length >= 3) { rows.push(cur); cur = []; acc = 0; }
  }
  if (cur.length) rows.push(cur);
  return rows;
}
// Flatten rows back, normalising each block's width to its row length (2→half,
// 3→third, 1→full). Full drops the `width` key entirely.
export function rowsToSections(rows) {
  const w = (len) => (len >= 3 ? 'third' : len === 2 ? 'half' : 'full');
  return (rows || []).filter((r) => r.length).flatMap((r) => r.map((s) => {
    const width = w(r.length);
    const { width: _drop, ...rest } = s;
    return width === 'full' ? rest : { ...rest, width };
  }));
}

// CSS background string for a theme's page/section background object.
export function bgToCss(bg) {
  if (!bg) return undefined;
  if (bg.type === 'image' && bg.image) return `center / cover no-repeat url("${bg.image}")`;
  if (bg.type === 'gradient') return `linear-gradient(${bg.angle || 160}deg, ${bg.color || '#12121a'}, ${bg.color2 || '#241b33'})`;
  return bg.color || '#12121a';
}

// Read a user's Spotlight from their Hive posting_json_metadata.
export async function fetchSpotlight(username) {
  const u = cleanUser(username);
  if (!u) return { exists: false, page: null };
  try {
    const [account] = await getAccounts([u]);
    const page = readSpotlightFromAccount(account);
    return { exists: !!(page && Array.isArray(page.sections)), page: page || null };
  } catch {
    return { exists: false, page: null };
  }
}

// Persist the caller's Spotlight into their posting_json_metadata via an
// account_update2 (merged so the `profile`/`3speak.interests` keys are preserved).
// Broadcast with posting authority — @threespeak for delegated logins (no signing),
// the user's wallet otherwise. Section `id`s are client-only, stripped before store.
export async function saveSpotlight(username, layout) {
  const u = cleanUser(username);
  if (!u) throw new Error(t('spotlight.errors.notLoggedIn'));
  const clean = {
    headline: layout.headline || '',
    theme: layout.theme,
    sections: (layout.sections || []).map(({ id, ...rest }) => rest),
  };

  const [account] = await getAccounts([u]);
  const meta = parsePostingMeta(account);
  meta[META_NS] = { ...(meta[META_NS] || {}), spotlight: clean };

  // Empty json_metadata string = "leave unchanged" on-chain, so only
  // posting_json_metadata is written (posting auth suffices).
  const op = ['account_update2', {
    account: u,
    json_metadata: '',
    posting_json_metadata: JSON.stringify(meta),
    extensions: [],
  }];
  const result = await broadcastWithAioha([op], KeyTypes.Posting);
  if (!result || !result.success) throw new Error(t('spotlight.errors.couldNotSaveToHive'));
  return clean;
}
