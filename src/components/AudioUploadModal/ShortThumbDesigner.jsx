import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ThumbnailEditorModal from '../embed-studio/thumbnail-editor/ThumbnailEditorModal';
import { DEFAULT_FRAME, OUTPUT_SIZE, emptyEdit } from '../embed-studio/thumbnail-editor/editState';
import { THUMBNAIL_TOOLS } from '../embed-studio/thumbnail-editor/tools';
import { useAssetsVersion, useLoadedImage } from '../embed-studio/thumbnail-editor/hooks';
import { exportThumbnail } from '../embed-studio/thumbnail-editor/renderThumbnail';
import '../embed-studio/thumbnail-editor/ThumbnailEditor.scss';
import { uploadThumbnail } from '../../utils/uploadThumbnail';
import { captureFrameAt } from '../../utils/videoThumbnails';
import { fetchAudiogramFile } from '../../utils/audiogramShorts';
import { toastIn } from '../../utils/toast';

const toast = toastIn('Upload');
const { width, height } = OUTPUT_SIZE.portrait;

/**
 * The video upload's thumbnail editor for a Short made from an audiogram:
 * portrait (9:16), on a frame of the audiogram (1.5 s in), with "Pick frame"
 * to take any other moment of it. Done renders the design with the same
 * renderer as the video thumbnails, uploads it and hands the URL to `onDone`.
 * X, Esc and the backdrop leave the thumbnail as it was.
 */
export default function ShortThumbDesigner({ videoUrl, owner, onDone, onClose }) {
  const { t } = useTranslation();
  const [file, setFile] = useState(null);
  const [sources, setSources] = useState([]); // [{ src, badge }]
  const [selectedSrc, setSelectedSrc] = useState(null);
  const [edit, setEdit] = useState(emptyEdit);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  const [activeTool, setActiveTool] = useState(THUMBNAIL_TOOLS[0].key);
  const [saving, setSaving] = useState(false);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // The audiogram, and its frame at 1.5 s to start from
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const f = await fetchAudiogramFile(videoUrl);
        if (!live) return;
        setFile(f);
        const frame = await captureFrameAt(f, 1.5).catch(() => null);
        if (!live) return;
        if (frame) {
          setSources([{ src: frame, badge: null }]);
          setSelectedSrc(frame);
        } else {
          setActiveTool('pickFrame'); // no frame by itself here: pick one
        }
      } catch (err) {
        if (!live) return;
        toast.error(t('audio.upload.shorts.couldNotLoad', { error: err?.message || t('audio.upload.unknown') }));
        onCloseRef.current();
      }
    })();
    return () => { live = false; };
  }, [videoUrl, t]);

  const image = useLoadedImage(selectedSrc);
  const assetsVersion = useAssetsVersion(edit.layers);
  const isEdited = edit.layers.length > 0 || edit.frame.zoom !== 1 || edit.frame.x !== 0.5 || edit.frame.y !== 0.5;

  const selectLayer = (id) => {
    setSelectedLayerId(id);
    const layer = id && edit.layers.find((l) => l.id === id);
    const tool = layer && THUMBNAIL_TOOLS.find((x) => x.layerType === layer.type);
    if (tool) setActiveTool(tool.key);
  };

  const pickFrame = (dataUrl) => {
    setSources((list) => [...list, { src: dataUrl, badge: t('upload.thumbnail.pickedBadge') }]);
    setSelectedSrc(dataUrl);
    setEdit((e) => ({ ...e, frame: { ...DEFAULT_FRAME } }));
    setActiveTool('frame');
  };

  const render = useCallback(() => exportThumbnail({ image, edit, width, height }), [image, edit]);

  const handleDone = async () => {
    if (!image || saving) return;
    setSaving(true);
    try {
      const { blob } = await render();
      if (!blob) throw new Error(t('audio.upload.thumb.designUnavailable'));
      const url = await uploadThumbnail(new File([blob], 'short-thumbnail.jpg', { type: 'image/jpeg' }), owner, { preferStatic: true });
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
    a.download = `short-thumbnail-${width}x${height}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <ThumbnailEditorModal
      portrait
      title={t('audio.upload.shorts.designerTitle')}
      onClose={() => { if (!saving) onClose(); }}
      onDone={handleDone}
      doneBusy={saving || !image}
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
      sources={sources}
      selectedSrc={selectedSrc}
      onSelectSource={(src) => { setSelectedSrc(src); setEdit((e) => ({ ...e, frame: { ...DEFAULT_FRAME } })); }}
      videoFile={file}
      onPickFrame={pickFrame}
      onReset={() => { setEdit(emptyEdit()); setSelectedLayerId(null); }}
      canReset={isEdited}
      onDownload={download}
    />
  );
}
