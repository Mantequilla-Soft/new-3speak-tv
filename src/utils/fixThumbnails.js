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

// The ONLY IPFS gateway images.hive.blog's resize proxy will accept. It 403s on
// ipfs.3speak.tv, hotipfs-3speak-1.b-cdn.net and ipfs-audio.3speak.tv, but serves
// ipfs-3speak.b-cdn.net fine. Legacy IPFS thumbnails are routinely the raw, full
// resolution upload (1–12 MB — one drone photo is 12 MB), so sending an unresized
// one straight to a card is what makes those thumbnails take forever to appear.
// Normalising to this host lets the proxy downscale it (12 MB → ~24 KB).
const IPFS_PROXY_HOST = "https://ipfs-3speak.b-cdn.net";
const IPFS_GATEWAY_RE = /^https?:\/\/(?:ipfs\.3speak\.tv|hotipfs-3speak-1\.b-cdn\.net|ipfs-3speak\.b-cdn\.net|ipfs-audio\.3speak\.tv)\/ipfs\/(.+)$/i;

// Downscale any absolute image URL through Hive's resize proxy.
const hiveProxy = (url, size) =>
  `https://images.hive.blog/p/${bs58.encode(Buffer.from(url))}?format=jpeg&mode=cover&width=${size.w}&height=${size.h}`;

export function fixVideoThumbnail(video, portrait = false) {
  const size = portrait ? PORTRAIT : LANDSCAPE;
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
  // original (often multiple MB), which is why such thumbnails crawled in. Send
  // them through the resize proxy instead.
  if (cleanThumbnail.includes("ipfs://")) {
    const ipfsHash = cleanThumbnail.replace("ipfs://", "").trim();
    // Validate IPFS hash exists
    if (!ipfsHash || ipfsHash === '') {
      return fallbackImg;
    }
    return hiveProxy(`${IPFS_PROXY_HOST}/ipfs/${ipfsHash}`, size);
  }

  // 🧠 Handle IPFS *gateway* URLs — normalise to the one host the proxy accepts,
  // then downscale. (Rewriting these to hotipfs, as we used to, turned the one
  // proxy-able host into one the proxy 403s on, so the raw original was served.)
  const ipfsGateway = cleanThumbnail.match(IPFS_GATEWAY_RE);
  if (ipfsGateway) {
    return hiveProxy(`${IPFS_PROXY_HOST}/ipfs/${ipfsGateway[1]}`, size);
  }

  // ✅ Already a SIZED Hive proxy URL (…/p/… or …/WxH/…) — already small, leave it.
  if (cleanThumbnail.includes("images.hive.blog/p/") || /images\.hive\.blog\/\d+x\d+\//.test(cleanThumbnail)) {
    // For shorts, re-request the proxied image at portrait dimensions (the
    // baked-in params are landscape). The /p/<hash> form re-proxies the original.
    if (portrait && cleanThumbnail.includes("images.hive.blog/p/")) {
      return `${cleanThumbnail.split('?')[0]}?format=jpeg&mode=cover&width=${size.w}&height=${size.h}`;
    }
    return cleanThumbnail;
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

  // ⚠️ images.hive.blog's resize proxy 403s on OUR OWN image host too, exactly
  // as it does on ecency's. Verified: proxying an images.3speak.tv URL returns
  // 403, so every thumbnail routed through it rendered blank. Served directly
  // instead — these are already thumbnail-sized webp written by the uploader,
  // so there is nothing to downscale.
  if (cleanThumbnail.includes("images.3speak.tv")) {
    return cleanThumbnail;
  }

  // 🧠 Handle regular HTTP URLs with Hive proxy
  if (cleanThumbnail.startsWith("http")) {
    return hiveProxy(cleanThumbnail, size);
  }

  // 🧠 Bare CID (no scheme) — same treatment as an ipfs:// URI.
  if (/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|ba[a-z2-7]{57})/.test(cleanThumbnail)) {
    return hiveProxy(`${IPFS_PROXY_HOST}/ipfs/${cleanThumbnail}`, size);
  }

  // Return as-is for any other format
  return cleanThumbnail;
}
