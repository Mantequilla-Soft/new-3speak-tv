import { Buffer } from "buffer";
import bs58 from "bs58";
import fallbackImg from "../assets/image/speak.jpg";

const APP_BUNNY_IPFS_CDN = "https://hotipfs-3speak-1.b-cdn.net";
const APP_IMAGE_CDN_DOMAIN = "https://media.3speak.tv";
const FALLBACK_THUMBNAIL = "/images/speak.jpg"; // Local fallback image

export { fallbackImg };

// Hive image proxy dimensions: landscape 16:9 by default, portrait 9:16 for
// shorts so the thumbnail is cropped to portrait at the source.
const LANDSCAPE = { w: 340, h: 191 };
const PORTRAIT = { w: 360, h: 640 };

// IPFS thumbnails are cropped by OUR image cache (/img/i/<cid>, nginx
// conf.d/3speak-img.conf), which fetches them from ipfs.3speak.tv. Legacy IPFS
// thumbnails are routinely the raw, full resolution upload (1-12 MB), so they must
// be resized, but Hive's resize proxy 403s on ipfs.3speak.tv sources (8,915 of
// 9,353 thumbnails on 2026-10-29) and the Bunny zone it used before (ipfs-3speak.b-cdn.net)
// has answered 403 "Domain suspended" since 2026-09-08.
// A path that is not a plain CID (+ path) still goes through Hive's proxy, from
// this host, as before.
const IPFS_PROXY_HOST = "https://ipfs.3speak.tv";
const IPFS_PATH_RE = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})(?:\/[^?#]*)?$/;
const ipfsThumb = (path, portrait, size) => {
  const clean = String(path).split(/[?#]/)[0];
  return IPFS_PATH_RE.test(clean)
    ? `/img/i/${clean}${portrait ? '?s=p' : ''}`
    : hiveProxy(`${IPFS_PROXY_HOST}/ipfs/${clean}`, size);
};
const IPFS_GATEWAY_RE = /^https?:\/\/(?:ipfs\.3speak\.tv|hotipfs-3speak-1\.b-cdn\.net|ipfs-3speak\.b-cdn\.net|ipfs-audio\.3speak\.tv)\/ipfs\/(.+)$/i;

// Hosts Hive's resize proxy REFUSES. It answers 403 for images.3speak.tv, so
// every image we host ourselves came back as a broken picture the moment it was
// sent through the proxy -- badge avatars and covers among them, which is why a
// badge with a perfectly good profile_image on chain showed nothing at all.
//
// These are already our own CDN and already web-sized, so there is nothing for
// the proxy to do for them anyway.
const PROXY_REFUSES = /^https?:\/\/(?:images|img)\.3speak\.tv\//i;

/** True for an image URL images.hive.blog cannot fetch on our behalf. */
export const hiveProxyRefuses = (url) => PROXY_REFUSES.test(String(url || ''));

/* Images from Hive's proxy are fetched through OUR cache (/img/h/, nginx
 * conf.d/3speak-img.conf): same origin, kept on our disk, so a viewer never opens a
 * connection to Hive's proxy and a cold resize is paid once, not per viewer. Only
 * for showing on the page: never write one of these into a post. */
export const viaImageCache = (url) => String(url || '').replace(/^https:\/\/images\.hive\.blog\//i, '/img/h/');

// Downscale any absolute image URL through Hive's resize proxy.
export const hiveProxy = (url, size) => (
  PROXY_REFUSES.test(url)
    ? url
    : `/img/h/p/${bs58.encode(Buffer.from(url))}?format=jpeg&mode=cover&width=${size.w}&height=${size.h}`
);

/**
 * A playlist or album cover for a SQUARE spot, through our /img/ cache.
 *
 * Covers are stored as the uploaded original (one album cover is 4284 px and
 * 367 KB) and were loaded as-is into a 120 px box. Our own images.3speak.tv goes
 * through /img/a/ (square crop, 64 / 128 / 512 px); anything else through Hive's
 * resize proxy. Local assets and empty values come back unchanged. For the 16:9
 * tiles and cards, fixVideoThumbnail() already does the same in that shape.
 */
export function squareCover(url, px = 512) {
  const u = String(url || '').trim();
  const own = u.match(/^https?:\/\/images\.3speak\.tv\/(.+)$/i);
  if (own) return `/img/a/${own[1].split('?')[0]}?px=${px}`;
  if (/^https?:\/\//i.test(u)) return hiveProxy(u, { w: px, h: px });
  return u;
}

// A card several columns wide (the featured video) asks for this instead.
export const LANDSCAPE_LARGE = { w: 960, h: 540 };

export function fixVideoThumbnail(video, portrait = false, sizeOverride = null) {
  const size = sizeOverride || (portrait ? PORTRAIT : LANDSCAPE);
  const thumbnail = video?.images?.thumbnail || video?.thumbUrl || video?.spkvideo?.thumbnail_url || video?.thumbnailUrl || video?.thumbnail_url || video?.thumbnail;

  // Validate thumbnail exists and is not just whitespace
  if (!thumbnail || typeof thumbnail !== 'string' || thumbnail.trim() === '') {
    return fallbackImg;
  }

  const cleanThumbnail = thumbnail.trim();

  // 🧠 Handle malformed double-embedded URLs (IPFS path containing full HTTP URLs)
  if (cleanThumbnail.includes('/ipfs/http')) {
    // Extract the actual HTTP URL from the malformed path
    const match = cleanThumbnail.match(/\/ipfs\/(https?:\/\/.+)/);
    if (match && match[1]) {
      return match[1]; // Return the inner URL directly
    }
  }

  // 🧠 Handle IPFS URIs (ipfs://<cid>) — the stored form for many legacy videos.
  // These used to be returned as a RAW gateway URL, i.e. the full-resolution
  // original (often multiple MB), which is why such thumbnails crawled in. Our
  // image cache crops them to the card instead.
  if (cleanThumbnail.includes("ipfs://")) {
    const ipfsHash = cleanThumbnail.replace("ipfs://", "").trim();
    // Validate IPFS hash exists
    if (!ipfsHash || ipfsHash === '') {
      return fallbackImg;
    }
    return ipfsThumb(ipfsHash, portrait, size);
  }

  // 🧠 Handle IPFS *gateway* URLs — any of our gateways, Bunny's suspended ones
  // included: the CID is the same everywhere, so crop it like an ipfs:// URI.
  const ipfsGateway = cleanThumbnail.match(IPFS_GATEWAY_RE);
  if (ipfsGateway) {
    return ipfsThumb(ipfsGateway[1], portrait, size);
  }

  // ✅ Already a SIZED Hive proxy URL (…/p/… or …/WxH/…) — already small, leave it.
  if (cleanThumbnail.includes("images.hive.blog/p/") || /images\.hive\.blog\/\d+x\d+\//.test(cleanThumbnail)) {
    // For shorts, re-request the proxied image at portrait dimensions (the
    // baked-in params are landscape). The /p/<hash> form re-proxies the original.
    if (portrait && cleanThumbnail.includes("images.hive.blog/p/")) {
      return viaImageCache(`${cleanThumbnail.split('?')[0]}?format=jpeg&mode=cover&width=${size.w}&height=${size.h}`);
    }
    return viaImageCache(cleanThumbnail);
  }

  // ⚠️ images.hive.blog's resize proxy 403s on ecency-hosted sources. Route them
  // through ecency's OWN imagehoster (same /p/ API) instead, so the thumbnail is
  // still downscaled — and portrait-cropped for shorts — rather than loading the
  // full-resolution original.
  if (cleanThumbnail.includes("i.ecency.com") || cleanThumbnail.includes("images.ecency.com")) {
    // Already an ecency resize-proxy URL — leave it (re-size for portrait shorts).
    if (cleanThumbnail.includes("images.ecency.com/p/") || /images\.ecency\.com\/\d+x\d+\//.test(cleanThumbnail)) {
      if (portrait && cleanThumbnail.includes("images.ecency.com/p/")) {
        return `${cleanThumbnail.split('?')[0]}?format=jpeg&mode=cover&width=${size.w}&height=${size.h}`;
      }
      return cleanThumbnail;
    }
    // Raw ecency image — re-proxy through ecency (hive's proxy 403s on these).
    const encoded = bs58.encode(Buffer.from(cleanThumbnail));
    return `https://images.ecency.com/p/${encoded}?format=jpeg&mode=cover&width=${size.w}&height=${size.h}`;
  }

  // ⚠️ media.3speak.tv doesn't exist anymore - use fallback
  if (cleanThumbnail.includes(APP_IMAGE_CDN_DOMAIN)) {
    return FALLBACK_THUMBNAIL;
  }

  // Our own image host (images.3speak.tv), which Hive's resize proxy cannot fetch
  // (it 403s). These are NOT thumbnail-sized: new uploads store the full frame,
  // 1280x720 and ~70-200 KB, from a US box with no CDN. So they go through our own
  // /img/t/ route (nginx, conf.d/3speak-img.conf): cropped once to the card shape
  // (640x360, or 360x640 for shorts), kept on our disk, served same-origin.
  const ownImage = cleanThumbnail.match(/^https?:\/\/images\.3speak\.tv\/(.+)$/i);
  if (ownImage) {
    return `/img/t/${ownImage[1].split('?')[0]}${portrait ? '?s=p' : ''}`;
  }
  if (cleanThumbnail.includes("images.3speak.tv")) {
    return cleanThumbnail;
  }

  // 🧠 Handle regular HTTP URLs with Hive proxy
  if (cleanThumbnail.startsWith("http")) {
    return hiveProxy(cleanThumbnail, size);
  }

  // 🧠 Bare CID (no scheme) — same treatment as an ipfs:// URI.
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|ba[a-z2-7]{57})/.test(cleanThumbnail)) {
    return ipfsThumb(cleanThumbnail, portrait, size);
  }

  // Return as-is for any other format
  return cleanThumbnail;
}
