import React, { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Check, Film, WandSparkles } from "lucide-react";
import "../legacy-studio/VideoUploadStep2.scss";
import "./thumbnail-editor/ThumbnailEditor.scss";
import { toastIn } from '../../utils/toast';
import { StepProgress } from "../legacy-studio/StepProgress";
import EmbedUploadProgressBar from "./EmbedUploadProgressBar";
import StepActions from "./StepActions";
import { Navigate, useNavigate } from "react-router-dom";
import { useEmbedUpload } from "../../context/EmbedUploadContext";
import { useTranslation } from "react-i18next";
import ThumbnailCanvas from "./thumbnail-editor/ThumbnailCanvas";
import ThumbnailEditorModal from "./thumbnail-editor/ThumbnailEditorModal";
import { THUMBNAIL_TOOLS } from "./thumbnail-editor/tools";
import { DEFAULT_FRAME, NO_EDIT, OUTPUT_SIZE, emptyEdit } from "./thumbnail-editor/editState";
import { useAssetsVersion, useLoadedImage, useThumbnailExport } from "./thumbnail-editor/hooks";

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

function EmbedThumbnail() {
  const { t } = useTranslation();
  const {
    generatedThumbnail,
    setThumbnailFile,
    setStep,
    videoFile,
    step,
    selectedThumbnail,
    setSelectedThumbnail,
    setSelectedIndex,
    thumbnailDesign,
    setThumbnailDesign,
    setEditedThumbnail,
    thumbnailExtras,
    setThumbnailExtras,
    fromStories,
    isStory,
    prefilled,
  } = useEmbedUpload();

  const [thumbDragging, setThumbDragging] = useState(false);

  // Two things can be used as the thumbnail: a plain picture from the left
  // column (`plainSrc`), or the design made in the editor: `designSrc` with
  // `edit` on top, shown on the right once it differs from the plain picture.
  // `useDesign` says which one is in use. The design is kept when a plain
  // picture is chosen, so it can be chosen again. Worked on here and copied to
  // the upload context with each export, so dragging doesn't re-render the
  // whole wizard per move.
  const saved = thumbnailDesign;
  const [plainSrc, setPlainSrc] = useState(() => (saved?.active ? saved.plainSrc : selectedThumbnail) || null);
  const [designSrc, setDesignSrc] = useState(() => saved?.src || selectedThumbnail || null);
  const [edit, setEdit] = useState(() => saved?.edit || emptyEdit());
  const [useDesign, setUseDesign] = useState(() => !!saved?.active);
  const [selectedLayerId, setSelectedLayerId] = useState(null);
  // No frames could be generated: start on picking one from the video.
  const [activeTool, setActiveTool] = useState(() => (
    !generatedThumbnail.length && !thumbnailExtras.length && videoFile ? "pickFrame" : THUMBNAIL_TOOLS[0].key
  ));
  const [editorOpen, setEditorOpen] = useState(false);

  const isEdited = edit.layers.length > 0 || edit.frame.zoom !== 1 || edit.frame.x !== 0.5 || edit.frame.y !== 0.5;
  const outputSrc = useDesign ? designSrc : plainSrc;
  const outputEdit = useDesign ? edit : NO_EDIT;

  const navigate = useNavigate();
  const { width, height } = OUTPUT_SIZE[fromStories ? 'portrait' : 'landscape'];
  const outputImage = useLoadedImage(outputSrc);
  const designImage = useLoadedImage(designSrc);
  const assetsVersion = useAssetsVersion(edit.layers);

  // The exact Blob handed to the upload, kept for the editor's Download.
  const lastExportRef = useRef(null);
  const onExport = useCallback(({ blob, dataUrl }) => {
    lastExportRef.current = blob;
    setThumbnailFile(blob);
    setEditedThumbnail(dataUrl);
    setThumbnailDesign({ src: designSrc, edit, active: useDesign, plainSrc });
  }, [designSrc, edit, useDesign, plainSrc, setThumbnailFile, setEditedThumbnail, setThumbnailDesign]);
  const flushExport = useThumbnailExport({ image: outputImage, edit: outputEdit, width, height, assetsVersion, onExport });

  useEffect(() => {
    setStep(2);
  }, []);

  // Where pictures show: generated frames on the left; uploads on the right
  // (with the design, between the two tiles); frames picked in the editor only
  // in the editor's strip, which offers all of them to start a design from.
  const uploads = thumbnailExtras.filter((x) => x.kind === "custom").map((x) => x.src);
  const editorSources = [
    ...generatedThumbnail.map((src) => ({ src, badge: null })),
    ...thumbnailExtras.map((x) => ({
      src: x.src,
      badge: t(x.kind === "picked" ? "upload.thumbnail.pickedBadge" : "upload.thumbnail.customBadge"),
    })),
  ];
  const allThumbnails = editorSources.map((x) => x.src);

  // The upload context's "selected thumbnail" is the picture in use (later
  // steps only need to know there is one; the poster is `editedThumbnail`).
  useEffect(() => {
    if (!outputSrc || outputSrc === selectedThumbnail) return;
    setSelectedThumbnail(outputSrc);
    setSelectedIndex(Math.max(0, allThumbnails.indexOf(outputSrc)));
  }, [outputSrc]);

  // A plain picture from the left. Until there is a design, the editor starts
  // from whatever is picked here.
  const selectPlain = (src) => {
    setPlainSrc(src);
    setUseDesign(false);
    if (!isEdited) setDesignSrc(src);
  };

  // The picture under the design (the strip in the editor): the zoom/pan
  // belonged to the old one, the text stays.
  const selectDesignSource = (src) => {
    if (src !== designSrc) setEdit((e) => ({ ...e, frame: { ...DEFAULT_FRAME } }));
    setDesignSrc(src);
    setUseDesign(true);
  };

  const openEditor = () => {
    const startSrc = isEdited || useDesign ? designSrc : plainSrc;
    if (!isEdited && !useDesign) setDesignSrc(plainSrc);
    setUseDesign(true);
    // Nothing to edit yet (always so on mobile devices, which get no generated frames):
    // start by picking a frame from the video.
    if (!startSrc && videoFile) setActiveTool("pickFrame");
    setEditorOpen(true);
  };
  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    setSelectedLayerId(null);
  }, []);

  // Preselect the first picture when arriving with nothing chosen.
  useEffect(() => {
    if (!plainSrc && !useDesign && allThumbnails.length > 0) selectPlain(allThumbnails[0]);
  }, [generatedThumbnail]);

  if (!videoFile && !prefilled) {
    return <Navigate to="/embed-studio" replace />;
  }

  const processThumbnailFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("upload.thumbnail.invalidImage"));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result;
      if (!base64) return;
      addExtra(base64, "custom");
    };
    reader.readAsDataURL(file);
  };

  // A new picture goes to the end of the left column. An upload is used as it
  // is; a frame picked in the editor becomes the design's picture.
  const addExtra = (src, kind) => {
    setThumbnailExtras((prev) => [...prev, { src, kind }]);
    if (kind === "picked") selectDesignSource(src);
    else selectPlain(src);
  };

  const handleThumbnailUpload = (event) => {
    processThumbnailFile(event.target.files[0]);
    event.target.value = "";
  };

  // Drag & drop onto the upload option
  const handleThumbDragOver = (e) => { e.preventDefault(); setThumbDragging(true); };
  const handleThumbDragLeave = (e) => { e.preventDefault(); setThumbDragging(false); };
  const handleThumbDrop = (e) => {
    e.preventDefault();
    setThumbDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processThumbnailFile(file);
  };

  // Picking a layer on the preview opens the tool that owns it.
  const selectLayer = (id) => {
    setSelectedLayerId(id);
    const layer = id && edit.layers.find((l) => l.id === id);
    const owner = layer && THUMBNAIL_TOOLS.find((x) => x.layerType === layer.type);
    if (owner) setActiveTool(owner.key);
  };

  const resetEdit = () => {
    setEdit(emptyEdit());
    setSelectedLayerId(null);
  };

  const downloadThumbnail = async () => {
    await flushExport();
    const blob = lastExportRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `thumbnail-${width}x${height}.jpg`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const uploadThumbnail = async () => {
    if (!outputSrc || !outputImage) {
      toast.error(t("upload.thumbnail.selectFirst"));
      return;
    }
    // The last change may still be waiting to be rendered.
    await flushExport();
    navigate("/embed-studio/details");
    setStep(3);
  };

  const designInUse = useDesign && isEdited;

  // Rendered above and below the editor from this one object. Back keeps the
  // picked video (EmbedStudioPage only resets after a COMPLETED upload); the
  // mode goes along in the URL, because arriving there without `?from=stories`
  // reads as "long-form" and would drop a Short's selection. A prefilled upload
  // (Hangouts recording) never had a select step, so it gets no Back.
  const actions = {
    back: prefilled ? null : {
      label: t("common.actions.back"),
      onClick: () => navigate(fromStories ? `/embed-studio?from=${isStory ? "story" : "stories"}` : "/embed-studio"),
    },
    primary: [{ key: "proceed", label: t("upload.thumbnail.proceed"), onClick: uploadThumbnail }],
  };

  return (
    <>
      <div className="studio-main-container embed-wizard">
        <div className="studio-page-header">
          <h1>{fromStories ? t(isStory ? "upload.page.shareStory" : "upload.page.shareShort") : t("upload.page.shareVideo")}</h1>
        </div>

        <StepProgress step={step} short={fromStories} />
        {/* Shows only once the background upload runs (it starts on Details),
            i.e. after coming back here: it keeps going, and this says so. */}
        <EmbedUploadProgressBar />

        <div className="studio-page-content">
          <StepActions placement="top" {...actions} />
          <div className="upload-step">
            <div className="upload-step__header">
              <h2 className="upload-step__title">{t("upload.thumbnail.title")}</h2>
              <p className="upload-step__subtitle">
                {t("upload.thumbnail.subtitle")}
              </p>
            </div>

            <div className={`thumb-studio${fromStories ? " thumb-studio--portrait" : ""}`}>
              <div className="thumb-studio__stage">
                {/* Left: the frames generated from the video. */}
                <div className="thumb-studio__side thumb-studio__side--sources">
                  <div className="thumb-studio__options">
                    {generatedThumbnail.map((thumbnail, index) => (
                      <button
                        key={index}
                        type="button"
                        className={`thumb-option${!designInUse && outputSrc === thumbnail ? " is-selected" : ""}`}
                        onClick={() => selectPlain(thumbnail)}
                        aria-pressed={!designInUse && outputSrc === thumbnail}
                      >
                        <img src={thumbnail} alt={t("upload.thumbnail.thumbAlt", { n: index + 1 })} />
                        {!designInUse && outputSrc === thumbnail && (
                          <span className="thumb-option__check"><Check size={14} aria-hidden="true" /></span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="thumb-studio__preview">
                  {outputImage ? (
                    <ThumbnailCanvas
                      readOnly
                      onActivate={openEditor}
                      image={outputImage}
                      edit={outputEdit}
                      width={width}
                      height={height}
                      assetsVersion={assetsVersion}
                      label={t("upload.thumbnail.editor.open")}
                    />
                  ) : videoFile ? (
                    <button type="button" className="thumb-studio__empty thumb-studio__empty--action" onClick={openEditor}>
                      <span className="thumb-option__icon"><Film size={18} aria-hidden="true" /></span>
                      {t("upload.thumbnail.editor.pickPrompt")}
                    </button>
                  ) : (
                    <div className="thumb-studio__empty">
                      {allThumbnails.length ? null : t("upload.thumbnail.noFrames")}
                    </div>
                  )}
                </div>

                {/* Right: what the creator made. The editor tile, then the design
                    and the uploads (scrolling once they don't fit), the upload
                    tile last. Both tiles stay, whatever has been done already. */}
                <div className="thumb-studio__side thumb-studio__side--actions">
                  <button type="button" className="thumb-action thumb-action--editor" onClick={openEditor}>
                    <span className="thumb-option__icon"><WandSparkles size={16} aria-hidden="true" /></span>
                    <span className="thumb-option__label">{t("upload.thumbnail.editor.open")}</span>
                    <span className="thumb-option__hint">{t("upload.thumbnail.editor.openHint")}</span>
                  </button>

                  <div className="thumb-studio__made">
                    {isEdited && designImage && (
                      <div className={`thumb-option thumb-option--design${designInUse ? " is-selected" : ""}`}>
                        <ThumbnailCanvas
                          readOnly
                          onActivate={() => setUseDesign(true)}
                          image={designImage}
                          edit={edit}
                          width={width}
                          height={height}
                          assetsVersion={assetsVersion}
                          label={t("upload.thumbnail.useDesign")}
                        />
                        {designInUse && (
                          <span className="thumb-option__check"><Check size={14} aria-hidden="true" /></span>
                        )}
                        <span className="thumb-option__badge">{t("upload.thumbnail.editedBadge")}</span>
                      </div>
                    )}

                    {uploads.map((src, index) => (
                      <button
                        key={index}
                        type="button"
                        className={`thumb-option${!designInUse && outputSrc === src ? " is-selected" : ""}`}
                        onClick={() => selectPlain(src)}
                        aria-pressed={!designInUse && outputSrc === src}
                      >
                        <img src={src} alt={t("upload.thumbnail.thumbAlt", { n: generatedThumbnail.length + index + 1 })} />
                        {!designInUse && outputSrc === src && (
                          <span className="thumb-option__check"><Check size={14} aria-hidden="true" /></span>
                        )}
                        <span className="thumb-option__badge">{t("upload.thumbnail.customBadge")}</span>
                      </button>
                    ))}
                  </div>

                  <label
                    htmlFor="embed-thumbnail-upload"
                    className={`thumb-action thumb-action--upload${thumbDragging ? " is-dragging" : ""}`}
                    onDragOver={handleThumbDragOver}
                    onDragLeave={handleThumbDragLeave}
                    onDrop={handleThumbDrop}
                  >
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleThumbnailUpload}
                      className="thumb-option__input"
                      id="embed-thumbnail-upload"
                    />
                    <span className="thumb-option__icon"><Upload size={16} aria-hidden="true" /></span>
                    <span className="thumb-option__label">{t("upload.thumbnail.uploadCustom")}</span>
                    <span className="thumb-option__hint">{t("upload.thumbnail.orDragDrop")}</span>
                  </label>
                </div>
              </div>
            </div>

            {editorOpen && (
              <ThumbnailEditorModal
                onClose={closeEditor}
                portrait={fromStories}
                image={designImage}
                edit={edit}
                onEditChange={setEdit}
                width={width}
                height={height}
                assetsVersion={assetsVersion}
                selectedLayerId={selectedLayerId}
                onSelectLayer={selectLayer}
                activeTool={activeTool}
                onToolChange={setActiveTool}
                sources={editorSources}
                selectedSrc={designSrc}
                onSelectSource={selectDesignSource}
                videoFile={videoFile}
                onPickFrame={(src) => addExtra(src, "picked")}
                onReset={resetEdit}
                canReset={isEdited}
                onDownload={downloadThumbnail}
              />
            )}
          </div>
          <StepActions placement="bottom" {...actions} />
        </div>
      </div>
    </>
  );
}

export default EmbedThumbnail;
