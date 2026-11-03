import React from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';
import { Field, Hint, Slider, ToolButton } from './controls';
import { MAX_ZOOM, MIN_ZOOM } from '../editState';
import { clampFrame } from '../renderThumbnail';

/** Zoom into the picture; the preview drag (ThumbnailCanvas) moves it. */
export default function FrameTool({ edit, onChange, image, width, height }) {
  const { t } = useTranslation();
  const { frame } = edit;
  const setFrame = (patch) => onChange({ ...edit, frame: clampFrame({ ...frame, ...patch }, image, width, height) });

  return (
    <>
      <Field label={t('upload.thumbnail.frame.zoom')} value={`${frame.zoom.toFixed(1)}×`} htmlFor="thumb-zoom">
        <Slider
          id="thumb-zoom"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.05}
          value={frame.zoom}
          onChange={(zoom) => setFrame({ zoom })}
        />
      </Field>
      <div className="thumb-tool-row">
        <ToolButton
          icon={Crosshair}
          onClick={() => setFrame({ x: 0.5, y: 0.5 })}
          disabled={frame.x === 0.5 && frame.y === 0.5}
        >
          {t('upload.thumbnail.frame.center')}
        </ToolButton>
      </div>
      <Hint>{t('upload.thumbnail.frame.dragHint')}</Hint>
    </>
  );
}
