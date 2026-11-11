import React, { useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button, IconButton } from '../../v2/ui';
import ModalHeader from '../../ModalHeader/ModalHeader';
import { usePortalDoc } from '../../../utils/portalDocument';
import ThumbnailCanvas from './ThumbnailCanvas';
import ThumbnailTools from './ThumbnailTools';
import ResetButton from './ResetButton';

/**
 * The thumbnail editor: the canvas with the pictures to start from under it,
 * the tools beside it (under it on phones), Reset and Done at the bottom.
 * Everything it changes is the step page's state, so closing loses nothing.
 *
 * Other hosts (the audio upload's cover designer) may pass `onDone` for a Done
 * that is not just a close (it then saves; X, Esc and the backdrop still close),
 * `doneBusy` while that runs, `square` for a 1:1 picture and their own `title`.
 */
export default function ThumbnailEditorModal({
  onClose, portrait,
  image, edit, onEditChange, width, height, assetsVersion,
  selectedLayerId, onSelectLayer, activeTool, onToolChange,
  sources, selectedSrc, onSelectSource,
  videoFile, onPickFrame,
  onReset, canReset, onDownload,
  square = false, title = null, onDone = null, doneBusy = false,
}) {
  const { t } = useTranslation();
  const doc = usePortalDoc();
  const titleId = useId();

  // Esc closes; the page behind doesn't scroll while open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    doc.addEventListener('keydown', onKey);
    const prevOverflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    return () => {
      doc.removeEventListener('keydown', onKey);
      doc.body.style.overflow = prevOverflow;
    };
  }, [doc, onClose]);

  return createPortal(
    <div
      className="thumb-modal-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className={[
          'thumb-modal',
          portrait ? 'thumb-modal--portrait' : '',
          square ? 'thumb-modal--square' : '',
          // For the phone layout: no picture yet / picking one (see the SCSS).
          image ? '' : 'is-empty',
          activeTool === 'pickFrame' ? 'is-picking' : '',
        ].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        {/* 23c: an accent bar and the title; Download and Reset as icon tiles
            beside the close. */}
        <ModalHeader closeOnEscape={false} title={title || t('upload.thumbnail.editor.title')} onClose={onClose} titleId={titleId} className="thumb-modal__header" tone="accent">
          <IconButton
            icon="download"
            size={40}
            variant="secondary"
            className="thumb-modal__headbtn"
            label={t('upload.thumbnail.editor.downloadHint')}
            onClick={onDownload}
            disabled={!image}
          />
          <ResetButton onReset={onReset} disabled={!canReset} compact />
        </ModalHeader>

        <div className="thumb-modal__body">
          <div className="thumb-modal__stage">
            <div className="thumb-modal__canvas">
              {image ? (
                <ThumbnailCanvas
                  image={image}
                  edit={edit}
                  width={width}
                  height={height}
                  assetsVersion={assetsVersion}
                  selectedId={selectedLayerId}
                  onSelect={onSelectLayer}
                  onChange={onEditChange}
                  label={t('upload.thumbnail.previewLabel')}
                />
              ) : (
                <div className="thumb-studio__empty">{t('upload.thumbnail.editor.pickPrompt')}</div>
              )}
            </div>

            {sources.length > 1 && (
              <div className="thumb-modal__sources" role="group" aria-label={t('upload.thumbnail.editor.sources')}>
                {sources.map(({ src, badge }, index) => (
                  <button
                    key={index}
                    type="button"
                    className={`thumb-option${selectedSrc === src ? ' is-selected' : ''}`}
                    onClick={() => onSelectSource(src, index)}
                    aria-pressed={selectedSrc === src}
                  >
                    <img src={src} alt={t('upload.thumbnail.thumbAlt', { n: index + 1 })} />
                    {badge && <span className="thumb-option__badge">{badge}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="thumb-modal__side">
            <ThumbnailTools
              activeTool={activeTool}
              onToolChange={onToolChange}
              edit={edit}
              onChange={onEditChange}
              selectedId={selectedLayerId}
              onSelect={onSelectLayer}
              image={image}
              width={width}
              height={height}
              videoFile={videoFile}
              onPickFrame={onPickFrame}
            />
          </div>
        </div>

        <div className="thumb-modal__footer">
          {/* 23c: one full-width primary. The video thumbnail is used as is;
              a host with its own Done (the audio cover) keeps "Done". */}
          <Button variant="primary" size={56} block trailing="check" className="thumb-btn thumb-btn--primary is-next" onClick={onDone || onClose} disabled={doneBusy} loading={doneBusy}>
            {doneBusy ? t('audio.upload.thumb.uploading') : onDone ? t('upload.thumbnail.editor.done') : t('upload.thumbnail.editor.useThumbnail')}
          </Button>
        </div>
      </div>
    </div>,
    doc.body,
  );
}
