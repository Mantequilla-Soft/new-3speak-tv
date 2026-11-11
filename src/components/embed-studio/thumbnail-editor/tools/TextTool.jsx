import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../../v2/ui';
import { ColorPicker, Field, Hint, Segmented, Slider, ToolButton, Toggle } from './controls';
import { BORDER_SIZE, BOX, TEXT_DEFAULTS, TEXT_SIZE, newTextLayer, removeLayer, updateLayer } from '../editState';
import { THUMB_FONTS } from '../fonts';

/** Text layers: add/pick/remove, and the look of the picked one. */
export default function TextTool({ edit, onChange, selectedId, onSelect }) {
  const { t } = useTranslation();
  const texts = edit.layers.filter((l) => l.type === 'text');
  const picked = texts.find((l) => l.id === selectedId);
  // Layers from before a setting existed get its default.
  const layer = picked
    ? { ...TEXT_DEFAULTS, ...picked }
    : null;
  const set = (patch) => onChange(updateLayer(edit, layer.id, patch));

  const add = () => {
    const created = newTextLayer(t('upload.thumbnail.text.defaultText'), texts.length);
    onChange({ ...edit, layers: [...edit.layers, created] });
    onSelect(created.id);
  };

  const remove = (id) => {
    onChange(removeLayer(edit, id));
    if (id === selectedId) onSelect(null);
  };

  return (
    <>
      <div className="thumb-layers">
        {texts.map((l, i) => (
          <div key={l.id} className={`thumb-layer-chip${l.id === selectedId ? ' is-active' : ''}`}>
            <button type="button" className="thumb-layer-chip__pick" onClick={() => onSelect(l.id)}>
              {l.text.trim().split('\n')[0] || t('upload.thumbnail.text.layerLabel', { n: i + 1 })}
            </button>
            <button
              type="button"
              className="thumb-layer-chip__remove"
              onClick={() => remove(l.id)}
              title={t('upload.thumbnail.text.remove')}
              aria-label={t('upload.thumbnail.text.remove')}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        <ToolButton icon="add" onClick={add}>{t('upload.thumbnail.text.add')}</ToolButton>
      </div>

      {!layer && (
        <Hint>{texts.length ? t('upload.thumbnail.text.pickHint') : t('upload.thumbnail.text.empty')}</Hint>
      )}

      {layer && (
        <>
          <Field label={t('upload.thumbnail.text.content')} htmlFor="thumb-text">
            <textarea
              id="thumb-text"
              className="thumb-textarea"
              rows={2}
              value={layer.text}
              placeholder={t('upload.thumbnail.text.placeholder')}
              onChange={(e) => set({ text: e.target.value })}
            />
          </Field>

          <Field label={t('upload.thumbnail.text.font')}>
            <div className="thumb-fonts" role="radiogroup" aria-label={t('upload.thumbnail.text.font')}>
              {THUMB_FONTS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={layer.font === f.key}
                  className={`thumb-font${layer.font === f.key ? ' is-active' : ''}`}
                  style={{ fontFamily: `"${f.family}", sans-serif`, fontWeight: f.weight }}
                  onClick={() => set({ font: f.key })}
                  title={f.family}
                  aria-label={f.family}
                >
                  {/* 23c: each font as an "Aa" tile. */}
                  Aa
                </button>
              ))}
            </div>
          </Field>

          <Field label={t('upload.thumbnail.text.size')} value={layer.size} htmlFor="thumb-text-size">
            <Slider
              id="thumb-text-size"
              min={TEXT_SIZE.min}
              max={TEXT_SIZE.max}
              value={layer.size}
              onChange={(size) => set({ size })}
            />
          </Field>

          <Field label={t('upload.thumbnail.text.color')}>
            <ColorPicker
              value={layer.color}
              onChange={(color) => set({ color })}
              customLabel={t('upload.thumbnail.text.customColor')}
            />
          </Field>

          <Field label={t('upload.thumbnail.text.align')}>
            <Segmented
              label={t('upload.thumbnail.text.align')}
              value={layer.align}
              onChange={(align) => set({ align })}
              options={[
                { value: 'left', label: t('upload.thumbnail.text.alignLeft'), icon: 'format_align_left' },
                { value: 'center', label: t('upload.thumbnail.text.alignCenter'), icon: 'format_align_center' },
                { value: 'right', label: t('upload.thumbnail.text.alignRight'), icon: 'format_align_right' },
              ]}
            />
          </Field>

          <Field label={t('upload.thumbnail.text.border')} htmlFor="thumb-text-border">
            <Toggle
              id="thumb-text-border"
              checked={layer.border}
              onChange={(border) => set({ border })}
              label={t('upload.thumbnail.text.border')}
            />
          </Field>

          {layer.border && (
            <>
              <Field label={t('upload.thumbnail.text.borderSize')} value={layer.borderSize} htmlFor="thumb-text-border-size">
                <Slider
                  id="thumb-text-border-size"
                  min={BORDER_SIZE.min}
                  max={BORDER_SIZE.max}
                  value={layer.borderSize}
                  onChange={(borderSize) => set({ borderSize })}
                />
              </Field>
              <Field label={t('upload.thumbnail.text.borderColor')}>
                <ColorPicker
                  value={layer.borderColor}
                  onChange={(borderColor) => set({ borderColor })}
                  customLabel={t('upload.thumbnail.text.customColor')}
                />
              </Field>
            </>
          )}

          <Field label={t('upload.thumbnail.text.box')} htmlFor="thumb-text-box">
            <Toggle
              id="thumb-text-box"
              checked={layer.box}
              onChange={(box) => set({ box })}
              label={t('upload.thumbnail.text.box')}
            />
          </Field>

          {layer.box && (
            <>
              <Field label={t('upload.thumbnail.text.boxColor')}>
                <ColorPicker
                  value={layer.boxColor}
                  onChange={(boxColor) => set({ boxColor })}
                  customLabel={t('upload.thumbnail.text.customColor')}
                />
              </Field>
              <Field label={t('upload.thumbnail.text.boxOpacity')} value={`${layer.boxOpacity}%`} htmlFor="thumb-box-opacity">
                <Slider id="thumb-box-opacity" min={BOX.opacity.min} max={BOX.opacity.max} value={layer.boxOpacity}
                  onChange={(boxOpacity) => set({ boxOpacity })} />
              </Field>
              <Field label={t('upload.thumbnail.text.boxPadding')} value={layer.boxPadding} htmlFor="thumb-box-padding">
                <Slider id="thumb-box-padding" min={BOX.padding.min} max={BOX.padding.max} value={layer.boxPadding}
                  onChange={(boxPadding) => set({ boxPadding })} />
              </Field>
              <Field label={t('upload.thumbnail.text.boxRadius')} value={layer.boxRadius} htmlFor="thumb-box-radius">
                <Slider id="thumb-box-radius" min={BOX.radius.min} max={BOX.radius.max} value={layer.boxRadius}
                  onChange={(boxRadius) => set({ boxRadius })} />
              </Field>
              <Field label={t('upload.thumbnail.text.boxBorder')} value={layer.boxBorder} htmlFor="thumb-box-border">
                <Slider id="thumb-box-border" min={BOX.border.min} max={BOX.border.max} value={layer.boxBorder}
                  onChange={(boxBorder) => set({ boxBorder })} />
              </Field>
              {layer.boxBorder > 0 && (
                <Field label={t('upload.thumbnail.text.boxBorderColor')}>
                  <ColorPicker
                    value={layer.boxBorderColor}
                    onChange={(boxBorderColor) => set({ boxBorderColor })}
                    customLabel={t('upload.thumbnail.text.customColor')}
                  />
                </Field>
              )}
            </>
          )}

          <Hint>{t('upload.thumbnail.text.dragHint')}</Hint>
        </>
      )}
    </>
  );
}
