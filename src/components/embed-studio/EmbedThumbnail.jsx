import React, { useEffect, useRef, useState } from "react";
import { Upload, Check } from "lucide-react";
import "../legacy-studio/VideoUploadStep2.scss";
import { toastIn } from '../../utils/toast';
import { StepProgress } from "../legacy-studio/StepProgress";
import EmbedUploadProgressBar from "./EmbedUploadProgressBar";
import StepActions from "./StepActions";
import { Navigate, useNavigate } from "react-router-dom";
import { useEmbedUpload } from "../../context/EmbedUploadContext";
import { useTranslation } from "react-i18next";

// Every toast from this module is headed "Upload"; the message becomes the
// line under it. See utils/toast.js.
const toast = toastIn('Upload');

function EmbedThumbnail() {
  const { t } = useTranslation();
  const {
    generatedThumbnail,
    thumbnailFile,
    setThumbnailFile,
    setStep,
    videoFile,
    step,
    selectedThumbnail,
    setSelectedThumbnail,
    selectedIndex,
    setSelectedIndex,
    fromStories,
    isStory,
    prefilled,
  } = useEmbedUpload();

  // Custom uploads live only on this page, so coming back here (Back from
  // Details) would drop a chosen custom thumbnail from the grid while it stays
  // selected in the upload state. Put it back as the custom card it was; the
  // "newest custom" effect below then re-selects it at its new index.
  const keptCustom = !!(selectedThumbnail && thumbnailFile && !generatedThumbnail.includes(selectedThumbnail));
  const [customfile, setCustomFile] = useState(() => (keptCustom ? [selectedThumbnail] : []));
  const [customFiles, setCustomFiles] = useState(() => (keptCustom ? [thumbnailFile] : []));
  const [thumbDragging, setThumbDragging] = useState(false);

  const thumbnailInputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    setStep(2);
  }, []);

  // Auto-select first generated thumbnail
  useEffect(() => {
    if (
      generatedThumbnail.length > 0 &&
      selectedIndex === null &&
      customfile.length === 0
    ) {
      const first = generatedThumbnail[0];
      setSelectedIndex(0);
      setSelectedThumbnail(first);

      const base64 = first;
      const mime = base64.split(";")[0].split(":")[1];
      const byteString = atob(base64.split(",")[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: mime });
      setThumbnailFile(blob);
    }
  }, [generatedThumbnail]);

  // Auto-select newest uploaded thumbnail
  useEffect(() => {
    if (customfile.length > 0) {
      const newestIndex = generatedThumbnail.length + (customfile.length - 1);
      setSelectedIndex(newestIndex);
      setSelectedThumbnail(customfile[customfile.length - 1]);
      setThumbnailFile(customFiles[customFiles.length - 1]);
    }
  }, [customfile]);

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
      setCustomFile((prev) => [...prev, base64]);
      setCustomFiles((prev) => [...prev, file]);
    };
    reader.readAsDataURL(file);
  };

  const handleThumbnailUpload = (event) => {
    processThumbnailFile(event.target.files[0]);
  };

  // Drag & drop onto the "Upload Custom" thumbnail card
  const handleThumbDragOver = (e) => { e.preventDefault(); setThumbDragging(true); };
  const handleThumbDragLeave = (e) => { e.preventDefault(); setThumbDragging(false); };
  const handleThumbDrop = (e) => {
    e.preventDefault();
    setThumbDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) processThumbnailFile(file);
  };

  const allThumbnails = [...generatedThumbnail, ...customfile];

  const uploadThumbnail = () => {
    if (!selectedThumbnail || !thumbnailFile) {
      toast.error(t("upload.thumbnail.selectFirst"));
      return;
    }

    navigate("/embed-studio/details");
    setStep(3);
  };

  // Rendered above and below the grid from this one object. Back keeps the
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

            <div className="upload-step__content">
              <div className={`thumbnail-grid${fromStories ? ' thumbnail-grid--portrait' : ''}`}>
                {allThumbnails.map((thumbnail, index) => (
                  <div
                    key={index}
                    className={`thumbnail-card ${
                      selectedIndex === index ? "thumbnail-card--selected" : ""
                    }`}
                    onClick={() => {
                      setSelectedIndex(index);
                      setSelectedThumbnail(thumbnail);

                      const customIndex = customfile.indexOf(thumbnail);
                      if (customIndex !== -1) {
                        setThumbnailFile(customFiles[customIndex]);
                        return;
                      }

                      const base64 = thumbnail;
                      const mime = base64.split(";")[0].split(":")[1];
                      const byteString = atob(base64.split(",")[1]);
                      const ab = new ArrayBuffer(byteString.length);
                      const ia = new Uint8Array(ab);
                      for (let i = 0; i < byteString.length; i++)
                        ia[i] = byteString.charCodeAt(i);
                      const blob = new Blob([ab], { type: mime });
                      setThumbnailFile(blob);
                    }}
                  >
                    <div className="content">
                      <img
                        src={thumbnail}
                        alt={t("upload.thumbnail.thumbAlt", { n: index + 1 })}
                        className="image"
                      />
                      {selectedIndex === index && (
                        <div className="check">
                          <Check className="w-4 h-4" />
                        </div>
                      )}
                      {index >= generatedThumbnail.length && (
                        <div className="badge">{t("upload.thumbnail.customBadge")}</div>
                      )}
                    </div>
                  </div>
                ))}

                <div
                  className={`thumbnail-upload${thumbDragging ? ' is-dragging' : ''}`}
                  onDragOver={handleThumbDragOver}
                  onDragLeave={handleThumbDragLeave}
                  onDrop={handleThumbDrop}
                >
                  <div className="thumbnail-upload__content">
                    <input
                      type="file"
                      accept="image/*"
                      ref={thumbnailInputRef}
                      onChange={handleThumbnailUpload}
                      className="thumbnail-upload__input"
                      id="embed-thumbnail-upload"
                    />
                    <label
                      htmlFor="embed-thumbnail-upload"
                      className="thumbnail-upload__content"
                    >
                      <div className="thumbnail-upload__icon">
                        <Upload className="w-4 h-4" />
                      </div>
                      <span className="thumbnail-upload__label">
                        {t("upload.thumbnail.uploadCustom")}
                      </span>
                      <span className="thumbnail-upload__hint">
                        {t("upload.thumbnail.orDragDrop")}
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <StepActions placement="bottom" {...actions} />
        </div>
      </div>
    </>
  );
}

export default EmbedThumbnail;
