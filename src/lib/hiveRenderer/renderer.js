/**
 * Hive markdown → sanitized HTML renderer.
 *
 * Vendored from @snapie/renderer 0.1.1 (+ the DOMPurify hardening hooks that
 * landed in that package's source afterwards) so we control which embeds get
 * produced. The reason for the copy:
 *
 * Upstream, `@hiveio/content-renderer`'s AssetEmbedder rewrites any BARE
 * youtube / vimeo / twitch / spotify / twitter URL in a post body into a block
 * iframe, and @snapie/renderer then adds its own Twitter and Instagram iframes.
 * We don't want any of those on a watch page, so the app used to render them
 * and rip them back out with regex afterwards (`stripAutoEmbeds`). That
 * post-processing is what broke post layout: pulling a URL out of a paragraph
 * to embed it splits the paragraph, and putting a link back in its place can't
 * restore the original flow — "Sources: A and B" came back as three blocks, and
 * anything the strip regexes didn't match exactly survived as a live iframe.
 *
 * Here the embedders are switched OFF before rendering, so a third-party media
 * URL is simply linkified in place, inside its own paragraph, like any other
 * link. Nothing is added, so nothing has to be removed.
 *
 * What we DO still embed (all option-gated, see `embeds` below):
 *   - 3Speak video  → `.video-container` iframe
 *   - 3Speak audio  → `.audio-container` iframe (BlogContent swaps these for a
 *                     native React <AudioPlayerInline />)
 *   - IPFS video    → native <video> with our gateways as <source> fallbacks
 */

import { DefaultRenderer } from '@hiveio/content-renderer';
import DOMPurify from 'isomorphic-dompurify';

const DEFAULT_IPFS_GATEWAY = 'https://ipfs.3speak.tv';
const DEFAULT_IPFS_FALLBACKS = [
  'https://ipfs.skatehive.app',
  'https://cloudflare-ipfs.com',
  'https://ipfs.io',
];

const DEFAULT_HIVE_FRONTENDS = [
  'peakd.com',
  'ecency.com',
  'hive.blog',
  'hiveblog.io',
  'leofinance.io',
  '3speak.tv',
  'd.tube',
  'esteem.app',
  'busy.org',
];

const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    // Text formatting
    'p', 'br', 'span', 'div', 'blockquote', 'pre', 'code',
    'strong', 'em', 'b', 'i', 'u', 'ins', 'del', 's', 'strike',
    'mark', 'sub', 'sup', 'small',
    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // Tables
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'col', 'colgroup',
    // Links and media
    'a', 'img', 'video', 'source', 'audio', 'iframe',
    // Other safe elements
    'hr', 'center', 'details', 'summary',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'width', 'height',
    'class', 'id', 'style', 'target', 'rel',
    'controls', 'muted', 'preload', 'loading', 'autoplay', 'loop',
    'type', 'allowfullscreen', 'frameborder', 'allow', 'scrolling',
    'colspan', 'rowspan', 'align', 'valign',
    'start', 'reversed',
    'data-dnt', 'data-theme', 'allowtransparency',
  ],
  // Kept byte-identical to DOMPurify's own default (plus `ipfs:`). The `\-` is
  // redundant where it sits, but this decides which URL schemes are allowed
  // through, so it is copied rather than tidied.
  // eslint-disable-next-line no-useless-escape
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|ipfs):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  FORBID_TAGS: ['script', 'form', 'input', 'button', 'textarea', 'select', 'dialog', 'object', 'embed', 'applet', 'base', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onmouseout', 'onmousemove', 'onmouseenter', 'onmouseleave', 'onfocus', 'onblur', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onkeypress'],
  KEEP_CONTENT: true,
  RETURN_TRUSTED_TYPE: false,
};

/**
 * DOMPurify allows the `style` attribute (embeds need it for sizing) but does
 * not validate CSS property values. Without this hook a post body containing
 * raw HTML like
 *   <div style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:99999">
 * renders a full-viewport overlay with no <script> and no event handler
 * involved, which is enough to build a convincing phishing takeover. Strip
 * `position` and `z-index` from every style attribute so nothing can escape its
 * normal place in page flow.
 */
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'style' && data.attrValue) {
    data.attrValue = data.attrValue
      .split(';')
      .filter((decl) => !/^\s*(position|z-index)\s*:/i.test(decl))
      .join(';');
  }
});

/**
 * ALLOWED_URI_REGEXP only checks the URL *scheme*, never the *host* — so
 * <img src="http://192.168.1.1/…"> from a post body sails straight through and
 * every visitor's browser fires an automatic request at that address: a
 * mixed-content warning at best, an unsolicited probe of the visitor's own LAN
 * at worst. Strip `src` on auto-loading elements whose host is private /
 * loopback / link-local, or an mDNS `.local` name. <a href> is left alone —
 * navigating there takes a click, it isn't an automatic fetch.
 */
const AUTO_LOAD_SRC_TAGS = new Set(['img', 'video', 'source', 'audio', 'iframe']);
const PRIVATE_HOSTNAME_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^\[?::1]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
  if (data.attrName !== 'src' || !data.attrValue) return;
  if (!AUTO_LOAD_SRC_TAGS.has(node.nodeName.toLowerCase())) return;
  try {
    const { hostname } = new URL(data.attrValue, 'https://placeholder.invalid');
    if (PRIVATE_HOSTNAME_PATTERNS.some((re) => re.test(hostname))) {
      data.keepAttr = false;
    }
  } catch {
    // Unparseable src — leave it to ALLOWED_URI_REGEXP.
  }
});

/**
 * Turn off @hiveio/content-renderer's built-in embedders (youtube, vimeo,
 * twitch, spotify, threespeak, twitter).
 *
 * The embedders live on a plain instance field, and both `domParser` and its
 * `embedder` survive compilation (TypeScript `private` is compile-time only),
 * so emptying the array is enough: `processTextNodeAndInsertEmbeds` then finds
 * no match, never writes an `~~~ embed:… ~~~` marker into the text node, and
 * `linkify` handles the URL like any other link — inline, in place.
 *
 * 3Speak is disabled here too. We do our own 3Speak pass further down, which
 * knows about play./embed URLs, audio.3speak.tv and per-body de-duplication.
 *
 * Returns false if a future version of the library moves that field, so the
 * caller can say so out loud — `rawIframesToLinks` still catches whatever the
 * embedders produce, but silently, and we'd want to know.
 */
function disableUpstreamEmbedders(renderer) {
  const embedder = renderer?.domParser?.embedder;
  if (!embedder || !Array.isArray(embedder.embedders)) return false;
  embedder.embedders = [];
  return true;
}

/**
 * Safety net for the `disableUpstreamEmbedders` returned-false case, and for
 * raw third-party <iframe> tags typed by hand into an HTML post body: rewrite
 * the iframe as a plain link to its source so the URL isn't lost. Our own
 * 3Speak video/audio containers run before this and are left alone; IPFS
 * iframes were already turned into <video> by then.
 *
 * "Our own" is decided by the iframe's HOST. It used to be a pattern anywhere in
 * the URL, so https://evil.example/x?ref=//3speak.tv, https://3speak.tv.evil.example/
 * or any /ipfs/ path kept a live, unsandboxed third-party iframe in a post, at
 * whatever size its author chose.
 */
const OWN_EMBED_HOST_RE = /(?:^|\.)3speak\.(?:tv|online|co)$/i;

function isOwnEmbed(src) {
  try {
    const u = new URL(String(src).replace(/&amp;/gi, '&'));
    return (u.protocol === 'https:' || u.protocol === 'http:') && OWN_EMBED_HOST_RE.test(u.hostname);
  } catch {
    return false;
  }
}

// `[^>]*>` swallows the `/` of a self-closing tag, and the closing tag is
// optional, so both `<iframe …/>` and `<iframe …></iframe>` match — xmldom
// re-serializes the body before we get here and can emit either form.
const IFRAME_RE = /<iframe\b[^>]*>(?:[\s\S]*?<\/iframe>)?/i;
const CONTAINED_IFRAME_RE = new RegExp(
  `<div[^>]*class="[^"]*(?:videoWrapper|video-container|audio-container|embed)[^"]*"[^>]*>\\s*${IFRAME_RE.source}\\s*</div>`,
  'gi'
);

function iframeToLink(match) {
  const src = match.match(/\bsrc="([^"]*)"/i)?.[1] || '';
  if (!src || isOwnEmbed(src)) return match;
  const url = youtubeWatchUrl(src) || src;
  return `<p><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>`;
}

function rawIframesToLinks(content) {
  return content
    .replace(CONTAINED_IFRAME_RE, iframeToLink)
    .replace(new RegExp(IFRAME_RE.source, 'gi'), iframeToLink);
}

/** youtube.com/embed/ID → the human watch URL, so the link is worth clicking. */
function youtubeWatchUrl(src) {
  const m = String(src).match(/(?:youtube(?:-nocookie)?\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : null;
}

/**
 * Fix malformed center tags from DefaultRenderer, which sometimes produces
 * <p><center>…<hr />…</center></p>.
 */
function fixMalformedCenterTags(content) {
  return content.replace(
    /<p><center>([\s\S]*?)<hr \/>([\s\S]*?)<\/center><\/p>/gi,
    (match, beforeHr, afterHr) => `<center>${beforeHr.trim()}</center><hr />${afterHr.trim()}`
  );
}

// Permissions the 3Speak player needs; Brave enforces these strictly without an explicit allow=.
const SPEAK_VIDEO_ALLOW = 'allow="autoplay; encrypted-media; fullscreen; picture-in-picture"';

/** Dedupe key for an audio.3speak.tv URL: the asset id, not the full URL. */
function audioDedupeKey(url) {
  try {
    const u = new URL(String(url).replace(/&amp;/gi, '&').replace(/^http:/i, 'https:'));
    return u.searchParams.get('a') || u.searchParams.get('cid') || u.toString();
  } catch {
    return String(url);
  }
}

function audioEmbedUrl(url) {
  try {
    const u = new URL(String(url).replace(/&amp;/gi, '&').replace(/^http:/i, 'https:'));
    u.searchParams.set('mode', 'compact');
    u.searchParams.set('iframe', '1');
    return u.toString();
  } catch {
    return url;
  }
}

const audioContainer = (url) =>
  `<div class="audio-container"><iframe src="${audioEmbedUrl(url)}" loading="lazy" allow="autoplay; encrypted-media" allowtransparency="true"></iframe></div>`;

const videoContainer = (embedUrl) =>
  `<div class="video-container"><iframe src="${embedUrl}" ${SPEAK_VIDEO_ALLOW} allowfullscreen></iframe></div>`;

// Every host/path a 3Speak player link is written as. `3speak.online` and
// `3speak.co` are legacy domains, and `/embed` appears without the `play.`
// subdomain in older posts — all four combinations used to be covered between
// @hiveio/content-renderer's ThreeSpeakEmbedder (bare URLs) and the anchor
// passes below, so dropping either half loses embeds in comments.
const SPEAK_VIDEO_HOST = String.raw`(?:play\.)?3speak\.(?:tv|online|co)`;
const SPEAK_VIDEO_LINK_RE = new RegExp(
  `<a[^>]*href="https?:\\/\\/${SPEAK_VIDEO_HOST}\\/(watch|embed)\\?v=([^"&]+)[^"]*"[^>]*>[\\s\\S]*?<\\/a>`,
  'gi'
);
const SPEAK_VIDEO_IFRAME_RE = new RegExp(
  `<iframe[^>]*\\bsrc="https?:\\/\\/${SPEAK_VIDEO_HOST}\\/(?:watch|embed)\\?v=([^"&]+)[^"]*"[^>]*>(?:\\s*<\\/iframe>)?`,
  'gi'
);

const speakEmbedUrl = (kind, id) =>
  `https://play.3speak.tv/${kind}?v=${id}&mode=iframe&captions=0&layout=desktop`;

/**
 * Turn 3Speak URLs into embedded players. Handles legacy (3speak.tv,
 * 3speak.online, 3speak.co) and current (play.3speak.tv) video URLs plus
 * audio.3speak.tv, and de-duplicates repeats of the same asset within one body.
 *
 * `video` / `audio` gate each half independently: the watch page renders a post
 * whose own video it is already playing, so it asks for audio only and leaves
 * the 3Speak video links as ordinary links. Comments and snaps keep both — a
 * 3Speak link there is someone sharing a video, and nothing else on the page
 * will play it for them.
 */
function transform3SpeakContent(content, { video = true, audio = true } = {}) {
  const embeddedVideos = new Set();
  const embeddedAudios = new Set();

  content = fixMalformedCenterTags(content);

  if (video) {
    // Raw <iframe> pointing at 3Speak (old post format) → our video-container wrapper.
    content = content.replace(SPEAK_VIDEO_IFRAME_RE, (_match, videoId) => {
      let decoded;
      try { decoded = decodeURIComponent(videoId); } catch { decoded = videoId; }
      if (embeddedVideos.has(decoded)) return '';
      embeddedVideos.add(decoded);
      return videoContainer(speakEmbedUrl('watch', decoded));
    });

    // Links to a 3Speak video, on any of its hosts, /watch or /embed.
    content = content.replace(SPEAK_VIDEO_LINK_RE, (match, kind, videoId) => {
      if (embeddedVideos.has(videoId)) return match;
      embeddedVideos.add(videoId);
      return videoContainer(speakEmbedUrl(kind.toLowerCase(), videoId));
    });
  }

  if (audio) {
    // audio.3speak.tv links, any param format (?a=, ?cid=, …).
    content = content.replace(
      /<a[^>]*href="(https?:\/\/audio\.3speak\.tv\/play\?[^"]+)"[^>]*>.*?<\/a>/g,
      (match, fullUrl) => {
        const key = audioDedupeKey(fullUrl);
        if (embeddedAudios.has(key)) return match;
        embeddedAudios.add(key);
        return audioContainer(fullUrl);
      }
    );

    // Bare audio URL on its own line — DefaultRenderer leaves this as <p>URL</p>.
    content = content.replace(
      /<p>\s*(https?:\/\/audio\.3speak\.tv\/play\?[^<\s]+)\s*<\/p>/gi,
      (match, url) => {
        const key = audioDedupeKey(url);
        if (!key || embeddedAudios.has(key)) return match;
        embeddedAudios.add(key);
        return audioContainer(url);
      }
    );
  }

  return content;
}

/**
 * Turn IPFS iframes into native <video> elements with fallback sources.
 *
 * Matches ANY gateway domain and tolerates arbitrary iframe attribute order —
 * markup that doesn't match passes through DOMPurify as a raw iframe pointing
 * straight at a binary file, and browsers can auto-trigger a file download for
 * that kind of cross-origin iframe navigation with zero user interaction.
 */
function transformIPFSContent(content, ipfsGateway, fallbackGateways) {
  const genericIframeRegex = /<iframe[^>]*\ssrc="https?:\/\/[^"]+\/ipfs\/([a-zA-Z0-9\-_.?=&]+)"[^>]*>[\s\S]*?<\/iframe>/gi;

  return content.replace(genericIframeRegex, (_match, videoID) => {
    // Always route playback through our own known-good gateways, regardless of
    // which one the original post happened to reference.
    const sources = [ipfsGateway, ...fallbackGateways]
      .map((gw) => `<source src="${gw}/ipfs/${videoID}" type="video/mp4">`)
      .join('\n                    ');

    return `<video controls muted preload="none" loading="lazy">
                    ${sources}
                </video>`;
  });
}

/**
 * Every link that leaves 3Speak opens in a new tab.
 *
 * Reported from the community (2026-08-19): clicking an image wrapped in a link
 * inside the upload form's description PREVIEW navigated the tab away, taking
 * the whole in-progress upload with it. The same click costs a viewer their
 * place in a playing video, and an IPFS link that answers with
 * Content-Disposition: attachment fires a download prompt on top of that.
 *
 * Absolute http(s) hrefs only, and this runs AFTER Hive frontend URLs have been
 * rewritten to app-internal ones — so /@author/permlink, /p/user and /t/tag
 * stay in this tab, where the router handles them. An href that already carries
 * a target is left alone. (An onclick handler here would be pointless —
 * FORBID_ATTR strips it during sanitization.)
 */
function externalLinksToNewTab(content) {
  return content.replace(/<a href="(https?:\/\/[^"]*)"([^>]*)>/gi, (match, href, attrs) => {
    if (/\starget\s*=/i.test(attrs)) return match;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer"${attrs}>`;
  });
}

/** Convert Hive frontend URLs (peakd, ecency, …) to internal app links. */
function convertHiveUrlsToInternal(content, hiveFrontends, internalPrefix) {
  const frontendsPattern = hiveFrontends.map((domain) => domain.replace('.', '\\.')).join('|');

  const hiveUrlRegex = new RegExp(
    `<a href="https?:\\/\\/(?:www\\.)?(${frontendsPattern})\\/((?:[^/]+\\/)?@([a-z0-9.-]+)\\/([a-z0-9-]+))"([^>]*)>`,
    'gi'
  );

  return content.replace(hiveUrlRegex, (_match, _frontend, _fullPath, author, permlink, attributes) =>
    `<a href="${internalPrefix}/@${author}/${permlink}"${attributes}>`
  );
}

/**
 * Create a Hive markdown renderer.
 *
 * @param {object} options
 * @param {string} [options.baseUrl]
 * @param {string} [options.ipfsGateway]        Primary IPFS gateway for rendered IPFS content.
 * @param {string[]} [options.ipfsFallbackGateways]
 * @param {(account: string) => string} [options.usertagUrlFn]
 * @param {(hashtag: string) => string} [options.hashtagUrlFn]
 * @param {string[]} [options.additionalHiveFrontends]
 * @param {boolean} [options.convertHiveUrls]
 * @param {string} [options.internalUrlPrefix]
 * @param {number} [options.assetsWidth]
 * @param {number} [options.assetsHeight]
 * @param {(url: string) => string} [options.imageProxyFn]
 * @param {object} [options.embeds]             Which embeds this renderer may produce.
 * @param {boolean} [options.embeds.threespeakVideo=true]
 * @param {boolean} [options.embeds.threespeakAudio=true]
 * @param {boolean} [options.embeds.ipfsVideo=true]
 * @returns {(markdown: string) => string}
 */
export function createHiveRenderer(options = {}) {
  const {
    baseUrl = 'https://hive.blog/',
    ipfsGateway = DEFAULT_IPFS_GATEWAY,
    ipfsFallbackGateways = DEFAULT_IPFS_FALLBACKS,
    usertagUrlFn = (account) => '/@' + account,
    hashtagUrlFn = (hashtag) => '/trending/' + hashtag,
    additionalHiveFrontends = [],
    convertHiveUrls = true,
    internalUrlPrefix = '',
    assetsWidth = 540,
    assetsHeight = 380,
    imageProxyFn,
    embeds = {},
  } = options;

  const {
    threespeakVideo = true,
    threespeakAudio = true,
    ipfsVideo = true,
  } = embeds;

  const hiveFrontends = [...DEFAULT_HIVE_FRONTENDS, ...additionalHiveFrontends];

  const defaultImageProxy = (url) => {
    try {
      if (url.includes('ipfs')) {
        const parts = url.split('/ipfs/');
        if (parts[1]) return `https://ipfs.io/ipfs/${parts[1]}`;
      }
      return url;
    } catch {
      return url;
    }
  };

  const renderer = new DefaultRenderer({
    baseUrl,
    breaks: true,
    // DefaultRenderer has no iframe whitelist option — it blocks all raw iframes.
    // We skip its sanitization and rely on DOMPurify (below) for XSS protection.
    skipSanitization: true,
    allowInsecureScriptTags: false,
    addNofollowToLinks: true,
    doNotShowImages: false,
    assetsWidth,
    assetsHeight,
    imageProxyFn: imageProxyFn || defaultImageProxy,
    usertagUrlFn,
    hashtagUrlFn,
    isLinkSafeFn: () => true,
    addExternalCssClassToMatchingLinksFn: () => true,
    ipfsPrefix: ipfsGateway,
  });

  if (!disableUpstreamEmbedders(renderer)) {
    // Not fatal — `rawIframesToLinks` below still turns whatever they produce
    // into links — but it means a library upgrade moved the field we reach for.
    console.warn('[hiveRenderer] could not disable @hiveio/content-renderer embedders');
  }

  return function renderHiveMarkdown(markdown) {
    let html = renderer.render(markdown);

    // 3Speak video/audio links → players.
    html = transform3SpeakContent(html, { video: threespeakVideo, audio: threespeakAudio });

    // IPFS iframes → <video> with fallback sources.
    if (ipfsVideo) {
      html = transformIPFSContent(html, ipfsGateway, ipfsFallbackGateways);
    }

    // Anything still in an iframe is either hand-written raw HTML or an embedder
    // we failed to switch off — either way, show it as a link, not a player.
    html = rawIframesToLinks(html);

    if (convertHiveUrls) {
      html = convertHiveUrlsToInternal(html, hiveFrontends, internalUrlPrefix);
    }

    // Links off-site shouldn't yank the user out of the page. Deliberately
    // after the Hive-URL rewrite above, so links that just became internal
    // aren't sent to a new tab.
    html = externalLinksToNewTab(html);

    html = DOMPurify.sanitize(html, DOMPURIFY_CONFIG);

    // A player replaces a link *inside* a paragraph, and a <div> can't live in a
    // <p> — so the HTML parser (inside DOMPurify, which is why this runs last)
    // splits the paragraph around it and leaves an empty stub on either side.
    // Each stub is a blank line of padding hugging the player.
    return html.replace(/<p>\s*(?:<span>\s*<\/span>|\s)*<\/p>/gi, '');
  };
}
