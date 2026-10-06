import axios from 'axios';
import aioha, { KeyTypes, Providers, getCurrentProvider, isManteAuthLogin } from '../hive-api/aioha';

const THREESPEAK_API = import.meta.env.VITE_THREESPEAK_API || '/api';
import { SOCIAL_VERIFIER_URL } from './config';
import { t } from '../i18n';

const client = axios.create({ baseURL: SOCIAL_VERIFIER_URL });

function buildMessage({ action, hive_username, platform, platform_username, timestamp }) {
  return [
    '3speak-social-verifier',
    action,
    String(hive_username || '').toLowerCase(),
    String(platform || ''),
    String(platform_username || ''),
    String(timestamp),
  ].join('|');
}

// HiveSigner and Butter Auth logins have no key in the browser to sign with, so
// our API signs as @threespeak under the posting authority the user granted
// (server/index.cjs /api/verify/sign); the checker accepts that delegate.
function needsServerSignature() {
  return getCurrentProvider() === Providers.HiveSigner || isManteAuthLogin();
}

async function serverSignedParams({ action, platform, platform_username }) {
  const headers = { 'Content-Type': 'application/json' };
  if (getCurrentProvider() === Providers.HiveSigner) {
    const tok = localStorage.getItem('hivesignerToken');
    if (tok) headers.Authorization = `Bearer ${tok}`;
  }
  const res = await fetch(`${THREESPEAK_API}/verify/sign`, {
    method: 'POST', headers, credentials: 'include',
    body: JSON.stringify({ action, platform, platform_username }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.signature) throw new Error(data.error || t('misc.social.signingCancelled'));
  return { signature: data.signature, timestamp: data.timestamp };
}

async function signedParams({ action, hive_username, platform, platform_username }) {
  if (needsServerSignature()) return serverSignedParams({ action, platform, platform_username });
  const timestamp = Date.now();
  const message = buildMessage({ action, hive_username, platform, platform_username, timestamp });
  const result = await aioha.signMessage(message, KeyTypes.Posting);
  if (!result || result.error || !result.result) {
    throw new Error(result?.error || t('misc.social.signingCancelled'));
  }
  return { signature: result.result, timestamp };
}

export async function getHash(hive_username) {
  const { data } = await client.get(`/verify/hash/${encodeURIComponent(hive_username)}`);
  return data;
}

export async function getLinks(hive_username, { includePending = false } = {}) {
  const { data } = await client.get(`/verify/links/${encodeURIComponent(hive_username)}`, {
    params: includePending ? { include_pending: 'true' } : undefined,
  });
  return data?.links || [];
}

export async function listPlatforms() {
  const { data } = await client.get('/verify/platforms');
  return data?.platforms || [];
}

export async function checkLink({ hive_username, platform, platform_username }) {
  const { signature, timestamp } = await signedParams({
    action: 'check', hive_username, platform, platform_username,
  });
  const { data } = await client.get('/verify/check', {
    params: { hive_username, platform, platform_username, timestamp, signature },
  });
  return data;
}

export async function unlinkLink({ hive_username, platform, platform_username }) {
  const { signature, timestamp } = await signedParams({
    action: 'unlink', hive_username, platform, platform_username,
  });
  const { data } = await client.get('/verify/unlink', {
    params: { hive_username, platform, platform_username, timestamp, signature },
  });
  return data;
}

// Client-side metadata for each supported platform: how to render a clickable
// outbound link, what to call it, and what to tell the user to type in.
// inputPlaceholderKey / inputHelpKey are i18n keys (translate at render).
export const PLATFORMS = {
  youtube: {
    label: 'YouTube',
    profileUrl: (canonical) => `https://www.youtube.com/channel/${canonical}`,
    inputPlaceholderKey: 'misc.social.youtube.placeholder',
    inputHelpKey: 'misc.social.youtube.help',
  },
  soundcloud: {
    label: 'SoundCloud',
    profileUrl: (canonical) => `https://soundcloud.com/${canonical}`,
    inputPlaceholderKey: 'misc.social.soundcloud.placeholder',
    inputHelpKey: 'misc.social.soundcloud.help',
  },
  tiktok: {
    label: 'TikTok',
    // The checker stores the lower-cased @handle (see 3speakchecks platforms/tiktok.js).
    profileUrl: (canonical) => `https://www.tiktok.com/@${canonical}`,
    inputPlaceholderKey: 'misc.social.tiktok.placeholder',
    inputHelpKey: 'misc.social.tiktok.help',
  },
  instagram: {
    label: 'Instagram',
    // The checker stores the lower-cased username (see 3speakchecks platforms/instagram.js).
    profileUrl: (canonical) => `https://www.instagram.com/${canonical}/`,
    inputPlaceholderKey: 'misc.social.instagram.placeholder',
    inputHelpKey: 'misc.social.instagram.help',
  },
  bitchute: {
    label: 'BitChute',
    // The checker stores the channel_id (see 3speakchecks platforms/bitchute.js);
    // BitChute's channel URLs accept it in place of the slug.
    profileUrl: (canonical) => `https://www.bitchute.com/channel/${canonical}/`,
    inputPlaceholderKey: 'misc.social.bitchute.placeholder',
    inputHelpKey: 'misc.social.bitchute.help',
  },
  rumble: {
    label: 'Rumble',
    // The checker stores "c/<name>" or "user/<name>" (see 3speakchecks platforms/rumble.js).
    profileUrl: (canonical) => `https://rumble.com/${canonical}`,
    inputPlaceholderKey: 'misc.social.rumble.placeholder',
    inputHelpKey: 'misc.social.rumble.help',
  },
};

export function platformProfileUrl(platform, canonical) {
  const p = PLATFORMS[platform];
  return p?.profileUrl ? p.profileUrl(canonical) : null;
}

export function platformLabel(platform) {
  return PLATFORMS[platform]?.label || platform;
}
