import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ImagePlus, Search, Trash2 } from 'lucide-react';
import { Field, Hint, Slider, ToolButton } from './controls';
import { STICKER_SIZE, newStickerLayer, newTextLayer, removeLayer, updateLayer } from '../editState';
import { TEXT_PRESETS } from '../textPresets';
import { fontFor } from '../fonts';
import { STICKER_LIBRARY_URL } from '../../../../utils/config';

// The video editor's library (scripts/stickers/build_library.py there):
// { categories: [{ id, label }], items: [{ id, category, title, file, keywords }] },
// `file` relative to the JSON. Loaded once per page.
let libraryLoad = null;
function loadLibrary() {
  if (!libraryLoad) {
    libraryLoad = fetch(STICKER_LIBRARY_URL, { cache: 'no-cache' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((lib) => {
        const base = new URL(STICKER_LIBRARY_URL, window.location.href).href;
        return {
          categories: (lib.categories || []).map((c) => c.id),
          items: (lib.items || []).filter((it) => it?.id && it.file).map((it) => ({
            id: it.id,
            category: it.category,
            title: it.title || it.id,
            search: `${it.title || ''} ${(it.keywords || []).join(' ')}`.toLowerCase(),
            url: new URL(it.file, base).href,
          })),
        };
      })
      .catch((err) => { libraryLoad = null; throw err; });
  }
  return libraryLoad;
}

// Starting size per kind (longer side, % of the thumbnail's height).
const START_SIZE = { emoji: 30, badges: 40, shapes: 35, branding: 30, upload: 35 };
// Text boxes sit between the emojis and the rest, as in the editor's picker.
const TEXT_TAB = 'text';

// An uploaded sticker is kept in the design as a PNG data URL, so it is scaled
// down to this on its longer side first (still sharp at the largest size).
const UPLOAD_MAX_SIDE = 1024;

/** The picked image file as a PNG data URL (transparency kept), at most UPLOAD_MAX_SIDE. */
function readStickerFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * scale));
        c.height = Math.max(1, Math.round(img.naturalHeight * scale));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/png'));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not a readable image')); };
    img.src = url;
  });
}

const hexToRgba = (hex, a) => {
  const n = parseInt(String(hex || '#000000').slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

/** Add stickers and text boxes; change or remove the picked sticker. */
export default function StickerTool({ edit, onChange, selectedId, onSelect, onToolChange }) {
  const { t } = useTranslation();
  const [lib, setLib] = useState(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState('emoji');
  const [query, setQuery] = useState('');
  const [uploadFailed, setUploadFailed] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let live = true;
    loadLibrary().then((l) => { if (live) setLib(l); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const tabs = useMemo(() => {
    const cats = lib?.categories || ['emoji', 'badges', 'shapes', 'branding'];
    const rest = cats.filter((c) => c !== 'emoji');
    return [...(cats.includes('emoji') ? ['emoji'] : []), TEXT_TAB, ...rest];
  }, [lib]);

  const q = query.trim().toLowerCase();
  const images = (lib?.items || []).filter((it) => (q ? it.search.includes(q) : it.category === tab));
  const showPresets = !q && tab === TEXT_TAB;

  const selected = edit.layers.find((l) => l.id === selectedId && l.type === 'sticker') || null;
  const set = (patch) => onChange(updateLayer(edit, selected.id, patch));

  const addSticker = (item) => {
    const count = edit.layers.filter((l) => l.type === 'sticker').length;
    const layer = newStickerLayer({ url: item.url, title: item.title, size: START_SIZE[item.category] || 30 }, count);
    onChange({ ...edit, layers: [...edit.layers, layer] });
    onSelect(layer.id);
  };

  const uploadSticker = async (file) => {
    setUploadFailed(false);
    if (!file) return;
    try {
      if (!file.type.startsWith('image/')) throw new Error('Not an image');
      const url = await readStickerFile(file);
      addSticker({ url, title: file.name, category: 'upload' });
    } catch {
      setUploadFailed(true);
    }
  };

  // A text box is a styled text layer: add it and go to the Text tool to word it.
  const addTextBox = (preset) => {
    const count = edit.layers.filter((l) => l.type === 'text').length;
    const layer = newTextLayer(t('upload.thumbnail.text.defaultText'), count, preset.style);
    onChange({ ...edit, layers: [...edit.layers, layer] });
    onSelect(layer.id);
    onToolChange?.('text');
  };

  return (
    <>
      {selected && (
        <div className="thumb-sticker-selected">
          <div className="thumb-sticker-selected__head">
            <span className="thumb-field__label">{t('upload.thumbnail.stickers.selected')}</span>
            <ToolButton icon={Trash2} onClick={() => { onChange(removeLayer(edit, selected.id)); onSelect(null); }}>
              {t('upload.thumbnail.stickers.remove')}
            </ToolButton>
          </div>
          <Field label={t('upload.thumbnail.stickers.size')} value={selected.size} htmlFor="thumb-sticker-size">
            <Slider
              id="thumb-sticker-size"
              min={STICKER_SIZE.min}
              max={STICKER_SIZE.max}
              value={selected.size}
              onChange={(size) => set({ size })}
            />
          </Field>
          <Field label={t('upload.thumbnail.stickers.rotation')} value={`${selected.rotation || 0}°`} htmlFor="thumb-sticker-rot">
            <Slider
              id="thumb-sticker-rot"
              min={-180}
              max={180}
              value={selected.rotation || 0}
              onChange={(rotation) => set({ rotation })}
            />
          </Field>
        </div>
      )}

      <div className="thumb-sticker-bar">
        <div className="thumb-sticker-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('upload.thumbnail.stickers.search')}
            aria-label={t('upload.thumbnail.stickers.search')}
          />
        </div>
        <ToolButton icon={ImagePlus} onClick={() => fileRef.current?.click()} title={t('upload.thumbnail.stickers.uploadHint')}>
          {t('upload.thumbnail.stickers.upload')}
        </ToolButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { uploadSticker(e.target.files?.[0]); e.target.value = ''; }}
        />
      </div>
      {uploadFailed && <Hint>{t('upload.thumbnail.stickers.uploadFailed')}</Hint>}

      {!q && (
        <div className="thumb-sticker-tabs" role="tablist">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`thumb-sticker-tab${tab === id ? ' is-active' : ''}`}
              onClick={() => setTab(id)}
            >
              {t(`upload.thumbnail.stickers.cat.${id}`, { defaultValue: id })}
            </button>
          ))}
        </div>
      )}

      {showPresets ? (
        <div className="thumb-textboxes">
          {TEXT_PRESETS.map((p, i) => {
            const s = p.style;
            const font = fontFor(s.font);
            return (
              <button
                key={p.id}
                type="button"
                className="thumb-textbox"
                onClick={() => addTextBox(p)}
                aria-label={t('upload.thumbnail.stickers.textBoxLabel', { n: i + 1 })}
                title={t('upload.thumbnail.stickers.textBoxLabel', { n: i + 1 })}
              >
                <span
                  style={{
                    fontFamily: `"${font.family}", sans-serif`,
                    fontWeight: font.weight,
                    color: s.color,
                    background: s.box ? hexToRgba(s.boxColor, s.boxOpacity / 100) : 'transparent',
                    borderRadius: s.box ? `${s.boxRadius / 100}em` : 0,
                    padding: s.box ? `${s.boxPadding / 100}em` : 0,
                    border: s.box && s.boxBorder ? `${Math.max(1, s.boxBorder / 50)}px solid ${s.boxBorderColor}` : 'none',
                  }}
                >
                  {t('upload.thumbnail.text.defaultText')}
                </span>
              </button>
            );
          })}
        </div>
      ) : failed ? (
        <Hint>{t('upload.thumbnail.stickers.failed')}</Hint>
      ) : !lib ? (
        <Hint>{t('upload.thumbnail.stickers.loading')}</Hint>
      ) : images.length === 0 ? (
        <Hint>{t('upload.thumbnail.stickers.none')}</Hint>
      ) : (
        <div className="thumb-sticker-grid">
          {images.map((it) => (
            <button key={it.id} type="button" className="thumb-sticker" onClick={() => addSticker(it)} title={it.title} aria-label={it.title}>
              <img src={it.url} alt="" loading="lazy" crossOrigin="anonymous" />
            </button>
          ))}
        </div>
      )}

      <Hint>{t('upload.thumbnail.stickers.dragHint')}</Hint>
    </>
  );
}
