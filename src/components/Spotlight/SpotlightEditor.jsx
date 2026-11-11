import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation, Trans } from 'react-i18next';
import { toastIn } from '../../utils/toast';
import { useAppStore } from '../../lib/store';
import { Icon } from '../v2/Icon';
import { Button, IconButton, Segmented, Checkbox, EmptyState } from '../v2/ui';
import { cx } from '../v2/helpers';
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
import { shortHeading } from '../../utils/shortTitle';

// Every toast from this module is headed "Spotlight"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Spotlight');

const uid = () => `s_${Date.now().toString(36)}_${Math.floor(performance.now())}`;

// Colours the creator picks for THEIR page are data, stored as #rrggbb (the
// native colour input and the page renderer both read hex). These two are the
// defaults written into that data, not app styling.
const hexOf = (n) => `#${n.toString(16).padStart(6, '0')}`;
const DEFAULT_INK = hexOf(0x000000);   // border / shadow / text-border colour
const NEUTRAL_SWATCH = hexOf(0x888888); // shown when a value is rgba or unset

// Material Symbols for each block type (the app chrome). The link icons a
// creator picks for their page stay the brand logos the page renders.
const TYPE_ICON = { link: 'link', video: 'smart_display', embed: 'article', image: 'image', header: 'title' };

// A color <input> only does solid hex; keep whatever non-hex (rgba) value we had if
// the user doesn't touch it. `value` may be null/rgba → show a sensible hex swatch.
function ColorField({ label, value, onChange, allowClear = false }) {
  const { t } = useTranslation();
  const hex = typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : NEUTRAL_SWATCH;
  return (
    <label className="sp-e-color">
      <span className="v2-eyebrow">{label}</span>
      <span className="sp-e-color-controls">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
        {allowClear && value ? (
          <IconButton icon="close" size={28} variant="ghost" className="sp-e-clear" label={t('spotlight.editor.resetToDefault')} onClick={() => onChange(null)} />
        ) : null}
      </span>
    </label>
  );
}

function Range({ label, value, min, max, step = 1, onChange }) {
  return (
    <label className="v2-slider sp-e-range">
      <span className="v2-slider__head"><span>{label}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return <Checkbox className="sp-e-toggle" label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />;
}

// A labelled <select> in the v2 field look (eyebrow label, filled control).
function SelectField({ label, value, onChange, children, className, hideLabel }) {
  return (
    <label className={cx('v2-field sp-e-select', className)}>
      <span className={cx('v2-eyebrow', hideLabel && 'sp-e-sr')}>{label}</span>
      <select className="v2-input is-select" value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

// An eyebrow label over any control (Segmented tracks have no label of their own).
function Labeled({ label, children, className }) {
  return (
    <div className={cx('v2-field sp-e-labeled', className)}>
      <span className="v2-eyebrow">{label}</span>
      {children}
    </div>
  );
}

// A collapsible card: the whole head toggles the body.
function FoldCard({ icon, title, open, onToggle, children, className }) {
  return (
    <section className={cx('v2-card sp-e-card sp-e-fold', open && 'is-open', className)}>
      <button type="button" className="sp-e-fold-head" aria-expanded={open} onClick={onToggle}>
        <Icon name={icon} size={18} className="sp-e-fold-ic" />
        <b>{title}</b>
        <Icon name="expand_more" size={20} className="sp-e-chev" />
      </button>
      {open && <div className="sp-e-fold-body">{children}</div>}
    </section>
  );
}

// Reusable motion controls (type / speed / loop / duration) — used by blocks
// (prefix 'anim') and the avatar (prefix 'avatarAnim'). `obj` holds the *Type etc.
function MotionControls({ prefix, obj, onChange, hideLabel }) {
  const g = (k, d) => { const v = obj[`${prefix}${k}`]; return v === undefined ? d : v; };
  const { t } = useTranslation();
  const type = g('Type', 'none');
  return (
    <>
      <SelectField label={t('spotlight.editor.motion')} hideLabel={hideLabel} value={type} onChange={(v) => onChange({ [`${prefix}Type`]: v })}>
        {ANIM_TYPES.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
      </SelectField>
      {type !== 'none' && (
        <>
          <Range label={t('spotlight.editor.speed', { value: g('Speed', 5) })} min={1} max={10} value={g('Speed', 5)} onChange={(v) => onChange({ [`${prefix}Speed`]: v })} />
          <Toggle label={t('spotlight.editor.loop')} checked={g('Loop', true) !== false} onChange={(v) => onChange({ [`${prefix}Loop`]: v })} />
          {g('Loop', true) === false && (
            <Range label={t('spotlight.editor.runSeconds', { value: g('Dur', 10) })} min={1} max={60} value={g('Dur', 10)} onChange={(v) => onChange({ [`${prefix}Dur`]: v })} />
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
    // The creator's `## Title` first line wins (utils/shortTitle.js).
    const caption = (shortHeading(s.hive_body) || bodyToPlaintext(s.hive_body) || s.hive_title || s.embed_title || '').slice(0, 100).trim();
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
  video: { fetch: fetchRecentVideos, labelKey: 'spotlight.editor.picker.videoLabel', loadingKey: 'spotlight.editor.picker.videoLoading', emptyKey: 'spotlight.editor.picker.videoEmpty' },
  short: { fetch: fetchRecentShorts, labelKey: 'spotlight.editor.picker.shortLabel', loadingKey: 'spotlight.editor.picker.shortLoading', emptyKey: 'spotlight.editor.picker.shortEmpty' },
};

// Thumbnail + title + "how long ago" dropdown that fills a video block on pick.
// kind picks the source: 'video' → published videos, 'short' → shorts.
function MediaPicker({ username, kind = 'video', onPick }) {
  const { t } = useTranslation();
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
      <button type="button" className={`sp-e-vpick-btn${open ? ' open' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span><Icon name={kind === 'short' ? 'smartphone' : 'smart_display'} size={18} /> {t(cfg.labelKey)}</span>
        <Icon name="expand_more" className="sp-e-chev" size={20} />
      </button>
      {open && (
        <div className={`sp-e-vpick-menu sp-e-vpick-menu--${kind}`}>
          {loading ? (
            <div className="sp-e-vpick-note">{t(cfg.loadingKey)}</div>
          ) : !username ? (
            <div className="sp-e-vpick-note">{t('spotlight.editor.picker.noChannel')}</div>
          ) : err ? (
            <div className="sp-e-vpick-note">{t('spotlight.editor.picker.loadFailed', { error: err })}</div>
          ) : !items || !items.length ? (
            <div className="sp-e-vpick-note">{t(cfg.emptyKey)} <span className="sp-e-vpick-who">[@{username}]</span></div>
          ) : items.map((v) => (
            <button type="button" key={`${v.author}/${v.permlink}`} className="sp-e-vpick-item"
              onClick={() => { onPick(v); setOpen(false); }} title={v.title}>
              <span className="sp-e-vpick-tile">
                {v.thumbnail
                  ? <img src={v.thumbnail} alt="" loading="lazy" />
                  : <Icon name={kind === 'short' ? 'smartphone' : 'smart_display'} className="sp-e-vpick-tile-ico" size={20} />}
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
  const { t } = useTranslation();
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
    } catch { toast.error(t('spotlight.editor.toasts.unfurlFailed')); }
    finally { setUnfurling(false); }
  };

  const onImageFile = async (file, key) => {
    if (!file) return;
    uploadingSet(section.id, true);
    try {
      const url = await uploadThumbnail(file);
      set({ [key]: url });
    } catch (e) {
      toast.error(t('spotlight.editor.toasts.imageUploadFailed', { error: e?.message || t('spotlight.editor.toasts.tryAgain') }));
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

  return (
    <div className={`v2-card sp-e-item sp-e-item--${section.type}`}>
      <div className="sp-e-item-head">
        <span className="sp-e-type-ic"><Icon name={TYPE_ICON[section.type] || 'link'} size={18} /></span>
        <b className="sp-e-type">{t(`spotlight.sectionTypes.${section.type}`, { defaultValue: section.type })}</b>
        <IconButton icon="delete" size={32} variant="ghost" className="sp-e-danger" label={t('common.actions.remove')} onClick={() => onRemove(section.id)} />
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
            <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.link.labelPlaceholder')} value={section.title} maxLength={80}
              onChange={(e) => set({ title: e.target.value })} />
            <div className="sp-e-pair">
            <SelectField label={t('spotlight.editor.link.type')} value={mode} onChange={setMode}>
              <optgroup label={t('spotlight.editor.link.typeGroup')}>
                <option value="url">{t('spotlight.editor.link.website')}</option>
                <option value="email">{t('spotlight.editor.link.email')}</option>
                <option value="phone">{t('spotlight.editor.link.phone')}</option>
              </optgroup>
              <optgroup label={t('spotlight.editor.link.platformGroup')}>
                {LINK_PLATFORMS.map((p) => <option key={p.slug} value={`platform:${p.slug}`}>{p.label}</option>)}
              </optgroup>
            </SelectField>
            {mode === 'email' ? (
              <input className="v2-input sp-e-input" type="email" placeholder="you@example.com" value={url.slice(7)}
                onChange={(e) => set({ url: `mailto:${e.target.value.trim()}` })} />
            ) : mode === 'phone' ? (
              <input className="v2-input sp-e-input" type="tel" placeholder="+1 555 123 4567" value={url.slice(4)}
                onChange={(e) => set({ url: `tel:${e.target.value.replace(/[^0-9+]/g, '')}` })} />
            ) : platform ? (
              <input className="v2-input sp-e-input" placeholder={`${platform.base || 'https://…'}${t('spotlight.editor.link.yourname')}`} value={url}
                onChange={(e) => set({ url: e.target.value })} />
            ) : (
              <input className="v2-input sp-e-input" placeholder="https://…" value={url}
                onChange={(e) => set({ url: e.target.value })}
                onBlur={(e) => { const g = guessIconFromUrl(e.target.value); if (g && !BRAND_SLUGS.has(g) && (!section.icon || section.icon === 'link')) set({ icon: g }); }} />
            )}
            </div>
            {platform ? (
              <div className="sp-e-hint">{t('spotlight.editor.link.platformIconHint', { platform: platform.label })}</div>
            ) : (
              <div className="sp-e-iconrow">
                <div className="sp-e-iconpicker" role="group" aria-label={t('spotlight.editor.link.icon')}>
                  {SPOTLIGHT_ICONS_GENERAL.map(({ slug, Icon, labelKey }) => (
                    <button type="button" key={slug} title={t(labelKey)}
                      className={`sp-e-iconopt${section.icon === slug ? ' sel' : ''}`}
                      onClick={() => set({ icon: slug })}><Icon size={16} /></button>
                  ))}
                </div>
              </div>
            )}
            <div className="sp-e-inline">
              <ColorField label={t('spotlight.editor.link.iconColor')} value={section.iconColor} onChange={(v) => set({ iconColor: v })} allowClear />
              <ColorField label={t('spotlight.editor.link.iconBg')} value={section.iconBg} onChange={(v) => set({ iconBg: v })} allowClear />
            </div>
          </>
          );
        })()}

        {section.type === 'header' && (
          <>
            <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.header.text')} value={section.text} maxLength={120}
              onChange={(e) => set({ text: e.target.value })} />
            <div className="sp-e-pair">
              <Labeled label={t('spotlight.editor.header.size')}>
                <Segmented size={32} label={t('spotlight.editor.header.size')} value={section.size} onChange={(v) => set({ size: v })}
                  options={[{ value: 'lg', label: t('spotlight.editor.header.large') }, { value: 'md', label: t('spotlight.editor.header.medium') }, { value: 'sm', label: t('spotlight.editor.header.small') }]} />
              </Labeled>
              <Labeled label={t('spotlight.editor.header.align')}>
                <Segmented size={32} label={t('spotlight.editor.header.align')} value={section.align} onChange={(v) => set({ align: v })}
                  options={[{ value: 'left', label: t('spotlight.editor.header.left') }, { value: 'center', label: t('spotlight.editor.header.center') }, { value: 'right', label: t('spotlight.editor.header.right') }]} />
              </Labeled>
            </div>
          </>
        )}

        {section.type === 'image' && (
          <>
            {section.src ? <img className="sp-e-preview-img" src={section.src} alt="" /> : null}
            <div className="sp-e-inline">
              <label className="v2-btn v2-btn--secondary h36 sp-e-upload">
                <Icon name={uploadingSet.has(section.id) ? 'progress_activity' : 'upload'} size={18} className={uploadingSet.has(section.id) ? 'v2-spin' : ''} />
                {uploadingSet.has(section.id) ? t('spotlight.editor.image.uploading') : t('spotlight.editor.image.upload')}
                <input type="file" accept="image/*" hidden onChange={(e) => onImageFile(e.target.files?.[0], 'src')} />
              </label>
            </div>
            <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.image.urlPlaceholder')} value={section.src}
              onChange={(e) => set({ src: e.target.value })} />
            <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.image.linkPlaceholder')} value={section.url || ''}
              onChange={(e) => set({ url: e.target.value })} />
          </>
        )}

        {section.type === 'video' && (
          <>
            <div className="v2-seg is-block sp-e-vmode" role="radiogroup" aria-label={t('spotlight.editor.video.contentType')}>
              <label className={cx('v2-seg__opt h32 sp-e-vmode-opt', !section.isShort && 'is-on active')}>
                <input type="radio" name={`vmode-${section.id}`} checked={!section.isShort}
                  onChange={() => set({ isShort: false })} />
                <Icon name="smart_display" size={16} /> {t('spotlight.editor.video.video')}
              </label>
              <label className={cx('v2-seg__opt h32 sp-e-vmode-opt', section.isShort && 'is-on active')}>
                <input type="radio" name={`vmode-${section.id}`} checked={!!section.isShort}
                  onChange={() => set({ isShort: true })} />
                <Icon name="smartphone" size={16} /> {t('spotlight.editor.video.short')}
              </label>
            </div>
            <MediaPicker key={section.isShort ? 'short' : 'video'} username={username} kind={section.isShort ? 'short' : 'video'}
              onPick={(v) => set({ author: v.author, permlink: v.permlink, title: v.title, thumbnail: v.thumbnail || null, isShort: !!section.isShort })} />
            <div className="sp-e-vpick-or"><span>{t('spotlight.editor.video.orPaste')}</span></div>
            <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.video.pastePlaceholder')}
              defaultValue={section.author && section.permlink ? `${section.author}/${section.permlink}` : ''}
              onBlur={(e) => onVideoPaste(e.target.value)} />
            {section.author && section.permlink ? (
              <>
                <div className="sp-e-videochip">
                  {section.thumbnail ? <img src={section.thumbnail} alt="" /> : null}
                  <span>{section.title || `${section.author}/${section.permlink}`}</span>
                </div>
                <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.video.titlePlaceholder')}
                  value={section.title || ''} onChange={(e) => set({ title: e.target.value })} />
              </>
            ) : <div className="sp-e-hint">{t('spotlight.editor.video.hint')}</div>}
          </>
        )}

        {section.type === 'embed' && (
          <>
            <SelectField label={t('spotlight.editor.embed.source')} value={section.source || 'link'} onChange={(v) => set({ source: v })}>
              <option value="link">{t('spotlight.editor.embed.sourceLink')}</option>
              <option value="hive-recent">{t('spotlight.editor.embed.sourceHiveRecent')}</option>
            </SelectField>
            {(section.source || 'link') === 'hive-recent' ? (
              <>
                <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.embed.accountPlaceholder')}
                  value={section.account || ''}
                  onChange={(e) => set({ account: e.target.value.trim().replace(/^@/, '').toLowerCase() })} />
                <div className="sp-e-inline">
                  <Range label={t('spotlight.editor.embed.showPosts', { count: section.count ?? 3 })} min={1} max={6}
                    value={section.count ?? 3} onChange={(v) => set({ count: v })} />
                  <Range label={t('spotlight.editor.embed.perRow', { value: section.perRow ?? 1 })} min={1} max={3}
                    value={section.perRow ?? 1} onChange={(v) => set({ perRow: v })} />
                </div>
                <div className="sp-e-hint">{t('spotlight.editor.embed.hiveRecentHint')}</div>
              </>
            ) : (
              <>
                <input className="v2-input sp-e-input" placeholder={t('spotlight.editor.embed.linkPlaceholder')}
                  defaultValue={section.url} onBlur={(e) => onUnfurl(e.target.value)} />
                {unfurling ? (
                  <div className="sp-e-hint">{t('spotlight.editor.embed.fetching')}</div>
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
                  <div className="sp-e-hint">{t('spotlight.editor.embed.noPreview')}</div>
                ) : (
                  <div className="sp-e-hint">{t('spotlight.editor.embed.pasteHint')}</div>
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
                <b>{t('spotlight.editor.style.title')}</b>
                <button type="button" className="sp-e-applyall" title={t('spotlight.editor.style.applyAllTitle', { type: t(`spotlight.blockNames.${section.type}`, { defaultValue: section.type }) })}
                  onClick={() => onApplyStyleToType(section)}>{t('spotlight.editor.style.applyAll', { types: t(`spotlight.blockNamesPlural.${section.type}`, { defaultValue: `${section.type}s` }) })}</button>
              </div>
              <div className="sp-e-inline">
                {hasBg && <ColorField label={t('spotlight.editor.style.background')} value={section.bg} onChange={(v) => set({ bg: v })} allowClear />}
                {hasBg && <ColorField label={t('spotlight.editor.style.text')} value={section.text} onChange={(v) => set({ text: v })} allowClear />}
                {hasBg && section.bg && <Range label={t('spotlight.editor.style.backgroundPct', { value: section.bgOpacity ?? 100 })} min={0} max={100} value={section.bgOpacity ?? 100} onChange={(v) => set({ bgOpacity: v })} />}
                <Range label={t('spotlight.editor.style.radius', { value: section.radius ?? 16 })} min={0} max={48} value={section.radius ?? 16} onChange={(v) => set({ radius: v })} />
                {hasBg && <Range label={t('spotlight.editor.style.fontSizePct', { value: section.fontScale ?? 100 })} min={50} max={250} value={section.fontScale ?? 100} onChange={(v) => set({ fontScale: v })} />}
                {section.type === 'link' && <Range label={t('spotlight.editor.style.paddingPx', { value: section.padding ?? 15 })} min={4} max={40} value={section.padding ?? 15} onChange={(v) => set({ padding: v })} />}
                {section.type === 'embed' && <Range label={t('spotlight.editor.style.thumbnailPct', { value: section.imgSize ?? 55 })} min={0} max={100} value={section.imgSize ?? 55} onChange={(v) => set({ imgSize: v })} />}
              </div>

              <div className="sp-e-theme-sub">{t('spotlight.editor.style.border')}</div>
              <div className="sp-e-inline">
                <Range label={t('spotlight.editor.style.thicknessPx', { value: section.borderWidth ?? 0 })} min={0} max={12} value={section.borderWidth ?? 0} onChange={(v) => set({ borderWidth: v })} />
                {borderOn && <ColorField label={t('spotlight.editor.style.border')} value={section.borderColor ?? DEFAULT_INK} onChange={(v) => set({ borderColor: v || DEFAULT_INK })} />}
                {borderOn && <Range label={t('spotlight.editor.style.opacityPct', { value: section.borderOpacity ?? 100 })} min={0} max={100} value={section.borderOpacity ?? 100} onChange={(v) => set({ borderOpacity: v })} />}
              </div>

              <div className="sp-e-theme-sub">{t('spotlight.editor.style.shadow')}</div>
              <div className="sp-e-inline">
                <Range label={t('spotlight.editor.style.strengthPct', { value: section.shadowOpacity ?? 0 })} min={0} max={100} value={section.shadowOpacity ?? 0} onChange={(v) => set({ shadowOpacity: v })} />
                {shadowOn && <ColorField label={t('spotlight.editor.style.color')} value={section.shadowColor ?? DEFAULT_INK} onChange={(v) => set({ shadowColor: v || DEFAULT_INK })} />}
                {shadowOn && <Range label={t('spotlight.editor.style.blur', { value: section.shadowBlur ?? 24 })} min={0} max={120} value={section.shadowBlur ?? 24} onChange={(v) => set({ shadowBlur: v })} />}
                {shadowOn && <Range label={t('spotlight.editor.style.spread', { value: section.shadowSpread ?? 0 })} min={-40} max={40} value={section.shadowSpread ?? 0} onChange={(v) => set({ shadowSpread: v })} />}
                {shadowOn && <Range label={`X ${section.shadowX ?? 0}`} min={-60} max={60} value={section.shadowX ?? 0} onChange={(v) => set({ shadowX: v })} />}
                {shadowOn && <Range label={`Y ${section.shadowY ?? 10}`} min={-60} max={60} value={section.shadowY ?? 10} onChange={(v) => set({ shadowY: v })} />}
                {shadowOn && <Toggle label={t('spotlight.editor.style.inset')} checked={!!section.shadowInset} onChange={(v) => set({ shadowInset: v })} />}
              </div>

              <div className="sp-e-theme-sub">{t('spotlight.editor.motion')}</div>
              <div className="sp-e-inline">
                <MotionControls prefix="anim" obj={section} hideLabel onChange={(patch) => set(patch)} />
                {section.type === 'embed' && (section.source === 'hive-recent') && section.animType && section.animType !== 'none' && (
                  <Range label={t('spotlight.editor.style.cardDelayMs', { value: section.animStagger ?? 120 })} min={0} max={1000} step={20}
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
  const { t } = useTranslation();
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
  const [appliedTpl, setAppliedTpl] = useState(null); // the template last applied (shown selected)
  const baseline = useRef('');
  const frameRef = useRef(null);                 // preview iframe
  const scrollRef = useRef(0);                   // preserve preview scroll across re-renders

  // Debounced iframe preview — render the CURRENT (unsaved) layout server-side so the
  // preview is pixel-identical to the public page and instant (no Hive/cache).
  useEffect(() => {
    if (!layout) return undefined;
    let alive = true;
    const timer = setTimeout(async () => {
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
    return () => { alive = false; clearTimeout(timer); };
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

  if (loading || !layout) return <div className="sp-e-loading" role="status"><Icon name="progress_activity" size={28} className="v2-spin" /></div>;

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
    toast.success(t('spotlight.editor.toasts.styleApplied', { type: t(`spotlight.blockNames.${src.type}`, { defaultValue: src.type }) }));
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
    setAppliedTpl(tpl.id);
    toast.success(t('spotlight.editor.toasts.templateApplied', { name: t(tpl.nameKey) }));
  };
  const undoTemplate = () => {
    if (!preTpl) return;
    markDirty(preTpl);
    setPreTpl(null);
    setAppliedTpl(null);
    setSelectedId(null);
    toast(t('spotlight.editor.toasts.reverted'));
  };

  const publicUrl = `${window.location.origin}/links/${user}`;

  const save = async () => {
    if (!isLoggedIn()) { toast.error(t('common.status.loginRequired')); return; }
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
      toast.success(t('spotlight.editor.toasts.saved'));
    } catch (e) {
      toast.error(e?.message || t('spotlight.editor.toasts.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="spotlight-editor">
      <div className="v2-card sp-e-top">
        <div className="sp-e-brand">
          <span className="sp-e-brand-icon"><Icon name="bolt" size={22} fill /></span>
          <span className="sp-e-brand-text">
            <span className="sp-e-brand-title">Spotlight</span>
            <span className="sp-e-brand-sub">{t('spotlight.editor.tagline')}</span>
          </span>
        </div>
        <div className="sp-e-top-actions">
          <div className="sp-e-url">
            <span className="sp-e-url-text" title={publicUrl}>/links/{user}</span>
            <IconButton icon="content_copy" size={32} variant="ghost" label={t('common.actions.copyLink')}
              onClick={() => { navigator.clipboard?.writeText(publicUrl); toast.success(t('spotlight.editor.toasts.linkCopied')); }} />
            <IconButton as="a" icon="open_in_new" size={32} variant="ghost" href={`/links/${user}`} target="_blank" rel="noreferrer" label={t('spotlight.editor.openPage')} />
          </div>
          <Button variant={dirty ? 'primary' : 'secondary'} size={40} className={cx('sp-e-save', dirty && 'dirty')} onClick={save}
            disabled={saving || !dirty} loading={saving} icon={!dirty && !saving ? 'check' : 'save'}>
            {saving ? t('common.actions.saving') : dirty ? t('common.actions.save') : t('common.actions.saved')}
          </Button>
        </div>
      </div>

      <div className="sp-e-body">
      <div className="sp-e-left">
      {/* Templates — one-click designs (theme + starter blocks); Undo restores. Shown
          first, and open by default for a brand-new page. */}
      <FoldCard icon="grid_view" title={t('spotlight.editor.templates.title')} open={showTemplates} onToggle={() => setShowTemplates((v) => !v)} className="sp-e-tpls-wrap">
        <p className="sp-e-hint">{t('spotlight.editor.templates.hint')}</p>
        <div className="sp-e-tpls">
          {TEMPLATES.map((tpl) => (
            <button type="button" key={tpl.id} className={cx('sp-e-tpl', appliedTpl === tpl.id && 'is-on')} title={`${t(tpl.nameKey)} · ${t(tpl.nicheKey)}`}
              aria-pressed={appliedTpl === tpl.id} onClick={() => applyTemplate(tpl)}>
              {/* The swatch is the template's own page background (user content). */}
              <span className="sp-e-tpl-swatch" style={{ background: bgToCss(tpl.theme.bg) }} />
              <span className="sp-e-tpl-name">{t(tpl.nameKey)}</span>
              <span className="sp-e-tpl-niche">{t(tpl.nicheKey)}</span>
            </button>
          ))}
        </div>
        {preTpl && (
          <button type="button" className="sp-e-tpl-undo" onClick={undoTemplate}><Icon name="undo" size={16} /> {t('spotlight.editor.templates.undo')}</button>
        )}
      </FoldCard>

      {/* Add */}
      <section className="v2-card sp-e-card">
        <b className="sp-e-card-title">{t('spotlight.editor.addBlock')}</b>
        <div className="sp-e-add">
          {SECTION_TYPES.map(({ type, labelKey }) => (
            <button type="button" key={type} onClick={() => { const s = newBlock(type); markDirty({ ...layout, sections: [...sections, s] }); setSelectedId(s.id); }}>
              <Icon name={TYPE_ICON[type] || 'add'} size={18} /> <span>{t(labelKey)}</span>
            </button>
          ))}
        </div>
      </section>
      </div>{/* /sp-e-left */}

      <div className="sp-e-controls">
      {/* Profile — bio, avatar & the always-present channel button, front and centre. */}
      <section className="v2-card sp-e-card sp-e-profile">
        <div className="sp-e-card-head"><Icon name="person" size={18} /><b>{t('spotlight.editor.profile.title')}</b></div>
        <input className="v2-input sp-e-headline" placeholder={t('spotlight.editor.profile.headlinePlaceholder')} value={headline} maxLength={200}
          onChange={(e) => markDirty({ ...layout, headline: e.target.value })} />
        <div className="sp-e-inline">
          <Range label={t('spotlight.editor.profile.avatarSizePct', { value: theme.avatarPct ?? 100 })} min={40} max={250} value={theme.avatarPct ?? 100} onChange={(v) => setTheme({ avatarPct: v })} />
          <Range label={t('spotlight.editor.profile.avatarShadowPct', { value: theme.avatarShadow ?? 30 })} min={0} max={100} value={theme.avatarShadow ?? 30} onChange={(v) => setTheme({ avatarShadow: v })} />
          <ColorField label={t('spotlight.editor.profile.avatarGlow')} value={theme.avatarGlow} onChange={(v) => setTheme({ avatarGlow: v })} allowClear />
          {theme.avatarGlow && <Range label={t('spotlight.editor.profile.glowSize', { value: theme.avatarGlowSize ?? 24 })} min={0} max={80} value={theme.avatarGlowSize ?? 24} onChange={(v) => setTheme({ avatarGlowSize: v })} />}
        </div>
        <div className="sp-e-inline">
          <MotionControls prefix="avatarAnim" obj={theme} onChange={(patch) => setTheme(patch)} />
        </div>
        <label className="v2-field sp-e-field"><span className="v2-eyebrow">{t('spotlight.editor.profile.channelButtonText')}</span>
          <input className="v2-input sp-e-input" placeholder="Open my Channel on 3Speak" maxLength={60}
            value={theme.footerText ?? ''} onChange={(e) => setTheme({ footerText: e.target.value })} />
        </label>
      </section>

      {/* Arrange: drag a block's grip onto another to share a row (auto-size), or onto
          a line between rows for a new row. Click a block to edit its content below. */}
      {sections.length === 0 ? (
        <EmptyState className="sp-e-empty" icon="add_link" title={t('spotlight.editor.empty')} />
      ) : (
        <div className="sp-e-arrange">
          <div className="sp-e-arrange-hint"><Trans i18nKey="spotlight.editor.arrangeHint" components={{ grip: <Icon name="drag_indicator" size={16} /> }} /></div>
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
        </div>
      )}

      {/* Page style */}
      <FoldCard icon="palette" title={t('spotlight.editor.page.title')} open={showTheme} onToggle={() => setShowTheme((v) => !v)} className="sp-e-theme">
          <Segmented size={32} label={t('spotlight.editor.style.background')} value={theme.bg.type} onChange={(v) => setBg({ type: v })}
            options={[{ value: 'color', label: t('spotlight.editor.page.solid') }, { value: 'gradient', label: t('spotlight.editor.page.gradient') }, { value: 'image', label: t('spotlight.editor.page.image') }]} />
          {theme.bg.type !== 'image' && (
            <div className="sp-e-inline">
              <ColorField label={t('spotlight.editor.style.color')} value={theme.bg.color} onChange={(v) => setBg({ color: v })} />
              {theme.bg.type === 'gradient' && <ColorField label={t('spotlight.editor.page.color2')} value={theme.bg.color2} onChange={(v) => setBg({ color2: v })} />}
              {theme.bg.type === 'gradient' && (
                <Range label={t('spotlight.editor.page.angle', { value: theme.bg.angle })} min={0} max={360} value={theme.bg.angle} onChange={(v) => setBg({ angle: v })} />
              )}
            </div>
          )}
          {theme.bg.type === 'image' && (
            <>
              <div className="sp-e-inline sp-e-inline--center">
                <label className="v2-btn v2-btn--secondary h36 sp-e-upload">
                  <Icon name="wallpaper" size={18} /> {t('spotlight.editor.page.uploadBackground')}
                  <input type="file" accept="image/*" hidden onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    try { const url = await uploadThumbnail(f); setBg({ image: url }); } catch { toast.error(t('spotlight.editor.toasts.uploadFailed')); }
                  }} />
                </label>
                {theme.bg.image ? <span className="sp-e-hint">{t('spotlight.editor.page.imageSet')}</span> : null}
              </div>
              {/* Overlay tint/gradient over the image for readability. */}
              <Labeled label={t('spotlight.editor.page.overlay')}>
                <Segmented size={32} label={t('spotlight.editor.page.overlay')} value={theme.bg.overlayType || 'none'} onChange={(v) => setBg({ overlayType: v })}
                  options={[{ value: 'none', label: t('spotlight.editor.page.none') }, { value: 'color', label: t('spotlight.editor.style.color') }, { value: 'gradient', label: t('spotlight.editor.page.gradient') }]} />
              </Labeled>
              {theme.bg.overlayType && theme.bg.overlayType !== 'none' && (
                <div className="sp-e-inline">
                  <ColorField label={t('spotlight.editor.page.overlay')} value={theme.bg.overlayColor} onChange={(v) => setBg({ overlayColor: v })} />
                  {theme.bg.overlayType === 'gradient' && (
                    <ColorField label={t('spotlight.editor.page.overlay2')} value={theme.bg.overlayColor2} onChange={(v) => setBg({ overlayColor2: v })} />
                  )}
                  <Range label={t('spotlight.editor.page.overlayOpacityPct', { value: theme.bg.overlayOpacity ?? 45 })} min={0} max={100} value={theme.bg.overlayOpacity ?? 45} onChange={(v) => setBg({ overlayOpacity: v })} />
                  {theme.bg.overlayType === 'gradient' && (
                    <Range label={t('spotlight.editor.page.overlayAngle', { value: theme.bg.overlayAngle ?? 160 })} min={0} max={360} value={theme.bg.overlayAngle ?? 160} onChange={(v) => setBg({ overlayAngle: v })} />
                  )}
                </div>
              )}
            </>
          )}
          <div className="sp-e-theme-sub">{t('spotlight.editor.page.colors')}</div>
          <div className="sp-e-inline">
            <ColorField label={t('spotlight.editor.style.text')} value={theme.text} onChange={(v) => setTheme({ text: v })} />
            <ColorField label={t('spotlight.editor.page.buttonBg')} value={theme.sectionBg} onChange={(v) => setTheme({ sectionBg: v })} />
            <ColorField label={t('spotlight.editor.page.buttonText')} value={theme.sectionText} onChange={(v) => setTheme({ sectionText: v })} />
          </div>
          <div className="sp-e-theme-sub">{t('spotlight.editor.page.buttons')}</div>
          <div className="sp-e-inline">
            <Labeled label={t('spotlight.editor.page.buttonStyle')}>
              <div className="sp-e-btnstyles" role="radiogroup" aria-label={t('spotlight.editor.page.buttonStyle')}>
                {['soft', 'fill', 'outline'].map((v) => (
                  <button type="button" key={v} role="radio" aria-checked={theme.buttonStyle === v}
                    className={cx('sp-e-btnstyle', `sp-e-btnstyle--${v}`, theme.buttonStyle === v && 'is-on')} onClick={() => setTheme({ buttonStyle: v })}>
                    {t(`spotlight.editor.page.${v}`)}
                  </button>
                ))}
              </div>
            </Labeled>
            <Range label={t('spotlight.editor.page.cornerRadius', { value: theme.radius })} min={0} max={48} value={theme.radius} onChange={(v) => setTheme({ radius: v })} />
          </div>

          {/* Global text styling — applies to the name, bio and every text block. */}
          <div className="sp-e-theme-sub">{t('spotlight.editor.page.textStyle')}</div>
          <div className="sp-e-inline">
            <SelectField label={t('spotlight.editor.page.font')} value={theme.font} onChange={(v) => setTheme({ font: v })}>
              {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.labelKey)}</option>)}
            </SelectField>
            <SelectField label={t('spotlight.editor.style.title')} value={theme.fontStyle || 'normal'} onChange={(v) => setTheme({ fontStyle: v })}>
              <option value="normal">{t('spotlight.editor.page.normal')}</option><option value="italic">{t('spotlight.editor.page.italic')}</option>
              <option value="bold">{t('spotlight.editor.page.bold')}</option><option value="bolditalic">{t('spotlight.editor.page.boldItalic')}</option>
            </SelectField>
            <SelectField label={t('spotlight.editor.style.shadow')} value={theme.textShadow || 'none'} onChange={(v) => setTheme({ textShadow: v })}>
              <option value="none">{t('spotlight.editor.page.none')}</option><option value="soft">{t('spotlight.editor.page.soft')}</option><option value="strong">{t('spotlight.editor.page.strong')}</option>
            </SelectField>
          </div>
          <div className="sp-e-inline">
            <Range label={t('spotlight.editor.style.fontSizePct', { value: theme.fontScale ?? 100 })} min={60} max={160} value={theme.fontScale ?? 100} onChange={(v) => setTheme({ fontScale: v })} />
            <Range label={t('spotlight.editor.page.textBorderPx', { value: theme.textStroke || 0 })} min={0} max={3} value={theme.textStroke || 0} onChange={(v) => setTheme({ textStroke: v })} />
            {(theme.textStroke || 0) > 0 && <ColorField label={t('spotlight.editor.page.borderColor')} value={theme.textStrokeColor} onChange={(v) => setTheme({ textStrokeColor: v || DEFAULT_INK })} />}
          </div>
      </FoldCard>

      </div>{/* /sp-e-controls */}

      {/* Live preview — an iframe rendered by the SAME server code as the public page. */}
      <div className="sp-e-side">
        <section className="v2-card sp-e-preview-card">
          <div className="sp-e-preview-label">
            <span className="sp-e-live-dot" aria-hidden="true" />
            <span className="v2-eyebrow">{t('spotlight.editor.livePreview')}</span>
            <a className="sp-e-preview-open" href={`/links/${user}`} target="_blank" rel="noreferrer">
              {t('spotlight.editor.openPage')} <Icon name="open_in_new" size={14} />
            </a>
          </div>
          <div className="sp-e-preview-bar"><span className="sp-e-preview-url">3speak.tv/links/{user}</span></div>
          <iframe ref={frameRef} className="sp-e-preview-frame" title={t('spotlight.editor.previewTitle')} srcDoc={previewHtml}
            onLoad={() => { try { const w = frameRef.current?.contentWindow; if (w && scrollRef.current) w.scrollTo(0, scrollRef.current); } catch { /* cross-doc */ } }} />
        </section>
      </div>
      </div>{/* /sp-e-body */}
    </div>
  );
}
