import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ThumbnailEditorModal from '../embed-studio/thumbnail-editor/ThumbnailEditorModal';
import { THUMBNAIL_TOOLS } from '../embed-studio/thumbnail-editor/tools';
import { DEFAULT_FRAME, OUTPUT_SIZE, emptyEdit } from '../embed-studio/thumbnail-editor/editState';
import { useAssetsVersion, useLoadedImage } from '../embed-studio/thumbnail-editor/hooks';
import { exportThumbnail } from '../embed-studio/thumbnail-editor/renderThumbnail';
import '../embed-studio/thumbnail-editor/ThumbnailEditor.scss';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { toastIn } from '../../utils/toast';
import { blankCover, toEditableImage } from './coverImage';

const toast = toastIn('Upload');
const { width, height } = OUTPUT_SIZE.square;

/**
 * The video upload's thumbnail editor, for an audio cover: square, on top of the
 * cover there is (the playlist's, or the creator's own upload) or on a blank one.
 * Done renders the design with the same renderer as the video thumbnails,
 * uploads it and hands the URL to `onDone`. X, Esc and the backdrop leave the
 * cover as it was. No "Pick frame": there is no video.
 */
export default function CoverDesigner({ src, onDone, onClose }) {
  const { t } = useTranslation();
  const [base, setBase] = useState(null);
  const [edit, setEdit] = useState(emptyEdit);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [activeTool, setActiveTool] = useState(src ? THUMBNAIL_TOOLS[0].key : 'text');
  const [saving, setSaving] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    let live = true;
    const load = src ? toEditableImage(src) : Promise.resolve(blankCover(width));
    load
      .then((dataUrl) => {
        if (!live) return;
        if (!dataUrl) throw new Error('no canvas');
        setBase(dataUrl);
      })
      .catch(() => {
        if (!live) return;
        toast.error(t('audio.upload.thumb.designUnavailable'));
        onCloseRef.current();
      });
    return () => { live = false; };
  }, [src, t]);

  const image = useLoadedImage(base);
  const assetsVersion = useAssetsVersion(edit.layers);
  const isEdited = edit.layers.length > 0 || edit.frame.zoom !== 1 || edit.frame.x !== 0.5 || edit.frame.y !== 0.5;

  const selectLayer = (id) => {
    setSelectedLayerId(id);
    const layer = id && edit.layers.find((l) => l.id === id);
    const owner = layer && THUMBNAIL_TOOLS.find((x) => x.layerType === layer.type);
    if (owner) setActiveTool(owner.key);
  };

  const render = useCallback(() => exportThumbnail({ image, edit, width, height }), [image, edit]);

  const handleDone = async () => {
    if (!image || saving) return;
    // Nothing changed on an existing cover: it stays as it is.
    if (!isEdited && src) { onClose(); return; }
    setSaving(true);
    try {
      const { blob } = await render();
      if (!blob) throw new Error(t('audio.upload.thumb.designUnavailable'));
      const url = await uploadThumbnail(new File([blob], 'cover.jpg', { type: 'image/jpeg' }));
      onDone(url);
    } catch (err) {
      toast.error(t('audio.upload.toasts.thumbFailed', { error: err?.message || t('audio.upload.unknown') }));
      setSaving(false);
    }
  };

  const download = async () => {
    if (!image) return;
    const { blob } = await render();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cover-${width}x${height}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Shown once the picture is ready to draw on (reading it takes a moment).
  if (!image) return null;

  return (
    <ThumbnailEditorModal
      square
      title={t('audio.upload.thumb.designerTitle')}
      onClose={() => { if (!saving) onClose(); }}
      onDone={handleDone}
      doneBusy={saving}
      image={image}
      edit={edit}
      onEditChange={setEdit}
      width={width}
      height={height}
      assetsVersion={assetsVersion}
      selectedLayerId={selectedLayerId}
      onSelectLayer={selectLayer}
      activeTool={activeTool}
      onToolChange={setActiveTool}
      sources={[]}
      selectedSrc={base}
      onSelectSource={() => setEdit((e) => ({ ...e, frame: { ...DEFAULT_FRAME } }))}
      videoFile={null}
      onPickFrame={() => {}}
      onReset={() => { setEdit(emptyEdit()); setSelectedLayerId(null); }}
      canReset={isEdited}
      onDownload={download}
    />
  );
}
