/**
 * Spotlight — creator link pages ("linktree" for 3Speak).
 *
 * Storage is ON-CHAIN: the layout lives in the user's `posting_json_metadata` under
 * the `3speak.spotlight` key (no database). A page has a `theme` (page background +
 * defaults) and an ordered `sections[]` array of typed blocks (header/link/image/
 * video), each with optional style overrides + a grid `width`.
 *
 * SECURITY: the layout is user-controlled on-chain data rendered on a PUBLIC page,
 * so it is ALWAYS re-sanitized here before rendering — unknown fields dropped,
 * strings length-capped, URLs forced to http(s) (kills javascript:/data:), colors
 * pattern-matched, numbers clamped, section count bounded. sanitizeLayout() builds a
 * fresh object field-by-field; the raw metadata is never rendered as-is.
 */
const META_NS = '3speak';

// Extract + sanitize a Spotlight layout from an already-fetched Hive account.
function readSpotlightFromAccount(account) {
  if (!account) return null;
  let meta = {};
  try {
    const raw = account.posting_json_metadata;
    meta = typeof raw === 'string' ? (JSON.parse(raw || '{}') || {}) : (raw && typeof raw === 'object' ? raw : {});
  } catch { return null; }
  const sp = meta && meta[META_NS] && meta[META_NS].spotlight;
  if (!sp || typeof sp !== 'object') return null;
  const clean = sanitizeLayout(sp);
  return clean.sections.length || clean.headline ? clean : null;
}

// ── sanitizers ──────────────────────────────────────────────────────────────
const HIVE_USER_RE = /^[a-z][a-z0-9.-]{2,15}$/;
const PERMLINK_RE = /^[a-z0-9-]{1,255}$/;
const ICON_RE = /^[a-z0-9-]{1,40}$/;
// #rgb, #rgba, #rrggbb, #rrggbbaa, or rgb()/rgba(...) with only digits/.,%/spaces.
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const RGBA_RE = /^rgba?\(\s*[\d.,%\s]+\)$/;

const MAX_SECTIONS = 60;
const MAX_HEADLINE = 200;

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const clampInt = (v, lo, hi, dflt) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, n));
};
const oneOf = (v, allowed, dflt) => (allowed.includes(v) ? v : dflt);

/** A safe color or null. Rejects anything that isn't a hex/rgba literal. */
function color(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (HEX_RE.test(s) || RGBA_RE.test(s)) return s;
  return null;
}

/** An http(s) URL (length-capped) or null — never javascript:/data:/etc. */
function safeUrl(v, max = 2000) {
  if (typeof v !== 'string' || v.length > max) return null;
  try {
    const u = new URL(v.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.toString() : null;
  } catch {
    return null;
  }
}

// Link targets additionally allow mailto: and tel: (still no javascript:/data:).
function safeLinkUrl(v, max = 2000) {
  if (typeof v !== 'string' || v.length > max) return null;
  try {
    const u = new URL(v.trim());
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

// Slight looping motion — shared by blocks (prefix 'anim') and the avatar
// (prefix 'avatarAnim'). Stored: Type + Speed(1-10, higher=faster) + Loop(bool) +
// Dur(total seconds, only when loop is off).
const ANIM_TYPES = ['none', 'float', 'sway', 'pulse', 'wobble', 'bounce', 'tilt', 'spin', 'shake', 'breathe'];
function motionFields(s, prefix) {
  const t = oneOf(s[`${prefix}Type`], ANIM_TYPES, 'none');
  if (t === 'none') return {};
  const o = {};
  o[`${prefix}Type`] = t;
  o[`${prefix}Speed`] = clampInt(s[`${prefix}Speed`] != null ? s[`${prefix}Speed`] : 5, 1, 10, 5);
  const loop = s[`${prefix}Loop`] !== false;
  o[`${prefix}Loop`] = loop;
  if (!loop) o[`${prefix}Dur`] = clampInt(s[`${prefix}Dur`] != null ? s[`${prefix}Dur`] : 10, 1, 120, 10);
  return o;
}
// CSS `animation:` shorthand for a motion field group, or '' when type is 'none'.
function animCss(m, prefix) {
  const t = m[`${prefix}Type`];
  if (!t || t === 'none') return '';
  const cycle = 11 - clampInt(m[`${prefix}Speed`], 1, 10, 5);          // seconds per cycle
  const loop = m[`${prefix}Loop`] !== false;
  const iter = loop ? 'infinite' : Math.max(1, Math.round((m[`${prefix}Dur`] || 10) / cycle));
  const timing = t === 'spin' ? 'linear' : (t === 'shake' || t === 'bounce') ? 'ease' : 'ease-in-out';
  return `animation:sp-${t} ${cycle}s ${timing} ${iter};`;
}

// Per-section style overrides shared by every block type.
function overrides(s) {
  const o = {};
  const bg = color(s.bg); if (bg) o.bg = bg;
  const text = color(s.text); if (text) o.text = text;
  if (s.radius != null) o.radius = clampInt(s.radius, 0, 48, 16);
  // Grid width: how much of a row the block occupies. Absent = full.
  const w = oneOf(s.width, ['full', 'half', 'third'], null);
  if (w && w !== 'full') o.width = w;
  // Background transparency (only meaningful when bg is set) + per-section font size.
  if (s.bgOpacity != null) { const op = clampInt(s.bgOpacity, 0, 100, 100); if (op < 100) o.bgOpacity = op; }
  if (s.fontScale != null) { const f = clampInt(s.fontScale, 50, 250, 100); if (f !== 100) o.fontScale = f; }
  if (s.padding != null) { const p = clampInt(s.padding, 4, 40, 15); if (p !== 15) o.padding = p; }
  // Border — thickness / colour / transparency.
  if (s.borderWidth != null) { const bw = clampInt(s.borderWidth, 0, 12, 0); if (bw > 0) o.borderWidth = bw; }
  if (o.borderWidth) {
    o.borderColor = color(s.borderColor) || '#000000';
    if (s.borderOpacity != null) { const bo = clampInt(s.borderOpacity, 0, 100, 100); if (bo < 100) o.borderOpacity = bo; }
  }
  // Shadow — full x/y/blur/spread/colour + strength; rendered only when strength > 0.
  if (s.shadowOpacity != null) { const so = clampInt(s.shadowOpacity, 0, 100, 0); if (so > 0) o.shadowOpacity = so; }
  if (o.shadowOpacity) {
    o.shadowX = clampInt(s.shadowX, -60, 60, 0);
    o.shadowY = clampInt(s.shadowY, -60, 60, 10);
    o.shadowBlur = clampInt(s.shadowBlur, 0, 120, 24);
    o.shadowSpread = clampInt(s.shadowSpread, -40, 40, 0);
    o.shadowColor = color(s.shadowColor) || '#000000';
    if (s.shadowInset) o.shadowInset = true;
  }
  Object.assign(o, motionFields(s, 'anim'));
  return o;
}

// Inline border + box-shadow CSS from a section's overrides ('' when unset).
function boxCss(s) {
  let css = '';
  if (s.borderWidth) {
    css += `border:${s.borderWidth}px solid ${withOpacity(s.borderColor || '#000000', s.borderOpacity == null ? 100 : s.borderOpacity)};`;
  }
  if (s.shadowOpacity) {
    const sc = withOpacity(s.shadowColor || '#000000', s.shadowOpacity);
    css += `box-shadow:${s.shadowInset ? 'inset ' : ''}${s.shadowX || 0}px ${s.shadowY || 0}px ${s.shadowBlur || 0}px ${s.shadowSpread || 0}px ${sc};`;
  }
  return css;
}

// hex(#rrggbb) + opacity% → rgba(); leaves non-hex values (already rgba) untouched.
function withOpacity(col, pct) {
  if (!col || pct == null || pct >= 100) return col;
  const m = /^#([0-9a-fA-F]{6})$/.exec(col);
  if (!m) return col;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(100, pct)) / 100})`;
}

function sanitizeSection(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const base = { id: str(raw.id, 40) || null, ...overrides(raw) };
  switch (raw.type) {
    case 'header':
      return {
        ...base, type: 'header',
        text: str(raw.text, 120),
        size: oneOf(raw.size, ['sm', 'md', 'lg'], 'md'),
        align: oneOf(raw.align, ['left', 'center', 'right'], 'center'),
      };
    case 'link': {
      const url = safeLinkUrl(raw.url);
      if (!url) return null;                       // a link with no valid URL is meaningless
      return {
        ...base, type: 'link',
        title: str(raw.title, 80),
        url,
        icon: (typeof raw.icon === 'string' && ICON_RE.test(raw.icon)) ? raw.icon : 'link',
        iconColor: color(raw.iconColor) || null,
        iconBg: color(raw.iconBg) || null,
      };
    }
    case 'image': {
      const src = safeUrl(raw.src);
      if (!src) return null;
      return {
        ...base, type: 'image',
        src,
        alt: str(raw.alt, 120),
        url: safeUrl(raw.url) || null,             // optional click-through
      };
    }
    case 'video': {
      const author = str(raw.author, 16).toLowerCase();
      const permlink = str(raw.permlink, 255);
      if (!HIVE_USER_RE.test(author) || !PERMLINK_RE.test(permlink)) return null;
      return {
        ...base, type: 'video',
        author, permlink,
        title: str(raw.title, 140),
        thumbnail: safeUrl(raw.thumbnail) || null,
        isShort: !!raw.isShort, // shorts render in a 9:16 (vertical) player
      };
    }
    case 'embed': {
      // A rich-link "unfurl" card. Two sources:
      //  • 'link'        — one card, metadata resolved once at edit time & STORED.
      //  • 'hive-recent' — the author's latest top-level (non-crosspost) Hive posts,
      //                    resolved LIVE at render time (see resolveDynamicSections).
      const source = oneOf(raw.source, ['link', 'hive-recent'], 'link');
      const imgSize = clampInt(raw.imgSize, 0, 100, 55);
      if (source === 'hive-recent') {
        const account = str(raw.account, 16).toLowerCase();
        return {
          ...base, type: 'embed', source: 'hive-recent',
          account: HIVE_USER_RE.test(account) ? account : '',   // '' → the page owner
          count: clampInt(raw.count, 1, 6, 3),
          perRow: clampInt(raw.perRow, 1, 3, 1),
          animStagger: clampInt(raw.animStagger, 0, 2000, 120),
          imgSize,
        };
      }
      const url = safeUrl(raw.url);
      if (!url) return null;
      return {
        ...base, type: 'embed', source: 'link',
        url,
        title: str(raw.title, 160),
        description: str(raw.description, 300),
        image: safeUrl(raw.image) || null,
        siteName: str(raw.siteName, 80),
        imgSize,
      };
    }
    default:
      return null;                                  // unknown type → dropped
  }
}

function sanitizeTheme(t = {}) {
  const bgRaw = (t && typeof t.bg === 'object') ? t.bg : {};
  const bg = {
    type: oneOf(bgRaw.type, ['color', 'gradient', 'image'], 'color'),
    color: color(bgRaw.color) || '#0f0f14',
    color2: color(bgRaw.color2) || '#1e1e2e',
    angle: clampInt(bgRaw.angle, 0, 360, 160),
    image: safeUrl(bgRaw.image) || null,
    // Overlay laid over a background IMAGE for readability — a tint/gradient with
    // its own transparency. Ignored unless type === 'image'.
    overlayType: oneOf(bgRaw.overlayType, ['none', 'color', 'gradient'], 'none'),
    overlayColor: color(bgRaw.overlayColor) || '#000000',
    overlayColor2: color(bgRaw.overlayColor2) || '#000000',
    overlayAngle: clampInt(bgRaw.overlayAngle, 0, 360, 160),
    overlayOpacity: clampInt(bgRaw.overlayOpacity, 0, 100, 45),
  };
  return {
    bg,
    text: color(t.text) || '#f5f5f7',
    sectionBg: color(t.sectionBg) || 'rgba(255,255,255,0.08)',
    sectionText: color(t.sectionText) || '#f5f5f7',
    radius: clampInt(t.radius, 0, 48, 16),
    buttonStyle: oneOf(t.buttonStyle, ['fill', 'outline', 'soft'], 'soft'),
    // The always-present "open my channel on 3Speak" button — text editable, but the
    // button itself (and its footer position) is fixed.
    footerText: str(t.footerText, 60) || 'Open my Channel on 3Speak',
    font: oneOf(t.font, FONT_KEYS, 'system'),
    fontScale: clampInt(t.fontScale, 60, 200, 100),
    // Global text styling — applies to the name, bio and every text/header block.
    fontStyle: oneOf(t.fontStyle, ['normal', 'italic', 'bold', 'bolditalic'], 'normal'),
    textShadow: oneOf(t.textShadow, ['none', 'soft', 'strong'], 'none'),
    textStroke: clampInt(t.textStroke, 0, 3, 0),
    textStrokeColor: color(t.textStrokeColor) || '#000000',
    // Avatar size as a percentage of the base (96px public / 64px preview).
    avatarPct: clampInt(t.avatarPct, 40, 250, 100),
    // Avatar effects — drop shadow strength, optional coloured glow, looping motion.
    avatarShadow: clampInt(t.avatarShadow, 0, 100, 30),
    avatarGlow: color(t.avatarGlow) || null,
    avatarGlowSize: clampInt(t.avatarGlowSize, 0, 80, 24),
    ...motionFields(t, 'avatarAnim'),
  };
}

/** Build a clean, storable layout from arbitrary client input. */
function sanitizeLayout(raw = {}) {
  const sections = Array.isArray(raw.sections) ? raw.sections : [];
  const clean = [];
  for (const s of sections) {
    if (clean.length >= MAX_SECTIONS) break;
    const c = sanitizeSection(s);
    if (c) clean.push(c);
  }
  return {
    headline: str(raw.headline, MAX_HEADLINE),
    theme: sanitizeTheme(raw.theme),
    sections: clean,
  };
}

// ── standalone HTML render ───────────────────────────────────────────────────
// The public page is served as a single self-contained HTML document (no SPA, no
// framework, no app chrome) so it loads near-instantly and previews well when
// shared. All interpolated user content is HTML-escaped here regardless of the
// write-time sanitization (defence in depth).
const ICONS = require('./spotlightIcons');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function overlayCss(bg) {
  if (bg.overlayType !== 'color' && bg.overlayType !== 'gradient') return '';
  const op = bg.overlayOpacity == null ? 45 : bg.overlayOpacity;
  const c1 = withOpacity(bg.overlayColor || '#000000', op);
  if (bg.overlayType === 'color') return `linear-gradient(${c1},${c1})`;
  const c2 = withOpacity(bg.overlayColor2 || '#000000', op);
  return `linear-gradient(${bg.overlayAngle || 160}deg,${c1},${c2})`;
}
function bgCss(bg) {
  if (!bg) return '#12121a';
  if (bg.type === 'image' && bg.image) {
    const ov = overlayCss(bg);
    return `${ov ? `${ov},` : ''}center/cover no-repeat url("${esc(bg.image)}"), #12121a`;
  }
  if (bg.type === 'gradient') return `linear-gradient(${bg.angle || 160}deg, ${esc(bg.color)}, ${esc(bg.color2)})`;
  return esc(bg.color || '#12121a');
}
const FONTS = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  display: '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif',
  condensed: '"Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif',
  handwriting: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive',
  // 10 more — all system-font stacks (no external webfont requests).
  grotesk: '"Helvetica Neue", Helvetica, Arial, sans-serif',
  humanist: 'Optima, Candara, "Gill Sans", "Gill Sans MT", "Segoe UI", sans-serif',
  geometric: 'Futura, "Century Gothic", "Twentieth Century", "Trebuchet MS", sans-serif',
  slab: 'Rockwell, "Roboto Slab", "Courier New", Georgia, serif',
  elegant: 'Didot, "Bodoni MT", "Playfair Display", "Palatino Linotype", Georgia, serif',
  typewriter: '"Courier New", Courier, "Lucida Console", monospace',
  marker: '"Permanent Marker", "Chalkboard SE", "Comic Sans MS", cursive',
  brush: '"Brush Script MT", "Segoe Script", "Bradley Hand", cursive',
  palatino: 'Palatino, "Palatino Linotype", "Book Antiqua", Georgia, serif',
  wide: '"Arial Black", "Arial Bold", Impact, Gadget, sans-serif',
};
const FONT_KEYS = Object.keys(FONTS);
const TEXT_SHADOWS = { none: 'none', soft: '0 1px 3px rgba(0,0,0,.45)', strong: '0 2px 7px rgba(0,0,0,.75)' };

function iconSvg(slug, color) {
  const ic = ICONS[slug] || ICONS.link;
  return `<svg viewBox="${ic.v}" width="18" height="18" fill="${esc(color || 'currentColor')}" aria-hidden="true"><path d="${ic.d}"></path></svg>`;
}

// Thumbnail size (0-100) → image aspect ratio. Bigger = taller image (default 55 ≈ 1.5).
function embAspect(imgSize) {
  const v = Number.isFinite(Number(imgSize)) ? Math.max(0, Math.min(100, Number(imgSize))) : 55;
  return (2.2 - (v / 100) * 1.2).toFixed(2);
}
// One rich-link card. `d` = the card data, `s` = the section (style overrides + box),
// `extraStyle` = optional per-card CSS (e.g. a staggered animation for the feed).
function embCardHtml(d, s, aspect, box, extraStyle) {
  const sfs = s && s.fontScale ? `--sfs:${(s.fontScale / 100).toFixed(2)};` : '';
  const rad = s && s.radius != null ? `border-radius:${s.radius}px;` : '';
  const obg = withOpacity(s && s.bg, s && s.bgOpacity);
  const style = `${sfs}${obg ? `background:${esc(obg)};` : ''}${rad}${s && s.text ? `color:${esc(s.text)};` : ''}${box || ''}${extraStyle || ''}`;
  let domain = '';
  try { domain = new URL(d.url).hostname.replace(/^www\./, ''); } catch { /* keep '' */ }
  const site = esc(d.siteName || domain);
  const title = esc(d.title || domain || 'Open link');
  const img = d.image ? `<div class="emb-img" style="aspect-ratio:${aspect}/1"><img src="${esc(d.image)}" alt="" loading="lazy"></div>` : '';
  const dsc = d.description ? `<div class="emb-d">${esc(d.description)}</div>` : '';
  const st = site ? `<div class="emb-s">${site}</div>` : '';
  return `<a class="emb" href="${esc(d.url)}" target="_blank" rel="noopener noreferrer nofollow" style="${style}">${img}<div class="emb-b">${st}<div class="emb-t">${title}</div>${dsc}</div></a>`;
}

function renderSection(s, theme) {
  const w = s.width === 'half' ? ' w-half' : s.width === 'third' ? ' w-third' : '';
  const anim = animCss(s, 'anim');
  const cell = (inner, style = anim) => `<div class="cell${w}"${style ? ` style="${style}"` : ''}>${inner}</div>`;
  const rad = s.radius != null ? `border-radius:${s.radius}px;` : '';
  const box = boxCss(s);

  const sfs = s.fontScale ? `--sfs:${(s.fontScale / 100).toFixed(2)};` : '';
  if (s.type === 'header') {
    const obg = withOpacity(s.bg, s.bgOpacity);
    const pad = (obg || s.radius != null || box) ? 'padding:12px 14px;' : '';
    const style = `text-align:${esc(s.align || 'center')};${sfs}${obg ? `background:${esc(obg)};` : ''}${rad}${pad}${s.text ? `color:${esc(s.text)};` : ''}${box}`;
    return cell(`<div class="h h-${s.size || 'md'}" style="${style}">${esc(s.text)}</div>`);
  }
  if (s.type === 'link') {
    const obg = withOpacity(s.bg, s.bgOpacity);
    const pad = s.padding != null ? `padding:${s.padding}px ${s.padding + 3}px;` : '';
    const style = `${sfs}${pad}${obg ? `background:${esc(obg)};` : ''}${s.text ? `color:${esc(s.text)};` : ''}${rad}${box}`;
    const icStyle = `${s.iconBg ? `background:${esc(s.iconBg)};` : ''}`;
    const label = esc(s.title || String(s.url).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''));
    return cell(`<a class="lnk lnk-${esc(theme.buttonStyle)}" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow" style="${style}"><span class="ic" style="${icStyle}">${iconSvg(s.icon, s.iconColor)}</span><span class="lt">${label}</span></a>`);
  }
  if (s.type === 'image') {
    const img = `<img class="img" src="${esc(s.src)}" alt="${esc(s.alt)}" loading="lazy" style="${rad}${box}">`;
    return cell(s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer nofollow">${img}</a>` : img);
  }
  if (s.type === 'video') {
    // Our own SDK player, served same-origin at /embed/<author>/<permlink> (see
    // src/page/EmbedPlayer.jsx) — NOT a play.3speak.tv iframe. `?short=1` => vertical.
    const embed = `/embed/${esc(s.author)}/${esc(s.permlink)}${s.isShort ? '?short=1' : ''}`;
    const vcls = s.isShort ? 'vid vid-short' : 'vid';
    const frame = `<div class="${vcls}"><iframe src="${esc(embed)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
    const watch = `https://3speak.tv/@${esc(s.author)}/${esc(s.permlink)}`;
    const title = s.title
      ? `<a class="vtitle" href="${watch}" target="_blank" rel="noopener noreferrer nofollow">${esc(s.title)}</a>`
      : '';
    // ONE tile like a rich-link card. Defaults to the theme's section background (what
    // the other blocks show) so it matches them; a per-block bg overrides. Border /
    // shadow / font / radius / padding wrap the title + player together.
    const cardBg = withOpacity(s.bg, s.bgOpacity) || theme.sectionBg || 'rgba(255,255,255,.08)';
    const cardText = s.text || theme.sectionText || '#f5f5f7';
    const cardRad = s.radius != null ? s.radius : (theme.radius != null ? theme.radius : 16);
    const pad = s.padding != null ? `padding:${s.padding}px;` : 'padding:10px;';
    const cardStyle = `${sfs}background:${esc(cardBg)};color:${esc(cardText)};border-radius:${cardRad}px;${pad}${box}`;
    return cell(`<div class="vcard${s.isShort ? ' vcard-short' : ''}" style="${cardStyle}">${title}${frame}</div>`);
  }
  if (s.type === 'embed') {
    const aspect = embAspect(s.imgSize);
    if (s.source === 'hive-recent') {
      // Live-resolved list of the author's latest posts (see resolveDynamicSections).
      const items = Array.isArray(s._items) ? s._items : [];
      const cols = clampInt(s.perRow, 1, 3, 1);
      // Per-card staggered motion: each card carries the animation with an
      // incremental animation-delay so they ripple in one after another. The cell
      // itself is NOT animated (that would move the whole feed as a single block).
      const stagger = clampInt(s.animStagger, 0, 2000, 120);
      const cards = items.map((it, i) => {
        const cardAnim = anim ? `${anim}animation-delay:${i * stagger}ms;` : '';
        return embCardHtml(it, s, aspect, box, cardAnim);
      }).join('');
      return cell(`<div class="emb-feed" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${cards || '<div class="emb-empty">No recent posts yet.</div>'}</div>`, '');
    }
    return cell(embCardHtml({ url: s.url, title: s.title, description: s.description, image: s.image, siteName: s.siteName }, s, aspect, box));
  }
  return '';
}

// shareImage: the channel's 1200x630 share card (og-cards.cjs), so a shared
// link page unfurls as the channel does; without one, the bare avatar.
function renderSpotlightHtml(username, page, { displayName, shareImage } = {}) {
  const user = esc(username);
  const name = esc(displayName || `@${username}`);
  const avatar = `https://images.hive.blog/u/${encodeURIComponent(username)}/avatar`;
  const theme = (page && page.theme) || {};
  const headline = (page && page.headline) || '';
  const sections = (page && page.sections) || [];
  const desc = headline || `${username} on 3Speak`;

  const body = sections.length
    ? `<div class="grid">${sections.map((s) => renderSection(s, theme)).join('')}</div>`
    : `<p class="empty">@${user} hasn’t added any links yet.</p>`;

  // Global text styling (applies to name/bio/headers).
  const avPx = Math.round(96 * ((Number(theme.avatarPct) || 100) / 100));
  const fs = (Number(theme.fontScale) || 100) / 100;               // global font size
  const fst = theme.fontStyle || 'normal';
  const italic = fst === 'italic' || fst === 'bolditalic';
  const bold = fst === 'bold' || fst === 'bolditalic';
  const textShadow = TEXT_SHADOWS[theme.textShadow] || 'none';
  const textStroke = (Number(theme.textStroke) || 0) > 0
    ? `-webkit-text-stroke:${Number(theme.textStroke)}px ${esc(theme.textStrokeColor || '#000000')};` : '';
  const footerText = esc(theme.footerText || 'Open my Channel on 3Speak');

  // Avatar effects — drop shadow (strength), optional coloured glow, looping motion.
  const avSh = Number.isFinite(Number(theme.avatarShadow)) ? Number(theme.avatarShadow) : 30;
  const avGlow = color(theme.avatarGlow);
  const avGlowSize = Number(theme.avatarGlowSize) || 24;
  const avShadowParts = [];
  if (avSh > 0) avShadowParts.push(`0 ${Math.round(avSh * 0.14) + 2}px ${Math.round(avSh * 0.45) + 6}px rgba(0,0,0,${(avSh * 0.0075).toFixed(2)})`);
  if (avGlow) avShadowParts.push(`0 0 ${Math.round(avGlowSize * 0.6)}px ${esc(avGlow)},0 0 ${avGlowSize}px ${esc(avGlow)}`);
  const avStyle = `${avShadowParts.length ? `box-shadow:${avShadowParts.join(',')};` : ''}${animCss(theme, 'avatarAnim')}`;

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name} • 3Speak</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${name}"><meta property="og:description" content="${esc(desc)}">
${shareImage
    ? `<meta property="og:image" content="${esc(shareImage)}"><meta property="og:image:type" content="image/jpeg"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${esc(shareImage)}">`
    : `<meta property="og:image" content="${esc(avatar)}">`}<meta property="og:type" content="profile">
<link rel="icon" href="${esc(avatar)}">
<style>
*{box-sizing:border-box}html,body{margin:0}
body{--fs:${fs};min-height:100vh;padding:44px 16px 60px;background:${bgCss(theme.bg)};color:${esc(theme.text || '#f5f5f7')};
font-family:${FONTS[theme.font] || FONTS.system};font-style:${italic ? 'italic' : 'normal'};display:flex;justify-content:center;-webkit-font-smoothing:antialiased}
.wrap{width:100%;max-width:600px;text-align:center}
.av{width:${avPx}px;height:${avPx}px;border-radius:50%;object-fit:cover}
.nm{margin:14px 0 0;font-size:calc(22px*var(--fs));font-weight:800}
.hd{margin:2px 0 0;font-size:calc(14px*var(--fs));opacity:.65}
.bio{margin:10px auto 0;max-width:460px;font-size:calc(15px*var(--fs));line-height:1.5;opacity:.9}
.nm,.hd,.bio,.h{text-shadow:${textShadow};${textStroke}${bold ? 'font-weight:800;' : ''}}
/* Flex grid: wrapped orphans centre on the last row (instead of hugging the left). */
.grid{display:flex;flex-wrap:wrap;justify-content:center;align-items:stretch;gap:14px;margin-top:26px}
.cell{min-width:0;flex:0 1 100%}.cell.w-half{flex-basis:calc(50% - 7px)}.cell.w-third{flex-basis:calc(33.33% - 9.34px)}
.h{font-weight:700}.h-lg{font-size:calc(22px*var(--fs)*var(--sfs,1))}.h-md{font-size:calc(17px*var(--fs)*var(--sfs,1));opacity:.95}.h-sm{font-size:calc(14px*var(--fs)*var(--sfs,1));opacity:.75}
.lnk{display:flex;align-items:center;gap:12px;padding:15px 18px;text-decoration:none;font-size:calc(15.5px*var(--fs)*var(--sfs,1));font-weight:600;
border:1px solid transparent;border-radius:${theme.radius != null ? theme.radius : 16}px;background:${esc(theme.sectionBg || 'rgba(255,255,255,.08)')};color:${esc(theme.sectionText || '#f5f5f7')};
transition:transform .12s,filter .12s,box-shadow .12s}
.lnk:hover{transform:translateY(-1px);filter:brightness(1.06);box-shadow:0 6px 18px rgba(0,0,0,.22)}
.lnk-outline{background:transparent!important;border-color:currentColor}.lnk-soft{backdrop-filter:blur(4px)}
.ic{flex:0 0 auto;width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center}
.lt{flex:1 1 auto;min-width:0;text-align:center;margin-right:34px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.img{width:100%;display:block;object-fit:cover;border-radius:${theme.radius != null ? theme.radius : 16}px}
.vcard{display:flex;flex-direction:column;gap:8px;box-sizing:border-box}
.vcard-short{max-width:340px;margin-left:auto;margin-right:auto}
.vtitle{display:block;text-decoration:none;color:inherit;font-size:calc(14.5px*var(--fs)*var(--sfs,1));font-weight:600;line-height:1.3;transition:filter .12s}
.vtitle:hover{filter:brightness(1.12)}
.vid{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:#000;border-radius:${theme.radius != null ? theme.radius : 16}px}
.vid::after{content:"";position:absolute;top:50%;left:50%;width:38px;height:38px;margin:-19px 0 0 -19px;border:3px solid rgba(255,255,255,.25);border-top-color:#fff;border-radius:50%;animation:vspin .8s linear infinite;z-index:0}
.vid-short{aspect-ratio:9/16;max-width:100%;margin-left:auto;margin-right:auto}
.vid img{width:100%;height:100%;object-fit:cover}.vid iframe{width:100%;height:100%;border:0;position:relative;z-index:1;background:transparent}
@keyframes vspin{to{transform:rotate(360deg)}}
.play{position:absolute;inset:0;margin:auto;width:60px;height:60px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);border-radius:50%;transition:.12s}
.vid:hover .play{transform:scale(1.08);background:#e53935}
.vt{position:absolute;left:0;right:0;bottom:0;padding:20px 12px 10px;text-align:left;color:#fff;font-size:13px;font-weight:600;background:linear-gradient(transparent,rgba(0,0,0,.75))}
.emb{display:block;text-align:left;text-decoration:none;overflow:hidden;border:1px solid rgba(128,128,128,.22);border-radius:${theme.radius != null ? theme.radius : 16}px;background:${esc(theme.sectionBg || 'rgba(255,255,255,.08)')};color:${esc(theme.sectionText || '#f5f5f7')};transition:transform .12s,box-shadow .12s,filter .12s}
.emb:hover{transform:translateY(-1px);filter:brightness(1.04);box-shadow:0 6px 18px rgba(0,0,0,.22)}
.emb-feed{display:grid;grid-template-columns:1fr;gap:10px;align-items:start}
.emb-empty{padding:16px;text-align:center;opacity:.6;font-size:13px;grid-column:1/-1}
.emb-img{width:100%;aspect-ratio:1.6/1;overflow:hidden;background:rgba(0,0,0,.18)}
.emb-img img{width:100%;height:100%;object-fit:cover;display:block}
.emb-b{padding:13px 15px}
.emb-s{font-size:calc(11px*var(--fs));text-transform:uppercase;letter-spacing:.04em;opacity:.6;margin-bottom:4px}
.emb-t{font-size:calc(15.5px*var(--fs)*var(--sfs,1));font-weight:700;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.emb-d{margin-top:6px;font-size:calc(13px*var(--fs)*var(--sfs,1));line-height:1.45;opacity:.82;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.empty{margin-top:30px;opacity:.7}
.chbtn{display:inline-flex;align-items:center;justify-content:center;margin-top:36px;padding:13px 26px;border-radius:999px;text-decoration:none;font-size:calc(14px*var(--fs));font-weight:700;background:${esc(theme.sectionBg || 'rgba(255,255,255,.08)')};color:${esc(theme.sectionText || '#f5f5f7')};border:1px solid rgba(255,255,255,.18);transition:transform .12s,filter .12s,box-shadow .12s}
.chbtn:hover{transform:translateY(-1px);filter:brightness(1.08);box-shadow:0 6px 18px rgba(0,0,0,.25)}
@media(max-width:560px){.cell.w-third{flex-basis:calc(50% - 7px)}}
@keyframes sp-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes sp-sway{0%,100%{transform:rotate(-2.2deg)}50%{transform:rotate(2.2deg)}}
@keyframes sp-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.045)}}
@keyframes sp-wobble{0%,100%{transform:rotate(0)}25%{transform:rotate(1.8deg)}75%{transform:rotate(-1.8deg)}}
@keyframes sp-bounce{0%,55%,100%{transform:translateY(0)}30%{transform:translateY(-12px)}42%{transform:translateY(-5px)}}
@keyframes sp-tilt{0%,100%{transform:perspective(500px) rotateY(-7deg)}50%{transform:perspective(500px) rotateY(7deg)}}
@keyframes sp-spin{to{transform:rotate(360deg)}}
@keyframes sp-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-3px)}40%{transform:translateX(3px)}60%{transform:translateX(-2px)}80%{transform:translateX(2px)}}
@keyframes sp-breathe{0%,100%{transform:scale(1);filter:brightness(1)}50%{transform:scale(1.02);filter:brightness(1.07)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head>
<body>
<div class="wrap">
<a href="/@${user}"><img class="av" src="${esc(avatar)}" alt="${name}"${avStyle ? ` style="${avStyle}"` : ''}></a>
<h1 class="nm">${name}</h1>
${displayName ? `<div class="hd">@${user}</div>` : ''}
${headline ? `<p class="bio">${esc(headline)}</p>` : ''}
${body}
<a class="chbtn" href="/@${user}">${footerText}</a>
</div></body></html>`;
}

module.exports = {
  readSpotlightFromAccount, renderSpotlightHtml,
  sanitizeLayout, // exported for tests
};
