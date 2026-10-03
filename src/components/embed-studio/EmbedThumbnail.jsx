import React, { useEffect, useRef, useState } from "react";
import { Upload, Check } from "lucide-react";
import "../legacy-studio/VideoUploadStep2.scss";
import { toastIn } from '../../utils/toast';
import { TailChase } from "ldrs/react";
import "ldrs/react/TailChase.css";
import { StepProgress } from "../legacy-studio/StepProgress";
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
    prefilled,
  } = useEmbedUpload();

  const [customfile, setCustomFile] = useState([]);
  const [customFiles, setCustomFiles] = useState([]);
  const [loading, setLoading] = useState(false);
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

  return (
    <>
      <div className="studio-main-container">
        <div className="studio-page-header">
          <h1>{fromStories ? t("upload.page.shareShort") : t("upload.page.shareVideo")}</h1>
        </div>

        <StepProgress step={step} />

        <div className="studio-page-content">
          <div className="upload-step">
            <div className="upload-step__header">
              <h2 className="upload-step__title">{t("upload.thumbnail.title")}</h2>
              <p className="upload-step__subtitle">
                {t("upload.thumbnail.subtitle")}
              </p>
            </div>

            <div className="upload-step__content">
              <div className="upload-step__actions">
                <button
                  onClick={uploadThumbnail}
                  className="button button-primary"
                >
                  {loading ? (
                    <TailChase size="20" speed="1.75" color="white" />
                  ) : (
                    t("upload.thumbnail.proceed")
                  )}
                </button>
              </div>
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
        </div>
      </div>
    </>
  );
}

export default EmbedThumbnail;
