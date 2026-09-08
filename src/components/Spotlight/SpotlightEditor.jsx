import { useEffect, useMemo, useRef, useState } from 'react';
import { toastIn } from '../../utils/toast';
import { FiTrash2, FiChevronDown, FiExternalLink, FiCopy, FiImage, FiSliders, FiZap, FiRotateCcw, FiUser, FiGrid, FiVideo } from 'react-icons/fi';
import { useAppStore } from '../../lib/store';
import { RxDragHandleDots2 } from 'react-icons/rx';
import ArrangeGrid from './ArrangeGrid';

// Server render endpoint — the preview iframe is rendered by the SAME code as the
// public page, so what you see is exactly what ships.
const RENDER_API = `${import.meta.env.VITE_THREESPEAK_API || '/api'}/spotlight/render`;
// Resolves a pasted link's preview (title/description/image) — see server unfurl route.
const UNFURL_API = `${import.meta.env.VITE_THREESPEAK_API || '/api'}/spotlight/unfurl`;
import {
  fetchSpotlight, saveSpotlight, withIds, emptyLayout, newSection,
  SECTION_TYPES, SPOTLIGHT_ICONS_GENERAL, LINK_PLATFORMS, BRAND_SLUGS, LINK_PLATFORM_BY_SLUG,
  guessIconFromUrl, FONT_OPTIONS, ANIM_TYPES,
  DEFAULT_THEME, bgToCss, layoutToRows, rowsToSections,
} from '../../utils/spotlight';
import { TEMPLATES } from '../../utils/spotlightTemplates';

// Style keys copied by "Apply to all" and shared as per-block visual settings.
const STYLE_KEYS = [
  'bg', 'text', 'bgOpacity', 'radius', 'fontScale', 'padding', 'imgSize',
  'borderWidth', 'borderColor', 'borderOpacity',
  'shadowOpacity', 'shadowX', 'shadowY', 'shadowBlur', 'shadowSpread', 'shadowColor', 'shadowInset',
  'animType', 'animSpeed', 'animLoop', 'animDur',
];
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import axios from 'axios';
import { parseEmbedUrl, timeAgo, fetchUserShortsList, bodyToPlaintext } from '../../hive-api/hiveApi';
import { getHiveClient } from '../../utils/hiveNode';
import { CHECKER_URL } from '../../utils/config';
import { isLoggedIn } from '../../hive-api/aioha';
import './SpotlightEditor.scss';

// Every toast from this module is headed "Spotlight"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Spotlight');

const uid = () => `s_${Date.now().toString(36)}_${Math.floor(performance.now())}`;

// A color <input> only does solid hex; keep whatever non-hex (rgba) value we had if
// the user doesn't touch it. `value` may be null/rgba → show a sensible hex swatch.
function ColorField({ label, value, onChange, allowClear = false }) {
  const hex = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888';
  return (
    <label className="sp-e-color">
      <span>{label}</span>
      <span className="sp-e-color-controls">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
        {allowClear && value ? (
          <button type="button" className="sp-e-clear" title="Reset to default" onClick={() => onChange(null)}>×</button>
        ) : null}
      </span>
    </label>
  );
}

function Range({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="sp-e-range"><span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="sp-e-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

// Reusable motion controls (type / speed / loop / duration) — used by blocks
// (prefix 'anim') and the avatar (prefix 'avatarAnim'). `obj` holds the *Type etc.
function MotionControls({ prefix, obj, onChange }) {
  const g = (k, d) => { const v = obj[`${prefix}${k}`]; return v === undefined ? d : v; };
  const type = g('Type', 'none');
  return (
    <>
      <label className="sp-e-select"><span>Motion</span>
        <select value={type} onChange={(e) => onChange({ [`${prefix}Type`]: e.target.value })}>
          {ANIM_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {type !== 'none' && (
        <>
          <Range label={`Speed ${g('Speed', 5)}`} min={1} max={10} value={g('Speed', 5)} onChange={(v) => onChange({ [`${prefix}Speed`]: v })} />
          <Toggle label="Loop" checked={g('Loop', true) !== false} onChange={(v) => onChange({ [`${prefix}Loop`]: v })} />
          {g('Loop', true) === false && (
            <Range label={`Run ${g('Dur', 10)}s`} min={1} max={60} value={g('Dur', 10)} onChange={(v) => onChange({ [`${prefix}Dur`]: v })} />
          )}
        </>
      )}
    </>
  );
}

// The account's most recent 3Speak videos (own root posts flagged as 3speak/video),
// for the video block's "choose from my videos" dropdown. bridge caps limit at 20.
// Recent videos for a channel. Same call the profile Videos tab uses
// (checker /api/my-videos, status:'all' + include_unlisted, axios) so the picker
// behaves identically to a source the user already sees working.
async function fetchRecentVideos(account) {
  const res = await axios.get(`${CHECKER_URL}/api/my-videos`, {
    params: {
      username: account,
      limit: 20,
      offset: 0,
      status: 'all',
      sort: 'newest',
      include_unlisted: 1,
    },
    headers: { 'Content-Type': 'application/json' },
  });
  const vids = res.data?.data?.videos || [];
  const out = [];
  for (const v of vids) {
    if (!v || !v.permlink || v.status === 'uploaded') continue; // skip incomplete uploads
    const thumb = (v.images && (v.images.thumbnail || v.images.poster)) || '';
    out.push({
      author: v.owner || v.author || account,
      permlink: v.permlink,
      title: v.title || 'Untitled',
      thumbnail: /^https?:\/\//i.test(thumb) ? thumb : '',
      created: v.created_at || v.createdAt || v.created,
    });
  }
  return out;
}

// Recent shorts for a channel, via the same helper the profile Shorts tab uses.
async function fetchRecentShorts(account) {
  const data = await fetchUserShortsList(account, 1, 20, true);
  const shorts = (data && Array.isArray(data.shorts)) ? data.shorts : [];
  const out = [];
  for (const s of shorts) {
    if (!s || !s.permlink) continue;
    const thumb = s.thumbnail_url || '';
    // Shorts rarely have a title, so use the first words of the post body — the same
    // caption the profile Shorts tab shows (bodyToPlaintext(hive_body)).
    const caption = (bodyToPlaintext(s.hive_body) || s.hive_title || s.embed_title || '').slice(0, 100).trim();
    out.push({
      author: s.owner || account,
      permlink: s.permlink,
      title: caption || 'Short',
      thumbnail: /^https?:\/\//i.test(thumb) ? thumb : '',
      created: s.createdAt || s.created,
    });
  }
  return out;
}

// Per-kind config for the media picker dropdown (videos and shorts share the UI).
const MEDIA_PICKERS = {
  video: { fetch: fetchRecentVideos, label: 'Choose from my videos', loading: 'Loading your videos…', empty: 'No recent 3Speak videos found.' },
  short: { fetch: fetchRecentShorts, label: 'Choose from my shorts', loading: 'Loading your shorts…', empty: 'No recent 3Speak shorts found.' },
};

// Thumbnail + title + "how long ago" dropdown that fills a video block on pick.
// kind picks the source: 'video' → published videos, 'short' → shorts.
function MediaPicker({ username, kind = 'video', onPick }) {
  const cfg = MEDIA_PICKERS[kind] || MEDIA_PICKERS.video;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  // Cache the username we've already loaded so reopening doesn't refetch. NOT using
  // `items`/`loading` as effect deps: setLoading(true) would re-run this effect, whose
  // cleanup flips `alive` false on the in-flight request, so the response is discarded
  // and it hangs on "Loading…" forever. Effect runs only on open/username/kind change.
  const loadedFor = useRef(null);
  useEffect(() => {
    if (!open || !username || loadedFor.current === username) return undefined;
    let alive = true;
    setLoading(true); setErr(null);
    cfg.fetch(username)
      .then((v) => { if (alive) { setItems(v); loadedFor.current = username; } })
      .catch((e) => { if (alive) { setErr(e?.message || String(e)); setItems([]); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, username, kind]);
  return (
    <div className="sp-e-vpick">
      <button type="button" className={`sp-e-vpick-btn${open ? ' open' : ''}`} onClick={() => setOpen((o) => !o)}>
        <span><FiVideo size={14} /> {cfg.label}</span>
        <FiChevronDown className="sp-e-chev" size={15} />
      </button>
      {open && (
        <div className={`sp-e-vpick-menu sp-e-vpick-menu--${kind}`}>
          {loading ? (
            <div className="sp-e-vpick-note">{cfg.loading}</div>
          ) : !username ? (
            <div className="sp-e-vpick-note">No channel detected (are you logged in?)</div>
          ) : err ? (
            <div className="sp-e-vpick-note">Couldn’t load: {err}</div>
          ) : !items || !items.length ? (
            <div className="sp-e-vpick-note">{cfg.empty} <span style={{ opacity: 0.6 }}>[@{username}]</span></div>
          ) : items.map((v) => (
            <button type="button" key={`${v.author}/${v.permlink}`} className="sp-e-vpick-item"
              onClick={() => { onPick(v); setOpen(false); }} title={v.title}>
              <span className="sp-e-vpick-tile">
                {v.thumbnail
                  ? <img src={v.thumbnail} alt="" loading="lazy" />
                  : <FiVideo className="sp-e-vpick-tile-ico" size={18} />}
              </span>
              <span className="sp-e-vpick-meta">
                <span className="sp-e-vpick-title">{v.title}</span>
                <span className="sp-e-vpick-time">{timeAgo(v.created)}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionCard({ section, onChange, onRemove, onApplyStyleToType, uploadingSet, username }) {
  const [unfurling, setUnfurling] = useState(false);
  const set = (patch) => onChange({ ...section, ...patch });

  // Fetch a link's rich preview (title/description/image) once, then store it on the
  // section so the public page renders instantly. Even on failure we keep the URL.
  const onUnfurl = async (raw) => {
    const url = (raw || '').trim();
    if (!url) { set({ url: '', title: '', description: '', image: null, siteName: '' }); return; }
    set({ url });
    setUnfurling(true);
    try {
      const res = await fetch(UNFURL_API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (data && data.url) set({ url: data.url, title: data.title || '', description: data.description || '', image: data.image || null, siteName: data.siteName || '' });
    } catch { toast.error('Could not fetch link preview'); }
    finally { setUnfurling(false); }
  };

  const onImageFile = async (file, key) => {
    if (!file) return;
    uploadingSet(section.id, true);
    try {
      const url = await uploadThumbnail(file);
      set({ [key]: url });
    } catch (e) {
      toast.error(`Image upload failed: ${e?.message || 'try again'}`);
    } finally {
      uploadingSet(section.id, false);
    }
  };

  const onVideoPaste = async (raw) => {
    const { author, permlink } = parseEmbedUrl(raw) || {};
    if (!author || !permlink) { set({ author: '', permlink: raw, isShort: false }); return; }
    set({ author: author.toLowerCase(), permlink, thumbnail: null, isShort: false });
    try {
      const post = await getHiveClient().call('bridge', 'get_post', { author, permlink });
      let jm = post?.json_metadata;
      if (typeof jm === 'string') { try { jm = JSON.parse(jm); } catch { jm = {}; } }
      // The real thumbnail lives in the post metadata (images.3speak.tv/...), NOT the
      // img.3speak.tv/{permlink} guess (which 404s).
      const thumb = (jm && Array.isArray(jm.image) && jm.image[0]) || null;
      set({ author: author.toLowerCase(), permlink, title: post?.title || '', thumbnail: thumb });
    } catch { /* best-effort */ }
  };

  const TypeIcon = (SECTION_TYPES.find((t) => t.type === section.type) || SECTION_TYPES[0]).Icon;

  return (
    <div className={`sp-e-item sp-e-item--${section.type}`}>
      <div className="sp-e-item-head">
        <span className="sp-e-type"><TypeIcon size={14} /> {section.type}</span>
        <div className="sp-e-head-actions">
          <button type="button" className="sp-e-icon-btn sp-e-danger" title="Remove" onClick={() => onRemove(section.id)}><FiTrash2 size={16} /></button>
        </div>
      </div>

      <div className="sp-e-item-body">
        {section.type === 'link' && (() => {
          const url = section.url || '';
          // A brand icon ⟹ the link is a platform link (icon fixed to that brand).
          const mode = url.startsWith('mailto:') ? 'email'
            : url.startsWith('tel:') ? 'phone'
            : BRAND_SLUGS.has(section.icon) ? `platform:${section.icon}`
            : 'url';
          const platform = mode.startsWith('platform:') ? LINK_PLATFORM_BY_SLUG.get(mode.slice(9)) : null;
          const setMode = (m) => {
            if (m === 'email') set({ url: 'mailto:', icon: 'email' });
            else if (m === 'phone') set({ url: 'tel:', icon: 'phone' });
            else if (m.startsWith('platform:')) {
              const slug = m.slice(9);
              const p = LINK_PLATFORM_BY_SLUG.get(slug);
              const cur = section.url || '';
              const prefixOnly = cur === '' || cur === 'mailto:' || cur === 'tel:' || (platform && cur === platform.base);
              set({ icon: slug, url: prefixOnly ? (p?.base || '') : cur });
            } else { // website
              const cur = section.url || '';
              set({ url: (cur === 'mailto:' || cur === 'tel:') ? '' : cur, icon: BRAND_SLUGS.has(section.icon) ? 'globe' : (section.icon || 'link') });
            }
          };
          return (
          <>
            <input className="sp-e-input" placeholder="Label (e.g. My YouTube)" value={section.title} maxLength={80}
              onChange={(e) => set({ title: e.target.value })} />
            <label className="sp-e-select"><span>Link type</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <optgroup label="Type">
                  <option value="url">Website / URL</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone</option>
                </optgroup>
                <optgroup label="Platform">
                  {LINK_PLATFORMS.map((p) => <option key={p.slug} value={`platform:${p.slug}`}>{p.label}</option>)}
                </optgroup>
              </select>
            </label>
            {mode === 'email' ? (
              <input className="sp-e-input" type="email" placeholder="you@example.com" value={url.slice(7)}
                onChange={(e) => set({ url: `mailto:${e.target.value.trim()}` })} />
            ) : mode === 'phone' ? (
              <input className="sp-e-input" type="tel" placeholder="+1 555 123 4567" value={url.slice(4)}
                onChange={(e) => set({ url: `tel:${e.target.value.replace(/[^0-9+]/g, '')}` })} />
            ) : platform ? (
              <input className="sp-e-input" placeholder={`${platform.base || 'https://…'}yourname`} value={url}
                onChange={(e) => set({ url: e.target.value })} />
            ) : (
              <input className="sp-e-input" placeholder="https://…" value={url}
                onChange={(e) => set({ url: e.target.value })}
                onBlur={(e) => { const g = guessIconFromUrl(e.target.value); if (g && !BRAND_SLUGS.has(g) && (!section.icon || section.icon === 'link')) set({ icon: g }); }} />
            )}
            {platform ? (
              <div className="sp-e-hint">Icon is the {platform.label} logo — switch to “Website / URL” to choose a custom icon.</div>
            ) : (
              <div className="sp-e-iconrow">
                <div className="sp-e-iconpicker" role="group" aria-label="Icon">
                  {SPOTLIGHT_ICONS_GENERAL.map(({ slug, Icon, label }) => (
                    <button type="button" key={slug} title={label}
                      className={`sp-e-iconopt${section.icon === slug ? ' sel' : ''}`}
                      onClick={() => set({ icon: slug })}><Icon size={16} /></button>
                  ))}
                </div>
              </div>
            )}
            <div className="sp-e-inline">
              <ColorField label="Icon color" value={section.iconColor} onChange={(v) => set({ iconColor: v })} allowClear />
              <ColorField label="Icon bg" value={section.iconBg} onChange={(v) => set({ iconBg: v })} allowClear />
            </div>
          </>
          );
        })()}

        {section.type === 'header' && (
          <>
            <input className="sp-e-input" placeholder="Text" value={section.text} maxLength={120}
              onChange={(e) => set({ text: e.target.value })} />
            <div className="sp-e-inline">
              <label className="sp-e-select"><span>Size</span>
                <select value={section.size} onChange={(e) => set({ size: e.target.value })}>
                  <option value="lg">Large</option><option value="md">Medium</option><option value="sm">Small</option>
                </select>
              </label>
              <label className="sp-e-select"><span>Align</span>
                <select value={section.align} onChange={(e) => set({ align: e.target.value })}>
                  <option value="left">Left</option><option value="center">Center</option><option value="right">Right</option>
                </select>
              </label>
            </div>
          </>
        )}

        {section.type === 'image' && (
          <>
            {section.src ? <img className="sp-e-preview-img" src={section.src} alt="" /> : null}
            <div className="sp-e-inline">
              <label className="sp-e-upload">
                <FiImage size={15} /> {uploadingSet.has(section.id) ? 'Uploading…' : 'Upload image'}
                <input type="file" accept="image/*" hidden onChange={(e) => onImageFile(e.target.files?.[0], 'src')} />
              </label>
            </div>
            <input className="sp-e-input" placeholder="…or image URL" value={section.src}
              onChange={(e) => set({ src: e.target.value })} />
            <input className="sp-e-input" placeholder="Link when clicked (optional)" value={section.url || ''}
              onChange={(e) => set({ url: e.target.value })} />
          </>
        )}

        {section.type === 'video' && (
          <>
            <div className="sp-e-vmode" role="radiogroup" aria-label="Content type">
              <label className={`sp-e-vmode-opt${!section.isShort ? ' active' : ''}`}>
                <input type="radio" name={`vmode-${section.id}`} checked={!section.isShort}
                  onChange={() => set({ isShort: false })} />
                <FiVideo size={13} /> Video
              </label>
              <label className={`sp-e-vmode-opt${section.isShort ? ' active' : ''}`}>
                <input type="radio" name={`vmode-${section.id}`} checked={!!section.isShort}
                  onChange={() => set({ isShort: true })} />
                <FiVideo size={13} /> Short
              </label>
            </div>
            <MediaPicker key={section.isShort ? 'short' : 'video'} username={username} kind={section.isShort ? 'short' : 'video'}
              onPick={(v) => set({ author: v.author, permlink: v.permlink, title: v.title, thumbnail: v.thumbnail || null, isShort: !!section.isShort })} />
            <div className="sp-e-vpick-or"><span>or paste a link</span></div>
            <input className="sp-e-input" placeholder="Paste a 3Speak video link or author/permlink"
              defaultValue={section.author && section.permlink ? `${section.author}/${section.permlink}` : ''}
              onBlur={(e) => onVideoPaste(e.target.value)} />
            {section.author && section.permlink ? (
              <>
                <div className="sp-e-videochip">
                  {section.thumbnail ? <img src={section.thumbnail} alt="" /> : null}
                  <span>{section.title || `${section.author}/${section.permlink}`}</span>
                </div>
                <input className="sp-e-input" placeholder="Title shown above the video (links to 3Speak)"
                  value={section.title || ''} onChange={(e) => set({ title: e.target.value })} />
              </>
            ) : <div className="sp-e-hint">Selected content will embed and play on your page.</div>}
          </>
        )}

        {section.type === 'embed' && (
          <>
            <label className="sp-e-select"><span>Source</span>
              <select value={section.source || 'link'} onChange={(e) => set({ source: e.target.value })}>
                <option value="link">A link (rich preview)</option>
                <option value="hive-recent">My latest Hive posts</option>
              </select>
            </label>
            {(section.source || 'link') === 'hive-recent' ? (
              <>
                <input className="sp-e-input" placeholder="Hive username (leave blank for your own)"
                  value={section.account || ''}
                  onChange={(e) => set({ account: e.target.value.trim().replace(/^@/, '').toLowerCase() })} />
                <div className="sp-e-inline">
                  <Range label={`Show ${section.count ?? 3} post${(section.count ?? 3) > 1 ? 's' : ''}`} min={1} max={6}
                    value={section.count ?? 3} onChange={(v) => set({ count: v })} />
                  <Range label={`${section.perRow ?? 1} per row`} min={1} max={3}
                    value={section.perRow ?? 1} onChange={(v) => set({ perRow: v })} />
                </div>
                <div className="sp-e-hint">Your most recent top-level posts (no reblogs or cross-posts). Updates automatically.</div>
              </>
            ) : (
              <>
                <input className="sp-e-input" placeholder="Paste any link — Hive post, Instagram, X, YouTube, article…"
                  defaultValue={section.url} onBlur={(e) => onUnfurl(e.target.value)} />
                {unfurling ? (
                  <div className="sp-e-hint">Fetching preview…</div>
                ) : (section.title || section.image || section.siteName) ? (
                  <div className="sp-e-embchip">
                    {section.image ? <img className="sp-e-embchip-img" src={section.image} alt="" /> : null}
                    <div className="sp-e-embchip-b">
                      {section.siteName ? <div className="sp-e-embchip-s">{section.siteName}</div> : null}
                      <div className="sp-e-embchip-t">{section.title || section.url}</div>
                      {section.description ? <div className="sp-e-embchip-d">{section.description}</div> : null}
                    </div>
                  </div>
                ) : section.url ? (
                  <div className="sp-e-hint">No preview found — it’ll still show as a link card.</div>
                ) : (
                  <div className="sp-e-hint">Paste a link and we’ll pull in its title, description &amp; image.</div>
                )}
              </>
            )}
          </>
        )}

        {(() => {
          const hasBg = section.type === 'link' || section.type === 'header' || section.type === 'embed' || section.type === 'video';
          const borderOn = (section.borderWidth ?? 0) > 0;
          const shadowOn = (section.shadowOpacity ?? 0) > 0;
          return (
            <div className="sp-e-style">
              <div className="sp-e-style-head">
                <div className="sp-e-glabel sp-e-glabel--sm">Style</div>
                <button type="button" className="sp-e-applyall" title={`Apply this style to every ${section.type} block`}
                  onClick={() => onApplyStyleToType(section)}>Apply to all {section.type}s</button>
              </div>
              <div className="sp-e-inline">
                {hasBg && <ColorField label="Background" value={section.bg} onChange={(v) => set({ bg: v })} allowClear />}
                {hasBg && <ColorField label="Text" value={section.text} onChange={(v) => set({ text: v })} allowClear />}
                {hasBg && section.bg && <Range label={`Background ${section.bgOpacity ?? 100}%`} min={0} max={100} value={section.bgOpacity ?? 100} onChange={(v) => set({ bgOpacity: v })} />}
                <Range label={`Radius ${section.radius ?? 16}`} min={0} max={48} value={section.radius ?? 16} onChange={(v) => set({ radius: v })} />
                {hasBg && <Range label={`Font size ${section.fontScale ?? 100}%`} min={50} max={250} value={section.fontScale ?? 100} onChange={(v) => set({ fontScale: v })} />}
                {section.type === 'link' && <Range label={`Padding ${section.padding ?? 15}px`} min={4} max={40} value={section.padding ?? 15} onChange={(v) => set({ padding: v })} />}
                {section.type === 'embed' && <Range label={`Thumbnail ${section.imgSize ?? 55}%`} min={0} max={100} value={section.imgSize ?? 55} onChange={(v) => set({ imgSize: v })} />}
              </div>

              <div className="sp-e-theme-sub">Border</div>
              <div className="sp-e-inline">
                <Range label={`Thickness ${section.borderWidth ?? 0}px`} min={0} max={12} value={section.borderWidth ?? 0} onChange={(v) => set({ borderWidth: v })} />
                {borderOn && <ColorField label="Border" value={section.borderColor ?? '#000000'} onChange={(v) => set({ borderColor: v || '#000000' })} />}
                {borderOn && <Range label={`Opacity ${section.borderOpacity ?? 100}%`} min={0} max={100} value={section.borderOpacity ?? 100} onChange={(v) => set({ borderOpacity: v })} />}
              </div>

              <div className="sp-e-theme-sub">Shadow</div>
              <div className="sp-e-inline">
                <Range label={`Strength ${section.shadowOpacity ?? 0}%`} min={0} max={100} value={section.shadowOpacity ?? 0} onChange={(v) => set({ shadowOpacity: v })} />
                {shadowOn && <ColorField label="Color" value={section.shadowColor ?? '#000000'} onChange={(v) => set({ shadowColor: v || '#000000' })} />}
                {shadowOn && <Range label={`Blur ${section.shadowBlur ?? 24}`} min={0} max={120} value={section.shadowBlur ?? 24} onChange={(v) => set({ shadowBlur: v })} />}
                {shadowOn && <Range label={`Spread ${section.shadowSpread ?? 0}`} min={-40} max={40} value={section.shadowSpread ?? 0} onChange={(v) => set({ shadowSpread: v })} />}
                {shadowOn && <Range label={`X ${section.shadowX ?? 0}`} min={-60} max={60} value={section.shadowX ?? 0} onChange={(v) => set({ shadowX: v })} />}
                {shadowOn && <Range label={`Y ${section.shadowY ?? 10}`} min={-60} max={60} value={section.shadowY ?? 10} onChange={(v) => set({ shadowY: v })} />}
                {shadowOn && <Toggle label="Inset" checked={!!section.shadowInset} onChange={(v) => set({ shadowInset: v })} />}
              </div>

              <div className="sp-e-theme-sub">Motion</div>
              <div className="sp-e-inline">
                <MotionControls prefix="anim" obj={section} onChange={(patch) => set(patch)} />
                {section.type === 'embed' && (section.source === 'hive-recent') && section.animType && section.animType !== 'none' && (
                  <Range label={`Card delay ${section.animStagger ?? 120}ms`} min={0} max={1000} step={20}
                    value={section.animStagger ?? 120} onChange={(v) => set({ animStagger: v })} />
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default function SpotlightEditor({ username }) {
  const storeUser = useAppStore((s) => s.user);
  const user = (username || storeUser || '').toLowerCase();

  const [layout, setLayout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(() => new Set());
  const [showTheme, setShowTheme] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [preTpl, setPreTpl] = useState(null);   // snapshot before a template (for Undo)
  const baseline = useRef('');
  const frameRef = useRef(null);                 // preview iframe
  const scrollRef = useRef(0);                   // preserve preview scroll across re-renders

  // Debounced iframe preview — render the CURRENT (unsaved) layout server-side so the
  // preview is pixel-identical to the public page and instant (no Hive/cache).
  useEffect(() => {
    if (!layout) return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(RENDER_API, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, displayName, layout }),
        });
        const html = await res.text();
        // Capture the preview's current scroll so re-rendering (which reloads the
        // iframe document) can restore it — editing a block near the bottom no longer
        // yanks the preview back to the top.
        try { const w = frameRef.current?.contentWindow; if (w) scrollRef.current = w.scrollY || 0; } catch { /* cross-doc */ }
        if (alive) setPreviewHtml(html);
      } catch { /* keep the last good preview */ }
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [layout, user, displayName]);

  // Display name for the preview header (best-effort, matches the public page).
  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    getHiveClient().call('bridge', 'get_profile', { account: user })
      .then((p) => { if (alive) setDisplayName(p?.metadata?.profile?.name || ''); })
      .catch(() => {});
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchSpotlight(user)
      .then((r) => {
        if (!alive) return;
        const l = r.exists && r.page ? withIds(r.page) : emptyLayout();
        setLayout(l);
        baseline.current = JSON.stringify(l);
        setDirty(false);
        // New page (no Spotlight yet) → open the template gallery to get them started.
        setShowTemplates(!r.exists);
      })
      .catch(() => { if (alive) { setLayout(emptyLayout()); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [user]);

  const markDirty = (next) => { setLayout(next); setDirty(JSON.stringify(next) !== baseline.current); };

  const uploadingApi = useMemo(() => {
    const fn = (id, on) => setUploading((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
    fn.has = (id) => uploading.has(id);
    return fn;
  }, [uploading]);

  if (loading || !layout) return <div className="sp-e-loading"><div className="sp-e-spin" /></div>;

  const { theme, sections, headline } = layout;
  const selectedSection = sections.find((s) => s.id === selectedId) || null;
  const setTheme = (patch) => markDirty({ ...layout, theme: { ...theme, ...patch } });
  const setBg = (patch) => markDirty({ ...layout, theme: { ...theme, bg: { ...theme.bg, ...patch } } });

  // A newly added block inherits the visual style (background / border / shadow / font
  // / anim) already in use — each setting taken from the most recent block that has it
  // (preferring the same type, falling back to any block), so e.g. the background color
  // is picked up even if it lives on a block of a different type.
  const inheritedStyle = (type) => {
    const out = {};
    const recent = [...sections].reverse();
    for (const k of STYLE_KEYS) {
      const src = recent.find((s) => s.type === type && s[k] !== undefined)
               || recent.find((s) => s[k] !== undefined);
      if (src) out[k] = src[k];
    }
    return out;
  };
  const newBlock = (type) => ({ ...newSection(type), ...inheritedStyle(type), id: uid() });

  const addSection = (type) => markDirty({ ...layout, sections: [...sections, newBlock(type)] });
  const changeSection = (next) => markDirty({ ...layout, sections: sections.map((s) => (s.id === next.id ? next : s)) });
  // Re-normalise widths after a delete so a row-mate of a removed half/third
  // reflows to fill the row (otherwise it'd keep its old width + leave a gap).
  const removeSection = (id) => markDirty({ ...layout, sections: rowsToSections(layoutToRows(sections.filter((s) => s.id !== id))) });

  // Copy one block's visual style onto every block of the same type (they end up
  // identical in style — keys absent on the source are cleared on the others too).
  const applyStyleToType = (src) => {
    markDirty({
      ...layout,
      sections: sections.map((s) => {
        if (s.type !== src.type) return s;
        const copy = { ...s };
        for (const k of STYLE_KEYS) { if (src[k] !== undefined) copy[k] = src[k]; else delete copy[k]; }
        return copy;
      }),
    });
    toast.success(`Style applied to all ${src.type} blocks`);
  };

  // Templates: apply the theme + starter blocks. Non-destructive — the pre-template
  // layout is snapshotted once so it can be restored with Undo (nothing is saved
  // on-chain until the user hits Save, so their real page is never touched).
  const applyTemplate = (tpl) => {
    setPreTpl((prev) => (prev ?? layout));
    markDirty(withIds({
      headline: layout.headline || '',
      theme: { ...DEFAULT_THEME, ...tpl.theme, bg: { ...DEFAULT_THEME.bg, ...(tpl.theme.bg || {}) } },
      sections: tpl.sections.map((s) => ({ ...s })),
    }));
    setSelectedId(null);
    toast.success(`“${tpl.name}” applied — tweak or Undo`);
  };
  const undoTemplate = () => {
    if (!preTpl) return;
    markDirty(preTpl);
    setPreTpl(null);
    setSelectedId(null);
    toast('Reverted to your previous design');
  };

  const publicUrl = `${window.location.origin}/links/${user}`;

  const save = async () => {
    if (!isLoggedIn()) { toast.error('Please log in first'); return; }
    setSaving(true);
    try {
      // Stored on-chain in posting_json_metadata via posting auth (delegated through
      // @threespeak for most logins → no signing popup; wallet logins use the SIWH
      // session). Same mechanism as the interests picker.
      const saved = await saveSpotlight(user, layout);
      const l = withIds(saved);
      setLayout(l);
      baseline.current = JSON.stringify(l);
      setDirty(false);
      setPreTpl(null);
      toast.success('Spotlight saved to your Hive profile');
    } catch (e) {
      toast.error(e?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="spotlight-editor">
      <div className="sp-e-top">
        <div className="sp-e-brand">
          <span className="sp-e-brand-icon"><FiZap size={20} /></span>
          <span className="sp-e-brand-text">
            <span className="sp-e-brand-title">Spotlight</span>
            <span className="sp-e-brand-sub">Your links & videos on one page</span>
          </span>
        </div>
        <div className="sp-e-top-actions">
          <div className="sp-e-url">
            <span className="sp-e-url-text" title={publicUrl}>/links/{user}</span>
            <button type="button" className="sp-e-icon-btn" title="Copy link"
              onClick={() => { navigator.clipboard?.writeText(publicUrl); toast.success('Link copied'); }}><FiCopy size={15} /></button>
            <a className="sp-e-icon-btn" href={`/links/${user}`} target="_blank" rel="noreferrer" title="Open page"><FiExternalLink size={15} /></a>
          </div>
          <button type="button" className={`sp-e-save${dirty ? ' dirty' : ''}`} onClick={save} disabled={saving || !dirty}>
            {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="sp-e-body">
      <div className="sp-e-controls">

      {/* Templates — one-click designs (theme + starter blocks); Undo restores. Shown
          first, and open by default for a brand-new page. */}
      <button type="button" className={`sp-e-theme-toggle${showTemplates ? ' open' : ''}`} onClick={() => setShowTemplates((v) => !v)}>
        <span className="sp-e-tt-l"><FiGrid size={15} /> Templates</span><FiChevronDown className="sp-e-chev" size={16} />
      </button>
      {showTemplates && (
        <div className="sp-e-theme sp-e-tpls-wrap">
          <div className="sp-e-hint">Pick a design to fill everything in — your bio is kept, and you can Undo.</div>
          <div className="sp-e-tpls">
            {TEMPLATES.map((t) => (
              <button type="button" key={t.id} className="sp-e-tpl" title={`${t.name} · ${t.niche}`}
                style={{ background: bgToCss(t.theme.bg) }} onClick={() => applyTemplate(t)}>
                <span className="sp-e-tpl-emoji">{t.emoji}</span>
                <span className="sp-e-tpl-meta">
                  <span className="sp-e-tpl-name">{t.name}</span>
                  <span className="sp-e-tpl-niche">{t.niche}</span>
                </span>
              </button>
            ))}
          </div>
          {preTpl && (
            <button type="button" className="sp-e-tpl-undo" onClick={undoTemplate}><FiRotateCcw size={14} /> Undo template — back to my design</button>
          )}
        </div>
      )}

      {/* Profile — bio, avatar & the always-present channel button, front and centre. */}
      <div className="sp-e-glabel"><FiUser size={13} /> Profile</div>
      <div className="sp-e-profile">
        <input className="sp-e-headline" placeholder="A short headline / bio (optional)" value={headline} maxLength={200}
          onChange={(e) => markDirty({ ...layout, headline: e.target.value })} />
        <div className="sp-e-inline">
          <Range label={`Avatar size ${theme.avatarPct ?? 100}%`} min={40} max={250} value={theme.avatarPct ?? 100} onChange={(v) => setTheme({ avatarPct: v })} />
          <Range label={`Avatar shadow ${theme.avatarShadow ?? 30}%`} min={0} max={100} value={theme.avatarShadow ?? 30} onChange={(v) => setTheme({ avatarShadow: v })} />
          <ColorField label="Avatar glow" value={theme.avatarGlow} onChange={(v) => setTheme({ avatarGlow: v })} allowClear />
          {theme.avatarGlow && <Range label={`Glow size ${theme.avatarGlowSize ?? 24}`} min={0} max={80} value={theme.avatarGlowSize ?? 24} onChange={(v) => setTheme({ avatarGlowSize: v })} />}
        </div>
        <div className="sp-e-inline">
          <MotionControls prefix="avatarAnim" obj={theme} onChange={(patch) => setTheme(patch)} />
        </div>
        <label className="sp-e-field"><span>Channel button text</span>
          <input className="sp-e-input" placeholder="Open my Channel on 3Speak" maxLength={60}
            value={theme.footerText ?? ''} onChange={(e) => setTheme({ footerText: e.target.value })} />
        </label>
      </div>

      {/* Page style */}
      <button type="button" className={`sp-e-theme-toggle${showTheme ? ' open' : ''}`} onClick={() => setShowTheme((v) => !v)}>
        <span className="sp-e-tt-l"><FiSliders size={15} /> Page style</span><FiChevronDown className="sp-e-chev" size={16} />
      </button>
      {showTheme && (
        <div className="sp-e-theme">
          <div className="sp-e-theme-sub">Background</div>
          <div className="sp-e-inline">
            <label className="sp-e-select"><span>Background</span>
              <select value={theme.bg.type} onChange={(e) => setBg({ type: e.target.value })}>
                <option value="color">Solid</option><option value="gradient">Gradient</option><option value="image">Image</option>
              </select>
            </label>
            {theme.bg.type !== 'image' && <ColorField label="Color" value={theme.bg.color} onChange={(v) => setBg({ color: v })} />}
            {theme.bg.type === 'gradient' && <ColorField label="Color 2" value={theme.bg.color2} onChange={(v) => setBg({ color2: v })} />}
          </div>
          {theme.bg.type === 'gradient' && (
            <label className="sp-e-range"><span>Angle {theme.bg.angle}°</span>
              <input type="range" min="0" max="360" value={theme.bg.angle} onChange={(e) => setBg({ angle: Number(e.target.value) })} />
            </label>
          )}
          {theme.bg.type === 'image' && (
            <>
              <div className="sp-e-inline">
                <label className="sp-e-upload">
                  <FiImage size={15} /> Upload background
                  <input type="file" accept="image/*" hidden onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    try { const url = await uploadThumbnail(f); setBg({ image: url }); } catch { toast.error('Upload failed'); }
                  }} />
                </label>
                {theme.bg.image ? <span className="sp-e-hint">Image set ✓</span> : null}
              </div>
              {/* Overlay tint/gradient over the image for readability. */}
              <div className="sp-e-inline">
                <label className="sp-e-select"><span>Overlay</span>
                  <select value={theme.bg.overlayType || 'none'} onChange={(e) => setBg({ overlayType: e.target.value })}>
                    <option value="none">None</option><option value="color">Color</option><option value="gradient">Gradient</option>
                  </select>
                </label>
                {theme.bg.overlayType && theme.bg.overlayType !== 'none' && (
                  <ColorField label="Overlay" value={theme.bg.overlayColor} onChange={(v) => setBg({ overlayColor: v })} />
                )}
                {theme.bg.overlayType === 'gradient' && (
                  <ColorField label="Overlay 2" value={theme.bg.overlayColor2} onChange={(v) => setBg({ overlayColor2: v })} />
                )}
              </div>
              {theme.bg.overlayType && theme.bg.overlayType !== 'none' && (
                <div className="sp-e-inline">
                  <label className="sp-e-range"><span>Overlay opacity {theme.bg.overlayOpacity ?? 45}%</span>
                    <input type="range" min="0" max="100" value={theme.bg.overlayOpacity ?? 45} onChange={(e) => setBg({ overlayOpacity: Number(e.target.value) })} />
                  </label>
                  {theme.bg.overlayType === 'gradient' && (
                    <label className="sp-e-range"><span>Overlay angle {theme.bg.overlayAngle ?? 160}°</span>
                      <input type="range" min="0" max="360" value={theme.bg.overlayAngle ?? 160} onChange={(e) => setBg({ overlayAngle: Number(e.target.value) })} />
                    </label>
                  )}
                </div>
              )}
            </>
          )}
          <div className="sp-e-theme-sub">Colors</div>
          <div className="sp-e-inline">
            <ColorField label="Text" value={theme.text} onChange={(v) => setTheme({ text: v })} />
            <ColorField label="Button bg" value={theme.sectionBg} onChange={(v) => setTheme({ sectionBg: v })} />
            <ColorField label="Button text" value={theme.sectionText} onChange={(v) => setTheme({ sectionText: v })} />
          </div>
          <div className="sp-e-theme-sub">Buttons</div>
          <div className="sp-e-inline">
            <label className="sp-e-select"><span>Button style</span>
              <select value={theme.buttonStyle} onChange={(e) => setTheme({ buttonStyle: e.target.value })}>
                <option value="soft">Soft</option><option value="fill">Fill</option><option value="outline">Outline</option>
              </select>
            </label>
            <Range label={`Corner radius ${theme.radius}`} min={0} max={48} value={theme.radius} onChange={(v) => setTheme({ radius: v })} />
          </div>

          {/* Global text styling — applies to the name, bio and every text block. */}
          <div className="sp-e-theme-sub">Text style (name, bio &amp; text blocks)</div>
          <div className="sp-e-inline">
            <label className="sp-e-select"><span>Font</span>
              <select value={theme.font} onChange={(e) => setTheme({ font: e.target.value })}>
                {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="sp-e-select"><span>Style</span>
              <select value={theme.fontStyle || 'normal'} onChange={(e) => setTheme({ fontStyle: e.target.value })}>
                <option value="normal">Normal</option><option value="italic">Italic</option>
                <option value="bold">Bold</option><option value="bolditalic">Bold Italic</option>
              </select>
            </label>
            <label className="sp-e-select"><span>Shadow</span>
              <select value={theme.textShadow || 'none'} onChange={(e) => setTheme({ textShadow: e.target.value })}>
                <option value="none">None</option><option value="soft">Soft</option><option value="strong">Strong</option>
              </select>
            </label>
          </div>
          <div className="sp-e-inline">
            <label className="sp-e-range"><span>Font size {theme.fontScale ?? 100}%</span>
              <input type="range" min="60" max="160" value={theme.fontScale ?? 100} onChange={(e) => setTheme({ fontScale: Number(e.target.value) })} />
            </label>
            <label className="sp-e-range"><span>Text border {theme.textStroke || 0}px</span>
              <input type="range" min="0" max="3" value={theme.textStroke || 0} onChange={(e) => setTheme({ textStroke: Number(e.target.value) })} />
            </label>
            {(theme.textStroke || 0) > 0 && <ColorField label="Border color" value={theme.textStrokeColor} onChange={(v) => setTheme({ textStrokeColor: v || '#000000' })} />}
          </div>
        </div>
      )}

      {/* Add */}
      <div className="sp-e-glabel">Add a block</div>
      <div className="sp-e-add">
        {SECTION_TYPES.map(({ type, label, Icon }) => (
          <button type="button" key={type} onClick={() => { const s = newBlock(type); markDirty({ ...layout, sections: [...sections, s] }); setSelectedId(s.id); }}><Icon size={15} /> {label}</button>
        ))}
      </div>

      {/* Arrange: drag a block's grip onto another to share a row (auto-size), or onto
          a line between rows for a new row. Click a block to edit its content below. */}
      {sections.length === 0 ? (
        <div className="sp-e-empty">Add your first link, video or image above.</div>
      ) : (
        <>
          <div className="sp-e-arrange-hint">Drag <RxDragHandleDots2 size={13} /> to arrange · drop a block onto another to put them side by side · click a block to edit it right here</div>
          <ArrangeGrid
            sections={sections}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onChange={(next) => markDirty({ ...layout, sections: next })}
            editor={selectedSection ? (
              <SectionCard key={selectedSection.id} section={selectedSection}
                onChange={changeSection}
                onRemove={(id) => { removeSection(id); setSelectedId(null); }}
                onApplyStyleToType={applyStyleToType}
                uploadingSet={uploadingApi}
                username={user} />
            ) : null}
          />
        </>
      )}

      </div>{/* /sp-e-controls */}

      {/* Live preview — an iframe rendered by the SAME server code as the public page. */}
      <div className="sp-e-side">
        <div className="sp-e-preview-label"><span className="sp-e-live-dot" /> Live preview</div>
        <div className="sp-e-preview-device">
          <div className="sp-e-preview-bar">
            <span className="sp-e-dot" /><span className="sp-e-dot" /><span className="sp-e-dot" />
            <span className="sp-e-preview-url">3speak.tv/links/{user}</span>
          </div>
          <iframe ref={frameRef} className="sp-e-preview-frame" title="Spotlight preview" srcDoc={previewHtml}
            onLoad={() => { try { const w = frameRef.current?.contentWindow; if (w && scrollRef.current) w.scrollTo(0, scrollRef.current); } catch { /* cross-doc */ } }} />
        </div>
      </div>
      </div>{/* /sp-e-body */}
    </div>
  );
}
