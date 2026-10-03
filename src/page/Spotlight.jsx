import { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getHiveClient } from '../utils/hiveNode';
import { fetchSpotlight, iconForSlug, bgToCss } from '../utils/spotlight';
import HiveAvatar from '../components/HiveAvatar/HiveAvatar';
import './Spotlight.scss';

const FONT_STACK = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  rounded: '"SF Pro Rounded", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  display: '"Impact", "Haettenschweiler", "Arial Narrow Bold", sans-serif',
  condensed: '"Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif',
  handwriting: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive',
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

// hex(#rrggbb) + opacity% → rgba(); passes rgba()/other through untouched.
function withOpacity(col, pct) {
  if (!col || pct == null || pct >= 100) return col;
  const m = /^#([0-9a-fA-F]{6})$/.exec(col);
  if (!m) return col;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(100, pct)) / 100})`;
}
// ── XSS hardening for the fallback renderer ──
// This page reads the layout RAW from Hive (unlike the server renderer, which
// re-sanitizes). React escapes text, but it does NOT block `javascript:` in href,
// and a colour/background value could smuggle a remote `url(...)`. So every URL,
// colour and numeric that reaches an href / src / inline-style is validated here.
const SAFE_LINK_PROTO = ['http:', 'https:', 'mailto:', 'tel:'];
function safeHref(url) {
  if (typeof url !== 'string') return undefined;
  try { return SAFE_LINK_PROTO.includes(new URL(url, window.location.origin).protocol) ? url : undefined; }
  catch { return undefined; }
}
function safeSrc(url) { // images / backgrounds — http(s) only
  if (typeof url !== 'string') return undefined;
  try { const p = new URL(url, window.location.origin).protocol; return (p === 'http:' || p === 'https:') ? url : undefined; }
  catch { return undefined; }
}
function safeColor(c) {
  return (typeof c === 'string' && /^(#[0-9a-fA-F]{3,8}|rgba?\([\d.,%\s]+\))$/.test(c.trim())) ? c : undefined;
}
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const cleanUser = (u) => String(u || '').replace(/[^a-z0-9.\-]/gi, '').toLowerCase();

// Per-block border + shadow inline style (mirrors the standalone renderer's boxCss).
// Numbers are coerced and colours validated so nothing but a valid CSS value lands here.
function fxStyle(s) {
  const st = {};
  if (s.borderWidth) st.border = `${num(s.borderWidth)}px solid ${withOpacity(safeColor(s.borderColor) || '#000000', num(s.borderOpacity, 100))}`;
  if (s.shadowOpacity) st.boxShadow = `${s.shadowInset ? 'inset ' : ''}${num(s.shadowX)}px ${num(s.shadowY)}px ${num(s.shadowBlur)}px ${num(s.shadowSpread)}px ${withOpacity(safeColor(s.shadowColor) || '#000000', num(s.shadowOpacity))}`;
  return st;
}

// Direct 3Speak embed — the player renders its own thumbnail/poster + play button.
// `loading="lazy"` defers offscreen players. Canonical: /watch?v=…&mode=iframe (16:9).
function VideoBlock({ section, radius, fx, theme }) {
  // Only render for a well-formed Hive author/permlink (guards the iframe URL).
  const author = String(section.author || '').toLowerCase();
  const permlink = String(section.permlink || '').toLowerCase();
  if (!/^[a-z][a-z0-9.\-]{2,15}$/.test(author) || !/^[a-z0-9-]{1,255}$/.test(permlink)) return null;
  const isShort = !!section.isShort;
  // Our own same-origin SDK player (src/page/EmbedPlayer.jsx), not a play.3speak.tv iframe.
  const src = `/embed/${author}/${permlink}${isShort ? '?short=1' : ''}`;
  // ONE tile like a rich-link card. Defaults to the theme's section background (what
  // the other blocks show) so it matches them; a per-block bg overrides.
  const cardBg = (section.bg ? withOpacity(safeColor(section.bg), num(section.bgOpacity, 100)) : null)
    || safeColor(theme?.sectionBg) || 'rgba(255,255,255,0.08)';
  const cardStyle = {
    background: cardBg,
    color: safeColor(section.text) || safeColor(theme?.sectionText) || undefined,
    borderRadius: radius,
    fontSize: `calc(14.5px * ${section.fontScale ? section.fontScale / 100 : 1})`,
    padding: section.padding != null ? num(section.padding) : 10,
    ...fx,
  };
  const watch = `https://3speak.tv/watch?v=${author}/${permlink}`;
  return (
    <div className={`sp-video-card${isShort ? ' short' : ''}`} style={cardStyle}>
      {section.title ? (
        <a className="sp-video-title" href={watch} target="_blank" rel="noopener noreferrer nofollow">
          {section.title}
        </a>
      ) : null}
      <div className={`sp-video${isShort ? ' sp-video-short' : ''}`} style={{ borderRadius: radius }}>
        <iframe
          src={src}
          title={section.title || `${author}/${permlink}`}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
}

// Rich-link card (mirrors the standalone `.emb`). `username` is the page owner, used
// to link a "My latest posts" block to their profile (this fallback doesn't live-fetch).
function EmbedBlock({ section, theme, username }) {
  const { t } = useTranslation();
  const radius = section.radius ?? theme.radius;
  const bg = safeColor(section.bg) || safeColor(theme.sectionBg);
  const text = safeColor(section.text) || safeColor(theme.sectionText);
  const style = { background: bg, color: text, borderRadius: radius, ...fxStyle(section) };
  if (section.source === 'hive-recent') {
    const who = cleanUser(section.account || username);
    return (
      <a className="sp-embed" href={`/@${who}`} style={style}>
        <div className="sp-embed-b"><div className="sp-embed-s">{t('spotlight.page.latestPosts')}</div><div className="sp-embed-t">{t('spotlight.page.seeNewestPosts', { user: who })}</div></div>
      </a>
    );
  }
  const href = safeHref(section.url);
  if (!href) return null;
  let domain = ''; try { domain = new URL(section.url).hostname.replace(/^www\./, ''); } catch { /* */ }
  const img = safeSrc(section.image);
  return (
    <a className="sp-embed" href={href} target="_blank" rel="noopener noreferrer nofollow" style={style}>
      {img ? <div className="sp-embed-img"><img src={img} alt="" loading="lazy" /></div> : null}
      <div className="sp-embed-b">
        {(section.siteName || domain) ? <div className="sp-embed-s">{section.siteName || domain}</div> : null}
        <div className="sp-embed-t">{section.title || domain || t('spotlight.page.openLink')}</div>
        {section.description ? <div className="sp-embed-d">{section.description}</div> : null}
      </div>
    </a>
  );
}

function Section({ section, theme, username }) {
  const radius = section.radius ?? theme.radius;
  const bg = safeColor(section.bg) || safeColor(theme.sectionBg);
  const text = safeColor(section.text) || safeColor(theme.sectionText);
  const fx = fxStyle(section);

  if (section.type === 'header') {
    return (
      <div className={`sp-header sp-header--${section.size}`} style={{ textAlign: section.align, color: safeColor(theme.text), ...fx }}>
        {section.text}
      </div>
    );
  }

  if (section.type === 'link') {
    const Icon = iconForSlug(section.icon);
    const href = safeHref(section.url);
    if (!href) return null;
    return (
      <a
        className={`sp-link sp-link--${theme.buttonStyle}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer nofollow"
        style={{ background: bg, color: text, borderRadius: radius, borderColor: text, ...fx }}
      >
        <span className="sp-link-icon" style={{ background: safeColor(section.iconBg) || 'transparent', color: safeColor(section.iconColor) || text }}>
          <Icon size={18} />
        </span>
        <span className="sp-link-title">{section.title || section.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
      </a>
    );
  }

  if (section.type === 'image') {
    const src = safeSrc(section.src);
    if (!src) return null;
    const img = <img className="sp-image" src={src} alt={section.alt || ''} loading="lazy" style={{ borderRadius: radius, ...fx }} />;
    const href = safeHref(section.url);
    return href
      ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="sp-image-link">{img}</a>
      : img;
  }

  if (section.type === 'video') return <VideoBlock section={section} radius={radius} fx={fx} theme={theme} />;

  if (section.type === 'embed') return <EmbedBlock section={section} theme={theme} username={username} />;

  return null;
}

export default function Spotlight() {
  const { t } = useTranslation();
  const { handle } = useParams();
  const username = cleanUser(String(handle || '').replace(/^@/, ''));

  const [state, setState] = useState({ loading: true, page: null, exists: false });
  const [profileName, setProfileName] = useState('');

  useEffect(() => {
    let alive = true;
    setState({ loading: true, page: null, exists: false });
    fetchSpotlight(username)
      .then((r) => { if (alive) setState({ loading: false, page: r.page, exists: r.exists }); })
      .catch(() => { if (alive) setState({ loading: false, page: null, exists: false }); });
    // Display name from Hive (avatar comes from HiveAvatar by username).
    getHiveClient().call('bridge', 'get_profile', { account: username })
      .then((p) => { if (alive) setProfileName(p?.metadata?.profile?.name || ''); })
      .catch(() => {});
    return () => { alive = false; };
  }, [username]);

  useEffect(() => {
    document.title = `@${username} • 3Speak`;
  }, [username]);

  const theme = state.page?.theme;
  const pageStyle = useMemo(() => {
    if (!theme) return {};
    // Sanitize colours + background image before they hit inline CSS (blocks remote
    // url() exfiltration from a malicious on-chain theme). Font is a whitelist lookup.
    const b = theme.bg || {};
    const safeBg = {
      ...b, color: safeColor(b.color), color2: safeColor(b.color2), image: safeSrc(b.image),
      overlayColor: safeColor(b.overlayColor), overlayColor2: safeColor(b.overlayColor2),
    };
    return {
      background: bgToCss(safeBg),
      color: safeColor(theme.text),
      fontFamily: FONT_STACK[theme.font] || 'inherit',
    };
  }, [theme]);

  if (state.loading) {
    return <div className="spotlight-page spotlight-page--plain"><div className="sp-spinner" /></div>;
  }

  const sections = state.page?.sections || [];

  return (
    <div className="spotlight-page" style={pageStyle}>
      <div className="sp-inner">
        <Link to={`/p/${username}`} className="sp-avatar" title={`@${username}`}>
          <HiveAvatar username={username} size={null} alt={`@${username}`} badgeSize={18} />
        </Link>
        <h1 className="sp-name">{profileName || `@${username}`}</h1>
        {profileName ? <div className="sp-handle">@{username}</div> : null}
        {state.page?.headline ? <p className="sp-headline">{state.page.headline}</p> : null}

        {state.exists && sections.length > 0 ? (
          <div className="sp-sections">
            {sections.map((s, i) => (
              <div key={s.id || i} className={`sp-cell${s.width === 'half' ? ' w-half' : s.width === 'third' ? ' w-third' : ''}`}>
                <Section section={s} theme={theme} username={username} />
              </div>
            ))}
          </div>
        ) : (
          <p className="sp-empty">{t('spotlight.page.empty', { user: username })}</p>
        )}

        <Link to={`/p/${username}`} className="sp-profile-link">{t('spotlight.page.viewProfile')}</Link>
        <div className="sp-brand"><Link to="/">{t('spotlight.page.poweredBy')}</Link></div>
      </div>
    </div>
  );
}
