// "Other ways to support me": a creator's pages on payment sites (Ko-fi, Patreon
// and so on), kept in their Hive posting_json_metadata as `3speak.supportLinks`
// (an array of URLs) and shown in the tip window.
//
// Only the sites below are accepted, and only an https link to a page on them:
// the tip window is a place where money moves, so it never shows a link that
// could be any site at all.
import { readThreespeakMeta, saveThreespeakMeta } from './threespeakMeta';

export const SUPPORT_LINK_MAX = 5;

// `path`: what the link's path must look like (a page of the creator, not the
// site's front page). `label` is the site's own name, the same in every language.
export const SUPPORT_SITES = [
  { id: 'kofi', label: 'Ko-fi', hosts: ['ko-fi.com'], path: /^\/[^/]+/ },
  { id: 'patreon', label: 'Patreon', hosts: ['patreon.com'], path: /^\/[^/]+/ },
  { id: 'buymeacoffee', label: 'Buy Me a Coffee', hosts: ['buymeacoffee.com'], path: /^\/[^/]+/ },
  { id: 'paypal', label: 'PayPal', hosts: ['paypal.me'], path: /^\/[^/]+/ },
  { id: 'paypal', label: 'PayPal', hosts: ['paypal.com'], path: /^\/(paypalme|donate)\b/ },
  { id: 'github', label: 'GitHub Sponsors', hosts: ['github.com'], path: /^\/sponsors\/[^/]+/ },
  { id: 'liberapay', label: 'Liberapay', hosts: ['liberapay.com'], path: /^\/[^/]+/ },
  { id: 'opencollective', label: 'Open Collective', hosts: ['opencollective.com'], path: /^\/[^/]+/ },
];

// The site names for the setting's description, in list order without repeats.
export const SUPPORT_SITE_NAMES = [...new Set(SUPPORT_SITES.map((s) => s.label))];

// → { site, url } for an accepted link, else null. Takes it with or without
// https:// and www.
export function parseSupportLink(input) {
  let raw = String(input || '').trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) raw = `https://${raw}`;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const site = SUPPORT_SITES.find((s) => s.hosts.includes(host) && s.path.test(u.pathname));
  if (!site) return null;
  u.hash = '';
  return { site, url: `https://${host}${u.pathname.replace(/\/+$/, '')}${u.search}` };
}

// The account's links that still pass parseSupportLink, as { site, url }.
export async function readSupportLinks(username) {
  const list = (await readThreespeakMeta(username)).supportLinks;
  if (!Array.isArray(list)) return [];
  return list.map(parseSupportLink).filter(Boolean).slice(0, SUPPORT_LINK_MAX);
}

// Saves the full list of URLs ([] removes the key).
export async function saveSupportLinks(username, urls) {
  await saveThreespeakMeta(username, (ns) => {
    if (urls.length) ns.supportLinks = urls.slice(0, SUPPORT_LINK_MAX);
    else delete ns.supportLinks;
  });
}
